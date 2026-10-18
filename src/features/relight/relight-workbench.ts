import {encodePng,type Raster} from '../../imaging/image';
import {RELIGHT_LIMITS,createRelightScene,normalizedToViewport,viewportToNormalized,viewportLightIndicator,type RelightScene,type RelightLight,type RelightViewport,type RelightGeometry} from './relight-scene';
import {prepareRelightPreview,renderRelightPreview,type RelightPreparedPreview} from './relight-preview';
import {RelightSession,type FrozenRelightSubmission} from './relight-session';
import {t,errorText} from '../../localization/i18n';

export interface RelightResult {jobId:string;fingerprint:string;image:Raster;warning?:string}
export interface RelightWorkbenchHost {
  uuid():string;save(scene:RelightScene):Promise<void>;loadDraft():Promise<RelightScene|undefined>;
  prepare(frozen:FrozenRelightSubmission):Promise<void>;
  generate(frozen:FrozenRelightSubmission,onJob:(id:string)=>void):Promise<void>;
  cancel():Promise<void>;reread():Promise<void>;apply(jobId:string):Promise<void>;export(jobId:string):Promise<void>;
  results():RelightResult[];diagnostics(jobId:string):Promise<string>;
  busy?():boolean;reportError?(error:Error):void;
}
type Tab='original'|'illustration'|'result';
type Drag={kind:'light'|'target'|'pan';id?:string;startX:number;startY:number;panX:number;panY:number;pointerId?:number;node?:any};
type RequestOwner={lifecycle:number;fingerprint:string;ids:Set<string>;cancelled:boolean};
class ParameterValidationError extends Error {}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const LIGHT_CONTROLS=['name','type','role','enabled','locked','x','y','z','intensity','range','softness','cone','targetX','targetY','direction','elevation','color-mode','temperature','color'];
function warningText(warning:string):string {
  if(warning.startsWith('Lighting uses semantic control'))return t('语义布光控制不保证每盏光源的精确效果或像素保持。');
  if(warning.startsWith('The supplement requests no shadows'))return t('补充描述要求没有阴影，但结构化阴影强度大于零；请解决冲突。');
  if(warning.startsWith('The supplement requests lighting from one side'))return t('补充描述要求仅从一侧照明，但启用的主光在另一侧；请解决冲突。');
  if(warning.startsWith('The supplement requests all lights off'))return t('补充描述要求关闭全部光源，但启用光源的强度大于零；请解决冲突。');
  if(warning.startsWith('Supplement conflict checks'))return t('仅检测少量明显冲突，请人工检查其他补充描述；原文会保持不变。');
  if(warning.startsWith('Only the clean source image fits'))return t('此模型只能容纳干净原图，辅助蒙版不能替换原图；最终范围仍由保存的选区限制。');
  return errorText(warning);
}
function dataUrl(image:Raster):string {
  const bytes=encodePng(image),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let encoded='';
  for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]??0)<<8)|(bytes[i+2]??0);encoded+=alphabet[n>>>18]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');}
  return 'data:image/png;base64,'+encoded;
}
export function relightTextFocus(node:any):boolean {
  for(let current=node;current;current=current.parentElement){
    if(['input','textarea','select','sp-textarea','sp-picker','sp-textfield'].includes(String(current.tagName??'').toLowerCase())||current.isContentEditable||current.getAttribute?.('contenteditable')==='true')return true;
  }
  return false;
}

