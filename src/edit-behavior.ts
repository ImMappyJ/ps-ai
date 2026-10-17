import {Raster,convertDepth,rasterMax} from './image';
import {isBackgroundMode} from './intent';

export function editBehavior(mode:string,requested:{guide?:boolean;preserveAlpha?:boolean;alignSubject?:boolean},backend='comfyui') {
  const background=isBackgroundMode(mode);
  const preserveAlpha=!background&&requested.preserveAlpha!==false;
  return {guide:requested.guide===true&&!(background&&backend==='comfyui'),preserveAlpha,alignSubject:preserveAlpha&&requested.alignSubject!==false};
}
// The saved capture retains its real alpha. Only the model input gets an opaque
// canvas for background replacement, so RGBA conditioning does not imply cutout.
export function editModelInput(mode:string,image:Raster):Raster {
  const result=convertDepth(image,8);
  if(isBackgroundMode(mode))for(let p=0;p<result.rgba.length;p+=4){const a=result.rgba[p+3]/255;for(let c=0;c<3;c++)result.rgba[p+c]=Math.round(result.rgba[p+c]*a+255*(1-a));result.rgba[p+3]=255;}
  return result;
}
export function backgroundCoverage(image:Raster,mask:Uint8Array):number {
  if(mask.length!==image.width*image.height)throw new Error('蒙版尺寸错误');
  const max=rasterMax(image);let weight=0,covered=0;
  for(let p=0;p<mask.length;p++){weight+=mask[p];covered+=mask[p]*image.rgba[p*4+3]/max;}
  return weight?covered/weight:1;
}
