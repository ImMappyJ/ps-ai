import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {encodePng} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const record=(id:string,state='ready',extra:Partial<JobRecord>={}):JobRecord=>({id,clientId:B,state,graph:{},createdAt:'2026-10-18T09:35:12.000Z',template:'qwen21-local-v2-rgba',params:{workspace:'t2i',mode:'generate',outputKind:'t2i',resolution:32},...extra});
type Harness=Awaited<ReturnType<typeof panelHarness>>;
const pause=()=>new Promise(r=>setTimeout(r,30));
const check=(h:Harness,id:string)=>{const node=h.historyRows().find(node=>node.getAttribute('data-history-id')===id)?.querySelector('[data-history-check]') as any;assert.ok(node,'history checkbox exists');node.checked=true;const Event=h.el('nav-history').ownerDocument.defaultView.Event;node.dispatchEvent(new Event('change',{bubbles:true}));};
const arm=(h:Harness)=>{h.click('nav-history');h.click('history-check-all');h.click('clear-history');assert.notEqual(h.el('history-clear-confirmation')?.style.display,'none');};
const clear=async(h:Harness)=>{arm(h);h.click('confirm-clear-history');await h.wait();};
const png=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)});
test('confirmed selected clear removes local blockers/files without backend IO and preserves settings, drafts, grants and unselected data',async()=>{
 const h=await panelHarness({settings:defaultSettings(),history:[record(A,'unknown',{outputFile:A+'-output.png'}),record(B,'ready',{outputFile:B+'-output.png'})],files:{[A+'-source.png']:png,[A+'-mask.bin']:new Uint8Array([255]),[A+'-output.png']:png,[B+'-output.png']:png,'relight-draft.json':'private lighting','source-file-access.json':'private grants'}});try{await h.wait();const before=h.requests.length,settings=h.files['settings.json'];h.click('nav-history');check(h,A);h.click('clear-history');assert.equal(h.records().length,2);assert.match(h.el('history-clear-warning').textContent,/1.*1/);assert.match(h.el('history-clear-warning').textContent,/计费/);assert.match(h.el('history-clear-warning').textContent,/原文档.*已应用图层.*导出/);
  h.click('confirm-clear-history');await h.wait();assert.deepEqual(h.records().map(r=>r.id),[B]);for(const name of [A+'-source.png',A+'-mask.bin',A+'-output.png'])assert.equal(h.files[name],undefined);assert.ok(h.files[B+'-output.png']);assert.equal(h.files['settings.json'],settings);assert.equal(h.files['relight-draft.json'],'private lighting');assert.equal(h.files['source-file-access.json'],'private grants');assert.equal(h.el('pending-notice').style.display,'none');assert.equal(h.requests.length,before);assert.match(h.el('history-cleanup-status').textContent,/已清除/);assert.equal(h.el('retry-history-cleanup').style.display,'none');
 }finally{await h.close();}
});

test('idle queued, running, unknown and cancelling records can be locally cleared and explicit generation is unblocked',async()=>{
 const history=['queued','running','unknown','cancelling'].map((state,i)=>record(`${i+1}1111111-1111-4111-8111-111111111111`,state)),h=await panelHarness({history});try{await h.wait();const before=h.requests.length;await clear(h);assert.deepEqual(h.records(),[]);assert.equal(h.requests.length,before);assert.equal(h.posts.length,0);assert.equal(h.el('pending-notice').style.display,'none');h.click('tab-t2i');h.el('resolution').value='32';h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(history.some(r=>r.id===h.posts[0].prompt_id),false);
 }finally{await h.close();}
});

test('selecting all unresolved records clears the whole filter across pages and preserves every ready record',async()=>{
 const history=Array.from({length:45},(_,i)=>record(`${i.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`,i%2?'ready':'unknown')),h=await panelHarness({history});try{await h.wait();h.click('nav-history');h.click('history-unresolved');assert.equal(h.historyRows().length,20);h.click('history-check-all');assert.match(h.el('history-selected-count').textContent,/23/);h.click('history-next');assert.equal(h.historyRows().length,3);const before=h.requests.length;h.click('clear-history');h.click('confirm-clear-history');await h.wait();assert.deepEqual(h.records(),history.filter(r=>r.state==='ready'));assert.equal(h.requests.length,before);assert.equal(h.el('pending-notice').style.display,'none');}finally{await h.close();}
});

