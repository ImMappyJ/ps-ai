import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings,validateSettings,switchConnection} from '../src/infrastructure/config/profile';
import {diagnostic,DiagnosticError} from '../src/diagnostics/diagnostics';
import * as panelState from '../src/app/panel-view';
import type {JobRecord} from '../src/generation/jobs';
import {encodePng} from '../src/imaging/image';
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
const record=(n:number):JobRecord=>({id:`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,clientId:'ffffffff-1111-4111-8111-111111111111',state:'ready',createdAt:'2026-10-19T00:00:00Z',graph:{},params:{workspace:'t2i',mode:'generate'},userPrompt:`literal ${n}`});

test('hidden bundle registration does no storage, network, native imaging or relay startup; show is local and idempotent',async()=>{
 const h=await panelHarness({showPanel:false,settings:defaultSettings(),history:[record(1)]});try{
  assert.deepEqual(h.requests,[]);assert.deepEqual(h.fileReads,[]);assert.deepEqual(h.pixelRequests,[]);assert.deepEqual(h.nativeEvents,[]);assert.deepEqual(h.relayLaunches,[]);
  assert.equal(h.showPanel(),undefined,'lifecycle returns without waiting on I/O');await h.wait();
  assert.deepEqual(h.requests,[]);assert.equal(h.el('connection').textContent,'待检查');assert.equal(h.records().length,1);
  const reads=h.fileReads.length;h.hidePanel();h.showPanel();h.showPanel();await pause();assert.equal(h.fileReads.length,reads);assert.deepEqual(h.requests,[]);
 }finally{await h.close();}
});

test('an offline saved backend leaves the shell usable without automatic error or connection wait',async()=>{
 const h=await panelHarness({settings:{...defaultSettings(),baseUrl:'http://offline.invalid:9999'}});try{
  await h.wait();assert.deepEqual(h.requests,[]);assert.equal(h.el('generate').disabled,false);assert.equal(h.el('diagnostic-box').style.display,'none');
  h.click('nav-history');assert.equal(h.el('view-history').style.display,'block');h.click('connect');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');
 }finally{await h.close();}
});

test('technical details copies a redacted report directly and errors stay on their feature page',async()=>{
 const h=await panelHarness({settings:defaultSettings()});try{
  await h.wait();h.el('count').value='0';h.click('generate');await h.wait();
  assert.equal(h.el('diagnostic-box').parentElement.id,'view-create');assert.match(h.el('diagnostic-summary').textContent,/候选数量/);assert.equal(h.el('toggle-error-details').textContent,'技术详情');
  h.click('toggle-error-details');await pause();assert.equal(h.clipboardWrites.length,1);assert.equal(h.el('diagnostic-details').style.display,'none');assert.match(h.el('diagnostic-copy-status').textContent,/已复制/);
  const copied=JSON.parse(h.clipboardWrites[0]);assert.ok(copied.operationId);assert.equal(copied.page,'create');assert.ok(copied.build);
  h.click('nav-history');assert.equal(h.el('diagnostic-box').style.display,'none');h.click('nav-create');assert.equal(h.el('diagnostic-box').style.display,'block');
 }finally{await h.close();}
});

test('clipboard rejection never claims copied and offers a report export without replacing the original error',async()=>{
 const h=await panelHarness({settings:defaultSettings(),clipboardError:'Permission denied C:\\private\\token'});try{
  await h.wait();h.el('count').value='0';h.click('generate');await h.wait();const original=h.el('diagnostic-summary').textContent;
  h.click('toggle-error-details');await pause();assert.equal(h.clipboardWrites.length,0);assert.doesNotMatch(h.el('diagnostic-copy-status').textContent,/^已复制$/);assert.match(h.el('diagnostic-copy-status').textContent,/复制失败/);assert.doesNotMatch(h.el('diagnostic-copy-status').textContent,/private|token/);assert.equal(h.el('diagnostic-summary').textContent,original);assert.equal(h.el('export-error-report').style.display,'block');
 }finally{await h.close();}
});

test('a completed batch navigates once to its first saved result and an opt-out stays on the chosen page',async()=>{
 for(const enabled of [true,false]){const h=await panelHarness({settings:{...defaultSettings(),autoViewResults:enabled}});try{
  await h.wait();h.click('tab-t2i');h.el('count').value='2';h.click('generate');await h.wait();
  assert.equal(h.records().length,2);assert.equal(h.el(enabled?'nav-results':'nav-create').getAttribute('aria-selected'),'true');
  if(enabled){assert.equal(h.el('candidate-select').value,'0');assert.match(h.el('candidate-caption').textContent,/1 \/ 2/);}
  assert.equal(h.appliedLayers.length,0);
 }finally{await h.close();}}
});

test('successful result intent waits for text, pointer and hidden panel interaction to end',async()=>{
 const h=await panelHarness({settings:defaultSettings()});try{
  await h.wait();h.click('tab-t2i');h.holdCheck();h.click('generate');await pause();h.click('nav-settings');h.focus('backend-url');h.hidePanel();h.releaseCheck();await h.wait();
  assert.equal(h.el('nav-settings').getAttribute('aria-selected'),'true');h.showPanel();await pause();assert.equal(h.el('nav-settings').getAttribute('aria-selected'),'true');
  h.event('panel-shell','pointerdown',{pointerId:1});h.blur();await pause();assert.equal(h.el('nav-settings').getAttribute('aria-selected'),'true');h.event('panel-shell','pointercancel',{pointerId:1});await pause();assert.equal(h.el('nav-results').getAttribute('aria-selected'),'true');
 }finally{h.releaseCheck();await h.close();}
});

test('narrow history opens details on explicit row focus and returns with page, checks and scroll intact',async()=>{
 const h=await panelHarness({settings:defaultSettings(),panelWidth:360,history:Array.from({length:45},(_,i)=>record(i+1))});try{
  await h.wait();h.click('nav-history');assert.equal(h.el('history-layout').getAttribute('data-history-view'),'list');h.click('history-next');h.click('history-check-all');h.el('history-rows').scrollTop=177;
  h.selectHistory(record(25).id);assert.equal(h.el('history-layout').getAttribute('data-history-view'),'detail');assert.equal(h.el('history-id').value,record(25).id);h.click('history-back');
  assert.equal(h.el('history-layout').getAttribute('data-history-view'),'list');assert.match(h.el('history-page').textContent,/2 \/ 3/);assert.match(h.el('history-selected-count').textContent,/45/);assert.equal(h.el('history-rows').scrollTop,177);assert.equal(h.historySelectedId(),record(25).id);
  assert.deepEqual(h.requests,[]);
 }finally{await h.close();}
});

test('empty history hides detail, pagination and unchecked destructive action',async()=>{
 const h=await panelHarness({settings:defaultSettings(),panelWidth:300});try{await h.wait();h.click('nav-history');assert.equal(h.el('history-detail-pane').style.display,'none');assert.equal(h.el('clear-history').style.display,'none');assert.equal(h.el('history-page').parentElement.style.display,'none');}finally{await h.close();}
});

test('auto-view preference defaults on, validates and survives profile switching',()=>{
 assert.equal(validateSettings(defaultSettings()).autoViewResults,undefined);const value=validateSettings({...defaultSettings(),autoViewResults:false});assert.equal(value.autoViewResults,false);assert.equal(switchConnection(value,'gemini').autoViewResults,false);assert.throws(()=>validateSettings({...defaultSettings(),autoViewResults:'yes'}));
});

test('diagnostic codes and sanitization separate typed causes without leaking credentials or paths',()=>{
 const cases=[['no-document','capture'],['empty-range','capture'],['source-changed','apply'],['unauthorized','connection'],['rate-limited','inference'],['quota-exceeded','inference'],['cancelled','inference'],['unsupported','environment'],['image-budget','capture'],['decode-failed','output'],['host-busy','apply'],['clipboard-failed','connection']] as const;
 for(const [code,stage] of cases)assert.equal(diagnostic(new DiagnosticError(code as any,stage,'specific cause'),stage).code,code);
 const d=diagnostic(new Error('failure C:\\Users\\Private\\secret.png Authorization: Bearer sk-secret https://host.test/a?signature=secret&key=secret'),'output');assert.doesNotMatch(JSON.stringify(d),/sk-secret|signature=secret|Users\\\\Private|key=secret/);assert.match(d.detail,/failure/);
});

test('operation feedback refuses obsolete failures and clears only the matching successful retry',()=>{
 const Feedback=(panelState as any).OperationFeedback;assert.equal(typeof Feedback,'function');const feedback=new Feedback();
 const old=feedback.begin({page:'create',feature:'capture',stage:'capture'}),latest=feedback.begin({page:'create',feature:'capture',stage:'capture'});assert.equal(feedback.fail(old,{}),false);assert.equal(feedback.fail(latest,{title:'capture'}),true);
 const other=feedback.begin({page:'create',feature:'generate',stage:'inference'});feedback.fail(other,{title:'generation'});const retry=feedback.begin({page:'create',feature:'capture',stage:'capture'});feedback.succeed(retry);assert.equal(feedback.forPage('create').diagnostic.title,'generation');assert.equal(feedback.forPage('history'),undefined);
});

test('out-of-order operation cleanup cannot restore an already completed owner',()=>{
 const feedback:any=new panelState.OperationFeedback(),first=feedback.begin({page:'create',feature:'generate',stage:'inference'}),second=feedback.begin({page:'settings',feature:'disclosure',stage:'connection'});
 assert.equal(typeof feedback.finish,'function');feedback.finish(first);assert.equal(feedback.active,second);feedback.finish(second);assert.equal(feedback.active,undefined);
});

test('completion navigation keeps stable UUIDs, defers once and rejects an older manual intent',()=>{
 const navigation=new panelState.ResultNavigation(),old=navigation.begin(),latest=navigation.begin();
 navigation.complete(old,['old']);assert.equal(navigation.take(['old','latest'],true),undefined);
 navigation.complete(latest,['first','second'],'second');assert.equal(navigation.take(['second','first'],false),undefined);assert.equal(navigation.take(['second','first'],true),'second');assert.equal(navigation.take(['second','first'],true),undefined);
 const disabled=navigation.begin();navigation.complete(disabled,['first']);assert.equal(navigation.take(['first'],true,false),undefined);assert.equal(navigation.take(['first'],true,true),undefined);
});

test('a successful diagnostic preview resolves the original capture error without leaving stale selection advice',async()=>{
 const h=await panelHarness({settings:defaultSettings(),selection:{bounds:null as any,mask:new Uint8Array(4)}});try{
  await h.wait();h.click('capture');await h.wait();assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'selection-required');assert.equal(h.el('diagnostic-box').style.display,'block');
  h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array(4).fill(255)});h.click('diagnostic-primary');await h.wait();
  assert.equal(h.el('selection-previews').style.display,'flex');assert.equal(h.el('diagnostic-box').style.display,'none');h.click('tab-t2i');assert.equal(h.el('diagnostic-box').style.display,'none');h.click('tab-local');assert.equal(h.el('diagnostic-box').style.display,'none');
  assert.equal(h.posts.length,0);
 }finally{await h.close();}
});

test('unresolved capture advice appears only for its original mode and document and cannot repair another source',async()=>{
 const h=await panelHarness({settings:defaultSettings(),selection:{bounds:null as any,mask:new Uint8Array(4)}});try{
  await h.wait();h.click('capture');await h.wait();h.click('tab-t2i');assert.equal(h.el('diagnostic-box').style.display,'none');h.click('tab-local');assert.equal(h.el('diagnostic-box').style.display,'block');
  h.switchDocument(22);h.showPanel();await pause();assert.equal(h.el('diagnostic-box').style.display,'none');const reads=h.pixelRequests.length;h.click('diagnostic-primary');await h.wait();assert.equal(h.pixelRequests.length,reads);
  h.switchDocument(11);h.showPanel();await pause();assert.equal(h.el('diagnostic-box').style.display,'block');
 }finally{await h.close();}
});

test('resolved capture clears matching range causes while preserving other sources, newer failures and task errors',()=>{
 const feedback:any=new panelState.OperationFeedback();
 const fail=(feature:string,mode:string,documentId:number,code:string,stage='capture')=>{const op=feedback.begin({page:'create',feature,stage,mode,documentId});feedback.fail(op,{code,stage,title:feature});return op;};
 fail('capture','edit',11,'selection-required');fail('restore-selection','edit',22,'selection-required');fail('protect','background',11,'selection-required');fail('auth','edit',11,'unauthorized','connection');fail('apply','edit',11,'source-changed','apply');
 const repair=feedback.begin({page:'create',feature:'diagnostic-primary',stage:'capture',mode:'edit',documentId:11});
 assert.equal(typeof feedback.resolveCapture,'function');feedback.resolveCapture(repair);assert.equal(feedback.forPage('create',{mode:'edit',documentId:11}).diagnostic.title,'apply');
 assert.equal(feedback.forPage('create',{mode:'edit',documentId:22}).diagnostic.title,'apply','task errors remain available while source-specific range advice is filtered');
 fail('diagnostic-primary','edit',11,'empty-range');feedback.resolveCapture(repair);assert.equal(feedback.forPage('create',{mode:'edit',documentId:11}).diagnostic.title,'diagnostic-primary');
 const other=feedback.begin({page:'create',feature:'restore-selection',stage:'capture',mode:'edit',documentId:33});feedback.succeed(other);
 assert.equal(feedback.forPage('create',{mode:'background',documentId:11}).diagnostic.title,'apply');
 feedback.clearCodes(['unauthorized','source-changed','empty-range']);assert.equal(feedback.forPage('create',{mode:'edit',documentId:22}).diagnostic.title,'restore-selection');assert.equal(feedback.forPage('create',{mode:'background',documentId:11}).diagnostic.title,'protect');assert.equal(feedback.forPage('create',{mode:'edit',documentId:11}),undefined);
});

test('fresh source capture resolves a corrected selection cause from protection capture',()=>{
 const feedback=new panelState.OperationFeedback(),scope={page:'create' as const,stage:'capture' as const,mode:'edit',documentId:11};
 const failed=feedback.begin({...scope,feature:'protect'});feedback.fail(failed,{code:'selection-required',stage:'capture'});const read=feedback.begin({...scope,feature:'capture'});feedback.resolveCapture(read);assert.equal(feedback.forPage('create'),undefined);
});

test('a successful new submission resolves its earlier failure while retaining feedback for other sources',()=>{
 const feedback=new panelState.OperationFeedback(),scope={page:'create' as const,feature:'generate',stage:'inference' as const,mode:'edit',documentId:11};
 const beforeSubmit=feedback.begin(scope);feedback.fail(beforeSubmit,{code:'unknown',stage:'inference'});const retry=feedback.begin(scope);retry.taskId='new-saved-task';feedback.succeed(retry);assert.equal(feedback.forPage('create')?.operation,beforeSubmit,'assigning a UUID is not successful completion');retry.successfulTaskId=retry.taskId;feedback.succeed(retry);assert.equal(feedback.forPage('create'),undefined);
 const failedTask=feedback.begin(scope);failedTask.taskId='failed-task';feedback.fail(failedTask,{code:'invalid-output',stage:'output'});
 const otherSource=feedback.begin({...scope,documentId:22});otherSource.taskId='other-source';otherSource.successfulTaskId=otherSource.taskId;feedback.succeed(otherSource);assert.equal(feedback.forPage('create')?.operation.taskId,'failed-task');
 const separateTask=feedback.begin(scope);separateTask.taskId='different-task';separateTask.successfulTaskId=separateTask.taskId;feedback.succeed(separateTask);assert.equal(feedback.forPage('create'),undefined);
});

for(const code of ['unknown','source-profile','image-budget'])test(`verified capture preserves unrelated reference ${code} failures and newer source failures`,()=>{
 const feedback=new panelState.OperationFeedback(),scope={page:'create' as const,stage:'capture' as const,mode:'relight',documentId:11};
 const failed=feedback.begin({...scope,feature:'open-relight'});feedback.fail(failed,{code:'unknown',stage:'capture'});
 const reference=feedback.begin({...scope,feature:'reference'});feedback.fail(reference,{code,stage:'capture'});
 const retry=feedback.begin({...scope,feature:'diagnostic-primary'});feedback.resolveCapture(retry);
 assert.equal(feedback.forPage('create')?.operation,reference);feedback.succeed(feedback.begin({...scope,feature:'reference'}));assert.equal(feedback.forPage('create'),undefined);
 const stale=feedback.begin({...scope,feature:'open-relight'}),latest=feedback.begin({...scope,feature:'open-relight'});feedback.fail(latest,{code:'unknown',stage:'capture'});feedback.resolveCapture(stale);assert.equal(feedback.forPage('create')?.operation,latest);
 feedback.succeed(latest);assert.equal(feedback.forPage('create')?.operation,latest,'a swallowed failure cannot become its own successful retry');
});

test('a generated tagged copy owns downstream task feedback and a later successful generation resolves it',async()=>{
 const h=await panelHarness({untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)})}});try{
  await h.wait();h.click('nav-create');h.el('resolution').value='32';const original=h.ps.app.activeDocument,originalLayers=JSON.stringify(original.layers);h.setJobStatus('failed');h.click('generate');await h.wait();
  const failed=h.records()[0],copy=h.ps.app.activeDocument;assert.notEqual(copy.id,original.id);assert.equal((failed.snapshot as any).documentId,copy.id);assert.equal(JSON.parse(h.el('diagnostic-details').value).documentId,copy.id);
  h.setJobStatus('ready');h.click('generate');await h.wait();h.click('nav-create');assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.records().find(r=>r.id===failed.id)?.state,'failed');assert.equal((failed.snapshot as any).documentId,copy.id);assert.equal(JSON.stringify(original.layers),originalLayers);assert.equal(original.colorProfileName,'');assert.equal(h.posts.length,2);
 }finally{await h.close();}
});

test('successful generation with a new UUID clears the old visible error while the failed history record remains',async()=>{
 const h=await panelHarness();try{
  await h.wait();h.click('nav-create');h.el('resolution').value='32';h.setJobStatus('failed');h.click('generate');await h.wait();const old=h.records()[0];assert.equal(old.state,'failed');assert.equal(h.el('diagnostic-box').style.display,'block');
  h.setJobStatus('ready');h.click('generate');await h.wait();h.click('nav-create');assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.records().find(r=>r.id===old.id)?.state,'failed');assert.equal(h.records().filter(r=>r.state==='ready').length,1);assert.equal(h.posts.length,2);
 }finally{await h.close();}
});

test('cancelling a retry during backend checks preserves the previous task error without submitting another UUID',async()=>{
 const h=await panelHarness();try{
  await h.wait();h.click('nav-create');h.el('resolution').value='32';h.setJobStatus('failed');h.click('generate');await h.wait();const failed=h.records()[0],diagnostic=JSON.parse(h.el('diagnostic-details').value);assert.equal(failed.state,'failed');
  h.holdCheck();h.click('generate');await pause();h.click('cancel');h.releaseCheck();await h.wait();
  assert.equal(h.posts.length,1);assert.equal(h.records().length,1);assert.equal(h.records()[0].id,failed.id);assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(JSON.parse(h.el('diagnostic-details').value).operationId,diagnostic.operationId);
 }finally{h.releaseCheck();await h.close();}
});

for(const outcome of ['cancelled','ready'] as const)test(`a cancelled retry ending ${outcome} preserves the previous task error after a new UUID was submitted`,async()=>{
 const h=await panelHarness({pollDelayMs:10});try{
  await h.wait();h.click('nav-create');h.el('resolution').value='32';h.setJobStatus('failed');h.click('generate');await h.wait();const failed=h.records()[0],diagnostic=JSON.parse(h.el('diagnostic-details').value);
  h.setJobStatus('running');h.click('generate');for(let n=0;n<100&&h.posts.length<2;n++)await new Promise(r=>setTimeout(r,5));assert.equal(h.posts.length,2);const retry=h.records().find(r=>r.id!==failed.id)!;assert.ok(retry);
  h.setCancelResult(retry.id,true);h.click('cancel');h.setJobStatus(outcome,retry.id);await h.wait();h.click('nav-create');
  assert.equal(h.records().find(r=>r.id===failed.id)?.state,'failed');assert.equal(h.records().find(r=>r.id===retry.id)?.state,outcome);assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(JSON.parse(h.el('diagnostic-details').value).operationId,diagnostic.operationId);assert.equal(h.posts.length,2);
 }finally{await h.close();}
});

test('an explicitly recovered existing task clears its earlier recovery error only after the candidate is saved',async()=>{
 const h=await panelHarness();try{
  await h.wait();h.click('nav-create');h.el('resolution').value='32';h.setJobStatus('failed');h.click('generate');await h.wait();const id=h.records()[0].id;
  h.click('nav-history');h.selectHistory(id);h.click('recover');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(JSON.parse(h.el('diagnostic-details').value).feature,'recover');
  h.setJobStatus('ready',id);h.click('recover');await h.wait();h.click('nav-history');assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.records()[0].state,'ready');assert.equal(h.records()[0].id,id);assert.equal(h.posts.length,1);
 }finally{await h.close();}
});
