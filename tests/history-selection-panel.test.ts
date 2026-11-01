import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';

const source=()=>({width:8,height:8,rgba:new Uint8Array(256).fill(255)});
function selection(x:number){const mask=new Uint8Array(64);mask[2*8+x]=64;mask[3*8+x]=128;mask[4*8+x]=255;return {bounds:{left:x,top:2,right:x+1,bottom:5},mask};}
async function generate(h:Awaited<ReturnType<typeof panelHarness>>){h.el('edge-blend').value='0';h.change('edge-blend');h.el('resolution').value='32';h.click('generate');await h.wait();assert.equal(h.errors.length,0,JSON.stringify(h.errors));return h.records()[0];}

test('history keeps separate raw selections and protection for each UUID, including zero edge width',async()=>{
  const h=await panelHarness({source:source(),selection:selection(2)});try{
    await h.wait();h.click('protect');await h.wait();h.setSelection(selection(3));const a=await generate(h);
    assert.deepEqual(a.selectionRange,{version:'native-v1',scope:'selection'});assert.ok(h.files[a.id+'-subject-mask.bin']);
    h.click('clear-protection');await h.wait();h.setSelection(selection(5));const b=await generate(h);assert.notEqual(a.id,b.id);
    h.setSelection({bounds:null as any,mask:new Uint8Array(64)});h.selectHistory(a.id);await h.wait();const before=h.selectionWrites.length;
    assert.equal(h.selectionWrites.length,before,'browsing does not restore a range');assert.ok(h.el('restore-history-selection'));
    h.click('repeat-history');await h.wait();assert.deepEqual(h.selectionState().mask,selection(3).mask);assert.equal(h.posts.length,2);
    h.click('generate');await h.wait();const reused=h.records()[0];assert.deepEqual(h.files[reused.id+'-protection-mask.bin'],h.files[a.id+'-protection-mask.bin']);
    h.selectHistory(b.id);await h.wait();h.click('repeat-history');await h.wait();assert.deepEqual(h.selectionState().mask,selection(5).mask);
    h.click('generate');await h.wait();assert.ok((h.files[h.records()[0].id+'-protection-mask.bin'] as Uint8Array).every(v=>v===0));
  }finally{await h.close();}
});
test('explicit historical range restore preserves current parameters and never submits inference',async()=>{
  const h=await panelHarness({source:source(),selection:selection(3)});try{
    await h.wait();const r=await generate(h);h.el('prompt').value='keep this draft';h.setSelection({bounds:null as any,mask:new Uint8Array(64)});h.selectHistory(r.id);await h.wait();
    assert.ok(h.el('restore-history-selection'));h.click('restore-history-selection');await h.wait();assert.deepEqual(h.selectionState().mask,selection(3).mask);assert.equal(h.el('prompt').value,'keep this draft');assert.equal(h.posts.length,1);
  }finally{await h.close();}
});
test('parameter reuse on another document stays parameter-only and reports unavailable historical range',async()=>{
  const h=await panelHarness({source:source(),selection:selection(3)});try{
    await h.wait();const r=await generate(h);h.switchDocument(99);h.selectHistory(r.id);await h.wait();h.click('repeat-history');await h.wait();assert.equal(h.selectionWrites.length,0);assert.match(h.el('status').textContent,/参数.*恢复.*选区.*原文档|参数.*恢复.*重新圈选/);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});
for(const changed of [false,true])test(`history candidate source check ${changed?'rejects changed native pixels':'permits deselection before explicit apply'}`,async()=>{
  const pixels=source(),h=await panelHarness({source:pixels,selection:selection(3)});try{
    await h.wait();const r=await generate(h),doc=h.ps.app.activeDocument,read=h.ps.imaging.getPixels;
    doc.activeHistoryState={id:2};doc.historyStates=[{id:1},{id:2}];h.setSelection({bounds:null as any,mask:new Uint8Array(64)});
    h.ps.imaging.getPixels=async(o:any)=>{const result=await read(o);if(changed&&o.historyStateID===2){const rgba=(await result.imageData.getData()).slice();rgba[0]=254;result.imageData.getData=async()=>rgba;}return result;};
    h.selectHistory(r.id);await h.wait();h.click('load-history');await h.wait();assert.equal(h.selectionWrites.length,0);assert.equal(h.el('apply').textContent,'检查来源');
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,1);
    if(changed){assert.match(h.el('status').textContent,/像素已改变/);assert.equal(h.el('apply').textContent,'检查来源');}
    else {assert.match(h.el('status').textContent,/来源检查通过/);h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.equal(h.selectionWrites.length,0);}
  }finally{await h.close();}
});
test('whole-document relight history restores protection and scope without creating a selection',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.setSelection({bounds:null as any,mask:new Uint8Array(4)});h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('relight-scope').value='document';h.change('relight-scope');h.el('resolution').value='32';h.click('open-relight');await h.wait();h.click('relight-generate');await h.wait();
    const r=h.records()[0];assert.ok(r,JSON.stringify(h.errors));assert.deepEqual(r.selectionRange,{version:'native-v1',scope:'document'});
    h.click('relight-close');await h.wait();h.el('relight-scope').value='selection';h.selectHistory(r.id);await h.wait();h.click('repeat-history');await h.wait();
    assert.equal(h.el('relight-scope').value,'document');assert.equal(h.selectionWrites.length,0);assert.equal(h.posts.length,1);assert.equal(h.selectionState().bounds,null);
  }finally{await h.close();}
});
test('range restore freezes the clicked UUID while disk reads and history focus change',async()=>{
  const h=await panelHarness({source:source(),selection:selection(3)});try{
    await h.wait();const a=await generate(h);h.setSelection(selection(5));const b=await generate(h);h.setSelection({bounds:null as any,mask:new Uint8Array(64)});
    h.selectHistory(a.id);await h.wait();h.holdFileRead(a.id+'-subject-mask.bin');h.click('restore-history-selection');await new Promise(r=>setTimeout(r,40));h.selectHistory(b.id);h.releaseFileRead(a.id+'-subject-mask.bin');await h.wait();assert.deepEqual(h.selectionState().mask,selection(3).mask);assert.equal(h.posts.length,2);
  }finally{await h.close();}
});
test('missing original range does not fabricate an effective-mask recovery or submit another job',async()=>{
  const h=await panelHarness({source:source(),selection:selection(3)});try{
    await h.wait();const r=await generate(h);delete h.files[r.id+'-subject-mask.bin'];h.setSelection({bounds:null as any,mask:new Uint8Array(64)});h.selectHistory(r.id);await h.wait();h.click('repeat-history');await h.wait();assert.equal(h.selectionWrites.length,0);assert.equal(h.posts.length,1);assert.match(h.el('status').textContent,/选区/);
  }finally{await h.close();}
});
test('history range restoration waits for an in-flight local preview before reading native planes',async()=>{
  const h=await panelHarness({source:source(),selection:selection(3)});let held='';try{
    await h.wait();const r=await generate(h);held=r.id+'-source.png';h.holdFileRead(held);h.selectHistory(r.id);await new Promise(resolve=>setTimeout(resolve,50));
    assert.match(h.el('history-preview-status').textContent,/正在读取/);const rawReads=h.fileReads.filter(name=>name===r.id+'-subject-mask.bin').length;
    h.click('restore-history-selection');await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(h.fileReads.filter(name=>name===r.id+'-subject-mask.bin').length,rawReads,'native range allocations must wait for preview transients');assert.equal(h.selectionWrites.length,0);
    h.releaseFileRead(held);await h.wait();assert.deepEqual(h.selectionState().mask,selection(3).mask);assert.equal(h.posts.length,1);
  }finally{h.releaseFileRead(held);await h.close();}
});
test('returning to the original Photoshop document refreshes the historical restore action',async()=>{
  const h=await panelHarness({source:source(),selection:selection(3)});try{
    await h.wait();const r=await generate(h);h.switchDocument(99);h.selectHistory(r.id);await h.wait();assert.equal(h.el('restore-history-selection').disabled,true);
    h.switchDocument(11);h.showPanel();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(h.el('restore-history-selection').disabled,false);
    h.switchDocument(99);h.hidePanel();h.showPanel();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(h.el('restore-history-selection').disabled,true);
  }finally{await h.close();}
});
