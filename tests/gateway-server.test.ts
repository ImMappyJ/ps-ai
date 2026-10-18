import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {GatewayClient} from '../src/infrastructure/backends/gateway-client';import {uuid} from '../src/infrastructure/backends/client';
import {cloudRequest,cloudPng,testId} from './gateway-fixtures';
import type {ImageProvider} from '../server/providers/contract';
import {ServiceError} from '../server/shared/errors';
import {request as httpRequest} from 'node:http';
import {listenLoopback} from './loopback';

async function fixture(options:{root?:string;configured?:boolean;loseSubmit?:boolean;inlineError?:ServiceError}={}){
  const {createGateway}=await import('../server/http/gateway');const {BailianProvider}=await import('../server/providers/bailian');
  const root=options.root??await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-gateway-'));let submits=0,ready=false;
  const cap=new BailianProvider({apiKey:options.configured===false?undefined:'fake-key'}).capabilities();
  const provider={baseUrl:'https://dashscope.aliyuncs.com/api/v1',execution:options.inlineError?'inline' as const:'task' as const,configured:cap.configured,capabilities:()=>cap,
    async submit(){submits++;if(options.inlineError)throw options.inlineError;if(options.loseSubmit)throw new Error('lost response containing fake-key');return {taskId:testId};},
    async poll(){return ready?{state:'ready' as const,imageUrl:'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/a.png'}:{state:'queued' as const};},
    async download(){return cloudPng();}};
  const gateway=await createGateway({dataDir:root,provider});await listenLoopback(gateway.server);
  const port=(gateway.server.address() as any).port,base=`http://127.0.0.1:${port}`,client=new GatewayClient(base,'qwen-image-2.1-pro');
  return {root,base,client,provider,gateway,submits:()=>submits,ready:()=>{ready=true;},record:(id=uuid())=>({id,clientId:uuid(),graph:{},request:{...cloudRequest},state:'created',createdAt:new Date().toISOString()}),close:async(remove=true)=>{await gateway.close();if(remove)await fs.rm(root,{recursive:true,force:true});}};
}

