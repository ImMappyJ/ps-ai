import {Bounds,Raster,checkSize,expandPixels,maskRaster,effectiveMask,resize,convertDepth,rasterDepth,rasterMax} from '../../imaging/image';
import {retainSourceAlpha,backgroundEditMask,prepareBackgroundCandidate} from '../../imaging/composite';
import {requireSourceProfile,hasSourceProfile} from '../../imaging/color';
import type {SourceColorReader,SourceColorReason,SavedSourceColor} from './source-color';
import {DiagnosticError} from '../../diagnostics/diagnostics';
import {IMAGE_BUDGETS,ImageBudgetError,checkDocumentSize,planRelightMemory,planNativeCaptureMemory,planEditAnalysisMemory,planEditApplyMemory,imageStrips,mapCaptureRaster,downsampleSnapshotMask} from '../../imaging/budget';
import {sampleEditStrip,nativeMaskStrip} from '../../imaging/native-edit';
import {validateRelightLayerFields,renderRelightLayerStrip,type RelightLayerFields} from '../../features/relight/relight-layers';
import {sha256} from '@noble/hashes/sha2.js';
export interface Snapshot {documentId:number;width:number;height:number;profile:string;mode:string;depth:unknown;nativeDepth?:8|16;historyId:number;sessionId:string;bounds:Bounds;mask:Uint8Array;sourceHash:string;sourceLayerIds?:number[];clipBaseLayerId?:number;requiresClipping?:boolean;colorReason?:SourceColorReason;backgroundComposite?:'subject-background-v1';captureGeometry?:{kind:'relight-analysis'|'edit-analysis';width:number;height:number}}
export interface Capture {snapshot:Snapshot;image:Raster;selectionMask:Uint8Array;protectionMask:Uint8Array;subjectMask?:Uint8Array;workingCopyOf?:number;documentName?:string}
export interface CaptureOptions {context?:'selection'|'document';selection?:'edit'|'subject-background'|'document';preserveNativeDepth?:boolean;purpose?:'relight-analysis';analysisResolution?:number;retainedBytes?:number}
export interface EditAnalysisApplyOptions {preserveAlpha:boolean;subjectMask?:Uint8Array;protectionMask?:Uint8Array;signal?:AbortSignal;onProgress?:(done:number,total:number)=>void;retainedBytes?:number}
export interface Protection {documentId:number;width:number;height:number;bounds:Bounds;mask:Uint8Array;sessionId:string}
/** Geometry only: restoring it grants no permission to apply an old candidate. */
export interface SelectionRange {documentId:number;sessionId:string;width:number;height:number;mode:string;depth:unknown;bounds:Bounds;mask:Uint8Array}
export class PhotoshopAdapter {
  private applications=new Map<string,{documentId:number;historyId:number;layerId:number;sourceIdentity:string}>();
  private maskKeys=new WeakMap<Uint8Array,number>();
  constructor(public ps:any,public sessionId:string,private checkpoint:(stage:string)=>Promise<void>=async()=>{},private readSourceColor:SourceColorReader=async()=>undefined){}
  private activeDocument():any {return this.ps.app.documents.length?this.ps.app.activeDocument:undefined;}
  private profiled(doc:any):boolean {return hasSourceProfile(doc,this.ps.constants.ColorProfileType?.NONE);}
  private sourceState(doc:any):string {return JSON.stringify([doc.id,doc.width,doc.height,doc.mode,doc.bitsPerChannel,doc.colorProfileName,doc.colorProfileType,doc.activeHistoryState.id,doc.path,doc.saved,doc.quickMaskMode]);}
  private async savedColor(doc:any,file?:any):Promise<SavedSourceColor|undefined> {
    // Photoshop has already applied any opening policy/conversion to a tagged
    // document. A stale disk declaration must never reinterpret those pixels.
    if(this.profiled(doc))return;
    const color=await this.readSourceColor(doc,file);
    const depth=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8;
    if(color?.kind!=='srgb'||color.width!==doc.width||color.height!==doc.height||color.depth!==depth||doc.mode!==this.ps.constants.DocumentMode.RGB)requireSourceProfile(doc,this.ps.constants.ColorProfileType?.NONE);
    return color;
  }
  private async colorCopy(doc:any,context:any):Promise<any> {
    const copy=await doc.duplicate(`${doc.name||'PS-AI'} — sRGB`,false);
    if(!copy||copy.id===doc.id)throw new Error('工作副本的 sRGB 配置失败');
    let suspension:any,pending=false;
    try {
      await context.hostControl.registerAutoCloseDocument(copy.id);
      // Commit the assignment as the duplicate's own history baseline. A live
      // profile setter alone can leave the previous, untagged history state as
      // the target of Undo after the first candidate application.
      suspension=await context.hostControl.suspendHistory({documentID:copy.id,name:'ps-ai 工作副本色彩空间'});pending=true;
      copy.colorProfileName='sRGB IEC61966-2.1';
      requireSourceProfile(copy,this.ps.constants.ColorProfileType?.NONE);
      if(copy.colorProfileName!=='sRGB IEC61966-2.1')throw new Error('工作副本的 sRGB 配置失败');
      await context.hostControl.resumeHistory(suspension,true);pending=false;
      requireSourceProfile(copy,this.ps.constants.ColorProfileType?.NONE);
      return copy;
    }catch(error){try{if(pending)await context.hostControl.resumeHistory(suspension,false);}finally{try{await copy.closeWithoutSaving();await context.hostControl.unregisterAutoCloseDocument(copy.id);}finally{this.ps.app.activeDocument=doc;}}throw error;}
  }
  private async rgbData(data:any,depth:8|16=8):Promise<Raster> {
    if(!data||![8,16].includes(data.componentSize)||(data.components!==3&&data.components!==4))throw new Error('没有返回 RGB / RGBA 8/16-bit 数据');
    const values=await data.getData({chunky:true,fullRange:true}),max=data.componentSize===16?65535:255;
    if(values.length!==data.width*data.height*data.components)throw new Error('RGB 像素缓冲区尺寸不符');
    if(data.components===4&&data.componentSize===depth&&Object.prototype.toString.call(values)===(depth===16?'[object Uint16Array]':'[object Uint8Array]'))return {width:data.width,height:data.height,rgba:depth===16?new Uint16Array(values):new Uint8Array(values)};
    const target=depth===16?65535:255;
    const rgba=depth===16?new Uint16Array(data.width*data.height*4):new Uint8Array(data.width*data.height*4);
    for(let i=0;i<data.width*data.height;i++){for(let c=0;c<3;c++)rgba[i*4+c]=Math.round(Math.min(1,Math.max(0,values[i*data.components+c]/max))*target);rgba[i*4+3]=data.components===4?Math.round(Math.min(1,Math.max(0,values[i*4+3]/max))*target):target;}
    return {width:data.width,height:data.height,rgba};
  }
  async importReference(file:any,retainedBytes=0):Promise<Raster> {
    return this.ps.core.executeAsModal(async(context:any)=>{
      const previous=this.activeDocument(),existing=new Set(Array.from(this.ps.app.documents as any[]).map((d:any)=>d.id));
      const doc=await this.ps.app.open(file),owned=!existing.has(doc.id);let data:any,copy:any;
      if(owned)await context.hostControl.registerAutoCloseDocument(doc.id);
      try {
        checkSize(doc.width,doc.height);
        this.checkDocumentFormat(doc);
        planNativeCaptureMemory(doc.width,doc.height,doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,retainedBytes);
        const state=this.sourceState(doc),color=await this.savedColor(doc,file);
        if(state!==this.sourceState(doc))throw new Error('来源文档尺寸、颜色或内容状态已改变，请重新捕获');
        if(color)copy=await this.colorCopy(doc,context);
        const source=copy??doc;
        const bounds={left:0,top:0,right:doc.width,bottom:doc.height};
        const result=await this.ps.imaging.getPixels({documentID:source.id,sourceBounds:bounds,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false});
        data=result.imageData;return expandPixels(await this.rgbData(data),result.sourceBounds,bounds,result.level??0);
      } finally {
        data?.dispose();
        if(copy){await copy.closeWithoutSaving();await context.hostControl.unregisterAutoCloseDocument(copy.id);}
        if(owned){await doc.closeWithoutSaving();await context.hostControl.unregisterAutoCloseDocument(doc.id);}
        if(previous&&Array.from(this.ps.app.documents as any[]).some((d:any)=>d.id===previous.id))this.ps.app.activeDocument=previous;
      }
    },{commandName:'ps-ai 读取并转换参考图'});
  }
  private document():any {
    const doc=this.activeDocument();if(!doc)throw new Error('请先打开 Photoshop 文档');
    checkDocumentSize(doc.width,doc.height);
    this.checkDocumentFormat(doc);
    if(doc.quickMaskMode)throw new Error('请先退出快速蒙版模式');
    return doc;
  }
  private checkDocumentFormat(doc:any):void {
    const modes=[this.ps.constants.DocumentMode.RGB,this.ps.constants.DocumentMode.GRAYSCALE].filter(v=>v!==undefined);
    const depths=[this.ps.constants.BitsPerChannelType.EIGHT,this.ps.constants.BitsPerChannelType.SIXTEEN].filter(v=>v!==undefined);
    if(!modes.includes(doc.mode)||!depths.includes(doc.bitsPerChannel))throw new Error('支持 RGB / 灰度 8/16-bit；其他模式请先在副本中转换为 RGB，原文档不会自动转换');
  }
  private bounds(doc:any,analysis=false):Bounds {
    const b=doc.selection.bounds;if(!b)throw new DiagnosticError('selection-required','capture','请先建立编辑选区');
    const bounds={left:Math.max(0,Math.floor(b.left)),top:Math.max(0,Math.floor(b.top)),right:Math.min(doc.width,Math.ceil(b.right)),bottom:Math.min(doc.height,Math.ceil(b.bottom))};
    if(bounds.right<=bounds.left||bounds.bottom<=bounds.top)throw new DiagnosticError('selection-required','capture','选区为空');
    (analysis?checkDocumentSize:checkSize)(bounds.right-bounds.left,bounds.bottom-bounds.top);return bounds;
  }
  private captureBounds(doc:any,margin:number,fullContext:boolean,whole:boolean,analysis=false):Bounds {
    const selection=whole?{left:0,top:0,right:doc.width,bottom:doc.height}:this.bounds(doc,analysis);
    const pad=Math.max(32,Math.round(Math.min(selection.right-selection.left,selection.bottom-selection.top)*margin));
    const bounds=fullContext?{left:0,top:0,right:doc.width,bottom:doc.height}:{left:Math.max(0,selection.left-pad),top:Math.max(0,selection.top-pad),right:Math.min(doc.width,selection.right+pad),bottom:Math.min(doc.height,selection.bottom+pad)};
    (analysis?checkDocumentSize:checkSize)(bounds.right-bounds.left,bounds.bottom-bounds.top);return bounds;
  }
  private async maskStrips(doc:any,bounds:Bounds,guard:()=>void):Promise<Uint8Array> {
    guard();const selection=this.bounds(doc,true),width=bounds.right-bounds.left,out=new Uint8Array(width*(bounds.bottom-bounds.top));
    for(const strip of imageStrips(bounds)){
      guard();
      // Context is not selected coverage. PS rejects a getSelection request
      // wholly outside its bounding box; untouched output there stays zero.
      // Keep gray values inside the box, including feathers and empty islands.
      const readBounds={left:Math.max(strip.left,selection.left),top:Math.max(strip.top,selection.top),right:Math.min(strip.right,selection.right),bottom:Math.min(strip.bottom,selection.bottom)};
      if(readBounds.right<=readBounds.left||readBounds.bottom<=readBounds.top)continue;
      await this.checkpoint('capture.selection.read');
      const result=await this.ps.imaging.getSelection({documentID:doc.id,sourceBounds:readBounds}),data=result.imageData;
      if(!data)throw new DiagnosticError('selection-required','capture','选区为空');
      try{
        if(data.components!==1||![8,16,32].includes(data.componentSize))throw new Error('选区没有返回可用的灰度数据');
        if(!Number.isSafeInteger(data.width)||!Number.isSafeInteger(data.height)||data.width<1||data.height<1||data.width*data.height>IMAGE_BUDGETS.stripPixels)throw new Error('选区条带尺寸不符');
        const values=await data.getData({chunky:true,fullRange:true}),max=data.componentSize===16?65535:data.componentSize===32?1:255,scale=2**(result.level??0),actual=result.sourceBounds;
        if(!actual||!Object.values(actual).every(Number.isSafeInteger)||actual.right<=actual.left||actual.bottom<=actual.top||!Number.isInteger(result.level??0)||(result.level??0)<0||(result.level??0)>10)throw new Error('选区缓存坐标无效');
        if(values.length!==data.width*data.height||data.width*data.height>IMAGE_BUDGETS.stripPixels)throw new Error('选区条带尺寸不符');
        if(scale===1&&data.componentSize===8&&Object.prototype.toString.call(values)==='[object Uint8Array]'&&data.width===actual.right-actual.left&&data.height===actual.bottom-actual.top){
          const left=Math.max(readBounds.left,actual.left),right=Math.min(readBounds.right,actual.right);
          if(right>left)for(let y=Math.max(readBounds.top,actual.top);y<Math.min(readBounds.bottom,actual.bottom);y++)out.set(values.subarray((y-actual.top)*data.width+left-actual.left,(y-actual.top)*data.width+right-actual.left),(y-bounds.top)*width+left-bounds.left);
          continue;
        }
        for(let y=readBounds.top;y<readBounds.bottom;y++)for(let x=readBounds.left;x<readBounds.right;x++){
          if(x<actual.left*scale||x>=actual.right*scale||y<actual.top*scale||y>=actual.bottom*scale)continue;
          const sx=Math.min(data.width-1,Math.max(0,(x+.5-actual.left*scale)*data.width/((actual.right-actual.left)*scale)-.5)),sy=Math.min(data.height-1,Math.max(0,(y+.5-actual.top*scale)*data.height/((actual.bottom-actual.top)*scale)-.5)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(data.width-1,x0+1),y1=Math.min(data.height-1,y0+1),fx=sx-x0,fy=sy-y0;
          const value=(values[y0*data.width+x0]*(1-fx)+values[y0*data.width+x1]*fx)*(1-fy)+(values[y1*data.width+x0]*(1-fx)+values[y1*data.width+x1]*fx)*fy;
          out[(y-bounds.top)*width+x-bounds.left]=Math.round(Math.max(0,Math.min(1,value/max))*255);
        }
      }finally{data.dispose();await this.checkpoint('capture.selection.disposed');}guard();
    }
    guard();return out;
  }
  private async mask(documentId:number,bounds:Bounds):Promise<Uint8Array> {
    await this.checkpoint('capture.selection.read');
    const result=await this.ps.imaging.getSelection({documentID:documentId,sourceBounds:bounds});
    if(!result.imageData)throw new DiagnosticError('selection-required','capture','选区为空');
    const data=result.imageData;
    try {
      if(![8,16,32].includes(data.componentSize)||data.components!==1)throw new Error('选区没有返回可用的灰度数据');
      const values=await data.getData({chunky:true,fullRange:true});
      const max=data.componentSize===16?65535:data.componentSize===32?1:255;
      const gray=Uint8Array.from(values as ArrayLike<number>,v=>Math.round(Math.max(0,Math.min(1,v/max))*255));
      const mapped=expandPixels(maskRaster(gray,data.width,data.height),result.sourceBounds,bounds,result.level??0);
      const out=new Uint8Array(mapped.width*mapped.height);for(let i=0;i<out.length;i++)out[i]=mapped.rgba[i*4];return out;
    } finally {data.dispose();await this.checkpoint('capture.selection.disposed');}
  }
  private needsClipping(image:Raster,mask:Uint8Array):boolean {
    return mask.some((v,i)=>v>0&&image.rgba[i*4+3]>0&&image.rgba[i*4+3]<rasterMax(image));
  }
  private clippingBase(doc:any,excludeLayerId?:number):any {
    // A top clipping stack may share one base. A separate hidden layer still breaks
    // that stack, so do not skip it or change the user's layer arrangement.
    const layer=Array.from(doc.layers as any[]).find((l:any)=>l.id!==excludeLayerId&&!l.isClippingMask);
    return layer&&layer.visible&&layer.kind===this.ps.constants.LayerKind.NORMAL&&layer.blendMode===this.ps.constants.BlendMode.NORMAL&&layer.opacity===100&&layer.fillOpacity===100?layer:undefined;
  }
  private async captureClippingBase(doc:any,bounds:Bounds,image:Raster,mask:Uint8Array):Promise<number|undefined> {
    if(!this.needsClipping(image,mask))return;
    const base=this.clippingBase(doc);if(!base)return;
    const result=await this.ps.imaging.getPixels({documentID:doc.id,layerID:base.id,sourceBounds:bounds,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false});
    const data=result.imageData;if(!data)return;
    try {
      const pixels=expandPixels(await this.rgbData(data,rasterDepth(image)),result.sourceBounds,bounds,result.level??0);
      if(mask.every((v,i)=>!v||pixels.rgba[i*4+3]===image.rgba[i*4+3]))return base.id;
    } finally {data.dispose();}
  }
  /** Only a bounded native strip may cross the Imaging API/getData boundary. */
  private async sourceStrip(doc:any,bounds:Bounds,depth:8|16,historyId:number,layerId?:number):Promise<Raster> {
    const result=await this.ps.imaging.getPixels({documentID:doc.id,historyStateID:historyId,...(layerId===undefined?{}:{layerID:layerId}),sourceBounds:bounds,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:depth,applyAlpha:false}),data=result.imageData;
    if(!data)throw new Error('来源条带没有可读取像素');
    try{
      const actual=result.sourceBounds;
      if((result.level??0)!==0||![3,4].includes(data.components)||data.componentSize!==depth||!actual||!Object.values(actual).every(Number.isSafeInteger)||actual.right<=actual.left||actual.bottom<=actual.top||data.width!==actual.right-actual.left||data.height!==actual.bottom-actual.top||data.width*data.height>IMAGE_BUDGETS.stripPixels)throw new Error('原生条带尺寸、位深或缓存坐标不符，已停止读取');
      const read=await this.rgbData(data,depth);
      return actual.left===bounds.left&&actual.top===bounds.top&&actual.right===bounds.right&&actual.bottom===bounds.bottom?read:expandPixels(read,actual,bounds,0);
    }finally{data.dispose();}
  }
  private async scanEditSource(doc:any,bounds:Bounds,mask:Uint8Array,guard:()=>void,subjectMask?:Uint8Array,protectionMask?:Uint8Array):Promise<{requiresClipping:boolean;clipBaseLayerId?:number;selectionMask?:Uint8Array}> {
    const depth=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,max=depth===16?65535:255,width=bounds.right-bounds.left,historyId=doc.activeHistoryState.id,base=subjectMask?undefined:this.clippingBase(doc);
    let requiresClipping=false,baseMatches=!!base;const selectionMask=subjectMask?new Uint8Array(mask.length):undefined;
    for(const strip of imageStrips(bounds)){
      guard();const source=await this.sourceStrip(doc,strip,depth,historyId);guard();const start=(strip.top-bounds.top)*width;
      if(subjectMask){
        for(let p=0;p<source.width*source.height;p++){
          const at=start+p,s=subjectMask[at],protection=protectionMask?.[at]??0,partial=source.rgba[p*4+3]<max;
          selectionMask![at]=partial?255:255-s;mask[at]=partial?255-protection:protection?Math.round((255-s)*(255-protection)/255):255-s;
        }
      }else{
        for(let p=0;p<source.width*source.height;p++)if(mask[start+p]&&source.rgba[p*4+3]>0&&source.rgba[p*4+3]<max)requiresClipping=true;
        // A semitransparent edge can occupy one native pixel which the work
        // grid never samples. Compare every effective source/base alpha.
        if(baseMatches){const pixels=await this.sourceStrip(doc,strip,depth,historyId,base.id);guard();for(let p=0;p<source.width*source.height;p++)if(mask[start+p]&&source.rgba[p*4+3]!==pixels.rgba[p*4+3]){baseMatches=false;break;}}
      }
    }
    return {requiresClipping,...(requiresClipping&&baseMatches?{clipBaseLayerId:base.id}:{}),...(selectionMask?{selectionMask}:{})};
  }
  async capture(margin=.15,protection?:Protection,expectedDocumentId=this.activeDocument()?.id,outputDepth:8|16=8,options:CaptureOptions={}):Promise<Capture> {
    if(!Number.isFinite(margin)||margin<0||margin>1)throw new Error('上下文边距无效');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['context','selection','preserveNativeDepth','purpose','analysisResolution','retainedBytes'].includes(k))||options.context!==undefined&&!['selection','document'].includes(options.context)||options.selection!==undefined&&!['edit','subject-background','document'].includes(options.selection)||options.selection==='document'&&options.context==='selection'||options.preserveNativeDepth!==undefined&&typeof options.preserveNativeDepth!=='boolean'||options.purpose!==undefined&&options.purpose!=='relight-analysis'||options.purpose==='relight-analysis'&&options.selection==='subject-background'||options.analysisResolution!==undefined&&(!Number.isInteger(options.analysisResolution)||options.analysisResolution<32||options.analysisResolution>2048||options.analysisResolution%32)||options.retainedBytes!==undefined&&(!Number.isSafeInteger(options.retainedBytes)||options.retainedBytes<0)||![8,16].includes(outputDepth))throw new Error('捕获策略无效');
    const analysis=options.purpose==='relight-analysis';
    const background=options.selection==='subject-background',whole=options.selection==='document',fullContext=background||whole||options.context==='document';
    await this.checkpoint('capture.start');
    const expected=this.document();
    if(expected.id!==expectedDocumentId)throw new Error('活动文档已切换，请在来源文档重新生成');
    // Selection/scope errors must precede asynchronous request-only file access.
    const initialBounds=this.captureBounds(expected,margin,fullContext,whole,true),nativeDepth=expected.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8;
    let memory=analysis?planRelightMemory(initialBounds.right-initialBounds.left,initialBounds.bottom-initialBounds.top,nativeDepth,undefined,options.retainedBytes):undefined,editAnalysis=false;
    if(!analysis)try{planNativeCaptureMemory(initialBounds.right-initialBounds.left,initialBounds.bottom-initialBounds.top,nativeDepth,options.retainedBytes);}catch(error){if(!(error instanceof ImageBudgetError))throw error;memory=planEditAnalysisMemory(initialBounds.right-initialBounds.left,initialBounds.bottom-initialBounds.top,nativeDepth,options.analysisResolution,options.retainedBytes);editAnalysis=true;}
    const bounded=!!memory;
    const selectionState=whole?undefined:JSON.stringify(expected.selection.bounds);
    const state=this.sourceState(expected),color=await this.savedColor(expected);
    return this.ps.core.executeAsModal(async(context:any)=>{
      let doc=this.document();const original=doc;
      if(doc.id!==expectedDocumentId)throw new Error('活动文档已切换，请在来源文档重新生成');
      const bounds=this.captureBounds(doc,margin,fullContext,whole,true);
      if(state!==this.sourceState(doc))throw new Error('来源文档尺寸、颜色或内容状态已改变，请重新捕获');
      if(!whole&&selectionState!==JSON.stringify(doc.selection.bounds))throw new Error('来源或选区已改变，请重新读取原图；原有布光配置已保留');
      const guard=()=>{if(context.isCancelled)throw new DiagnosticError('cancelled','capture','原图读取已取消');if(state!==this.sourceState(doc)||!whole&&selectionState!==JSON.stringify(doc.selection.bounds))throw new Error('来源或选区已改变，请重新读取原图；原有布光配置已保留');};
      let mask=whole?new Uint8Array(doc.width*doc.height).fill(255):bounded?await this.maskStrips(doc,bounds,guard):await this.mask(doc.id,bounds);
      if(!mask.some(v=>v>0))throw new DiagnosticError('selection-required','capture','选区为空');
      let selectionMask=mask;const subjectMask=background?mask:undefined,protectionMask=new Uint8Array(mask.length);
      if(protection) {
        if(protection.sessionId!==this.sessionId||protection.documentId!==doc.id||protection.width!==doc.width||protection.height!==doc.height)throw new Error('保护区来源文档已改变，请重新指定');
        {
          const pw=protection.bounds.right-protection.bounds.left,ph=protection.bounds.bottom-protection.bounds.top;
          if(protection.mask.length!==pw*ph)throw new Error('保护区尺寸错误');
          const left=Math.max(bounds.left,protection.bounds.left),right=Math.min(bounds.right,protection.bounds.right),width=bounds.right-bounds.left;
          if(right>left)for(let y=Math.max(bounds.top,protection.bounds.top);y<Math.min(bounds.bottom,protection.bounds.bottom);y++)protectionMask.set(protection.mask.subarray((y-protection.bounds.top)*pw+left-protection.bounds.left,(y-protection.bounds.top)*pw+right-protection.bounds.left),(y-bounds.top)*width+left-bounds.left);
        }
        mask=effectiveMask(mask,protectionMask);
      }
      if(!background&&!mask.some(v=>v>0))throw new Error('编辑范围完全被保护区覆盖');
      if(background&&editAnalysis&&mask===subjectMask)mask=new Uint8Array(mask.length);
      let copy:any,keepCopy=false;
      try {
        if(color){copy=await this.colorCopy(doc,context);doc=copy;}
        await this.checkpoint('capture.pixels.read');
        const pixelState=this.sourceState(doc);
        const result=await this.ps.imaging.getPixels({documentID:doc.id,sourceBounds:bounds,...(memory?{targetSize:{width:memory.width,height:memory.height}}:{}),colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false});
        const data=result.imageData;
        if(!data)throw new Error('选区上下文没有可读取的像素');
        let image:Raster;
        try {
          if(memory&&(!Number.isSafeInteger(data.width)||!Number.isSafeInteger(data.height)||data.width<1||data.height<1||data.width*data.height>memory.width*memory.height))throw new DiagnosticError('image-budget','capture','Photoshop 返回的分析图超过预算，已停止读取');
          await this.checkpoint('capture.pixels.getData');
          // The background matte must see native alpha, even for an 8-bit
          // provider: 65534 must not round up to an opaque, protected core.
          const captureDepth=options.preserveNativeDepth||bounded?(doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8):background&&doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:outputDepth;
          const read=await this.rgbData(data,captureDepth);
          image=memory?mapCaptureRaster(read,result.sourceBounds,bounds,result.level??0,memory.width,memory.height,editAnalysis?IMAGE_BUDGETS.editPixels:IMAGE_BUDGETS.analysisPixels):expandPixels(read,result.sourceBounds,bounds,result.level??0);
        } finally {data.dispose();await this.checkpoint('capture.pixels.disposed');}
        if(context.isCancelled)throw new DiagnosticError('cancelled','capture','原图读取已取消');
        if(pixelState!==this.sourceState(doc))throw new Error('来源文档尺寸、颜色或内容状态已改变，请重新捕获');
        let nativeScan:{requiresClipping:boolean;clipBaseLayerId?:number;selectionMask?:Uint8Array}|undefined;
        const pixelGuard=()=>{if(context.isCancelled)throw new DiagnosticError('cancelled','capture','原图读取已取消');if(pixelState!==this.sourceState(doc)||!whole&&selectionState!==JSON.stringify(doc.selection.bounds))throw new Error('来源或选区已改变，请重新读取原图');};
        if(editAnalysis){nativeScan=await this.scanEditSource(doc,bounds,mask,pixelGuard,subjectMask,protectionMask);if(nativeScan.selectionMask)selectionMask=nativeScan.selectionMask;}
        if(background&&!editAnalysis){
          selectionMask=backgroundEditMask(image,subjectMask!);
          mask=backgroundEditMask(image,subjectMask!,protectionMask);
        }
        if(background&&!mask.some(v=>v>0))throw new Error('编辑范围完全被保护区覆盖或没有可替换背景');
        if(!background&&fullContext&&!whole){const contextMask=bounded?downsampleSnapshotMask({bounds,mask:selectionMask},image.width,image.height):selectionMask;if(!contextMask.some((s,p)=>s===0&&image.rgba[p*4+3]>=16*rasterMax(image)/255))throw new Error('主体选区外没有可见环境，请保留可见背景作为溶图参考');}
        const visibleMask=bounded?downsampleSnapshotMask({bounds,mask},image.width,image.height):mask;
        if(!background&&(options.preserveNativeDepth||analysis)&&!visibleMask.some((v,p)=>v>0&&image.rgba[p*4+3]>0))throw new Error('作用区域没有可见像素，请选择可见内容后重新读取原图');
        let hash=2166136261;for(const v of image.rgba)hash=Math.imul(hash^v,16777619);
        const clipBaseLayerId=editAnalysis?nativeScan?.clipBaseLayerId:background||analysis?undefined:await this.captureClippingBase(doc,bounds,image,mask);
        const sourceLayerIds:number[]=[];
        const visible=(layers:any[])=>{for(const layer of Array.from(layers)){if(layer.visible===false)continue;if(Number.isSafeInteger(layer.id)&&layer.id>0)sourceLayerIds.push(layer.id);if(layer.layers)visible(layer.layers);}};
        visible(doc.layers);
        const snapshot:Snapshot={documentId:doc.id,width:doc.width,height:doc.height,profile:doc.colorProfileName,mode:doc.mode,depth:doc.bitsPerChannel,nativeDepth:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,historyId:doc.activeHistoryState.id,sessionId:this.sessionId,bounds,mask,sourceHash:(hash>>>0).toString(16),sourceLayerIds,...(memory?{captureGeometry:{kind:editAnalysis?'edit-analysis' as const:'relight-analysis' as const,width:memory.width,height:memory.height}}:{}),...(editAnalysis?{requiresClipping:nativeScan!.requiresClipping}:{}),...(clipBaseLayerId===undefined?{}:{clipBaseLayerId}),...(color?.reason?{colorReason:color.reason}:{}),...(background?{backgroundComposite:'subject-background-v1' as const}:{})};
        if(copy){await context.hostControl.unregisterAutoCloseDocument(copy.id);keepCopy=true;}
        return {snapshot,image,selectionMask,protectionMask,...(typeof doc.name==='string'?{documentName:doc.name}:{}),...(subjectMask?{subjectMask}:{}),...(copy?{workingCopyOf:original.id}:{})};
      }finally{if(copy&&!keepCopy){await copy.closeWithoutSaving();await context.hostControl.unregisterAutoCloseDocument(copy.id);this.ps.app.activeDocument=original;}}
    },{commandName:'ps-ai 捕获选区'});
  }
  async protection():Promise<Protection> {
    const expectedDocumentId=this.activeDocument()?.id;
    return this.ps.core.executeAsModal(async(context:any)=>{
      const doc=this.document();if(doc.id!==expectedDocumentId)throw new Error('保护区来源文档已切换');const bounds=this.bounds(doc,true),state=this.sourceState(doc),selection=JSON.stringify(doc.selection.bounds);
      const guard=()=>{if(context.isCancelled)throw new DiagnosticError('cancelled','capture','保护区读取已取消');if(state!==this.sourceState(doc)||selection!==JSON.stringify(doc.selection.bounds))throw new Error('保护区来源或选区已改变');};
      const mask=await this.maskStrips(doc,bounds,guard);
      return {documentId:doc.id,width:doc.width,height:doc.height,bounds,mask,sessionId:this.sessionId};
    },{commandName:'ps-ai 读取人物保护区'});
  }
  async restoreSelection(range:SelectionRange):Promise<void> {
    const b=range?.bounds;
    if(!range||!b||![range.documentId,range.width,range.height,b.left,b.top,b.right,b.bottom].every(Number.isSafeInteger)||range.documentId<=0||range.width<=0||range.height<=0||b.left<0||b.top<0||b.right>range.width||b.bottom>range.height||b.right<=b.left||b.bottom<=b.top||!(range.mask instanceof Uint8Array)||range.mask.length!==(b.right-b.left)*(b.bottom-b.top)||!range.mask.some(v=>v>0))throw new Error('上次选区范围无效，请重新圈选后预览');
    checkDocumentSize(range.width,range.height);checkDocumentSize(b.right-b.left,b.bottom-b.top);
    const saved:SelectionRange={...range,bounds:{...b},mask:range.mask.slice()};
    const source=()=>{
      if(saved.sessionId!==this.sessionId)throw new Error('上次选区属于已结束的会话，请重新圈选后预览');
      const doc=this.document();
      if(doc.id!==saved.documentId||doc.width!==saved.width||doc.height!==saved.height||doc.mode!==saved.mode||doc.bitsPerChannel!==saved.depth)throw new Error('上次选区的来源文档、尺寸、模式或位深已改变，请重新圈选后预览');
      return doc;
    };
    source();
    await this.ps.core.executeAsModal(async(context:any)=>{
      const doc=source(),sixteen=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN;
      const suspension=await context.hostControl.suspendHistory({documentID:doc.id,name:'ps-ai 恢复选区'});
      let data:any,pending=true,first=true;
      try{
        for(const strip of imageStrips(saved.bounds)){
          if(context.isCancelled)throw new DiagnosticError('cancelled','capture','选区恢复已取消');source();
          const gray=nativeMaskStrip(saved.mask,saved.bounds,strip);
          try{data=await this.ps.imaging.createImageDataFromBuffer(sixteen?Uint16Array.from(gray,v=>v*257):gray,{width:strip.right-strip.left,height:strip.bottom-strip.top,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2',...(sixteen?{fullRange:true}:{})});
            await this.ps.imaging.putSelection({documentID:doc.id,imageData:data,replace:first,targetBounds:{left:strip.left,top:strip.top}});first=false;
          }finally{data?.dispose();data=undefined;}
        }
        if(context.isCancelled)throw new DiagnosticError('cancelled','capture','选区恢复已取消');source();
        await context.hostControl.resumeHistory(suspension,true);pending=false;
      }catch(error){if(pending)await context.hostControl.resumeHistory(suspension,false);throw error;}
      finally{data?.dispose();}
    },{commandName:'ps-ai 恢复选区'});
  }
  private key(s:Snapshot,refresh=false):string {
    let hash=this.maskKeys.get(s.mask);
    if(hash===undefined||refresh){hash=2166136261;for(const v of s.mask)hash=Math.imul(hash^v,16777619);hash>>>=0;this.maskKeys.set(s.mask,hash);}
    return JSON.stringify([s.documentId,s.historyId,s.sourceHash,s.bounds,s.captureGeometry,s.nativeDepth,s.requiresClipping,s.clipBaseLayerId,s.backgroundComposite,hash]);
  }
  private validate(s:Snapshot):any {
    if(s.sessionId!==this.sessionId)throw new Error('来源会话已结束，请重新捕获；候选仍可另存或新建文档');
    const doc=Array.from(this.ps.app.documents as any[]).find((d:any)=>d.id===s.documentId);
    if(!doc)throw new Error('来源文档已关闭，候选已保留');
    const own=this.applications.get(this.key(s));
    const historyMatches=doc.activeHistoryState.id===s.historyId||(own&&own.historyId===doc.activeHistoryState.id&&Array.from(doc.layers as any[]).some((l:any)=>l.id===own.layerId));
    if(doc.width!==s.width||doc.height!==s.height||!this.profiled(doc)||doc.colorProfileName!==s.profile||doc.mode!==s.mode||doc.bitsPerChannel!==s.depth||!historyMatches)throw new Error('来源文档尺寸、颜色或内容状态已改变，请重新捕获');
    return doc;
  }
  private async batch(commands:unknown[]):Promise<void> {
    const results=await this.ps.action.batchPlay(commands,{});
    for(const r of results)if(r?._obj==='error')throw new Error(r.message||'Photoshop 命令失败');
  }
  applicationMode(snapshot:Snapshot):'new'|'replace'|'unavailable' {
    try{const doc=this.validate(snapshot),own=this.applications.get(this.key(snapshot));return own&&own.historyId===doc.activeHistoryState.id?'replace':'new';}
    catch{return 'unavailable';}
  }
  /** Rereading any visible owned result would turn generated pixels into source content. */
  hasVisibleApplication(documentId:number):boolean {
    const doc=Array.from(this.ps.app.documents as any[]).find(d=>d.id===documentId);if(!doc)return false;
    const owned=new Set([...this.applications.values()].filter(a=>a.documentId===documentId).map(a=>a.layerId));
    const visible=(layers:any[]):boolean=>Array.from(layers).some(layer=>layer.visible!==false&&(owned.has(layer.id)||layer.layers&&visible(layer.layers)));
    return visible(doc.layers);
  }
  private sourceIdentity(s:Omit<Snapshot,'mask'>):string {return JSON.stringify([s.documentId,s.width,s.height,s.profile,s.mode,s.depth,s.historyId,s.sessionId,s.bounds,s.sourceHash,s.captureGeometry,s.nativeDepth,s.requiresClipping,s.clipBaseLayerId,s.backgroundComposite]);}
  /** Cheap UI observation only; actual writes still validate the exact native mask. */
  sourceAvailability(snapshot:Omit<Snapshot,'mask'>,allowOwned=false):'current'|'changed'|'unavailable' {
    if(snapshot.sessionId!==this.sessionId)return 'unavailable';
    const doc=Array.from(this.ps.app.documents as any[]).find((d:any)=>d.id===snapshot.documentId);if(!doc)return 'unavailable';
    if(doc.width!==snapshot.width||doc.height!==snapshot.height||!this.profiled(doc)||doc.colorProfileName!==snapshot.profile||doc.mode!==snapshot.mode||doc.bitsPerChannel!==snapshot.depth)return 'changed';
    if(doc.activeHistoryState.id===snapshot.historyId)return 'current';
    if(allowOwned){const identity=this.sourceIdentity(snapshot);if([...this.applications.values()].some(a=>a.documentId===doc.id&&a.historyId===doc.activeHistoryState.id&&a.sourceIdentity===identity&&Array.from(doc.layers as any[]).some((l:any)=>l.id===a.layerId)))return 'current';}
    return 'changed';
  }
  /** Read-only submission check, stricter than the owned-layer apply exception. */
  assertSourceCurrent(snapshot:Snapshot):void {
    const doc=Array.from(this.ps.app.documents as any[]).find((d:any)=>d.id===snapshot.documentId);
    if(!doc||doc.activeHistoryState.id!==snapshot.historyId)throw new Error('来源文档内容已改变，请重新读取原图');
    this.validate(snapshot);
  }
  async apply(snapshot:Snapshot,image:Raster,name:string,sourceAlpha?:Raster):Promise<number> {
    this.key(snapshot,true);
    const width=snapshot.bounds.right-snapshot.bounds.left,height=snapshot.bounds.bottom-snapshot.bounds.top;
    checkSize(width,height);if(snapshot.mask.length!==width*height||!snapshot.mask.some(v=>v>0))throw new Error('候选回填蒙版无效');
    let restored=resize(image,width,height);if(sourceAlpha)restored=retainSourceAlpha(restored,sourceAlpha);
    const clip=!!sourceAlpha&&this.needsClipping(sourceAlpha,snapshot.mask);
    await this.checkpoint('apply.start');
    return this.ps.core.executeAsModal(async(context:any)=>{
      const doc=this.validate(snapshot);const previous=this.ps.app.activeDocument;
      const owned=this.applications.get(this.key(snapshot));
      if(clip&&(!snapshot.clipBaseLayerId||this.clippingBase(doc,owned&&owned.historyId===doc.activeHistoryState.id?owned.layerId:undefined)?.id!==snapshot.clipBaseLayerId))throw new Error('半透明来源没有安全的剪贴底层；请在副本中合并可见层后重新生成，候选仍可另存 PNG');
      // Photoshop's clipping stack supplies the base alpha exactly once. Writing
      // the same semi-transparent alpha into a NORMAL overlay would make it opaque.
      if(clip)for(let i=3;i<restored.rgba.length;i+=4)if(restored.rgba[i]>0)restored.rgba[i]=rasterMax(restored);
      this.ps.app.activeDocument=doc;
      const suspension=await context.hostControl.suspendHistory({documentID:doc.id,name:'ps-ai 应用候选'});
      let pixels:any,mask:any;
      try {
        const own=this.applications.get(this.key(snapshot));
        if(own&&own.historyId===doc.activeHistoryState.id){const prior=Array.from(doc.layers as any[]).find((l:any)=>l.id===own.layerId);if(prior)await prior.delete();}
        const layer=await doc.createLayer(this.ps.constants.LayerKind.NORMAL,{name,opacity:100,blendMode:this.ps.constants.BlendMode.NORMAL});
        if(doc.layers[0]?.id!==layer.id)await layer.move(doc.layers[0],this.ps.constants.ElementPlacement.PLACEBEFORE);
        const sixteen=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN;
        pixels=await this.ps.imaging.createImageDataFromBuffer(convertDepth(restored,sixteen?16:8).rgba,{width,height,components:4,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',...(sixteen?{fullRange:true}:{})});
        await this.checkpoint('apply.putPixels');
        await this.ps.imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:pixels,replace:true,targetBounds:{left:snapshot.bounds.left,top:snapshot.bounds.top}});
        // A hide-all mask establishes black everywhere, including outside the written patch.
        await this.checkpoint('apply.mask.create');
        await this.batch([{_obj:'select',_target:[{_ref:'layer',_id:layer.id}],makeVisible:false},{_obj:'make',new:{_class:'channel'},at:{_ref:'channel',_enum:'channel',_value:'mask'},using:{_enum:'userMaskEnabled',_value:'hideAll'}}]);
        mask=await this.ps.imaging.createImageDataFromBuffer(sixteen?Uint16Array.from(snapshot.mask,v=>v*257):snapshot.mask,{width,height,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2',...(sixteen?{fullRange:true}:{})});
        await this.checkpoint('apply.mask.put');
        await this.ps.imaging.putLayerMask({documentID:doc.id,layerID:layer.id,imageData:mask,replace:false,targetBounds:{left:snapshot.bounds.left,top:snapshot.bounds.top}});
        if(clip){await this.checkpoint('apply.clip.create');layer.isClippingMask=true;}
        await context.hostControl.resumeHistory(suspension,true);
        this.applications.set(this.key(snapshot),{documentId:doc.id,historyId:doc.activeHistoryState.id,layerId:layer.id,sourceIdentity:this.sourceIdentity(snapshot)});
        return layer.id;
      } catch(error){await context.hostControl.resumeHistory(suspension,false);throw error;}
      finally {
        pixels?.dispose();mask?.dispose();await this.checkpoint('apply.disposed');
        if(previous&&previous.id!==doc.id&&Array.from(this.ps.app.documents as any[]).some((d:any)=>d.id===previous.id))this.ps.app.activeDocument=previous;
      }
    },{commandName:'ps-ai 应用为新图层'});
  }
  /** Rebuild only bounded native strips, using the frozen source history once per pixel. */
  async applyEditAnalysis(snapshot:Snapshot,image:Raster,name:string,options:EditAnalysisApplyOptions):Promise<number> {
    const b=snapshot.bounds,width=b.right-b.left,height=b.bottom-b.top,g=snapshot.captureGeometry,background=snapshot.backgroundComposite==='subject-background-v1';
    checkDocumentSize(snapshot.width,snapshot.height);checkDocumentSize(width,height);checkSize(image.width,image.height);
    if(!Object.values(b).every(Number.isSafeInteger)||b.left<0||b.top<0||b.right>snapshot.width||b.bottom>snapshot.height||g?.kind!=='edit-analysis'||!Number.isSafeInteger(g.width)||!Number.isSafeInteger(g.height)||g.width<1||g.height<1||g.width*g.height>IMAGE_BUDGETS.editPixels||Math.max(g.width,g.height)>IMAGE_BUDGETS.editSide||snapshot.nativeDepth!==8&&snapshot.nativeDepth!==16||typeof snapshot.requiresClipping!=='boolean'||!(snapshot.mask instanceof Uint8Array)||snapshot.mask.length!==width*height||!snapshot.mask.some(v=>v>0)||image.rgba.length!==image.width*image.height*4)throw new Error('编辑工作图来源、尺寸或原生蒙版无效，请重新捕获');
    if(!options||typeof options.preserveAlpha!=='boolean'||options.retainedBytes!==undefined&&(!Number.isSafeInteger(options.retainedBytes)||options.retainedBytes<0)||background&&(options.preserveAlpha||!(options.subjectMask instanceof Uint8Array)||options.subjectMask.length!==width*height||!(options.protectionMask instanceof Uint8Array)||options.protectionMask.length!==width*height||snapshot.requiresClipping)||!background&&(options.subjectMask!==undefined||options.protectionMask!==undefined))throw new Error('编辑工作图回填策略或背景蒙版无效');
    const masks=new Set<Uint8Array>([snapshot.mask,...(options.subjectMask?[options.subjectMask]:[]),...(options.protectionMask?[options.protectionMask]:[])]);
    planEditApplyMemory(width,height,snapshot.nativeDepth,image.rgba.byteLength,[...masks].reduce((sum,m)=>sum+m.byteLength,0),options.retainedBytes);
    const check=(context?:any)=>{if(options.signal?.aborted||context?.isCancelled){const error=new Error('候选回填已取消，已回滚本次操作');error.name='AbortError';throw error;}};
    check();this.key(snapshot,true);this.validate(snapshot);await this.checkpoint('apply.edit.start');
    return this.ps.core.executeAsModal(async(context:any)=>{
      check(context);const doc=this.validate(snapshot),previous=this.ps.app.activeDocument,depth=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,sixteen=depth===16,max=sixteen?65535:255;
      if(depth!==snapshot.nativeDepth)throw new Error('来源原生位深已改变，请重新捕获');
      const own=this.applications.get(this.key(snapshot)),clip=options.preserveAlpha&&snapshot.requiresClipping;
      if(clip&&(!snapshot.clipBaseLayerId||this.clippingBase(doc,own&&own.historyId===doc.activeHistoryState.id?own.layerId:undefined)?.id!==snapshot.clipBaseLayerId))throw new Error('半透明来源没有安全的剪贴底层；请在副本中合并可见层后重新生成，候选仍可另存 PNG');
      const strips=[...imageStrips(b)],readSource=background||options.preserveAlpha,total=strips.length*(readSource?3:2);let done=0;
      const progress=()=>{options.onProgress?.(++done,total);context.reportProgress?.({value:done/total,commandName:'PS-AI 原尺寸回填'});check(context);};
      // Verify native alpha and the saved background matte before creating a
      // layer. This also catches a one-pixel translucent edge absent in preview.
      if(readSource){
        const state=this.sourceState(doc);let actualClipping=false;
        for(const strip of strips){
          check(context);const source=await this.sourceStrip(doc,strip,depth,snapshot.historyId),gray=nativeMaskStrip(snapshot.mask,b,strip);
          if(background){const expected=backgroundEditMask(source,nativeMaskStrip(options.subjectMask!,b,strip),nativeMaskStrip(options.protectionMask!,b,strip));if(!expected.every((v,p)=>v===gray[p]))throw new Error('背景原生蒙版与冻结来源、主体或保护区不一致，请重新捕获');}
          else{
            for(let p=0;p<gray.length;p++)if(gray[p]&&source.rgba[p*4+3]>0&&source.rgba[p*4+3]<max)actualClipping=true;
            if(clip){const base=await this.sourceStrip(doc,strip,depth,snapshot.historyId,snapshot.clipBaseLayerId);if(!gray.every((v,p)=>!v||source.rgba[p*4+3]===base.rgba[p*4+3]))throw new Error('半透明来源的剪贴底层透明度不匹配，请重新捕获');}
          }
          if(state!==this.sourceState(doc))throw new Error('来源文档内容已改变，请重新捕获');progress();
        }
        if(!background&&actualClipping!==snapshot.requiresClipping)throw new Error('来源原生透明度记录不匹配，请重新捕获');
      }
      this.ps.app.activeDocument=doc;let suspension:any,pending=false,pixels:any,mask:any;
      try{
        check(context);suspension=await context.hostControl.suspendHistory({documentID:doc.id,name:'PS-AI 原尺寸回填候选'});pending=true;
        if(own&&own.historyId===doc.activeHistoryState.id){const prior=Array.from(doc.layers as any[]).find((l:any)=>l.id===own.layerId);if(prior)await prior.delete();}
        const layer=await doc.createLayer(this.ps.constants.LayerKind.NORMAL,{name,opacity:100,blendMode:this.ps.constants.BlendMode.NORMAL});layer.fillOpacity=100;
        if(doc.layers[0]?.id!==layer.id)await layer.move(doc.layers[0],this.ps.constants.ElementPlacement.PLACEBEFORE);
        await this.batch([{_obj:'select',_target:[{_ref:'layer',_id:layer.id}],makeVisible:false},{_obj:'make',new:{_class:'channel'},at:{_ref:'channel',_enum:'channel',_value:'mask'},using:{_enum:'userMaskEnabled',_value:'hideAll'}}]);
        let alphaSum=0,weightSum=0;
        for(const strip of strips){
          check(context);let patch=sampleEditStrip(image,b,strip,depth);const gray=nativeMaskStrip(snapshot.mask,b,strip);
          if(readSource){const source=await this.sourceStrip(doc,strip,depth,snapshot.historyId);check(context);
            if(background){for(let p=0;p<gray.length;p++){weightSum+=gray[p];alphaSum+=gray[p]*patch.rgba[p*4+3]/max;}patch=prepareBackgroundCandidate(patch,source,nativeMaskStrip(options.subjectMask!,b,strip));}
            else patch=retainSourceAlpha(patch,source);
          }
          if(clip)for(let p=3;p<patch.rgba.length;p+=4)if(patch.rgba[p])patch.rgba[p]=max;
          try{
            pixels=await this.ps.imaging.createImageDataFromBuffer(patch.rgba,{width:patch.width,height:patch.height,components:4,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',...(sixteen?{fullRange:true}:{})});
            await this.checkpoint('apply.edit.putPixels');await this.ps.imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:pixels,replace:false,targetBounds:{left:strip.left,top:strip.top}});
          }finally{pixels?.dispose();pixels=undefined;}progress();
          try{
            mask=await this.ps.imaging.createImageDataFromBuffer(sixteen?Uint16Array.from(gray,v=>v*257):gray,{width:strip.right-strip.left,height:strip.bottom-strip.top,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2',...(sixteen?{fullRange:true}:{})});
            await this.checkpoint('apply.edit.mask.put');await this.ps.imaging.putLayerMask({documentID:doc.id,layerID:layer.id,imageData:mask,replace:false,targetBounds:{left:strip.left,top:strip.top}});
          }finally{mask?.dispose();mask=undefined;}progress();
        }
        if(background&&(!weightSum||alphaSum/weightSum<.9))throw new Error('生成背景的有效覆盖不足 90%；保留原始输出供检查和导出');
        if(clip)layer.isClippingMask=true;check(context);await context.hostControl.resumeHistory(suspension,true);pending=false;
        this.applications.set(this.key(snapshot),{documentId:doc.id,historyId:doc.activeHistoryState.id,layerId:layer.id,sourceIdentity:this.sourceIdentity(snapshot)});return layer.id;
      }catch(error){if(pending)await context.hostControl.resumeHistory(suspension,false);throw error;}
      finally{pixels?.dispose();mask?.dispose();if(previous&&previous.id!==doc.id&&Array.from(this.ps.app.documents as any[]).some((d:any)=>d.id===previous.id))this.ps.app.activeDocument=previous;}
    },{commandName:'PS-AI 原尺寸条带回填'});
  }
  /**
   * Native source composite + bounded influence strips in an isolated NORMAL
   * group. Source alpha must be opaque wherever the effective mask is nonzero:
   * this prevents duplicating source semitransparency over the original.
   */
  async applyRelightLayers(snapshot:Snapshot,fields:RelightLayerFields,name:string,options:{signal?:AbortSignal;onProgress?:(done:number,total:number)=>void}={}):Promise<number> {
    validateRelightLayerFields(fields);const width=snapshot.bounds.right-snapshot.bounds.left,height=snapshot.bounds.bottom-snapshot.bounds.top;
    checkDocumentSize(snapshot.width,snapshot.height);
    if(!Object.values(snapshot.bounds).every(Number.isSafeInteger)||snapshot.bounds.left<0||snapshot.bounds.top<0||snapshot.bounds.right>snapshot.width||snapshot.bounds.bottom>snapshot.height)throw new Error('光影层原生坐标无效');
    planRelightMemory(width,height,snapshot.depth===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8);
    if(snapshot.mask.length!==width*height||!snapshot.mask.some(v=>v>0))throw new Error('光影层原生蒙版无效');
    if(!fields.channels.length)throw new Error('本次参考未产生可靠光影影响；没有创建空图层');
    const source=fields.source;
    if(source.documentId!==snapshot.documentId||source.docWidth!==snapshot.width||source.docHeight!==snapshot.height||source.historyId!==snapshot.historyId||source.sessionId!==snapshot.sessionId||source.sourceHash!==snapshot.sourceHash||source.profile!==snapshot.profile||source.documentDepth!==(snapshot.depth===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8)||JSON.stringify(source.bounds)!==JSON.stringify(snapshot.bounds)||snapshot.captureGeometry&&(fields.width!==snapshot.captureGeometry.width||fields.height!==snapshot.captureGeometry.height))throw new Error('光影影响场不属于此来源快照，请重新读取原图');
    const maskRef=`relight-mask-v1:sha256:${Array.from(sha256(snapshot.mask),v=>v.toString(16).padStart(2,'0')).join('')}`;
    if(source.maskRef!==maskRef)throw new DiagnosticError('source-changed','apply','光影影响场的选区或保护区已改变，请重新读取原图');
    if(!/^sRGB(?: IEC61966-2\.1)?$/i.test(snapshot.profile.trim())||snapshot.mode!==this.ps.constants.DocumentMode.RGB)throw new Error('实验光影层仅支持已标记的 sRGB RGB 原文档；不能把数值影响图跨 ICC 当作普通照片转换');
    const blends=this.ps.constants.BlendMode;
    if(![blends.NORMAL,blends.MULTIPLY,blends.SCREEN,blends.COLOR].every(v=>v!==undefined))throw new Error('当前 Photoshop 不提供所需光影混合模式');
    const check=(context?:any)=>{if(options.signal?.aborted||context?.isCancelled){const error=new Error('光影层回填已取消，已回滚本次操作');error.name='AbortError';throw error;}};
    check();this.key(snapshot,true);this.validate(snapshot);await this.checkpoint('apply.layers.start');
    return this.ps.core.executeAsModal(async(context:any)=>{
      check(context);const doc=this.validate(snapshot),previous=this.ps.app.activeDocument;
      if(typeof doc.createLayerGroup!=='function')throw new Error('当前 Photoshop 不支持原生光影图层组');
      this.ps.app.activeDocument=doc;let suspension:any,pending=false;
      const strips=[...imageStrips(snapshot.bounds)],total=strips.length*(fields.channels.length+2),sixteen=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN,depth=sixteen?16:8,max=sixteen?65535:255;
      let done=0;const progress=()=>{options.onProgress?.(++done,total);context.reportProgress?.({value:done/total,commandName:'PS-AI 光影层回填'});check(context);};
      const makeMask=async(layerId:number,kind:'hideAll'|'revealAll')=>this.batch([{_obj:'select',_target:[{_ref:'layer',_id:layerId}],makeVisible:false},{_obj:'make',new:{_class:'channel'},at:{_ref:'channel',_enum:'channel',_value:'mask'},using:{_enum:'userMaskEnabled',_value:kind}}]);
      try{
        suspension=await context.hostControl.suspendHistory({documentID:doc.id,name:'PS-AI 应用保细节光影层'});pending=true;
        const own=this.applications.get(this.key(snapshot));
        if(own&&own.historyId===doc.activeHistoryState.id){const prior=Array.from(doc.layers as any[]).find((l:any)=>l.id===own.layerId);if(prior)await prior.delete();}
        const base=await doc.createLayer(this.ps.constants.LayerKind.NORMAL,{name:'Source — frozen native composite',blendMode:blends.NORMAL,opacity:100});
        base.fillOpacity=100;
        if(doc.layers[0]?.id!==base.id)await base.move(doc.layers[0],this.ps.constants.ElementPlacement.PLACEBEFORE);
        const created=[base];
        for(const strip of strips){
          check(context);await this.checkpoint('apply.layers.source.read');
          // Pin every strip to the captured history. New base/lighting pixels,
          // including a previous owned result, cannot leak into later reads.
          const result=await this.ps.imaging.getPixels({documentID:doc.id,historyStateID:snapshot.historyId,sourceBounds:strip,colorSpace:'RGB',colorProfile:snapshot.profile,componentSize:depth,applyAlpha:false}),data=result.imageData;
          if(!data)throw new Error('来源条带没有可读取像素');
          try{
            const actual=result.sourceBounds;
            if((result.level??0)!==0||![3,4].includes(data.components)||data.componentSize!==depth||!actual||data.width!==actual.right-actual.left||data.height!==actual.bottom-actual.top||data.width*data.height>262_144)throw new Error('原生条带尺寸、位深或缓存坐标不符，已停止回填');
            const values=await data.getData({chunky:true,fullRange:true});
            for(let y=strip.top;y<strip.bottom;y++)for(let x=strip.left;x<strip.right;x++)if(snapshot.mask[(y-snapshot.bounds.top)*width+x-snapshot.bounds.left]){
              if(x<actual.left||x>=actual.right||y<actual.top||y>=actual.bottom||data.components===4&&values[((y-actual.top)*data.width+x-actual.left)*4+3]!==max)throw new Error('光影层暂不支持作用范围内的透明/半透明来源；请缩小到不透明区域，或明确使用整图重绘并检查透明度');
            }
            await this.ps.imaging.putPixels({documentID:doc.id,layerID:base.id,imageData:data,replace:false,targetBounds:{left:actual.left,top:actual.top}});
          }finally{data.dispose();}progress();
        }
        const names={'shadow':'Shadow','cast-shadow':'Cast Shadow','color-atmosphere':'Color Atmosphere','light':'Light','rim-light':'Rim Light'};
        for(const channel of fields.channels){
          check(context);const layer=await doc.createLayer(this.ps.constants.LayerKind.NORMAL,{name:names[channel.kind],opacity:100,blendMode:channel.blendMode==='multiply'?blends.MULTIPLY:channel.blendMode==='screen'?blends.SCREEN:blends.COLOR});created.push(layer);
          layer.fillOpacity=100;
          if(doc.layers[0]?.id!==layer.id)await layer.move(doc.layers[0],this.ps.constants.ElementPlacement.PLACEBEFORE);
          for(const strip of strips){
            check(context);let data:any;
            try{const pixels=renderRelightLayerStrip(fields,channel,snapshot.bounds,strip,depth);data=await this.ps.imaging.createImageDataFromBuffer(pixels.rgba,{width:pixels.width,height:pixels.height,components:4,colorSpace:'RGB',colorProfile:snapshot.profile,...(sixteen?{fullRange:true}:{})});await this.ps.imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:data,replace:false,targetBounds:{left:strip.left,top:strip.top}});}finally{data?.dispose();}progress();
          }
          // An editable white mask controls only this channel; native selection
          // and protection are applied once, to the isolated group below.
          await makeMask(layer.id,'revealAll');
        }
        const group=await doc.createLayerGroup({name,opacity:100,blendMode:blends.NORMAL,fromLayers:created.slice().reverse()});group.blendMode=blends.NORMAL;group.opacity=100;group.fillOpacity=100;
        await makeMask(group.id,'hideAll');
        for(const strip of strips){
          check(context);let data:any;
          try{const start=(strip.top-snapshot.bounds.top)*width,gray=snapshot.mask.subarray(start,start+(strip.bottom-strip.top)*width);data=await this.ps.imaging.createImageDataFromBuffer(sixteen?Uint16Array.from(gray,v=>v*257):gray,{width,height:strip.bottom-strip.top,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2',...(sixteen?{fullRange:true}:{})});await this.ps.imaging.putLayerMask({documentID:doc.id,layerID:group.id,imageData:data,replace:false,targetBounds:{left:strip.left,top:strip.top}});}finally{data?.dispose();}progress();
        }
        check(context);await context.hostControl.resumeHistory(suspension,true);pending=false;
        this.applications.set(this.key(snapshot),{documentId:doc.id,historyId:doc.activeHistoryState.id,layerId:group.id,sourceIdentity:this.sourceIdentity(snapshot)});return group.id;
      }catch(error){if(pending)await context.hostControl.resumeHistory(suspension,false);throw error;}
      finally{await this.checkpoint('apply.layers.disposed');if(previous&&previous.id!==doc.id&&Array.from(this.ps.app.documents as any[]).some((d:any)=>d.id===previous.id))this.ps.app.activeDocument=previous;}
    },{commandName:'PS-AI 应用保细节光影层'});
  }
  async opacity(documentId:number,layerId:number,value:number):Promise<void> {
    if(!Number.isFinite(value)||value<0||value>100)throw new Error('不透明度须为 0–100');
    await this.ps.core.executeAsModal(async()=>{
      const doc=Array.from(this.ps.app.documents as any[]).find((d:any)=>d.id===documentId);
      const layer=doc&&Array.from(doc.layers as any[]).find((l:any)=>l.id===layerId);
      if(!layer)throw new Error('应用图层已关闭或移动，请使用 PS 图层面板');
      const authorized=[...this.applications.entries()].filter(([,a])=>a.documentId===documentId&&a.layerId===layerId&&a.historyId===doc.activeHistoryState.id);
      layer.opacity=value;
      for(const [key,a] of authorized)this.applications.set(key,{...a,historyId:doc.activeHistoryState.id});
    },{commandName:'PS-AI 调整图层不透明度'});
  }
  async newDocument(image:Raster,name:string):Promise<number> {
    checkSize(image.width,image.height);
    return this.ps.core.executeAsModal(async(context:any)=>{
      const depth=rasterDepth(image),doc=await this.ps.app.createDocument({width:image.width,height:image.height,resolution:72,mode:this.ps.constants.NewDocumentMode.RGB,fill:this.ps.constants.DocumentFill.TRANSPARENT,depth,name,profile:'sRGB IEC61966-2.1'});
      await context.hostControl.registerAutoCloseDocument(doc.id);
      let data:any;
      try {
        const layer=await doc.createLayer(this.ps.constants.LayerKind.NORMAL,{name:'ps-ai 生成'});
        data=await this.ps.imaging.createImageDataFromBuffer(image.rgba,{width:image.width,height:image.height,components:4,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',...(depth===16?{fullRange:true}:{})});
        await this.ps.imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:data,replace:true});
        await context.hostControl.unregisterAutoCloseDocument(doc.id);return doc.id;
      }finally{data?.dispose();}
    },{commandName:'ps-ai 生图到新文档'});
  }
}
