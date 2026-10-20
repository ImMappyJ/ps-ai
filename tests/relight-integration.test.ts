import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
async function open(h:Awaited<ReturnType<typeof panelHarness>>){await h.wait();h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');await new Promise(r=>setTimeout(r,80));}
async function source(h:Awaited<ReturnType<typeof panelHarness>>){h.click('relight-save');await new Promise(r=>setTimeout(r,25));return JSON.parse(String(h.files['relight-draft.json'])).scene.source;}
test('new lighting sessions submit bounded analysis metadata and preserve raw output on extraction rejection',async()=>{
  const h=await panelHarness();try{await open(h);assert.equal(h.el('relight-output').value,'lighting-layers');h.click('relight-generate');await h.wait();const record=h.records()[0];assert.ok(record);assert.equal((record.relight as any).outputKind,'lighting-layers');assert.equal((record.snapshot as any).captureGeometry.kind,'relight-analysis');assert.ok(h.files[`${record.id}-output.png`]);assert.equal(h.uploads.length>0,true);}finally{await h.close();}
});
test('reopen refreshes changed same-source preview before any generation, retaining lights; reread follows active-document switches',async()=>{
  const h=await panelHarness();try{await open(h);h.el('relight-intensity').value='2.5';h.change('relight-intensity');const old=await source(h);h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.ps.app.activeDocument.activeHistoryState={id:old.historyId+1};h.click('open-relight');await new Promise(r=>setTimeout(r,100));const next=await source(h);assert.notEqual(next.snapshotId,old.snapshotId);assert.equal(next.historyId,old.historyId+1);assert.equal(h.el('relight-intensity').value,'2.5');h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.switchDocument(22);h.click('open-relight');await new Promise(r=>setTimeout(r,50));h.click('relight-reread');await new Promise(r=>setTimeout(r,90));assert.equal((await source(h)).documentId,22);assert.equal(h.ps.app.activeDocument.id,22);assert.equal(h.posts.length,0);}finally{await h.close();}
});

test('rereading visible owned results remains local after another document receives a candidate',async()=>{
  const h=await panelHarness(),pause=()=>new Promise(r=>setTimeout(r,80));try{
    await open(h);h.el('relight-output').value='full-result';h.change('relight-output');h.click('relight-reread');await pause();const clean=await source(h);
    h.click('relight-generate');await h.wait();h.click('relight-apply');await pause();const originalResult=h.appliedLayers[0].layer;originalResult.visible=true;originalResult.opacity=100;
    const reads=h.pixelRequests.length;h.click('relight-reread');await pause();const refreshed=await source(h);assert.ok(h.pixelRequests.length>reads);assert.notEqual(refreshed.snapshotId,clean.snapshotId);assert.equal(refreshed.layerIds.includes(originalResult.id),true);assert.equal(originalResult.opacity,100);
    h.click('relight-close');await pause();h.switchDocument(22);h.click('tab-local');h.el('resolution').value='32';h.click('generate');await h.wait();h.click('apply');await h.wait();assert.equal(h.appliedLayers[1].documentId,22);
    h.switchDocument(11);h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');const posts=h.posts.length;h.click('open-relight');await pause();h.click('relight-reread');await pause();
    assert.equal((await source(h)).documentId,11);assert.equal(h.ps.app.activeDocument.layers.some((layer:any)=>layer.id===originalResult.id),true);assert.equal(originalResult.visible,true);assert.equal(originalResult.opacity,100);assert.equal(h.posts.length,posts);
  }finally{await h.close();}
});
