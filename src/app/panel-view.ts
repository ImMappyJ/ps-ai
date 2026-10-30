import {convertDepth,encodePng,resize,type Raster} from '../imaging/image';
import {t,english} from '../localization/i18n';
import type {Stage} from '../diagnostics/diagnostics';

export type PanelPage='create'|'results'|'history'|'settings';
export interface OperationContext {id:string;sequence:number;page:PanelPage;feature:string;stage:Stage;taskId?:string;successfulTaskId?:string;documentId?:number;mode?:string;startedAt:number}
type SourceContext=Pick<OperationContext,'mode'|'documentId'>;
const CAPTURE_CAUSES=['selection-required','empty-range','no-document','source-profile','source-unavailable','source-changed','image-budget'];
const SOURCE_CAPTURE_FEATURES=['capture','restore-selection','protect','generate','open-relight','relight-reuse-history','diagnostic-primary','recover-color','relight-reread','relight-prepare'];
export function isSourceCaptureDiagnostic(operation:OperationContext,diagnostic:any):boolean {return diagnostic.stage==='capture'&&SOURCE_CAPTURE_FEATURES.includes(operation.feature)&&(CAPTURE_CAUSES.includes(diagnostic.code)||diagnostic.code==='unknown'&&!operation.taskId);}
export class OperationFeedback {
  private sequence=0;
  private owners=new Map<string,OperationContext>();
  private errors=new Map<string,{operation:OperationContext;diagnostic:any}>();
  private running=new Set<OperationContext>();
  private key(value:Pick<OperationContext,'page'|'feature'>):string{return `${value.page}:${value.feature}`;}
  begin(value:Omit<OperationContext,'id'|'sequence'|'startedAt'>):OperationContext {const sequence=++this.sequence,operation={...value,id:`operation-${sequence}`,sequence,startedAt:Date.now()};this.owners.set(this.key(operation),operation);this.running.add(operation);return operation;}
  get active():OperationContext|undefined{return [...this.running].pop();}
  finish(operation:OperationContext):void {this.running.delete(operation);}
  fail(operation:OperationContext,value:any):boolean {const key=this.key(operation);if(this.owners.get(key)!==operation)return false;this.errors.set(key,{operation,diagnostic:value});return true;}
  private sameSource(left:SourceContext,right:SourceContext):boolean {return left.mode===right.mode&&left.documentId===right.documentId;}
  private captureCause(value:{operation:OperationContext;diagnostic:any}):boolean{return isSourceCaptureDiagnostic(value.operation,value.diagnostic);}
  succeed(operation:OperationContext):void {if(['generate','recover'].includes(operation.feature)&&(!operation.taskId||operation.successfulTaskId!==operation.taskId))return;const key=this.key(operation),error=this.errors.get(key);if(this.owners.get(key)===operation&&(!error||error.operation.sequence<operation.sequence&&this.sameSource(error.operation,operation)))this.errors.delete(key);}
  /** A verified fresh capture resolves range causes only for the source that was actually read. */
  resolveCapture(operation:OperationContext,source:SourceContext=operation):void {if(this.owners.get(this.key(operation))!==operation)return;for(const [key,value] of this.errors)if(this.captureCause(value)&&value.operation.page===operation.page&&value.operation.sequence<operation.sequence&&this.sameSource(value.operation,source))this.errors.delete(key);}
  forPage(page:PanelPage,source?:SourceContext):{operation:OperationContext;diagnostic:any}|undefined {return [...this.errors.values()].filter(value=>value.operation.page===page&&(!source||!this.captureCause(value)||this.sameSource(value.operation,source))).sort((a,b)=>b.operation.sequence-a.operation.sequence)[0];}
  clearCodes(codes:readonly string[]):void {for(const [key,value] of this.errors)if(codes.includes(value.diagnostic.code))this.errors.delete(key);}
}

/** A completion can navigate once, only while it still owns the latest manual intent. */
export class ResultNavigation {
  private latest=0;
  private pending?:{intent:number;candidateId:string};
  begin():number {this.pending=undefined;return ++this.latest;}
  complete(intent:number,ids:readonly string[],selectedId?:string):void {if(intent===this.latest&&ids.length)this.pending={intent,candidateId:selectedId&&ids.includes(selectedId)?selectedId:ids[0]};}
  take(available:readonly string[],ready:boolean,enabled=true):string|undefined {const pending=this.pending;if(!pending)return;if(!enabled||pending.intent!==this.latest||!available.includes(pending.candidateId)){this.pending=undefined;return;}if(!ready)return;this.pending=undefined;return pending.candidateId;}
}

