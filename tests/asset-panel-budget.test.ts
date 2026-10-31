import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {decodePng} from '../src/imaging/image';

const output={width:1024,height:1024,rgba:Uint8Array.from({length:1024*1024*4},(_,i)=>[80,100,220,128][i%4])};

// Native APIs already return dense buffers for this full-document selection.
// Avoid the general harness's second synthetic crop/expand of the 9MP fixture.
function fullNativeSelection(h:Awaited<ReturnType<typeof panelHarness>>,source:{width:number;height:number;rgba:Uint16Array}){
  h.ps.imaging.getSelection=async(o:any)=>({sourceBounds:o.sourceBounds,imageData:{width:source.width,height:source.height,components:1,componentSize:8,getData:async()=>new Uint8Array(source.width*source.height).fill(255),dispose(){}}});
  h.ps.imaging.getPixels=async(o:any)=>{h.pixelRequests.push(o);return {sourceBounds:o.sourceBounds,imageData:{width:source.width,height:source.height,components:4,componentSize:16,getData:async()=>source.rgba,dispose(){}}};};
}

// The full 9MP native16 capture takes 22s on serial hosted Windows runs.
// Retain its native pixels and all preflight/no-upload assertions.
test('unbounded native16 contextual assets reject an unaffordable candidate peak before uploading or posting',{timeout:60_000},async()=>{
  const source={width:3000,height:3000,rgba:new Uint16Array(3000*3000*4).fill(65535)},h=await panelHarness({source,output});try{
    await h.wait();fullNativeSelection(h,source);h.click('tab-cosplay');h.el('resolution').value='1024';h.click('generate');await h.wait();
    assert.ok(h.pixelRequests.length>0);assert.ok(h.pixelRequests.every(o=>o.componentSize===16&&!o.targetSize),'the native capture itself fits without edit-analysis fallback');
    assert.equal(h.uploads.length,0);assert.equal(h.posts.length,0);assert.equal(h.records().length,0);const diagnostic=JSON.parse(h.el('diagnostic-details').value);assert.equal(diagnostic.code,'image-budget');assert.equal(diagnostic.stage,'capture');assert.match(h.el('status').textContent,/候选准备.*内存预算/);
  }finally{await h.close();}
});

test('affordable unbounded native16 subject assets save native source and upload three sRGB8 inputs',async()=>{
  const source={width:256,height:256,rgba:new Uint16Array(256*256*4).fill(65535)},smallOutput={width:256,height:256,rgba:Uint8Array.from({length:256*256*4},(_,i)=>[80,100,220,128][i%4])};source.rgba[0]=12345;source.rgba[3]=65534;const h=await panelHarness({source,output:smallOutput});try{
    await h.wait();h.click('tab-cosplay');h.el('resolution').value='256';h.click('generate');await h.wait();assert.equal(h.posts.length,1,JSON.stringify(h.errors));assert.equal(h.uploads.length,3);const record=h.records()[0];assert.equal(record.state,'ready');assert.equal((record.snapshot as any).captureGeometry,undefined);assert.equal((record.snapshot as any).nativeDepth,16);
    const saved=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);assert.ok(saved.rgba instanceof Uint16Array);assert.equal(saved.rgba[0],12345);assert.equal(saved.rgba[3],65534);for(const input of h.uploads)assert.ok(input.image.rgba instanceof Uint8Array);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});
