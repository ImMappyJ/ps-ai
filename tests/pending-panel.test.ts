import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import type {JobRecord} from '../src/generation/jobs';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const record=(id:string,state='unknown',extra:Partial<JobRecord>={}):JobRecord=>({id,clientId:C,state,graph:{},createdAt:'2026-10-17T09:15:00.000Z',baseUrl:'http://localhost:8188',template:'qwen21-local-v2-rgba',params:{workspace:'t2i',mode:'generate',outputKind:'t2i'},...extra});
type Harness=Awaited<ReturnType<typeof panelHarness>>;
const select=(h:Harness,id:string)=>{h.selectHistory(id);};
const queried=(h:Harness)=>h.requests.filter(r=>/\/history\/|\/psai\/v1\/jobs\/[^/]+$/.test(r.url)).map(r=>r.url.split('/').pop());
const noResubmit=(h:Harness)=>{assert.equal(h.posts.length+h.gatewayPosts.length,0);assert.equal(h.requests.some(r=>r.url.includes('/interrupt')),false);};
const pause=()=>new Promise(r=>setTimeout(r,35));

test('startup selects an older pending record and keeps its notice through connection errors and settings messages',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),baseUrl:'http://offline.invalid:9999'},history:[record(B,'ready'),record(A,'unknown',{snapshot:{documentId:17},sourceName:'Private source.psd'})]});
  try{await h.wait();assert.equal(h.historySelectedId(),A);assert.notEqual(h.el('pending-notice')?.style.display,'none');
    assert.match(h.el('pending-summary').textContent,/1/);assert.equal(h.el('history-id').value,A);
    assert.match(h.el('history-details').textContent,/http:\/\/localhost:8188/);assert.match(h.el('history-details').textContent,/17.*Private source.psd/);
    assert.match(h.el('history-details').textContent,/2026-10-17/);assert.match(h.el('history-details').textContent,/unknown/);
    h.click('save-settings');await h.wait();assert.notEqual(h.el('pending-notice').style.display,'none');
    assert.doesNotMatch(String(h.files['runtime-trace.json']),/Private source|blue lightning/);noResubmit(h);
  }finally{await h.close();}
});

test('a generation block reveals and selects the exact pending UUID before recovery',async()=>{
  const h=await panelHarness({history:[record(B,'ready'),record(A)]});
  try{await h.wait();select(h,B);h.click('tab-t2i');h.click('generate');await h.wait();
    assert.equal(h.historySelectedId(),A);assert.notEqual(h.el('view-history').style.display,'none');
    assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'pending-task');
    h.click('recover');await h.wait();assert.deepEqual(queried(h),[A]);assert.equal(h.records().find(r=>r.id===A)?.state,'ready');
    assert.equal(h.el('pending-notice').style.display,'none');assert.equal(h.records().find(r=>r.id===B)?.state,'ready');noResubmit(h);
  }finally{await h.close();}
});

test('all pending UUIDs are discoverable and idle cancellation follows the visible selection',async()=>{
  const h=await panelHarness({history:[record(C,'ready'),record(A),record(B,'queued')]});
  try{await h.wait();assert.match(h.el('pending-summary').textContent,/2/);h.click('open-pending');await h.wait();assert.equal(h.historySelectedId(),A);
    h.click('next-pending');await h.wait();assert.equal(h.historySelectedId(),B);h.click('cancel');await h.wait();
    assert.deepEqual(h.requests.filter(r=>r.url.endsWith('/cancel')).map(r=>r.url),[`http://localhost:8188/api/jobs/${B}/cancel`]);
    assert.deepEqual(queried(h),[B]);assert.equal(h.records().find(r=>r.id===A)?.state,'unknown');assert.equal(h.records().find(r=>r.id===B)?.state,'ready');
    assert.match(h.el('pending-summary').textContent,/1/);select(h,C);assert.equal(h.el('cancel').disabled,true);noResubmit(h);
  }finally{await h.close();}
});

