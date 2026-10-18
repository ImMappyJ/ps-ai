import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {encodePng,decodePng} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';
import {prepareCandidate} from '../src/app/candidate-preparation';
const id=(n:number)=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const record=(n:number,extra:Partial<JobRecord>={}):JobRecord=>({id:id(n),clientId:id(999),state:'ready',graph:{},createdAt:'2026-10-18T09:35:12.000Z',template:'qwen21-local-v2-rgba',params:{workspace:'t2i',mode:'generate',outputKind:'t2i'},...extra});
type Harness=Awaited<ReturnType<typeof panelHarness>>;
const event=(h:Harness,node:HTMLElement,type:string)=>{const Event=h.el('nav-history').ownerDocument.defaultView.Event;return node.dispatchEvent(new Event(type,{bubbles:true}));};
const row=(h:Harness,n:number)=>h.historyRows().find(node=>node.getAttribute('data-history-id')===id(n))!;
const check=(h:Harness,n:number,checked=true)=>{const node=row(h,n)?.querySelector('[data-history-check]') as any;assert.ok(node,'each row has an independent checkbox');node.checked=checked;event(h,node,'change');};
const focus=(h:Harness,n:number)=>event(h,row(h,n).querySelector('.history-prompt')!,'click');
const noJobIO=(h:Harness)=>assert.equal(h.requests.some(r=>/\/history\/|\/jobs\/|\/prompt$|\/cancel|\/upload/.test(r.url)),false);
async function until(predicate:()=>boolean){for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.ok(predicate(),'preview must settle');}
const image=(red:number)=>({width:2,height:2,rgba:Uint8Array.from(Array.from({length:4},()=>[red,30,40,255]).flat())});

test('history separates focused details from single, multiple and filtered all-page checkbox selection',async()=>{
 const h=await panelHarness({history:Array.from({length:45},(_,i)=>record(i+1,{userPrompt:`literal ${i+1}`}))});try{await h.wait();h.click('nav-history');
  const checkbox=row(h,2).querySelector('[data-history-check]') as HTMLElement;assert.ok(checkbox);event(h,checkbox,'click');check(h,2);assert.equal(h.el('history-id').value,id(1));assert.match(row(h,1).textContent!,/正在查看/);assert.match(h.el('history-selected-count').textContent,/1/);assert.match(h.el('clear-history').textContent,/1/);
  focus(h,3);assert.equal(h.el('history-id').value,id(3));assert.equal((row(h,2).querySelector('[data-history-check]') as any).checked,true);
  h.click('history-next');check(h,24);assert.match(h.el('history-selected-count').textContent,/2/);h.click('history-prev');assert.equal((row(h,2).querySelector('[data-history-check]') as any).checked,true);
  h.click('history-check-all');assert.match(h.el('history-selected-count').textContent,/45/);assert.match(h.el('history-check-all').textContent,/所有页/);h.click('history-check-none');assert.match(h.el('history-selected-count').textContent,/0/);assert.equal(h.el('clear-history').disabled,true);
  check(h,2);h.click('history-unresolved');assert.match(h.el('history-selected-count').textContent,/0/);noJobIO(h);
 }finally{await h.close();}
});

test('history shows original prompt text and honest task labels in both languages without HTML or prompt reconstruction',async()=>{
 const modes=[['edit','局部物体 / 材质修改','Edit objects / materials'],['remove','移除杂物','Remove objects'],['background','换背景（选择主体）','Replace background (select subject)'],['effect','特效素材','Effect asset'],['costume','服装 / 道具修复','Repair clothing / props'],['reference','角色参考辅助','Character reference'],['scene','场景替换','Replace scene'],['atmosphere','氛围素材','Atmosphere asset'],['relight','光影重塑','Relighting'],['blend','溶图','Image Blending'],['generate','文字生图','Text to image']];
 const literal='<img src=x> 原样  \n'+'长提示词'.repeat(80),history=modes.map(([mode],i)=>record(i+1,{params:{mode,workspace:mode==='generate'?'t2i':'local'},userPrompt:mode==='remove'||mode==='relight'?'':literal,...(mode==='relight'?{relight:{schemaVersion:1}}:{})}));history.push(record(12,{params:undefined,userPrompt:undefined,graph:{'6':{inputs:{text:'DO NOT RECONSTRUCT'}}} as any}),record(13,{params:{mode:'relight'},userPrompt:undefined,relight:{schemaVersion:1}}));
 for(const language of ['zh-CN','en-US'] as const){const h=await panelHarness({settings:{...defaultSettings(),language},history});try{await h.wait();h.click('nav-history');
  assert.deepEqual(Array.from(h.el('history-table').querySelectorAll('[role="columnheader"]')).map((node:any)=>node.textContent),language==='zh-CN'?['选择','保存时间','任务类型','提示词']:['Select','Saved','Task type','Prompt']);
  modes.forEach((labels,i)=>assert.equal(row(h,i+1).querySelector('.history-type-label')?.textContent,labels[language==='zh-CN'?1:2]));
  focus(h,1);assert.equal(row(h,1).querySelector('.history-prompt-text')?.textContent,literal);assert.equal(h.el('history-prompt').value,literal);assert.equal(h.el('history-table').querySelector('img'),null);
  assert.match(row(h,2).textContent!,language==='zh-CN'?/内置移除指令/:/Built-in removal instruction/);assert.match(row(h,9).textContent!,language==='zh-CN'?/已保存布光/:/Saved lighting/);assert.match(row(h,12).textContent!,language==='zh-CN'?/未保存任务类型.*未保存提示词/:/Task type not saved.*Prompt not saved/);assert.equal(row(h,13).querySelector('.history-prompt-text')?.textContent,language==='zh-CN'?'未保存提示词':'Prompt not saved');assert.doesNotMatch(h.el('history-table').textContent,/DO NOT RECONSTRUCT/);noJobIO(h);
 }finally{await h.close();}}
});

