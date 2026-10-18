import type {Raster} from '../../imaging/image';

/** A mathematical baseline only; these conditions are not native acceptance. */
export interface RelightCompensationConditions {
  colorSpace:'encoded-srgb';documentProfile:string;
  blend:{order:'multiply-screen';opacity:1;fillOpacity:1;group:'isolated-with-base';gamma:'encoded-srgb';mask:'none'};
}
export interface RelightErrorMetrics {maxAbs:number;meanAbs:number;rmse:number}
export interface RelightCompensation {
  dark:Raster;light:Raster;reconstructed:Raster;
  error:{samples:number;code:RelightErrorMetrics;normalized:RelightErrorMetrics};
}
export function relightCompensationAvailability():{available:false;reason:string} {
  return {available:false,reason:'Apply is unavailable until independent Photoshop composite and visual validation pass. Keep the complete result layer as the available output.'};
}
function raster(image:Raster):8|16 {
  if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>16_000_000)throw new Error('Invalid compensation dimensions; use aligned images of at most 16 million pixels and apply the complete result instead');
  if(!(image.rgba instanceof Uint8Array||image.rgba instanceof Uint16Array)||image.rgba.length!==image.width*image.height*4)throw new Error('Compensation requires a valid 8/16-bit RGBA buffer; apply the complete result instead');
  return image.rgba instanceof Uint16Array?16:8;
}
function object(value:unknown,keys:readonly string[],label:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new Error(`Unsupported ${label}; use the complete result output`);
  return value as Record<string,unknown>;
}
/**
 * Per-channel encoded-sRGB Multiply then Screen decomposition. No mask, ICC
 * conversion, source alpha, fill opacity or group opacity is applied here.
 * These numeric multiplier/screen maps are not photographs, physical lighting
 * channels, or safely ICC-convertible assets. They may include AI content edits.
 */
export function decomposeRelightCompensation(base:Raster,target:Raster,conditions:RelightCompensationConditions):RelightCompensation {
  const depth=raster(base),targetDepth=raster(target);
  if(base.width!==target.width||base.height!==target.height)throw new Error('Compensation dimensions must be aligned; keep the complete result output');
  if(depth!==targetDepth)throw new Error('Compensation images must have the same depth; keep the complete result output');
  const c=object(conditions,['colorSpace','documentProfile','blend'],'compensation conditions');
  if(c.colorSpace!=='encoded-srgb')throw new Error('Compensation requires the fixed encoded sRGB numeric space; apply the complete result instead');
  if(typeof c.documentProfile!=='string'||!/^sRGB(?: IEC61966-2\.1)?$/i.test(c.documentProfile.trim()))throw new Error('Confirm the native document profile is sRGB before compensation; use the complete result for unknown or non-sRGB profiles');
  const blend=object(c.blend,['order','opacity','fillOpacity','group','gamma','mask'],'blend settings');
  if(blend.order!=='multiply-screen'||blend.opacity!==1||blend.fillOpacity!==1||blend.group!=='isolated-with-base'||blend.gamma!=='encoded-srgb'||blend.mask!=='none')throw new Error('Unsupported blend order, opacity, group, gamma or mask; compensation requires an isolated fixed base, Multiply then Screen at full opacity with no mask. Apply the complete result instead');
  const max=depth===16?65535:255;
  for(let i=3;i<base.rgba.length;i+=4)if(base.rgba[i]!==max||target.rgba[i]!==max)throw new Error('Compensation requires fully opaque alpha in both images; use the complete result with the existing transparency policy');
  const pixels=(image:Raster):Raster=>({width:image.width,height:image.height,rgba:depth===16?new Uint16Array(image.rgba.length):new Uint8Array(image.rgba.length)});
  const dark=pixels(base),light=pixels(base),reconstructed=pixels(base);let maxAbs=0,sum=0,squares=0;
  for(let i=0;i<base.rgba.length;i++){
    if(i%4===3){dark.rgba[i]=light.rgba[i]=reconstructed.rgba[i]=max;continue;}
    const b=base.rgba[i]/max,r=target.rgba[i]/max;
    // Equality handles B=R=0 and B=R=1 before either denominator can be zero.
    dark.rgba[i]=r<b?Math.round(r/b*max):max;
    light.rgba[i]=r>b?Math.round((r-b)/(1-b)*max):0;
    const d=dark.rgba[i]/max,l=light.rgba[i]/max;
    reconstructed.rgba[i]=Math.round((1-(1-b*d)*(1-l))*max);
    const error=Math.abs(reconstructed.rgba[i]-target.rgba[i]);maxAbs=Math.max(maxAbs,error);sum+=error;squares+=error*error;
  }
  const samples=base.width*base.height*3,code={maxAbs,meanAbs:sum/samples,rmse:Math.sqrt(squares/samples)};
  return {dark,light,reconstructed,error:{samples,code,normalized:{maxAbs:code.maxAbs/max,meanAbs:code.meanAbs/max,rmse:code.rmse/max}}};
}
