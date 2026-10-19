import {type Bounds,type Raster,checkSize,rasterMax} from './image';
import {IMAGE_BUDGETS,checkDocumentSize} from './budget';

function geometry(bounds:Bounds,strip:Bounds):{width:number;height:number;nativeWidth:number} {
  const nativeWidth=bounds.right-bounds.left;checkDocumentSize(nativeWidth,bounds.bottom-bounds.top);
  const width=strip.right-strip.left,height=strip.bottom-strip.top;
  if(!Object.values(strip).every(Number.isSafeInteger)||strip.left<bounds.left||strip.top<bounds.top||strip.right>bounds.right||strip.bottom>bounds.bottom||width<1||height<1||width*height>IMAGE_BUDGETS.stripPixels)throw new Error('原生回填条带坐标或预算无效');
  return {width,height,nativeWidth};
}
/** Sample absolute native coordinates directly; never resize to native RGBA. */
export function sampleEditStrip(image:Raster,bounds:Bounds,strip:Bounds,depth:8|16):Raster {
  checkSize(image.width,image.height);
  if(image.rgba.length!==image.width*image.height*4||depth!==8&&depth!==16)throw new Error('模型回填像素无效');
  const {width,height,nativeWidth}=geometry(bounds,strip),nativeHeight=bounds.bottom-bounds.top,max=depth===16?65535:255,inputMax=rasterMax(image),rgba=depth===16?new Uint16Array(width*height*4):new Uint8Array(width*height*4);
  const columns=new Uint32Array(width*2),fractions=new Float64Array(width);
  for(let x=0;x<width;x++){const sx=Math.max(0,Math.min(image.width-1,(strip.left-bounds.left+x+.5)*image.width/nativeWidth-.5)),x0=Math.floor(sx);columns[x*2]=x0;columns[x*2+1]=Math.min(image.width-1,x0+1);fractions[x]=sx-x0;}
  for(let y=0;y<height;y++){
    const sy=Math.max(0,Math.min(image.height-1,(strip.top-bounds.top+y+.5)*image.height/nativeHeight-.5)),y0=Math.floor(sy),y1=Math.min(image.height-1,y0+1),fy=sy-y0;
    for(let x=0;x<width;x++){
    const x0=columns[x*2],x1=columns[x*2+1],fx=fractions[x];
    const a=(y0*image.width+x0)*4,b=(y0*image.width+x1)*4,c=(y1*image.width+x0)*4,d=(y1*image.width+x1)*4,w0=(1-fx)*(1-fy),w1=fx*(1-fy),w2=(1-fx)*fy,w3=fx*fy,p=(y*width+x)*4;
    // Typed arrays truncate nonnegative values after +.5, equivalent to round;
    // avoid hundreds of millions of cross-realm Math calls in the UXP panel.
    const alpha=image.rgba[a+3]*w0+image.rgba[b+3]*w1+image.rgba[c+3]*w2+image.rgba[d+3]*w3;rgba[p+3]=alpha/inputMax*max+.5;
    for(let k=0;k<3;k++)rgba[p+k]=alpha?(image.rgba[a+k]*image.rgba[a+3]*w0+image.rgba[b+k]*image.rgba[b+3]*w1+image.rgba[c+k]*image.rgba[c+3]*w2+image.rgba[d+k]*image.rgba[d+3]*w3)/alpha/inputMax*max+.5:0;
    }
  }
  return {width,height,rgba};
}
/** Full-width strip view aliases the immutable native gray plane. */
export function nativeMaskStrip(mask:Uint8Array,bounds:Bounds,strip:Bounds):Uint8Array {
  const {width,height,nativeWidth}=geometry(bounds,strip);
  if(mask.length!==nativeWidth*(bounds.bottom-bounds.top))throw new Error('原生蒙版尺寸错误');
  const start=(strip.top-bounds.top)*nativeWidth+strip.left-bounds.left;
  if(width===nativeWidth)return mask.subarray(start,start+width*height);
  const out=new Uint8Array(width*height);for(let y=0;y<height;y++)out.set(mask.subarray(start+y*nativeWidth,start+y*nativeWidth+width),y*width);return out;
}
