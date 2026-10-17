import {GatewayClient} from './gateway-client';import {platformUrl,PLATFORMS,validateApiKey} from './platforms';import type {PlatformId} from './platforms';
import {t} from './i18n';
const FILES=['ps-ai-gateway.mjs','start-ps-ai-relay.cmd','start-ps-ai-relay.ps1'];
// UXP entry-based storage and shell only. Never import Node or pass secrets in argv.
export class RelayController {
  private token?:string;private starting?:Promise<void>;
  constructor(private uxp:any,private transport:typeof fetch=fetch){}
  private async folder(){const root=await this.uxp.storage.localFileSystem.getDataFolder();try{return await root.getEntry('relay');}catch{return root.createFolder('relay');}}
  private async readSession(){
    try{const value=JSON.parse(await(await(await this.folder()).getEntry('relay-session.json')).read());if(value.protocol!=='ps-ai-relay/1'||!/^[a-f0-9]{64}$/.test(value.token)||Object.keys(PLATFORMS).some(k=>value.ports?.[k]!==PLATFORMS[k as PlatformId].port))return;this.token=value.token;return value;}catch{return;}
  }
  private client(id:PlatformId,model:string){return new GatewayClient(platformUrl(id),model,this.transport,30000,this.token);}
  private async alive(id:PlatformId){if(!await this.readSession())return false;try{const cap=await new GatewayClient(platformUrl(id),PLATFORMS[id].model,this.transport,500,this.token).connect();if(cap.provider!==id)throw Error('identity');return true;}catch{return false;}}
  private async ensure(id:PlatformId){
    if(await this.alive(id))return;
    if(!this.starting)this.starting=(async()=>{
      const folder=await this.folder();
      if(!/^[a-z]:[\\/]/i.test(folder.nativePath??''))throw new Error(t('自动启动仅支持 Windows；其他系统请使用手动适配服务'));
      const plugin=await this.uxp.storage.localFileSystem.getPluginFolder();
      for(const name of FILES){const bytes=await(await plugin.getEntry('relay/'+name)).read({format:this.uxp.storage.formats.binary});await(await folder.createFile(name,{overwrite:true})).write(bytes,{format:this.uxp.storage.formats.binary});}
      const result=await this.uxp.shell.openPath(folder.nativePath+'\\start-ps-ai-relay.cmd',t('启动 PS-AI 本地平台适配服务，仅监听本机；需要 Node.js 24 或更高版本'));
      if(result)throw new Error(t('本地适配服务启动未获授权或失败，请重新连接'));
      for(let i=0;i<40;i++){if(await this.alive(id))return;await new Promise(r=>setTimeout(r,250));}
      throw new Error(t('本地适配服务未启动，请检查 Node.js 24、8191–8193 端口和服务锁'));
    })().finally(()=>{this.starting=undefined;});
    await this.starting;
  }
  private async configure(id:PlatformId,apiKey:string){
    // Identity is checked with our private token before sending a credential.
    const caps=await this.client(id,PLATFORMS[id].model).connect();if(caps.provider!==id)throw new Error(t('本地服务平台身份不匹配'));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{const response=await this.transport(platformUrl(id)+'/psai/v1/configure',{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({apiKey})});if(!response.ok)throw new Error(t(response.status===409?'请先处理此平台的未完成任务，再更换或清除 Key':'本地服务未接受配置，请重新连接'));}
    finally{clearTimeout(timer);}
  }
  private keyName(id:PlatformId){return 'platform-api-key:'+id;}
  private async key(id:PlatformId):Promise<string>{try{const bytes=await this.uxp.storage.secureStorage.getItem(this.keyName(id));return Array.from(bytes as Uint8Array,b=>String.fromCharCode(b)).join('');}catch{return '';}}
  async hasKey(id:PlatformId){return !!await this.key(id);}
  async saveKey(id:PlatformId,value:string){const key=validateApiKey(value);await this.ensure(id);await this.configure(id,key);await this.uxp.storage.secureStorage.setItem(this.keyName(id),key);}
  async clearKey(id:PlatformId){await this.ensure(id);await this.configure(id,'');if(await this.hasKey(id))await this.uxp.storage.secureStorage.removeItem(this.keyName(id));}
  async connect(id:PlatformId,model:string){await this.ensure(id);const key=await this.key(id);if(key)await this.configure(id,key);const client=this.client(id,model);client.token=this.token;await client.connect();return client;}
  async stop(id:PlatformId){if(!await this.alive(id))return;const response=await this.transport(platformUrl(id)+'/psai/v1/shutdown',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.token}`}});if(!response.ok)throw new Error(t('本地服务未接受配置，请重新连接'));}
}
