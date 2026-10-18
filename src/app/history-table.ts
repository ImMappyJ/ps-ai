import {blocksGeneration,type JobRecord} from '../generation/jobs';
import {t} from '../localization/i18n';

const PAGE_SIZE=20;
const STATE_LABELS:Record<string,string>={created:'待提交',submitting:'提交中',queued:'已排队',running:'生成中',unknown:'状态未知',cancelling:'取消确认中',downloading:'下载中',ready:'候选就绪',failed:'生成失败',cancelled:'已取消','output-error':'输出异常'};
const MODES:Record<string,string>={edit:'局部物体 / 材质修改',remove:'移除杂物',background:'换背景（选择主体）',effect:'特效素材',costume:'服装 / 道具修复',reference:'角色参考辅助',scene:'场景替换',atmosphere:'氛围素材',relight:'光影重塑',blend:'溶图',generate:'文字生图'};
interface HistoryTableHost {busy():boolean;changed():void;refresh():void}
export function historyTaskType(record:JobRecord):string {
  const params=record.params as {mode?:string;workspace?:string}|undefined;
  return t(MODES[params?.mode??'']??(params?.workspace==='t2i'?'文字生图':'未保存任务类型'));
}
export function historyPrompt(record:JobRecord):string {
  const mode=(record.params as {mode?:string}|undefined)?.mode;
  if(mode==='remove')return t('内置移除指令');
  if(mode==='relight'&&record.relight&&record.userPrompt==='')return t('无补充描述（已保存布光）');
  return typeof record.userPrompt==='string'?(record.userPrompt||t('空提示词')):t('未保存提示词');
}
export function historyState(record:JobRecord):string {return t(STATE_LABELS[record.state]??'未知状态')+(STATE_LABELS[record.state]?'':` (${record.state})`);}
export function historySource(record:JobRecord):string {
  const snapshot=record.snapshot as {documentId?:number}|undefined,params=record.params as {workspace?:string;outputKind?:string}|undefined;
  return record.sourceName??(snapshot?.documentId!==undefined?t('文档 {0}',snapshot.documentId):params?.workspace==='t2i'||params?.outputKind==='t2i'?t('文字生图'):t('未保存来源'));
}
export function historyDate(record:JobRecord):string[] {
  const date=new Date(record.createdAt),pad=(n:number)=>String(n).padStart(2,'0');
  return Number.isNaN(date.getTime())?[t('未保存时间')]:[`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`,`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`];
}

