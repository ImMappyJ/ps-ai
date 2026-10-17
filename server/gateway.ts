import {createServer} from 'node:http';import type {IncomingMessage,ServerResponse} from 'node:http';
import {UUID,UPLOAD,validateGeneration} from '../src/gateway-protocol';
import {GatewayStore,requestFingerprint} from './store';import type {DurableJob} from './store';
import type {ImageProvider} from './provider';import {ServiceError} from './errors';
import {validateInput,normalizeBailianOutput,MAX_INPUT_BYTES} from './images';

export interface GatewayOptions {dataDir:string;provider:ImageProvider;assumeSrgb?:boolean}
function submissionError(job:DurableJob,error:unknown){
  job.state=error instanceof ServiceError&&!error.outcomeUnknown?'failed':'unknown';
  if(error instanceof ServiceError&&error.code==='invalid-output')job.code='invalid-output';
  job.detail=error instanceof ServiceError?error.message:'Platform submission interrupted; retain task ID and do not resubmit';
}
function body(req:IncomingMessage,limit:number):Promise<Uint8Array>{
  if(Number(req.headers['content-length'])>limit){req.resume();return Promise.reject(new ServiceError(413,'invalid-input','Request exceeds byte limit'));}
  return new Promise((resolve,reject)=>{let length=0;const parts:Buffer[]=[];
    const clean=()=>{req.off('data',data);req.off('end',end);req.off('error',error);};
    const data=(part:Buffer)=>{length+=part.length;if(length>limit){clean();req.resume();reject(new ServiceError(413,'invalid-input','Request exceeds byte limit'));}else parts.push(part);};
    const end=()=>{clean();resolve(new Uint8Array(Buffer.concat(parts)));};const error=()=>{clean();reject(new ServiceError(400,'invalid-input','Request body interrupted'));};
    req.on('data',data);req.on('end',end);req.on('error',error);
  });
}
function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
export async function createGateway(options:GatewayOptions){
  const store=await GatewayStore.open(options.dataDir),provider=options.provider;
  const active=new Map<string,Promise<unknown>>(),workers=new Map<string,Promise<void>>(),handlers=new Set<Promise<void>>();let closing=false;
  const providerId=provider.id??provider.capabilities().provider;
  async function exclusive<T>(id:string,run:()=>Promise<T>):Promise<T>{
    const previous=active.get(id)??Promise.resolve();const operation=previous.catch(()=>{}).then(run);active.set(id,operation);
    try{return await operation;}finally{if(active.get(id)===operation)active.delete(id);}
  }
  function publicStatus(job?:DurableJob){return !job?{state:'unknown'}:{state:job.state==='submitting'?(workers.has(job.id)?'running':'unknown'):job.state,...(job.state==='ready'?{images:[{filename:job.id+'.png',subfolder:'',type:'output'}]}:{}),...(job.detail?{detail:job.detail}:{}),...(job.code?{code:job.code}:{})};}
  async function finishImage(job:DurableJob,bytes:Uint8Array){
    let checked:Uint8Array;
    try{checked=provider.normalizeOutput?provider.normalizeOutput(bytes,job.request,options.assumeSrgb):normalizeBailianOutput(bytes,job.request,options.assumeSrgb);}
    catch{job.state='failed';job.code='invalid-output';job.detail='Platform output failed PNG/color/depth/dimensions/transparency validation; raw result retained on server';await store.save(job);return;}
    // Storage failures are retryable; do not classify them as an invalid paid result.
    await store.image(job.id,checked);job.state='ready';delete job.detail;await store.save(job);
  }
  async function runInline(job:DurableJob,images:Uint8Array[]){
    try{
      const result=await provider.submit(job.request,images);
      if(!('image' in result))throw new Error('Inline adapter returned a remote task');
      await store.image(job.id,result.image,true);
      await exclusive(job.id,()=>finishImage(job,result.image));
    }catch(error){
      await exclusive(job.id,async()=>{submissionError(job,error);await store.save(job);});
    }
  }
  async function submit(value:any){
    if(!UUID.test(value?.id)||!UUID.test(value?.clientId))throw new ServiceError(400,'invalid-input','Invalid task identity');
    let request;try{request=validateGeneration(value.request,provider.capabilities());}catch(error){throw new ServiceError(400,'invalid-input',error instanceof Error?error.message:'Invalid generation request');}
    const fingerprint=requestFingerprint(value.clientId,request);
    return exclusive(value.id,async()=>{
      const existing=await store.job(value.id);
      if(existing){if(existing.fingerprint!==fingerprint||(existing.providerId??'bailian')!==providerId)throw new ServiceError(409,'conflict','This UUID belongs to a different request or provider');return existing;}
      if(!provider.configured)throw new ServiceError(401,'authentication','Server platform API key is not configured');
      const images:Uint8Array[]=[];
      for(const key of ['source','guide','reference'] as const){const name=request[key];if(!name)continue;
        if(name!==`${value.id}-${key}.png`)throw new ServiceError(400,'invalid-input','Input belongs to another task or role');
        const bytes=await store.input(name),image=validateInput(bytes);
        if((key==='source'||key==='guide')&&(image.width!==request.width||image.height!==request.height))throw new ServiceError(400,'invalid-input','Input dimensions differ from the requested canvas');images.push(bytes);
      }
      const job:DurableJob={id:value.id,clientId:value.clientId,fingerprint,request,providerId,providerBaseUrl:provider.baseUrl,state:'submitting',createdAt:new Date().toISOString()};
      await store.save(job); // Commit identity before the only upstream creation attempt.
      if(provider.execution==='inline'){
        const work=runInline(job,images);workers.set(job.id,work);void work.catch(()=>{}).finally(()=>workers.delete(job.id));return job;
      }
      try{const created=await provider.submit(request,images);if(!('taskId' in created))throw new Error('Task adapter returned inline data');job.providerTaskId=created.taskId;job.state='queued';}
      catch(error){submissionError(job,error);}
      await store.save(job);return job;
    });
  }
  async function status(id:string){return exclusive(id,async()=>{
    const job=await store.job(id);
    if(!job||['ready','failed','cancelled'].includes(job.state))return publicStatus(job);
    if(job.providerBaseUrl!==provider.baseUrl||(job.providerId??'bailian')!==providerId)throw new ServiceError(409,'configuration','Task belongs to a different platform or region/workspace; restore its server configuration');
    const raw=await store.raw(job.id);if(raw){await finishImage(job,raw);return publicStatus(job);}
    if(!job.providerTaskId)return publicStatus(job);
    if(!provider.poll||!provider.download)throw new ServiceError(409,'configuration','Adapter cannot resume this remote task');
    const result=await provider.poll(job.providerTaskId);
    if(result.state==='ready'){
      const bytes=await provider.download(result.imageUrl!);await store.image(id,bytes,true);await finishImage(job,bytes);return publicStatus(job);
    }else{job.state=result.state;job.detail=result.detail;}
    await store.save(job);return publicStatus(job);
  });}
  const server=createServer((req,res)=>{const handler=(async()=>{
    if(closing)throw new ServiceError(503,'connection','Gateway is shutting down; recover the original task ID');
    const port=(server.address() as any)?.port;
    if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host??'')||(req.headers.origin&&req.headers.origin!=='null'))throw new ServiceError(403,'forbidden','This gateway accepts local plugin requests only');
    const route=req.url??'';
    if(req.method==='GET'&&route==='/psai/v1/capabilities'){json(res,200,provider.capabilities());return;}
    const input=route.match(/^\/psai\/v1\/uploads\/([^/]+)$/);
    if(req.method==='PUT'&&input){
      if(!UPLOAD.test(input[1])||req.headers['content-type']!=='image/png')throw new ServiceError(400,'invalid-input','Expected task PNG upload');
      const bytes=await body(req,MAX_INPUT_BYTES);try{validateInput(bytes);}catch{throw new ServiceError(400,'invalid-input','Invalid sRGB8 PNG input');}
      await exclusive(input[1],()=>store.upload(input[1],bytes));json(res,200,{name:input[1]});return;
    }
    if(req.method==='POST'&&route==='/psai/v1/jobs'){
      if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??''))throw new ServiceError(415,'invalid-input','Expected application/json');
      const bytes=await body(req,64*1024);let value:any;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ServiceError(400,'invalid-input','Invalid request JSON');}
      const job=await submit(value);json(res,202,{id:job.id,state:job.state});return;
    }
    const task=route.match(/^\/psai\/v1\/jobs\/([0-9a-f-]{36})(\/cancel)?$/);
    if(task&&UUID.test(task[1])){
      if(req.method==='GET'&&!task[2]){json(res,200,await status(task[1]));return;}
      if(req.method==='POST'&&task[2]){await body(req,1024);json(res,200,{cancelled:false,detail:'Stop future candidates; the current platform request continues'});return;}
    }
    const output=route.match(/^\/psai\/v1\/outputs\/([0-9a-f-]{36})\.png$/);
    if(req.method==='GET'&&output&&UUID.test(output[1])){
      const job=await store.job(output[1]);if(job?.state!=='ready')throw new ServiceError(404,'not-found','No completed output for this task');
      const bytes=await store.output(output[1]);res.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
    }
    throw new ServiceError(404,'not-found','Unknown PS-AI gateway route');
  })().catch(error=>{if(!res.headersSent)json(res,error instanceof ServiceError?error.status:500,{code:error instanceof ServiceError?error.code:'internal',message:error instanceof ServiceError?error.message:'Internal gateway error; private details were not returned'});else res.destroy();});handlers.add(handler);void handler.finally(()=>handlers.delete(handler)).catch(()=>{});});
  server.requestTimeout=15000;server.headersTimeout=10000;
  let closePromise:Promise<void>|undefined;
  return {server,store,close(){return closePromise??=(async()=>{
    closing=true;
    if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    // Disconnected handlers can still persist a submission and create workers.
    // Drain them first, then workers and their final serialized writes.
    while(handlers.size)await Promise.allSettled([...handlers]);
    while(workers.size)await Promise.allSettled([...workers.values()]);
    while(active.size)await Promise.allSettled([...active.values()]);
    await store.close();
  })();}};
}
