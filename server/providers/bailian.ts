import {GATEWAY_PROTOCOL,UUID,validateGeneration} from '../../src/infrastructure/backends/gateway-protocol';
import type {GatewayCapabilities,GenerationRequest} from '../../src/infrastructure/backends/gateway-protocol';
import {ServiceError,platformCode} from '../shared/errors';
import {readBounded} from '../shared/io';import {validateInput} from '../shared/images';
import type {ImageProvider,ProviderStatus} from './contract';
export interface BailianOptions {apiKey?:string;baseUrl?:string;transport?:typeof fetch;timeoutMs?:number}
export class BailianProvider implements ImageProvider {
  readonly id='bailian';readonly execution='task' as const;
  readonly baseUrl:string;readonly configured:boolean;
  private apiKey:string;private transport:typeof fetch;private timeoutMs:number;
  constructor(options:BailianOptions={}){
    const url=new URL(options.baseUrl??'https://dashscope.aliyuncs.com/api/v1');
    const host=/^(dashscope|dashscope-intl|dashscope-us)\.aliyuncs\.com$/.test(url.hostname)||/^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|us-east-1|cn-hongkong|eu-central-1|ap-northeast-1)\.maas\.aliyuncs\.com$/.test(url.hostname);
    if(url.protocol!=='https:'||!host||url.port||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='/api/v1')throw new Error('DASHSCOPE_BASE_URL must be an official HTTPS /api/v1 endpoint');
    this.baseUrl=url.origin+'/api/v1';this.apiKey=options.apiKey?.trim()??'';
    if(/[\r\n]/.test(this.apiKey)||this.apiKey.length>512)throw new Error('Invalid server API key format');
    this.configured=!!this.apiKey;this.transport=options.transport??fetch;this.timeoutMs=options.timeoutMs??25000;
  }
  capabilities():GatewayCapabilities {
    return {protocol:GATEWAY_PROTOCOL,provider:'bailian',configured:this.configured,cancellation:'none',progress:'stages',models:['qwen-image-2.1-pro','qwen-image-2.1-turbo','qwen-image-3.0','qwen-image-3.0-pro'].map(id=>({id,label:id,operations:id.startsWith('qwen-image-2.1')?['t2i','edit','asset']:['t2i','edit'],...(id.startsWith('qwen-image-2.1')?{assetContexts:['selection-v1' as const]}:{}),maxInputImages:id.startsWith('qwen-image-2.1')?10:3,outputDepths:[8],seedMax:2147483647,minPixels:512*512,maxPixels:2048*2048,maxAspectRatio:8}))};
  }
  private async perform(url:string,init:RequestInit,binary=false):Promise<any>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([
      (async()=>{
        const res=await this.transport(url,{...init,signal:controller.signal,redirect:'error'});
        if(!res.ok){
          await res.body?.cancel();
          if(res.status===401||res.status===403)throw new ServiceError(res.status,'authentication','Bailian authentication failed; verify server API key, model access and region');
          if(res.status===429)throw new ServiceError(429,'rate-limit','Bailian rate or account quota exceeded; do not resubmit an uncertain task');
          throw new ServiceError(res.status>=500?502:400,'provider-error',`Bailian HTTP ${res.status}`,res.status>=500);
        }
        const bytes=await readBounded(res,binary?32*1024*1024:1024*1024,init.method==='POST');
        if(binary)return bytes;
        let result:any;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ServiceError(502,'incompatible-api','Invalid Bailian JSON response',true);}
        if(result.code)throw new ServiceError(400,'provider-error',`Bailian ${platformCode(result.code)}`);
        return result;
      })(),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ServiceError(504,'timeout','Bailian request timed out; preserve task identity',true));},this.timeoutMs);})
    ]);}catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError(502,'connection','Bailian connection interrupted; preserve task identity',true);}
    finally{if(timer)clearTimeout(timer);}
  }
  private headers():Record<string,string>{if(!this.configured)throw new ServiceError(401,'authentication','Server DASHSCOPE_API_KEY is not configured');return {Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'};}
  async submit(request:GenerationRequest,images:Uint8Array[]):Promise<{taskId:string}>{
    const headers={...this.headers(),'X-DashScope-Async':'enable'};validateGeneration(request,this.capabilities());
    if(images.length!==[request.source,request.guide,request.reference].filter(Boolean).length)throw new ServiceError(400,'invalid-input','Input image count differs from request');
    const roles=(['source','guide','reference'] as const).filter(role=>request[role]);
    for(let i=0;i<images.length;i++){
      const image=validateInput(images[i]);
      if(roles[i]!=='reference'&&(image.width!==request.width||image.height!==request.height))throw new ServiceError(400,'invalid-input','Input canvas dimensions differ');
    }
    const contextualAsset=request.assetContext==='selection-v1';
    const labels={source:contextualAsset?'来源图，只参考位置、尺度、透视、色调和光线':'来源图',guide:contextualAsset?'素材放置范围，白色允许放置、黑色不放置、灰色表示羽化，不要画出范围图':'范围辅助，白色允许修改、黑色保留，不要画出蒙版',reference:'参考图，只参考指定内容'};
    const binding=(roles.length?roles.map((role,i)=>`<image${i+1}> 是${labels[role]}。`).join(' ')+'\n':'')+(contextualAsset?'只输出素材：生成独立可合成的透明 RGBA 特效/氛围素材，来源图中的人物和背景不进入结果。\n':'');
    const body={model:request.model,input:{messages:[{role:'user',content:[...images.map(bytes=>({image:'data:image/png;base64,'+Buffer.from(bytes).toString('base64')})),{text:binding+request.prompt}]}]},parameters:{size:`${request.width}*${request.height}`,n:1,seed:request.seed,prompt_extend:false,watermark:false}};
    const r=await this.perform(this.baseUrl+'/services/aigc/image-generation/generation',{method:'POST',headers,body:JSON.stringify(body)});
    if(!UUID.test(r.output?.task_id))throw new ServiceError(502,'incompatible-api','Bailian did not return a valid task ID; do not resubmit',true);
    return {taskId:r.output.task_id};
  }
  async poll(taskId:string):Promise<ProviderStatus>{
    if(!UUID.test(taskId))throw new ServiceError(400,'invalid-input','Invalid provider task ID');
    const r=await this.perform(this.baseUrl+`/tasks/${taskId}`,{headers:this.headers()}),o=r.output;
    if(!o||o.task_id!==taskId)throw new ServiceError(502,'incompatible-api','Bailian returned a different task ID');
    if(o.task_status==='SUCCEEDED'){
      const images=o.choices?.flatMap((c:any)=>c.message?.content??[]).filter((c:any)=>typeof c.image==='string');
      if(!images||images.length!==1)throw new ServiceError(502,'invalid-output','Bailian task has no single image result');return {state:'ready',imageUrl:images[0].image};
    }
    if(o.task_status==='FAILED')return {state:'failed',detail:`Bailian task failed: ${platformCode(o.code)}`};
    const state:Record<string,ProviderStatus['state']>={PENDING:'queued',RUNNING:'running',CANCELED:'cancelled',UNKNOWN:'unknown'};
    if(!state[o.task_status])throw new ServiceError(502,'incompatible-api','Unknown Bailian task status');return {state:state[o.task_status]};
  }
  async download(url:string):Promise<Uint8Array>{
    const u=new URL(url);
    if(u.protocol!=='https:'||u.port||u.username||u.password||!/^[-a-z0-9]+\.oss-[-a-z0-9]+\.aliyuncs\.com$/.test(u.hostname))throw new ServiceError(502,'invalid-output','Untrusted provider output URL');
    return this.perform(u.href,{},true);
  }
}
