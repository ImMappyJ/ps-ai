import {resize,rasterMax,type Bounds,type Raster} from '../../imaging/image';
import {clamp,validateLightingRaster as raster,estimateLightingFields,lightingAmounts,validateLightingExtractionSettings as validateRelightExtractionSettings} from '../../imaging/lighting-fields';
import type {LightingFieldsOptions as RelightLayersOptions} from '../../imaging/lighting-fields';
export {DEFAULT_LIGHTING_EXTRACTION as DEFAULT_RELIGHT_EXTRACTION,validateLightingExtractionSettings as validateRelightExtractionSettings,type LightingExtractionSettings as RelightExtractionSettings,type LightingFieldsOptions as RelightLayersOptions} from '../../imaging/lighting-fields';
import {IMAGE_BUDGETS} from '../../imaging/budget';
import {validateRelightScene,sceneFingerprint,type RelightScene,type RelightLight,type RelightSource} from './relight-scene';

export type RelightChannelKind='shadow'|'cast-shadow'|'color-atmosphere'|'light'|'rim-light';
export interface RelightFieldChannel {
  kind:RelightChannelKind;blendMode:'multiply'|'color'|'screen';
  /** Multiply: 1-amount. Screen: amount. Color: amount is alpha, never a neutral RGB. */
  amount:Float32Array;color?:Float32Array;energy:number;
  /** Independent RGB Multiply/Screen amounts override the legacy scalar; new extraction stores their maximum in amount. */
  rgbAmount?:Float32Array;
}
interface LightingLayerFieldsBase {
  width:number;height:number;source:RelightSource;
  guide:Float32Array;channels:RelightFieldChannel[];
  summary:{method?:'soft-guided-v1'|'rgb-guided-v2';/** Historical summaries only; new extraction does not compare structure. */structureConfidence?:number;rejectedFraction?:number;clippedFraction:number;warnings:string[];channels:Record<RelightChannelKind,'present'|'not-observed'|'no-rim-light'|'no-reliable-receiver'>};
}
export type RelightSceneLayerFields=LightingLayerFieldsBase&{version:'relight-fields-v1';sceneFingerprint:string};
export type BlendLayerFields=LightingLayerFieldsBase&{version:'blend-fields-v1';sceneFingerprint?:never};
/** Shared field payload; version preserves the independent authority of each feature. */
export type RelightLayerFields=RelightSceneLayerFields|BlendLayerFields;
export type RelightExtractionReason='structure-mismatch'|'unsupported-boundary';
export interface RelightExtractionMetrics {structureConfidence?:number;rejectedFraction?:number;boundaryPixels?:number}
export class RelightExtractionError extends Error {
  readonly code='relight-extraction';readonly stage='lighting-extraction';readonly metrics:RelightExtractionMetrics;
  constructor(readonly reason:RelightExtractionReason,metrics:RelightExtractionMetrics){
    super(reason==='structure-mismatch'?'AI 参考的整体结构或纹理与原图不一致，保细节照明提取已停止；原始参考图已保留':'AI 参考含无法确认的局部结构、文字或光照边界，保细节照明提取已停止；原始参考图已保留');
    this.name='RelightExtractionError';this.metrics={};
    for(const key of ['structureConfidence','rejectedFraction','boundaryPixels'] as const){const value=metrics[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=(key==='boundaryPixels'?IMAGE_BUDGETS.analysisPixels:1))this.metrics[key]=value;}
  }
}
function lightWeight(light:RelightLight,x:number,y:number):number {
  if(!light.enabled||light.intensity===0)return 0;
  if(light.type==='directional'){const a=light.direction*Math.PI/180;return clamp(.55+((x-.5)*Math.cos(a)+(y-.5)*Math.sin(a))*.7,.1,1)*Math.min(1,light.intensity);}
  const dx=x-light.x,dy=y-light.y,distance=Math.hypot(dx,dy,light.z*.2),radius=light.range;
  let value=clamp(1-distance/radius);value=value*value*(3-2*value)*Math.min(1,light.intensity);
  if(light.type==='spot'){
    const tx=light.targetX-light.x,ty=light.targetY-light.y,length=Math.hypot(tx,ty)*Math.hypot(dx,dy);
    const angle=length?Math.acos(clamp((dx*tx+dy*ty)/length,-1,1)):0,outer=light.cone*Math.PI/360;
    value*=clamp((outer-angle)/(outer*Math.max(.1,light.softness)));
  }
  return value;
}
function upstream(light:RelightLight,x:number,y:number):[number,number] {
  if(light.type==='directional'){const a=light.direction*Math.PI/180;return [Math.cos(a),Math.sin(a)];}
  const dx=light.x-x,dy=light.y-y,length=Math.hypot(dx,dy);return length?[dx/length,dy/length]:[0,0];
}
function isSrgb(profile:string):boolean{return /^sRGB(?: IEC61966-2\.1)?$/i.test(profile.trim());}

