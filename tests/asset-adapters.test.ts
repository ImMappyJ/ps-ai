import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {buildGraph} from '../src/generation/workflow';import {intent} from '../src/generation/intent';
import {decodePng,encodePng} from '../src/imaging/image';
import type {GenerationRequest} from '../src/infrastructure/backends/gateway-protocol';
import {GatewayClient} from '../src/infrastructure/backends/gateway-client';import {uuid} from '../src/infrastructure/backends/client';
import {OpenAIImagesProvider} from '../server/providers/openai';import {BailianProvider} from '../server/providers/bailian';import {GeminiProvider} from '../server/providers/gemini';
import type {ImageProvider} from '../server/providers/contract';import {createGateway} from '../server/http/gateway';
import {cloudRequest,cloudPng,testId} from './gateway-fixtures';import {listenLoopback} from './loopback';

function asset(model:string,mode='effect',id=testId):GenerationRequest {
  const compiled=intent('cosplay',mode,'soft blue sparks',false,true,'','semantic',false,'selection-v1');
  return {...cloudRequest,model,seed:model.startsWith('gpt-')?0:42,kind:compiled.kind,mode,prompt:compiled.prompt,assetContext:'selection-v1',source:`${id}-source.png`,guide:`${id}-guide.png`};
}
function fromDataUrl(value:string){return new Uint8Array(Buffer.from(value.split(',')[1],'base64'));}
function inline(bytes:Uint8Array){return Response.json({data:[{b64_json:Buffer.from(bytes).toString('base64')}],output_format:'png'});}
async function host(root:string,provider:ImageProvider,model:string){const gateway=await createGateway({dataDir:root,provider});await listenLoopback(gateway.server);return {gateway,client:new GatewayClient(`http://127.0.0.1:${(gateway.server.address() as any).port}`,model)};}
async function settled(client:GatewayClient,id:string){for(let i=0;i<100;i++){const status=await client.status(id);if(!['queued','running'].includes(status.state))return status;await new Promise(r=>setTimeout(r,10));}throw Error('Local provider did not settle');}

test('Comfy context asset keeps source first, guide second and direct inverted LoadImage MASK alpha recovery',()=>{
  const compiled=intent('cosplay','effect','soft blue sparks',false,true,'','images',false,'selection-v1');
  const graph=buildGraph({requestId:testId,prompt:compiled.prompt,source:'source.png',guide:'guide.png',seed:42,steps:25,resolution:992});
  assert.equal(compiled.kind,'asset');assert.equal(compiled.assetContext,'selection-v1');
  assert.equal(graph['9'].inputs.image,'source.png');assert.equal(graph['10'].inputs.image,'guide.png');
  assert.deepEqual(graph['4'].inputs['images.image_1'],['12',0]);assert.deepEqual(graph['4'].inputs['images.image_2'],['10',0]);
  assert.deepEqual(graph['12'],{class_type:'JoinImageWithAlpha',inputs:{image:['9',0],alpha:['9',1]}});
  assert.equal(Object.values(graph).some(node=>node.class_type==='InvertMask'),false);assert.equal(graph['4'].inputs.resolution,0);
  assert.match(String(graph['4'].inputs.prompt),/只输出素材/);assert.doesNotMatch(String(graph['4'].inputs.prompt),/编辑 .*指定的局部|保持原画布/);
});

test('OpenAI context assets serialize source plus native feathered mask through edits and request independent transparent output',async()=>{
  for(const model of ['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-1.5'])for(const mode of ['effect','atmosphere']){
    const request={...asset(model,mode),width:992,height:992},guide=decodePng(cloudPng(992,992));
    for(let i=0;i<guide.rgba.length;i+=4)guide.rgba[i]=guide.rgba[i+1]=guide.rgba[i+2]=128;
    let body:any,url='';const provider=new OpenAIImagesProvider({apiKey:'fake',transport:async(u,init)=>{url=String(u);body=JSON.parse(String(init!.body));return inline(cloudPng(992,992,true));}});
    await provider.submit(request,[cloudPng(992,992,true),encodePng(guide)]);
    assert.equal(url,'https://api.openai.com/v1/images/edits');assert.equal(body.images.length,1);assert.ok(body.mask);
    const source=decodePng(fromDataUrl(body.images[0].image_url)),mask=decodePng(fromDataUrl(body.mask.image_url));
    assert.equal(source.width,model==='gpt-image-1.5'?1024:992);assert.equal(mask.width,source.width);assert.equal(mask.height,source.height);
    assert.equal(source.rgba[3],0);assert.equal(mask.rgba[3],127);assert.equal(body.background,'transparent');assert.equal(body.output_format,'png');
    assert.match(body.prompt,/independent|standalone/);assert.match(body.prompt,/only.*(asset|effect)|只输出素材/);assert.ok(body.prompt.includes('soft blue sparks'));
    assert.doesNotMatch(body.prompt,/Edit the first image|preserve its framing|编辑 .*指定的局部|保持原画布|<image[123]>/);
  }
});