test('a busy task and its final refresh lock checkbox, confirmation and cleanup retry without retargeting',async()=>{
 const h=await panelHarness({history:[record(A,'unknown'),record(B)]});try{await h.wait();arm(h);h.holdHistory();h.click('recover');await pause();assert.equal(h.el('clear-history').disabled,true);assert.equal(h.el('confirm-clear-history').disabled,true);h.click('history-check-none');h.click('confirm-clear-history');h.click('retry-history-cleanup');assert.equal(h.el('history-id').value,A);h.releaseHistory();await h.wait();assert.equal(h.records().length,2);assert.equal(h.files['history-cleanup.json'],undefined);
 }finally{h.releaseHistory();await h.close();}
});

test('a host capture holds the same clear and history-navigation lock through its pixel read',async()=>{
 const h=await panelHarness({history:[record(A)]});let release=()=>{};const barrier=new Promise<void>(resolve=>{release=resolve;});try{await h.wait();arm(h);const getPixels=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(...args:any[])=>{await barrier;return getPixels(...args);};h.click('capture');await pause();assert.equal(h.el('clear-history').disabled,true);assert.equal(h.el('confirm-clear-history').disabled,true);assert.equal(h.el('history-check-all').disabled,true);h.click('confirm-clear-history');release();await h.wait();assert.equal(h.records().length,1);assert.equal(h.files['history-cleanup.json'],undefined);}finally{release();await h.close();}
});

test('clear revalidates the frozen selected records after delayed history reads before deleting',async()=>{
 const h=await panelHarness({history:[record(A,'unknown'),record(B)]});try{await h.wait();h.click('nav-history');check(h,A);h.click('clear-history');h.holdHistory();h.click('confirm-clear-history');await pause();h.selectHistory(B);h.click('history-check-all');assert.equal(h.el('history-id').value,A);const changed=h.records();changed[0].state='running';h.files['history.json']=JSON.stringify(changed);h.releaseHistory();await h.wait();assert.equal(h.records().length,2);assert.equal(h.files['history-cleanup.json'],undefined);assert.equal(h.el('history-clear-confirmation').style.display,'none');assert.match(h.el('history-cleanup-status').textContent,/改变.*重新/);
 }finally{h.releaseHistory();await h.close();}
});

test('failed intent leaves history and candidates usable and requires a new explicit confirmation',async()=>{
 const h=await panelHarness({history:[record(A,'ready',{outputFile:A+'-output.png'})],files:{[A+'-output.png']:png}});try{await h.wait();h.failMoves.add('history-cleanup.json');await clear(h);assert.equal(h.records().length,1);assert.ok(h.files[A+'-output.png']);assert.equal(h.el('history-clear-confirmation').style.display,'none');assert.equal(h.el('clear-history').disabled,false);h.failMoves.clear();h.click('confirm-clear-history');await h.wait();assert.equal(h.records().length,1);await clear(h);assert.deepEqual(h.records(),[]);
 }finally{await h.close();}
});

test('partial file cleanup remains visible after restart and retry works without selecting removed records',async()=>{
 const h=await panelHarness({history:[record(A,'ready',{outputFile:A+'-output.png'})],files:{[A+'-output.png']:png}});let saved:Record<string,Uint8Array|string>={};try{await h.wait();h.failDeletes.add(A+'-output.png');const requests=h.requests.length;await clear(h);assert.deepEqual(h.records(),[]);assert.match(h.el('history-cleanup-status').textContent,/1.*待/);assert.notEqual(h.el('retry-history-cleanup').style.display,'none');assert.equal(h.requests.length,requests);saved={...h.files};}finally{await h.close();}
 const reload=await panelHarness({files:saved});try{await reload.wait();assert.equal(reload.el('history-id').value,'');assert.notEqual(reload.el('retry-history-cleanup').style.display,'none');const before=reload.requests.length;reload.click('retry-history-cleanup');await reload.wait();assert.equal(reload.files[A+'-output.png'],undefined);assert.equal(reload.el('retry-history-cleanup').style.display,'none');assert.match(reload.el('history-cleanup-status').textContent,/已清除/);assert.equal(reload.requests.length,before);}finally{await reload.close();}
});

