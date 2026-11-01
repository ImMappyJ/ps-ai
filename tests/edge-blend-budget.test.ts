import test from 'node:test';
import assert from 'node:assert/strict';
import {planEdgeBlendCapture,planEdgeBlendCandidate} from '../src/imaging/edge-blend-budget';
import {makeMapping} from '../src/imaging/image';
import {IMAGE_BUDGETS} from '../src/imaging/budget';

test('edge blend plans the later native-plane validation and candidate before capture',()=>{
  for(const [width,height,depth,resolution] of [[3000,3000,16,1024],[7008,4672,16,1024],[5000,9000,8,768]] as const){
    const plan=planEdgeBlendCapture(width,height,depth,resolution,8,16_000_000);
    assert.ok(plan,'capture must switch to bounded processing before the native candidate exceeds budget');
    const model=makeMapping({left:0,top:0,right:width,bottom:height},resolution),png=model.width*model.height*4+model.height+65536;
    const live=16_000_000+width*height*4+plan.width*plan.height*(depth===16?16:8)+png;
    assert.ok(planEdgeBlendCandidate(width,height,depth,plan,model,8,png,live).estimatedPeakBytes<=IMAGE_BUDGETS.workingBytes);
  }
});
test('small edge capture stays native and impossible reservations reject without a raster allocation',()=>{
  assert.equal(planEdgeBlendCapture(64,48,16,1024,8),undefined);
  assert.throws(()=>planEdgeBlendCapture(7008,4672,16,2048,16,256_000_000),/预算|内存/);
  assert.throws(()=>planEdgeBlendCapture(9001,5000,8),/4500/);
});

test('v2 budgets only bounded row precision buffers and still supports 45MP bounded capture',()=>{
  const old=planEdgeBlendCandidate(3000,3000,16,{width:256,height:256},{width:256,height:256},8,262144),wide=planEdgeBlendCandidate(3000,3000,16,{width:256,height:256},{width:256,height:256},8,262144,0,'outward-v2');
  assert.equal(wide.estimatedPeakBytes-old.estimatedPeakBytes,3000*4);
  assert.ok(planEdgeBlendCapture(5000,9000,16,768,8,0,'outward-v2'));
});
