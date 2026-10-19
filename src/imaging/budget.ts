import type {Bounds,Raster} from './image';

/** Local document, analysis and write budgets are independent of untrusted PNG/model limits. */
export const IMAGE_BUDGETS=Object.freeze({documentPixels:45_000_000,documentSide:30_000,analysisPixels:1_048_576,analysisSide:1536,editPixels:4_194_304,editSide:4096,stripPixels:262_144,workingBytes:512_000_000});
export class ImageBudgetError extends Error {readonly code='image-budget';constructor(message:string){super(message);this.name='ImageBudgetError';}}
export function checkDocumentSize(width:number,height:number):void {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||Math.max(width,height)>IMAGE_BUDGETS.documentSide)throw new ImageBudgetError('原文档尺寸无效；单边不得超过 30000 像素');
  if(width*height>IMAGE_BUDGETS.documentPixels)throw new ImageBudgetError('原文档超过 4500 万像素；请在副本中缩小文档或分开处理');
}
export interface RelightMemoryPlan {width:number;height:number;estimatedPeakBytes:number;nativePixels:number;stripPixels:number}
/** Ordinary native ROI still has its existing16M cap and a separate byte gate. */
export function planNativeCaptureMemory(width:number,height:number,depth:8|16,retainedBytes=0):{estimatedPeakBytes:number} {
  checkDocumentSize(width,height);if(width*height>16_000_000)throw new ImageBudgetError('区域须为有效尺寸且不超过 1600 万像素');
  if(depth!==8&&depth!==16||!Number.isSafeInteger(retainedBytes)||retainedBytes<0)throw new ImageBudgetError('原生图像内存估算无效');
  // Native Imaging/getData, owned RGBA and restore/encode copies, three gray
  // planes, plus bounded previews/transport. This is a static upper estimate.
  const estimatedPeakBytes=width*height*((depth===16?8:4)*4+3)+96_000_000+retainedBytes;
  if(estimatedPeakBytes>IMAGE_BUDGETS.workingBytes)throw new ImageBudgetError(`原生区域预计需要 ${Math.ceil(estimatedPeakBytes/1_000_000)} MB，超过 ${IMAGE_BUDGETS.workingBytes/1_000_000} MB 预算；请缩小选区，布光可使用低分辨率分析`);
  return {estimatedPeakBytes};
}
export function planRelightMemory(width:number,height:number,depth:8|16,availableBytes:number=IMAGE_BUDGETS.workingBytes,retainedBytes=0):RelightMemoryPlan {
  checkDocumentSize(width,height);if(depth!==8&&depth!==16)throw new Error('不支持的原文档位深');
  const scale=Math.min(1,Math.sqrt(IMAGE_BUDGETS.analysisPixels/(width*height)),IMAGE_BUDGETS.analysisSide/Math.max(width,height));
  const w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
  // Exact native selection/effective/protection planes; old + replacement
  // capture overlap; bounded filter work; native/host strip copies. The 96MB
  // reserve includes a saved Protection plane (45MB), four small previews/PNGs
  // and current model transport. Other live captures are explicit retainedBytes.
  // Photoshop's pre-existing document cache and other plugins are not measured.
  const stripPixels=Math.min(width*height,IMAGE_BUDGETS.stripPixels),analysisWork=w*h*128,recaptureWork=width*height*6+w*h*(depth===16?24:12);
  if(!Number.isSafeInteger(retainedBytes)||retainedBytes<0)throw new ImageBudgetError('已保留图像的内存估算无效');
  const estimatedPeakBytes=Math.max(width*height*3+analysisWork,recaptureWork)+stripPixels*(depth===16?32:16)+96_000_000+retainedBytes;
  if(!Number.isSafeInteger(availableBytes)||availableBytes<1||estimatedPeakBytes>availableBytes)throw new ImageBudgetError(`图像内存预算不足：预计峰值 ${Math.ceil(estimatedPeakBytes/1_000_000)} MB，预算 ${Math.floor(availableBytes/1_000_000)} MB；请缩小作用范围`);
  return {width:w,height:h,estimatedPeakBytes,nativePixels:width*height,stripPixels};
}
/** Ordinary edits retain native gray planes, while all RGBA work stays bounded. */
export function planEditAnalysisMemory(width:number,height:number,depth:8|16,resolution=1024,retainedBytes=0):RelightMemoryPlan {
  checkDocumentSize(width,height);
  if(depth!==8&&depth!==16||!Number.isInteger(resolution)||resolution<32||resolution>2048||resolution%32||!Number.isSafeInteger(retainedBytes)||retainedBytes<0)throw new ImageBudgetError('编辑工作图分辨率或内存估算无效');
  const nativePixels=width*height,stripPixels=Math.min(nativePixels,IMAGE_BUDGETS.stripPixels),workBytes=depth===16?48:28;
  // Up to four native mask planes (background subject/raw-edit/effective/
  // protection), bounded read/compare/write strips and transport
  // reserve. Previous captures, range caches and previews are retainedBytes.
  // Photoshop's existing document cache is outside this plugin estimate.
  const fixed=nativePixels*4+stripPixels*(depth===16?48:24)+96_000_000+retainedBytes;
  const requested=Math.min(nativePixels,resolution*resolution,IMAGE_BUDGETS.editPixels),allowed=Math.min(requested,Math.floor((IMAGE_BUDGETS.workingBytes-fixed)/workBytes));
  if(allowed<Math.min(requested,65_536))throw new ImageBudgetError('图像内存预算不足，无法分配受控编辑工作图；请缩小作用范围或释放已有预览');
  const scale=Math.min(1,Math.sqrt(allowed/nativePixels),IMAGE_BUDGETS.editSide/Math.max(width,height));
  let w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
  // A one-pixel-wide native image cannot shrink its short side further.
  if(w*h>allowed){if(w>=h)w=Math.max(1,Math.floor(allowed/h));else h=Math.max(1,Math.floor(allowed/w));}
  const estimatedPeakBytes=fixed+w*h*workBytes;
  if(w*h>allowed||estimatedPeakBytes>IMAGE_BUDGETS.workingBytes)throw new ImageBudgetError('编辑工作图超过图像内存预算');
  return {width:w,height:h,estimatedPeakBytes,nativePixels,stripPixels};
}
export function planEditApplyMemory(width:number,height:number,depth:8|16,modelBytes:number,maskBytes:number,retainedBytes=0):{estimatedPeakBytes:number} {
  checkDocumentSize(width,height);
  if(depth!==8&&depth!==16||![modelBytes,maskBytes,retainedBytes].every(v=>Number.isSafeInteger(v)&&v>=0))throw new ImageBudgetError('原生回填内存估算无效');
  const estimatedPeakBytes=maskBytes+modelBytes*2+Math.min(width*height,IMAGE_BUDGETS.stripPixels)*(depth===16?64:32)+96_000_000+retainedBytes;
  if(estimatedPeakBytes>IMAGE_BUDGETS.workingBytes)throw new ImageBudgetError(`原生回填预计需要 ${Math.ceil(estimatedPeakBytes/1_000_000)} MB，超过图像内存预算`);
  return {estimatedPeakBytes};
}
/** Native masks stay single-channel; no full-size RGBA conversion is needed. */
export function resampleGray(mask:Uint8Array,sw:number,sh:number,dw:number,dh:number):Uint8Array {
  checkDocumentSize(sw,sh);checkDocumentSize(dw,dh);
  if(!(mask instanceof Uint8Array)||mask.length!==sw*sh)throw new Error('蒙版尺寸错误');
  if(dw===sw&&dh===sh)return mask.slice();
  const out=new Uint8Array(dw*dh);
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
    const sx=Math.max(0,Math.min(sw-1,(x+.5)*sw/dw-.5)),sy=Math.max(0,Math.min(sh-1,(y+.5)*sh/dh-.5));
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),fx=sx-x0,fy=sy-y0;
    out[y*dw+x]=Math.round((mask[y0*sw+x0]*(1-fx)+mask[y0*sw+x1]*fx)*(1-fy)+(mask[y1*sw+x0]*(1-fx)+mask[y1*sw+x1]*fx)*fy);
  }
  return out;
}
export function downsampleSnapshotMask(snapshot:{bounds:Bounds;mask:Uint8Array},width:number,height:number):Uint8Array {
  return resampleGray(snapshot.mask,snapshot.bounds.right-snapshot.bounds.left,snapshot.bounds.bottom-snapshot.bounds.top,width,height);
}
/** Restore trimming/cache coordinates directly to the bounded analysis grid. */
export function mapCaptureRaster(image:Raster,actual:Bounds,requested:Bounds,level:number,width:number,height:number,pixelLimit:number=IMAGE_BUDGETS.analysisPixels):Raster {
  if(!Number.isSafeInteger(level)||level<0||level>10||!Number.isSafeInteger(pixelLimit)||pixelLimit<1||pixelLimit>IMAGE_BUDGETS.editPixels||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width*height>pixelLimit||width<1||height<1||image.rgba.length!==image.width*image.height*4)throw new Error('分析图缓存坐标或预算无效');
  const scale=2**level,left=actual.left*scale,top=actual.top*scale,right=actual.right*scale,bottom=actual.bottom*scale;
  if(right<=left||bottom<=top)throw new Error('分析图实际范围无效');
  const out=image.rgba instanceof Uint16Array?new Uint16Array(width*height*4):new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const nx=requested.left+(x+.5)*(requested.right-requested.left)/width,ny=requested.top+(y+.5)*(requested.bottom-requested.top)/height;
    if(nx<left||nx>=right||ny<top||ny>=bottom)continue;
    const sx=Math.max(0,Math.min(image.width-1,(nx-left)*image.width/(right-left)-.5)),sy=Math.max(0,Math.min(image.height-1,(ny-top)*image.height/(bottom-top)-.5)),x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
    const indices=[(y0*image.width+x0)*4,(y0*image.width+Math.min(x0+1,image.width-1))*4,(Math.min(y0+1,image.height-1)*image.width+x0)*4,(Math.min(y0+1,image.height-1)*image.width+Math.min(x0+1,image.width-1))*4],weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
    const p=(y*width+x)*4;let alpha=0;for(let k=0;k<4;k++)alpha+=image.rgba[indices[k]+3]*weights[k];out[p+3]=Math.round(alpha);
    for(let c=0;c<3;c++){let v=0;for(let k=0;k<4;k++)v+=image.rgba[indices[k]+c]*image.rgba[indices[k]+3]*weights[k];out[p+c]=alpha?Math.round(v/alpha):0;}
  }
  return {width,height,rgba:out};
}
/** Nonoverlapping strips; kernels run on bounded analysis fields before upsampling. */
export function* imageStrips(bounds:Bounds,pixelLimit=IMAGE_BUDGETS.stripPixels):Generator<Bounds> {
  const width=bounds.right-bounds.left,height=bounds.bottom-bounds.top;checkDocumentSize(width,height);
  if(!Object.values(bounds).every(Number.isSafeInteger)||bounds.left<0||bounds.top<0||!Number.isSafeInteger(pixelLimit)||pixelLimit<width)throw new Error('图像条带预算或坐标无效');
  const rows=Math.max(1,Math.floor(pixelLimit/width));
  for(let top=bounds.top;top<bounds.bottom;top+=rows)yield {left:bounds.left,top,right:bounds.right,bottom:Math.min(bounds.bottom,top+rows)};
}
