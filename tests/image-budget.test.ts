import test from 'node:test';
import assert from 'node:assert/strict';
import {IMAGE_BUDGETS,checkDocumentSize,planRelightMemory,planNativeCaptureMemory,resampleGray,downsampleSnapshotMask,imageStrips,mapCaptureRaster} from '../src/imaging/budget';
import {checkSize} from '../src/imaging/image';

test('24M, 36M and 45M documents use bounded analysis and strips without changing the decoder region cap',()=>{
  for(const [width,height] of [[6000,4000],[9000,4000],[9000,5000],[5000,9000]])for(const depth of [8,16] as const){
    checkDocumentSize(width,height);const p=planRelightMemory(width,height,depth);
    assert.ok(p.width*p.height<=IMAGE_BUDGETS.analysisPixels);assert.ok(Math.max(p.width,p.height)<=IMAGE_BUDGETS.analysisSide);
    assert.ok(p.estimatedPeakBytes<=IMAGE_BUDGETS.workingBytes);
    const strips=[...imageStrips({left:13,top:7,right:13+width,bottom:7+height})];
    assert.equal(strips.reduce((n,b)=>n+(b.right-b.left)*(b.bottom-b.top),0),width*height);
    assert.equal(strips[0].top,7);assert.equal(strips[strips.length-1].bottom,7+height);
    assert.ok(strips.every((b,i)=>b.left===13&&b.right===13+width&&(b.right-b.left)*(b.bottom-b.top)<=IMAGE_BUDGETS.stripPixels&&(!i||b.top===strips[i-1].bottom)));
  }
  assert.throws(()=>checkSize(9000,5000),/1600/);assert.throws(()=>checkDocumentSize(9001,5000),/4500/);
  assert.throws(()=>checkDocumentSize(30001,1),/30000/);assert.throws(()=>planRelightMemory(9000,5000,16,32_000_000),/预算|budget/i);
  const p=planRelightMemory(9000,5000,16),retained=planRelightMemory(9000,5000,16,undefined,10_000_000);assert.equal(retained.estimatedPeakBytes-p.estimatedPeakBytes,10_000_000);
  assert.throws(()=>planRelightMemory(9000,5000,16,undefined,200_000_000),(e:any)=>e.code==='image-budget');
});
test('trimmed cache-level source pixels map directly onto analysis coordinates without native RGBA expansion',()=>{
  const image={width:2,height:1,rgba:new Uint16Array([12345,23456,34567,65535,45678,12345,23456,65535])},actual={left:250,top:125,right:750,bottom:375},requested={left:0,top:0,right:2000,bottom:1000};
  const mapped=mapCaptureRaster(image,actual,requested,1,4,2);assert.equal(mapped.rgba.length,32);assert.deepEqual([...mapped.rgba.slice(4,12)],[12345,23456,34567,65535,45678,12345,23456,65535]);assert.equal(mapped.rgba[3],0);assert.equal(mapped.rgba[15],0);assert.ok(mapped.rgba.slice(16).every(v=>v===0));
  assert.throws(()=>mapCaptureRaster(image,actual,requested,11,4,2),/缓存/);
});

test('grayscale resampling maps native masks directly and preserves fractional coverage',()=>{
  const mask=new Uint8Array([0,64,128,255]);assert.deepEqual([...resampleGray(mask,4,1,2,1)],[32,192]);
  const snapshot={bounds:{left:42,top:9,right:46,bottom:10},mask};
  assert.deepEqual(downsampleSnapshotMask(snapshot,2,1),resampleGray(mask,4,1,2,1));
  assert.throws(()=>resampleGray(mask,3,1,2,1),/蒙版|mask/);assert.deepEqual(mask,new Uint8Array([0,64,128,255]));
});
test('native ROI capture has a byte budget independently of the pixel/decoder cap',()=>{
  assert.ok(planNativeCaptureMemory(4000,4000,8).estimatedPeakBytes<=IMAGE_BUDGETS.workingBytes);
  assert.throws(()=>planNativeCaptureMemory(4000,4000,16),(e:any)=>e.code==='image-budget');
  assert.ok(planNativeCaptureMemory(2000,2000,16).estimatedPeakBytes<IMAGE_BUDGETS.workingBytes);
  assert.throws(()=>planNativeCaptureMemory(9000,5000,8),/1600/);
});
