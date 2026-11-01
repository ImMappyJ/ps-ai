import {checkDocumentSize} from '../../imaging/budget';

export interface EdgeBlend {version:'outward-v1'|'outward-v2';radius:number}
export const MAX_EDGE_RADIUS=1024;
export function supportsEdgeBlend(mode:string):boolean {return ['edit','costume','reference'].includes(mode);}
export function automaticEdgeRadius(bounds:{left:number;top:number;right:number;bottom:number}):number {
  const side=Math.min(bounds.right-bounds.left,bounds.bottom-bounds.top);
  if(!Number.isFinite(side)||side<=0)throw new Error('边缘融合蒙版或宽度无效');
  return Math.max(8,Math.min(512,Math.round(side*.15)));
}
export function validateEdgeBlend(value:unknown):EdgeBlend {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('边缘融合参数无效');
  const v=value as Record<string,unknown>,keys=Object.getOwnPropertyNames(v);
  if(keys.length!==2||keys.some(k=>!['version','radius'].includes(k)||!('value' in Object.getOwnPropertyDescriptor(v,k)!))||Object.getOwnPropertySymbols(v).length||v.version!=='outward-v1'&&v.version!=='outward-v2'||!Number.isInteger(v.radius)||(v.radius as number)<1||(v.radius as number)>(v.version==='outward-v1'?64:MAX_EDGE_RADIUS))throw new Error('边缘融合参数无效');
  return {version:v.version as EdgeBlend['version'],radius:v.radius as number};
}

/** V2 carries sub-byte falloff in two row buffers, not a full native float plane.
 * Each sweep floors only when saving the byte plane, keeping support conservative.
 * Saved v1 masks retain their original rounding through the legacy dispatcher.
 */
export function edgeBlendMask(raw:Uint8Array,width:number,height:number,value:EdgeBlend,protection?:Uint8Array):Uint8Array {
  const edge=validateEdgeBlend(value);
  if(edge.version==='outward-v1')return outwardBlendMask(raw,width,height,edge.radius,protection);
  checkDocumentSize(width,height);
  if(!(raw instanceof Uint8Array)||raw.length!==width*height||protection!==undefined&&(!(protection instanceof Uint8Array)||protection.length!==raw.length))throw new Error('边缘融合蒙版或宽度无效');
  const out=raw.slice(),step=Math.ceil(65535/(edge.radius+1)),diagonal=Math.ceil(step*Math.SQRT2);
  if(raw.some(v=>v!==255)&&raw.some(v=>v>0)){
    let previous=new Uint16Array(width),row=new Uint16Array(width);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const p=y*width+x;let v=out[p]*257;
        if(x)v=Math.max(v,row[x-1]-step);
        if(y){v=Math.max(v,previous[x]-step);if(x)v=Math.max(v,previous[x-1]-diagonal);if(x+1<width)v=Math.max(v,previous[x+1]-diagonal);}
        row[x]=v;out[p]=Math.floor(v/257);
      }
      [previous,row]=[row,previous];
    }
    for(let y=height-1;y>=0;y--){
      for(let x=width-1;x>=0;x--){
        const p=y*width+x;let v=out[p]*257;
        if(x+1<width)v=Math.max(v,row[x+1]-step);
        if(y+1<height){v=Math.max(v,previous[x]-step);if(x)v=Math.max(v,previous[x-1]-diagonal);if(x+1<width)v=Math.max(v,previous[x+1]-diagonal);}
        row[x]=v;out[p]=Math.floor(v/257);
      }
      [previous,row]=[row,previous];
    }
  }
  if(protection)for(let p=0;p<out.length;p++)out[p]=Math.round(out[p]*(255-protection[p])/255);
  return out;
}

/** Linear outward falloff on the native gray grid. Raw selection stays immutable.
 * Two chamfer passes use one byte per pixel; conservative rounding keeps support
 * within the requested radius, including diagonals. Protection is applied last.
 */
export function outwardBlendMask(raw:Uint8Array,width:number,height:number,radius:number,protection?:Uint8Array):Uint8Array {
  checkDocumentSize(width,height);
  if(!(raw instanceof Uint8Array)||raw.length!==width*height||!Number.isInteger(radius)||radius<0||radius>64||protection!==undefined&&(!(protection instanceof Uint8Array)||protection.length!==raw.length))throw new Error('边缘融合蒙版或宽度无效');
  const out=raw.slice(),step=255/(radius+1),diagonal=step*Math.SQRT2;
  if(radius&&raw.some(v=>v!==255)&&raw.some(v=>v>0)){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=y*width+x;let v=out[p];
      if(x)v=Math.max(v,out[p-1]-step);
      if(y){v=Math.max(v,out[p-width]-step);if(x)v=Math.max(v,out[p-width-1]-diagonal);if(x+1<width)v=Math.max(v,out[p-width+1]-diagonal);}
      out[p]=v;
    }
    for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
      const p=y*width+x;let v=out[p];
      if(x+1<width)v=Math.max(v,out[p+1]-step);
      if(y+1<height){v=Math.max(v,out[p+width]-step);if(x)v=Math.max(v,out[p+width-1]-diagonal);if(x+1<width)v=Math.max(v,out[p+width+1]-diagonal);}
      out[p]=v;
    }
  }
  if(protection)for(let p=0;p<out.length;p++)out[p]=Math.round(out[p]*(255-protection[p])/255);
  return out;
}
