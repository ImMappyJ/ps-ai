import {encodePng,type Raster} from '../../imaging/image';
import {RELIGHT_LIMITS,createRelightScene,normalizedToViewport,viewportToNormalized,viewportLightIndicator,type RelightScene,type RelightLight,type RelightViewport,type RelightGeometry} from './relight-scene';
import {prepareRelightPreview,RelightPreviewRenderer,encodeRelightDragPreview,type RelightPreparedPreview} from './relight-preview';
import {downsampleSnapshotMask} from '../../imaging/budget';
import {RelightSession,relightOutputKind,type RelightOutputKind,type FrozenRelightSubmission} from './relight-session';
import {t,errorText} from '../../localization/i18n';
import {DiagnosticError,diagnostic} from '../../diagnostics/diagnostics';
import {validateRelightExtractionSettings,type RelightExtractionSettings} from './relight-layers';

export interface RelightResult {jobId:string;fingerprint:string;sourceSnapshotId?:string;image:Raster;warning?:string;outputKind?:RelightOutputKind;lightingState?:'composite'|'reference-only';lightingFailure?:Error;localExtraction?:RelightExtractionSettings}
function resultLabel(result:RelightResult):string {return relightOutputKind(result)==='lighting-layers'?result.lightingState==='composite'?'光影合成预览':'AI 参考图（提取失败，仅供检查）':'整图重绘';}
export interface RelightWorkbenchHost {
  uuid():string;save(scene:RelightScene):Promise<void>;loadDraft():Promise<RelightScene|undefined>;
  prepare(frozen:FrozenRelightSubmission):Promise<void>;
  generate(frozen:FrozenRelightSubmission,onJob:(id:string)=>void):Promise<void>;
  cancel():Promise<void>;reread(options?:{explicit?:boolean}):Promise<void>;apply(jobId:string):Promise<void>;inspectResult?(jobId:string):Promise<void>;export(jobId:string):Promise<void>;
  results():RelightResult[];
  reextract?(jobId:string,settings:RelightExtractionSettings,current:()=>boolean):Promise<void>;
  busy?():boolean;pendingTasks?():number;openPendingTasks?():Promise<void>;reportError?(error:Error):void;
  sourceState?():'current'|'changed'|'closed'|'rebind-required';observeSource?(invalidate:()=>void):()=>void;
  resultSourceState?(jobId:string):'current'|'changed';
  colorRecovery?():'create'|'retry'|undefined;recoverColor?():Promise<void>;
}
type Tab='original'|'illustration'|'result';
type Drag={kind:'light'|'target'|'pan';id?:string;startX:number;startY:number;panX:number;panY:number;pointerId?:number;node?:any};
type SliderGesture={id:string;lightId:string|null;pointerId?:number};
type ExtractionGesture={jobId:string;settings:RelightExtractionSettings;pointerId?:number};
type RequestOwner={lifecycle:number;fingerprint:string;outputKind:RelightOutputKind;ids:Set<string>;cancelled:boolean};
type PreviewRequest={token:number;quality:'drag'|'final';snapshotId:string};
export interface RelightWorkbenchPreviewStats {requested:number;started:number;completed:number;discarded:number;encoded:number;renderMs:number;encodeMs:number;running:boolean;pending:boolean;previewWidth:number;previewHeight:number}
class ParameterValidationError extends Error {}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const LIGHT_CONTROLS=['name','type','role','enabled','locked','x','y','z','intensity','range','softness','cone','targetX','targetY','direction','elevation','color-mode','temperature','color'];
const EXTRACTION_CONTROLS={'fidelity':'光效还原','detail-protection':'细节保护'} as const;
const SLIDER_CONTROLS:Record<string,{limits:{min:number;max:number};step:number;label:string}>={
  intensity:{limits:RELIGHT_LIMITS.intensity,step:.05,label:'相对强度'},
  temperature:{limits:RELIGHT_LIMITS.temperature,step:100,label:'色温（K）'},
  range:{limits:RELIGHT_LIMITS.range,step:.05,label:'影响范围（短边倍数）'},
  z:{limits:RELIGHT_LIMITS.depth,step:.05,label:'相对深度 Z（意图）'},
  softness:{limits:RELIGHT_LIMITS.softness,step:.05,label:'柔和度'},
  cone:{limits:RELIGHT_LIMITS.cone,step:1,label:'聚光锥角（度）'},
  direction:{limits:RELIGHT_LIMITS.direction,step:1,label:'方向（顺时针度数）'},
  elevation:{limits:RELIGHT_LIMITS.elevation,step:1,label:'仰角（相对意图）'},
  'ambient-intensity':{limits:RELIGHT_LIMITS.intensity,step:.05,label:'环境光相对强度'},
  'shadow-strength':{limits:RELIGHT_LIMITS.softness,step:.05,label:'阴影强度意图'},
  'shadow-softness':{limits:RELIGHT_LIMITS.softness,step:.05,label:'阴影柔和度意图'}
};
function warningText(warning:string):string {
  if(warning.startsWith('Lighting uses semantic control'))return t('语义布光控制不保证每盏光源的精确效果或像素保持。');
  if(warning.startsWith('The supplement requests no shadows'))return t('补充描述要求没有阴影，但结构化阴影强度大于零；请解决冲突。');
  if(warning.startsWith('The supplement requests lighting from one side'))return t('补充描述要求仅从一侧照明，但启用的主光在另一侧；请解决冲突。');
  if(warning.startsWith('The supplement requests all lights off'))return t('补充描述要求关闭全部光源，但启用光源的强度大于零；请解决冲突。');
  if(warning.startsWith('Supplement conflict checks'))return t('仅检测少量明显冲突，请人工检查其他补充描述；原文会保持不变。');
  if(warning.startsWith('Only the clean source image fits'))return t('此模型只能容纳干净原图，辅助蒙版不能替换原图；最终范围仍由保存的选区限制。');
  return errorText(warning);
}
function dataUrl(image:Raster,drag=false):string {
  const bytes=drag?encodeRelightDragPreview(image):encodePng(image),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let encoded='';
  for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]??0)<<8)|(bytes[i+2]??0);encoded+=alphabet[n>>>18]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');}
  return 'data:image/png;base64,'+encoded;
}
export function relightTextFocus(node:any):boolean {
  for(let current=node;current;current=current.parentElement){
    if(['input','textarea','select','sp-textarea','sp-picker','sp-textfield','sp-slider'].includes(String(current.tagName??'').toLowerCase())||current.isContentEditable||current.getAttribute?.('contenteditable')==='true')return true;
  }
  return false;
}

