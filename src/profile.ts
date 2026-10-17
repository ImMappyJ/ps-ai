export interface ModelFiles {unet:string;clip:string;vae:string}
export type Language='zh-CN'|'en-US';
export interface BackendSettings {schemaVersion:1;baseUrl:string;models:ModelFiles;language?:Language;outputDepth?:8|16;backend?:'comfyui'|'gateway';gatewayModel?:string}
export const DEFAULT_MODELS:ModelFiles={unet:'qwen-image-2.1-Q4_K_M.gguf',clip:'qwen3vl_8b_int8_convrot.safetensors',vae:'qwen_image_2.1_vae_bf16.safetensors'};
export function defaultSettings():BackendSettings {return {schemaVersion:1,baseUrl:'http://localhost:8188',models:{...DEFAULT_MODELS}};}
// UXP does not provide the browser URL constructor on every supported host.
// Accept origins only: a reverse proxy must expose ComfyUI at its root.
export function normalizeBaseUrl(value:unknown):string {
  const text=typeof value==='string'?value.trim():'';
  const match=/^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i.exec(text);
  if(!match)throw new Error('请输入 HTTP(S) 服务根地址，例如 http://localhost:8188；不要包含路径、密码或查询参数');
  let [,protocol,host,port]=match;protocol=protocol.toLowerCase();host=host.toLowerCase();
  if(host.startsWith('[')){
    const address=host.slice(1,-1),groups=address.split(':').filter(Boolean),compressed=address.includes('::');
    if(!address.includes(':')||groups.some(g=>g.length>4)||address.includes(':::')||address.split('::').length>2||(compressed?groups.length>=8:groups.length!==8)||(!compressed&&(address.startsWith(':')||address.endsWith(':'))))throw new Error('IPv6 地址无效');
  }else if(host.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-'))||host.length>253||(/^\d+(\.\d+)+$/.test(host)&&(host.split('.').length!==4||host.split('.').some(n=>Number(n)>255))))throw new Error('主机地址无效');
  if(port&&(Number(port)<1||Number(port)>65535))throw new Error('端口须为 1–65535');
  if(host==='127.0.0.1')host='localhost';
  if(port)port=String(Number(port));
  if((protocol==='http'&&port==='80')||(protocol==='https'&&port==='443'))port='';
  return `${protocol}://${host}${port?':'+port:''}`;
}
export function validateModels(value:unknown):ModelFiles {
  if(!value||typeof value!=='object')throw new Error('模型映射无效');const input=value as Record<string,unknown>,out={} as ModelFiles;
  for(const name of ['unet','clip','vae'] as const){
    const text=input[name],extension=name==='unet'?'.gguf':'.safetensors';
    if(typeof text!=='string'||!text.trim()||text!==text.trim()||/^[\\/]|^[a-zA-Z]:|[\u0000-\u001f]/.test(text)||text.split(/[\\/]/).some(p=>!p||p==='.'||p==='..')||!text.toLowerCase().endsWith(extension))throw new Error(`模型 ${name} 需要后端搜索目录中的相对 ${extension} 文件名`);
    out[name]=text;
  }return out;
}
export function validateSettings(value:unknown):BackendSettings {
  if(!value||typeof value!=='object')throw new Error('设置无效');const input=value as Record<string,unknown>;
  if(input.schemaVersion!==1)throw new Error('不支持的设置版本，请重新保存配置');
  const baseUrl=normalizeBaseUrl(input.baseUrl);
  if(input.language!==undefined&&!['zh-CN','en-US'].includes(String(input.language)))throw new Error('不支持的界面语言');
  if(input.outputDepth!==undefined&&input.outputDepth!==8&&input.outputDepth!==16)throw new Error('输出位深须为 8 或 16');
  if(input.backend!==undefined&&input.backend!=='comfyui'&&input.backend!=='gateway')throw new Error('不支持的后端类型');
  if(input.backend==='gateway'&&input.outputDepth===16)throw new Error('平台后端仅支持 8 位输出；16 位请切回 ComfyUI');
  if(input.gatewayModel!==undefined&&(typeof input.gatewayModel!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(input.gatewayModel)))throw new Error('平台模型 ID 无效');
  return {schemaVersion:1,baseUrl,models:validateModels(input.models??(input.backend==='gateway'?DEFAULT_MODELS:undefined)),...(input.language?{language:input.language as Language}:{}),...(input.outputDepth!==undefined?{outputDepth:input.outputDepth as 8|16}:{}),...(input.backend?{backend:input.backend as 'comfyui'|'gateway'}:{}),...(input.gatewayModel?{gatewayModel:input.gatewayModel as string}:{})};
}
