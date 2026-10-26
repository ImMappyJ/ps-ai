import {resize,convertDepth,rasterMax,type Bounds,type Raster} from '../../imaging/image';
import {IMAGE_BUDGETS,planRelightMemory} from '../../imaging/budget';
import {validateRelightScene,sceneFingerprint,type RelightScene,type RelightLight,type RelightSource} from './relight-scene';

export type RelightChannelKind='shadow'|'cast-shadow'|'color-atmosphere'|'light'|'rim-light';
export interface RelightFieldChannel {
  kind:RelightChannelKind;blendMode:'multiply'|'color'|'screen';
  /** Multiply: 1-amount. Screen: amount. Color: amount is alpha, never a neutral RGB. */
  amount:Float32Array;color?:Float32Array;energy:number;
}
export interface RelightLayerFields {
  version:'relight-fields-v1';width:number;height:number;source:RelightSource;sceneFingerprint:string;
  guide:Float32Array;channels:RelightFieldChannel[];
  summary:{method?:'soft-guided-v1';/** Historical summaries only; new extraction does not compare structure. */structureConfidence?:number;rejectedFraction?:number;clippedFraction:number;warnings:string[];channels:Record<RelightChannelKind,'present'|'not-observed'|'no-rim-light'|'no-reliable-receiver'>};
}
export interface RelightLayersOptions {signal?:AbortSignal;yieldControl?:()=>Promise<void>;editMask?:Uint8Array}
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
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));
function check(signal?:AbortSignal):void {if(signal?.aborted){const error=new Error('光影层处理已取消');error.name='AbortError';throw error;}}
function raster(image:Raster):void {
  if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>16_000_000||!(image.rgba instanceof Uint8Array||image.rgba instanceof Uint16Array)||image.rgba.length!==image.width*image.height*4)throw new Error('光影参考图尺寸或 RGBA 数据无效');
}
/** Match model input/output grids with two cached sRGB8 input rows. */
async function modelProjection(source:Raster,reference:Raster,pause:()=>Promise<void>,editMask?:Uint8Array):Promise<{comparison:Raster;result:Raster;referenceSample:(index:number)=>number;referenceAllowed:(index:number)=>boolean}> {
  const {width,height}=source,modelWidth=reference.width,modelHeight=reference.height,max=rasterMax(source),scale=255/max,targetMax=rasterMax(reference),modelScale=targetMax/255;
  const out=targetMax===65535?new Uint16Array(width*height*4):new Uint8Array(width*height*4),result=out.slice(),rows=new Map<number,Uint8Array>();
  const row=(y:number)=>{
    const cached=rows.get(y);if(cached)return cached;
    const data=new Uint8Array(modelWidth*4),sy=clamp((y+.5)*height/modelHeight-.5,0,height-1),y0=Math.floor(sy),dy=sy-y0;
    for(let x=0;x<modelWidth;x++){
      const sx=clamp((x+.5)*width/modelWidth-.5,0,width-1),x0=Math.floor(sx),dx=sx-x0,indices=[(y0*width+x0)*4,(y0*width+Math.min(width-1,x0+1))*4,(Math.min(height-1,y0+1)*width+x0)*4,(Math.min(height-1,y0+1)*width+Math.min(width-1,x0+1))*4],weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy];
      let alpha=0;for(let k=0;k<4;k++)alpha+=source.rgba[indices[k]+3]*weights[k];data[x*4+3]=Math.round(Math.round(alpha)*scale);
      for(let c=0;c<3;c++){let sum=0;for(let k=0;k<4;k++)sum+=source.rgba[indices[k]+c]*source.rgba[indices[k]+3]*weights[k];data[x*4+c]=alpha?Math.round(Math.round(sum/alpha)*scale):0;}
    }
    if(rows.size===2)rows.delete(rows.keys().next().value!);rows.set(y,data);return data;
  };
  const referenceAllowed=(index:number)=>{
    if(!editMask)return true;const pixel=Math.floor(index/4),x=pixel%modelWidth,y=Math.floor(pixel/modelWidth);
    // Test model-pixel centers against binary support; gray feathers remain
    // exclusively in the external editable mask.
    const sx=clamp((x+.5)*width/modelWidth-.5,0,width-1),sy=clamp((y+.5)*height/modelHeight-.5,0,height-1),x0=Math.floor(sx),y0=Math.floor(sy),dx=sx-x0,dy=sy-y0;
    // A model sample touching excluded support is not a valid observation.
    // This matters for isolated pixels, holes and thin protection boundaries.
    return editMask[y0*width+x0]>0&&(!dx||editMask[y0*width+Math.min(width-1,x0+1)]>0)&&(!dy||editMask[Math.min(height-1,y0+1)*width+x0]>0)&&(!dx||!dy||editMask[Math.min(height-1,y0+1)*width+Math.min(width-1,x0+1)]>0);
  };
  const referenceSample=(index:number)=>{
    if(!referenceAllowed(index)){const pixel=Math.floor(index/4),x=pixel%modelWidth,y=Math.floor(pixel/modelWidth);return row(y)[x*4+index%4]*modelScale;}
    return reference.rgba[index];
  };
  for(let y=0;y<height;y++){
    if(y%16===0)await pause();
    const sy=clamp((y+.5)*modelHeight/height-.5,0,modelHeight-1),y0=Math.floor(sy),y1=Math.min(modelHeight-1,y0+1),dy=sy-y0;
    for(const key of rows.keys())if(key!==y0&&key!==y1)rows.delete(key);
    const top=row(y0),bottom=row(y1);
    for(let x=0;x<width;x++){
      const sx=clamp((x+.5)*modelWidth/width-.5,0,modelWidth-1),x0=Math.floor(sx),x1=Math.min(modelWidth-1,x0+1),dx=sx-x0,values=[top,bottom],xs=[x0,x1],weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy],indices=[(y0*modelWidth+x0)*4,(y0*modelWidth+x1)*4,(y1*modelWidth+x0)*4,(y1*modelWidth+x1)*4],p=(y*width+x)*4;
      const support=weights.reduce((sum,w,k)=>sum+(referenceAllowed(indices[k])?w:0),0);
      if(support)for(let k=0;k<4;k++)weights[k]=referenceAllowed(indices[k])?weights[k]/support:0;
      let alpha=0,targetAlpha=0;for(let k=0;k<4;k++){alpha+=values[k>>1][xs[k%2]*4+3]*modelScale*weights[k];targetAlpha+=referenceSample(indices[k]+3)*weights[k];}out[p+3]=Math.round(alpha);result[p+3]=Math.round(targetAlpha);
      for(let c=0;c<3;c++){
        let sum=0,targetSum=0;for(let k=0;k<4;k++){sum+=values[k>>1][xs[k%2]*4+c]*modelScale*values[k>>1][xs[k%2]*4+3]*modelScale*weights[k];targetSum+=referenceSample(indices[k]+c)*referenceSample(indices[k]+3)*weights[k];}
        out[p+c]=alpha?Math.round(sum/alpha):0;result[p+c]=targetAlpha?Math.round(targetSum/targetAlpha):0;
      }
    }
  }
  return {comparison:{width,height,rgba:out},result:{width,height,rgba:result},referenceSample,referenceAllowed};
}
const luminance=(r:number,g:number,b:number)=>r*.2126+g*.7152+b*.0722;
async function blur(values:Float32Array,width:number,height:number,radius:number,pause:()=>Promise<void>,mask?:Uint8Array):Promise<Float32Array> {
  const tmp=new Float32Array(values.length),out=new Float32Array(values.length),weights=new Float32Array(values.length),r=Math.max(1,Math.round(radius));
  const included=(p:number)=>!mask||mask[p]>0?1:0;
  for(let y=0;y<height;y++){
    if(y%32===0)await pause();let sum=0,weight=0;for(let x=0;x<=Math.min(r,width-1);x++){const p=y*width+x,a=included(p);sum+=values[p]*a;weight+=a;}
    for(let x=0;x<width;x++){
      const p=y*width+x;tmp[p]=sum;weights[p]=weight;
      if(x+r+1<width){const add=y*width+x+r+1;sum+=values[add]*included(add);weight+=included(add);}
      if(x-r>=0){const remove=y*width+x-r;sum-=values[remove]*included(remove);weight-=included(remove);}
    }
  }
  for(let x=0;x<width;x++){
    if(x%64===0)await pause();let sum=0,weight=0;for(let y=0;y<=Math.min(r,height-1);y++){const p=y*width+x;sum+=tmp[p];weight+=weights[p];}
    for(let y=0;y<height;y++){
      const p=y*width+x;out[p]=weight>0?sum/weight:0;
      if(y+r+1<height){const add=(y+r+1)*width+x;sum+=tmp[add];weight+=weights[add];}
      if(y-r>=0){const remove=(y-r)*width+x;sum-=tmp[remove];weight-=weights[remove];}
    }
  }
  return out;
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

/** Local linear filtering on a de-textured source guide. Binary support is
 * used in every mean; gray feather coverage remains exclusively external.
 * The regularization limits edge following without comparing image structure.
 */
async function guided(values:Float32Array,guide:Float32Array,width:number,height:number,radius:number,pause:()=>Promise<void>,support:Uint8Array):Promise<Float32Array> {
  const meanGuide=await blur(guide,width,height,radius,pause,support),meanValue=await blur(values,width,height,radius,pause,support),product=new Float32Array(values.length);
  for(let p=0;p<values.length;p++)product[p]=guide[p]*guide[p];
  const a=await blur(product,width,height,radius,pause,support);
  for(let p=0;p<values.length;p++)product[p]=guide[p]*values[p];
  const b=await blur(product,width,height,radius,pause,support);
  for(let p=0;p<values.length;p++){
    const variance=Math.max(0,a[p]-meanGuide[p]*meanGuide[p]),covariance=b[p]-meanGuide[p]*meanValue[p];
    a[p]=covariance/(variance+.0025);b[p]=meanValue[p]-a[p]*meanGuide[p];
  }
  const meanA=await blur(a,width,height,radius,pause,support),meanB=await blur(b,width,height,radius,pause,support);
  for(let p=0;p<values.length;p++)product[p]=support[p]?meanA[p]*guide[p]+meanB[p]:0;
  return product;
}
/** Continuous weak-noise suppression and extreme compression, no peak normalization. */
function softChange(value:number,threshold:number,limit:number):number {
  const magnitude=Math.abs(value),weak=1-Math.exp(-((magnitude/threshold)**2));
  return limit*Math.tanh(value*weak/limit);
}
/** The uploaded source is sRGB8, even when the saved source/output is16-bit.
 * Remove only that half-code uncertainty before measuring illumination. This
 * keeps an identical native16 return neutral, including near-black samples.
 */
function logChange(from:number,to:number):number {
  const delta=to-from,adjusted=from+Math.sign(delta)*Math.max(0,Math.abs(delta)-.5/255);
  return Math.log(.02+Math.max(0,adjusted))-Math.log(.02+Math.max(0,from));
}

/**
 * The reference supplies broad illumination/color and source pixels supply all
 * detail. Low-frequency RGB estimates, source-guided smoothing and continuous
 * compression soften structural offsets. This cannot recover physical lighting
 * or remove all broad mismatch artifacts.
 */
export async function deriveRelightLayers(source:Raster,target:Raster,scene:RelightScene,options:RelightLayersOptions={}):Promise<RelightLayerFields> {
  raster(source);raster(target);const s=validateRelightScene(scene);if(!isSrgb(s.source.profile)||!['rgb','rgbcolor','rgbcolormode'].includes(s.source.documentMode.toLowerCase()))throw new Error('实验光影层目前需要已标记的 sRGB RGB 8/16 位原文档；其他颜色空间可明确选择整图重绘');
  let lastYield=Date.now();
  const pause=async()=>{check(options.signal);if(options.yieldControl)await options.yieldControl();else if(Date.now()-lastYield>=12){await new Promise<void>(resolve=>setTimeout(resolve,0));lastYield=Date.now();}check(options.signal);};check(options.signal);
  const size=planRelightMemory(source.width,source.height,source.rgba instanceof Uint16Array?16:8),base=source.width===size.width&&source.height===size.height?source:resize(source,size.width,size.height),width=base.width,height=base.height,n=width*height;
  if(Math.abs(Math.log((target.width/target.height)/(base.width/base.height)))>.12)throw new Error('光影参考图与来源比例不符，无法安全对齐；原始 AI 输出已保留');
  if(options.editMask&&(!(options.editMask instanceof Uint8Array)||options.editMask.length!==n))throw new Error('光影分析蒙版尺寸错误');
  // Reproduce the uploaded model grid and sRGB8 quantization for native16 too.
  const scope=options.editMask?.some(v=>v===0)?options.editMask:undefined;
  const projected=target.width===width&&target.height===height?undefined:await modelProjection(base,target,pause,scope);
  const modelBase=!projected&&rasterMax(base)!==255?convertDepth(base,8):base;
  const comparison=projected?.comparison??(rasterMax(target)===255?modelBase:convertDepth(modelBase,16)),result=projected?.result??target;
  const max=rasterMax(comparison),targetMax=rasterMax(result),sourceMax=rasterMax(base),support=new Uint8Array(n);
  let transparent=0,visible=0,observed=0;
  for(let p=0;p<n;p++)if(!scope||scope[p]>0){
    if(base.rgba[p*4+3]>0)visible++;
    if(base.rgba[p*4+3]===sourceMax){if(result.rgba[p*4+3]<targetMax*.98)transparent++;else{support[p]=255;observed++;}}
  }
  if(transparent/n>.05)throw new Error('AI 光影参考含明显透明或缺失区域；无法提取可靠照明，原始输出已保留');
  if(!visible||!observed)throw new Error('原图没有可提取照明的不透明编辑像素；请检查选区与透明度');
  const radius=Math.max(2,Math.round(Math.min(width,height)/14)),smoothRadius=Math.max(2,Math.round(radius*.75)),chromaRadius=Math.max(3,Math.round(radius*1.6));
  const meanBase=new Float32Array(n),meanTarget=new Float32Array(n),chroma:Float32Array[]=[];
  // Smooth RGB before logs: log-ratio averages amplify shifted dark texture.
  for(let c=0;c<3;c++){
    const from=new Float32Array(n),to=new Float32Array(n),weight=[.2126,.7152,.0722][c];
    for(let p=0;p<n;p++){from[p]=comparison.rgba[p*4+c]/max;to[p]=result.rgba[p*4+c]/targetMax;}
    const lowBase=await blur(await blur(from,width,height,radius,pause,support),width,height,radius,pause,support),lowTarget=await blur(await blur(to,width,height,radius,pause,support),width,height,radius,pause,support),delta=new Float32Array(n);
    for(let p=0;p<n;p++){meanBase[p]+=weight*lowBase[p];meanTarget[p]+=weight*lowTarget[p];delta[p]=logChange(lowBase[p],lowTarget[p]);}
    chroma.push(delta);
  }
  const guide=meanBase,raw=new Float32Array(n);let clipped=0;
  for(let p=0;p<n;p++){
    raw[p]=logChange(meanBase[p],meanTarget[p]);
    for(let c=0;c<3;c++)chroma[c][p]-=raw[p];
    if(support[p]&&Math.abs(raw[p])>.7)clipped++;
  }
  const illumination=await blur(await guided(raw,guide,width,height,smoothRadius,pause,support),width,height,Math.max(1,Math.round(smoothRadius/2)),pause,support);
  for(let c=0;c<3;c++)chroma[c]=await blur(await guided(chroma[c],guide,width,height,chromaRadius,pause,support),width,height,Math.max(2,smoothRadius),pause,support);
  const amounts={shadow:new Float32Array(n),'cast-shadow':new Float32Array(n),'color-atmosphere':new Float32Array(n),light:new Float32Array(n),'rim-light':new Float32Array(n)},color=new Float32Array(n*3);
  const keys=s.lights.filter(l=>l.enabled&&l.intensity>0&&l.role!=='rim'),rims=s.lights.filter(l=>l.enabled&&l.intensity>0&&l.role==='rim'),enabled=[...keys,...rims],edge=new Float32Array(n);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,left=y*width+Math.max(0,x-1),right=y*width+Math.min(width-1,x+1),up=Math.max(0,y-1)*width+x,down=Math.min(height-1,y+1)*width+x;
    // Broad source geometry only labels existing light; never restore fine edges.
    if(support[left]&&support[right]&&support[up]&&support[down])edge[p]=Math.max(0,Math.hypot(guide[right]-guide[left],guide[down]-guide[up])*radius-.02);
  }
  let receiverObserved=false;
  for(let y=0;y<height;y++){if(y%16===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x;if(!support[p])continue;
    const nx=(x+.5)/width,ny=(y+.5)/height,d=softChange(illumination[p],.025,illumination[p]<0?.7:.55),b=clamp(meanBase[p]),desired=clamp(b*Math.exp(d));
    const positive=d>0&&b<1?clamp((desired-b)/(1-b),0,.45):0,negative=d<0?clamp(1-Math.exp(d),0,.65)*s.shadow.strength:0;
    const key=keys.reduce((v,l)=>Math.max(v,lightWeight(l,nx,ny)),0),rim=rims.reduce((v,l)=>Math.max(v,lightWeight(l,nx,ny)),0),rimSupport=clamp(edge[p]*2),rimShare=clamp(rim*rimSupport/(Math.max(.25,key)+rim*rimSupport));
    amounts.light[p]=positive*(1-rimShare);amounts['rim-light'][p]=positive*rimShare;
    // Divide observed darkness only; do not manufacture a cast projection.
    let receiver=0;
    if(negative>.003&&edge[p]<.08)for(const l of enabled){
      const [dx,dy]=upstream(l,nx,ny);
      for(const distance of [1,2,3]){const qx=Math.round(x+dx*radius*distance),qy=Math.round(y+dy*radius*distance);if(qx<0||qx>=width||qy<0||qy>=height)continue;const q=qy*width+qx;if(support[q])receiver=Math.max(receiver,clamp(edge[q]*3));}
    }
    const castShare=clamp(receiver)*clamp(1-edge[p]*8),cast=negative*castShare;if(cast>.003)receiverObserved=true;
    amounts['cast-shadow'][p]=cast;amounts.shadow[p]=clamp(1-(1-negative)/(1-cast));
    const r=softChange(chroma[0][p],.018,.18),g=softChange(chroma[1][p],.018,.18),blue=softChange(chroma[2][p],.018,.18),span=Math.max(r,g,blue)-Math.min(r,g,blue),alpha=clamp(span*1.7,0,.4);
    if(alpha<.002)continue;amounts['color-atmosphere'][p]=alpha;color[p*3]=clamp(.5*Math.exp(r*3));color[p*3+1]=clamp(.5*Math.exp(g*3));color[p*3+2]=clamp(.5*Math.exp(blue*3));
  }}
  const channels:RelightFieldChannel[]=[],states:RelightLayerFields['summary']['channels']={shadow:'not-observed','cast-shadow':receiverObserved?'not-observed':'no-reliable-receiver','color-atmosphere':'not-observed',light:'not-observed','rim-light':rims.length?'not-observed':'no-rim-light'};
  for(const kind of ['shadow','cast-shadow','color-atmosphere','light','rim-light'] as const){
    let energy=0,peak=0;for(const v of amounts[kind]){energy+=v;peak=Math.max(peak,v);}energy/=n;
    if(peak>=.004&&energy>=.00001){states[kind]='present';channels.push({kind,blendMode:kind==='color-atmosphere'?'color':kind==='shadow'||kind==='cast-shadow'?'multiply':'screen',amount:amounts[kind],...(kind==='color-atmosphere'?{color}:{}),energy});}
  }
  const warnings=['柔和光影由单张参考估计大范围明暗与色调；严重结构错位仍可能留下宽泛明暗伪影，硬阴影和细窄轮廓光会被柔化。'];
  if(clipped/observed>.01)warnings.push('部分照明超过安全增益范围，已柔和压缩强度以保留高光和暗部细节。');
  if(!receiverObserved)warnings.push('没有可靠且获准修改的承影区域，本场景未创建 Cast Shadow。');
  return {version:'relight-fields-v1',width,height,source:s.source,sceneFingerprint:sceneFingerprint(s),guide,channels,summary:{method:'soft-guided-v1',clippedFraction:clipped/observed,warnings,channels:states}};
}