/** Focus controls details; checked UUIDs alone authorize the separate bulk action. */
export class HistoryTable {
  private records:readonly JobRecord[]=[];
  private selected?:string;
  private checked=new Set<string>();
  private filter:'all'|'unresolved'='all';
  private page=0;
  private revealId?:string;
  private revision=0;
  constructor(private root:HTMLElement,private host:HistoryTableHost){
    root.innerHTML='<div class="history-filters"><button id="history-all" type="button"></button><button id="history-unresolved" type="button"></button><button id="history-refresh" type="button"></button></div><div class="history-check-tools"><button id="history-check-all" type="button"></button><button id="history-check-none" type="button"></button><span id="history-selected-count" class="hint" role="status"></span></div><div id="history-table" role="table"><div class="history-row history-header" role="row"><span class="history-check-cell" role="columnheader"></span><span class="history-date" role="columnheader"></span><span class="history-type" role="columnheader"></span><span class="history-prompt" role="columnheader"></span></div><div id="history-rows" role="rowgroup"></div></div><p id="history-empty" class="hint" role="status"></p><div class="history-pagination"><button id="history-prev" type="button"></button><span id="history-page" class="hint" role="status"></span><button id="history-next" type="button"></button></div>';
    for(const filter of ['all','unresolved'] as const)this.el(`history-${filter}`).addEventListener('click',()=>{
      if(host.busy())return;this.filter=filter;this.page=0;this.checked.clear();this.selectVisible();this.displayChanged();
    });
    for(const [id,step] of [['history-prev',-1],['history-next',1]] as const)this.el(id).addEventListener('click',()=>{
      if(host.busy())return;const next=this.page+step;if(next<0||next>=this.pages())return;this.page=next;this.selectVisible();this.displayChanged();
    });
    this.el('history-refresh').addEventListener('click',()=>{if(!host.busy()){this.displayChanged();host.refresh();}});
    this.el('history-check-all').addEventListener('click',()=>{if(!host.busy()){this.checked=new Set(this.filtered().map(r=>r.id));this.displayChanged();}});
    this.el('history-check-none').addEventListener('click',()=>{if(!host.busy()){this.checked.clear();this.displayChanged();}});
    this.el('history-rows').addEventListener('change',event=>{
      const checkbox=(event.target as HTMLElement)?.closest?.('[data-history-check]') as (HTMLElement&{checked:boolean})|null;
      if(!checkbox||host.busy())return;const id=checkbox.getAttribute('data-history-check')!;
      if(!this.visible().some(r=>r.id===id))return;
      if(checkbox.checked)this.checked.add(id);else this.checked.delete(id);this.displayChanged();
    });
    this.el('history-rows').addEventListener('click',event=>{
      const target=event.target as HTMLElement;if(host.busy()||target?.closest?.('[data-history-check]'))return;
      const row=target?.closest?.('[data-history-id]');if(!row||!this.el('history-rows').contains(row))return;
      const id=row.getAttribute('data-history-id')!;if(!this.visible().some(record=>record.id===id))return;
      this.selected=id;this.displayChanged();
    });
    this.refresh();
  }
  get selectedId():string|undefined{return this.selected;}
  get checkedIds():readonly string[]{return [...this.checked];}
  get selectionRevision():number{return this.revision;}
  clearChecked():void {this.checked.clear();this.revision++;this.refresh();}
  private el(id:string):HTMLElement{return this.root.querySelector(`#${id}`)!;}
  private filtered():readonly JobRecord[]{return this.filter==='all'?this.records:this.records.filter(blocksGeneration);}
  private pages():number{return Math.max(1,Math.ceil(this.filtered().length/PAGE_SIZE));}
  private visible():readonly JobRecord[]{return this.filtered().slice(this.page*PAGE_SIZE,(this.page+1)*PAGE_SIZE);}
  private selectVisible():void {if(!this.visible().some(record=>record.id===this.selected))this.selected=this.visible()[0]?.id;}
  private displayChanged():void {this.revision++;this.refresh();this.host.changed();}
  setRecords(records:readonly JobRecord[],options:{selectId?:string;preferPending?:boolean}={}):void {
    this.records=records;this.revision++;
    const present=new Set(records.map(r=>r.id));for(const id of this.checked)if(!present.has(id))this.checked.delete(id);
    const preferred=options.selectId??(options.preferPending?records.find(blocksGeneration)?.id:undefined);
    if(preferred&&this.reveal(preferred))return;
    this.page=Math.min(this.page,this.pages()-1);
    const index=this.filtered().findIndex(record=>record.id===this.selected);
    if(index>=0)this.page=Math.floor(index/PAGE_SIZE);else this.selectVisible();
    this.refresh();
  }
  /** Reveal is programmatic while locked; scrolling waits for visible, unlocked layout. */
  reveal(id:string):boolean {
    if(!this.records.some(record=>record.id===id))return false;
    if(!this.filtered().some(record=>record.id===id)){this.filter='all';this.checked.clear();}
    this.selected=id;this.revealId=id;this.revision++;this.page=Math.floor(this.filtered().findIndex(record=>record.id===id)/PAGE_SIZE);this.refresh();return true;
  }
  scrollRevealed():void {
    if(!this.revealId||this.host.busy())return;
    for(let node:HTMLElement|null=this.root;node;node=node.parentElement)if(node.style.display==='none')return;
    const row=Array.from(this.el('history-rows').children).find(node=>node.getAttribute('data-history-id')===this.revealId) as HTMLElement|undefined;
    if(!row)return;
    try{if(typeof row.scrollIntoView==='function')row.scrollIntoView(false);else this.el('history-rows').scrollTop=Math.max(0,row.offsetTop-this.el('history-rows').offsetTop);}catch{this.el('history-rows').scrollTop=Math.max(0,row.offsetTop-this.el('history-rows').offsetTop);}
    this.revealId=undefined;
  }
  refresh():void {
    const busy=this.host.busy(),pending=this.records.filter(blocksGeneration).length,doc=this.root.ownerDocument;
    for(const [filter,count,label] of [['all',this.records.length,'全部（{0}）'],['unresolved',pending,'未确认（{0}）']] as const){
      const button=this.el(`history-${filter}`) as HTMLButtonElement;button.textContent=t(label,count);button.disabled=busy;button.setAttribute('aria-pressed',String(this.filter===filter));button.classList.toggle('active',this.filter===filter);
    }
    for(const [id,label,disabled] of [['history-refresh','刷新记录',busy],['history-check-all','全选当前筛选（所有页）',busy||!this.filtered().length],['history-check-none','取消全部勾选',busy||!this.checked.size]] as const){const button=this.el(id) as HTMLButtonElement;button.textContent=t(label);button.disabled=disabled;}
    this.el('history-selected-count').textContent=t('已勾选 {0} 条',this.checked.size);
    const table=this.el('history-table');table.setAttribute('aria-label',t('历史记录'));table.setAttribute('aria-busy',String(busy));
    const labels=['选择','保存时间','任务类型','提示词'];Array.from(table.querySelectorAll('[role="columnheader"]')).forEach((node,i)=>node.textContent=t(labels[i]));
    const body=this.el('history-rows');body.innerHTML='';
    for(const record of this.visible()){
      const row=doc.createElement('div'),selected=record.id===this.selected,pending=blocksGeneration(record);
      row.className='history-row'+(selected?' selected':'')+(pending?' pending':'')+(busy?' disabled':'');row.setAttribute('role','row');row.setAttribute('data-history-id',record.id);row.setAttribute('aria-selected',String(selected));
      const cell=(className:string)=>{const node=doc.createElement('div');node.className=className;node.setAttribute('role','cell');row.appendChild(node);return node;};
      const check=doc.createElement('sp-checkbox') as HTMLElement&{checked:boolean;disabled:boolean};check.setAttribute('data-history-check',record.id);check.checked=this.checked.has(record.id);check.disabled=busy;check.setAttribute('aria-label',t('勾选清除任务 {0}',record.id));cell('history-check-cell').appendChild(check);
      const date=cell('history-date');for(const part of historyDate(record)){const line=doc.createElement('span');line.textContent=part;date.appendChild(line);}
      const type=cell('history-type'),typeText=doc.createElement('span');typeText.className='history-type-label';typeText.textContent=historyTaskType(record);type.appendChild(typeText);
      const state=doc.createElement('span');state.className='history-state';state.textContent=historyState(record);type.appendChild(state);
      if(pending||record.tracking==='detached'){const marker=doc.createElement('span');marker.className='history-tracking';marker.textContent=t(pending?'未确认':'已停止跟踪');type.appendChild(marker);}
      if(selected){const marker=doc.createElement('span');marker.className='history-selected';marker.textContent=t('正在查看');type.appendChild(marker);}
      const prompt=cell('history-prompt'),text=doc.createElement('span');text.className='history-prompt-text';text.textContent=historyPrompt(record);prompt.appendChild(text);
      const button=doc.createElement('button');button.type='button';button.className='history-select';button.textContent=t('查看详情');button.setAttribute('aria-label',t('选择任务 {0}',record.id));button.setAttribute('aria-pressed',String(selected));button.disabled=busy;prompt.appendChild(button);body.appendChild(row);
    }
    const empty=this.el('history-empty');empty.style.display=this.filtered().length?'none':'block';empty.textContent=t(this.filter==='unresolved'?'没有未确认任务':'暂无历史记录');
    const previous=this.el('history-prev') as HTMLButtonElement,next=this.el('history-next') as HTMLButtonElement;previous.textContent=t('上一页');next.textContent=t('下一页');previous.disabled=busy||this.page===0;next.disabled=busy||this.page>=this.pages()-1;
    this.el('history-page').textContent=t('第 {0} / {1} 页 · {2} 条',this.page+1,this.pages(),this.filtered().length);
  }
}
