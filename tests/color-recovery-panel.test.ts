import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {encodePng} from '../src/imaging/image';

type Harness=Awaited<ReturnType<typeof panelHarness>>;
const bytes=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)});
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
const details=(h:Harness)=>JSON.parse(h.el('diagnostic-details').value);

// Extend the native document boundary, keeping the real panel and adapter.
// Each duplicate has its own scalar preassignment history/profile identity.
function colorHistory(h:Harness){
  const docs=h.ps.app.documents as any[],origins=new Map<number,any>(),duplicates:number[]=[];
  let serial=21,failAssignment=false,cancelled=false;
  h.ps.constants.ColorProfileType={NONE:'none'};
  const modal=h.ps.core.executeAsModal;
  h.ps.core.executeAsModal=(fn:any,options:any)=>modal((context:any)=>fn({...context,get isCancelled(){return cancelled;}}),options);
  const install=(doc:any)=>{
    let profile=doc.colorProfileName;
    doc.colorProfileType=profile?'custom':'none';
    Object.defineProperty(doc,'colorProfileName',{configurable:true,get:()=>profile,set:(value:string)=>{if(failAssignment)throw Error('assignment failed');profile=value;doc.colorProfileType=value?'custom':'none';}});
    doc.duplicate=async()=>{
      assert.equal(h.el('relight-dialog').hasAttribute('open'),false,'native recovery must close the workbench first');
      const copy={...doc,id:++serial,path:undefined,saved:false,activeHistoryState:{id:1},layers:doc.layers.map((layer:any)=>({...layer,id:serial*100+layer.id}))};
      install(copy);docs.push(copy);h.ps.app.activeDocument=copy;duplicates.push(doc.id);
      origins.set(copy.id,{profile:copy.colorProfileName,type:copy.colorProfileType,history:copy.activeHistoryState.id});
      return copy;
    };
    doc.closeWithoutSaving=async()=>{docs.splice(docs.indexOf(doc),1);};
  };
  install(docs[0]);
  return {docs,duplicates,undo:(doc=h.ps.app.activeDocument)=>{const origin=origins.get(doc.id);assert.ok(origin);doc.colorProfileName=origin.profile;doc.colorProfileType=origin.type;doc.activeHistoryState={id:origin.history};},failAssignment:(value:boolean)=>{failAssignment=value;},cancel:(value:boolean)=>{cancelled=value;}};
}
async function harness(){const h=await panelHarness({untaggedSource:{bytes}});await h.wait();return {h,native:colorHistory(h)};}
async function profileFailure(h:Harness,native:ReturnType<typeof colorHistory>,generate=false){
  if(generate){h.el('resolution').value='32';h.click('generate');}else h.click('capture');await h.wait();if(generate)await pause();
  const old=h.ps.app.activeDocument;native.undo(old);h.click('nav-create');h.click('capture');await h.wait();
  assert.equal(details(h).code,'source-profile');return old;
}
async function openRelight(h:Harness){h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');await pause();}
async function draft(h:Harness){h.click('relight-save');await pause();return JSON.parse(String(h.files['relight-draft.json'])).scene;}

test('profile recovery explicitly captures a new copy with protection and leaves old candidates exportable and bound to their old source',async()=>{
  const {h,native}=await harness();try{
    h.setSelection({bounds:{left:1,top:1,right:2,bottom:2},mask:new Uint8Array([0,0,0,128])});h.click('protect');await h.wait();
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,255,255])});
    const old=await profileFailure(h,native,true),record=h.records()[0],requests=h.posts.length,access=h.sourceAccessEvents.length;
    assert.notEqual(h.el('diagnostic-primary').style.display,'none');assert.match(h.el('diagnostic-primary').textContent,/恢复色彩副本/);
    h.click('diagnostic-primary');await h.wait();const fresh=h.ps.app.activeDocument;
    assert.notEqual(fresh.id,old.id,JSON.stringify({diagnostic:details(h),duplicates:native.duplicates,docs:native.docs.map(d=>d.id)}));assert.equal(old.colorProfileType,'none');assert.equal(fresh.colorProfileType,'custom');
    assert.match(h.el('source-info').textContent,new RegExp(`文档 ${fresh.id}`));assert.match(h.el('source-info').textContent,/工作副本/);assert.equal(h.el('selection-previews').style.display,'flex');
    assert.equal(h.posts.length,requests);assert.equal(h.uploads.length,2);assert.equal(h.sourceAccessEvents.length,access);
    assert.equal((record.snapshot as any).documentId,old.id);h.click('nav-results');assert.equal(h.el('export').disabled,false);h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.equal(details(h).documentId,old.id);
    h.click('export');await h.wait();assert.ok(h.files[`ps-ai-${record.id.slice(0,8)}.png`]);
    h.click('nav-create');h.click('generate');await h.wait();const next=h.records().find(r=>r.id!==record.id)!;
    assert.equal((next.snapshot as any).documentId,fresh.id);assert.deepEqual([...h.files[next.id+'-mask.bin'] as Uint8Array],[255,128,255,127]);
  }finally{await h.close();}
});