test('真实 HTTP 网关缺 Key 时可读健康能力，禁止提交和跨站请求',async()=>{
  const s=await fixture({configured:false});try{
    assert.equal((await s.client.connect()).configured,false);await assert.rejects(s.client.submitJob(s.record()),/401/);assert.equal(s.submits(),0);
    const cross=await fetch(s.base+'/psai/v1/capabilities',{headers:{Origin:'https://other.example'}});assert.equal(cross.status,403);
    assert.doesNotMatch(await cross.text(),/fake-key/);
  }finally{await s.close();}
});
test('同 UUID 并发提交只创建一次平台任务，冲突请求拒绝，密钥不入持久化',async()=>{
  const s=await fixture();try{
    const record=s.record();await Promise.all([s.client.submitJob(record),s.client.submitJob(record)]);assert.equal(s.submits(),1);
    await assert.rejects(s.client.submitJob({...record,request:{...record.request,seed:43}}),/409/);
    const saved=JSON.parse(await fs.readFile(path.join(s.root,'jobs',record.id+'.json'),'utf8'));assert.equal(saved.providerTaskId,testId);assert.doesNotMatch(JSON.stringify(saved),/fake-key/);
    assert.equal(await s.client.cancel(record.id),false);assert.equal((await s.client.status(record.id)).state,'queued');
  }finally{await s.close();}
});
test('平台 ID 与候选落盘，正常重启后按原 ID 恢复，绝不重新 POST',async()=>{
  const s=await fixture();const record=s.record();await s.client.submitJob(record);await s.close(false);
  const again=await fixture({root:s.root});try{
    again.ready();const status=await again.client.status(record.id);assert.equal(status.state,'ready');assert.equal(again.submits(),0);
    const png=await again.client.output(status.images![0]);assert.ok(png.length>30);assert.ok(await fs.stat(path.join(s.root,'raw',record.id+'.png')));
    assert.equal((await again.client.status(record.id)).state,'ready');
  }finally{await again.close();}
});
test('上游提交回包丢失持久保留 unknown，重复调用和重启都不重发',async()=>{
  const s=await fixture({loseSubmit:true});const record=s.record();
  try{
    await s.client.submitJob(record);assert.equal((await s.client.status(record.id)).state,'unknown');await s.client.submitJob(record);assert.equal(s.submits(),1);
    const text=await fs.readFile(path.join(s.root,'jobs',record.id+'.json'),'utf8');assert.doesNotMatch(text,/fake-key/);
    await s.close(false);const again=await fixture({root:s.root});try{assert.equal((await again.client.status(record.id)).state,'unknown');await again.client.submitJob(record);assert.equal(again.submits(),0);}finally{await again.close();}
  }catch(error){await s.close();throw error;}
});
test('输入不可覆盖或跨任务引用，PNG 上传与编辑画布必须一致',async()=>{
  const s=await fixture();try{
    const record=s.record();const name=`${record.id}-source.png`;await s.client.upload(cloudPng(),name);
    await assert.rejects(s.client.upload(cloudPng(512,512,true),name),/409/);
    await assert.rejects(s.client.submitJob({...record,request:{...record.request,kind:'edit',mode:'edit',source:`${testId}-source.png`}}),/400/);
    const edited={...record,request:{...record.request,kind:'edit' as const,mode:'edit',source:name}};await s.client.submitJob(edited);assert.equal(s.submits(),1);
    const bad=await fetch(s.base+'/psai/v1/uploads/'+uuid()+'-source.png',{method:'PUT',headers:{'Content-Type':'image/png'},body:new Uint8Array([1,2,3])});assert.equal(bad.status,400);
    const huge=await fetch(s.base+'/psai/v1/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(70000)});assert.equal(huge.status,413);
  }finally{await s.close();}
});
test('单数据目录互斥实例，释放后可重启；未知作业不借用其他任务',async()=>{
  const s=await fixture();try{
    const {createGateway}=await import('../server/http/gateway');await assert.rejects(createGateway({dataDir:s.root,provider:s.provider}),/already|locked/i);
    assert.equal((await s.client.status(uuid())).state,'unknown');
    const r=await fetch(s.base+'/psai/v1/outputs/'+uuid()+'.png');assert.equal(r.status,404);
  }finally{await s.close();}
});

test('结果写盘暂时失败后重试原任务，保留已下载结果而不重新计费',async()=>{
  const s=await fixture();try{
    const record=s.record();await s.client.submitJob(record);s.ready();
    const original=s.gateway.store.image.bind(s.gateway.store);let fail=true,downloads=0;
    s.provider.download=async()=>{downloads++;if(downloads>1)throw new Error('download URL expired');return cloudPng();};
    s.gateway.store.image=async(id,bytes,raw=false)=>{if(!raw&&fail){fail=false;throw new Error('disk temporarily unavailable');}return original(id,bytes,raw);};
    await assert.rejects(s.client.status(record.id),/500/);
    assert.equal((await s.client.status(record.id)).state,'ready');assert.equal(s.submits(),1);assert.equal(downloads,1);
  }finally{await s.close();}
});

test('同步平台在后台执行，提交立即返回；同UUID不重复调用，原始结果可重启恢复',async()=>{
  const {createGateway}=await import('../server/http/gateway');const {GeminiProvider}=await import('../server/providers/gemini');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-inline-'));let release!:(v:{image:Uint8Array})=>void,calls=0;
  const provider:ImageProvider={...new GeminiProvider(),baseUrl:'https://generativelanguage.googleapis.com/v1',id:'gemini',execution:'inline',configured:true,capabilities:()=>new GeminiProvider({apiKey:'fake'}).capabilities(),submit:async()=>{calls++;return new Promise(r=>{release=r;});},normalizeOutput:(bytes,request)=>new GeminiProvider().normalizeOutput(bytes,request)};
  let gateway=await createGateway({dataDir:root,provider});await listenLoopback(gateway.server);
  let base=`http://127.0.0.1:${(gateway.server.address() as any).port}`,client=new GatewayClient(base,'gemini-2.5-flash-image');
  const record:any={id:uuid(),clientId:uuid(),graph:{},request:{...cloudRequest,model:'gemini-2.5-flash-image',seed:0},state:'created',createdAt:new Date().toISOString()};
  try{
    await client.submitJob(record);assert.equal((await client.status(record.id)).state,'running');await client.submitJob(record);assert.equal(calls,1);
    const original=gateway.store.image.bind(gateway.store);gateway.store.image=async(id,bytes,raw=false)=>{if(!raw)throw new Error('disk busy');return original(id,bytes,raw);};
    release({image:cloudPng(1024,1024)});for(let i=0;i<50&&!await gateway.store.raw(record.id);i++)await new Promise(r=>setTimeout(r,10));
    await gateway.close();gateway=await createGateway({dataDir:root,provider});await listenLoopback(gateway.server);base=`http://127.0.0.1:${(gateway.server.address() as any).port}`;client=new GatewayClient(base,'gemini-2.5-flash-image');
    const status=await client.status(record.id);assert.equal(status.state,'ready');assert.equal(calls,1);assert.equal((await gateway.store.job(record.id))?.providerTaskId,undefined);assert.ok((await client.output(status.images![0])).length);
  }finally{release?.({image:cloudPng(1024,1024)});await gateway.close();await fs.rm(root,{recursive:true,force:true});}
});

test('恢复或重提不能偷换同一作业的提供方',async()=>{
  const {createGateway}=await import('../server/http/gateway');const s=await fixture();
  try{
    const record=s.record();await s.client.submitJob(record);await s.gateway.close();
    const changed={...s.provider,id:'gemini',baseUrl:s.provider.baseUrl};const gateway=await createGateway({dataDir:s.root,provider:changed});await listenLoopback(gateway.server);
    try{const client=new GatewayClient(`http://127.0.0.1:${(gateway.server.address() as any).port}`,'qwen-image-2.1-pro');await assert.rejects(client.status(record.id),/409/);await assert.rejects(client.submitJob(record),/409/);assert.equal(s.submits(),1);}finally{await gateway.close();}
  }finally{await fs.rm(s.root,{recursive:true,force:true});}
});

test('同步平台明确无图是失败，断线才是不确定；两者都不会重发旧UUID',async()=>{
  for(const uncertain of [false,true]){
    const s=await fixture({inlineError:new ServiceError(502,uncertain?'connection':'invalid-output',uncertain?'Outcome unknown':'No PNG image',uncertain)});const record=s.record();
    try{await s.client.submitJob(record);let status;for(let i=0;i<100;i++){status=await s.client.status(record.id);if(status.state!=='running')break;await new Promise(r=>setTimeout(r,10));}assert.equal(status!.state,uncertain?'unknown':'failed');if(!uncertain)assert.equal(status!.code,'invalid-output');await s.client.submitJob(record);assert.equal(s.submits(),1);}finally{await s.close();}
  }
});

test('提交断开且首次落盘未完成时正常关闭，仍等待后续同步工作并持有数据锁',async()=>{
  const {createGateway}=await import('../server/http/gateway');const {BailianProvider}=await import('../server/providers/bailian');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-shutdown-'));
  let releaseSave!:()=>void,seenSave!:()=>void,seenProvider!:()=>void,releaseProvider!:(r:{image:Uint8Array})=>void;
  const saved=new Promise<void>(r=>{seenSave=r;}),saveGate=new Promise<void>(r=>{releaseSave=r;}),started=new Promise<void>(r=>{seenProvider=r;});let closed=false;
  const provider:ImageProvider={id:'bailian',execution:'inline',baseUrl:'https://dashscope.aliyuncs.com/api/v1',configured:true,capabilities:()=>new BailianProvider({apiKey:'fake'}).capabilities(),submit:async()=>{seenProvider();return new Promise(r=>{releaseProvider=r;});}};
  const g=await createGateway({dataDir:root,provider});const original=g.store.save.bind(g.store);let first=true;g.store.save=async job=>{if(first){first=false;seenSave();await saveGate;}return original(job);};
  await listenLoopback(g.server);const id=uuid(),port=(g.server.address() as any).port;
  const req=httpRequest(`http://127.0.0.1:${port}/psai/v1/jobs`,{method:'POST',headers:{'Content-Type':'application/json'}});req.on('error',()=>{});req.end(JSON.stringify({id,clientId:uuid(),request:cloudRequest}));
  let closing:Promise<void>|undefined;
  try{await saved;req.destroy();await new Promise(r=>setTimeout(r,20));closing=g.close().then(()=>{closed=true;});releaseSave();await started;await new Promise(r=>setTimeout(r,30));assert.equal(closed,false,'shutdown must wait for a worker created by a disconnected handler');assert.ok(await fs.stat(path.join(root,'gateway.lock')));releaseProvider({image:cloudPng()});await closing;assert.equal(JSON.parse(await fs.readFile(path.join(root,'jobs',id+'.json'),'utf8')).state,'ready');await assert.rejects(fs.stat(path.join(root,'gateway.lock')));}finally{releaseSave();releaseProvider?.({image:cloudPng()});await closing;await g.close();for(let i=0;i<100;i++){const j=JSON.parse(await fs.readFile(path.join(root,'jobs',id+'.json'),'utf8'));if(j.state==='ready')break;await new Promise(r=>setTimeout(r,10));}await fs.rm(root,{recursive:true,force:true});}
});

test('实际百炼适配器创建响应预算丢失平台ID时，HTTP网关保留unknown与去重保护',async()=>{
  const {createGateway}=await import('../server/http/gateway');const {BailianProvider}=await import('../server/providers/bailian');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-accepted-response-'));let calls=0;
  const provider=new BailianProvider({apiKey:'fake',transport:async()=>{calls++;return Response.json({output:{task_id:testId}},{headers:{'Content-Length':'1048577'}});}});
  const g=await createGateway({dataDir:root,provider});await listenLoopback(g.server);const client=new GatewayClient(`http://127.0.0.1:${(g.server.address() as any).port}`,'qwen-image-2.1-pro'),record:any={id:uuid(),clientId:uuid(),graph:{},request:cloudRequest,state:'created',createdAt:new Date().toISOString()};
  try{await client.submitJob(record);assert.equal((await client.status(record.id)).state,'unknown');await client.submitJob(record);assert.equal(calls,1);assert.equal((await g.store.job(record.id))?.providerTaskId,undefined);}finally{await g.close();await fs.rm(root,{recursive:true,force:true});}
});
