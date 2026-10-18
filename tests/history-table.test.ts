import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {encodePng} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';

const id=(n:number)=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const record=(n:number,state='ready',extra:Partial<JobRecord>={}):JobRecord=>({id:id(n),clientId:id(999),state,graph:{},createdAt:'2026-10-18T09:35:12.000Z',baseUrl:'http://localhost:8188',template:'qwen21-local-v2-rgba',params:{workspace:'t2i',mode:'generate',outputKind:'t2i',steps:25,resolution:32,seed:n,destination:'document',margin:.15},...extra});
type Harness=Awaited<ReturnType<typeof panelHarness>>;
const rows=(h:Harness)=>Array.from(h.el('history-rows')?.querySelectorAll('[data-history-id]')??[]) as HTMLElement[];
const selected=(h:Harness)=>h.el('history-rows')?.querySelector('[aria-selected="true"]')?.getAttribute('data-history-id');
const clickRow=(h:Harness,uuid:string,cell=false)=>{const row=rows(h).find(row=>row.getAttribute('data-history-id')===uuid);assert.ok(row,'row must be visible');const Event=h.el('nav-history').ownerDocument.defaultView.Event;(cell?row.querySelector('[role="cell"]')!:row.querySelector('button')!).dispatchEvent(new Event('click',{bubbles:true}));};
const noJobIO=(h:Harness)=>assert.equal(h.requests.some(r=>/\/history\/|\/jobs\/|\/prompt$|\/interrupt/.test(r.url)),false);

test('history uses aligned date/type/prompt columns and focused literal source details with a plain selection button',async()=>{
  const literal='<img src=x onerror=alert(1)> '+'很长的来源名称'.repeat(16),h=await panelHarness({settings:defaultSettings(),history:[record(1,'ready',{sourceName:literal,snapshot:{documentId:17},userPrompt:'PRIVATE PROMPT'}),record(2,'queued',{snapshot:{documentId:22}}),record(3),record(4,'ready',{params:{}})]});
  try{await h.wait();assert.equal(h.el('history')===null,true,'the dropdown must be removed');assert.equal(h.el('history-table')?.getAttribute('role'),'table');
    assert.deepEqual(Array.from(h.el('history-table').querySelectorAll('[role="columnheader"]')).map((node:any)=>node.textContent),['选择','保存时间','任务类型','提示词']);assert.equal(rows(h).length,4);
    const first=rows(h)[0];assert.equal(first.querySelector('img'),null);assert.match(h.el('history-table').textContent,/PRIVATE PROMPT/);
    assert.equal(first.querySelector('.history-date')?.children.length,2);assert.match(first.querySelector('.history-date')!.textContent!,/2026-10-18/);assert.equal(first.querySelector('button')!.children.length,0);
    assert.match(rows(h)[1].querySelector('.history-type')!.textContent!,/排队.*未确认/);assert.match(rows(h)[2].querySelector('.history-type')!.textContent!,/文字生图/);assert.match(rows(h)[3].querySelector('.history-type')!.textContent!,/未保存任务类型/);
    assert.equal(selected(h),id(2));assert.match(rows(h)[1].textContent!,/正在查看/);clickRow(h,id(1));assert.ok(h.el('history-details').textContent.includes(literal));assert.equal(h.el('history-details').querySelector('img'),null);assert.equal(h.el('history-prompt').value,'PRIVATE PROMPT');noJobIO(h);
  }finally{await h.close();}
});

test('clicking a row cell or its button selects the full UUID and updates the row actions without job IO',async()=>{
  const h=await panelHarness({history:[record(1),record(2,'unknown')]});try{await h.wait();clickRow(h,id(1),true);assert.equal(selected(h),id(1));assert.equal(h.el('history-id').value,id(1));assert.equal(h.el('cancel').disabled,true);assert.equal(h.el('stop-tracking').style.display,'none');
    clickRow(h,id(2));assert.equal(selected(h),id(2));assert.equal(h.el('cancel').disabled,false);assert.equal(h.el('stop-tracking').disabled,false);noJobIO(h);
  }finally{await h.close();}
});

test('history preserves saved order and renders at most twenty rows with bounded page navigation',async()=>{
  const h=await panelHarness({history:Array.from({length:45},(_,i)=>record(i+1))});try{await h.wait();assert.equal(rows(h).length,20);assert.equal(selected(h),id(1));assert.match(h.el('history-page').textContent,/1.*3/);assert.equal(h.el('history-prev').disabled,true);
    h.click('history-next');assert.equal(rows(h).length,20);assert.equal(rows(h)[0].getAttribute('data-history-id'),id(21));assert.equal(selected(h),id(21));h.click('history-next');assert.equal(rows(h).length,5);assert.equal(selected(h),id(41));assert.equal(h.el('history-next').disabled,true);
    h.click('history-prev');assert.equal(rows(h)[0].getAttribute('data-history-id'),id(21));noJobIO(h);
  }finally{await h.close();}
});