/**
 * The reference supplies multiscale linear RGB lighting ratios; the frozen
 * source supplies content. Only dark/unstable ratios and out-of-gamut results
 * are bounded. Broad colored lighting is not globally compressed. This cannot
 * recover physical lighting or remove all broad mismatch artifacts.
 */
export async function deriveRelightLayers(source:Raster,target:Raster,scene:RelightScene,options:RelightLayersOptions={}):Promise<RelightLayerFields> {
  raster(source);raster(target);const s=validateRelightScene(scene),extraction=validateRelightExtractionSettings(options.extraction);if(!isSrgb(s.source.profile)||!['rgb','rgbcolor','rgbcolormode'].includes(s.source.documentMode.toLowerCase()))throw new Error('实验光影层目前需要已标记的 sRGB RGB 8/16 位原文档；其他颜色空间可明确选择整图重绘');
  const {base,width,height,n,sourceMax,support,observed,radius,guide,ratios,pause}=await estimateLightingFields(source,target,{...options,extraction});
  // Output arrays are allocated only after filtering: four RGB planes (48 B/p),
  // scalar supports (16), ratios (12), guide/edge (8), support (1), model-grid
  // rasters plus optional sRGB8 projection (<=20), source (<=8), raw guide (4):
  // <=117 B/analysis pixel, excluding the existing model-transport reserve.
  // Sequential filter temporaries peak below this output phase, within128 B/p.
  const amounts={shadow:new Float32Array(n),'cast-shadow':new Float32Array(n),light:new Float32Array(n),'rim-light':new Float32Array(n)},rgbAmounts={shadow:new Float32Array(n*3),'cast-shadow':new Float32Array(n*3),light:new Float32Array(n*3),'rim-light':new Float32Array(n*3)};
  const keys=s.lights.filter(l=>l.enabled&&l.intensity>0&&l.role!=='rim'),rims=s.lights.filter(l=>l.enabled&&l.intensity>0&&l.role==='rim'),enabled=[...keys,...rims],edge=new Float32Array(n);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,left=y*width+Math.max(0,x-1),right=y*width+Math.min(width-1,x+1),up=Math.max(0,y-1)*width+x,down=Math.min(height-1,y+1)*width+x;
    // Broad source geometry only labels existing light; never restore fine edges.
    if(support[left]&&support[right]&&support[up]&&support[down])edge[p]=Math.max(0,Math.hypot(guide[right]-guide[left],guide[down]-guide[up])*radius-.02);
  }
  let receiverObserved=false,clipped=0;
  for(let y=0;y<height;y++){if(y%16===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x;if(!support[p])continue;
    const nx=(x+.5)/width,ny=(y+.5)/height;
    const key=keys.reduce((v,l)=>Math.max(v,lightWeight(l,nx,ny)),0),rim=rims.reduce((v,l)=>Math.max(v,lightWeight(l,nx,ny)),0),rimSupport=clamp(edge[p]*2),rimShare=clamp(rim*rimSupport/(Math.max(.25,key)+rim*rimSupport));
    // Divide observed darkness only; do not manufacture a cast projection.
    let receiver=0;
    if(ratios.some(values=>values[p]<-.008)&&edge[p]<.08)for(const l of enabled){
      const [dx,dy]=upstream(l,nx,ny);
      for(const distance of [1,2,3]){const qx=Math.round(x+dx*radius*distance),qy=Math.round(y+dy*radius*distance);if(qx<0||qx>=width||qy<0||qy>=height)continue;const q=qy*width+qx;if(support[q])receiver=Math.max(receiver,clamp(edge[q]*3));}
    }
    const castShare=clamp(receiver)*clamp(1-edge[p]*8);let limited=false;
    for(let c=0;c<3;c++){
      const {negative,positive,limited:channelLimited}=lightingAmounts(ratios[c][p],base.rgba[p*4+c]/sourceMax,extraction.fidelity);limited ||= channelLimited;
      const cast=negative*castShare,rimAmount=positive*rimShare;
      const values={shadow:cast<1?clamp(1-(1-negative)/(1-cast)):0,'cast-shadow':cast,light:rimAmount<1?clamp(1-(1-positive)/(1-rimAmount)):0,'rim-light':rimAmount};
      for(const kind of ['shadow','cast-shadow','light','rim-light'] as const){rgbAmounts[kind][p*3+c]=values[kind];amounts[kind][p]=Math.max(amounts[kind][p],values[kind]);}
      if(cast>.003)receiverObserved=true;
    }
    if(limited)clipped++;
  }}
  const channels:RelightFieldChannel[]=[],states:RelightLayerFields['summary']['channels']={shadow:'not-observed','cast-shadow':receiverObserved?'not-observed':'no-reliable-receiver','color-atmosphere':'not-observed',light:'not-observed','rim-light':rims.length?'not-observed':'no-rim-light'};
  for(const kind of ['shadow','cast-shadow','light','rim-light'] as const){
    let energy=0,peak=0;for(const v of amounts[kind]){energy+=v;peak=Math.max(peak,v);}energy/=n;
    if(peak>=.002&&energy>=.000005){states[kind]='present';channels.push({kind,blendMode:kind==='shadow'||kind==='cast-shadow'?'multiply':'screen',amount:amounts[kind],rgbAmount:rgbAmounts[kind],energy});}
  }
  const warnings=['RGB 光影由单张参考的多尺度颜色比率估计，保留原图内容；结构错位仍可能留下宽泛光影伪影，细窄阴影和轮廓光会被柔化。'];
  if(clipped/observed>.01)warnings.push('部分暗部比率或高光超出安全范围，已限制极端增益或输出色域。');
  if(!receiverObserved)warnings.push('没有可靠且获准修改的承影区域，本场景未创建 Cast Shadow。');
  return {version:'relight-fields-v1',width,height,source:s.source,sceneFingerprint:sceneFingerprint(s),guide,channels,summary:{method:'rgb-guided-v2',clippedFraction:clipped/observed,warnings,channels:states}};
}

