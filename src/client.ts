import type {Graph} from './workflow';import {DEFAULT_MODELS,validateModels,ModelFiles,normalizeBaseUrl} from './profile';
export interface OutputFile {filename:string;subfolder:string;type:string}
export type Status={state:'queued'|'running'|'ready'|'failed'|'cancelled'|'unknown';images?:OutputFile[];detail?:string};
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
export function uuid():string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return(c==='x'?r:(r&3)|8).toString(16);});
}
export class ComfyClient {
  private models:ModelFiles;
  constructor(public base='http://localhost:8188',private transport:typeof fetch=fetch,private timeoutMs=30000,models:ModelFiles=DEFAULT_MODELS) {
    this.base=normalizeBaseUrl(base);
    this.models=validateModels(models);
  }
  private async request<T>(path:string,init:RequestInit|undefined,consume:(response:Response)=>Promise<T>):Promise<T> {
    const controller=typeof AbortController==='function'?new AbortController():undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(new Error('请求超时；已提交任务请按 ID 恢复'));},this.timeoutMs);});
      const read=async()=>{
        const res=await this.transport(this.base+path,{...init,signal:controller?.signal});
        if(!res.ok)throw new HttpError(res.status,`ComfyUI ${res.status}: ${(await res.text()).slice(0,1500)}`);
        return consume(res);
      };
      return await Promise.race([read(),timeout]);
    } finally {if(timer)clearTimeout(timer);}
  }
  private async json(path:string,body?:unknown):Promise<any> {
    return this.request(path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},res=>res.json());
  }
  async inspect():Promise<{stats:unknown;nodeInfo:Record<string,any>;models:Record<keyof ModelFiles,string[]>}> {
    const stats=await this.json('/system_stats');
    const classes=['UnetLoaderGGUF','CLIPLoader','VAELoader','TextEncodeQwenImage21','QwenImage21Cache','KSampler','VAEDecode','SaveImage','LoadImage','JoinImageWithAlpha'];
    const infos=await Promise.all(classes.map(c=>this.json(`/object_info/${c}`)));
    const nodeInfo=Object.assign({},...infos);
    for(const c of classes)if(!nodeInfo[c])throw new Error(`缺少节点：${c}`);
    const models={} as Record<keyof ModelFiles,string[]>;
    for(const [cls,field,key] of [['UnetLoaderGGUF','unet_name','unet'],['CLIPLoader','clip_name','clip'],['VAELoader','vae_name','vae']] as const) {
      const files=nodeInfo[cls]?.input?.required?.[field]?.[0];
      if(!Array.isArray(files)||files.some(f=>typeof f!=='string'))throw new Error(`节点模型字段不匹配：${cls}.${field}`);
      models[key]=files;
    }
    const names=nodeInfo.TextEncodeQwenImage21.input?.required?.images?.[1]?.template?.names;
    if(!names?.includes('image_1')||!names?.includes('image_3'))throw new Error('多参考图节点字段不匹配');
    return {stats,nodeInfo,models};
  }
  async check():Promise<{stats:unknown;nodeInfo:Record<string,any>}> {
    const result=await this.inspect();
    for(const key of ['unet','clip','vae'] as const)if(!result.models[key].includes(this.models[key]))throw new Error(`缺少模型 ${key}：${this.models[key]}；请在模型配置中扫描并选择文件`);
    return result;
  }
  async upload(bytes:Uint8Array,name:string):Promise<string> {
    if(!/^[\w-]+\.png$/.test(name))throw new Error('输入文件名必须是任务 ID PNG');
    const boundary=`psai-${uuid()}`;
    const ascii=(s:string)=>Uint8Array.from(s,c=>c.charCodeAt(0));
    const head=ascii(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`);
    const tail=ascii(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="subfolder"\r\n\r\nps-ai\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\nfalse\r\n--${boundary}--\r\n`);
    const data=new Uint8Array(head.length+bytes.length+tail.length);data.set(head);data.set(bytes,head.length);data.set(tail,head.length+bytes.length);
    const result=await this.request('/upload/image',{method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`},body:data.buffer},res=>res.json());
    return `${result.subfolder?result.subfolder+'/':''}${result.name}`;
  }
  async submit(graph:Graph,promptId:string,clientId:string):Promise<string> {
    this.validateId(promptId);this.validateId(clientId);
    // This local server accepts caller-assigned UUIDs. Never retry this POST.
    const result=await this.json('/prompt',{prompt:graph,prompt_id:promptId,client_id:clientId});
    if(result.prompt_id!==promptId)throw new Error('服务返回了不同任务 ID，请保留记录并检查版本');
    return result.prompt_id;
  }
  private validateId(id:string):void {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new Error('任务 ID 无效');}
  async status(id:string):Promise<Status> {
    this.validateId(id);const history=await this.json(`/history/${id}`);const own=history[id];
    if(own) {
      const messages=own.status?.messages??[];
      if(messages.some((m:any)=>m[0]==='execution_interrupted'))return {state:'cancelled'};
      if(own.status?.status_str==='error')return {state:'failed',detail:JSON.stringify(messages).slice(0,2000)};
      const images=own.outputs?.['8']?.images;
      if(own.status?.completed&&images?.length)return {state:'ready',images};
      if(own.status?.completed)return {state:'failed',detail:'任务完成但节点 8 没有输出'};
    }
    const queue=await this.json('/queue');
    if(queue.queue_running?.some((item:any[])=>item[1]===id))return {state:'running'};
    if(queue.queue_pending?.some((item:any[])=>item[1]===id))return {state:'queued'};
    return {state:'unknown'};
  }
  async output(file:OutputFile):Promise<Uint8Array> {
    if(file.type!=='output'||!file.filename||typeof file.subfolder!=='string')throw new Error('输出文件信息无效');
    const path=`/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder)}&type=output`;
    return new Uint8Array(await this.request(path,undefined,res=>res.arrayBuffer()));
  }
  async cancel(id:string):Promise<boolean> {
    this.validateId(id);
    // Verified in the installed server.py: atomic matching of the running ID.
    // No fallback to the legacy racy global/targeted interrupt endpoint.
    const result=await this.json(`/api/jobs/${id}/cancel`,{});
    if(typeof result.cancelled!=='boolean')throw new Error('服务没有返回取消确认，保留任务 ID');
    return result.cancelled;
  }
  watch(clientId:string,promptId:string,update:(value:number,max:number)=>void):()=>void {
    this.validateId(clientId);this.validateId(promptId);
    if(typeof WebSocket!=='function')return ()=>{};
    let ws:WebSocket;
    try{ws=new WebSocket(this.base.replace(/^http/,'ws')+`/ws?clientId=${clientId}`);}catch{return ()=>{};}
    ws.onmessage=event=>{if(typeof event.data!=='string')return;try{const m=JSON.parse(event.data);if(m.type==='progress'&&m.data.prompt_id===promptId)update(m.data.value,m.data.max);}catch{/* polling remains authoritative */}};
    ws.onerror=()=>{};return ()=>ws.close();
  }
}
