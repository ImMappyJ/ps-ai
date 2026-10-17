import fs from 'node:fs/promises';import type {FileHandle} from 'node:fs/promises';
import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {UUID,UPLOAD} from '../src/gateway-protocol';import type {GenerationRequest} from '../src/gateway-protocol';
import {ServiceError} from './errors';
export interface DurableJob {
  id:string;clientId:string;fingerprint:string;request:GenerationRequest;providerBaseUrl:string;providerId?:string;
  state:'submitting'|'queued'|'running'|'ready'|'failed'|'cancelled'|'unknown';
  providerTaskId?:string;detail?:string;code?:'invalid-output';createdAt:string;
}
export class GatewayStore {
  private constructor(readonly root:string,private lock:FileHandle){}
  static async open(directory:string):Promise<GatewayStore>{
    await fs.mkdir(directory,{recursive:true,mode:0o700});const root=await fs.realpath(directory);
    let handle:FileHandle;try{handle=await fs.open(path.join(root,'gateway.lock'),'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Gateway data directory is already locked; stop the other instance, or remove the lock only after confirming its process has exited');throw error;}
    const store=new GatewayStore(root,handle);
    try{
      await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
      for(const folder of ['jobs','inputs','outputs','raw']){const target=path.join(root,folder);await fs.mkdir(target,{recursive:true,mode:0o700});if((await fs.lstat(target)).isSymbolicLink())throw new Error('Gateway data subdirectories cannot be symbolic links');}
      for(const file of await fs.readdir(path.join(root,'jobs'))){if(!/^[0-9a-f-]{36}\.json$/.test(file))continue;const job=await store.job(file.slice(0,-5));if(job?.state==='submitting'&&!job.providerTaskId){job.state='unknown';job.detail='Service restarted during submission; do not submit this task again';await store.save(job);}}
      return store;
    }catch(error){await store.close();throw error;}
  }
  async close(){await this.lock.close();await fs.unlink(path.join(this.root,'gateway.lock'));}
  private async atomic(file:string,bytes:string|Uint8Array){const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600,flush:true});try{await fs.rename(temp,file);}catch(error){await fs.unlink(temp).catch(()=>{});throw error;}}
  async job(id:string):Promise<DurableJob|undefined>{
    if(!UUID.test(id))throw new ServiceError(400,'invalid-input','Invalid task ID');
    let raw:string;try{raw=await fs.readFile(path.join(this.root,'jobs',id+'.json'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    const job=JSON.parse(raw) as DurableJob;
    if(job.id!==id||!UUID.test(job.clientId)||!['submitting','queued','running','ready','failed','cancelled','unknown'].includes(job.state))throw new Error('Corrupt persisted gateway task');return job;
  }
  async save(job:DurableJob){if(!UUID.test(job.id))throw new Error('Invalid task ID');await this.atomic(path.join(this.root,'jobs',job.id+'.json'),JSON.stringify(job,null,2));}
  async input(name:string):Promise<Uint8Array>{if(!UPLOAD.test(name))throw new ServiceError(400,'invalid-input','Invalid input name');try{return new Uint8Array(await fs.readFile(path.join(this.root,'inputs',name)));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new ServiceError(400,'invalid-input','Task input has not been uploaded');throw error;}}
  async upload(name:string,bytes:Uint8Array){
    if(!UPLOAD.test(name))throw new ServiceError(400,'invalid-input','Invalid input name');
    const target=path.join(this.root,'inputs',name);
    try{await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const current=await fs.readFile(target);if(!current.equals(Buffer.from(bytes)))throw new ServiceError(409,'conflict','Task inputs are immutable');}
  }
  async image(id:string,bytes:Uint8Array,raw=false){if(!UUID.test(id))throw new Error('Invalid task ID');await this.atomic(path.join(this.root,raw?'raw':'outputs',id+'.png'),bytes);}
  async raw(id:string):Promise<Uint8Array|undefined>{if(!UUID.test(id))throw new Error('Invalid task ID');try{return new Uint8Array(await fs.readFile(path.join(this.root,'raw',id+'.png')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
  async output(id:string):Promise<Uint8Array>{if(!UUID.test(id))throw new ServiceError(400,'invalid-input','Invalid task ID');return new Uint8Array(await fs.readFile(path.join(this.root,'outputs',id+'.png')));}
}
export function requestFingerprint(clientId:string,request:GenerationRequest):string{return createHash('sha256').update(JSON.stringify([clientId,request])).digest('hex');}