export interface CaptureSizeDetails {documentWidth:number;documentHeight:number;nativeWidth:number;nativeHeight:number;workWidth:number;workHeight:number;modelWidth?:number;modelHeight?:number;outputWidth?:number;outputHeight?:number}
export function captureSizeSummary(size:CaptureSizeDetails):string {
  const lines=[t('原文档 {0}×{1} · 原坐标回填 {2}×{3} · 工作图 {4}×{5}',size.documentWidth,size.documentHeight,size.nativeWidth,size.nativeHeight,size.workWidth,size.workHeight)];
  if(size.modelWidth&&size.modelHeight)lines.push(t('送模 {0}×{1}',size.modelWidth,size.modelHeight));
  if(size.outputWidth&&size.outputHeight)lines.push(t('PNG／新文档 {0}×{1}',size.outputWidth,size.outputHeight));
  lines.push(t('模型细节受工作与送模尺寸限制；原尺寸结果请回填后从 Photoshop 保存／导出。'));
  return lines.join(' · ');
}
interface SourceCaptionDetails {documentId:number;width:number;height:number;profile:string;protectedArea:boolean;colorReason?:string;sizes?:CaptureSizeDetails}
/** Only presentation metadata is retained; no document, raster or persisted state. */
export class SourceCaption {
  private current:string|SourceCaptionDetails='先圈选编辑范围。保护区可保留人物与重要细节。';
  constructor(private node:HTMLElement,private warning?:HTMLElement){}
  show(value:string|SourceCaptionDetails):void {this.current=value;this.render();}
  render():void {
    const info=this.current;
    const assumed=typeof info!=='string'&&info.colorReason==='assumed-srgb';
    if(this.warning){this.warning.style.display=assumed?'block':'none';this.warning.textContent=assumed?t('无法确认原色彩空间，已在独立 sRGB 副本中继续；颜色可能有偏差，原文档未修改。'):'';}
    if(typeof info==='string'){this.node.textContent=t(info);return;}
    const color=info.colorReason?t(assumed?' · 假定 sRGB · 独立工作副本':info.colorReason==='webp-default'?' · WebP 默认 sRGB · 已创建工作副本':' · PNG sRGB 标记 · 已创建工作副本'):` · ${info.profile}`;
    this.node.textContent=t('文档 {0} · 区域 {1}×{2} · {3}{4}',info.documentId,info.width,info.height,t(info.protectedArea?'已扣除保护区':'未指定保护区'),color);
    if(info.sizes)this.node.textContent+='\n'+captureSizeSummary(info.sizes);
  }
}

// Recognize fixed local instructions only. Provider/host text is never copied into this summary.
const LOCAL_VALIDATION_MESSAGES=[
  '请描述希望生成或修改的内容','角色参考辅助需要选择一张参考图','参考图用于编辑路径；生成独立素材或文字生图前请清除参考图',
  '候选数量须为 1–4','后端配置已改变，请先保存并检查连接','设置尚未加载或配置损坏，请保存或导入有效配置',
  '请先打开 Photoshop 文档并建立选区','编辑补丁需要捕获来源选区','此平台模型不支持当前模式','平台种子超出范围，请减小种子或候选数量',
  '提示词、种子、步数或分辨率无效','分辨率须为 32 的倍数，范围 32–2048','存在尚未确认的任务，请先恢复或取消本任务',
  '请先生成或读取一个候选','没有可恢复的任务','请选择历史记录','此记录尚未保存候选，请恢复任务','请先应用一个候选',
  '请先保存有效配置','请在面板保存此平台的 API Key，再连接','配置已改变，请重新检查环境后运行示例',
  '请输入 HTTP(S) 服务根地址，例如 http://localhost:8188；不要包含路径、密码或查询参数','IPv6 地址无效','主机地址无效','端口须为 1–65535',
  '平台配置需要对应的本机适配地址','模型映射无效','设置无效','不支持的设置版本，请重新保存配置','不支持的界面语言',
  '输出位深须为 8 或 16','不支持的后端类型','平台后端仅支持 8 位输出；16 位请切回 ComfyUI','平台模型 ID 无效','平台配置无效',
  'API Key 无效，请重新输入'
];
const MODEL_VALIDATION='模型 {0} 需要后端搜索目录中的相对 {1} 文件名';
export function localValidationMessage(message:string):string|undefined {
  const key=LOCAL_VALIDATION_MESSAGES.find(key=>message===key||message===english[key]);
  if(key)return t(key);
  // Only the three pairs emitted by validateModels are allowed; input filenames are never used.
  for(const [field,extension] of [['unet','.gguf'],['clip','.safetensors'],['vae','.safetensors']] as const){
    const source=MODEL_VALIDATION.replace('{0}',field).replace('{1}',extension);
    const translated=english[MODEL_VALIDATION].replace('{0}',field).replace('{1}',extension);
    if(message===source||message===translated)return t(MODEL_VALIDATION,field,extension);
  }
  return undefined;
}

