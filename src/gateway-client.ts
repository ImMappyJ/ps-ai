import {HttpError} from './client';
import type {Status,OutputFile} from './client';
import type {JobRecord} from './jobs';
import {normalizeBaseUrl} from './profile';
import {GATEWAY_PROTOCOL,UUID,UPLOAD,validateCapabilities,validateGeneration} from './gateway-protocol';
import type {GatewayCapabilities} from './gateway-protocol';

export class GatewayClient {
  readonly base:string;
  capabilities?:GatewayCapabilities;
  constructor(base:string,public model:string,private transport:typeof fetch=fetch,private timeoutMs=30000){this.base=normalizeBaseUrl(base);}
  private async request(path:string,init?:RequestInit,binary=false):Promise<any>{
    const controller=typeof AbortController==='function'?new AbortController():undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      return await Promise.race([
        (async()=>{const r=await this.transport(this.base+'/psai/v1'+path,{...init,signal:controller?.signal});
          if(!r.ok){const body=await r.text();throw new HttpError(r.status,`PS-AI gateway ${r.status}: ${body.slice(0,1500)}`);}
          return binary?new Uint8Array(await r.arrayBuffer()):await r.json();})(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(new Error('Gateway request timed out; recover the saved task ID'));},this.timeoutMs);})
      ]);
    }finally{if(timer)clearTimeout(timer);}
  }
  async connect():Promise<GatewayCapabilities>{this.capabilities=validateCapabilities(await this.request('/capabilities'));return this.capabilities;}
  async check(depth:8|16=8):Promise<{stats:unknown;nodeInfo:Record<string,any>;capabilities:GatewayCapabilities}>{
    const capabilities=await this.connect();
    if(!capabilities.models.some(m=>m.id===this.model))throw new Error('Gateway model is unavailable');
    if(depth!==8)throw new Error('Gateway supports 8-bit output only');
    if(!capabilities.configured)throw new Error(capabilities.provider==='bailian'?'百炼服务未配置 DASHSCOPE_API_KEY；请在服务端设置后重启':capabilities.provider==='gemini'?'Gemini 服务未配置 GEMINI_API_KEY；请在服务端设置后重启':capabilities.provider==='openai'?'OpenAI 服务未配置 OPENAI_API_KEY；请在服务端设置后重启':'平台服务未配置 API Key；请在服务端设置后重启');
    return {stats:{protocol:GATEWAY_PROTOCOL,provider:capabilities.provider},nodeInfo:{},capabilities};
  }
  async upload(bytes:Uint8Array,name:string):Promise<string>{
    if(!UPLOAD.test(name))throw new Error('Invalid gateway input name');
    const r=await this.request(`/uploads/${name}`,{method:'PUT',headers:{'Content-Type':'image/png'},body:new Uint8Array(bytes).buffer});
    if(r.name!==name)throw new Error('Gateway returned a different input name');return name;
  }
  async submitJob(record:JobRecord):Promise<string>{
    if(!UUID.test(record.id)||!UUID.test(record.clientId))throw new Error('Invalid gateway job ID');
    const request=validateGeneration(record.request,this.capabilities??await this.connect());
    const result=await this.request('/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:record.id,clientId:record.clientId,request})});
    if(result.id!==record.id)throw new Error('Gateway returned a different task ID; retain the saved record');return record.id;
  }
  async status(id:string):Promise<Status>{
    if(!UUID.test(id))throw new Error('Invalid gateway job ID');
    const r=await this.request(`/jobs/${id}`);
    if(!['queued','running','ready','failed','cancelled','unknown'].includes(r.state))throw new Error('Invalid gateway job state');
    if(r.state==='ready'&&(!Array.isArray(r.images)||r.images.length!==1||r.images[0].filename!==`${id}.png`||r.images[0].subfolder!==''||r.images[0].type!=='output'))throw new Error('Invalid gateway output record');
    return {state:r.state,...(r.state==='ready'?{images:r.images}:{}),...(typeof r.detail==='string'?{detail:r.detail.slice(0,1500)}:{}),...(r.code==='invalid-output'?{code:r.code}:{})};
  }
  async output(file:OutputFile):Promise<Uint8Array>{
    if(file.type!=='output'||file.subfolder!==''||!file.filename.endsWith('.png')||!UUID.test(file.filename.slice(0,-4)))throw new Error('Invalid gateway output file');
    return this.request(`/outputs/${file.filename}`,undefined,true);
  }
  async cancel(id:string):Promise<boolean>{
    if(!UUID.test(id))throw new Error('Invalid gateway job ID');
    const r=await this.request(`/jobs/${id}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(typeof r.cancelled!=='boolean')throw new Error('Gateway did not confirm cancellation');return r.cancelled;
  }
  watch(_clientId:string,_promptId:string,_update:(value:number,max:number)=>void):()=>void{return ()=>{};}
}
