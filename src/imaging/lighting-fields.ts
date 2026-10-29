import {resize,convertDepth,rasterMax,type Raster} from './image';
import {planRelightMemory} from './budget';

export interface LightingExtractionSettings {fidelity:number;detailProtection:number}
export const DEFAULT_LIGHTING_EXTRACTION:Readonly<LightingExtractionSettings>=Object.freeze({fidelity:1,detailProtection:.65});
export function validateLightingExtractionSettings(value?:unknown):LightingExtractionSettings {
  if(value===undefined)return {...DEFAULT_LIGHTING_EXTRACTION};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='fidelity'&&k!=='detailProtection'))throw new Error('光影提取设置无效');
  const v=value as Record<string,unknown>;
  for(const key of ['fidelity','detailProtection'])if(typeof v[key]!=='number'||!Number.isFinite(v[key])||v[key]<0||v[key]>1)throw new Error('光影提取设置须为 0–1 的有限数值');
  return {fidelity:v.fidelity as number,detailProtection:v.detailProtection as number};
}
export interface LightingFieldsOptions {signal?:AbortSignal;yieldControl?:()=>Promise<void>;editMask?:Uint8Array;extraction?:LightingExtractionSettings}
export const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));
function check(signal?:AbortSignal):void {if(signal?.aborted){const error=new Error('光影层处理已取消');error.name='AbortError';throw error;}}
export function validateLightingRaster(image:Raster):void {
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
/** Blend keeps a full observation window at image borders by shifting it
 * inward; tiny truncated windows can mistake displaced texture for light.
 * Excluded mask samples still never contribute. Relight keeps its old window.
 */
async function blur(values:Float32Array,width:number,height:number,radius:number,pause:()=>Promise<void>,mask?:Uint8Array,fullWindow=false):Promise<Float32Array> {
  const tmp=new Float32Array(values.length),out=new Float32Array(values.length),weights=new Float32Array(values.length),r=Math.max(1,Math.round(radius));
  const included=(p:number)=>!mask||mask[p]>0?1:0;
  for(let y=0;y<height;y++){
    if(y%32===0)await pause();let sum=0,weight=0;for(let x=0;x<=Math.min(fullWindow?r*2:r,width-1);x++){const p=y*width+x,a=included(p);sum+=values[p]*a;weight+=a;}
    for(let x=0;x<width;x++){
      const p=y*width+x;tmp[p]=sum;weights[p]=weight;
      if(fullWindow){
        const left=Math.max(0,Math.min(width-1-r*2,x-r)),next=Math.max(0,Math.min(width-1-r*2,x+1-r));
        if(next>left){const add=y*width+next+r*2,remove=y*width+left;sum+=values[add]*included(add);weight+=included(add);sum-=values[remove]*included(remove);weight-=included(remove);}
      }else{
        if(x+r+1<width){const add=y*width+x+r+1;sum+=values[add]*included(add);weight+=included(add);}
        if(x-r>=0){const remove=y*width+x-r;sum-=values[remove]*included(remove);weight-=included(remove);}
      }
    }
  }
  for(let x=0;x<width;x++){
    if(x%64===0)await pause();let sum=0,weight=0;for(let y=0;y<=Math.min(fullWindow?r*2:r,height-1);y++){const p=y*width+x;sum+=tmp[p];weight+=weights[p];}
    for(let y=0;y<height;y++){
      const p=y*width+x;out[p]=weight>0?sum/weight:0;
      if(fullWindow){
        const top=Math.max(0,Math.min(height-1-r*2,y-r)),next=Math.max(0,Math.min(height-1-r*2,y+1-r));
        if(next>top){const add=(next+r*2)*width+x,remove=top*width+x;sum+=tmp[add];weight+=weights[add];sum-=tmp[remove];weight-=weights[remove];}
      }else{
        if(y+r+1<height){const add=(y+r+1)*width+x;sum+=tmp[add];weight+=weights[add];}
        if(y-r>=0){const remove=(y-r)*width+x;sum-=tmp[remove];weight-=weights[remove];}
      }
    }
  }
  return out;
}
/** Local linear filtering on a de-textured source guide. Binary support is
 * used in every mean; gray feather coverage remains exclusively external.
 * The regularization limits edge following without comparing image structure.
 */
async function guided(values:Float32Array,guide:Float32Array,width:number,height:number,radius:number,pause:()=>Promise<void>,support:Uint8Array,fullWindow=false):Promise<Float32Array> {
  const meanGuide=await blur(guide,width,height,radius,pause,support,fullWindow),meanValue=await blur(values,width,height,radius,pause,support,fullWindow),product=new Float32Array(values.length);
  for(let p=0;p<values.length;p++)product[p]=guide[p]*guide[p];
  const a=await blur(product,width,height,radius,pause,support,fullWindow);
  for(let p=0;p<values.length;p++)product[p]=guide[p]*values[p];
  const b=await blur(product,width,height,radius,pause,support,fullWindow);
  for(let p=0;p<values.length;p++){
    const variance=Math.max(0,a[p]-meanGuide[p]*meanGuide[p]),covariance=b[p]-meanGuide[p]*meanValue[p];
    a[p]=covariance/(variance+.0025);b[p]=meanValue[p]-a[p]*meanGuide[p];
  }
  const meanA=await blur(a,width,height,radius,pause,support,fullWindow),meanB=await blur(b,width,height,radius,pause,support,fullWindow);
  for(let p=0;p<values.length;p++)product[p]=support[p]?meanA[p]*guide[p]+meanB[p]:0;
  return product;
}
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const encoded=(v:number)=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
const BLACK_FLOOR=.0005,MAX_LOG_GAIN=Math.log(32);

/** Filter linear RGB before division so displaced dark texture cannot dominate
 * a log-ratio average. All scales use the same binary authorized support.
 * The fine band is optional; middle-scale shading survives the default setting.
 */
async function multiscaleRatio(from:Float32Array,to:Float32Array,width:number,height:number,pause:()=>Promise<void>,support:Uint8Array,detailProtection:number,profile:'relight'|'blend'):Promise<Float32Array> {
  // Cubic protection leaves the default at form scale and progressively
  // approaches relight's conservative middle/broad radii at maximum protection.
  const short=Math.min(width,height),radii=profile==='blend'?[Math.max(1,Math.round(short/320)),Math.max(2,Math.round(short/(160-118*detailProtection**3))),Math.max(3,Math.round(short/(64-50*detailProtection**3)))]:[Math.max(1,Math.round(short/160)),Math.max(2,Math.round(short/42)),Math.max(3,Math.round(short/14))];
  // Blend must retain observed face/limb form shading, which is narrower than
  // whole-object illumination. Keep the fine redraw band strongly suppressed;
  // estimate most of the ratio at form scale rather than averaging it away.
  const fine=.4*(1-detailProtection)**3,broad=profile==='blend'?.1+.3*detailProtection**3:.1+.3*detailProtection,weights=[fine,1-fine-broad,broad],out=new Float32Array(from.length);
  for(let band=0;band<radii.length;band++){
    if(!weights[band])continue;const radius=radii[band];
    const lowFrom=await blur(await blur(from,width,height,radius,pause,support,profile==='blend'),width,height,radius,pause,support,profile==='blend'),lowTo=await blur(await blur(to,width,height,radius,pause,support,profile==='blend'),width,height,radius,pause,support,profile==='blend');
    for(let p=0;p<out.length;p++)if(support[p])out[p]+=weights[band]*Math.log((Math.max(0,lowTo[p])+BLACK_FLOOR)/(Math.max(0,lowFrom[p])+BLACK_FLOOR));
  }
  return out;
}

/** Scene-independent, bounded analysis. It filters lighting, never the source content. */
export async function estimateLightingFields(source:Raster,target:Raster,options:LightingFieldsOptions={},requireOpaque=false,profile:'relight'|'blend'='relight'){
  validateLightingRaster(source);validateLightingRaster(target);const extraction=validateLightingExtractionSettings(options.extraction);
  let lastYield=Date.now();
  const pause=async()=>{check(options.signal);if(options.yieldControl)await options.yieldControl();else if(Date.now()-lastYield>=12){await new Promise<void>(resolve=>setTimeout(resolve,0));lastYield=Date.now();}check(options.signal);};check(options.signal);
  const size=planRelightMemory(source.width,source.height,source.rgba instanceof Uint16Array?16:8),width=size.width,height=size.height,n=width*height;
  if(Math.abs(Math.log((target.width/target.height)/(width/height)))>.12)throw new Error('光影参考图与来源比例不符，无法安全对齐；原始 AI 输出已保留');
  if(options.editMask&&(!(options.editMask instanceof Uint8Array)||options.editMask.length!==n))throw new Error('光影分析蒙版尺寸错误');
  // Reproduce the uploaded model grid and sRGB8 quantization for native16 too.
  const scope=options.editMask?.some(v=>v===0)?options.editMask:undefined;
  // Inspect original pixels before interpolation can discard an isolated alpha
  // defect or round it up to opaque. The bounded mask denotes analysis-cell
  // support; all original pixel centers in those cells must be opaque too.
  if(requireOpaque){const max=rasterMax(source);for(let y=0;y<source.height;y++){
    if(y%16===0)await pause();const row=Math.min(height-1,Math.floor((y+.5)*height/source.height))*width;
    for(let x=0;x<source.width;x++)if((!scope||scope[row+Math.min(width-1,Math.floor((x+.5)*width/source.width))]>0)&&source.rgba[(y*source.width+x)*4+3]!==max)throw new Error('光影提取需要有效作用范围内完全不透明的 RGB 来源；请明确选择 AI 重绘主体或使用不透明副本');
  }}
  const base=source.width===width&&source.height===height?source:resize(source,width,height);
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
  const radius=Math.max(2,Math.round(Math.min(width,height)/(profile==='blend'?96:14))),smoothRadius=Math.max(1,Math.round(Math.min(width,height)/(profile==='blend'?320:160))),rawGuide=new Float32Array(n);
  for(let p=0;p<n;p++)rawGuide[p]=luminance(comparison.rgba[p*4]/max,comparison.rgba[p*4+1]/max,comparison.rgba[p*4+2]/max);
  const guide=await blur(await blur(rawGuide,width,height,radius,pause,support,profile==='blend'),width,height,radius,pause,support,profile==='blend'),ratios:Float32Array[]=[];
  // The model sees sRGB8. Ignore only its half-code uncertainty, including an
  // identical native16 return; never quantize the content that will be applied.
  for(let c=0;c<3;c++){
    const from=new Float32Array(n),to=new Float32Array(n);
    for(let p=0;p<n;p++){const a=comparison.rgba[p*4+c]/max,b=result.rgba[p*4+c]/targetMax,delta=b-a;from[p]=linear(a);to[p]=linear(a+Math.sign(delta)*Math.max(0,Math.abs(delta)-.5/255));}
    const values=await multiscaleRatio(from,to,width,height,pause,support,extraction.detailProtection,profile);
    ratios.push(await guided(values,guide,width,height,smoothRadius,pause,support,profile==='blend'));
  }
  return {base,width,height,n,sourceMax,support,observed,radius,guide,ratios,pause,extraction};
}

/** Convert a bounded linear-light ratio into RGB Multiply/Screen amounts on original pixels. */
export function lightingAmounts(raw:number,b:number,fidelity:number):{negative:number;positive:number;limited:boolean}{
  const bounded=clamp(raw,-MAX_LOG_GAIN,MAX_LOG_GAIN),d=bounded*(1-Math.exp(-((Math.abs(bounded)/.008)**2)))*fidelity,gain=Math.exp(d);
  const desiredLinear=linear(b)*gain+BLACK_FLOOR*Math.max(0,gain-1),desired=encoded(clamp(desiredLinear));
  return {negative:desired<b&&b>0?clamp(1-desired/b):0,positive:desired>b&&b<1?clamp((desired-b)/(1-b)):0,limited:raw!==bounded||desiredLinear<0||desiredLinear>1};
}