test('metadata retry reports durable removal without claiming full cleanup or blocking a new generation',async()=>{
 const h=await panelHarness({history:[record(A,'unknown')]});try{await h.wait();h.failMoves.add('history.json');await clear(h);assert.equal(h.el('pending-notice').style.display,'none');assert.match(h.el('history-cleanup-status').textContent,/元数据.*待/);assert.notEqual(h.el('retry-history-cleanup').style.display,'none');assert.equal(h.el('history-id').value,'');assert.equal(h.el('history-all').textContent,'全部（0）');h.failMoves.clear();h.click('retry-history-cleanup');await h.wait();assert.deepEqual(h.records(),[]);assert.equal(h.el('retry-history-cleanup').style.display,'none');
 }finally{await h.close();}
});

test('shared and unsafe files have distinct nonretryable notices instead of false full-cleanup success',async()=>{
 const h=await panelHarness({history:[record(A,'ready',{outputFile:'legacy.png'}),record(B,'ready',{outputFile:A+'-output.png'})],files:{[A+'-output.png']:png,'legacy.png':png}});try{await h.wait();h.click('nav-history');check(h,A);h.click('clear-history');h.click('confirm-clear-history');await h.wait();assert.match(h.el('history-cleanup-status').textContent,/共享.*1/);assert.match(h.el('history-cleanup-status').textContent,/不安全.*1/);assert.ok(h.files[A+'-output.png']);assert.ok(h.files['legacy.png']);assert.equal(h.el('retry-history-cleanup').style.display,'none');assert.doesNotMatch(h.el('history-cleanup-status').textContent,/全部.*完成/);
 }finally{await h.close();}
});

test('clear evicts selected Results, invalidates delayed previews and clears only its plugin opacity target',async()=>{
 const h=await panelHarness();try{await h.wait();h.el('resolution').value='32';h.click('generate');await h.wait();const id=h.records()[0].id;h.click('apply');await h.wait();const layers=h.appliedLayers.length;assert.notEqual(h.el('applied-opacity').style.display,'none');h.click('nav-history');h.holdFileRead(id+'-output.png');h.click('history-refresh');await h.wait();await pause();await clear(h);assert.equal(h.el('candidate-select').children.length,0);assert.equal(h.el('candidates').children.length,0);assert.equal(h.el('detail-preview').getAttribute('src'),null);assert.equal(h.el('apply').disabled,true);assert.equal(h.el('export').disabled,true);assert.equal(h.el('new-document').disabled,true);assert.equal(h.el('applied-opacity').style.display,'none');h.releaseFileRead(id+'-output.png');await pause();assert.equal(h.el('history-preview').getAttribute('src'),null);assert.equal(h.appliedLayers.length,layers,'already applied layers are preserved');h.click('export');await h.wait();assert.equal(h.files[`ps-ai-${id.slice(0,8)}.png`],undefined);
 }finally{for(const r of h.records())h.releaseFileRead(r.id+'-output.png');await h.close();}
});

test('clearing the viewed candidate selects an undeleted Result and preserves the other candidate opacity target',async()=>{
 const h=await panelHarness();try{await h.wait();h.el('resolution').value='32';h.el('count').value='2';h.click('generate');await h.wait();const [first,second]=h.posts.map(p=>p.prompt_id);h.el('candidate-select').value='0';h.change('candidate-select');await h.wait();h.click('apply');await h.wait();h.el('candidate-select').value='1';h.change('candidate-select');await h.wait();h.click('nav-history');check(h,second);h.click('clear-history');const requests=h.requests.length;h.click('confirm-clear-history');await h.wait();assert.equal(h.el('candidate-select').children.length,1);assert.equal(h.el('apply').disabled,false);assert.equal(h.el('export').disabled,false);assert.ok(h.el('detail-preview').getAttribute('src'));assert.notEqual(h.el('applied-opacity').style.display,'none');h.click('export');await h.wait();assert.ok(h.files[`ps-ai-${first.slice(0,8)}.png`]);assert.equal(h.files[`ps-ai-${second.slice(0,8)}.png`],undefined);assert.equal(h.requests.length,requests);}finally{await h.close();}
});

