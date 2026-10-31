import {IMAGE_BUDGETS,ImageBudgetError,checkDocumentSize,planEditApplyMemory,type RelightMemoryPlan} from './budget';
import {makeMapping,checkSize} from './image';

interface Size {width:number;height:number}
export interface BlendBudgetInput extends Size {depth:8|16;analysis:Size;model:Size;outputDepth:8|16;outputBytes?:number;retainedBytes?:number}
const bytesPerPixel=(depth:8|16)=>depth===16?8:4;
function pngBytes(model:Size,depth:8|16):number {return model.width*model.height*bytesPerPixel(depth)+model.height+65_536;}

/** Same saved-grid peak for preflight, previews, reprocessing and application. */
export function planBlendCandidateMemory(input:BlendBudgetInput):{estimatedPeakBytes:number} {
  const {width,height,depth,analysis,model,outputDepth,retainedBytes=0}=input;
  checkDocumentSize(width,height);checkSize(model.width,model.height);
  if(![8,16].includes(depth)||![8,16].includes(outputDepth)||![analysis.width,analysis.height].every(v=>Number.isSafeInteger(v)&&v>0)||analysis.width>width||analysis.height>height||analysis.width*analysis.height>IMAGE_BUDGETS.analysisPixels||Math.max(analysis.width,analysis.height)>IMAGE_BUDGETS.analysisSide)throw new ImageBudgetError('溶图分析尺寸或位深无效');
  const sourceBytes=analysis.width*analysis.height*bytesPerPixel(depth),modelBytes=model.width*model.height*bytesPerPixel(outputDepth),outputBytes=input.outputBytes??pngBytes(model,outputDepth);
  if(!Number.isSafeInteger(outputBytes)||outputBytes<0)throw new ImageBudgetError('溶图输出内存估算无效');
  // The common writer helper doubles its raster argument: source/decoder copies,
  // model transformations and 128 B per analysis pixel for lighting extraction.
  return planEditApplyMemory(width,height,depth,sourceBytes*2+modelBytes*3+outputBytes+analysis.width*analysis.height*64,width*height*3,retainedBytes);
}

/** Adapt only the analysis grid. Native masks and the requested model grid stay exact. */
export function planBlendMemory(width:number,height:number,depth:8|16,resolution=1024,outputDepth:8|16=8,retainedBytes=0):RelightMemoryPlan {
  checkDocumentSize(width,height);
  if(![8,16].includes(depth)||![8,16].includes(outputDepth)||!Number.isSafeInteger(retainedBytes)||retainedBytes<0)throw new ImageBudgetError('溶图位深或已保留内存估算无效');
  const model=makeMapping({left:0,top:0,right:width,bottom:height},resolution),nativePixels=width*height,stripPixels=Math.min(nativePixels,IMAGE_BUDGETS.stripPixels),bpp=bytesPerPixel(depth);
  const grid=(pixels:number):Size=>{
    const scale=Math.min(1,Math.sqrt(pixels/nativePixels),IMAGE_BUDGETS.analysisSide/Math.max(width,height));
    let w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
    if(w*h>pixels){if(w>=h)w=Math.max(1,Math.floor(pixels/h));else h=Math.max(1,Math.floor(pixels/w));}
    return {width:w,height:h};
  };
  const peak=(analysis:Size):number=>{
    const n=analysis.width*analysis.height;
    // Old captures/candidates are in retainedBytes. Reserve the new capture's
    // three native planes and RGBA plus one ready candidate's mask/RGBA/PNG.
    // The selection-recovery cache shares its raw native plane with the capture.
    const live=retainedBytes+nativePixels*4+n*(bpp+Math.max(bpp,bytesPerPixel(outputDepth)))+pngBytes(model,outputDepth);
    const candidate=planBlendCandidateMemory({width,height,depth,analysis,model,outputDepth,retainedBytes:live}).estimatedPeakBytes;
    const capture=Math.max(nativePixels*3+n*128,nativePixels*6+n*bpp*3)+stripPixels*bpp*4+96_000_000+retainedBytes;
    return Math.max(capture,candidate);
  };
  const maximum=Math.min(nativePixels,IMAGE_BUDGETS.analysisPixels),minimum=Math.min(maximum,65_536);
  let low=minimum,high=maximum,best:RelightMemoryPlan|undefined;
  while(low<=high){
    const pixels=Math.floor((low+high)/2),analysis=grid(pixels);let estimatedPeakBytes=Infinity;
    try{estimatedPeakBytes=peak(analysis);}catch(error){if(!(error instanceof ImageBudgetError))throw error;}
    if(estimatedPeakBytes<=IMAGE_BUDGETS.workingBytes){best={...analysis,estimatedPeakBytes,nativePixels,stripPixels};low=pixels+1;}else high=pixels-1;
  }
  if(!best)throw new ImageBudgetError('溶图内存预算不足，无法保留原尺寸蒙版和候选；请降低生成分辨率，或关闭已有结果预览后重试');
  return best;
}
