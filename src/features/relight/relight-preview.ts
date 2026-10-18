import type {Raster} from '../../imaging/image';
import {validateRelightScene,type RelightColor,type RelightLight,type RelightScene} from './relight-scene';

export interface RelightPreviewOptions {maxEdge?:number;cancelled?:()=>boolean;yield?:()=>Promise<void>}
export interface RelightPreviewPreparationOptions {maxEdge?:number;cancelled?:()=>boolean}
export interface RelightPreparedPreview {image:Raster;mask:Uint8Array}
export class RelightPreviewAbortError extends Error {
  constructor(){super('Relight preview cancelled; keep the current editor configuration');this.name='AbortError';}
}
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
function validRaster(image:Raster):void {
  if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>16_000_000)throw new Error('Invalid preview dimensions; recapture a region of at most 16 million pixels');
  if(!(image.rgba instanceof Uint8Array||image.rgba instanceof Uint16Array)||image.rgba.length!==image.width*image.height*4)throw new Error('Preview requires a valid 8/16-bit RGBA buffer');
}
/** Preview colors are an encoded-sRGB intention swatch, not calibrated spectra. */
function rgb(color:RelightColor):[number,number,number] {
  if(color.mode==='custom')return [parseInt(color.hex.slice(1,3),16)/255,parseInt(color.hex.slice(3,5),16)/255,parseInt(color.hex.slice(5,7),16)/255];
  const t=color.kelvin/100;
  const red=t<=66?255:329.698727446*(t-60)**-.1332047592;
  const green=t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*(t-60)**-.0755148492;
  const blue=t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307;
  return [clamp(red,0,255)/255,clamp(green,0,255)/255,clamp(blue,0,255)/255];
}

interface Field {light:RelightLight;color:[number,number,number]}
function influence(l:RelightLight,x:number,y:number,aspectX:number,aspectY:number):number {
  if(l.type==='directional'){
    // A broad image-plane field expresses bearing. Position/range never supply
    // distance attenuation for a directional light; there is no recovered normal.
    const bearing=l.direction*Math.PI/180,elevation=l.elevation*Math.PI/180;
    const projection=(x-.5)*Math.cos(bearing)+(y-.5)*Math.sin(bearing);
    const broad=clamp(.55+projection*.6*(1-l.softness*.65),.05,1);
    return l.intensity*broad*(.55+.45*(Math.sin(elevation)+1)/2);
  }
  const dx=(x-l.x)*aspectX,dy=(y-l.y)*aspectY,dz=l.type==='spot'&&l.z===0?.035:l.z*.35;
  const distance=Math.sqrt(dx*dx+dy*dy+dz*dz),inner=l.range*(1-l.softness*.85);
  if(distance>=l.range)return 0;
  const edge=distance<=inner?1:1-clamp((distance-inner)/(l.range-inner||1));
  let value=l.intensity*edge*edge*(3-2*edge)/(1+2*(distance/l.range)**2)*(.65+.35*(l.z+1)/2);
  if(l.type==='spot'){
    const tx=(l.targetX-l.x)*aspectX,ty=(l.targetY-l.y)*aspectY,tz=-dz;
    const targetLength=Math.hypot(tx,ty,tz),pixelLength=Math.hypot(dx,dy,dz);
    // Coincident source/target aims at the image plane from a small virtual
    // front offset; it remains a direction sketch, never a physical cone.
    const cosine=targetLength&&pixelLength?clamp((dx*tx+dy*ty-dz*tz)/(targetLength*pixelLength),-1,1):1;
    const angle=Math.acos(cosine),outer=l.cone*Math.PI/360,inside=outer*(1-l.softness*.8);
    if(angle>=outer)return 0;
    const cone=angle<=inside?1:1-clamp((angle-inside)/(outer-inside||1));value*=cone*cone*(3-2*cone);
  }
  return value;
}

