import {sha256} from '@noble/hashes/sha2.js';
import type {Capture,Snapshot} from '../../infrastructure/photoshop/photoshop';
import type {RelightSource} from '../relight/relight-scene';
import {validateRelightExtractionSettings,type RelightExtractionSettings} from '../relight/relight-layers';
import {validateBlendSource} from './blend-layers';
import {rasterDepth} from '../../imaging/image';

export type BlendOutputKind='lighting-layers'|'full-result';
/** Local processing only. This identity never grants a new source history baseline. */
export interface BlendTaskMetadata {schemaVersion:1;requestId:string;source:RelightSource;outputKind:BlendOutputKind;localExtraction?:RelightExtractionSettings}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function blendMaskRef(mask:Uint8Array):string {return `blend-mask-v1:sha256:${Array.from(sha256(mask),v=>v.toString(16).padStart(2,'0')).join('')}`;}
export function validateBlendTaskMetadata(value:unknown,requestId?:string):BlendTaskMetadata {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('Invalid blend metadata');
  const v=value as Record<string,unknown>,keys=Object.getOwnPropertyNames(v);
  if(Object.getOwnPropertySymbols(v).length||keys.some(k=>!['schemaVersion','requestId','source','outputKind','localExtraction'].includes(k)||!('value' in Object.getOwnPropertyDescriptor(v,k)!))||v.schemaVersion!==1||typeof v.requestId!=='string'||!UUID.test(v.requestId)||requestId!==undefined&&v.requestId!==requestId||v.outputKind!=='lighting-layers'&&v.outputKind!=='full-result')throw new Error('Invalid blend task identity or output kind');
  const source=validateBlendSource(v.source);
  if(source.snapshotId!==v.requestId||!/^blend-mask-v1:sha256:[0-9a-f]{64}$/.test(source.maskRef))throw new Error('Invalid blend source binding');
  return {schemaVersion:1,requestId:v.requestId,source,outputKind:v.outputKind as BlendOutputKind,...(v.localExtraction===undefined?{}:{localExtraction:validateRelightExtractionSettings(v.localExtraction)})};
}
export function blendTaskMetadata(capture:Capture,requestId:string,outputKind:BlendOutputKind='lighting-layers'):BlendTaskMetadata {
  const s=capture.snapshot,depth=s.nativeDepth;
  if(s.captureGeometry?.kind!=='blend-analysis'||depth!==8&&depth!==16||!s.sourceLayerIds?.length||s.mask.length!==(s.bounds.right-s.bounds.left)*(s.bounds.bottom-s.bounds.top))throw new Error('Blend requires a fresh bounded capture');
  return validateBlendTaskMetadata({schemaVersion:1,requestId,outputKind,source:{documentId:s.documentId,docWidth:s.width,docHeight:s.height,profile:s.profile,documentMode:String(s.mode),documentDepth:depth,historyId:s.historyId,sessionId:s.sessionId,sourceHash:s.sourceHash,bounds:{...s.bounds},layerIds:[...s.sourceLayerIds],snapshotId:requestId,maskRef:blendMaskRef(s.mask)}},requestId);
}
export function withBlendProcessing(metadata:BlendTaskMetadata,outputKind:BlendOutputKind,extraction?:RelightExtractionSettings):BlendTaskMetadata {
  return validateBlendTaskMetadata({...validateBlendTaskMetadata(metadata),outputKind,...(extraction===undefined?{}:{localExtraction:validateRelightExtractionSettings(extraction)})});
}
export function assertBlendLightingCapture(capture:Capture):void {
  const s=capture.snapshot;
  if(!/^sRGB(?: IEC61966-2\.1)?$/i.test(s.profile.trim())||!['rgb','rgbcolor','rgbcolormode'].includes(String(s.mode).toLowerCase())||s.nativeDepth!==8&&s.nativeDepth!==16||rasterDepth(capture.image)!==s.nativeDepth)throw new Error('保留细节的光影方式仅支持已标记的 sRGB RGB 8/16 位原文档；请明确选择 AI 重绘主体');
  if(s.captureGeometry?.kind!=='blend-analysis'||s.blendOpaqueScope!==true)throw new Error('光影方式暂不支持作用范围内的透明/半透明来源；请缩小到不透明区域，或明确选择 AI 重绘主体');
}
/** Assert original task identity before reading or deriving saved local pixels. */
export function assertBlendSnapshot(metadata:BlendTaskMetadata,snapshot:Snapshot):void {
  const s=metadata.source,b=snapshot.bounds,g=snapshot.captureGeometry;
  if(g?.kind!=='blend-analysis'||s.documentId!==snapshot.documentId||s.docWidth!==snapshot.width||s.docHeight!==snapshot.height||s.historyId!==snapshot.historyId||s.sessionId!==snapshot.sessionId||s.sourceHash!==snapshot.sourceHash||s.profile!==snapshot.profile||s.documentMode!==String(snapshot.mode)||s.documentDepth!==snapshot.nativeDepth||JSON.stringify(s.bounds)!==JSON.stringify(b)||JSON.stringify(s.layerIds)!==JSON.stringify(snapshot.sourceLayerIds)||b.left!==0||b.top!==0||b.right!==snapshot.width||b.bottom!==snapshot.height||snapshot.backgroundComposite||typeof snapshot.requiresClipping!=='boolean'||typeof snapshot.blendOpaqueScope!=='boolean')throw new Error('Blend history source identity does not match its frozen snapshot');
  if(snapshot.mask.length&&blendMaskRef(snapshot.mask)!==s.maskRef)throw new Error('Blend history selection or protection changed');
}