test('refresh prunes removed checks and every row, check, filter, page or refresh invalidates a clear confirmation',async()=>{
 const h=await panelHarness({history:Array.from({length:23},(_,i)=>record(i+1))});try{await h.wait();h.click('nav-history');
  for(const action of [()=>focus(h,1),()=>check(h,2),()=>h.click('history-all'),()=>h.click('history-next'),()=>h.click('history-refresh')]){h.click('history-all');h.click('history-check-all');h.click('clear-history');assert.notEqual(h.el('history-clear-confirmation')?.style.display,'none');action();await h.wait();h.click('confirm-clear-history');await h.wait();assert.equal(h.records().length,23);}
  h.click('history-all');h.click('history-check-none');check(h,2);check(h,3);h.files['history.json']=JSON.stringify(h.records().filter(r=>r.id!==id(2)));h.click('history-refresh');await h.wait();assert.match(h.el('history-selected-count').textContent,/1/);assert.equal(row(h,2),undefined);noJobIO(h);
 }finally{await h.close();}
});

test('pending entry scrolls the exact later-page row only after display and unlock and resets details to top',async()=>{
 const h=await panelHarness({history:Array.from({length:45},(_,i)=>record(i+1,i===42?{state:'unknown'}:{}))});try{await h.wait();h.click('nav-history');h.click('history-prev');h.el('history-detail-pane').scrollTop=300;h.scrolled.length=0;h.holdHistory();h.click('open-pending');await new Promise(r=>setTimeout(r,25));assert.equal(h.scrolled.length,0);h.releaseHistory();await h.wait();await until(()=>h.scrolled.includes(id(43))&&h.scrolled[h.scrolled.length-1]==='history-detail-pane');assert.equal(h.el('history-id').value,id(43));assert.equal(h.historyRows()[0].getAttribute('data-history-id'),id(41));assert.equal(h.el('history-detail-pane').scrollTop,0);noJobIO(h);
 }finally{h.releaseHistory();await h.close();}
});

test('history previews latest focus with serialized local reads and never populate Results or access a backend',async()=>{
 const h=await panelHarness({history:[record(1),record(2,{outputFile:'second.png'}),record(3,{outputFile:'third.png'})],files:{'second.png':encodePng(image(80)),'third.png':encodePng(image(170))}});try{await h.wait();h.click('nav-history');h.holdFileRead('second.png');focus(h,2);await until(()=>h.fileReads.includes('second.png'));focus(h,3);assert.equal(h.el('history-preview').getAttribute('src'),null);assert.equal(h.fileReads.includes('third.png'),false,'one full raster read is allowed at a time');h.releaseFileRead('second.png');await until(()=>!!h.el('history-preview').getAttribute('src'));
  const pixels=decodePng(new Uint8Array(Buffer.from(h.el('history-preview').src.split(',')[1],'base64')));assert.equal(pixels.rgba[0],170);assert.equal(h.el('candidate-select').children.length,0);assert.equal(h.el('candidates').children.length,0);assert.equal(h.el('detail-preview').getAttribute('src'),null);noJobIO(h);
 }finally{h.releaseFileRead('second.png');await h.close();}
});

test('unsafe output paths and derived task names are rejected before any local automatic preview read',async()=>{
 const h=await panelHarness({history:[record(1),record(2,{outputFile:'../private.png'}),record(3,{id:'../private',outputFile:'safe.png',snapshot:{documentId:9},params:{outputKind:'edit'}})],files:{'safe.png':encodePng(image(10))}});try{await h.wait();h.click('nav-history');focus(h,2);await until(()=>h.el('history-preview-status')?.textContent.includes('无法'));h.selectHistory('../private');await until(()=>h.el('history-preview-status')?.textContent.includes('无法'));assert.equal(h.fileReads.some(name=>name==='safe.png'||name.includes('../')),false);assert.equal(h.el('load-history').disabled,false,'manual load/recovery remains reachable');noJobIO(h);
 }finally{await h.close();}
});

