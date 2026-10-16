import {Raster,Bounds,checkSize,resize,expandPixels,pixelArray,rasterMax,rasterDepth,convertDepth} from './image';

function valid(image:Raster){checkSize(image.width,image.height);if(image.rgba.length!==image.width*image.height*4)throw new Error('RGBA 缓冲区尺寸错误');}
export function alphaBounds(image:Raster):Bounds|undefined {
  valid(image);let left=image.width,top=image.height,right=0,bottom=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.rgba[(y*image.width+x)*4+3]>=16*rasterMax(image)/255){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  return right>left&&bottom>top?{left,top,right,bottom}:undefined;
}
export function retainSourceAlpha(image:Raster,source:Raster):Raster {
  valid(image);valid(source);if(image.width!==source.width||image.height!==source.height)throw new Error('透明轮廓尺寸不匹配');
  source=convertDepth(source,rasterDepth(image));const rgba=pixelArray(image,image.rgba.length);
  for(let i=0;i<rgba.length;i+=4){const alpha=source.rgba[i+3],coverage=alpha?Math.min(1,image.rgba[i+3]/alpha):0;rgba[i+3]=alpha;
    for(let c=0;c<3;c++)rgba[i+c]=alpha?Math.round(image.rgba[i+c]*coverage+source.rgba[i+c]*(1-coverage)):0;
  }
  return {width:image.width,height:image.height,rgba};
}
function alignTransparent(image:Raster,source:Raster):Raster {
  if(!image.rgba.some((v,i)=>i%4===3&&v<16*rasterMax(image)/255)||!source.rgba.some((v,i)=>i%4===3&&v<16*rasterMax(source)/255))return image;
  const from=alphaBounds(image),to=alphaBounds(source);if(!from||!to)return image;
  const w=from.right-from.left,h=from.bottom-from.top,tw=to.right-to.left,th=to.bottom-to.top;
  // Extremely different silhouettes are not reliable anchors; leave them for manual review.
  if(w<2||h<2||tw/w<.25||tw/w>4||th/h<.25||th/h>4)return image;
  const full={left:0,top:0,right:image.width,bottom:image.height};
  const crop=expandPixels(image,full,from);
  return expandPixels(resize(crop,tw,th),to,full);
}
function matchContext(image:Raster,source:Raster,mask:Uint8Array):Raster {
  if(mask.length!==image.width*image.height)throw new Error('颜色匹配蒙版尺寸不匹配');
  const hist=Array.from({length:3},()=>new Uint32Array(97));let count=0;
  source=convertDepth(source,rasterDepth(image));const scale=rasterMax(image)/255;
  const stride=Math.max(1,Math.ceil(mask.length/100000));
  for(let p=0;p<mask.length;p+=stride){const i=p*4;if(mask[p]!==0||source.rgba[i+3]<224*scale||image.rgba[i+3]<224*scale)continue;
    const delta=[0,1,2].map(c=>Math.round((source.rgba[i+c]-image.rgba[i+c])/scale));if(delta.some(v=>Math.abs(v)>48))continue;
    delta.forEach((v,c)=>hist[c][v+48]++);count++;
  }
  if(count<64)return image;
  const bias=hist.map(bins=>{let n=0;for(let j=0;j<bins.length;j++){n+=bins[j];if(n>=Math.ceil(count/2))return j-48;}return 0;});
  if(bias.some(v=>Math.abs(v)>32))return image;
  const rgba=image.rgba.slice();for(let i=0;i<rgba.length;i+=4)if(rgba[i+3])for(let c=0;c<3;c++)rgba[i+c]=Math.min(rasterMax(image),Math.max(0,rgba[i+c]+bias[c]*scale));
  return {...image,rgba};
}
export interface EditOptions {preserveAlpha:boolean;align:boolean;matchColor?:boolean;mask?:Uint8Array}
export function prepareEditCandidate(image:Raster,source:Raster,options:EditOptions):Raster {
  valid(image);valid(source);const modelSource=resize(source,image.width,image.height);
  let result=options.preserveAlpha&&options.align?alignTransparent(image,modelSource):image;
  if(options.matchColor&&options.mask)result=matchContext(result,modelSource,options.mask);
  return options.preserveAlpha?retainSourceAlpha(result,modelSource):{...result,rgba:result.rgba.slice()};
}