test('a current valid ICC after a profile failure rereads without creating another copy or asking for a file',async()=>{
  const {h,native}=await harness();try{
    const old=await profileFailure(h,native),access=h.sourceAccessEvents.length;old.colorProfileName='Adobe RGB (1998)';
    h.click('diagnostic-primary');await h.wait();assert.equal(native.duplicates.length,1);assert.equal(h.ps.app.activeDocument.id,old.id);assert.equal(h.sourceAccessEvents.length,access);assert.equal(h.el('selection-previews').style.display,'flex');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('unproven pathless sources and a new panel session never offer color recovery',async()=>{
  const {h,native}=await harness();try{
    const doc=native.docs[0];doc.path=undefined;h.click('capture');await h.wait();assert.equal(details(h).code,'source-profile');assert.equal(h.el('diagnostic-primary').style.display,'none');assert.equal(native.duplicates.length,0);assert.equal(h.sourceAccessEvents.length,0);
  }finally{await h.close();}
});

test('a stale diagnostic recovery click after an active document switch cannot recover the new active source',async()=>{
  const {h,native}=await harness();try{
    const old=await profileFailure(h,native),original=native.docs[0];h.ps.app.activeDocument=original;h.click('diagnostic-primary');await h.wait();
    assert.equal(native.duplicates.length,1);assert.equal(h.ps.app.activeDocument.id,original.id);assert.equal(old.colorProfileType,'none');assert.match(h.el('status').textContent,/切换|changed|switch/i);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('cancelled or failed explicit recovery keeps the old source and allows a later deliberate retry',async()=>{
  for(const kind of ['cancel','assignment']){const {h,native}=await harness();try{
    const old=await profileFailure(h,native);if(kind==='cancel')native.cancel(true);else native.failAssignment(true);
    h.click('diagnostic-primary');await h.wait();assert.equal(native.docs.length,2);assert.equal(h.ps.app.activeDocument.id,old.id);assert.equal(old.colorProfileType,'none');assert.equal(h.posts.length,0);
    native.cancel(false);native.failAssignment(false);assert.notEqual(h.el('diagnostic-primary').style.display,'none');h.click('diagnostic-primary');await h.wait();assert.notEqual(h.ps.app.activeDocument.id,old.id);assert.equal(h.el('selection-previews').style.display,'flex');
  }finally{await h.close();}}
});

test('failed fresh capture keeps the recovered copy and exposes a reread retry without another duplicate or file picker',async()=>{
  const {h,native}=await harness();try{
    await profileFailure(h,native);const read=h.ps.imaging.getPixels,access=h.sourceAccessEvents.length;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};
    h.click('diagnostic-primary');await h.wait();const fresh=h.ps.app.activeDocument;assert.equal(native.docs.length,3);assert.equal(fresh.colorProfileType,'custom');assert.equal(h.el('selection-previews').style.display,'none');assert.match(h.el('diagnostic-primary').textContent,/重试读取/);
    h.ps.imaging.getPixels=read;h.click('diagnostic-primary');await h.wait();assert.equal(h.ps.app.activeDocument.id,fresh.id);assert.equal(native.duplicates.length,2);assert.equal(h.sourceAccessEvents.length,access);assert.equal(h.el('selection-previews').style.display,'flex');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('workbench color recovery closes its dialog, binds the known source and preserves lighting and scope without generating',async()=>{
  const {h,native}=await harness();try{
    h.el('relight-scope').value='document';await openRelight(h);h.el('relight-intensity').value='2.6';h.change('relight-intensity');const before=await draft(h),old=h.ps.app.activeDocument;
    h.click('relight-close');await pause();native.undo(old);h.ps.app.activeDocument=native.docs[0];h.click('open-relight');await pause();
    assert.notEqual(h.el('relight-recover-color')?.style.display,'none');h.click('relight-recover-color');await pause();
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);const after=await draft(h);
    assert.notEqual(after.source.documentId,old.id);assert.notEqual(after.source.snapshotId,before.source.snapshotId);assert.equal(after.lights[0].intensity,2.6);assert.match(h.el('relight-source').textContent,/整张图像/);assert.match(h.el('relight-source').textContent,new RegExp(`工作副本，原文档 ${old.id}`));assert.equal(h.el('relight-generate').disabled,false);assert.equal(old.colorProfileType,'none');assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.sourceAccessEvents.filter(v=>v==='picker').length,1);
  }finally{await h.close();}
});

test('failed workbench recovery capture retains its old session and lighting, then retries the retained new copy',async()=>{
  const {h,native}=await harness();try{
    await openRelight(h);h.el('relight-intensity').value='3.1';h.change('relight-intensity');const before=await draft(h),old=h.ps.app.activeDocument;h.click('relight-close');await pause();native.undo(old);h.click('open-relight');await pause();
    const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('relight-recover-color');await pause();const retained=await draft(h),fresh=h.ps.app.activeDocument;
    assert.equal(retained.source.snapshotId,before.source.snapshotId);assert.equal(retained.source.documentId,old.id);assert.equal(retained.lights[0].intensity,3.1);assert.equal(h.el('relight-generate').disabled,true);assert.match(h.el('relight-recover-color').textContent,/重试读取/);assert.equal(native.docs.length,3);
    h.ps.imaging.getPixels=read;h.click('relight-recover-color');await pause();const after=await draft(h);assert.equal(after.source.documentId,fresh.id);assert.equal(after.lights[0].intensity,3.1);assert.equal(native.duplicates.length,2);assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('retained-copy retry rechecks geometry and current ICC without creating a replacement copy',async()=>{
  for(const mutation of ['geometry','profile']){const {h,native}=await harness();try{
    await profileFailure(h,native);const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('diagnostic-primary');await h.wait();const copy=h.ps.app.activeDocument;h.ps.imaging.getPixels=read;
    if(mutation==='geometry')copy.width++;else native.undo(copy);
    const reads=h.pixelRequests.length;h.click('diagnostic-primary');await h.wait();assert.equal(native.duplicates.length,2);assert.equal(h.pixelRequests.length,reads);assert.equal(h.el('selection-previews').style.display,'none');assert.equal(h.posts.length,0);
  }finally{await h.close();}}
});

test('a retained recovered copy with a new valid ICC uses its current profile rather than an old sRGB caption',async()=>{
  const {h,native}=await harness();try{
    await profileFailure(h,native);const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('diagnostic-primary');await h.wait();const copy=h.ps.app.activeDocument;copy.colorProfileName='Adobe RGB (1998)';h.ps.imaging.getPixels=read;
    h.click('diagnostic-primary');await h.wait();assert.match(h.el('source-info').textContent,/Adobe RGB/);assert.equal(h.ps.app.activeDocument.id,copy.id);assert.equal(copy.colorProfileName,'Adobe RGB (1998)');assert.equal(native.duplicates.length,2);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('workbench retry checks the retained scope before binding its recovered copy',async()=>{
  const {h,native}=await harness();try{
    await openRelight(h);const before=await draft(h);h.click('relight-close');await pause();native.undo();h.click('open-relight');await pause();
    const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('relight-recover-color');await pause();h.ps.imaging.getPixels=read;
    h.el('relight-scope').value='document';const reads=h.pixelRequests.length;h.click('relight-recover-color');await pause();assert.equal((await draft(h)).source.snapshotId,before.source.snapshotId);assert.equal(h.pixelRequests.length,reads);assert.equal(native.duplicates.length,2);assert.equal(h.el('relight-generate').disabled,true);
    h.el('relight-scope').value='selection';h.click('relight-recover-color');await pause();assert.notEqual((await draft(h)).source.snapshotId,before.source.snapshotId);assert.equal(native.duplicates.length,2);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('color recovery controls and retained-copy failure guidance remain usable in English',async()=>{
  const {h,native}=await harness();try{
    await profileFailure(h,native);h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('diagnostic-primary').textContent,/color-recovered copy/);assert.doesNotMatch(h.el('diagnostic-action').textContent,/[一-龥]/);
    const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('diagnostic-primary');await h.wait();assert.match(h.el('diagnostic-primary').textContent,/Retry reading/);assert.doesNotMatch(h.el('diagnostic-summary').textContent,/[一-龥]/);h.ps.imaging.getPixels=read;
    h.click('diagnostic-primary');await h.wait();assert.equal(native.duplicates.length,2);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('workbench recovery retains an old result for read-only source inspection and exact export',async()=>{
  const {h,native}=await harness();try{
    await openRelight(h);h.el('relight-output').value='full-result';h.change('relight-output');h.click('relight-reread');await pause();h.el('relight-intensity').value='2.8';h.change('relight-intensity');h.click('relight-generate');await h.wait();await pause();const record=h.records()[0],old=h.ps.app.activeDocument;
    h.click('relight-close');await pause();native.undo(old);h.click('open-relight');await pause();h.click('relight-recover-color');await pause();assert.equal(h.el('relight-result-list').querySelectorAll('button').length,1);assert.equal(h.el('relight-output').value,'full-result');
    const result=h.el('relight-result-list').querySelector('button');result.id='retained-color-result';h.click('retained-color-result');assert.match(h.el('relight-apply').textContent,/检查来源/);h.click('relight-apply');await pause();assert.equal(h.appliedLayers.length,0);assert.equal(details(h).documentId,old.id);assert.equal(details(h).taskId,record.id);
    h.click('relight-export');await pause();assert.deepEqual(h.files[`ps-ai-${record.id.slice(0,8)}.png`],h.files[record.outputFile as string]);assert.equal(h.posts.length,1);assert.equal(native.duplicates.length,2);
  }finally{await h.close();}
});

test('selection-scope workbench recovery transfers feathered protection to only the new source snapshot',async()=>{
  const {h,native}=await harness();try{
    h.setSelection({bounds:{left:0,top:0,right:1,bottom:1},mask:new Uint8Array([64,0,0,0])});h.click('protect');await h.wait();h.setSelection({bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([255,128,0,0])});
    await openRelight(h);const old=h.ps.app.activeDocument;h.click('relight-close');await pause();native.undo(old);h.click('open-relight');await pause();h.click('relight-recover-color');await pause();const copy=h.ps.app.activeDocument;
    assert.notEqual(copy.id,old.id);assert.match(h.el('relight-source').textContent,/当前选区/);assert.equal(h.posts.length,0);
    h.el('relight-output').value='full-result';h.change('relight-output');h.click('relight-reread');await pause();h.click('relight-generate');await h.wait();await pause();const record=h.records()[0];
    assert.equal((record.snapshot as any).documentId,copy.id);assert.deepEqual([...h.files[record.id+'-mask.bin'] as Uint8Array],[191,128,0,0]);assert.equal(native.duplicates.length,2);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('cancelled workbench recovery diagnoses its known source even when another document is active',async()=>{
  const {h,native}=await harness();try{
    await openRelight(h);const old=h.ps.app.activeDocument;h.click('relight-close');await pause();native.undo(old);h.ps.app.activeDocument=native.docs[0];h.click('open-relight');await pause();native.cancel(true);h.click('relight-recover-color');await pause();
    assert.equal(details(h).documentId,old.id);assert.equal(h.ps.app.activeDocument.id,native.docs[0].id);assert.equal(native.duplicates.length,1);assert.notEqual(h.el('relight-recover-color').style.display,'none');native.cancel(false);h.click('relight-recover-color');await pause();assert.notEqual((await draft(h)).source.documentId,old.id);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('a new busy operation during workbench close cannot turn a skipped recovery into a success',async()=>{
  const {h,native}=await harness();try{
    await openRelight(h);h.click('relight-close');await pause();native.undo();h.click('open-relight');await pause();
    h.click('relight-recover-color');h.click('capture');await pause();assert.equal(native.duplicates.length,1);assert.equal(h.el('relight-generate').disabled,true);assert.doesNotMatch(h.el('relight-status').textContent,/色彩副本已恢复并读取/);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

for(const action of ['clear','replace'] as const)test(`retained main-panel recovery respects a later explicit protection ${action}`,async()=>{
  const {h,native}=await harness();try{
    h.setSelection({bounds:{left:1,top:1,right:2,bottom:2},mask:new Uint8Array([0,0,0,128])});h.click('protect');await h.wait();
    const selection={bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,255,255])};h.setSelection(selection);await profileFailure(h,native);
    const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('diagnostic-primary');await h.wait();const copy=h.ps.app.activeDocument;h.ps.imaging.getPixels=read;
    if(action==='clear')h.click('clear-protection');else {h.setSelection({bounds:{left:0,top:0,right:1,bottom:1},mask:new Uint8Array([64,0,0,0])});h.click('protect');}await h.wait();h.setSelection(selection);
    h.click('diagnostic-primary');await h.wait();assert.equal(h.ps.app.activeDocument.id,copy.id);assert.equal(native.duplicates.length,2);assert.equal(h.posts.length,0);
    assert.match(h.el('source-info').textContent,action==='clear'?/未指定保护区/:/已扣除保护区/);
    h.el('resolution').value='32';h.click('generate');await h.wait();const record=h.records()[0];assert.equal((record.snapshot as any).documentId,copy.id);assert.deepEqual([...h.files[record.id+'-mask.bin'] as Uint8Array],action==='clear'?[255,128,255,255]:[191,128,255,255]);assert.equal(native.duplicates.length,2);
  }finally{await h.close();}
});

for(const action of ['clear','replace'] as const)test(`retained workbench recovery respects a later explicit protection ${action}`,async()=>{
  const {h,native}=await harness();try{
    h.setSelection({bounds:{left:1,top:1,right:2,bottom:2},mask:new Uint8Array([0,0,0,128])});h.click('protect');await h.wait();
    const selection={bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,255,255])};h.setSelection(selection);await openRelight(h);h.el('relight-output').value='full-result';h.change('relight-output');h.click('relight-reread');await pause();h.el('relight-intensity').value='2.4';h.change('relight-intensity');const before=await draft(h),old=h.ps.app.activeDocument;
    h.click('relight-close');await pause();native.undo(old);h.click('open-relight');await pause();const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('relight-recover-color');await pause();const copy=h.ps.app.activeDocument;h.ps.imaging.getPixels=read;
    assert.equal((await draft(h)).source.snapshotId,before.source.snapshotId);h.click('relight-close');await pause();
    if(action==='clear')h.click('clear-protection');else {h.setSelection({bounds:{left:0,top:0,right:1,bottom:1},mask:new Uint8Array([64,0,0,0])});h.click('protect');}await h.wait();h.setSelection(selection);h.click('open-relight');await pause();h.click('relight-recover-color');await pause();
    const after=await draft(h);assert.equal(after.source.documentId,copy.id);assert.equal(after.lights[0].intensity,2.4);assert.equal(native.duplicates.length,2);assert.equal(h.posts.length,0);h.click('relight-generate');await h.wait();await pause();const record=h.records()[0];assert.deepEqual([...h.files[record.id+'-mask.bin'] as Uint8Array],action==='clear'?[255,128,255,255]:[191,128,255,255]);
  }finally{await h.close();}
});

test('retained-copy retry rejects a later protection from an unrelated document without reviving the cached mask',async()=>{
  const {h,native}=await harness();try{
    await profileFailure(h,native);const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('read failed');};h.click('diagnostic-primary');await h.wait();const copy=h.ps.app.activeDocument;h.ps.imaging.getPixels=read;
    h.ps.app.activeDocument=native.docs[0];h.click('protect');await h.wait();h.ps.app.activeDocument=copy;h.click('nav-create');const reads=h.pixelRequests.length;h.click('diagnostic-primary');await h.wait();assert.equal(h.pixelRequests.length,reads);assert.equal(h.el('selection-previews').style.display,'none');assert.equal(native.duplicates.length,2);assert.equal(h.posts.length,0);assert.equal(details(h).documentId,copy.id);
  }finally{await h.close();}
});
