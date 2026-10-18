import {blocksGeneration,type JobRecord} from '../generation/jobs';
import {t} from '../localization/i18n';

const PAGE_SIZE=20;
const STATE_LABELS:Record<string,string>={created:'待提交',submitting:'提交中',queued:'已排队',running:'生成中',unknown:'状态未知',cancelling:'取消确认中',downloading:'下载中',ready:'候选就绪',failed:'生成失败',cancelled:'已取消','output-error':'输出异常'};
interface HistoryTableHost {busy():boolean;changed():void;refresh():void}

/** Local presentation only. Selection is an explicit UUID, never a DOM form value. */
export class HistoryTable {
  private records:readonly JobRecord[]=[];
  private selected?:string;
  private filter:'all'|'unresolved'='all';
  private page=0;
  constructor(private root:HTMLElement,private host:HistoryTableHost){
    root.innerHTML='<div class="history-filters"><button id="history-all" type="button"></button><button id="history-unresolved" type="button"></button><button id="history-refresh" type="button"></button></div><div id="history-table" role="table"><div class="history-row history-header" role="row"><span class="history-state" role="columnheader"></span><span class="history-source" role="columnheader"></span><span class="history-date" role="columnheader"></span><span class="history-task-id" role="columnheader"></span></div><div id="history-rows" role="rowgroup"></div></div><p id="history-empty" class="hint" role="status"></p><div class="history-pagination"><button id="history-prev" type="button"></button><span id="history-page" class="hint" role="status"></span><button id="history-next" type="button"></button></div>';
    for(const filter of ['all','unresolved'] as const)this.el(`history-${filter}`).addEventListener('click',()=>{
      if(host.busy())return;this.filter=filter;this.page=0;this.selectVisible();this.displayChanged();
    });
    for(const [id,step] of [['history-prev',-1],['history-next',1]] as const)this.el(id).addEventListener('click',()=>{
      if(host.busy())return;const next=this.page+step;if(next<0||next>=this.pages())return;this.page=next;this.selectVisible();this.displayChanged();
    });
    this.el('history-refresh').addEventListener('click',()=>{if(!host.busy())host.refresh();});
    this.el('history-rows').addEventListener('click',event=>{
      if(host.busy())return;const row=(event.target as HTMLElement)?.closest?.('[data-history-id]');
      if(!row||!this.el('history-rows').contains(row))return;
      const id=row.getAttribute('data-history-id')!;if(!this.visible().some(record=>record.id===id))return;
      this.selected=id;this.displayChanged();
    });
    this.refresh();
  }
  get selectedId():string|undefined{return this.selected;}
  private el(id:string):HTMLElement{return this.root.querySelector(`#${id}`)!;}
  private filtered():readonly JobRecord[]{return this.filter==='all'?this.records:this.records.filter(blocksGeneration);}
  private pages():number{return Math.max(1,Math.ceil(this.filtered().length/PAGE_SIZE));}
  private visible():readonly JobRecord[]{return this.filtered().slice(this.page*PAGE_SIZE,(this.page+1)*PAGE_SIZE);}
  private selectVisible():void {if(!this.visible().some(record=>record.id===this.selected))this.selected=this.visible()[0]?.id;}
  private displayChanged():void {this.refresh();this.host.changed();}
  setRecords(records:readonly JobRecord[],options:{selectId?:string;preferPending?:boolean}={}):void {
    this.records=records;
    const preferred=options.selectId??(options.preferPending?records.find(blocksGeneration)?.id:undefined);
    if(preferred&&this.reveal(preferred))return;
    this.page=Math.min(this.page,this.pages()-1);
    const index=this.filtered().findIndex(record=>record.id===this.selected);
    if(index>=0)this.page=Math.floor(index/PAGE_SIZE);else this.selectVisible();
    this.refresh();
  }
  /** Business actions may reveal a UUID even while user navigation is locked. */
  reveal(id:string):boolean {
    if(!this.records.some(record=>record.id===id))return false;
    if(!this.filtered().some(record=>record.id===id))this.filter='all';
    this.selected=id;this.page=Math.floor(this.filtered().findIndex(record=>record.id===id)/PAGE_SIZE);this.refresh();return true;
  }
  refresh():void {
    const busy=this.host.busy(),pending=this.records.filter(blocksGeneration).length,doc=this.root.ownerDocument;
    for(const [filter,count,label] of [['all',this.records.length,'全部（{0}）'],['unresolved',pending,'未确认（{0}）']] as const){
      const button=this.el(`history-${filter}`) as HTMLButtonElement;button.textContent=t(label,count);button.disabled=busy;button.setAttribute('aria-pressed',String(this.filter===filter));button.classList.toggle('active',this.filter===filter);
    }
    const refresh=this.el('history-refresh') as HTMLButtonElement;refresh.textContent=t('刷新记录');refresh.disabled=busy;
    const table=this.el('history-table');table.setAttribute('aria-label',t('历史记录'));table.setAttribute('aria-busy',String(busy));
    const labels=['状态','来源','创建时间','任务 ID'];Array.from(table.querySelectorAll('[role="columnheader"]')).forEach((node,i)=>node.textContent=t(labels[i]));
    const body=this.el('history-rows');body.innerHTML='';
    for(const record of this.visible()){
      const row=doc.createElement('div'),selected=record.id===this.selected,pending=blocksGeneration(record);
      row.className='history-row'+(selected?' selected':'')+(pending?' pending':'')+(busy?' disabled':'');row.setAttribute('role','row');row.setAttribute('data-history-id',record.id);row.setAttribute('aria-selected',String(selected));
      const cell=(className:string)=>{const node=doc.createElement('div');node.className=className;node.setAttribute('role','cell');row.appendChild(node);return node;};
      const state=cell('history-state'),stateText=doc.createElement('span');stateText.textContent=t(STATE_LABELS[record.state]??record.state);state.appendChild(stateText);
      if(pending||record.tracking==='detached'){const marker=doc.createElement('span');marker.className='history-tracking';marker.textContent=t(pending?'未确认':'已停止跟踪');state.appendChild(marker);}
      if(selected){const marker=doc.createElement('span');marker.className='history-selected';marker.textContent=t('已选中');state.appendChild(marker);}
      const source=cell('history-source'),snapshot=record.snapshot as {documentId?:number}|undefined,params=record.params as {workspace?:string;outputKind?:string}|undefined;
      source.textContent=record.sourceName??(snapshot?.documentId!==undefined?t('文档 {0}',snapshot.documentId):params?.workspace==='t2i'||params?.outputKind==='t2i'?t('文字生图'):t('未保存来源'));
      const date=cell('history-date'),created=String(record.createdAt),parts=[created.slice(0,10),created.slice(11,16)];for(const part of parts){const line=doc.createElement('span');line.textContent=part;date.appendChild(line);}
      const id=cell('history-task-id'),button=doc.createElement('button');button.type='button';button.className='history-select';button.textContent=record.id.slice(0,8);button.setAttribute('aria-label',t('选择任务 {0}',record.id));button.setAttribute('aria-pressed',String(selected));button.disabled=busy;id.appendChild(button);body.appendChild(row);
    }
    const empty=this.el('history-empty');empty.style.display=this.filtered().length?'none':'block';empty.textContent=t(this.filter==='unresolved'?'没有未确认任务':'暂无历史记录');
    const previous=this.el('history-prev') as HTMLButtonElement,next=this.el('history-next') as HTMLButtonElement;previous.textContent=t('上一页');next.textContent=t('下一页');previous.disabled=busy||this.page===0;next.disabled=busy||this.page>=this.pages()-1;
    this.el('history-page').textContent=t('第 {0} / {1} 页 · {2} 条',this.page+1,this.pages(),this.filtered().length);
  }
}
