import {UUID,validateGeneration} from '../../src/infrastructure/backends/gateway-protocol';
import {GatewayStore,requestFingerprint} from '../persistence/job-store';
import type {DurableJob} from '../persistence/job-store';
import type {ImageProvider} from '../providers/contract';
import {ServiceError} from '../shared/errors';
import {validateInput,normalizeOutput} from '../shared/images';

export interface JobServiceOptions {dataDir:string;provider:ImageProvider;assumeSrgb?:boolean}

function submissionError(job:DurableJob,error:unknown){
  job.state=error instanceof ServiceError&&!error.outcomeUnknown?'failed':'unknown';
  if(error instanceof ServiceError&&error.code==='invalid-output')job.code='invalid-output';
  job.detail=error instanceof ServiceError?error.message:'Platform submission interrupted; retain task ID and do not resubmit';
}

// Owns task state and platform work, independent of incoming HTTP connections.
export async function createJobService(options:JobServiceOptions){
  const store=await GatewayStore.open(options.dataDir),provider=options.provider;
  const active=new Map<string,Promise<unknown>>(),workers=new Map<string,Promise<void>>();
  const providerId=provider.id??provider.capabilities().provider;
  async function exclusive<T>(id:string,run:()=>Promise<T>):Promise<T>{
    const previous=active.get(id)??Promise.resolve();const operation=previous.catch(()=>{}).then(run);active.set(id,operation);
    try{return await operation;}finally{if(active.get(id)===operation)active.delete(id);}
  }
  function publicStatus(job?:DurableJob){return !job?{state:'unknown'}:{state:job.state==='submitting'?(workers.has(job.id)?'running':'unknown'):job.state,...(job.state==='ready'?{images:[{filename:job.id+'.png',subfolder:'',type:'output'}]}:{}),...(job.detail?{detail:job.detail}:{}),...(job.code?{code:job.code}:{})};}
  async function finishImage(job:DurableJob,bytes:Uint8Array){
    let checked:Uint8Array;
    try{checked=provider.normalizeOutput?provider.normalizeOutput(bytes,job.request,options.assumeSrgb):normalizeOutput(bytes,job.request,options.assumeSrgb);}
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

  async function upload(name:string,bytes:Uint8Array){
    try{validateInput(bytes);}catch{throw new ServiceError(400,'invalid-input','Invalid sRGB8 PNG input');}
    await exclusive(name,()=>store.upload(name,bytes));
  }
  async function output(id:string){
    const job=await store.job(id);
    if(job?.state!=='ready')throw new ServiceError(404,'not-found','No completed output for this task');
    return store.output(id);
  }
  async function drain(){
    while(workers.size)await Promise.allSettled([...workers.values()]);
    while(active.size)await Promise.allSettled([...active.values()]);
  }
  // The transport owner must stop/drain incoming handlers before drain(), and
  // close this store afterwards. A disconnected handler can still start work.
  return {store,capabilities:()=>provider.capabilities(),submit,status,upload,output,drain};
}
