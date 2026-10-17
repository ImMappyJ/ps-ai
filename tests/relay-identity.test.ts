import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createServer} from 'node:http';
import {startManagedRelay} from '../server/runtime/managed-relay';import {RelayController} from '../src/relay-controller';import {PLATFORMS} from '../src/platforms';

test('an IPv6 localhost impostor cannot forward a real IPv4 handshake to obtain credentials',async()=>{
  const evidence=path.resolve(os.tmpdir()),root=await fs.mkdtemp(path.join(evidence,'review-dual-stack-'));
  const relay=await startManagedRelay({dataDir:root,ports:{bailian:0,gemini:0,openai:0}}),port=relay.session.ports.openai;
  const leaked:{bearer:boolean;key:boolean}[]=[];
  const caps={protocol:'ps-ai/1',provider:'openai',configured:true,cancellation:'none',progress:'stages',models:[{id:'gpt-image-1.5',label:'m',operations:['t2i'],maxInputImages:0,outputDepths:[8],seedMax:0,minPixels:1,maxPixels:4194304,maxAspectRatio:8}]};
  const impostor=createServer(async(req,res)=>{
    if(req.url==='/psai/v1/handshake'){
      // Forward only the public challenge, without knowing the relay token.
      const proof=await fetch(`http://127.0.0.1:${port}/psai/v1/handshake`,{headers:{'X-PSAI-Challenge':String(req.headers['x-psai-challenge'])}});
      res.writeHead(proof.status,{'Content-Type':'application/json'});res.end(await proof.text());return;
    }
    let body='';for await(const chunk of req)body+=chunk;
    const bearer=!!req.headers.authorization,key=body.includes('synthetic-stored-key');if(bearer||key)leaked.push({bearer,key});
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/psai/v1/capabilities'?caps:{configured:true}));
  });
  try{
    await new Promise<void>((resolve,reject)=>{impostor.once('error',reject);impostor.listen(port,'::1',()=>{impostor.off('error',reject);resolve();});});
    const session={...relay.session,ports:Object.fromEntries(Object.entries(PLATFORMS).map(([id,p])=>[id,p.port]))};
    const folder={nativePath:'C:\\Private\\relay',getEntry:async()=>({read:async()=>JSON.stringify(session)})};
    const uxp={storage:{secureStorage:{getItem:async()=>new TextEncoder().encode('synthetic-stored-key')},localFileSystem:{getDataFolder:async()=>({getEntry:async()=>folder})}},shell:{openPath:async()=>{throw Error('A relay is already running');}}};
    const transport=(async(url:string,init:any)=>{
      const u=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(u.hostname));
      // Isolate the test on ephemeral ports; localhost selecting ::1 is a normal dual-stack resolution.
      const base=u.hostname==='localhost'?`http://[::1]:${port}`:`http://127.0.0.1:${port}`;
      return fetch(base+u.pathname,init);
    }) as typeof fetch;
    const client=await new RelayController(uxp,transport).connect('openai','gpt-image-1.5');assert.equal(client.capabilities?.configured,true);
    assert.deepEqual(leaked,[],'The public handshake can be relayed from ::1 to the genuine 127.0.0.1 listener');
  }finally{
    if(impostor.listening)await new Promise<void>((resolve,reject)=>impostor.close(e=>e?reject(e):resolve()));
    await relay.close();assert.ok(root.startsWith(evidence+path.sep));await fs.rm(root,{recursive:true,force:true});
  }
});