/** Real UXP dialog controller. Native callbacks always run after uxpShowModal resolves. */
export class RelightWorkbench {
  private tab:Tab='illustration';private markersVisible=true;private panMode=false;private advanced=false;
  private viewport:RelightViewport={clientRect:{left:0,top:0,width:1,height:1},fitScale:1,zoom:1,panX:0,panY:0};
  private visible=false;private transitioning=false;private pending=false;private nativeBusy=false;private lifecycle=0;
  private request?:RequestOwner;private selectedResult?:string;private lastStatus='';private parameterStatus=false;private warnings:string[]=[];private acknowledged=false;private sourceInvalid=false;
  private pendingDraft?:RelightScene;private invalid=new Set<string>();private invalidLightId:string|null=null;private afterClose?:()=>Promise<void>;
  private listeners:Array<()=>void>=[];private drag?:Drag;private preview?:RelightPreparedPreview;
  private originalUrl='';private illustrationUrl='';private resultUrl='';private resultUrlId='';
  private displayedImageUrl='';private displayedImageGeometry='';
  private previewToken=0;private previewRunning=false;private lastRender=0;private previewTimer?:ReturnType<typeof setTimeout>;private resizeTimer?:ReturnType<typeof setTimeout>;private saveTimer?:ReturnType<typeof setTimeout>;
  private markerNodes=new Map<string,any>();
  constructor(private dialog:any,public session:RelightSession,private host:RelightWorkbenchHost){}
  get isOpen():boolean{return this.visible;}
  get currentResultId():string|undefined{return this.selectedResult;}
  get isGenerating():boolean{return this.pending;}
  refreshAvailability():void {if(this.visible)this.refresh();}
  setSourceInvalid(invalid:boolean):void {this.sourceInvalid=invalid;if(invalid)this.message(t('来源已关闭或改变，请重新读取原图；布光配置和已有结果仍保留'));if(this.visible)this.refresh();}
  private el(id:string):any{return this.dialog.querySelector(`#relight-${id}`);}
  private listen(node:any,name:string,fn:(event:any)=>void):void {node.addEventListener(name,fn);this.listeners.push(()=>node.removeEventListener(name,fn));}
  private click(id:string,fn:()=>void|Promise<void>):void {this.listen(this.el(id),'click',()=>void this.guard(fn));}
  private async guard(fn:()=>void|Promise<void>):Promise<void>{try{await fn();}catch(error){this.message(error instanceof Error?error.message:String(error),error instanceof ParameterValidationError);}}
  private message(text:string,parameter=false):void {this.parameterStatus=parameter;this.lastStatus=errorText(text);if(this.visible)this.el('status').textContent=this.lastStatus;}
  private geometry():RelightGeometry {const b=this.session.editor.snapshot().source.bounds,w=b.right-b.left,h=b.bottom-b.top;return {bounds:b,modelWidth:w,modelHeight:h,modelContentRect:{left:0,top:0,right:w,bottom:h}};}
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
    this.saveTimer=setTimeout(()=>{this.saveTimer=undefined;void this.guard(()=>this.save());},180);
  }
  setWarnings(warnings:string[]):void {this.warnings=[...warnings];if(this.visible)this.refresh();}
  progress(text:string):void {if(this.visible&&this.request?.lifecycle===this.lifecycle&&!this.request.cancelled)this.message(text);}
  /** Saving history is independent; only the owned, noncancelled request may select a new success. */
  notifyResult(jobId:string):void {
    const owner=this.request;
    if(!this.visible||!owner||owner.cancelled||owner.lifecycle!==this.lifecycle||!owner.ids.has(jobId))return;
    const result=this.host.results().find(r=>r.jobId===jobId&&r.fingerprint===owner.fingerprint);
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
    const action=this.afterClose;this.afterClose=undefined;
    if(action){this.transitioning=true;try{await action();}catch(error){this.message(error instanceof Error?error.message:String(error));}finally{this.transitioning=false;this.show();}}
    else {this.lifecycle++;if(this.request)this.request.cancelled=true;await this.save().catch(error=>this.message(t('布光草稿保存失败，请重新打开后点击保存：{0}',error instanceof Error?error.message:String(error))));}
  }
  private closeForNative(action:()=>Promise<void>):void {
    if(!this.visible||this.nativeBusy)return;
    this.finishDrag();this.nativeBusy=true;
    this.afterClose=async()=>{try{await action();}finally{this.nativeBusy=false;}};
    this.dialog.close('native-operation');
  }
  private generate():void {
    if(this.pending||this.nativeBusy||this.sourceInvalid)return;
    this.assertHostIdle();
    if(this.invalid.size)throw new ParameterValidationError(t('请先修正标记为无效的参数，再生成'));
    const frozen=this.session.freeze(),owner:RequestOwner={lifecycle:this.lifecycle,fingerprint:frozen.fingerprint,ids:new Set(),cancelled:false};
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
    if(!Number.isFinite(box.width)||!Number.isFinite(box.height)||box.width<=0||box.height<=0){this.message(t('无法读取预览区域尺寸，请点击适应窗口重试'));return;}
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
    this.el('output').value='full';
    const limits:Record<string,{min:number;max:number}>={x:RELIGHT_LIMITS.position,y:RELIGHT_LIMITS.position,z:RELIGHT_LIMITS.depth,targetX:RELIGHT_LIMITS.position,targetY:RELIGHT_LIMITS.position,intensity:RELIGHT_LIMITS.intensity,range:RELIGHT_LIMITS.range,softness:RELIGHT_LIMITS.softness,cone:RELIGHT_LIMITS.cone,direction:RELIGHT_LIMITS.direction,elevation:RELIGHT_LIMITS.elevation,temperature:RELIGHT_LIMITS.temperature,'ambient-intensity':RELIGHT_LIMITS.intensity,'shadow-strength':RELIGHT_LIMITS.softness,'shadow-softness':RELIGHT_LIMITS.softness};
    for(const [id,range]of Object.entries(limits)){this.el(id).min=String(range.min);this.el(id).max=String(range.max);}
    this.el('name').maxLength=RELIGHT_LIMITS.maxName;this.el('supplement').setAttribute('maxlength',String(RELIGHT_LIMITS.maxSupplement));
    this.click('close',()=>this.dialog.close('user-close'));
    this.click('add',()=>{this.session.editor.add(this.host.uuid());this.changed();});
    this.click('duplicate',()=>{const id=this.session.editor.selectedId;if(id){this.session.editor.duplicate(id,this.host.uuid());this.changed();}});
    this.click('delete',()=>this.removeSelected());
    this.click('undo',()=>{this.finishDrag();this.session.editor.undo();this.changed();});this.click('redo',()=>{this.finishDrag();this.session.editor.redo();this.changed();});
    for(const tab of ['original','illustration','result'] as Tab[])this.click(`tab-${tab}`,()=>{this.tab=tab;this.refresh();});
    this.click('hide-markers',()=>{this.markersVisible=!this.markersVisible;this.refresh();});
    this.click('pan',()=>{this.panMode=!this.panMode;this.refresh();});
    this.click('fit',()=>{this.viewport.zoom=1;this.viewport.panX=0;this.viewport.panY=0;this.measure();this.refresh();});
    this.click('zoom-in',()=>this.zoom(1.25));this.click('zoom-out',()=>this.zoom(.8));
    this.click('advanced-toggle',()=>{this.advanced=!this.advanced;this.refresh();});
    this.click('retry-preview',()=>{this.schedulePreview();});
    this.click('save',async()=>{await this.save();this.message(t('布光草稿已保存'));});
    this.click('load-draft',async()=>{const scene=await this.host.loadDraft();if(!scene)throw new Error(t('尚无保存的布光草稿'));try{this.session.restore(scene);this.selectedResult=undefined;this.changed();}catch(error){this.pendingDraft=scene;this.refresh();throw error;}});
    this.click('reuse-draft',()=>{if(this.pendingDraft){this.session.restore(this.pendingDraft,true);this.pendingDraft=undefined;this.selectedResult=undefined;this.changed();this.message(t('已明确将保存的布光复用到当前快照，请检查位置后生成'));}});
    this.click('reread',()=>this.closeForNative(async()=>{await this.host.reread();this.sourceInvalid=false;this.selectedResult=undefined;this.pendingDraft=undefined;this.message(t('原图已重新读取，布光已绑定新快照；请检查位置后生成'));await this.save();}));
    this.click('generate',()=>this.generate());
    this.click('cancel',async()=>{if(this.request)this.request.cancelled=true;await this.host.cancel();this.message(t('已请求取消或停止后续候选；平台当前任务可能继续并计费，结果保留在历史中'));this.refresh();});
    this.click('apply',()=>{this.assertHostIdle();const r=this.result();if(!r)throw new Error(t('请先选择实际 AI 结果'));if(this.el('output').value!=='full')throw new Error(t('补偿应用尚未通过验收，请使用完整结果层'));this.closeForNative(async()=>{await this.host.apply(r.jobId);this.message(t('完整结果已应用；可编辑蒙版并一次撤销'));});});
    this.click('export',async()=>{const r=this.result();if(!r)throw new Error(t('请先选择实际 AI 结果'));await this.host.export(r.jobId);});
    this.click('compensation',async()=>{const r=this.result();if(!r)throw new Error(t('请先选择实际 AI 结果'));this.el('compensation-info').textContent=await this.host.diagnostics(r.jobId);});
    this.listen(this.el('acknowledge'),'change',()=>{this.acknowledged=!!this.el('acknowledge').checked;});
    this.listen(this.el('lights'),'click',e=>{const node=e.target?.closest?.('[data-light-id]');if(!node)return;const id=node.getAttribute('data-light-id');this.session.editor.select(id);if(node.getAttribute('data-find')==='true')this.findLight(id);this.refresh();});
    this.listen(this.el('result-list'),'click',e=>{const node=e.target?.closest?.('[data-job-id]');if(!node)return;this.selectedResult=node.getAttribute('data-job-id');this.tab='result';this.refresh();});
    for(const id of ['name','type','role','enabled','locked','x','y','z','intensity','range','softness','cone','targetX','targetY','direction','elevation','color-mode','temperature','color','ambient-intensity','ambient-color','existing','shadow-strength','shadow-softness','content','supplement']){
      const node=this.el(id);this.listen(node,'change',()=>void this.guard(()=>this.commitControl(id)));
      if(['intensity','range','softness','ambient-intensity','shadow-strength','shadow-softness'].includes(id))this.listen(node,'input',()=>void this.guard(()=>this.commitControl(id)));
    }
    this.listen(this.el('markers'),'pointerdown',e=>this.startDrag(e));
    this.listen(this.el('viewport'),'pointerdown',e=>{if(this.panMode&&!e.target?.closest?.('[data-light-id]'))this.startPan(e);});
    const doc=this.dialog.ownerDocument;
    this.listen(doc,'pointermove',e=>this.moveDrag(e));this.listen(doc,'pointerup',e=>this.finishDrag(e));this.listen(doc,'pointercancel',()=>this.finishDrag(undefined,true));
    this.listen(doc,'keydown',e=>this.key(e));
    const win=doc.defaultView;if(win?.addEventListener)this.listen(win,'resize',()=>{if(this.visible)this.measure();});
    this.listen(this.dialog,'resize',()=>this.measure());
    this.listen(this.dialog,'cancel',()=>{this.afterClose=undefined;});
    this.message(this.lastStatus||t('编辑布光不会发起 AI 请求；主动点击生成'),this.parameterStatus);this.refresh();
    try{this.preview=prepareRelightPreview(this.session.sourceCapture.image,this.session.sourceCapture.snapshot.mask);this.originalUrl=dataUrl(this.preview.image);this.schedulePreview();this.renderImage();}
    catch(error){this.message(t('布光示意失败，请重试示意或重新读取原图：{0}',error instanceof Error?error.message:String(error)));this.tab='original';}
  }
  private cleanup():void {
    this.finishDrag();for(const remove of this.listeners.splice(0))remove();
    this.previewToken++;if(this.previewTimer)clearTimeout(this.previewTimer);this.previewTimer=undefined;
    if(this.resizeTimer)clearTimeout(this.resizeTimer);this.resizeTimer=undefined;
    if(this.saveTimer)clearTimeout(this.saveTimer);this.saveTimer=undefined;
    this.preview=undefined;this.originalUrl='';this.illustrationUrl='';this.resultUrl='';this.resultUrlId='';
    this.displayedImageUrl='';this.displayedImageGeometry='';
    this.el('image').removeAttribute('src');this.el('markers').innerHTML='';this.markerNodes.clear();
  }
  private schedulePreview():void {
    const token=++this.previewToken;
    if(this.previewTimer)clearTimeout(this.previewTimer);
    if(!this.visible||!this.preview||this.previewRunning)return;
    this.previewTimer=setTimeout(()=>{this.previewTimer=undefined;const cache=this.preview;if(!cache||token!==this.previewToken)return;this.previewRunning=true;this.lastRender=Date.now();const scene=this.session.editor.snapshot();
      void renderRelightPreview(cache.image,scene,cache.mask,{cancelled:()=>!this.visible||token!==this.previewToken}).then(image=>{
        if(!this.visible||token!==this.previewToken)return;this.illustrationUrl=dataUrl(image);this.renderImage();
      }).catch(error=>{if(error?.name!=='AbortError'&&this.visible&&token===this.previewToken)this.message(t('布光示意失败，请重试示意或重新读取原图：{0}',error instanceof Error?error.message:String(error)));}).finally(()=>{this.previewRunning=false;if(this.visible&&token!==this.previewToken)this.schedulePreview();});
    },Math.max(0,84-(Date.now()-this.lastRender)));
  }
  private refresh():void {
    if(!this.visible)return;
    const scene=this.session.editor.snapshot(),light=scene.lights.find(l=>l.id===this.session.editor.selectedId),doc=this.dialog.ownerDocument;
    this.reconcileInvalid(light);
    if(this.parameterStatus&&!this.invalid.size)this.message(t('编辑布光不会发起 AI 请求；主动点击生成'));
    const defaults=createRelightScene(scene.source,'color-default');
    this.el('source').textContent=t('可见合成 · 文档 {0} · {1}×{2} · {3} · {4} 位',scene.source.documentId,scene.source.bounds.right-scene.source.bounds.left,scene.source.bounds.bottom-scene.source.bounds.top,scene.source.profile,scene.source.documentDepth);
    this.el('lights').innerHTML='';scene.lights.forEach((l,i)=>{const row=doc.createElement('div');row.className='relight-light-row'+(l.id===light?.id?' selected':'');const select=doc.createElement('button');select.className='relight-light-name';select.setAttribute('data-light-id',l.id);const swatch=doc.createElement('span');swatch.className='relight-swatch';swatch.style.backgroundColor=l.color.mode==='custom'?l.color.hex:l.color.kelvin<5000?'#F6C78A':l.color.kelvin>6500?'#A5C7FF':'#FFFFFF';select.appendChild(swatch);const text=doc.createElement('span');text.textContent=`${i+1}. ${l.name}${l.enabled?'':t('（已禁用）')}`;select.appendChild(text);row.appendChild(select);const find=doc.createElement('button');find.className='relight-find';find.textContent=t('找回');find.setAttribute('data-light-id',l.id);find.setAttribute('data-find','true');row.appendChild(find);this.el('lights').appendChild(row);});
    this.el('selected').style.display=light?'block':'none';
    const set=(id:string,value:unknown)=>{if(doc.activeElement!==this.el(id)&&!this.invalid.has(id))this.el(id).value=String(value);};
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
    this.el('hide-markers').textContent=t(this.markersVisible?'隐藏标记':'显示标记');this.el('pan').className=this.panMode?'active':'';this.el('viewport').className=this.panMode?'pan':'';
    this.el('zoom-label').textContent=`${Math.round(this.viewport.zoom*100)}%`;
    for(const tab of ['original','illustration','result'])this.el(`tab-${tab}`).className=this.tab===tab?'active':'';
    const sharedBusy=!!this.host.busy?.();
    this.el('generate').disabled=this.pending||this.nativeBusy||this.sourceInvalid||sharedBusy;this.el('cancel').disabled=!this.pending;
    const result=this.result();this.el('apply').disabled=this.pending||this.nativeBusy||this.sourceInvalid||sharedBusy||!result||!!result.warning;this.el('export').disabled=!result;this.el('compensation').disabled=!result;this.el('reread').disabled=this.pending||this.nativeBusy||sharedBusy;
    this.el('stale').textContent=result&&result.fingerprint!==this.session.fingerprint?t('布光已修改，当前结果尚未更新；应用仍使用该结果提交时的配置'):'';
    this.el('warnings').textContent=[...this.warnings.map(warningText),...(result?.warning?[errorText(result.warning)]:[])].join('\n');this.el('acknowledge').style.display=this.warnings.some(w=>/Resolve this conflict/.test(w))?'block':'none';this.el('acknowledge').checked=this.acknowledged;
    this.el('reuse-draft').style.display=this.pendingDraft?'block':'none';
    this.el('result-list').innerHTML='';this.host.results().forEach((r,i)=>{const button=doc.createElement('button');button.textContent=t('AI 结果 {0} · {1}',i+1,r.jobId.slice(0,8));button.setAttribute('data-job-id',r.jobId);button.className=r.jobId===this.selectedResult?'active':'';this.el('result-list').appendChild(button);});
    this.renderImage();this.renderMarkers();
  }
  private renderImage():void {
    if(!this.visible)return;
    const result=this.result();let url=this.tab==='original'?this.originalUrl:this.tab==='illustration'?this.illustrationUrl:'';
    if(this.tab==='result'&&result){if(this.resultUrlId!==result.jobId){this.resultUrl=dataUrl(prepareRelightPreview(result.image,new Uint8Array(result.image.width*result.image.height)).image);this.resultUrlId=result.jobId;}url=this.resultUrl;}
    const img=this.el('image');
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
      node.textContent=text;node.setAttribute('aria-label',label);node.className='relight-marker '+classes;const size=kind==='target'?24:28;
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
  private removeSelected():void {this.finishDrag();const id=this.session.editor.selectedId;if(id){this.session.editor.remove(id);this.changed();}}
  private numeric(id:string):number {const text=String(this.el(id).value??'').trim(),n=Number(text);if(!text||!Number.isFinite(n))throw new Error(t('参数无效，请输入范围内的有限数值'));return n;}
  private commitControl(id:string):void {
    try {
      const editor=this.session.editor,selected=editor.selectedId,light=editor.snapshot().lights.find(l=>l.id===selected),value=this.el(id).value;
      if(id==='ambient-intensity')editor.updateScene({ambient:{intensity:this.numeric(id)}});
      else if(id==='ambient-color')editor.updateScene({ambient:{color:String(value)}});
      else if(id==='existing')editor.updateScene({existingLighting:value});else if(id==='content')editor.updateScene({preserveContent:value});
      else if(id==='supplement')editor.updateScene({supplement:String(value??'')});
      else if(id==='shadow-strength'||id==='shadow-softness')editor.updateScene({shadow:{[id==='shadow-strength'?'strength':'softness']:this.numeric(id)}});
      else if(selected&&light){
        if(id==='enabled'||id==='locked')editor.updateLight(selected,{[id==='enabled'?'enabled':'positionLocked']:!!this.el(id).checked});
        else if(['name','type','role'].includes(id))editor.updateLight(selected,{[id]:value});
        else if(id==='color-mode'){const defaults=createRelightScene(editor.snapshot().source,'color-default');editor.updateLight(selected,{color:value==='temperature'?defaults.lights[0].color:{mode:'custom',hex:defaults.ambient.color}});}
        else if(id==='color')editor.updateLight(selected,{color:{mode:'custom',hex:String(value)}});
        else if(id==='temperature')editor.updateLight(selected,{color:{mode:'temperature',kelvin:this.numeric(id)}});
        else editor.updateLight(selected,{[id]:this.numeric(id)});
      }
      this.invalid.delete(id);this.el(id).removeAttribute('aria-invalid');this.changed();
    }catch(error){this.invalid.add(id);this.el(id).setAttribute('aria-invalid','true');throw new ParameterValidationError(t('参数未保存，请修正后重试：{0}',error instanceof Error?error.message:String(error)));}
  }
  private startDrag(e:any):void {
    const node=e.target?.closest?.('[data-light-id]');if(!node||e.button>0)return;
    e.preventDefault();const id=node.getAttribute('data-light-id');this.session.editor.select(id);
    if(this.panMode){this.startPan(e);return;}
    const light=this.session.editor.snapshot().lights.find(l=>l.id===id)!;if(light.positionLocked&&light.type!=='directional'&&node.getAttribute('data-kind')!=='target'){this.message(t('光源位置已锁定，请先解锁'));this.refresh();return;}
    this.session.editor.beginGesture();this.drag={kind:node.getAttribute('data-kind')==='target'?'target':'light',id,startX:e.clientX,startY:e.clientY,panX:this.viewport.panX,panY:this.viewport.panY,pointerId:e.pointerId,node};
    if(typeof node.setPointerCapture==='function'&&Number.isFinite(e.pointerId))node.setPointerCapture(e.pointerId);this.refresh();
  }
  private startPan(e:any):void {if(e.button>0)return;e.preventDefault();this.drag={kind:'pan',startX:e.clientX,startY:e.clientY,panX:this.viewport.panX,panY:this.viewport.panY};}
  private moveDrag(e:any):void {
    const d=this.drag;if(!d||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return;
    if(d.pointerId!==undefined&&e.pointerId!==undefined&&d.pointerId!==e.pointerId)return;
    e.preventDefault();
    if(d.kind==='pan'){this.viewport.panX=d.panX+e.clientX-d.startX;this.viewport.panY=d.panY+e.clientY-d.startY;this.renderImage();this.renderMarkers();return;}
    const point=viewportToNormalized({x:e.clientX,y:e.clientY},this.geometry(),this.viewport),light=this.session.editor.snapshot().lights.find(l=>l.id===d.id)!;
    try{if(d.kind==='target')this.session.editor.updateLight(d.id!,{targetX:clamp(point.x,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max),targetY:clamp(point.y,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max)});
      else if(light.type==='directional')this.session.editor.updateLight(d.id!,{direction:Math.atan2(point.y-.5,point.x-.5)*180/Math.PI});
      else this.session.editor.updateLight(d.id!,{x:clamp(point.x,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max),y:clamp(point.y,RELIGHT_LIMITS.position.min,RELIGHT_LIMITS.position.max)});
      this.refresh();this.schedulePreview();
    }catch(error){this.message(error instanceof Error?error.message:String(error));this.finishDrag(undefined,true);}
  }
  private finishDrag(e?:any,cancel=false):void {
    const d=this.drag;if(!d)return;if(e&&d.pointerId!==undefined&&e.pointerId!==undefined&&d.pointerId!==e.pointerId)return;this.drag=undefined;
    try{if(d.node&&d.pointerId!==undefined&&typeof d.node.releasePointerCapture==='function')d.node.releasePointerCapture(d.pointerId);}catch{}
    if(d.kind!=='pan'){if(cancel)this.session.editor.cancelGesture();else this.session.editor.endGesture();if(this.visible)this.changed();}
  }
  private key(e:any):void {
    if(!this.visible||relightTextFocus(e.target)||relightTextFocus(this.dialog.ownerDocument.activeElement))return;
    if(!this.dialog.contains(e.target)&&!this.dialog.contains(this.dialog.ownerDocument.activeElement))return;
    const marker=e.target?.closest?.('[data-light-id]');
    if((e.key==='Enter'||e.key===' ')&&marker&&this.el('markers').contains(marker)){e.preventDefault();this.session.editor.select(marker.getAttribute('data-light-id'));this.refresh();}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();this.removeSelected();}
    else if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='z'){e.preventDefault();this.finishDrag();if(e.shiftKey)this.session.editor.redo();else this.session.editor.undo();this.changed();}
    else if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='y'){e.preventDefault();this.finishDrag();this.session.editor.redo();this.changed();}
    else if(e.key==='Escape'&&this.drag){e.preventDefault();this.finishDrag(undefined,true);}
  }
  get conflictAcknowledged():boolean{return this.acknowledged;}
}