/** Native BUTTON children stay text-only; image and button activate the same display selection. */
export function createCandidateCard(doc:Document,index:number,url:string,onSelect:()=>void,isBusy:()=>boolean):HTMLDivElement {
  const card=doc.createElement('div'),image=doc.createElement('img'),button=doc.createElement('button'),status=doc.createElement('span');
  card.className='candidate-thumb';card.setAttribute('data-candidate-index',String(index));
  image.src=url;image.alt='';button.className='candidate-choice';status.className='candidate-status';
  const activate=()=>{if(!isBusy())onSelect();};
  image.addEventListener('click',activate);button.addEventListener('click',activate);
  card.appendChild(image);card.appendChild(button);card.appendChild(status);setCandidateCardState(card,false,isBusy());return card;
}

export function setCandidateCardState(card:HTMLElement,selected:boolean,busy:boolean):void {
  const button=card.querySelector('button')!,status=card.querySelector('.candidate-status')!;
  card.classList.toggle('selected',selected);card.classList.toggle('disabled',busy);
  button.setAttribute('aria-pressed',String(selected));button.disabled=busy;
  const number=Number(card.getAttribute('data-candidate-index'))+1;
  button.textContent=String(number);button.setAttribute('aria-label',t('候选 {0}',number));
  status.textContent=selected?t(' · 已选中'):'';
}

/** All controls remain mounted; actual view changes also expire page-bound actions. */
export class PanelViews {
  private page:PanelPage='create';
  constructor(private root:Document,private changed:(page:PanelPage)=>void=()=>{}){
    for(const node of Array.from(root.querySelectorAll<HTMLElement>('[data-panel-nav]'))){
      node.addEventListener('click',()=>this.show(node.getAttribute('data-panel-nav') as PanelPage));
    }
    this.show('create');
  }
  get current():PanelPage{return this.page;}
  show(page:PanelPage):void {
    const previous=this.page;this.page=page;
    for(const node of Array.from(this.root.querySelectorAll<HTMLElement>('[data-panel-page]'))){
      const active=node.getAttribute('data-panel-page')===page;
      node.style.display=active?'block':'none';node.setAttribute('aria-hidden',String(!active));
    }
    for(const node of Array.from(this.root.querySelectorAll<HTMLElement>('[data-panel-nav]'))){
      const active=node.getAttribute('data-panel-nav')===page;
      node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));
    }
    for(const node of Array.from(this.root.querySelectorAll<HTMLElement>('[data-panel-action]'))){
      node.style.display=node.getAttribute('data-panel-action')===page?'flex':'none';
    }
    if(page!==previous)this.changed(page);
  }
}

/** Four bounded fit copies; a full-size preview belongs only to the current image element. */
export class CandidatePreview {
  private request=0;
  private fit=new Map<Raster,Promise<string>>();
  private sizes=new Map<Raster,number>();
  get retainedBytes():number {return [...this.sizes.values()].reduce((sum,bytes)=>sum+bytes,0);}
  constructor(private render:(image:Raster,size:number)=>Promise<string>=displayPreview){}
  retain(images:Raster[]):void {this.request++;for(const image of this.fit.keys())if(!images.includes(image)){this.fit.delete(image);this.sizes.delete(image);}}
  async show(image:Raster,actualSize:boolean,apply:(url:string)=>void):Promise<void> {
    const request=++this.request;
    let pending=actualSize?undefined:this.fit.get(image);
    if(!pending)pending=this.render(image,actualSize?Math.max(image.width,image.height):1280);
    if(!actualSize){
      this.fit.delete(image);this.fit.set(image,pending);
      if(this.fit.size>4){const first=this.fit.keys().next().value!;this.fit.delete(first);this.sizes.delete(first);}
    }
    try{const url=await pending;if(this.fit.get(image)===pending)this.sizes.set(image,url.length*2);if(request===this.request)apply(url);}
    catch(error){if(this.fit.get(image)===pending){this.fit.delete(image);this.sizes.delete(image);}if(request===this.request)throw error;}
  }
}

/** Checkerboard is applied to an independent sRGB8 display copy only. */
export async function displayPreview(image:Raster,size=240):Promise<string> {
  const scale=Math.min(1,size/Math.max(image.width,image.height));
  const thumb=convertDepth(resize(image,Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale))),8);
  for(let y=0;y<thumb.height;y++)for(let x=0;x<thumb.width;x++){
    const i=(y*thumb.width+x)*4,a=thumb.rgba[i+3]/255,bg=((Math.floor(x/12)+Math.floor(y/12))%2)?105:160;
    for(let c=0;c<3;c++)thumb.rgba[i+c]=Math.round(thumb.rgba[i+c]*a+bg*(1-a));thumb.rgba[i+3]=255;
  }
  const bytes=encodePng(thumb),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let encoded='';
  for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]??0)<<8)|(bytes[i+2]??0);encoded+=alphabet[n>>>18]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');}
  return 'data:image/png;base64,'+encoded;
}