test('clearing a cached relight result chooses the surviving result and keeps the frozen source and lighting draft',async()=>{
 const h=await panelHarness();try{await h.wait();h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');await pause();h.el('relight-intensity').value='2.5';h.change('relight-intensity');h.click('relight-generate');await h.wait();const first=h.posts[0].prompt_id;h.click('relight-generate');await h.wait();const second=h.posts[1].prompt_id;assert.ok(h.el('relight-result-list').querySelector(`[data-job-id="${second}"]`)?.classList.contains('active'));h.click('relight-save');await pause();const saved=h.files['relight-draft.json'],source=h.el('relight-source').textContent;h.click('relight-close');await pause();const captures=h.captured.length;h.click('nav-history');check(h,second);h.click('clear-history');h.click('confirm-clear-history');await h.wait();h.click('open-relight');await pause();assert.equal(h.el('relight-apply').disabled,false);assert.equal(h.el('relight-export').disabled,false);assert.ok(h.el('relight-result-list').querySelector(`[data-job-id="${first}"]`)?.classList.contains('active'));assert.equal(h.el('relight-result-list').querySelector(`[data-job-id="${second}"]`),null);assert.equal(h.el('relight-intensity').value,'2.5');assert.equal(h.el('relight-source').textContent,source);assert.equal(h.captured.length,captures);assert.equal(h.files['relight-draft.json'],saved);
  h.click('relight-close');await pause();h.click('history-check-all');h.click('clear-history');h.click('confirm-clear-history');await h.wait();h.click('open-relight');await pause();assert.equal(h.el('relight-apply').disabled,true);assert.equal(h.el('relight-export').disabled,true);assert.equal(h.el('relight-result-list').children.length,0);const layers=h.appliedLayers.length;h.click('relight-apply');h.click('relight-export');await pause();assert.equal(h.appliedLayers.length,layers);assert.equal(Object.keys(h.files).some(name=>/^ps-ai-.*\.png$/.test(name)),false);
 }finally{await h.close();}
});