test('missing and corrupt local candidates show placeholders while keeping detail actions available',async()=>{
 for(const bytes of [undefined,new Uint8Array([1,2,3])]){const h=await panelHarness({history:[record(1,{outputFile:'missing.png'})],files:bytes?{'missing.png':bytes}:{}});try{await h.wait();h.click('nav-history');await until(()=>h.el('history-preview-status')?.textContent.includes('无法'));assert.equal(h.el('history-preview').getAttribute('src'),null);assert.equal(h.el('load-history').disabled,false);assert.equal(h.el('recover').disabled,false);assert.equal(h.el('candidate-select').children.length,0);assert.equal(h.el('diagnostic-box').style.display,'none');noJobIO(h);}finally{await h.close();}}
});

test('explicit Refresh retries the same local filename after a missing preview without reloading a painted src on checkbox changes',async()=>{
 const h=await panelHarness({history:[record(1,{outputFile:'same.png'})]});try{await h.wait();h.click('nav-history');await until(()=>h.el('history-preview-status').textContent.includes('无法'));h.files['same.png']=encodePng(image(90));h.click('history-refresh');await h.wait();await until(()=>!!h.el('history-preview').getAttribute('src'));const img=h.el('history-preview'),url=img.src;let changes=0;Object.defineProperty(img,'src',{configurable:true,get:()=>url,set:()=>{changes++;}});check(h,1);h.click('history-check-none');assert.equal(changes,0,'unchanged previews must not trigger native image reloads');assert.equal(h.fileReads.filter(name=>name==='same.png').length,1);noJobIO(h);}finally{await h.close();}
});

test('incomplete edit parameters cannot turn raw history output into a preview or an applyable candidate',async()=>{
 await assert.rejects(prepareCandidate(record(1,{params:undefined,snapshot:{documentId:11}}),encodePng(image(30)),async()=>new Uint8Array([255,255,255,255])),/参数/);
 const h=await panelHarness({history:[record(1,{outputFile:'saved.png',params:undefined,snapshot:{documentId:11}})],files:{'saved.png':encodePng(image(30)),[id(1)+'-mask.bin']:new Uint8Array([255,255,255,255])}});try{await h.wait();h.click('nav-history');await until(()=>h.el('history-preview')?.getAttribute('aria-busy')==='false');assert.equal(h.el('history-preview').getAttribute('src'),null);assert.match(h.el('history-preview-status').textContent,/无法/);h.click('load-history');await h.wait();assert.equal(h.el('candidate-select').children.length,0);assert.equal(h.el('apply').disabled,true);assert.equal(h.el('recover').disabled,false);}finally{await h.close();}
});

test('history has separate bounded flex list and detail scroll regions with a narrow-width stacking rule',async()=>{
 const h=await panelHarness();try{await h.wait();assert.ok(h.el('history-layout')?.contains(h.el('history-browser')));assert.equal(h.el('history-list-pane').contains(h.el('history-detail-pane')),false);assert.ok(h.el('history-detail-pane').contains(h.el('recover')));assert.ok(h.el('history-detail-pane').contains(h.el('history-cancel')));
  const css=await fs.readFile('plugin/style.css','utf8');assert.match(css,/#history-layout\s*\{[^}]*display\s*:\s*flex[^}]*min-height\s*:\s*0/);assert.match(css,/#history-rows\s*\{[^}]*overflow-y\s*:\s*auto/);assert.match(css,/#history-detail-pane\s*\{[^}]*overflow-y\s*:\s*auto/);assert.match(css,/@media\s*\(max-width:\s*700px\)/);assert.doesNotMatch(css,/\.history[^{}]*\{[^}]*display\s*:\s*grid/);
 }finally{await h.close();}
});

test('focused recovery actions precede the full prompt and narrow short panels keep a scroll fallback',async()=>{
 const h=await panelHarness({history:[record(1,{state:'unknown',userPrompt:'long '.repeat(400)})]});try{await h.wait();h.click('nav-history');const elements=Array.from(h.el('history-detail-pane').querySelectorAll('*'));assert.ok(elements.indexOf(h.el('recover'))<elements.indexOf(h.el('history-prompt')),'focused recovery is reachable before long text');const css=await fs.readFile('plugin/style.css','utf8');assert.match(css,/@media\s*\(max-width:\s*700px\)[\s\S]*#view-history\s*\{[^}]*overflow-y\s*:\s*auto/);assert.match(css,/@media\s*\(max-width:\s*700px\)[\s\S]*#history-rows\s*\{[^}]*min-height\s*:\s*(?:[7-9]\d|\d{3,})px/);}finally{await h.close();}
});
