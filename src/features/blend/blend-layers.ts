import {IMAGE_BUDGETS} from '../../imaging/budget';
import {rasterDepth,type Raster} from '../../imaging/image';
import {estimateLightingFields,lightingAmounts} from '../../imaging/lighting-fields';
import type {RelightSource} from '../relight/relight-scene';
import type {RelightLayerFields,RelightLayersOptions,RelightFieldChannel,BlendLayerFields} from '../relight/relight-layers';
export type {BlendLayerFields} from '../relight/relight-layers';

/** A frozen pixel/mask identity, independent of any relight scene or lamps. */
export function validateBlendSource(value:unknown):RelightSource {
  const record=(value:unknown,keys:string[]):Record<string,unknown>=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('溶图来源身份无效');
    const names=Object.getOwnPropertyNames(value);
    if(Object.getOwnPropertySymbols(value).length||names.length!==keys.length||names.some(k=>!keys.includes(k)||!('value' in Object.getOwnPropertyDescriptor(value,k)!)))throw new Error('溶图来源身份字段无效');
    return value as Record<string,unknown>;
  };
  const integer=(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new Error('溶图来源尺寸或编号无效');return value===0?0:value;};
  const text=(value:unknown,max:number):string=>{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw new Error('溶图来源文本身份无效');return value;};
  const v=record(value,['documentId','layerIds','sessionId','historyId','sourceHash','snapshotId','docWidth','docHeight','bounds','profile','documentMode','documentDepth','maskRef']),docWidth=integer(v.docWidth,1,300000),docHeight=integer(v.docHeight,1,300000),b=record(v.bounds,['left','top','right','bottom']);
  const bounds={left:integer(b.left,0,docWidth),top:integer(b.top,0,docHeight),right:integer(b.right,0,docWidth),bottom:integer(b.bottom,0,docHeight)};
  if(bounds.right<=bounds.left||bounds.bottom<=bounds.top||(bounds.right-bounds.left)*(bounds.bottom-bounds.top)>IMAGE_BUDGETS.documentPixels)throw new Error('溶图来源范围或像素预算无效');
  if(!Array.isArray(v.layerIds)||!v.layerIds.length||v.layerIds.length>4096)throw new Error('溶图可见来源图层无效');
  const layerIds=Array.from(v.layerIds,id=>integer(id,1));if(new Set(layerIds).size!==layerIds.length)throw new Error('溶图来源图层编号重复');
  const documentDepth=v.documentDepth;if(documentDepth!==8&&documentDepth!==16)throw new Error('溶图来源须为 8/16 位');
  return {documentId:integer(v.documentId,1),layerIds,sessionId:text(v.sessionId,128),historyId:integer(v.historyId,0),sourceHash:text(v.sourceHash,256),snapshotId:text(v.snapshotId,128),docWidth,docHeight,bounds,profile:text(v.profile,256),documentMode:text(v.documentMode,64),documentDepth,maskRef:text(v.maskRef,256)};
}

/** Transfer observed environment lighting to original pixels without inventing a scene. */
export async function deriveBlendLayers(source:Raster,target:Raster,sourceIdentity:RelightSource,options:RelightLayersOptions={}):Promise<RelightLayerFields> {
  const identity=validateBlendSource(sourceIdentity);
  if(!/^sRGB(?: IEC61966-2\.1)?$/i.test(identity.profile.trim())||!['rgb','rgbcolor','rgbcolormode'].includes(identity.documentMode.toLowerCase()))throw new Error('溶图光影提取目前需要已标记的 sRGB RGB 8/16 位原文档；其他来源可明确选择 AI 重绘主体');
  if(!source||identity.documentDepth!==rasterDepth(source))throw new Error('溶图光影来源位深与冻结身份不符');
  const {base,width,height,n,sourceMax,support,observed,guide,ratios,pause,extraction}=await estimateLightingFields(source,target,options,true,'blend');
  const amounts={shadow:new Float32Array(n),light:new Float32Array(n)},rgbAmounts={shadow:new Float32Array(n*3),light:new Float32Array(n*3)};let clipped=0;
  for(let y=0;y<height;y++){if(y%16===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x;if(!support[p])continue;let limited=false;
    for(let c=0;c<3;c++){
      const value=lightingAmounts(ratios[c][p],base.rgba[p*4+c]/sourceMax,extraction.fidelity);limited ||= value.limited;
      rgbAmounts.shadow[p*3+c]=value.negative;rgbAmounts.light[p*3+c]=value.positive;
      amounts.shadow[p]=Math.max(amounts.shadow[p],value.negative);amounts.light[p]=Math.max(amounts.light[p],value.positive);
    }
    if(limited)clipped++;
  }}
  const channels:RelightFieldChannel[]=[],states:BlendLayerFields['summary']['channels']={shadow:'not-observed','cast-shadow':'not-observed','color-atmosphere':'not-observed',light:'not-observed','rim-light':'not-observed'};
  for(const kind of ['shadow','light'] as const){
    let energy=0,peak=0;for(const v of amounts[kind]){energy+=v;peak=Math.max(peak,v);}energy/=n;
    if(peak>=.002&&energy>=.000005){states[kind]='present';channels.push({kind,blendMode:kind==='shadow'?'multiply':'screen',amount:amounts[kind],rgbAmount:rgbAmounts[kind],energy});}
  }
  const warnings=['RGB 光影由环境参考的多尺度颜色比率估计，保留原图内容；结构错位仍可能留下宽泛光影伪影，细窄明暗边界会被柔化。'];
  if(clipped/observed>.01)warnings.push('部分暗部比率或高光超出安全范围，已限制极端增益或输出色域。');
  return {version:'blend-fields-v1',width,height,source:identity,guide,channels,summary:{method:'rgb-guided-v2',clippedFraction:clipped/observed,warnings,channels:states}};
}