test('startup, next pending and a generation block reveal the precise unresolved record on its later page',async()=>{
  const history=Array.from({length:45},(_,i)=>record(i+1,i===21||i===42?'unknown':'ready')),h=await panelHarness({history});try{await h.wait();assert.equal(selected(h),id(22));assert.equal(rows(h)[0].getAttribute('data-history-id'),id(21));
    h.click('next-pending');await h.wait();assert.equal(selected(h),id(43));assert.equal(rows(h)[0].getAttribute('data-history-id'),id(41));
    h.click('history-prev');h.click('history-prev');clickRow(h,id(1));h.click('tab-t2i');h.click('generate');await h.wait();assert.equal(selected(h),id(22));assert.notEqual(h.el('view-history').style.display,'none');assert.equal(h.el('history-id').value,id(22));noJobIO(h);
  }finally{await h.close();}
});

test('filters show counts and terminal recovery keeps its selected UUID visible by revealing All',async()=>{
  const h=await panelHarness({history:[record(1),record(2,'unknown'),record(3,'queued')],pollDelayMs:1});try{await h.wait();assert.match(h.el('history-all').textContent,/3/);assert.match(h.el('history-unresolved').textContent,/2/);h.click('history-unresolved');assert.equal(rows(h).length,2);clickRow(h,id(3));h.click('recover');await h.wait();
    assert.equal(selected(h),id(3));assert.equal(h.el('history-id').value,id(3));assert.equal(h.el('history-all').getAttribute('aria-pressed'),'true');assert.match(rows(h).find(row=>row.getAttribute('data-history-id')===id(3))!.textContent!,/就绪/);assert.match(h.el('history-unresolved').textContent,/1/);
    assert.deepEqual(h.requests.filter(r=>r.url.includes('/history/')).map(r=>r.url.split('/').pop()),[id(3)]);assert.equal(h.posts.length,0);assert.equal(h.requests.some(r=>r.url.includes('/interrupt')),false);
  }finally{await h.close();}
});

test('an empty unresolved filter has no selected action target and returning to All never queries jobs',async()=>{
  for(const history of [[],[record(1),record(2)]]){const h=await panelHarness({history});try{await h.wait();h.click('history-unresolved');assert.equal(rows(h).length,0);assert.equal(selected(h),undefined);assert.equal(h.el('history-id').value,'');assert.notEqual(h.el('history-empty').style.display,'none');assert.equal(h.el('recover').disabled,true);assert.equal(h.el('history-next').disabled,true);h.click('history-all');assert.equal(rows(h).length,history.length);noJobIO(h);
  }finally{await h.close();}}
});

test('filter, page and row actions clear an armed stop-tracking confirmation even when the same row remains visible',async()=>{
  const h=await panelHarness({history:Array.from({length:22},(_,i)=>record(i+1,'unknown'))});try{await h.wait();
    for(const displayAction of ['history-unresolved','history-next']){h.click('stop-tracking');await h.wait();assert.notEqual(h.el('detach-confirmation').style.display,'none');h.click(displayAction);h.click('confirm-stop-tracking');await h.wait();assert.ok(h.records().every(r=>r.tracking===undefined));}
    h.click('stop-tracking');await h.wait();clickRow(h,id(22));h.click('confirm-stop-tracking');await h.wait();assert.ok(h.records().every(r=>r.tracking===undefined));noJobIO(h);
  }finally{await h.close();}
});

test('busy row, filter, pagination and refresh callbacks cannot move the active selected task',async()=>{
  const h=await panelHarness({history:Array.from({length:22},(_,i)=>record(i+1,'unknown'))});try{await h.wait();h.holdHistory();h.click('recover');await new Promise(r=>setTimeout(r,25));
    assert.equal(h.el('history-table').getAttribute('aria-busy'),'true');clickRow(h,id(2));clickRow(h,id(2),true);for(const action of ['history-all','history-unresolved','history-next','history-prev','history-refresh'])h.click(action);
    assert.equal(selected(h),id(1));assert.equal(h.el('history-id').value,id(1));h.releaseHistory();await h.wait();assert.equal(selected(h),id(1));assert.equal(h.records()[1].state,'unknown');assert.equal(h.el('history-unresolved').disabled,false);
  }finally{h.releaseHistory();await h.close();}
});