test('clearing a blocker removes obsolete pending diagnostics while preserving unrelated diagnostic errors',async()=>{
 for(const unrelated of [false,true]){const h=await panelHarness({history:[record(A,'unknown')]});try{await h.wait();h.click('generate');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');if(unrelated){h.el('backend-url').value='bad';h.click('save-settings');await h.wait();}await clear(h);assert.equal(h.el('diagnostic-box').style.display,unrelated?'block':'none');}finally{await h.close();}}
});

test('durable clear removes its row, focus and blocker when the following history or cleanup-status read fails once',async()=>{
 for(const failingRead of [1,2]){
  const h=await panelHarness({history:[record(A,'unknown')]});try{
   await h.wait();h.click('generate');await h.wait();assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'pending-task');arm(h);
   let saved=h.files['history.json'],armed=false,reads=0,failures=0;
   Object.defineProperty(h.files,'history.json',{configurable:true,get(){if(armed&&++reads===failingRead){armed=false;failures++;throw Error('Injected post-clear history read failure');}return saved;},set(value){saved=value;if(JSON.parse(String(value)).length===0){armed=true;reads=0;}}});
   const requests=h.requests.length;h.click('confirm-clear-history');await h.wait();
   assert.equal(failures,1,'failure must occur after durable history removal');assert.deepEqual(JSON.parse(String(saved)),[]);assert.deepEqual(JSON.parse(String(h.files['history-cleanup.json'])).removedIds,[A]);
   assert.deepEqual(h.historyRows().map(node=>node.getAttribute('data-history-id')),[]);assert.equal(h.el('history-id').value,'');assert.equal(h.el('history-prompt').value,'');assert.equal(h.el('pending-notice').style.display,'none');assert.equal(h.el('history-clear-confirmation').style.display,'none');assert.equal(h.el('history-selected-count').textContent,'已勾选 0 条');
   for(const action of ['recover','history-cancel','load-history','repeat-history','clear-history','apply','export'])assert.equal(h.el(action).disabled,true,action);
   assert.equal(h.el('history-preview').getAttribute('src'),null);assert.match(h.el('history-cleanup-status').textContent,/已清除 1/);assert.equal(h.el('diagnostic-box').style.display,'block');assert.notEqual(JSON.parse(h.el('diagnostic-details').value).code,'pending-task');assert.ok(h.errors.some(error=>error.message==='Injected post-clear history read failure'));assert.equal(h.requests.length,requests);
  }finally{await h.close();}
 }
});

test('durable clear keeps an undeleted focused Result and opacity target after its survivor repaint fails',async()=>{
 const h=await panelHarness();try{
  await h.wait();h.el('resolution').value='32';h.el('count').value='2';h.click('generate');await h.wait();const [first,second]=h.posts.map(post=>post.prompt_id);
  h.el('candidate-select').value='0';h.change('candidate-select');await h.wait();h.click('apply');await h.wait();h.el('candidate-select').value='1';h.change('candidate-select');await h.wait();
  const history=h.records();history.find(item=>item.id===second)!.state='unknown';h.files['history.json']=JSON.stringify(history);await h.refreshHistory();h.click('generate');await h.wait();h.selectHistory(first);check(h,second);h.click('clear-history');
  const image=h.el('detail-preview');let failures=0;Object.defineProperty(image,'src',{configurable:true,get:()=>image.getAttribute('src')??'',set(value:string){if(!failures++){throw Error('Injected survivor repaint failure');}image.setAttribute('src',value);}});
  const requests=h.requests.length;h.click('confirm-clear-history');await h.wait();
  assert.equal(failures,1);assert.deepEqual(h.records().map(item=>item.id),[first]);assert.deepEqual(h.historyRows().map(node=>node.getAttribute('data-history-id')),[first]);assert.equal(h.el('history-id').value,first);assert.equal(h.el('history-selected-count').textContent,'已勾选 0 条');assert.equal(h.el('pending-notice').style.display,'none');assert.equal(h.el('history-clear-confirmation').style.display,'none');
  assert.equal(h.el('candidate-select').children.length,1);assert.equal(h.el('candidates').children.length,1);assert.equal(h.el('apply').disabled,false);assert.equal(h.el('export').disabled,false);assert.notEqual(h.el('applied-opacity').style.display,'none');assert.equal(h.files[second+'-output.png'],undefined);assert.equal(image.getAttribute('src'),null);assert.ok(h.errors.some(error=>error.message==='Injected survivor repaint failure'));assert.notEqual(JSON.parse(h.el('diagnostic-details').value).code,'pending-task');assert.equal(h.requests.length,requests);
 }finally{await h.close();}
});

test('cleanup retry reconciles its durable IDs before a failed refresh and preserves checked and focused survivors',async()=>{
 const C='33333333-3333-4333-8333-333333333333',h=await panelHarness({history:[record(A,'unknown',{outputFile:A+'-output.png'}),record(B,'unknown'),record(C)],files:{[A+'-output.png']:png}});try{
  await h.wait();h.failDeletes.add(A+'-output.png');h.click('nav-history');check(h,A);h.click('clear-history');h.click('confirm-clear-history');await h.wait();assert.notEqual(h.el('retry-history-cleanup').style.display,'none');
  h.selectHistory(C);check(h,B);check(h,C);
  // A durable intent can be ahead of the panel after a lost response or earlier refresh failure.
  const journal=JSON.parse(String(h.files['history-cleanup.json']));journal.removedIds.push(B);journal.metadataPending=true;h.files['history-cleanup.json']=JSON.stringify(journal);h.failDeletes.clear();
  let saved=h.files['history.json'],armed=false,failures=0;Object.defineProperty(h.files,'history.json',{configurable:true,get(){if(armed){armed=false;failures++;throw Error('Injected post-retry history read failure');}return saved;},set(value){saved=value;if(JSON.parse(String(value)).length===1)armed=true;}});
  const requests=h.requests.length;h.click('retry-history-cleanup');await h.wait();
  assert.equal(failures,1);assert.deepEqual(h.records().map(item=>item.id),[C]);assert.deepEqual(h.historyRows().map(node=>node.getAttribute('data-history-id')),[C]);assert.equal(h.el('history-id').value,C);assert.equal(h.el('history-selected-count').textContent,'已勾选 1 条');assert.equal((h.historyRows()[0].querySelector('[data-history-check]') as any).checked,true);assert.equal(h.el('pending-notice').style.display,'none');assert.equal(h.el('retry-history-cleanup').style.display,'none');assert.equal(h.files[A+'-output.png'],undefined);assert.match(h.el('history-cleanup-status').textContent,/已清除 2/);assert.ok(h.errors.some(error=>error.message==='Injected post-retry history read failure'));assert.equal(h.requests.length,requests);
 }finally{await h.close();}
});
