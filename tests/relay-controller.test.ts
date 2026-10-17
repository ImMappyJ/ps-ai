import test from 'node:test';import assert from 'node:assert/strict';
import {RelayController} from '../src/relay-controller';
function mock(denied=false){
  const saved=new Map<string,Uint8Array>(),files=new Map<string,string|ArrayBuffer>();let launches=0,alive=false;const calls:any[]=[];
  const session={protocol:'ps-ai-relay/1',token:'a'.repeat(64),ports:{bailian:8191,gemini:8192,openai:8193}};
  const folder:any={nativePath:'C:\\Private\\relay',createFile:async(name:string)=>({nativePath:'C:\\Private\\relay\\'+name,write:async(value:any)=>files.set(name,value)}),getEntry:async(name:string)=>{if(!files.has(name))throw Error('missing');return {read:async()=>files.get(name)};}};
  const uxp:any={storage:{formats:{binary:'binary'},secureStorage:{getItem:async(k:string)=>{if(!saved.has(k))throw Error('missing');return saved.get(k);},setItem:async(k:string,v:string)=>saved.set(k,new TextEncoder().encode(v)),removeItem:async(k:string)=>saved.delete(k)},localFileSystem:{getDataFolder:async()=>({getEntry:async()=>folder}),getPluginFolder:async()=>({getEntry:async()=>({read:async()=>new ArrayBuffer(1)})})}},shell:{openPath:async()=>{launches++;if(denied)return 'denied';alive=true;files.set('relay-session.json',JSON.stringify(session));return '';}}};
  const transport=(async(url:string,init:any)=>{if(!alive)throw TypeError('offline');assert.equal(init?.redirect,'error');calls.push({url,init});assert.equal(init.headers.Authorization,'Bearer '+session.token);const provider=url.includes('8192')?'gemini':url.includes('8193')?'openai':'bailian';if(url.endsWith('capabilities'))return Response.json({protocol:'ps-ai/1',provider,configured:false,cancellation:'none',progress:'stages',models:[{id:'m',label:'m',operations:['t2i'],maxInputImages:0,outputDepths:[8],seedMax:0,minPixels:1,maxPixels:4194304,maxAspectRatio:8}]});return Response.json({configured:true});}) as typeof fetch;
  return {uxp,transport,saved,files,calls,get launches(){return launches;}};
}
test('UXP relay launches once, checks identity before credentials and keeps keys in secure storage only',async()=>{
  const m=mock(),relay=new RelayController(m.uxp,m.transport);
  const client=await relay.connect('openai','m');assert.equal(client.base,'http://localhost:8193');assert.equal(m.launches,1);
  await relay.saveKey('openai',' first-key ');await relay.connect('openai','m');assert.equal(m.launches,1);assert.equal(await relay.hasKey('openai'),true);assert.equal(await relay.hasKey('gemini'),false);
  assert.ok(m.calls.some(c=>c.url.endsWith('/configure')&&JSON.parse(c.init.body).apiKey==='first-key'));
  assert.doesNotMatch(JSON.stringify([...m.files]),/first-key/);await relay.clearKey('openai');assert.equal(await relay.hasKey('openai'),false);
});
test('UXP relay reports launch denial without uploading credentials or images',async()=>{
  const m=mock(true),relay=new RelayController(m.uxp,m.transport);await assert.rejects(relay.saveKey('bailian','test-key'),/启动|launch/i);assert.equal(m.calls.length,0);assert.equal(m.saved.size,0);
});
