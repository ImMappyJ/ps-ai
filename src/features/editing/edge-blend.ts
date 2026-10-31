import {checkDocumentSize} from '../../imaging/budget';

export interface EdgeBlend {version:'outward-v1';radius:number}
export function validateEdgeBlend(value:unknown):EdgeBlend {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('边缘融合参数无效');
  const v=value as Record<string,unknown>,keys=Object.getOwnPropertyNames(v);
  if(keys.length!==2||keys.some(k=>!['version','radius'].includes(k)||!('value' in Object.getOwnPropertyDescriptor(v,k)!))||Object.getOwnPropertySymbols(v).length||v.version!=='outward-v1'||!Number.isInteger(v.radius)||(v.radius as number)<1||(v.radius as number)>64)throw new Error('边缘融合参数无效');
  return {version:'outward-v1',radius:v.radius as number};
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
