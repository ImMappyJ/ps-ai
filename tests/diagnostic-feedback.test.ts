import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationFeedback} from '../src/app/panel-view';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {panelHarness} from './uxp-harness';

const scope={page:'create' as const,feature:'capture',stage:'capture' as const,documentId:11,mode:'edit'};
const report={code:'selection-required',stage:'capture',title:'Select an area'};

test('dismiss removes only the exact report and permits the next failure from the same action',()=>{
  const feedback=new OperationFeedback(),old=feedback.begin(scope);feedback.fail(old,report);
  const other=feedback.begin({...scope,feature:'reference'});feedback.fail(other,{code:'source-profile',stage:'capture'});
  assert.equal(typeof (feedback as any).dismiss,'function');
  assert.equal((feedback as any).dismiss(other),true);assert.equal(feedback.forPage('create')?.operation,old);
  const latest=feedback.begin(scope);feedback.fail(latest,report);
  assert.equal((feedback as any).dismiss(old),false);assert.equal(feedback.forPage('create')?.operation,latest);
  assert.equal((feedback as any).dismiss(latest),true);assert.equal(feedback.forPage('create'),undefined);
  const future=feedback.begin(scope);assert.equal(feedback.fail(future,report),true);assert.equal(feedback.forPage('create')?.operation,future);
});

for(const feature of ['apply','recover','load-history'])test(`${feature} success cannot clear a different task failure`,()=>{
  const feedback=new OperationFeedback(),failed=feedback.begin({...scope,page:'results',feature,stage:'apply',taskId:'failed-task'});feedback.fail(failed,{code:'source-changed',stage:'apply'});
  const unrelated=feedback.begin({...scope,page:'results',feature,stage:'apply',taskId:'other-task',successfulTaskId:'other-task'});feedback.succeed(unrelated);
  assert.equal(feedback.forPage('results')?.operation,failed);
  const retry=feedback.begin({...scope,page:'results',feature,stage:'apply',taskId:'failed-task',successfulTaskId:'failed-task'});feedback.succeed(retry);assert.equal(feedback.forPage('results'),undefined);
});

test('a skipped action and an older completion preserve a newer error',()=>{
  const feedback=new OperationFeedback(),failed=feedback.begin({...scope,feature:'reference'});feedback.fail(failed,report);
  const skipped=feedback.begin({...scope,feature:'reference'});(skipped as any).skipped=true;feedback.succeed(skipped);assert.equal(feedback.forPage('create')?.operation,failed);
  const retry=feedback.begin({...scope,feature:'reference'}),newer=feedback.begin({...scope,feature:'reference'});feedback.fail(newer,report);feedback.succeed(retry);assert.equal(feedback.forPage('create')?.operation,newer);
});

test('verified connection resolves setup connection advice only for the same context and never a newer report',()=>{
  const feedback=new OperationFeedback(),settings={...scope,page:'settings' as const,stage:'connection' as const,connection:'comfyui'};
  const failed=feedback.begin({...settings,feature:'setup-connect'});feedback.fail(failed,{code:'unreachable',stage:'connection'});
  for(const change of [{page:'create' as const},{documentId:22},{mode:'background'},{connection:'openai'}])feedback.succeed(feedback.begin({...settings,feature:'connect',...change}));
  assert.equal(feedback.forPage('settings')?.operation,failed);
  const retry=feedback.begin({...settings,feature:'connect'});feedback.succeed(retry);assert.equal(feedback.forPage('settings'),undefined);
  const older=feedback.begin({...settings,feature:'setup-check'}),newer=feedback.begin({...settings,feature:'setup-connect'});feedback.fail(newer,{code:'unreachable',stage:'connection'});feedback.succeed(older);assert.equal(feedback.forPage('settings')?.operation,newer);
});

test('closing a diagnostic stays closed across navigation without deleting history or pending notices',async()=>{
  const pending={id:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222',state:'unknown',createdAt:'2026-11-01T00:00:00Z',graph:{},baseUrl:'http://localhost:8188',params:{workspace:'t2i',mode:'generate'}};
  const h=await panelHarness({settings:defaultSettings(),history:[pending]});try{
    await h.wait();h.el('backend-url').value='http://offline.invalid:9999';h.click('connect');await h.wait();
    assert.equal(h.el('diagnostic-box').style.display,'block');assert.ok(h.el('dismiss-diagnostic'),'an error has an explicit close control');
    const before=JSON.stringify(h.records()),requests=h.requests.length;h.click('dismiss-diagnostic');await h.wait();
    assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(JSON.stringify(h.records()),before);assert.equal(h.requests.length,requests);assert.notEqual(h.el('pending-notice').style.display,'none');
    h.click('nav-create');h.click('nav-settings');assert.equal(h.el('diagnostic-box').style.display,'none');
    h.click('connect');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');
    h.el('language').value='en-US';h.change('language');await h.wait();assert.equal(h.el('dismiss-diagnostic').textContent,'Dismiss error');
  }finally{await h.close();}
});

test('successful full connection clears the failed setup connection report permanently',async()=>{
  const h=await panelHarness({settings:defaultSettings()});try{
    await h.wait();h.click('open-setup');await h.wait();h.el('backend-url').value='http://offline.invalid:9999';h.click('setup-connect');await h.wait();
    assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(JSON.parse(h.el('diagnostic-details').value).feature,'setup-connect');
    h.el('backend-url').value='http://localhost:8188';h.click('connect');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'none');
    h.click('nav-create');h.click('nav-settings');assert.equal(h.el('diagnostic-box').style.display,'none');
  }finally{await h.close();}
});

test('successful generation resolves an earlier capture error while retaining task history',async()=>{
  const h=await panelHarness({settings:defaultSettings(),selection:{bounds:null as any,mask:new Uint8Array(4)}});try{
    await h.wait();h.click('capture');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array(4).fill(255)});h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.records().length,1);assert.equal(h.records()[0].state,'ready');h.click('nav-create');assert.equal(h.el('diagnostic-box').style.display,'none');
  }finally{await h.close();}
});

test('cancelling the reference picker preserves its previous actionable error',async()=>{
  const h=await panelHarness({settings:defaultSettings()});try{
    await h.wait();(h.uxp.storage.localFileSystem as any).getFileForOpening=async()=>{throw new Error('Reference file unavailable');};h.click('reference');await h.wait();
    const before=JSON.parse(h.el('diagnostic-details').value);assert.equal(h.el('diagnostic-box').style.display,'block');
    (h.uxp.storage.localFileSystem as any).getFileForOpening=async()=>null;h.click('reference');await h.wait();
    assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(JSON.parse(h.el('diagnostic-details').value).operationId,before.operationId);
  }finally{await h.close();}
});
