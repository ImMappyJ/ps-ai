import test from 'node:test';
import assert from 'node:assert/strict';
import {planBlendMemory} from '../src/imaging/blend-budget';
import {IMAGE_BUDGETS,planRelightMemory} from '../src/imaging/budget';
import {makeMapping} from '../src/imaging/image';
import {preflightEditAnalysisCandidate} from '../src/app/candidate-preparation';

const id='76000000-1111-4111-8111-111111111111';
function record(width:number,height:number,depth:8|16,outputDepth:8|16,resolution:number,grid:{width:number;height:number}){
  const bounds={left:0,top:0,right:width,bottom:height};
  const snapshot={documentId:7,width,height,profile:'sRGB IEC61966-2.1',mode:'rgb',depth,nativeDepth:depth,historyId:3,sessionId:'budget',bounds,sourceHash:'frozen',sourceLayerIds:[1],requiresClipping:false,blendOpaqueScope:true,captureGeometry:{kind:'blend-analysis' as const,width:grid.width,height:grid.height}};
  return {id,clientId:id,createdAt:'2026-11-01T00:00:00Z',state:'created' as const,graph:{},template:outputDepth===16?'qwen21-local-v3-rgba16':'qwen21-local-v2-rgba',snapshot,params:{mode:'blend',outputKind:'edit',modelSize:makeMapping(bounds,resolution)},blend:{schemaVersion:1,requestId:id,outputKind:'lighting-layers',source:{documentId:7,docWidth:width,docHeight:height,profile:snapshot.profile,documentMode:'rgb',documentDepth:depth,historyId:3,sessionId:snapshot.sessionId,sourceHash:snapshot.sourceHash,bounds,layerIds:[1],snapshotId:id,maskRef:'blend-mask-v1:sha256:'+'0'.repeat(64)}}};
}
// Model an open capture, its native raw/effective/protection planes, one ready
// candidate and compressed output. No image or native mask allocations here.
function liveBytes(width:number,height:number,depth:8|16,outputDepth:8|16,resolution:number,grid:{width:number;height:number}){
  const model=makeMapping({left:0,top:0,right:width,bottom:height},resolution);
  const sourceBpp=depth===16?8:4,candidateBpp=outputDepth===16||depth===16?8:4;
  return width*height*4+grid.width*grid.height*(sourceBpp+candidateBpp)+model.width*model.height*(outputDepth===16?8:4)+model.height+65_536;
}

test('33MP Blend adapts analysis before capture so the unchanged paid model grid also fits candidate preparation',()=>{
  const width=7008,height=4672,depth=16,outputDepth=16,resolution=1024,retained=32_000_000;
  const old=planRelightMemory(width,height,depth);
  assert.throws(()=>preflightEditAnalysisCandidate(record(width,height,depth,outputDepth,resolution,old),retained+liveBytes(width,height,depth,outputDepth,resolution,old)),/预算/);
  const plan=planBlendMemory(width,height,depth,resolution,outputDepth,retained);
  assert.ok(plan.width*plan.height<old.width*old.height);
  assert.ok(plan.width*plan.height>=65_536);
  assert.ok(plan.estimatedPeakBytes<=IMAGE_BUDGETS.workingBytes);
  assert.doesNotThrow(()=>preflightEditAnalysisCandidate(record(width,height,depth,outputDepth,resolution,plan),retained+liveBytes(width,height,depth,outputDepth,resolution,plan)));
});

test('bounded Blend plans preserve native geometry and fit both depths through rotated 45MP sources',()=>{
  for(const [width,height] of [[7008,4672],[4672,7008],[9000,5000],[5000,9000]])for(const depth of [8,16] as const)for(const outputDepth of [8,16] as const){
    const resolution=width*height===45_000_000&&outputDepth===16?768:1024;
    const plan=planBlendMemory(width,height,depth,resolution,outputDepth);
    assert.equal(plan.nativePixels,width*height);assert.ok(plan.width<=width&&plan.height<=height);
    assert.ok(plan.width*plan.height<=IMAGE_BUDGETS.analysisPixels);assert.ok(Math.max(plan.width,plan.height)<=IMAGE_BUDGETS.analysisSide);
    assert.doesNotThrow(()=>preflightEditAnalysisCandidate(record(width,height,depth,outputDepth,resolution,plan),liveBytes(width,height,depth,outputDepth,resolution,plan)));
  }
});

test('small Blend sources retain their full grid and resolution changes do not silently change model size',()=>{
  for(const resolution of [512,1024,1536,2048]){
    const plan=planBlendMemory(64,48,16,resolution,16);
    assert.deepEqual([plan.width,plan.height],[64,48]);
  }
  const a=planBlendMemory(7008,4672,16,1024,8),b=planBlendMemory(7008,4672,16,1536,8);
  assert.ok(b.width*b.height<a.width*a.height);
});

test('Blend refuses irreducible model/mask or retained memory pressure without weakening global guards',()=>{
  for(const fn of [()=>planBlendMemory(7008,4672,16,2048,16),()=>planBlendMemory(7008,4672,16,1024,16,400_000_000),()=>planBlendMemory(9001,5000,8,1024,8),()=>planBlendMemory(30001,1,8,1024,8)])assert.throws(fn,(e:any)=>e.code==='image-budget');
  assert.equal(IMAGE_BUDGETS.workingBytes,512_000_000);assert.equal(IMAGE_BUDGETS.documentPixels,45_000_000);
  for(const retained of [-1,NaN,Infinity])assert.throws(()=>planBlendMemory(64,48,8,1024,8,retained));
  for(const resolution of [0,31,2049])assert.throws(()=>planBlendMemory(64,48,8,resolution,8));
});