test('recovery and cancellation never send the selected historical UUID to a different origin or backend type',async()=>{
  for(const settings of [{...defaultSettings(),baseUrl:'http://localhost:8199'},{...defaultSettings(),backend:'gateway' as const,gatewayModel:'qwen-image-2.1-pro'}]){
    const h=await panelHarness({settings,history:[record(A)]});try{await h.wait();h.click('recover');await h.wait();h.click('cancel');await h.wait();
      assert.deepEqual(queried(h),[]);assert.equal(h.requests.filter(r=>r.url.endsWith('/cancel')).length,0);assert.equal(h.records()[0].state,'unknown');
      assert.match(h.el('history-details').textContent,/ComfyUI.*localhost:8188/);assert.equal(h.el('history-id').value,A);
      assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'pending-backend');noResubmit(h);
    }finally{await h.close();}
  }
});

test('unknown stop tracking requires two clicks, persists all data, and later recovery queries only the original UUID',async()=>{
  const original=record(A,'unknown',{userPrompt:'private instructions',outputs:[{filename:'saved.png'}],customSavedData:{keep:true}});
  const h=await panelHarness({history:[original]});let detached:JobRecord[]=[];
  try{await h.wait();h.click('stop-tracking');await h.wait();assert.equal(h.records()[0].tracking,undefined);
    assert.match(h.el('detach-warning').textContent,new RegExp(A));assert.match(h.el('detach-warning').textContent,/计费/);
    h.click('confirm-stop-tracking');await h.wait();detached=h.records();assert.deepEqual(detached[0],{...original,tracking:'detached'});
    assert.equal(h.el('pending-notice').style.display,'none');assert.equal(h.el('cancel').disabled,true);noResubmit(h);
  }finally{await h.close();}
  const reload=await panelHarness({history:detached});try{await reload.wait();assert.equal(reload.el('pending-notice').style.display,'none');assert.match(reload.el('history-details').textContent,/停止跟踪/);
    reload.click('recover');await reload.wait();assert.deepEqual(queried(reload),[A]);assert.equal(reload.records()[0].tracking,undefined);assert.equal(reload.records()[0].state,'ready');
    assert.equal(reload.records()[0].userPrompt,original.userPrompt);assert.deepEqual(reload.records()[0].customSavedData,{keep:true});noResubmit(reload);
  }finally{await reload.close();}
});

test('detaching one unknown record leaves other pending records blocking, and only an explicit new generation creates a new ID',async()=>{
  const h=await panelHarness({history:[record(A),record(B)]});try{await h.wait();h.click('stop-tracking');await h.wait();h.click('confirm-stop-tracking');await h.wait();
    h.click('tab-t2i');h.click('generate');await h.wait();assert.equal(h.historySelectedId(),B);noResubmit(h);
    h.click('stop-tracking');await h.wait();h.click('confirm-stop-tracking');await h.wait();h.click('tab-t2i');h.click('generate');await h.wait();
    assert.equal(h.posts.length,1);assert.notEqual(h.posts[0].prompt_id,A);assert.notEqual(h.posts[0].prompt_id,B);
    for(const id of [A,B]){const saved=h.records().find(r=>r.id===id)!;assert.equal(saved.state,'unknown');assert.equal(saved.tracking,'detached');}
  }finally{await h.close();}
});

test('stop-tracking acknowledgement cannot survive selection changes, a refresh, retry, or a changed remote state',async()=>{
  const h=await panelHarness({history:[record(A),record(B)],pollDelayMs:1});try{await h.wait();h.click('stop-tracking');await h.wait();select(h,B);h.click('confirm-stop-tracking');await h.wait();assert.ok(h.records().every(r=>r.tracking===undefined));
    select(h,A);h.click('stop-tracking');await h.wait();h.click('open-pending');await h.wait();h.click('confirm-stop-tracking');await h.wait();assert.ok(h.records().every(r=>r.tracking===undefined));
    h.click('stop-tracking');await h.wait();h.setJobStatus('unknown',A);h.click('recover');await h.wait();h.click('confirm-stop-tracking');await h.wait();assert.equal(h.records()[0].tracking,undefined);
    h.click('stop-tracking');await h.wait();const changed=h.records();changed[0].state='running';h.files['history.json']=JSON.stringify(changed);h.click('confirm-stop-tracking');await h.wait();assert.equal(h.records()[0].state,'running');assert.equal(h.records()[0].tracking,undefined);noResubmit(h);
  }finally{await h.close();}
});

