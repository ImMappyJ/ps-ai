import UPNG from 'upng-js';
import {validatePngColor,ColorContractError} from './color';
import {checkedPixelPng} from './png-decode';

export interface Bounds { left:number; top:number; right:number; bottom:number }
export interface Raster { width:number; height:number; rgba:Uint8Array }
export const MAX_PIXELS=16_000_000;
export function checkSize(width:number,height:number):void {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>MAX_PIXELS) throw new Error('区域须为有效尺寸且不超过 1600 万像素');
}
export function effectiveMask(m:Uint8Array,p?:Uint8Array):Uint8Array {
  if(p&&p.length!==m.length) throw new Error('保护区尺寸与编辑区不同');
  return Uint8Array.from(m,(value,i)=>Math.round(value*(255-(p?.[i]??0))/255));
}
export function makeMapping(bounds:Bounds,resolution:number):{bounds:Bounds;width:number;height:number} {
  const w=bounds.right-bounds.left,h=bounds.bottom-bounds.top;checkSize(w,h);
  if(!Number.isInteger(resolution)||resolution<32||resolution>2048||resolution%32) throw new Error('分辨率须为 32 的倍数，范围 32–2048');
  const ratio=w/h;
  const width=Math.max(32,Math.round(Math.sqrt(resolution*resolution*ratio)/32)*32);
  const height=Math.max(32,Math.round(Math.sqrt(resolution*resolution/ratio)/32)*32);
  checkSize(width,height);return {bounds:{...bounds},width,height};
}
function buffer(bytes:Uint8Array):ArrayBuffer {return new Uint8Array(bytes).buffer;}
export function encodePng(image:Raster):Uint8Array {
  checkSize(image.width,image.height);
  if(image.rgba.length!==image.width*image.height*4) throw new Error('RGBA 缓冲区尺寸错误');
  // UPNG's undocumented final flag avoids palette conversion and retains straight RGBA.
  const encode=UPNG.encode as unknown as (...args:unknown[])=>ArrayBuffer;
  return new Uint8Array(encode([buffer(image.rgba)],image.width,image.height,0,undefined,true));
}
export function decodePng(bytes:Uint8Array,options:{allowUntagged?:boolean}={}):Raster {
  try {
  const sig=[137,80,78,71,13,10,26,10];
  if(bytes.length<33||sig.some((x,i)=>bytes[i]!==x)) throw new Error('需要有效 PNG 图片');
  const view=new DataView(buffer(bytes));checkSize(view.getUint32(16),view.getUint32(20));
  if(bytes[24]!==8) throw new Error('仅支持 8-bit PNG，请先转为 RGB 8-bit PNG');
  validatePngColor(bytes,options.allowUntagged);
  const checked=checkedPixelPng(bytes),image=UPNG.decode(buffer(checked.bytes));
  if(image.frames.length>1) throw new Error('不支持动画 PNG');
  if(checked.paletteEntries!==undefined&&new Uint8Array(image.data).subarray(0,image.width*image.height).some(value=>value>=checked.paletteEntries!))throw new Error('PNG 调色板索引无效');
  return {width:image.width,height:image.height,rgba:new Uint8Array(UPNG.toRGBA8(image)[0])};
  }catch(error){if(error instanceof ColorContractError)throw error;throw new ColorContractError('invalid-output',error instanceof Error?error.message:String(error));}
}
export function decodeModelPng(bytes:Uint8Array,template:string):Raster {
  // Pinned to the tested template, deliberately independent of a future default.
  return decodePng(bytes,{allowUntagged:template==='qwen21-local-v2-rgba'});
}
export function resize(image:Raster,width:number,height:number):Raster {
  checkSize(width,height);checkSize(image.width,image.height);
  if(image.rgba.length!==image.width*image.height*4) throw new Error('RGBA 缓冲区尺寸错误');
  if(width===image.width&&height===image.height) return {width,height,rgba:new Uint8Array(image.rgba)};
  const rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sx=Math.max(0,Math.min(image.width-1,(x+0.5)*image.width/width-0.5));
    const sy=Math.max(0,Math.min(image.height-1,(y+0.5)*image.height/height-0.5));
    const x0=Math.floor(sx),y0=Math.floor(sy),dx=sx-x0,dy=sy-y0;
    const indices=[(y0*image.width+x0)*4,(y0*image.width+Math.min(x0+1,image.width-1))*4,(Math.min(y0+1,image.height-1)*image.width+x0)*4,(Math.min(y0+1,image.height-1)*image.width+Math.min(x0+1,image.width-1))*4];
    const weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy];
    const i=(y*width+x)*4;let alpha=0;
    for(let k=0;k<4;k++) alpha+=image.rgba[indices[k]+3]*weights[k];
    rgba[i+3]=Math.round(alpha);
    for(let c=0;c<3;c++) {let value=0;for(let k=0;k<4;k++) value+=image.rgba[indices[k]+c]*image.rgba[indices[k]+3]*weights[k];rgba[i+c]=alpha?Math.round(value/alpha):0;}
  }
  return {width,height,rgba};
}
export function expandPixels(image:Raster,actual:Bounds,requested:Bounds,level=0):Raster {
  if(!Number.isInteger(level)||level<0||level>10) throw new Error('缓存层级无效');
  const scale=2**level;
  const original={left:Math.round(actual.left*scale),top:Math.round(actual.top*scale),right:Math.round(actual.right*scale),bottom:Math.round(actual.bottom*scale)};
  const width=requested.right-requested.left,height=requested.bottom-requested.top;checkSize(width,height);
  const restored=resize(image,original.right-original.left,original.bottom-original.top);
  const rgba=new Uint8Array(width*height*4);
  for(let y=Math.max(requested.top,original.top);y<Math.min(requested.bottom,original.bottom);y++) {
    const left=Math.max(requested.left,original.left),right=Math.min(requested.right,original.right);
    if(right<=left) continue;
    const start=((y-original.top)*restored.width+left-original.left)*4;
    rgba.set(restored.rgba.subarray(start,start+(right-left)*4),((y-requested.top)*width+left-requested.left)*4);
  }
  return {width,height,rgba};
}
export function maskRaster(mask:Uint8Array,width:number,height:number):Raster {
  checkSize(width,height);if(mask.length!==width*height) throw new Error('蒙版尺寸错误');
  const rgba=new Uint8Array(mask.length*4);for(let i=0;i<mask.length;i++) {rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=mask[i];rgba[i*4+3]=255;}return {width,height,rgba};
}