/** Real UXP dialog controller. Native callbacks always run after uxpShowModal resolves. */
export class RelightWorkbench {
  private tab:Tab='illustration';private markersVisible=true;private panMode=false;private advanced=false;
  private viewport:RelightViewport={clientRect:{left:0,top:0,width:1,height:1},fitScale:1,zoom:1,panX:0,panY:0};
  private visible=false;private transitioning=false;private pending=false;private nativeBusy=false;private lifecycle=0;
  private request?:RequestOwner;private selectedResult?:string;private lastStatus='';private parameterStatus=false;private warnings:string[]=[];private acknowledged=false;private sourceInvalid=false;private scopePending=false;private outputPending=false;
  private measurementStatus?:{previous:string;parameter:boolean};
  private pendingDraft?:RelightScene;private invalid=new Set<string>();private invalidLightId:string|null=null;private afterClose?:()=>Promise<void>;private reopenAfterClose=true;
  private listeners:Array<()=>void>=[];private drag?:Drag;private sliderGesture?:SliderGesture;private preview?:RelightPreparedPreview;
  private originalUrl='';private illustrationUrl='';private resultUrl='';private resultUrlId='';
  private resultImage?:Raster;private extractionGesture?:ExtractionGesture;private extractionPending=false;private extractionToken=0;
  private displayedImageUrl='';private displayedImageGeometry='';
  private previewToken=0;private previewRequest?:PreviewRequest;private previewRun?:PreviewRequest;private lastRender=0;private previewTimer?:ReturnType<typeof setTimeout>;private resizeTimer?:ReturnType<typeof setTimeout>;private saveTimer?:ReturnType<typeof setTimeout>;
  private finalRenderer?:RelightPreviewRenderer;private dragRenderer?:RelightPreviewRenderer;
  private sourceSyncTimer?:ReturnType<typeof setTimeout>;private sourceSyncFailed=false;
  private previewCounters={requested:0,started:0,completed:0,discarded:0,encoded:0,renderMs:0,encodeMs:0};
  private lightListKey='';private resultListKey='';
  private markerNodes=new Map<string,any>();
  constructor(private dialog:any,public session:RelightSession,private host:RelightWorkbenchHost){}
  get isOpen():boolean{return this.visible;}
  get currentResultId():string|undefined{return this.selectedResult;}
  get isGenerating():boolean{return this.pending;}
  get previewStats():RelightWorkbenchPreviewStats {return {...this.previewCounters,running:!!this.previewRun,pending:!!this.previewRequest,previewWidth:this.preview?.image.width??0,previewHeight:this.preview?.image.height??0};}
  refreshAvailability():void {if(this.visible)this.refresh();}
  /** Drop deleted candidate URLs even while closed; keep the frozen source and lighting editor. */
  invalidateResults(ids:readonly string[]):void {
    if(this.resultUrlId&&ids.includes(this.resultUrlId)){
      if(this.displayedImageUrl===this.resultUrl){this.el('image').removeAttribute('src');this.displayedImageUrl='';this.displayedImageGeometry='';}
      this.resultUrl='';this.resultUrlId='';this.resultImage=undefined;
    }
    if(this.selectedResult&&ids.includes(this.selectedResult)){this.extractionToken++;this.extractionGesture=undefined;this.selectedResult=this.host.results()[0]?.jobId;if(!this.selectedResult&&this.tab==='result')this.tab='illustration';}
    if(this.visible)this.refresh();
  }
  setSourceInvalid(invalid:boolean):void {if(invalid){this.invalidateSource();return;}const previous=this.sourceInvalid;this.sourceInvalid=false;this.sourceSyncFailed=false;if(previous)this.message(t('编辑布光不会发起 AI 请求；主动点击生成'));if(this.visible)this.refresh();}
  private sourceMessage():string {
    const state=this.host.sourceState?.();
    if(state==='closed')return t('来源文档已关闭；请重新读取当前文档。布光配置和可导出候选已保留。');
    return t('来源已关闭或改变，请重新读取原图；布光配置和已有结果仍保留');
  }
  invalidateSource(reason?:string):void {const previous=this.sourceInvalid;this.sourceInvalid=true;this.finishInteraction();this.cancelPreview();if(reason||!previous)this.message(reason??this.sourceMessage());if(this.visible)this.refresh();}
  setScopePending(pending:boolean):void {const previous=this.scopePending;this.scopePending=pending;if(pending){this.finishInteraction();this.message(t('布光范围已改变，请重新读取原图；原有布光配置已保留'));}else if(previous&&!this.sourceInvalid)this.message(t('编辑布光不会发起 AI 请求；主动点击生成'));if(this.visible)this.refresh();}
  sourceCaptureFailed(reason:string):void {this.sourceSyncFailed=true;this.invalidateSource(reason);}
  /** Called only after a successful explicit native read, never on modal reopen. */
  sourceRefreshed():void {
    this.sourceInvalid=false;this.scopePending=false;this.outputPending=false;this.sourceSyncFailed=false;this.selectedResult=undefined;this.pendingDraft=undefined;this.tab='illustration';
    this.message(t('已读取当前文档的可见合成，布光配置已保留；请检查位置后生成。旧候选仍可检查或导出。'));
  }
  private el(id:string):any{return this.dialog.querySelector(`#relight-${id}`);}
  private listen(node:any,name:string,fn:(event:any)=>void):void {node.addEventListener(name,fn);this.listeners.push(()=>node.removeEventListener(name,fn));}
  private click(id:string,fn:()=>void|Promise<void>):void {this.listen(this.el(id),'click',()=>void this.guard(()=>{this.finishInteraction();return fn();}));}
  private async guard(fn:()=>void|Promise<void>):Promise<void>{try{await fn();}catch(error){this.message(error instanceof Error?error.message:String(error),error instanceof ParameterValidationError);}}
  private message(text:string,parameter=false):void {this.measurementStatus=undefined;this.parameterStatus=parameter;this.lastStatus=errorText(text);if(this.visible)this.el('status').textContent=this.lastStatus;}
  private geometry():RelightGeometry {
    const bounds=this.session.editor.snapshot().source.bounds,{width,height}=this.session.sourceCapture.image;
    // Native bounds control placement; the bounded capture is the image canvas.
    // Large documents must not be validated as full-size model rasters.
    return {bounds,modelWidth:width,modelHeight:height,modelContentRect:{left:0,top:0,right:width,bottom:height}};
  }
  private result():RelightResult|undefined{return this.host.results().find(r=>r.jobId===this.selectedResult);}
  private assertHostIdle():void {if(this.host.busy?.())throw new Error(t('已有任务正在进行，请等待完成后再生成或应用；可以继续编辑布光'));}
  private clearInvalid(id:string):void {this.invalid.delete(id);this.el(id).removeAttribute('aria-invalid');}
  private reconcileInvalid(light:RelightLight|undefined):void {
    if(this.invalidLightId!==(light?.id??null)){for(const id of LIGHT_CONTROLS)this.clearInvalid(id);this.invalidLightId=light?.id??null;}
    if(!light){for(const id of LIGHT_CONTROLS)this.clearInvalid(id);return;}
    const inactive=light.type==='directional'?['x','y','z','range','targetX','targetY','cone']:light.type==='point'?['targetX','targetY','cone','direction','elevation']:['direction','elevation'];
    inactive.push(light.color.mode==='temperature'?'color':'temperature');
    if(light.positionLocked)inactive.push('x','y','z');
    if(!this.advanced)inactive.push('z','softness','cone','targetX','targetY','direction','elevation');
    for(const id of inactive)this.clearInvalid(id);
  }
  private save():Promise<void>{return this.host.save(this.session.editor.snapshot());}
  private changed():void {
    this.acknowledged=false;this.warnings=[];this.refresh();this.schedulePreview();
    if(this.saveTimer)clearTimeout(this.saveTimer);
    this.saveTimer=undefined;if(this.drag||this.sliderGesture)return;
    this.saveTimer=setTimeout(()=>{this.saveTimer=undefined;void this.guard(()=>this.save());},180);
  }
  setWarnings(warnings:string[]):void {this.warnings=[...warnings];if(this.visible)this.refresh();}
  progress(text:string):void {if(this.visible&&this.request?.lifecycle===this.lifecycle&&!this.request.cancelled)this.message(text);}
  /** Saving history is independent; only the owned, noncancelled request may select a new success. */
  notifyResult(jobId:string):void {
    const owner=this.request;
    if(!this.visible||!owner||owner.cancelled||owner.lifecycle!==this.lifecycle||!owner.ids.has(jobId))return;
    const result=this.host.results().find(r=>r.jobId===jobId&&r.fingerprint===owner.fingerprint&&relightOutputKind(r)===owner.outputKind);
    if(!result)return;
    this.selectedResult=jobId;this.tab='result';this.refresh();
  }
  show():void {
    if(this.visible||this.transitioning)return;
    if(typeof this.dialog?.uxpShowModal!=='function')throw new Error(t('当前宿主无法打开布光对话框，请使用 Photoshop 27+ 并重新加载开发插件'));
    void this.present().catch(error=>{const failure=error instanceof Error?error:new Error(String(error));this.message(failure.message);this.host.reportError?.(failure);console.error(failure);});
  }
  private async present():Promise<void> {
    this.visible=true;
    try {
      this.mount();
      const closed=this.dialog.uxpShowModal({title:t('PS-AI 光影重塑'),resize:'both',size:{width:1040,height:740},minSize:{width:800,height:620},maxSize:{width:1600,height:1100}});
      this.resizeTimer=setTimeout(()=>{this.resizeTimer=undefined;if(this.visible){this.measure();this.refresh();}},0);
      await closed;
    }catch(error){throw new Error(t('布光工作台打开失败，请关闭后重新加载插件：{0}',error instanceof Error?error.message:String(error)));}
    finally {this.visible=false;this.cleanup();}
    const action=this.afterClose,reopen=this.reopenAfterClose;this.afterClose=undefined;this.reopenAfterClose=true;
    if(action){this.transitioning=true;try{await action();}catch(error){this.message(error instanceof DiagnosticError&&error.code==='selection-required'?diagnostic(error,'capture').action:error instanceof Error?error.message:String(error));this.host.reportError?.(error instanceof Error?error:new Error(String(error)));}finally{this.transitioning=false;if(reopen)this.show();}}
    else {this.lifecycle++;if(this.request)this.request.cancelled=true;await this.save().catch(error=>this.message(t('布光草稿保存失败，请重新打开后点击保存：{0}',error instanceof Error?error.message:String(error))));}
  }
  private closeForNative(action:()=>Promise<void>):void {
    if(!this.visible||this.nativeBusy)return;
    this.finishInteraction();this.nativeBusy=true;
    this.afterClose=async()=>{try{await action();}finally{this.nativeBusy=false;}};
    this.dialog.close('native-operation');
  }
  private generate():void {
    if(this.pending||this.nativeBusy||this.sourceInvalid||this.scopePending||this.outputPending)return;
    this.assertHostIdle();
    if(this.invalid.size)throw new ParameterValidationError(t('请先修正标记为无效的参数，再生成'));
    const frozen=this.session.freeze(),owner:RequestOwner={lifecycle:this.lifecycle,fingerprint:frozen.fingerprint,outputKind:frozen.outputKind,ids:new Set(),cancelled:false};
    this.pending=true;this.request=owner;
    this.closeForNative(async()=>{
      try {
        await this.host.prepare(frozen);
        // Start network only after the real dialog has reopened. It must not recapture.
        this.transitioning=false;this.nativeBusy=false;this.show();await Promise.resolve();
        if(!this.visible)throw new Error(t('工作台未能重新打开，请重新打开后生成'));
        void this.host.generate(frozen,id=>{if(this.request===owner)owner.ids.add(id);}).catch(error=>{
          if(owner.lifecycle===this.lifecycle&&!owner.cancelled)this.message(error instanceof Error?error.message:String(error));
        }).finally(()=>{if(this.request!==owner)return;this.pending=false;if(this.visible)this.refresh();});
      }catch(error){this.pending=false;throw error;}
    });
  }
  private measure():void {
    const box=this.el('viewport').getBoundingClientRect();
    if(!Number.isFinite(box.width)||!Number.isFinite(box.height)||box.width<=0||box.height<=0){
      if(!this.measurementStatus){const previous={previous:this.lastStatus,parameter:this.parameterStatus};this.message(t('无法读取预览区域尺寸，请点击适应窗口重试'));this.measurementStatus=previous;}
      return;
    }
    // Recover only our own size warning, even if layout returns to identical bounds.
    if(this.measurementStatus){const {previous,parameter}=this.measurementStatus;this.message(previous,parameter);}
    const source=this.session.editor.snapshot().source,b=source.bounds,w=b.right-b.left,h=b.bottom-b.top;
    const fitScale=Math.min(box.width/(w*1.35),box.height/(h*1.35)),previous=this.viewport.clientRect;
    // UXP can report resize when an img finishes loading without changing bounds.
    // Do not feed those notifications back into another DOM/image update.
    if(previous.left===box.left&&previous.top===box.top&&previous.width===box.width&&previous.height===box.height&&this.viewport.fitScale===fitScale)return;
    this.viewport={...this.viewport,clientRect:{left:box.left,top:box.top,width:box.width,height:box.height},fitScale};
    this.renderImage();this.renderMarkers();
  }
  private mount():void {
    for(const id of this.invalid)this.el(id).removeAttribute('aria-invalid');this.invalid.clear();this.invalidLightId=this.session.editor.selectedId;
    for(const node of Array.from(this.dialog.querySelectorAll('[data-i18n]')) as any[])node.textContent=t(node.getAttribute('data-i18n'));
    for(const id of ['type','role','color-mode','existing','content','output']){
      const select=this.el(id),value=select.value,options=Array.from(select.querySelectorAll('option')) as any[];
      const rows=options.map(n=>({value:n.getAttribute('value'),text:n.getAttribute('data-i18n'),disabled:n.hasAttribute('disabled')}));
      select.innerHTML='';for(const row of rows){const n=this.dialog.ownerDocument.createElement('option');n.value=row.value;n.setAttribute('value',row.value);n.setAttribute('data-i18n',row.text);n.textContent=t(row.text);if(row.disabled){n.setAttribute('disabled','');n.disabled=true;}select.appendChild(n);}select.value=value;
    }
    this.el('output').value=this.session.outputKind;
    const limits:Record<string,{min:number;max:number}>={x:RELIGHT_LIMITS.position,y:RELIGHT_LIMITS.position,z:RELIGHT_LIMITS.depth,targetX:RELIGHT_LIMITS.position,targetY:RELIGHT_LIMITS.position,intensity:RELIGHT_LIMITS.intensity,range:RELIGHT_LIMITS.range,softness:RELIGHT_LIMITS.softness,cone:RELIGHT_LIMITS.cone,direction:RELIGHT_LIMITS.direction,elevation:RELIGHT_LIMITS.elevation,temperature:RELIGHT_LIMITS.temperature,'ambient-intensity':RELIGHT_LIMITS.intensity,'shadow-strength':RELIGHT_LIMITS.softness,'shadow-softness':RELIGHT_LIMITS.softness};
    for(const [id,range]of Object.entries(limits)){this.el(id).min=String(range.min);this.el(id).max=String(range.max);}
    for(const [id,{limits,step,label}]of Object.entries(SLIDER_CONTROLS)){
      const node=this.el(`${id}-slider`);node.min=String(limits.min);node.max=String(limits.max);node.step=String(step);
      for(const [name,value]of Object.entries({min:limits.min,max:limits.max,step}))node.setAttribute(name,String(value));
      node.setAttribute('aria-label',t(label));this.el(id).setAttribute('aria-label',t('精确值：{0}',t(label)));
      this.listen(node,'pointerdown',e=>void this.guard(()=>{if(!(e.button>0))this.beginSlider(id,e.pointerId);}));
      this.listen(node,'input',()=>void this.guard(()=>this.inputSlider(id)));
      this.listen(node,'change',()=>void this.guard(()=>{this.inputSlider(id);this.finishSlider();}));
      this.listen(node,'blur',()=>this.finishSlider());
    }
    for(const [id,label]of Object.entries(EXTRACTION_CONTROLS)){
      const slider=this.el(`${id}-slider`),number=this.el(id);
      for(const node of [slider,number]){node.min='0';node.max='1';node.step='.01';for(const [key,value]of Object.entries({min:0,max:1,step:.01}))node.setAttribute(key,String(value));}
      slider.setAttribute('aria-label',t(label));number.setAttribute('aria-label',t('精确值：{0}',t(label)));
      this.listen(slider,'pointerdown',e=>{if(!(e.button>0))this.beginExtraction(e.pointerId);});
      this.listen(slider,'input',()=>void this.guard(()=>this.inputExtraction(id,slider.value)));
      this.listen(slider,'change',()=>void this.guard(()=>{this.inputExtraction(id,slider.value);this.finishExtraction();}));
      this.listen(slider,'blur',()=>this.finishExtraction());
      this.listen(number,'change',()=>void this.guard(()=>{this.inputExtraction(id,number.value);this.finishExtraction();}));
    }
    this.el('name').maxLength=RELIGHT_LIMITS.maxName;this.el('supplement').setAttribute('maxlength',String(RELIGHT_LIMITS.maxSupplement));
    this.click('close',()=>this.dialog.close('user-close'));
    this.click('pending-tasks',()=>{
      if(this.pending||this.nativeBusy||this.host.busy?.())return;
      this.finishInteraction();this.reopenAfterClose=false;
      this.afterClose=async()=>{this.lifecycle++;if(this.request)this.request.cancelled=true;await this.save();await this.host.openPendingTasks?.();};
      this.dialog.close('pending-tasks');
    });
    this.click('add',()=>{this.session.editor.add(this.host.uuid());this.changed();});
    this.click('duplicate',()=>{const id=this.session.editor.selectedId;if(id){this.session.editor.duplicate(id,this.host.uuid());this.changed();}});
    this.click('delete',()=>this.removeSelected());
    this.click('undo',()=>{this.session.editor.undo();this.changed();});this.click('redo',()=>{this.session.editor.redo();this.changed();});
    for(const tab of ['original','illustration','result'] as Tab[])this.click(`tab-${tab}`,()=>{this.tab=tab;this.refresh();});
    this.click('hide-markers',()=>{this.markersVisible=!this.markersVisible;this.refresh();});
    this.click('pan',()=>{this.panMode=!this.panMode;this.refresh();});
    this.click('fit',()=>{this.viewport.zoom=1;this.viewport.panX=0;this.viewport.panY=0;this.measure();this.refresh();});
    this.click('zoom-in',()=>this.zoom(1.25));this.click('zoom-out',()=>this.zoom(.8));
    this.click('advanced-toggle',()=>{this.advanced=!this.advanced;this.refresh();});
    this.click('retry-preview',()=>{this.schedulePreview();});
    this.click('save',async()=>{await this.save();this.message(t('布光草稿已保存'));});
    this.click('load-draft',async()=>{const scene=await this.host.loadDraft();if(!scene)throw new Error(t('尚无保存的布光草稿'));this.finishInteraction();try{this.session.restore(scene);this.selectedResult=undefined;this.changed();}catch(error){this.pendingDraft=scene;this.refresh();throw error;}});
    this.click('reuse-draft',()=>{if(this.pendingDraft){this.session.restore(this.pendingDraft,true);this.pendingDraft=undefined;this.selectedResult=undefined;this.changed();this.message(t('已明确将保存的布光复用到当前快照，请检查位置后生成'));}});
    this.click('reread',()=>this.rereadSource());
    if(this.el('recover-color'))this.click('recover-color',()=>{
      if(this.pending||this.nativeBusy||this.host.busy?.()||!this.host.colorRecovery?.()||!this.host.recoverColor)return;
      this.sourceSyncFailed=true;this.invalidateSource();
      this.closeForNative(async()=>{
        await this.host.recoverColor!();
        this.sourceRefreshed();
        this.message(t('色彩副本已恢复并读取；布光配置已保留，请检查新来源后明确生成。旧候选仍可检查或导出。'));await this.save();
      });
    });
    this.listen(this.el('output'),'change',()=>void this.guard(()=>{
      this.finishInteraction();
      const previous=this.session.outputKind;this.session.setOutputKind(this.el('output').value);
      if(this.session.outputKind===previous)return;
      this.outputPending=true;this.message(t('切换输出方式后请重新读取原图；布光配置已保留'));this.refresh();
    }));
    this.click('generate',()=>this.generate());
    this.click('cancel',async()=>{if(this.request)this.request.cancelled=true;await this.host.cancel();this.message(t('已请求取消或停止后续候选；平台当前任务可能继续并计费，结果保留在历史中'));this.refresh();});
    this.click('apply',()=>{if(this.pending||this.nativeBusy)return;this.assertHostIdle();const r=this.result();if(!r)throw new Error(t('请先选择实际 AI 结果'));const kind=relightOutputKind(r),inspect=this.el('apply').getAttribute('data-result-action')==='inspect';this.closeForNative(async()=>{if(inspect){if(!this.host.inspectResult)throw r.lightingFailure??new DiagnosticError('source-changed','apply',t('此结果属于旧来源快照，仅可查看或导出；请对当前来源重新生成'));await this.host.inspectResult(r.jobId);this.message(t('来源检查通过；请再次明确应用候选。'));return;}await this.host.apply(r.jobId);this.message(t(kind==='lighting-layers'?'光影层已应用；原图细节保留在来源图层，可编辑并一次撤销':'完整结果已应用；可编辑蒙版并一次撤销'));});});
    this.click('export',async()=>{const r=this.result();if(!r)throw new Error(t('请先选择实际 AI 结果'));await this.host.export(r.jobId);});
    this.listen(this.el('acknowledge'),'change',()=>{this.acknowledged=!!this.el('acknowledge').checked;});
    this.listen(this.el('lights'),'click',e=>{const node=e.target?.closest?.('[data-light-id]');if(!node)return;this.finishInteraction();const id=node.getAttribute('data-light-id');this.session.editor.select(id);if(node.getAttribute('data-find')==='true')this.findLight(id);this.refresh();});
    this.listen(this.el('result-list'),'click',e=>{const node=e.target?.closest?.('[data-job-id]');if(!node)return;this.extractionToken++;this.extractionGesture=undefined;this.selectedResult=node.getAttribute('data-job-id');this.tab='result';this.refresh();});
    for(const id of ['name','type','role','enabled','locked','x','y','z','intensity','range','softness','cone','targetX','targetY','direction','elevation','color-mode','temperature','color','ambient-intensity','ambient-color','existing','shadow-strength','shadow-softness','content','supplement']){
      const node=this.el(id);this.listen(node,'change',()=>void this.guard(()=>{this.finishInteraction();this.commitControl(id);}));
    }
    this.listen(this.el('markers'),'pointerdown',e=>void this.guard(()=>this.startDrag(e)));
    this.listen(this.el('viewport'),'pointerdown',e=>{if(this.panMode&&!e.target?.closest?.('[data-light-id]'))void this.guard(()=>this.startPan(e));});
    const doc=this.dialog.ownerDocument;
    this.listen(doc,'pointermove',e=>this.moveDrag(e));this.listen(doc,'pointerup',e=>this.finishInteraction(e));this.listen(doc,'pointercancel',e=>this.finishInteraction(e,true));
    // UXP does not promise lostpointercapture dispatch. Keep independent blur,
    // cancel and released-buttons paths; do not rely on browser-only events.
    this.listen(doc,'lostpointercapture',e=>this.finishInteraction(e));
    this.listen(doc,'pointerout',e=>{if(!e.relatedTarget&&e.buttons===0)this.finishInteraction(e);});
    this.listen(this.dialog,'blur',e=>{if(e.target===this.dialog)this.finishInteraction();});
    this.listen(doc,'keydown',e=>this.key(e));
    const win=doc.defaultView;if(win?.addEventListener){this.listen(win,'resize',()=>{if(this.visible)this.measure();});this.listen(win,'blur',()=>this.finishInteraction());}
    this.listen(this.dialog,'resize',()=>this.measure());
    this.listen(this.dialog,'cancel',()=>{this.afterClose=undefined;});
    if(this.host.observeSource)this.listeners.push(this.host.observeSource(()=>{this.invalidateSource();this.checkSourceState();}));
    const state=this.host.sourceState?.();if(state&&state!=='current')this.invalidateSource();
    if(!this.lastStatus)this.message(t('编辑布光不会发起 AI 请求；主动点击生成'));
    else this.el('status').textContent=this.lastStatus;
    this.refresh();
    try{
      const capture=this.session.sourceCapture,mask=downsampleSnapshotMask(capture.snapshot,capture.image.width,capture.image.height);
      this.preview=prepareRelightPreview(capture.image,mask);this.finalRenderer=new RelightPreviewRenderer(this.preview);
      this.dragRenderer=new RelightPreviewRenderer(prepareRelightPreview(this.preview.image,this.preview.mask,{maxEdge:240}));
      this.originalUrl=dataUrl(this.preview.image);this.schedulePreview();this.renderImage();
    }
    catch(error){this.message(t('布光示意失败，请重试示意或重新读取原图：{0}',error instanceof Error?error.message:String(error)));this.tab='original';}
  }
  private rereadSource(explicit=true):void {
    if(this.pending||this.nativeBusy||this.host.busy?.())return;
    if(explicit)this.sourceSyncFailed=false;
    this.invalidateSource();
    this.closeForNative(async()=>{
      try{await this.host.reread({explicit});}
      catch(error){this.sourceSyncFailed=true;throw error;}
      this.sourceRefreshed();await this.save();
    });
  }
  /** Metadata checks are cheap; the actual read runs only after the dialog closes. */
  private checkSourceState():void {
    if(!this.visible)return;
    const state=this.host.sourceState?.();if(!state||state==='current')return;
    if(!this.sourceInvalid)this.invalidateSource();
    if(state!=='changed'||!this.canSyncSource()||this.sourceSyncTimer)return;
    this.sourceSyncTimer=setTimeout(()=>{this.sourceSyncTimer=undefined;if(this.host.sourceState?.()==='changed'&&this.canSyncSource())this.rereadSource(false);},0);
  }
  private canSyncSource():boolean {return this.visible&&!this.transitioning&&!this.pending&&!this.nativeBusy&&!this.drag&&!this.sliderGesture&&!this.scopePending&&!this.outputPending&&!this.sourceSyncFailed&&!this.host.busy?.()&&!(this.host.pendingTasks?.()??0)&&this.host.results().length===0;}
  private interactionIdle():void {
    const EventType=this.dialog.ownerDocument.defaultView?.Event;
    if(typeof EventType==='function')this.dialog.dispatchEvent(new EventType('psai-interaction-idle',{bubbles:true}));
  }
  private cancelPreview():void {
    this.previewToken++;this.previewRequest=undefined;
    if(this.previewTimer)clearTimeout(this.previewTimer);this.previewTimer=undefined;
  }
  private cleanup():void {
    this.extractionToken++;this.extractionGesture=undefined;this.finishInteraction();for(const remove of this.listeners.splice(0))remove();
    this.cancelPreview();this.finalRenderer?.clear();this.dragRenderer?.clear();this.finalRenderer=undefined;this.dragRenderer=undefined;
    if(this.resizeTimer)clearTimeout(this.resizeTimer);this.resizeTimer=undefined;
    if(this.saveTimer)clearTimeout(this.saveTimer);this.saveTimer=undefined;
    if(this.sourceSyncTimer)clearTimeout(this.sourceSyncTimer);this.sourceSyncTimer=undefined;
    this.preview=undefined;this.originalUrl='';this.illustrationUrl='';this.resultUrl='';this.resultUrlId='';this.resultImage=undefined;
    this.displayedImageUrl='';this.displayedImageGeometry='';
    this.el('image').removeAttribute('src');this.el('markers').innerHTML='';this.markerNodes.clear();this.lightListKey='';this.resultListKey='';this.interactionIdle();
  }
  private schedulePreview():void {
    this.previewCounters.requested++;
    const request:PreviewRequest={token:++this.previewToken,quality:this.drag||this.sliderGesture?'drag':'final',snapshotId:this.session.editor.snapshot().source.snapshotId};
    if(!this.visible||!this.preview||this.sourceInvalid)return;
    this.previewRequest=request;
    if(this.previewTimer)clearTimeout(this.previewTimer);this.previewTimer=undefined;
    this.queuePreview();
  }
  private queuePreview():void {
    if(!this.visible||!this.previewRequest||this.previewRun||this.previewTimer||this.sourceInvalid)return;
    const delay=this.previewRequest.quality==='drag'?Math.max(0,32-(Date.now()-this.lastRender)):0;
    this.previewTimer=setTimeout(()=>{
      this.previewTimer=undefined;const request=this.previewRequest;if(!request||!this.visible||request.token!==this.previewToken||this.sourceInvalid)return;
      this.previewRequest=undefined;const renderer=request.quality==='drag'?this.dragRenderer:this.finalRenderer;if(!renderer)return;
      const current=()=>this.visible&&!this.sourceInvalid&&request.token===this.previewToken&&request.snapshotId===this.session.editor.snapshot().source.snapshotId;
      this.previewRun=request;this.previewCounters.started++;this.lastRender=Date.now();const started=Date.now(),scene=this.session.editor.snapshot();
      void renderer.render(scene,{cancelled:()=>!current()}).then(image=>{
        this.previewCounters.renderMs=Date.now()-started;
        // CPU work may finish after another pointer/source request. Encode only
        // the newest version, and retain the last accepted image until it is ready.
        if(!current()){this.previewCounters.discarded++;return;}
        const encoded=Date.now(),url=dataUrl(image,request.quality==='drag');this.previewCounters.encodeMs=Date.now()-encoded;this.previewCounters.encoded++;
        if(!current()){this.previewCounters.discarded++;return;}
        this.illustrationUrl=url;this.previewCounters.completed++;this.renderImage();
      }).catch(error=>{
        if(error?.name==='AbortError'){this.previewCounters.discarded++;return;}
        if(current())this.message(t('布光示意失败，请重试示意或重新读取原图：{0}',error instanceof Error?error.message:String(error)));
      }).finally(()=>{if(this.previewRun===request){this.previewRun=undefined;this.queuePreview();}});
    },delay);
  }
  private refresh():void {
    if(!this.visible)return;
    if(this.sliderGesture&&(this.nativeBusy||this.host.busy?.()&&!this.pending||this.sliderGesture.lightId!==null&&this.sliderGesture.lightId!==this.session.editor.selectedId))this.finishSlider();
    this.checkSourceState();
    const scene=this.session.editor.snapshot(),light=scene.lights.find(l=>l.id===this.session.editor.selectedId),doc=this.dialog.ownerDocument;
    this.reconcileInvalid(light);
    if(this.parameterStatus&&!this.invalid.size)this.message(t('编辑布光不会发起 AI 请求；主动点击生成'));
    const defaults=createRelightScene(scene.source,'color-default');
    const captured=this.session.sourceCapture;
    this.el('color-warning').style.display=captured.snapshot.colorReason==='assumed-srgb'?'block':'none';
    this.el('color-warning').textContent=captured.snapshot.colorReason==='assumed-srgb'?t('无法确认原色彩空间，已在独立 sRGB 副本中继续；颜色可能有偏差，原文档未修改。'):'';
    this.el('source').textContent=t('可见合成 · 文档 {0} · {1}×{2} · {3} · {4} 位',scene.source.documentId,scene.source.bounds.right-scene.source.bounds.left,scene.source.bounds.bottom-scene.source.bounds.top,scene.source.profile,scene.source.documentDepth)+(captured.documentName?` · ${captured.documentName}`:'')+t(this.session.scope==='document'?' · 整张图像（减去保护区）':' · 当前选区（减去保护区）')+(captured.workingCopyOf===undefined?'':t(' · sRGB 工作副本，原文档 {0}',captured.workingCopyOf))+(this.sourceInvalid?t(' · 来源已过期'):'');
    this.el('scope-info').textContent=t(this.session.scope==='document'?'作用范围：捕获时的整张图像减去保护区。位置与 Z 为图像相对意图，并非已恢复的三维结构。':'作用范围：捕获时的选区减去保护区。位置与 Z 为图像相对意图，并非已恢复的三维结构。');
    const lightListKey=JSON.stringify([scene.lights.map(l=>[l.id,l.name,l.color,l.enabled]),light?.id]);
    if(lightListKey!==this.lightListKey){this.lightListKey=lightListKey;this.el('lights').innerHTML='';scene.lights.forEach((l,i)=>{const row=doc.createElement('div');row.className='relight-light-row'+(l.id===light?.id?' selected':'');const select=doc.createElement('button');select.className='relight-light-name';select.setAttribute('data-light-id',l.id);const swatch=doc.createElement('span');swatch.className='relight-swatch';swatch.style.backgroundColor=l.color.mode==='custom'?l.color.hex:l.color.kelvin<5000?'#F6C78A':l.color.kelvin>6500?'#A5C7FF':'#FFFFFF';select.appendChild(swatch);const text=doc.createElement('span');text.textContent=`${i+1}. ${l.name}${l.enabled?'':t('（已禁用）')}`;select.appendChild(text);row.appendChild(select);const find=doc.createElement('button');find.className='relight-find';find.textContent=t('找回');find.setAttribute('data-light-id',l.id);find.setAttribute('data-find','true');row.appendChild(find);this.el('lights').appendChild(row);});}
    this.el('selected').style.display=light?'block':'none';
    const set=(id:string,value:unknown)=>{
      if(doc.activeElement!==this.el(id)&&!this.invalid.has(id)||this.sliderGesture?.id===id)this.el(id).value=String(value);
      if(SLIDER_CONTROLS[id])this.el(`${id}-slider`).value=String(value);
    };
    if(light){
      for(const key of ['name','type','role','x','y','z','intensity','range','softness','cone','targetX','targetY','direction','elevation'] as const)set(key,light[key]);
      this.el('enabled').checked=light.enabled;this.el('locked').checked=light.positionLocked;
      const defaultColor=defaults.lights[0].color;
      set('color-mode',light.color.mode);set('temperature',light.color.mode==='temperature'?light.color.kelvin:defaultColor.mode==='temperature'?defaultColor.kelvin:RELIGHT_LIMITS.temperature.min);set('color',light.color.mode==='custom'?light.color.hex:defaults.ambient.color);
      const directional=light.type==='directional';for(const id of ['position','range-field','depth-field'])this.el(id).style.display=directional?'none':id==='position'?'flex':'block';
      this.el('locked').style.display=directional?'none':'block';this.el('spot-fields').style.display=light.type==='spot'?'block':'none';this.el('direction-fields').style.display=directional?'block':'none';
      this.el('temperature-field').style.display=light.color.mode==='temperature'?'block':'none';this.el('color-field').style.display=light.color.mode==='custom'?'block':'none';
      for(const id of ['x','y','z'])this.el(id).disabled=light.positionLocked;
    }
    set('ambient-intensity',scene.ambient.intensity);set('ambient-color',scene.ambient.color);set('existing',scene.existingLighting);set('shadow-strength',scene.shadow.strength);set('shadow-softness',scene.shadow.softness);set('content',scene.preserveContent);set('supplement',scene.supplement);
    this.el('advanced').style.display=this.advanced?'block':'none';
    this.el('add').disabled=scene.lights.length>=RELIGHT_LIMITS.maxLights;this.el('duplicate').disabled=!light||scene.lights.length>=RELIGHT_LIMITS.maxLights;this.el('delete').disabled=!light;
    this.el('undo').disabled=!this.session.editor.canUndo;this.el('redo').disabled=!this.session.editor.canRedo;
    this.el('hide-markers').textContent=t(this.markersVisible?'隐藏标记':'显示标记');this.el('pan').className=this.panMode?'active':'';this.el('viewport').className=[this.panMode?'pan':'',this.drag?'dragging':''].filter(Boolean).join(' ');
    this.el('zoom-label').textContent=`${Math.round(this.viewport.zoom*100)}%`;
    for(const tab of ['original','illustration','result'])this.el(`tab-${tab}`).className=this.tab===tab?'active':'';
    const sharedBusy=!!this.host.busy?.();
    for(const id of Object.keys(SLIDER_CONTROLS)){
      const global=id==='ambient-intensity'||id==='shadow-strength'||id==='shadow-softness';
      const inactive=!global&&(!light||id==='temperature'&&light.color.mode!=='temperature'||['z','range'].includes(id)&&light.type==='directional'||id==='z'&&light.positionLocked||id==='cone'&&light.type!=='spot'||['direction','elevation'].includes(id)&&light.type!=='directional');
      // Our submitted generation owns a frozen scene, so local editing remains
      // available while it runs. Other global/native operations end the gesture.
      this.el(`${id}-slider`).disabled=this.el(id).disabled=this.nativeBusy||sharedBusy&&!this.pending||inactive;
    }
    const pendingTasks=this.host.pendingTasks?.()??0;this.el('pending-tasks').style.display=pendingTasks?'block':'none';this.el('pending-tasks').disabled=this.pending||this.nativeBusy||sharedBusy;this.el('pending-tasks').textContent=t('处理未确认任务（{0}）；保留布光并返回历史',pendingTasks);
    this.el('generate').disabled=this.pending||this.nativeBusy||this.sourceInvalid||this.scopePending||this.outputPending||sharedBusy;this.el('cancel').disabled=!this.pending;
    const result=this.result(),referenceOnly=!!result&&relightOutputKind(result)==='lighting-layers'&&result.lightingState!=='composite',checkSource=!!result&&(result.sourceSnapshotId!==undefined&&result.sourceSnapshotId!==scene.source.snapshotId||(this.host.resultSourceState?.(result.jobId)??(this.sourceInvalid?'changed':'current'))!=='current');
    const extraction=this.extractionGesture&&this.extractionGesture.jobId===result?.jobId?this.extractionGesture.settings:validateRelightExtractionSettings(result?.localExtraction),extractionDisabled=this.pending||pendingTasks>0||this.nativeBusy||sharedBusy||this.extractionPending||!result||relightOutputKind(result)!=='lighting-layers'||!this.host.reextract;
    for(const id of Object.keys(EXTRACTION_CONTROLS)){
      const value=extraction[id==='fidelity'?'fidelity':'detailProtection'];
      for(const node of [this.el(id),this.el(`${id}-slider`)]){node.disabled=extractionDisabled;node.value=String(value);}
    }
    this.el('extraction-controls').setAttribute('aria-busy',String(this.extractionPending));
    this.el('apply').disabled=this.pending||this.nativeBusy||sharedBusy||!result||!!result.warning&&!referenceOnly;this.el('export').disabled=!result;this.el('reread').disabled=this.pending||this.nativeBusy||sharedBusy;
    this.el('tab-result').textContent=t(result?resultLabel(result):'AI 结果');
    const color=this.el('recover-color'),colorAction=this.host.colorRecovery?.();
    if(color){color.style.display=colorAction?'block':'none';color.disabled=this.pending||this.nativeBusy||sharedBusy;color.textContent=t(colorAction==='retry'?'重试读取已恢复的色彩副本':'创建已恢复色彩副本并重新读取');}
    this.el('apply').textContent=t(referenceOnly?'查看提取失败原因':checkSource?'检查来源':result&&relightOutputKind(result)==='lighting-layers'?'应用光影层组':'应用整图结果');
    this.el('apply').setAttribute('data-result-action',referenceOnly||checkSource?'inspect':'apply');
    this.el('output').value=this.session.outputKind;
    if(this.el('output-info'))this.el('output-info').textContent=t(this.session.outputKind==='lighting-layers'?'光影层使用 AI 低分辨率参考估算照明影响；人脸、文字和材质仍需检查。':'整图重绘由 AI 生成完整编辑图，可能改变原图细节。');
    this.el('stale').textContent=result&&(result.fingerprint!==this.session.fingerprint||relightOutputKind(result)!==this.session.outputKind)?t('布光已修改，当前结果尚未更新；应用仍使用该结果提交时的配置'):'';
    this.el('warnings').textContent=[...this.warnings.map(warningText),...(result?.lightingFailure?[diagnostic(result.lightingFailure,'lighting-extraction').summary]:result?.warning?[errorText(result.warning)]:[])].join('\n');this.el('acknowledge').style.display=this.warnings.some(w=>/Resolve this conflict/.test(w))?'block':'none';this.el('acknowledge').checked=this.acknowledged;
    this.el('reuse-draft').style.display=this.pendingDraft?'block':'none';
    const results=this.host.results(),resultListKey=JSON.stringify([results.map(r=>[r.jobId,t(resultLabel(r))]),this.selectedResult]);
    if(resultListKey!==this.resultListKey){this.resultListKey=resultListKey;this.el('result-list').innerHTML='';results.forEach((r,i)=>{const button=doc.createElement('button');button.textContent=t('AI 结果 {0} · {1}',i+1,r.jobId.slice(0,8))+' · '+t(resultLabel(r));button.setAttribute('data-job-id',r.jobId);button.className=r.jobId===this.selectedResult?'active':'';this.el('result-list').appendChild(button);});}
    this.renderImage();this.renderMarkers();
  }
  private renderImage():void {
    if(!this.visible)return;
    const result=this.result();let url=this.tab==='original'?this.originalUrl:this.tab==='illustration'?this.illustrationUrl:'';
    if(this.tab==='result'&&result){if(this.resultUrlId!==result.jobId||this.resultImage!==result.image){this.resultUrl=dataUrl(prepareRelightPreview(result.image,new Uint8Array(result.image.width*result.image.height)).image);this.resultUrlId=result.jobId;this.resultImage=result.image;}url=this.resultUrl;}
    const img=this.el('image');img.alt=t(this.tab==='result'&&result?resultLabel(result):this.tab==='original'?'原图':'布光示意');
    // Assigning the identical data URL reloads PNG in UXP and can emit resize.
    // Track what this controller actually displayed, separately from cached tabs.
    if(url!==this.displayedImageUrl){this.displayedImageUrl=url;if(url)img.src=url;else img.removeAttribute('src');}
    const emptyText=url?'':t(this.tab==='result'?'尚无选中的实际 AI 结果，请生成或选择已保存的结果':'正在准备布光示意；也可查看原图');
    if(this.el('empty').textContent!==emptyText)this.el('empty').textContent=emptyText;
    const g=this.geometry(),origin=normalizedToViewport({x:0,y:0},g,this.viewport),scale=this.viewport.fitScale*this.viewport.zoom,r=this.viewport.clientRect;
    const left=`${origin.x-r.left}px`,top=`${origin.y-r.top}px`,width=`${(g.bounds.right-g.bounds.left)*scale}px`,height=`${(g.bounds.bottom-g.bounds.top)*scale}px`,geometry=[left,top,width,height].join('|');
    if(geometry!==this.displayedImageGeometry){this.displayedImageGeometry=geometry;img.style.left=left;img.style.top=top;img.style.width=width;img.style.height=height;}
  }
  private lightPoint(l:RelightLight):{x:number;y:number}{return l.type==='directional'?{x:.5+.3*Math.cos(l.direction*Math.PI/180),y:.5+.3*Math.sin(l.direction*Math.PI/180)}:{x:l.x,y:l.y};}
  private renderMarkers():void {
    if(!this.visible)return;
    if(this.viewport.clientRect.width<=36||this.viewport.clientRect.height<=36)return;
    const container=this.el('markers');container.style.display=this.markersVisible&&this.tab!=='result'?'block':'none';
    const scene=this.session.editor.snapshot(),g=this.geometry(),rect=this.viewport.clientRect,active=new Set<string>();
    for(const node of Array.from(container.querySelectorAll('[data-decoration]')) as any[])node.remove();
    const marker=(key:string,id:string,point:{x:number;y:number},text:string,classes:string,kind:string,label:string)=>{
      // PS27 native buttons can lose pointerdown at directional marker positions.
      // Keep a focusable DOM handle stable while its geometry/type changes.
      active.add(key);let node=this.markerNodes.get(key);if(!node){node=this.dialog.ownerDocument.createElement('div');node.setAttribute('data-light-id',id);node.setAttribute('data-kind',kind);node.setAttribute('role','button');node.setAttribute('tabindex','0');container.appendChild(node);this.markerNodes.set(key,node);}
      node.textContent=text;node.setAttribute('aria-label',label);node.className='relight-marker '+classes+(this.drag?.node===node?' dragging':'');const size=kind==='target'?24:28;
      node.style.left=`${point.x-rect.left-size/2}px`;node.style.top=`${point.y-rect.top-size/2}px`;
      return node;
    };
    scene.lights.forEach((l,index)=>{
      const selected=l.id===this.session.editor.selectedId,position=this.lightPoint(l),v=viewportLightIndicator(position,g,this.viewport,18);
      marker(l.id,l.id,v.indicator,String(index+1)+(v.onScreen?'':'↗'),`${selected?'selected ':''}${l.enabled?'':'disabled-light '}${v.onScreen?'':'edge '}${l.type==='directional'?'directional':''}`,'light',`${index+1}. ${l.name}`);
      if(selected){
        const from=normalizedToViewport(position,g,this.viewport);
        if(l.type==='spot'){
          const target=normalizedToViewport({x:l.targetX,y:l.targetY},g,this.viewport);this.line(from,target);const targetView=viewportLightIndicator({x:l.targetX,y:l.targetY},g,this.viewport,12);marker(`${l.id}:target`,l.id,targetView.indicator,'+','target','target',t('聚光目标'));
        }else if(l.type==='directional')this.line(normalizedToViewport({x:.5,y:.5},g,this.viewport),from);
        if(l.type!=='directional'){
          const scale=this.viewport.fitScale*this.viewport.zoom,diameter=l.range*Math.min(g.bounds.right-g.bounds.left,g.bounds.bottom-g.bounds.top)*scale*2,node=this.decoration('relight-range');node.style.left=`${from.x-rect.left-diameter/2}px`;node.style.top=`${from.y-rect.top-diameter/2}px`;node.style.width=`${diameter}px`;node.style.height=`${diameter}px`;
        }
      }
    });
    for(const [key,node]of this.markerNodes)if(!active.has(key)){node.remove();this.markerNodes.delete(key);}
  }
  private decoration(className:string):any {const node=this.dialog.ownerDocument.createElement('div');node.setAttribute('data-decoration','true');node.className=className;const container=this.el('markers');container.insertBefore(node,container.firstChild);return node;}
  private line(a:{x:number;y:number},b:{x:number;y:number}):void {
    const r=this.viewport.clientRect,dx=b.x-a.x,dy=b.y-a.y;let start=0,end=1;
    // Clip in client coordinates before sampling. Off-image/zoomed lines never allocate unbounded DOM.
    const edges=[[-dx,a.x-r.left],[dx,r.left+r.width-a.x],[-dy,a.y-r.top],[dy,r.top+r.height-a.y]];
    for(const [p,q]of edges){if(p===0){if(q<0)return;}else {const fraction=q/p;if(p<0)start=Math.max(start,fraction);else end=Math.min(end,fraction);if(start>end)return;}}
    const count=Math.min(96,Math.max(2,Math.ceil(Math.hypot(dx,dy)*(end-start)/4)+1));
    for(let i=0;i<count;i++){const fraction=start+(end-start)*i/(count-1),node=this.decoration('relight-line-dot');node.style.left=`${a.x+dx*fraction-r.left-1}px`;node.style.top=`${a.y+dy*fraction-r.top-1}px`;}
  }
  private zoom(factor:number):void {this.viewport.zoom=clamp(this.viewport.zoom*factor,.15,8);this.refresh();}
  private findLight(id:string):void {const l=this.session.editor.snapshot().lights.find(l=>l.id===id);if(!l)return;const point=normalizedToViewport(this.lightPoint(l),this.geometry(),this.viewport),r=this.viewport.clientRect;this.viewport.panX+=r.left+r.width/2-point.x;this.viewport.panY+=r.top+r.height/2-point.y;}
  private removeSelected():void {this.finishInteraction();const id=this.session.editor.selectedId;if(id){this.session.editor.remove(id);this.changed();}}
  private numeric(id:string,raw:unknown=this.el(id).value):number {const text=String(raw??'').trim(),n=Number(text);if(!text||!Number.isFinite(n))throw new Error(t('参数无效，请输入范围内的有限数值'));const limits=SLIDER_CONTROLS[id]?.limits;return limits?clamp(n,limits.min,limits.max):n;}
  private commitControl(id:string,raw:any=this.el(id).value):void {
    if(SLIDER_CONTROLS[id]&&this.el(id).disabled)return;
    try {
      const editor=this.session.editor,selected=editor.selectedId,light=editor.snapshot().lights.find(l=>l.id===selected),value=raw;
      if(id==='ambient-intensity')editor.updateScene({ambient:{intensity:this.numeric(id,raw)}});
      else if(id==='ambient-color')editor.updateScene({ambient:{color:String(value)}});
      else if(id==='existing')editor.updateScene({existingLighting:value});else if(id==='content')editor.updateScene({preserveContent:value});
      else if(id==='supplement')editor.updateScene({supplement:String(value??'')});
      else if(id==='shadow-strength'||id==='shadow-softness')editor.updateScene({shadow:{[id==='shadow-strength'?'strength':'softness']:this.numeric(id,raw)}});
      else if(selected&&light){
        if(id==='enabled'||id==='locked')editor.updateLight(selected,{[id==='enabled'?'enabled':'positionLocked']:!!this.el(id).checked});
        else if(['name','type','role'].includes(id))editor.updateLight(selected,{[id]:value});
        else if(id==='color-mode'){const defaults=createRelightScene(editor.snapshot().source,'color-default');editor.updateLight(selected,{color:value==='temperature'?defaults.lights[0].color:{mode:'custom',hex:defaults.ambient.color}});}
        else if(id==='color')editor.updateLight(selected,{color:{mode:'custom',hex:String(value)}});
        else if(id==='temperature')editor.updateLight(selected,{color:{mode:'temperature',kelvin:this.numeric(id,raw)}});
        else editor.updateLight(selected,{[id]:this.numeric(id,raw)});
      }
      if(SLIDER_CONTROLS[id])this.el(id).value=String(this.numeric(id,raw));
      this.invalid.delete(id);this.el(id).removeAttribute('aria-invalid');this.changed();
    }catch(error){this.invalid.add(id);this.el(id).setAttribute('aria-invalid','true');throw new ParameterValidationError(t('参数未保存，请修正后重试：{0}',error instanceof Error?error.message:String(error)));}
  }
  private beginSlider(id:string,pointerId?:number):boolean {
    if(this.el(`${id}-slider`).disabled)return false;
    if(this.sliderGesture?.id===id)return true;
    this.finishInteraction();this.session.editor.beginGesture();
    this.sliderGesture={id,lightId:LIGHT_CONTROLS.includes(id)?this.session.editor.selectedId:null,pointerId};
    if(this.saveTimer)clearTimeout(this.saveTimer);this.saveTimer=undefined;
    return true;
  }
  private inputSlider(id:string):void {
    // Native keyboard input/change can precede bubbled keydown. Start before
    // mutation; the later keyboard event must not open an unfinished gesture.
    if(!this.beginSlider(id))return;
    try{this.commitControl(id,this.el(`${id}-slider`).value);}
    catch(error){this.finishSlider(undefined,true);throw error;}
  }
  private finishSlider(e?:any,cancel=false):void {
    const gesture=this.sliderGesture;if(!gesture)return;
    if(e&&gesture.pointerId!==undefined&&e.pointerId!==undefined&&gesture.pointerId!==e.pointerId)return;
    this.sliderGesture=undefined;
    if(cancel)this.session.editor.cancelGesture();else this.session.editor.endGesture();
    if(this.visible)this.changed();this.interactionIdle();
  }
  private beginExtraction(pointerId?:number):boolean {
    if(this.el('fidelity-slider').disabled||!this.host.reextract)return false;
    const result=this.result();if(!result||relightOutputKind(result)!=='lighting-layers')return false;
    if(this.extractionGesture?.jobId===result.jobId)return true;
    this.finishDrag();this.finishSlider();this.extractionGesture={jobId:result.jobId,settings:validateRelightExtractionSettings(result.localExtraction),pointerId};return true;
  }
  private inputExtraction(id:string,raw:unknown):void {
    if(!this.beginExtraction())return;
    const text=String(raw??'').trim(),value=Number(text);
    if(!text||!Number.isFinite(value)){this.finishExtraction(undefined,true);throw new ParameterValidationError(t('参数无效，请输入范围内的有限数值'));}
    const key=id==='fidelity'?'fidelity':'detailProtection';this.extractionGesture!.settings[key]=clamp(value,0,1);
    for(const node of [this.el(id),this.el(`${id}-slider`)])node.value=String(this.extractionGesture!.settings[key]);
  }
  private finishExtraction(e?:any,cancel=false):void {
    const gesture=this.extractionGesture;if(!gesture)return;
    if(e&&gesture.pointerId!==undefined&&e.pointerId!==undefined&&gesture.pointerId!==e.pointerId)return;
    this.extractionGesture=undefined;
    const result=this.result();if(cancel||!result||result.jobId!==gesture.jobId){if(this.visible)this.refresh();return;}
    const saved=validateRelightExtractionSettings(result.localExtraction);
    if(saved.fidelity===gesture.settings.fidelity&&saved.detailProtection===gesture.settings.detailProtection){if(this.visible)this.refresh();return;}
    const token=++this.extractionToken,lifecycle=this.lifecycle;
    const current=()=>this.visible&&this.lifecycle===lifecycle&&this.extractionToken===token&&this.selectedResult===gesture.jobId;
    this.extractionPending=true;this.message(t('正在本地更新光影层…'));this.refresh();
    void this.host.reextract!(gesture.jobId,gesture.settings,current).then(()=>{if(current()){this.resultImage=undefined;this.message(t('已更新此候选的本地光影层；未重新生成。'));}}).catch(error=>{if(current())this.message(t('本地调整失败，已保留原候选和参数：{0}',errorText(error instanceof Error?error.message:String(error))));}).finally(()=>{this.extractionPending=false;if(this.visible)this.refresh();});
  }
  private finishInteraction(e?:any,cancel=false):void {this.finishDrag(e,cancel);this.finishSlider(e,cancel);this.finishExtraction(e,cancel);}
  private startDrag(e:any):void {
    const node=e.target?.closest?.('[data-light-id]');if(!node||e.button>0||this.drag)return;
    this.finishSlider();
    e.preventDefault();const id=node.getAttribute('data-light-id');this.session.editor.select(id);
    if(this.panMode){this.startPan(e);return;}
    const light=this.session.editor.snapshot().lights.find(l=>l.id===id)!;if(light.positionLocked&&light.type!=='directional'&&node.getAttribute('data-kind')!=='target'){this.message(t('光源位置已锁定，请先解锁'));this.refresh();return;}
    this.session.editor.beginGesture();this.drag={kind:node.getAttribute('data-kind')==='target'?'target':'light',id,startX:e.clientX,startY:e.clientY,panX:this.viewport.panX,panY:this.viewport.panY,pointerId:e.pointerId,node};
    try{if(typeof node.setPointerCapture==='function'&&Number.isFinite(e.pointerId))node.setPointerCapture(e.pointerId);}catch(error){this.finishDrag(undefined,true);throw error;}
    this.refresh();
  }
  private startPan(e:any):void {
    if(e.button>0||this.drag)return;this.finishSlider();e.preventDefault();const node=this.el('viewport');
    this.drag={kind:'pan',startX:e.clientX,startY:e.clientY,panX:this.viewport.panX,panY:this.viewport.panY,pointerId:e.pointerId,node};
    try{if(typeof node.setPointerCapture==='function'&&Number.isFinite(e.pointerId))node.setPointerCapture(e.pointerId);}catch(error){this.finishDrag(undefined,true);throw error;}
    this.el('viewport').className='pan dragging';
  }
  private moveDrag(e:any):void {
    const d=this.drag;if(!d||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return;
    if(d.pointerId!==undefined&&e.pointerId!==undefined&&d.pointerId!==e.pointerId)return;
    if(e.buttons===0){this.finishDrag(e);return;}
    e.preventDefault();
    if(d.kind==='pan'){this.viewport.panX=d.panX+e.clientX-d.startX;this.viewport.panY=d.panY+e.clientY-d.startY;this.renderImage();this.renderMarkers();return;}
    const point=viewportToNormalized({x:e.clientX,y:e.clientY},this.geometry(),this.viewport),light=this.session.editor.snapshot().lights.find(l=>l.id===d.id)!;
    try{if(d.kind==='target')this.session.editor.updateLight(d.id!,{targetX:clamp(point.x,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max),targetY:clamp(point.y,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max)});
      else if(light.type==='directional')this.session.editor.updateLight(d.id!,{direction:Math.atan2(point.y-.5,point.x-.5)*180/Math.PI});
      else this.session.editor.updateLight(d.id!,{x:clamp(point.x,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max),y:clamp(point.y,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max)});
      this.refreshDrag();this.schedulePreview();
    }catch(error){this.message(error instanceof Error?error.message:String(error));this.finishDrag(undefined,true);}
  }
  private refreshDrag():void {
    this.acknowledged=false;this.warnings=[];this.el('warnings').textContent='';this.el('acknowledge').checked=false;this.el('acknowledge').style.display='none';
    const light=this.session.editor.snapshot().lights.find(l=>l.id===this.drag?.id);
    if(light)for(const key of ['x','y','targetX','targetY','direction'] as const){this.el(key).value=String(light[key]);if(SLIDER_CONTROLS[key])this.el(`${key}-slider`).value=String(light[key]);}
    this.el('viewport').className=this.panMode?'pan dragging':'dragging';
    const result=this.result();this.el('stale').textContent=result&&result.fingerprint!==this.session.fingerprint?t('布光已修改，当前结果尚未更新；应用仍使用该结果提交时的配置'):'';
    this.renderMarkers();
  }
  private finishDrag(e?:any,cancel=false):void {
    const d=this.drag;if(!d)return;if(e&&d.pointerId!==undefined&&e.pointerId!==undefined&&d.pointerId!==e.pointerId)return;this.drag=undefined;
    try{if(d.node&&d.pointerId!==undefined&&typeof d.node.releasePointerCapture==='function')d.node.releasePointerCapture(d.pointerId);}catch{}
    if(d.kind!=='pan'){if(cancel)this.session.editor.cancelGesture();else this.session.editor.endGesture();if(this.visible)this.changed();}
    else if(this.visible)this.refresh();
    this.el('viewport').className=this.panMode?'pan':'';this.interactionIdle();
  }
  private key(e:any):void {
    if(this.visible&&e.key==='Escape'&&(this.drag||this.sliderGesture||this.extractionGesture)){e.preventDefault();e.stopPropagation();this.finishInteraction(undefined,true);return;}
    if(!this.visible||relightTextFocus(e.target)||relightTextFocus(this.dialog.ownerDocument.activeElement))return;
    if(!this.dialog.contains(e.target)&&!this.dialog.contains(this.dialog.ownerDocument.activeElement))return;
    const marker=e.target?.closest?.('[data-light-id]');
    if((e.key==='Enter'||e.key===' ')&&marker&&this.el('markers').contains(marker)){e.preventDefault();this.finishInteraction();this.session.editor.select(marker.getAttribute('data-light-id'));this.refresh();}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();this.removeSelected();}
    else if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='z'){e.preventDefault();this.finishInteraction();if(e.shiftKey)this.session.editor.redo();else this.session.editor.undo();this.changed();}
    else if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='y'){e.preventDefault();this.finishInteraction();this.session.editor.redo();this.changed();}
  }
  get conflictAcknowledged():boolean{return this.acknowledged;}
}
