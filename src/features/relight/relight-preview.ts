import type {Raster} from '../../imaging/image';
import Pako from 'pako';
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

interface Field {weights:Float32Array;color:[number,number,number];intensity:number}
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
  const renderer=new RelightPreviewRenderer(prepareRelightPreview(source,mask,options));
  try{return await renderer.render(scene,options);}finally{renderer.clear();}
}
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value>>>1^((value&1)?0xedb88320:0);return value>>>0;});
function previewChunk(kind:string,data:Uint8Array):Uint8Array {
  const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);
  for(let i=0;i<4;i++)out[4+i]=kind.charCodeAt(i);out.set(data,8);let crc=0xffffffff;
  for(let i=4;i<out.length-4;i++)crc=crc>>>8^crcTable[(crc^out[i])&255];view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;
}
/** Small UI-only PNG: avoid UPNG's filter/compression search during a gesture. */
export function encodeRelightDragPreview(image:Raster):Uint8Array {
  if(!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||Math.max(image.width,image.height)>240)throw new Error('Drag preview must be bounded to 240 pixels per edge');
  if(!(image.rgba instanceof Uint8Array)||image.rgba.length!==image.width*image.height*4)throw new Error('Drag preview requires an 8-bit RGBA buffer');
  const head=new Uint8Array(13),view=new DataView(head.buffer);view.setUint32(0,image.width);view.setUint32(4,image.height);head[8]=8;head[9]=6;
  const stride=image.width*4+1,scan=new Uint8Array(image.height*stride);
  for(let y=0;y<image.height;y++)scan.set(image.rgba.subarray(y*image.width*4,(y+1)*image.width*4),y*stride+1);
  const deflate=Pako.deflate as unknown as (data:Uint8Array,options:{level:0})=>Uint8Array;
  const chunks=[new Uint8Array([137,80,78,71,13,10,26,10]),previewChunk('IHDR',head),previewChunk('sRGB',new Uint8Array([0])),previewChunk('IDAT',deflate(scan,{level:0})),previewChunk('IEND',new Uint8Array())];
  const result=new Uint8Array(chunks.reduce((size,chunk)=>size+chunk.length,0));let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}

export interface RelightPreviewRenderStats {renders:number;fieldBuilds:number;fieldCacheHits:number;cancelled:number;cachedBytes:number}
function geometryKey(light:RelightLight):string {
  if(light.type==='directional')return JSON.stringify([light.type,light.direction,light.elevation,light.softness]);
  return JSON.stringify([light.type,light.x,light.y,light.z,light.range,light.softness,...(light.type==='spot'?[light.targetX,light.targetY,light.cone]:[])]);
}
/** Owns only small immutable preview buffers and at most one weight map per enabled light. */
export class RelightPreviewRenderer {
  private prepared:RelightPreparedPreview;
  private fields=new Map<string,{key:string;weights:Float32Array}>();private revision=0;
  private counters={renders:0,fieldBuilds:0,fieldCacheHits:0,cancelled:0};
  constructor(prepared:RelightPreparedPreview){
    validRaster(prepared.image);
    if(Math.max(prepared.image.width,prepared.image.height)>1024||!(prepared.mask instanceof Uint8Array)||prepared.mask.length!==prepared.image.width*prepared.image.height)throw new Error('Renderer requires a bounded prepared preview and matching mask');
    this.prepared={image:{...prepared.image,rgba:prepared.image.rgba.slice()},mask:prepared.mask.slice()};
  }
  get stats():RelightPreviewRenderStats {return {...this.counters,cachedBytes:[...this.fields.values()].reduce((sum,field)=>sum+field.weights.byteLength,0)};}
  clear():void {this.revision++;this.fields.clear();}
  async render(scene:RelightScene,options:RelightPreviewOptions={}):Promise<Raster> {
    if(options.yield!==undefined&&typeof options.yield!=='function')throw new Error('Invalid preview yield callback');
    if(options.cancelled!==undefined&&typeof options.cancelled!=='function')throw new Error('Invalid preview cancellation callback');
    const revision=this.revision,s=validateRelightScene(scene),check=()=>{if(revision!==this.revision||options.cancelled?.())throw new RelightPreviewAbortError();};
    check();this.counters.renders++;
    const {image,mask:coverage}=this.prepared,{width,height}=image,rgba=image.rgba.slice() as Uint8Array,short=Math.min(width,height),aspectX=width/short,aspectY=height/short;
    const yieldWork=options.yield??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));let lastYield=Date.now();
    const checkpoint=async()=>{
      check();
      // A timer is a real host yield, with a nonzero scheduling cost on Windows.
      // Yield by elapsed CPU budget, rather than once for every tiny fixed chunk.
      if(options.yield||Date.now()-lastYield>=8){await yieldWork();lastYield=Date.now();check();}
    };
    try{
      const active=s.lights.filter(light=>light.enabled&&light.intensity>0),ids=new Set(active.map(light=>light.id)),fields:Field[]=[];
      for(const id of this.fields.keys())if(!ids.has(id))this.fields.delete(id);
      for(const light of active){
        check();const key=geometryKey(light),cached=this.fields.get(light.id);let weights:Float32Array;
        if(cached?.key===key){weights=cached.weights;this.counters.fieldCacheHits++;}
        else {
          weights=new Float32Array(width*height);const unit={...light,intensity:1};
          for(let start=0;start<weights.length;start+=8192){
            for(let p=start;p<Math.min(start+8192,weights.length);p++)if(coverage[p]&&rgba[p*4+3])weights[p]=influence(unit,(p%width+.5)/width,(Math.floor(p/width)+.5)/height,aspectX,aspectY);
            await checkpoint();
          }
          check();this.fields.set(light.id,{key,weights});this.counters.fieldBuilds++;
        }
        fields.push({weights,color:rgb(light.color),intensity:light.intensity});
      }
      const ambient=rgb({mode:'custom',hex:s.ambient.color}),ar=ambient[0]*s.ambient.intensity,ag=ambient[1]*s.ambient.intensity,ab=ambient[2]*s.ambient.intensity;
      for(let start=0;start<width*height;start+=8192){
        for(let p=start;p<Math.min(start+8192,width*height);p++){
          const amount=coverage[p]/255;if(amount===0||rgba[p*4+3]===0)continue;
          let er=ar,eg=ag,eb=ab;
          for(const field of fields){const weight=field.weights[p]*field.intensity;er+=field.color[0]*weight;eg+=field.color[1]*weight;eb+=field.color[2]*weight;}
          const energy=[er,eg,eb];
          for(let c=0;c<3;c++){const base=rgba[p*4+c],lit=base+(255-base)*(1-Math.exp(-energy[c]*.65));rgba[p*4+c]=Math.round(base+(lit-base)*amount);}
        }
        await checkpoint();
      }
      check();return {width,height,rgba};
    }catch(error){if(error instanceof RelightPreviewAbortError)this.counters.cancelled++;throw error;}
  }
}
