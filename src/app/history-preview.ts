import type {JobRecord} from '../generation/jobs';
import {t} from '../localization/i18n';

interface Preview {url:string;warning?:string}
/** A single display copy, one running local decode, and at most one latest queued request. */
export class HistoryPreview {
  private token=0;
  private key='';
  private pending?:{record:JobRecord;key:string;token:number};
  private running=false;
  private result?:Preview;
  private message='请选择历史记录';
  constructor(private image:HTMLImageElement,private caption:HTMLElement,private load:(record:JobRecord)=>Promise<Preview>){}
  invalidate():void {this.token++;this.key='';this.pending=undefined;this.result=undefined;this.image.removeAttribute('src');this.image.style.display='none';this.message='请选择历史记录';this.render();}
  show(record?:JobRecord):void {
    const key=record?JSON.stringify([record.id,record.outputFile,record.template]):'';
    if(this.key===key){this.render();return;}
    this.invalidate();this.key=key;
    if(!record?.outputFile){this.message=record?'此记录尚无本地候选；可按原 ID 恢复':'请选择历史记录';this.render();return;}
    this.message='正在读取本地候选预览…';this.pending={record,key,token:this.token};this.render();void this.drain();
  }
  private render():void {
    this.caption.textContent=this.result?.warning?t(this.result.warning):t(this.message);
    this.image.setAttribute('aria-busy',String(this.message==='正在读取本地候选预览…'));
    if(this.result){if(this.image.getAttribute('src')!==this.result.url)this.image.src=this.result.url;this.image.style.display='block';this.image.alt=t('本地候选预览');}
  }
  private async drain():Promise<void> {
    if(this.running)return;this.running=true;
    try{while(this.pending){
      const request=this.pending;this.pending=undefined;
      try{const result=await this.load(request.record);if(request.token!==this.token||request.key!==this.key)continue;this.result=result;this.message='本地候选预览（只读）';}
      catch{if(request.token!==this.token||request.key!==this.key)continue;this.message='无法预览本地候选：文件缺失、损坏或不安全。仍可恢复任务或尝试读取候选。';}
      this.render();
    }}finally{this.running=false;}
  }
}