test('busy row attempts cannot change the UUID of an acknowledged stop-tracking action while history loads',async()=>{
  const h=await panelHarness({history:[record(A),record(B)]});try{await h.wait();h.click('stop-tracking');await h.wait();
    h.holdHistory();h.click('confirm-stop-tracking');await pause();select(h,B);select(h,A);assert.equal(h.historySelectedId(),A);h.releaseHistory();await h.wait();
    assert.equal(h.records().find(r=>r.id===A)?.tracking,'detached');assert.equal(h.records().find(r=>r.id===B)?.tracking,undefined);noResubmit(h);
  }finally{h.releaseHistory();await h.close();}
});

test('repeated unknown or connection failures unlock recovery as unknown without inventing a terminal state',async()=>{
  for(const response of ['unknown',new TypeError('fetch failed')] as const){
    const h=await panelHarness({history:[record(A,'queued')],pollDelayMs:1});try{await h.wait();h.setJobStatus(response,A);h.click('recover');await h.wait();
      assert.equal(h.records()[0].state,'unknown');assert.equal(h.el('history-refresh').disabled,false);assert.equal(h.el('stop-tracking').disabled,false);
      assert.equal(queried(h).length,15);assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'pending-task');noResubmit(h);
    }finally{h.setJobStatus('ready',A);await h.close();}
  }
});

test('queued and running replies reset consecutive recovery failures and keep polling the same task',async()=>{
  const h=await panelHarness({history:[record(A)],pollDelayMs:1});try{await h.wait();
    h.setJobStatusSequence(A,[...Array.from({length:14},()=>new TypeError('fetch failed')),'queued',...Array.from({length:14},()=>'unknown' as const),'running','ready']);
    h.click('recover');await h.wait();assert.equal(h.records()[0].state,'ready');assert.equal(queried(h).length,31);assert.ok(queried(h).every(id=>id===A));assert.equal(h.el('pending-notice').style.display,'none');noResubmit(h);
  }finally{h.setJobStatus('ready',A);await h.close();}
});

test('confirmed failed and cancelled replies clear the pending notice without detaching or resubmitting',async()=>{
  for(const state of ['failed','cancelled'] as const){const h=await panelHarness({history:[record(A)],pollDelayMs:1});try{await h.wait();h.setJobStatus(state,A);h.click('recover');await h.wait();
    assert.equal(h.records()[0].state,state);assert.equal(h.records()[0].tracking,undefined);assert.equal(h.el('pending-notice').style.display,'none');assert.equal(h.el('stop-tracking').style.display,'none');noResubmit(h);
  }finally{await h.close();}}
});

test('recovery and idle cancellation freeze the selected UUID before awaiting private history',async()=>{
  for(const action of ['recover','cancel']){const h=await panelHarness({history:[record(A),record(B)]});try{await h.wait();h.holdHistory();h.click(action);await pause();h.selectHistory(B);h.releaseHistory();await h.wait();
    assert.deepEqual(queried(h),[A]);assert.equal(h.el('history-id').value,A);assert.equal(h.records().find(r=>r.id===B)?.state,'unknown');
    if(action==='cancel')assert.ok(h.requests.filter(r=>r.url.endsWith('/cancel')).every(r=>r.url.includes(A)));noResubmit(h);
  }finally{h.releaseHistory();await h.close();}}
});

test('new submissions select their persisted UUID while polling and keep source names in private history only',async()=>{
  const h=await panelHarness({history:[record(B,'ready')],pollDelayMs:1});try{await h.wait();h.ps.app.activeDocument.name='Private generated source.psd';h.el('resolution').value='32';h.setJobStatus('running');h.click('generate');await pause();
    const id=h.posts[0].prompt_id;assert.equal(h.historySelectedId(),id);assert.ok(h.historyRows().some(node=>node.getAttribute('data-history-id')===id));assert.equal(h.el('history-id').value,id);
    h.setJobStatus('ready');await h.wait();assert.equal(h.records().find(r=>r.id===id)?.sourceName,'Private generated source.psd');assert.doesNotMatch(String(h.files['runtime-trace.json']),/Private generated source|blue lightning/);
  }finally{h.setJobStatus('ready');await h.close();}
});