export function validateRelightLayerFields(fields:RelightLayerFields):void {
  if(!fields||fields.version!=='relight-fields-v1'&&fields.version!=='blend-fields-v1'||!Number.isSafeInteger(fields.width)||!Number.isSafeInteger(fields.height)||fields.width<1||fields.height<1||fields.width*fields.height>IMAGE_BUDGETS.analysisPixels||!(fields.guide instanceof Float32Array)||fields.guide.length!==fields.width*fields.height||!Array.isArray(fields.channels)||fields.channels.length>5)throw new Error('光影影响场版本、尺寸或预算无效');
  const kinds=new Set<RelightChannelKind>(),order:RelightChannelKind[]=['shadow','cast-shadow','color-atmosphere','light','rim-light'];let previous=-1;
  if(fields.guide.some(v=>!Number.isFinite(v)||v<0||v>1)||!fields.source||fields.version==='relight-fields-v1'&&(typeof fields.sceneFingerprint!=='string'||!fields.sceneFingerprint)||fields.version==='blend-fields-v1'&&Object.prototype.hasOwnProperty.call(fields,'sceneFingerprint'))throw new Error('光影来源或引导数据无效');
  for(const c of fields.channels){
    if(fields.version==='blend-fields-v1'&&(c.kind!=='shadow'&&c.kind!=='light'||!(c.rgbAmount instanceof Float32Array)))throw new Error('溶图仅支持独立的 RGB Multiply/Screen 光影通道');
    const position=order.indexOf(c.kind);
    if(position<0||position<=previous||kinds.has(c.kind)||c.blendMode!==(c.kind==='color-atmosphere'?'color':c.kind==='shadow'||c.kind==='cast-shadow'?'multiply':'screen')||!(c.amount instanceof Float32Array)||c.amount.length!==fields.width*fields.height||c.amount.some(v=>!Number.isFinite(v)||v<0||v>1)||!Number.isFinite(c.energy)||c.energy<=0||c.kind==='color-atmosphere'&&(!(c.color instanceof Float32Array)||c.color.length!==c.amount.length*3||c.color.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('光影通道数据无效');
    if(c.rgbAmount!==undefined&&(c.blendMode==='color'||!(c.rgbAmount instanceof Float32Array)||c.rgbAmount.length!==c.amount.length*3||c.rgbAmount.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('RGB 光影通道数据无效');
    if(!(c.rgbAmount??c.amount).some(v=>v>0))throw new Error('光影通道没有可见影响');
    kinds.add(c.kind);previous=position;
  }
}
function sample(values:Float32Array|Uint8Array,width:number,height:number,x:number,y:number,components=1,component=0):number {
  const sx=clamp(x,0,width-1),sy=clamp(y,0,height-1),x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
  return (values[(y0*width+x0)*components+component]*(1-fx)+values[(y0*width+Math.min(width-1,x0+1))*components+component]*fx)*(1-fy)+(values[(Math.min(height-1,y0+1)*width+x0)*components+component]*(1-fx)+values[(Math.min(height-1,y0+1)*width+Math.min(width-1,x0+1))*components+component]*fx)*fy;
}
/** Generates only one native strip of one channel; neutral pixels are defined explicitly. */
export function renderRelightLayerStrip(fields:RelightLayerFields,channel:RelightFieldChannel,region:Bounds,strip:Bounds,depth:8|16):Raster {
  const width=strip.right-strip.left,height=strip.bottom-strip.top;
  if(width<1||height<1||width*height>IMAGE_BUDGETS.stripPixels||strip.left<region.left||strip.top<region.top||strip.right>region.right||strip.bottom>region.bottom)throw new Error('光影回填条带超出预算或坐标范围');
  const max=depth===16?65535:255,rgba=depth===16?new Uint16Array(width*height*4):new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=(strip.left+x+.5-region.left)*fields.width/(region.right-region.left)-.5,sy=(strip.top+y+.5-region.top)*fields.height/(region.bottom-region.top)-.5,a=clamp(sample(channel.amount,fields.width,fields.height,sx,sy)),p=(y*width+x)*4;
    for(let c=0;c<3;c++){const rgb=channel.rgbAmount?clamp(sample(channel.rgbAmount,fields.width,fields.height,sx,sy,3,c)):a;rgba[p+c]=Math.round(max*(channel.blendMode==='multiply'?1-rgb:channel.blendMode==='screen'?rgb:sample(channel.color!,fields.width,fields.height,sx,sy,3,c)));}
    rgba[p+3]=channel.blendMode==='color'?Math.round(a*max):max;
  }
  return {width,height,rgba};
}
// Nonseparable Color blend: preserve backdrop encoded luminosity and use the
// bounded field hue/chroma, then interpolate by support alpha. Native behavior
// still requires Photoshop acceptance; global blend preferences are untouched.
function colorBlend(base:number[],color:number[]):number[] {
  const lum=(v:number[])=>.3*v[0]+.59*v[1]+.11*v[2],d=lum(base)-lum(color),out=color.map(v=>v+d),l=lum(out),low=Math.min(...out),high=Math.max(...out);
  if(low<0)for(let c=0;c<3;c++)out[c]=l+(out[c]-l)*l/(l-low);
  if(high>1)for(let c=0;c<3;c++)out[c]=l+(out[c]-l)*(1-l)/(high-l);
  return out.map(v=>clamp(v));
}
/** Bounded unmasked local composite. The caller applies the edit mask exactly once. */
export function previewRelightLayers(source:Raster,fields:RelightLayerFields):Raster {
  raster(source);validateRelightLayerFields(fields);const base=source.width===fields.width&&source.height===fields.height?{...source,rgba:source.rgba.slice()}:resize(source,fields.width,fields.height),max=rasterMax(base);
  for(const channel of fields.channels)for(let p=0;p<fields.width*fields.height;p++){
    const a=channel.amount[p];if(!a&&!channel.rgbAmount)continue;
    if(channel.blendMode==='color'){
      const before=[base.rgba[p*4]/max,base.rgba[p*4+1]/max,base.rgba[p*4+2]/max],mixed=colorBlend(before,[channel.color![p*3],channel.color![p*3+1],channel.color![p*3+2]]);
      for(let c=0;c<3;c++)base.rgba[p*4+c]=Math.round(max*(before[c]*(1-a)+mixed[c]*a));
    }else for(let c=0;c<3;c++){const b=base.rgba[p*4+c]/max,rgb=channel.rgbAmount?channel.rgbAmount[p*3+c]:a;base.rgba[p*4+c]=Math.round(max*(channel.blendMode==='multiply'?b*(1-rgb):1-(1-b)*(1-rgb)));}
  }
  return base;
}
