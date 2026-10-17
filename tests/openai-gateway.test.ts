import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createGateway} from '../server/http/gateway';import {OpenAIImagesProvider,openAIFrame} from '../server/providers/openai';
import {GatewayClient} from '../src/gateway-client';import {uuid} from '../src/client';import {decodePng} from '../src/image';
import {cloudPng,cloudRequest} from './gateway-fixtures';
import {listenLoopback} from './loopback';

async function start(root:string,provider:OpenAIImagesProvider){const g=await createGateway({dataDir:root,provider});await listenLoopback(g.server);return {g,client:new GatewayClient(`http://127.0.0.1:${(g.server.address() as any).port}`,'gpt-image-2.5-sunburst')};}
function record(){return {id:uuid(),clientId:uuid(),graph:{},state:'created',createdAt:new Date().toISOString(),request:{...cloudRequest,model:'gpt-image-2.5-sunburst',seed:0}};}
async function terminal(client:GatewayClient,id:string){for(let i=0;i<100;i++){const status=await client.status(id);if(status.state!=='queued'&&status.state!=='running')return status;await new Promise(r=>setTimeout(r,10));}throw Error('Local mock provider did not settle');}

test('OpenAI真实本机HTTP链路：并发同UUID只调用一次，结果逆映射并可重启读取',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-openai-http-'));let calls=0,release!:(r:Response)=>void;
  const provider=new OpenAIImagesProvider({apiKey:'fake-openai-key',transport:async()=>{calls++;return new Promise(r=>{release=r;});}});let {g,client}=await start(root,provider);const job=record();
  try{await Promise.all([client.submitJob(job),client.submitJob(job)]);assert.equal(calls,1);assert.equal((await client.status(job.id)).state,'running');const box=openAIFrame(job.request);release(Response.json({data:[{b64_json:Buffer.from(cloudPng(box.canvasWidth,box.canvasHeight)).toString('base64')}]}));const status=await terminal(client,job.id);assert.equal(status.state,'ready');const out=decodePng(await client.output(status.images![0]));assert.equal(out.width,512);assert.equal(out.height,512);const durable=await g.store.job(job.id);assert.equal(durable?.providerId,'openai');assert.equal(durable?.providerTaskId,undefined);assert.doesNotMatch(JSON.stringify(durable),/fake-openai-key/);
    await g.close();({g,client}=await start(root,provider));assert.equal((await client.status(job.id)).state,'ready');await client.submitJob(job);assert.equal(calls,1);
  }finally{release?.(Response.json({data:[]}));await g.close();await fs.rm(root,{recursive:true,force:true});}
});

test('OpenAI真实上传到编辑：辅助图成为同尺寸蒙版，补边保留、来源和参考不串位',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-openai-edit-'));let calls=0;const job=record(),request={...job.request,kind:'edit' as const,mode:'reference',width:768,height:512,source:`${job.id}-source.png`,guide:`${job.id}-guide.png`,reference:`${job.id}-reference.png`},box=openAIFrame(request);
  const provider=new OpenAIImagesProvider({apiKey:'fake',transport:async(url,init)=>{calls++;assert.ok(String(url).endsWith('/images/edits'));const body=JSON.parse(String(init!.body)),png=(v:string)=>decodePng(new Uint8Array(Buffer.from(v.split(',')[1],'base64')));assert.equal(body.images.length,2);assert.equal(png(body.images[0].image_url).width,box.canvasWidth);assert.equal(png(body.images[1].image_url).width,512);const mask=png(body.mask.image_url);assert.equal(mask.width,box.canvasWidth);assert.equal(mask.height,box.canvasHeight);assert.equal(mask.rgba[3],255);assert.equal(mask.rgba[((box.top*box.canvasWidth+box.left)*4)+3],0);return Response.json({data:[{b64_json:Buffer.from(cloudPng(box.canvasWidth,box.canvasHeight)).toString('base64')}]});}});const {g,client}=await start(root,provider);
  try{for(const role of ['source','guide','reference'] as const)await client.upload(role==='reference'?cloudPng():cloudPng(768,512),request[role]);await client.submitJob({...job,request});const status=await terminal(client,job.id);assert.equal(status.state,'ready');const out=decodePng(await client.output(status.images![0]));assert.equal(out.width,768);assert.equal(out.height,512);assert.equal(calls,1);}finally{await g.close();await fs.rm(root,{recursive:true,force:true});}
});

test('OpenAI明确拒绝与提交断线通过HTTP持久化为不同状态，重启均不重发旧UUID',async()=>{
  for(const uncertain of [false,true]){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-openai-outcome-'));let calls=0;const provider=new OpenAIImagesProvider({apiKey:'fake',transport:async()=>{calls++;if(uncertain)throw Error('private connection detail');return Response.json({data:[]});}});let {g,client}=await start(root,provider);const job=record();
    try{await client.submitJob(job);const status=await terminal(client,job.id);assert.equal(status.state,uncertain?'unknown':'failed');assert.doesNotMatch(status.detail??'',/private connection detail/);await g.close();({g,client}=await start(root,provider));assert.equal((await client.status(job.id)).state,status.state);await client.submitJob(job);assert.equal(calls,1);}finally{await g.close();await fs.rm(root,{recursive:true,force:true});}
  }
});