test('OpenAI narrow context source and native mask share protected padding and transparent output inverse crop',async()=>{
  const request={...asset('gpt-image-1.5'),width:256,height:2048},source=decodePng(cloudPng(256,2048)),guide=decodePng(cloudPng(256,2048));
  for(let y=0;y<2048;y++)for(let x=0;x<256;x++){
    const i=(y*256+x)*4;source.rgba.set([10,20,30,255],i);const gray=y<682?0:y<1366?128:255;guide.rgba.set([gray,gray,gray,255],i);
  }
  const raw=decodePng(cloudPng(1024,1536));
  for(let y=0;y<1536;y++)for(let x=416;x<608;x++)raw.rgba.set([200,50,25,128],(y*1024+x)*4);
  let body:any;const provider=new OpenAIImagesProvider({apiKey:'fake',transport:async(_u,init)=>{body=JSON.parse(String(init!.body));return inline(encodePng(raw));}});
  const result=await provider.submit(request,[encodePng(source),encodePng(guide)]),sentSource=decodePng(fromDataUrl(body.images[0].image_url)),mask=decodePng(fromDataUrl(body.mask.image_url));
  assert.equal(body.size,'1024x1536');assert.equal(sentSource.width,1024);assert.equal(sentSource.height,1536);assert.equal(mask.width,1024);assert.equal(mask.height,1536);
  const pixel=(image:ReturnType<typeof decodePng>,x:number,y:number)=>[...image.rgba.subarray((y*image.width+x)*4,(y*image.width+x)*4+4)];
  assert.deepEqual(pixel(sentSource,415,768),[128,128,128,255]);assert.deepEqual(pixel(sentSource,416,768),[10,20,30,255]);assert.deepEqual(pixel(sentSource,607,768),[10,20,30,255]);assert.deepEqual(pixel(sentSource,608,768),[128,128,128,255]);
  assert.equal(pixel(mask,415,768)[3],255);assert.equal(pixel(mask,416,0)[3],255);assert.equal(pixel(mask,416,768)[3],127);assert.equal(pixel(mask,607,1535)[3],0);assert.equal(pixel(mask,608,1535)[3],255);
  const output=decodePng(provider.normalizeOutput(result.image,request));assert.equal(output.width,256);assert.equal(output.height,2048);
  assert.deepEqual(pixel(output,0,0),[200,50,25,128]);assert.deepEqual(pixel(output,255,2047),[200,50,25,128]);
});

test('Bailian 2.1 context assets send exact source and guide bytes with independent transparent placement semantics',async()=>{
  const source=cloudPng(512,512,true),guide=decodePng(cloudPng());for(let i=0;i<guide.rgba.length;i+=4)guide.rgba[i]=guide.rgba[i+1]=guide.rgba[i+2]=128;
  const guideBytes=encodePng(guide);
  for(const model of ['qwen-image-2.1-pro','qwen-image-2.1-turbo'])for(const mode of ['effect','atmosphere']){
    const request=asset(model,mode);let body:any;const provider=new BailianProvider({apiKey:'fake',transport:async(_u,init)=>{body=JSON.parse(String(init!.body));return Response.json({output:{task_id:testId,task_status:'PENDING'}});}});
    assert.equal((await provider.submit(request,[source,guideBytes])).taskId,testId);
    const content=body.input.messages[0].content;assert.equal(content.length,3);assert.deepEqual(fromDataUrl(content[0].image),source);assert.deepEqual(fromDataUrl(content[1].image),guideBytes);
    assert.equal(body.parameters.size,'512*512');assert.match(content[2].text,/独立.*透明|透明.*独立/);assert.match(content[2].text,/只输出素材/);assert.match(content[2].text,/白色允许放置/);assert.ok(content[2].text.includes(request.prompt));
    assert.doesNotMatch(content[2].text,/白色允许修改|黑色保留|编辑 .*指定的局部|保持原画布/);
  }
});