/** Prepare once per capture; neither the original raster nor effective mask is changed. */
export function prepareRelightPreview(source:Raster,mask:Uint8Array,options:RelightPreviewPreparationOptions={}):RelightPreparedPreview {
  validRaster(source);
  if(!(mask instanceof Uint8Array)||mask.length!==source.width*source.height)throw new Error('Preview mask must match the source dimensions');
  const maxEdge=options.maxEdge??480;
  if(!Number.isInteger(maxEdge)||maxEdge<1||maxEdge>1024)throw new Error('Preview maxEdge must be an integer from 1 to 1024');
  if(options.cancelled!==undefined&&typeof options.cancelled!=='function')throw new Error('Invalid preview cancellation callback');
  const check=()=>{if(options.cancelled?.())throw new RelightPreviewAbortError();};check();
  const ratio=Math.min(1,maxEdge/Math.max(source.width,source.height));
  const width=Math.max(1,Math.round(source.width*ratio)),height=Math.max(1,Math.round(source.height*ratio));
  const rgba=new Uint8Array(width*height*4),coverage=new Uint8Array(width*height),max=source.rgba instanceof Uint16Array?65535:255;
  if(width===source.width&&height===source.height){
    // Cached sRGB8 previews take a straight copy path, without interpolation or
    // multiplying alpha/mask again. The caller may safely reuse this cache.
    if(max===255)rgba.set(source.rgba);
    for(let y=0;y<height;y++){
      check();
      for(let x=0;x<width;x++){
        const p=y*width+x;
        if(max!==255)for(let c=0;c<4;c++)rgba[p*4+c]=Math.round(source.rgba[p*4+c]/max*255);
        coverage[p]=rgba[p*4+3]?mask[p]:0;
      }
    }
    return {image:{width,height,rgba},mask:coverage};
  }
  // RGB and edit coverage use the same visible-alpha weights. A transparent
  // editable sample must not illuminate a protected visible sample. Divide by
  // the summed alpha once; apply this effective mask once later, to RGB only.
  for(let y=0;y<height;y++){
    check();
    const sy=clamp((y+.5)*source.height/height-.5,0,source.height-1),y0=Math.floor(sy),y1=Math.min(y0+1,source.height-1),fy=sy-y0;
    for(let x=0;x<width;x++){
      const sx=clamp((x+.5)*source.width/width-.5,0,source.width-1),x0=Math.floor(sx),x1=Math.min(x0+1,source.width-1),fx=sx-x0;
      const indices=[y0*source.width+x0,y0*source.width+x1,y1*source.width+x0,y1*source.width+x1];
      const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy],p=y*width+x;let alpha=0,m=0;
      for(let k=0;k<4;k++){const visible=source.rgba[indices[k]*4+3]*weights[k];alpha+=visible;m+=mask[indices[k]]*visible;}
      rgba[p*4+3]=Math.round(alpha/max*255);coverage[p]=rgba[p*4+3]&&alpha?Math.round(m/alpha):0;
      for(let c=0;c<3;c++){
        let value=0;
        for(let k=0;k<4;k++)value+=source.rgba[indices[k]*4+c]*source.rgba[indices[k]*4+3]*weights[k];
        rgba[p*4+c]=alpha?Math.round(value/alpha/max*255):0;
      }
    }
  }
  return {image:{width,height,rgba},mask:coverage};
}

/**
 * CPU influence sketch only: no cast shadows, surface highlights, depth map or
 * material/occlusion simulation. Supply a resolved sRGB source and frozen
 * effective mask M*(1-P), or reuse prepareRelightPreview's private small cache.
 * Native buffers are never changed or used as a model input replacement.
 */
export async function renderRelightPreview(source:Raster,scene:RelightScene,mask:Uint8Array,options:RelightPreviewOptions={}):Promise<Raster> {
  if(options.yield!==undefined&&typeof options.yield!=='function')throw new Error('Invalid preview yield callback');
  const {image,mask:coverage}=prepareRelightPreview(source,mask,options),{width,height,rgba}=image;
  const s=validateRelightScene(scene),check=()=>{if(options.cancelled?.())throw new RelightPreviewAbortError();};
  const fields:Field[]=s.lights.filter(l=>l.enabled&&l.intensity>0).map(light=>({light,color:rgb(light.color)}));
  const ambient=rgb({mode:'custom',hex:s.ambient.color}),short=Math.min(width,height),aspectX=width/short,aspectY=height/short;
  const yieldWork=options.yield??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  for(let start=0;start<width*height;start+=32768){
    check();
    for(let p=start;p<Math.min(start+32768,width*height);p++){
      const amount=coverage[p]/255;if(amount===0||rgba[p*4+3]===0)continue;
      const x=(p%width+.5)/width,y=(Math.floor(p/width)+.5)/height;
      const energy=[ambient[0]*s.ambient.intensity,ambient[1]*s.ambient.intensity,ambient[2]*s.ambient.intensity];
      for(const field of fields){const weight=influence(field.light,x,y,aspectX,aspectY);for(let c=0;c<3;c++)energy[c]+=field.color[c]*weight;}
      for(let c=0;c<3;c++){
        const base=rgba[p*4+c],lit=base+(255-base)*(1-Math.exp(-energy[c]*.65));
        rgba[p*4+c]=Math.round(base+(lit-base)*amount);
      }
    }
    await yieldWork();check();
  }
  return {width,height,rgba};
}