test('gateway cancellation errors keep an unknown recoverable record and a usable unlocked UI',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),backend:'gateway',gatewayModel:'qwen-image-2.1-pro'},history:[record(A,'running',{backend:'gateway'})]});
  try{await h.wait();h.setCancelResult(A,new TypeError('fetch failed'));h.click('cancel');await h.wait();
    assert.equal(h.records()[0].state,'unknown');assert.equal(h.el('history-id').value,A);assert.equal(h.el('history-refresh').disabled,false);assert.equal(h.el('recover').disabled,false);assert.equal(h.el('stop-tracking').disabled,false);assert.notEqual(h.el('pending-notice').style.display,'none');
    h.click('recover');await h.wait();assert.deepEqual(queried(h),[A]);assert.equal(h.records()[0].state,'ready');noResubmit(h);
  }finally{await h.close();}
});

test('busy cancellation stays bound to the active query while another history row is clicked',async()=>{
  const h=await panelHarness({history:[record(A),record(B)],pollDelayMs:1});try{await h.wait();h.setJobStatus('running',A);h.setJobStatus('unknown',B);h.click('recover');await pause();
    assert.equal(h.el('history-refresh').disabled,true);h.selectHistory(B);h.click('cancel');await pause();h.setJobStatus('ready',A);await h.wait();
    assert.ok(h.requests.filter(r=>r.url.endsWith('/cancel')).length>0);assert.ok(h.requests.filter(r=>r.url.endsWith('/cancel')).every(r=>r.url.includes(A)));
    assert.ok(queried(h).every(id=>id===A));assert.equal(h.records().find(r=>r.id===B)?.state,'unknown');noResubmit(h);
  }finally{h.setJobStatus('ready',A);await h.close();}
});

test('the workbench hands pending history back to the panel and reopens with the edited lighting and frozen source',async()=>{
  const h=await panelHarness({history:[record(A)]});try{await h.wait();h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.click('open-relight');await pause();
    h.el('relight-intensity').value='2.5';h.change('relight-intensity');const reads=h.captured.length,source=h.el('relight-source').textContent;
    assert.notEqual(h.el('relight-pending-tasks')?.style.display,'none');h.click('relight-pending-tasks');await pause();await h.wait();
    assert.equal(h.el('relight-dialog').hasAttribute('open'),false);assert.notEqual(h.el('view-history').style.display,'none');assert.equal(h.historySelectedId(),A);
    h.click('open-relight');await pause();assert.equal(h.el('relight-intensity').value,'2.5');assert.equal(h.el('relight-source').textContent,source);assert.equal(h.captured.length,reads);noResubmit(h);
  }finally{await h.close();}
});

test('pending UI and stop-tracking warnings translate without rewriting prompts or private source identity',async()=>{
  const h=await panelHarness({history:[record(A,'unknown',{sourceName:'私有原图.psd',userPrompt:'保留原文'})]});try{await h.wait();h.el('language').value='en-US';h.change('language');await h.wait();
    assert.match(h.el('pending-summary').textContent,/unresolved/i);assert.equal(h.el('open-pending').textContent,'Handle pending tasks');assert.equal(h.el('stop-tracking').textContent,'Stop tracking locally');
    h.click('stop-tracking');await h.wait();assert.match(h.el('detach-warning').textContent,/does not cancel.*billing/i);assert.match(h.el('detach-warning').textContent,/duplicate/i);assert.doesNotMatch(h.el('detach-warning').textContent,/[一-龥]/);
    assert.equal(h.records()[0].userPrompt,'保留原文');assert.equal(h.records()[0].sourceName,'私有原图.psd');noResubmit(h);
  }finally{await h.close();}
});
