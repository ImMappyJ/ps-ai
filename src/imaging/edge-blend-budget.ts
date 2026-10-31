import {checkDocumentSize,IMAGE_BUDGETS,ImageBudgetError,planNativeCaptureMemory,planEditAnalysisMemory,planEditApplyMemory,type RelightMemoryPlan} from './budget';
import {checkSize,makeMapping} from './image';

interface Size {width:number;height:number}
const bpp=(depth:8|16)=>depth===16?8:4;
/** Four live native planes: saved effective, raw, protection and the verified result. */
export function planEdgeBlendCandidate(width:number,height:number,depth:8|16,source:Size,model:Size,outputDepth:8|16,outputBytes:number,retainedBytes=0){
  checkDocumentSize(width,height);checkSize(source.width,source.height);checkSize(model.width,model.height);
  if(![8,16].includes(depth)||![8,16].includes(outputDepth)||source.width>width||source.height>height||!Number.isSafeInteger(outputBytes)||outputBytes<0)throw new ImageBudgetError('边缘融合内存估算无效');
  return planEditApplyMemory(width,height,depth,source.width*source.height*bpp(depth)*2+model.width*model.height*bpp(outputDepth)*3+outputBytes,width*height*4,retainedBytes);
}
/** A native capture may fit while verifying and preparing its result does not. */
export function planEdgeBlendCapture(width:number,height:number,depth:8|16,resolution=1024,outputDepth:8|16=8,retainedBytes=0):RelightMemoryPlan|undefined {
  checkDocumentSize(width,height);
  const model=makeMapping({left:0,top:0,right:width,bottom:height},resolution),pixels=width*height,png=model.width*model.height*bpp(outputDepth)+model.height+65_536;
  const peak=(source:Size,native:boolean)=>{
    const n=source.width*source.height;
    // Capture's three planes + recovery cache + one ready candidate mask.
    // Bounded recovery shares the capture's raw plane; native recovery copies it.
    const live=retainedBytes+pixels*(native?5:4)+n*(bpp(depth)+Math.max(bpp(depth),bpp(outputDepth)))+png;
    return planEdgeBlendCandidate(width,height,depth,source,model,outputDepth,png,live).estimatedPeakBytes;
  };
  try{planNativeCaptureMemory(width,height,depth,retainedBytes);peak({width,height},true);return;}catch(error){if(!(error instanceof ImageBudgetError))throw error;}
  const capture=planEditAnalysisMemory(width,height,depth,resolution,retainedBytes);
  let low=Math.min(capture.width*capture.height,65_536),high=capture.width*capture.height,best:RelightMemoryPlan|undefined;
  while(low<=high){
    const count=Math.floor((low+high)/2),scale=Math.min(1,Math.sqrt(count/pixels),IMAGE_BUDGETS.editSide/Math.max(width,height));
    let w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
    if(w*h>count){if(w>=h)w=Math.max(1,Math.floor(count/h));else h=Math.max(1,Math.floor(count/w));}
    try{best={...capture,width:w,height:h,estimatedPeakBytes:Math.max(capture.estimatedPeakBytes,peak({width:w,height:h},false))};low=count+1;}catch(error){if(!(error instanceof ImageBudgetError))throw error;high=count-1;}
  }
  if(!best)throw new ImageBudgetError('边缘融合内存预算不足，无法保留原尺寸蒙版和候选；请降低生成分辨率或释放已有预览');
  return best;
}