export function validateRelightLayerFields(fields:RelightLayerFields):void {
  if(!fields||fields.version!=='relight-fields-v1'||!Number.isSafeInteger(fields.width)||!Number.isSafeInteger(fields.height)||fields.width<1||fields.height<1||fields.width*fields.height>IMAGE_BUDGETS.analysisPixels||!(fields.guide instanceof Float32Array)||fields.guide.length!==fields.width*fields.height||!Array.isArray(fields.channels)||fields.channels.length>5)throw new Error('光影影响场版本、尺寸或预算无效');
  const kinds=new Set<RelightChannelKind>(),order:RelightChannelKind[]=['shadow','cast-shadow','color-atmosphere','light','rim-light'];let previous=-1;
  if(fields.guide.some(v=>!Number.isFinite(v)||v<0||v>1)||!fields.source||typeof fields.sceneFingerprint!=='string'||!fields.sceneFingerprint)throw new Error('光影来源或引导数据无效');
  for(const c of fields.channels){
    const position=order.indexOf(c.kind);
    if(position<0||position<=previous||kinds.has(c.kind)||c.blendMode!==(c.kind==='color-atmosphere'?'color':c.kind==='shadow'||c.kind==='cast-shadow'?'multiply':'screen')||!(c.amount instanceof Float32Array)||c.amount.length!==fields.width*fields.height||c.amount.some(v=>!Number.isFinite(v)||v<0||v>1)||!c.amount.some(v=>v>0)||!Number.isFinite(c.energy)||c.energy<=0||c.kind==='color-atmosphere'&&(!(c.color instanceof Float32Array)||c.color.length!==c.amount.length*3||c.color.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('光影通道数据无效');
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
    for(let c=0;c<3;c++)rgba[p+c]=Math.round(max*(channel.blendMode==='multiply'?1-a:channel.blendMode==='screen'?a:sample(channel.color!,fields.width,fields.height,sx,sy,3,c)));
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
    const a=channel.amount[p];if(!a)continue;
    if(channel.blendMode==='color'){
      const before=[base.rgba[p*4]/max,base.rgba[p*4+1]/max,base.rgba[p*4+2]/max],mixed=colorBlend(before,[channel.color![p*3],channel.color![p*3+1],channel.color![p*3+2]]);
      for(let c=0;c<3;c++)base.rgba[p*4+c]=Math.round(max*(before[c]*(1-a)+mixed[c]*a));
    }else for(let c=0;c<3;c++){const b=base.rgba[p*4+c]/max;base.rgba[p*4+c]=Math.round(max*(channel.blendMode==='multiply'?b*(1-a):1-(1-b)*(1-a)));}
  }
  return base;
}
