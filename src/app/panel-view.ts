import {convertDepth,encodePng,resize,type Raster} from '../imaging/image';
import {t,english} from '../localization/i18n';

export type PanelPage='create'|'results'|'history'|'settings';

interface SourceCaptionDetails {documentId:number;width:number;height:number;profile:string;protectedArea:boolean;colorReason?:string}
/** Only presentation metadata is retained; no document, raster or persisted state. */
export class SourceCaption {
  private current:string|SourceCaptionDetails='先圈选编辑范围。保护区可保留人物与重要细节。';
  constructor(private node:HTMLElement){}
  show(value:string|SourceCaptionDetails):void {this.current=value;this.render();}
  render():void {
    const info=this.current;
    if(typeof info==='string'){this.node.textContent=t(info);return;}
    const color=info.colorReason?t(info.colorReason==='webp-default'?' · WebP 默认 sRGB · 已创建工作副本':' · PNG sRGB 标记 · 已创建工作副本'):` · ${info.profile}`;
    this.node.textContent=t('文档 {0} · 区域 {1}×{2} · {3}{4}',info.documentId,info.width,info.height,t(info.protectedArea?'已扣除保护区':'未指定保护区'),color);
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

/** All business controls remain mounted. Navigation only changes visibility. */
export class PanelViews {
  constructor(private root:Document){
    for(const node of Array.from(root.querySelectorAll<HTMLElement>('[data-panel-nav]'))){
      node.addEventListener('click',()=>this.show(node.getAttribute('data-panel-nav') as PanelPage));
    }
    this.show('create');
  }
  show(page:PanelPage):void {
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
  }
}

/** Four bounded fit copies; a full-size preview belongs only to the current image element. */
export class CandidatePreview {
  private request=0;
  private fit=new Map<Raster,Promise<string>>();
  constructor(private render:(image:Raster,size:number)=>Promise<string>=displayPreview){}
  retain(images:Raster[]):void {this.request++;for(const image of this.fit.keys())if(!images.includes(image))this.fit.delete(image);}
  async show(image:Raster,actualSize:boolean,apply:(url:string)=>void):Promise<void> {
    const request=++this.request;
    let pending=actualSize?undefined:this.fit.get(image);
    if(!pending)pending=this.render(image,actualSize?Math.max(image.width,image.height):1280);
    if(!actualSize){
      this.fit.delete(image);this.fit.set(image,pending);
      if(this.fit.size>4)this.fit.delete(this.fit.keys().next().value!);
    }
    try{const url=await pending;if(request===this.request)apply(url);}
    catch(error){if(this.fit.get(image)===pending)this.fit.delete(image);if(request===this.request)throw error;}
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