test('Unsupported models and incomplete contextual inputs fail before any platform request',async()=>{
  let calls=0;const transport:typeof fetch=async()=>{calls++;throw Error('Must not call the platform');};
  const bailian=new BailianProvider({apiKey:'fake',transport}),gemini=new GeminiProvider({apiKey:'fake',transport}),openai=new OpenAIImagesProvider({apiKey:'fake',transport});
  for(const model of ['qwen-image-3.0','qwen-image-3.0-pro'])await assert.rejects(bailian.submit(asset(model),[cloudPng(),cloudPng()]),/operation|context/);
  await assert.rejects(gemini.submit({...asset('gemini-2.5-flash-image'),seed:0},[cloudPng(),cloudPng()]),/operation|context|Invalid Gemini/);
  for(const provider of [openai,bailian]){
    const request=asset(provider===openai?'gpt-image-2.5-sunburst':'qwen-image-2.1-pro');
    for(const patch of [{source:undefined},{guide:undefined},{reference:`${testId}-reference.png`}])await assert.rejects(provider.submit({...request,...patch},[cloudPng(),cloudPng()]));
    await assert.rejects(provider.submit(request,[cloudPng(),cloudPng(256,512)]),/dimensions|canvas/);
  }
  assert.equal(calls,0);
});

test('Context asset opaque raw output is retained with its UUID and never fabricated or resubmitted after restart',async()=>{
  for(const providerId of ['openai','bailian']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-context-opaque-'));let posts=0;const id=uuid();
    const request=asset(providerId==='openai'?'gpt-image-2.5-sunburst':'qwen-image-2.1-pro','effect',id),raw=cloudPng(providerId==='openai'?816:512,providerId==='openai'?816:512);
    const transport:typeof fetch=async(url,init)=>{if(init?.method==='POST'){posts++;return providerId==='openai'?inline(raw):Response.json({output:{task_id:testId,task_status:'PENDING'}});}if(String(url).includes('/tasks/'))return Response.json({output:{task_id:testId,task_status:'SUCCEEDED',choices:[{message:{content:[{image:'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/result.png'}]}}]}});return new Response(new Uint8Array(raw).buffer);};
    const provider:ImageProvider=providerId==='openai'?new OpenAIImagesProvider({apiKey:'fake',transport}):new BailianProvider({apiKey:'fake',transport});let {gateway,client}=await host(root,provider,request.model);
    const record={id,clientId:uuid(),graph:{},state:'created',createdAt:new Date().toISOString(),request};
    try{
      for(const role of ['source','guide'] as const)await client.upload(cloudPng(),request[role]!);
      await client.submitJob(record);const status=providerId==='openai'?await settled(client,id):await client.status(id);assert.equal(status.state,'failed');assert.equal(status.code,'invalid-output');assert.match(status.detail??'',/raw result retained/);
      assert.deepEqual(await gateway.store.raw(id),raw);await assert.rejects(client.output({filename:id+'.png',subfolder:'',type:'output'}),/404/);
      assert.equal((await gateway.store.job(id))?.request.assetContext,'selection-v1');await gateway.close();({gateway,client}=await host(root,provider,request.model));
      assert.equal((await client.status(id)).state,'failed');await client.submitJob(record);assert.equal(posts,1);assert.deepEqual(await gateway.store.raw(id),raw);
    }finally{await gateway.close();await fs.rm(root,{recursive:true,force:true});}
  }
});

test('Context asset lost platform response retains original UUID as unknown without POST replay across restart',async()=>{
  for(const providerId of ['openai','bailian']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-context-lost-'));let posts=0,persistedBeforeCreate=false;const id=uuid(),request=asset(providerId==='openai'?'gpt-image-2.5-sunburst':'qwen-image-2.1-pro','atmosphere',id);
    const transport:typeof fetch=async()=>{posts++;const saved=JSON.parse(await fs.readFile(path.join(root,'jobs',id+'.json'),'utf8'));persistedBeforeCreate=saved.id===id&&saved.request.kind==='asset'&&saved.request.assetContext==='selection-v1'&&saved.state==='submitting';throw Error('private disconnected response');};
    const provider:ImageProvider=providerId==='openai'?new OpenAIImagesProvider({apiKey:'fake',transport}):new BailianProvider({apiKey:'fake',transport});let {gateway,client}=await host(root,provider,request.model);const record={id,clientId:uuid(),graph:{},state:'created',createdAt:new Date().toISOString(),request};
    try{
      for(const role of ['source','guide'] as const)await client.upload(cloudPng(),request[role]!);
      await client.submitJob(record);const status=providerId==='openai'?await settled(client,id):await client.status(id);assert.equal(status.state,'unknown');assert.equal(persistedBeforeCreate,true);assert.doesNotMatch(status.detail??'',/private disconnected/);
      const saved=await gateway.store.job(id);assert.equal(saved?.id,id);assert.equal(saved?.request.kind,'asset');assert.equal(saved?.request.assetContext,'selection-v1');assert.equal(saved?.providerTaskId,undefined);
      await gateway.close();({gateway,client}=await host(root,provider,request.model));assert.equal((await client.status(id)).state,'unknown');await client.submitJob(record);assert.equal(posts,1);
    }finally{await gateway.close();await fs.rm(root,{recursive:true,force:true});}
  }
});