test('opening pending history owns its asynchronous read so recovery cannot race its selected row',async()=>{
  const h=await panelHarness({history:[record(1),record(2,'unknown')]});try{await h.wait();clickRow(h,id(1));h.holdHistory();h.click('open-pending');await new Promise(r=>setTimeout(r,25));h.click('recover');h.click('generate');h.releaseHistory();await h.wait();
    assert.equal(selected(h),id(2));assert.equal(h.records()[1].state,'unknown');noJobIO(h);
  }finally{h.releaseHistory();await h.close();}
});

test('generation keeps history navigation locked through its final local refresh and unlocks even if that read fails',async()=>{
  for(const corruptFinalRead of [false,true]){
    const h=await panelHarness({history:Array.from({length:22},(_,i)=>record(i+1,'unknown'))});let saved=h.files['history.json'];
    try{await h.wait();h.click('tab-t2i');let reads=0,notify=()=>{};const armed=new Promise<void>(resolve=>{notify=resolve;});
      // The blocker lookup and reveal finish first; delay the following cleanup read.
      Object.defineProperty(h.files,'history.json',{configurable:true,get(){reads++;if(reads===2){h.holdHistory();notify();}return corruptFinalRead&&reads===3?'{':saved;},set(value){saved=value;}});
      h.click('generate');await armed;await new Promise(resolve=>setTimeout(resolve,25));
      assert.equal(h.el('history-table').getAttribute('aria-busy'),'true');assert.equal(h.el('history-refresh').disabled,true);assert.equal(h.el('history-next').disabled,true);
      clickRow(h,id(2));for(const action of ['history-next','history-unresolved','history-refresh','recover','generate'])h.click(action);
      assert.equal(selected(h),id(1));noJobIO(h);h.releaseHistory();await h.wait();assert.equal(h.el('history-table').getAttribute('aria-busy'),'false');assert.equal(h.el('history-refresh').disabled,false);
    }finally{delete h.files['history.json'];h.files['history.json']=saved;h.releaseHistory();await h.wait();await h.close();}
  }
});

test('language and local refresh preserve the visible selected page, literal source and saved parameters',async()=>{
  const history=Array.from({length:25},(_,i)=>record(i+1,'ready',{sourceName:'私人来源.psd',userPrompt:'保留原文'})),h=await panelHarness({history});try{await h.wait();h.click('history-next');clickRow(h,id(24));h.el('seed').value='987';h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(selected(h),id(24));assert.equal(rows(h)[0].getAttribute('data-history-id'),id(21));assert.deepEqual(Array.from(h.el('history-table').querySelectorAll('[role="columnheader"]')).map((node:any)=>node.textContent),['Select','Saved','Task type','Prompt']);assert.match(h.el('history-all').textContent,/All.*25/);assert.equal(h.el('seed').value,'987');assert.ok(h.el('history-details').textContent.includes('私人来源.psd'));assert.equal(h.el('history-prompt').value,'保留原文');
    h.click('history-refresh');await h.wait();assert.equal(selected(h),id(24));assert.deepEqual(h.records(),history);noJobIO(h);
  }finally{await h.close();}
});

test('loading a candidate and reusing parameters target only the selected table row',async()=>{
  const history=[record(1,'ready',{outputFile:'one.png',userPrompt:'first prompt'}),record(2,'ready',{outputFile:'two.png',userPrompt:'second prompt'})],h=await panelHarness({history});try{await h.wait();for(const name of ['one.png','two.png'])h.files[name]=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)});
    clickRow(h,id(2));h.click('load-history');await h.wait();h.click('export');await h.wait();assert.ok(h.files[`ps-ai-${id(2).slice(0,8)}.png`]);assert.equal(h.files[`ps-ai-${id(1).slice(0,8)}.png`],undefined);
    clickRow(h,id(1));h.click('repeat-history');await h.wait();assert.equal(h.el('prompt').value,'first prompt');noJobIO(h);
  }finally{await h.close();}
});

test('the history implementation retains long source text without runtime thumbnails or nested native-button content',async()=>{
  const source='无空格超长名称'.repeat(40),h=await panelHarness({history:[record(1,'ready',{sourceName:source})]});try{await h.wait();assert.ok(h.el('history-details').textContent.includes(source));assert.equal(h.el('history-table').querySelector('img'),null);
    const css=await fs.readFile('plugin/style.css','utf8');assert.doesNotMatch(css,/\.history[^{}]*\{[^}]*display\s*:\s*grid/);assert.equal(rows(h)[0].querySelector('button')!.children.length,0);
  }finally{await h.close();}
});
