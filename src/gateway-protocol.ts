// Shared, browser-safe contract. No provider credentials, URLs or ComfyUI nodes.
export const GATEWAY_PROTOCOL='ps-ai/1';
export const GATEWAY_TEMPLATE='gateway-v1-srgb8';
export const DEFAULT_GATEWAY_MODEL='qwen-image-2.1-pro';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const UPLOAD=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(source|guide|reference)\.png$/;
export type GenerationKind='t2i'|'edit'|'asset';
export interface GatewayModel {
  id:string;label:string;operations:GenerationKind[];maxInputImages:number;outputDepths:(8|16)[];
  seedMax:number;minPixels:number;maxPixels:number;maxAspectRatio:number;
}
export interface GatewayCapabilities {
  protocol:typeof GATEWAY_PROTOCOL;provider:string;configured:boolean;
  cancellation:'none';progress:'stages';models:GatewayModel[];
}
export interface GenerationRequest {
  model:string;kind:GenerationKind;mode:string;prompt:string;seed:number;width:number;height:number;outputDepth:8;
  source?:string;guide?:string;reference?:string;
}
export function modelId(value:unknown):string {
  if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value))throw new Error('Invalid gateway model ID');
  return value;
}
export function validateCapabilities(value:unknown):GatewayCapabilities {
  const v=value as GatewayCapabilities;
  if(!v||v.protocol!==GATEWAY_PROTOCOL||typeof v.provider!=='string'||v.provider.length>100||typeof v.configured!=='boolean'||v.cancellation!=='none'||v.progress!=='stages'||!Array.isArray(v.models)||!v.models.length||v.models.length>64)throw new Error('Unsupported PS-AI gateway capabilities');
  const seen=new Set<string>();
  for(const m of v.models){
    modelId(m.id);if(seen.has(m.id))throw new Error('Duplicate gateway model ID');seen.add(m.id);
    if(typeof m.label!=='string'||m.label.length>120||!Array.isArray(m.operations)||!m.operations.length||m.operations.some(k=>!['t2i','edit','asset'].includes(k))||!Number.isInteger(m.maxInputImages)||m.maxInputImages<0||m.maxInputImages>10||!Array.isArray(m.outputDepths)||m.outputDepths.length!==1||m.outputDepths[0]!==8||!Number.isSafeInteger(m.seedMax)||m.seedMax<0||!Number.isInteger(m.minPixels)||m.minPixels<1||!Number.isInteger(m.maxPixels)||m.maxPixels<m.minPixels||m.maxPixels>16_000_000||!Number.isFinite(m.maxAspectRatio)||m.maxAspectRatio<1||m.maxAspectRatio>32)throw new Error('Invalid gateway model capabilities');
  }
  // Copy only public fields; never persist unknown fields from a server response.
  return {protocol:GATEWAY_PROTOCOL,provider:v.provider,configured:v.configured,cancellation:'none',progress:'stages',models:v.models.map(m=>({id:m.id,label:m.label,operations:[...m.operations],maxInputImages:m.maxInputImages,outputDepths:[8],seedMax:m.seedMax,minPixels:m.minPixels,maxPixels:m.maxPixels,maxAspectRatio:m.maxAspectRatio}))};
}
export function validateGeneration(value:unknown,caps:GatewayCapabilities):GenerationRequest {
  const v=value as GenerationRequest,m=caps.models.find(m=>m.id===v?.model);
  if(v&&Object.keys(v).some(key=>!['model','kind','mode','prompt','seed','width','height','outputDepth','source','guide','reference'].includes(key)))throw new Error('Unsupported generation parameter');
  if(!v||!m||!m.operations.includes(v.kind))throw new Error('Gateway model does not support this operation');
  const allowed={t2i:['generate'],edit:['edit','remove','background','costume','reference','scene'],asset:['effect','atmosphere']};
  if(!allowed[v.kind]?.includes(v.mode)||typeof v.prompt!=='string'||!v.prompt.trim()||v.prompt.length>20000||v.prompt.includes('\0'))throw new Error('Invalid generation mode or prompt');
  if(!Number.isSafeInteger(v.seed)||v.seed<0||v.seed>m.seedMax)throw new Error(`Seed must be 0–${m.seedMax}`);
  const area=v.width*v.height,ratio=Math.max(v.width/v.height,v.height/v.width);
  if(!Number.isInteger(v.width)||!Number.isInteger(v.height)||v.width<1||v.height<1||area<m.minPixels||area>m.maxPixels||ratio>m.maxAspectRatio)throw new Error('Image dimensions exceed gateway model limits');
  if(v.outputDepth!==8)throw new Error('Gateway supports 8-bit output only');
  const inputs=[v.source,v.guide,v.reference].filter(v=>v!==undefined);
  if(inputs.some(v=>typeof v!=='string'||!UPLOAD.test(v))||inputs.length>m.maxInputImages||(v.kind==='edit'&&!v.source)||(v.kind!=='edit'&&inputs.length)||(v.mode==='reference'&&!v.reference))throw new Error('Invalid generation image inputs');
  return {model:v.model,kind:v.kind,mode:v.mode,prompt:v.prompt,seed:v.seed,width:v.width,height:v.height,outputDepth:8,...(v.source?{source:v.source}:{}),...(v.guide?{guide:v.guide}:{}),...(v.reference?{reference:v.reference}:{})};
}
