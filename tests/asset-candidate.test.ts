import test from 'node:test';
import assert from 'node:assert/strict';
import * as preparation from '../src/app/candidate-preparation';
import {encodePng,decodePng,type Raster} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';
import UPNG from 'upng-js';
import {planNativeCaptureMemory} from '../src/imaging/budget';
const {prepareCandidate}=preparation;

test('asset composite preview uses placement once without changing raw output or saved planes',async()=>{
  const sample=fixture();Object.assign(sample.record.params as any,{assetContext:'subject-v1',assetPlacement:{version:'subject-v1',scope:'context',occlusion:'front'}});
  sample.files[`${id}-mask.bin`]=new Uint8Array([255,127,255,255]);
  const bytes=encodePng(sample.output),original=bytes.slice(),planes=sample.files[`${id}-mask.bin`].slice();
  const render=(preparation as any).prepareAssetCompositePreview;assert.equal(typeof render,'function');
  const preview=await render(sample.record,bytes,sample.read);
  assert.equal(preview.width,4);assert.equal(preview.height,1);
  assert.deepEqual([...preview.rgba.slice(0,4)],[200,30,80,64]);
  assert.deepEqual([...preview.rgba.slice(12,16)],[30,70,140,255]);
  assert.deepEqual(bytes,original);assert.deepEqual(sample.files[`${id}-mask.bin`],planes);
  sample.files[`${id}-mask.bin`][0]=0;await assert.rejects(render(sample.record,bytes,sample.read));
});

for(const occlusion of ['front','behind'])test(`subject asset ${occlusion} keeps independent placement and original RGBA through history`,async()=>{
  const sample=fixture();
  Object.assign(sample.record.params as any,{assetContext:'subject-v1',assetPlacement:{version:'subject-v1',scope:'context',occlusion}});
  const expected=new Uint8Array(occlusion==='front'?[255,127,255,255]:[255,63,127,0]);
  sample.files[`${id}-mask.bin`]=expected;
  const prepared=await preparation.prepareSelectionAssetApplication(sample.record,encodePng(sample.output),sample.read);
  assert.equal(prepared.assetContext,'subject-v1');
  assert.deepEqual(prepared.snapshot.mask,expected);
  assert.deepEqual(prepared.image,sample.output);
  sample.files[`${id}-mask.bin`]=new Uint8Array([0,64,128,255]);
  await assert.rejects(preparation.prepareSelectionAssetApplication(sample.record,encodePng(sample.output),sample.read));
});

test('subject assets require exact versioned placement metadata and cannot grant it to legacy history',async()=>{
  for(const placement of [undefined,{version:'subject-v1',scope:'context',occlusion:'auto'},{version:'subject-v1',scope:'document',occlusion:'front'}]){
    const sample=fixture();Object.assign(sample.record.params as any,{assetContext:'subject-v1',assetPlacement:placement});
    await assert.rejects(prepareCandidate(sample.record,encodePng(sample.output),sample.read));
  }
  const legacy=fixture();(legacy.record.params as any).assetPlacement={version:'subject-v1',scope:'context',occlusion:'front'};
  await assert.rejects(prepareCandidate(legacy.record,encodePng(legacy.output),legacy.read));
});

const id='92000000-1111-4111-8111-111111111111';
function fixture(){
  const source:Raster={width:4,height:1,rgba:new Uint8Array([20,40,60,0,20,40,60,64,20,40,60,128,20,40,60,255])};
  const output:Raster={width:2,height:1,rgba:new Uint8Array([200,30,80,64,40,100,220,128])};
  let hash=2166136261;for(const value of source.rgba)hash=Math.imul(hash^value,16777619);
  const record:JobRecord={id,clientId:id,state:'ready',createdAt:'2026-10-20T00:00:00Z',graph:{},template:'qwen21-local-v2-rgba',params:{mode:'effect',outputKind:'asset',assetContext:'selection-v1',preserveAlpha:true,alignSubject:true,matchColor:true,modelSize:{width:2,height:1}},snapshot:{documentId:7,width:12,height:9,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:8,nativeDepth:8,historyId:3,sessionId:'frozen',bounds:{left:2,top:4,right:6,bottom:5},sourceHash:(hash>>>0).toString(16)}};
  const files:Record<string,Uint8Array>={[`${id}-source.png`]:encodePng(source),[`${id}-mask.bin`]:new Uint8Array([0,64,128,255]),[`${id}-subject-mask.bin`]:new Uint8Array([0,128,128,255]),[`${id}-protection-mask.bin`]:new Uint8Array([0,128,0,0])};
  const reads:string[]=[];
  return {record,source,output,files,reads,read:async(name:string)=>{reads.push(name);if(!files[name])throw Error('missing file');return files[name];}};
}

test('small contextual asset history and export preserve raw output alpha and literal old parameters',async()=>{
  const f=fixture(),params=structuredClone(f.record.params),prepared=await prepareCandidate(f.record,encodePng(f.output),f.read);
  assert.deepEqual(prepared.image,f.output);
  assert.deepEqual(decodePng(encodePng(prepared.image)),f.output,'export never acquires source alpha or a second feather');
  assert.deepEqual(prepared.snapshot?.mask,new Uint8Array([0,64,128,255]));
  assert.deepEqual(f.record.params,params);
  const legacy=fixture();delete (legacy.record.params as any).assetContext;delete (legacy.record.params as any).modelSize;
  delete legacy.files[`${id}-source.png`];delete legacy.files[`${id}-subject-mask.bin`];delete legacy.files[`${id}-protection-mask.bin`];
  assert.deepEqual((await prepareCandidate(legacy.record,encodePng(legacy.output),legacy.read)).image,legacy.output,'old assets remain readable without inventing current-image inputs');
  assert.deepEqual(legacy.reads,[`${id}-mask.bin`]);
});

test('small contextual assets reject mismatched model, source or effective native geometry',async()=>{
  for(const failure of ['model','source','mask','selection','protection','effective']){
    const f=fixture();
    if(failure==='model')(f.record.params as any).modelSize.width=3;
    if(failure==='source')f.files[`${id}-source.png`]=encodePng({width:1,height:1,rgba:new Uint8Array([20,40,60,255])});
    if(failure==='mask')f.files[`${id}-mask.bin`]=new Uint8Array([64,128]);
    if(failure==='selection')delete f.files[`${id}-subject-mask.bin`];
    if(failure==='protection')f.files[`${id}-protection-mask.bin`]=new Uint8Array([128]);
    if(failure==='effective')f.files[`${id}-mask.bin`][1]=128;
    await assert.rejects(prepareCandidate(f.record,encodePng(f.output),f.read),/历史|history|尺寸|geometry|蒙版|mask|来源|source/i);
  }
});

test('asset context versions and semantic kinds reject before local reads without upgrading old records',async()=>{
  for(const patch of [{assetContext:'selection-v2'},{outputKind:'edit'},{mode:'edit'}]){
    const f=fixture();Object.assign(f.record.params as any,patch);
    await assert.rejects(prepareCandidate(f.record,encodePng(f.output),f.read));assert.deepEqual(f.reads,[]);
  }
  const noSource=fixture();delete noSource.record.snapshot;
  await assert.rejects(prepareCandidate(noSource.record,encodePng(noSource.output),noSource.read));
});

test('small selection asset application reloads saved planes and blocks opaque output while preserving export',async()=>{
  const f=fixture(),prepare=(preparation as any).prepareSelectionAssetApplication;
  assert.equal(typeof prepare,'function');
  const result=await prepare(f.record,encodePng(f.output),f.read);
  assert.deepEqual(result.image,f.output);assert.equal(result.preserveAlpha,false);assert.equal(result.assetContext,'selection-v1');
  assert.deepEqual(result.snapshot.mask,new Uint8Array([0,64,128,255]));
  for(let p=3;p<f.output.rgba.length;p+=4)f.output.rgba[p]=255;
  const bytes=encodePng(f.output),candidate=await prepareCandidate(f.record,bytes,f.read);
  assert.match(candidate.warning??'',/透明|transparen/i);assert.deepEqual(candidate.image,f.output);
  await assert.rejects(prepare(f.record,bytes,f.read),(error:any)=>error.code==='invalid-output');
  delete (f.record.params as any).assetContext;
  await assert.rejects(prepare(f.record,bytes,f.read),'old text-only history does not gain new application semantics');
});

test('small selection asset restoration budgets native planes and retained candidates before local reads',async()=>{
  const f=fixture();
  await assert.rejects(prepareCandidate(f.record,encodePng(f.output),f.read,512_000_000),(error:any)=>error.code==='image-budget');
  assert.deepEqual(f.reads,[]);
  await assert.rejects(preparation.prepareSelectionAssetApplication(f.record,encodePng(f.output),f.read,512_000_000),(error:any)=>error.code==='image-budget');
  assert.deepEqual(f.reads,[]);
});

test('small selection assets reject unexpected output geometry before any decoder or local read',async(t)=>{
  const wrong=encodePng({width:1024,height:1024,rgba:new Uint8Array(1024*1024*4).fill(128)});
  const decode=t.mock.method(UPNG,'decode');
  for(const prepare of [prepareCandidate,preparation.prepareSelectionAssetApplication]){
    const f=fixture();
    await assert.rejects(prepare(f.record,wrong,f.read,410_000_000),/历史|history|尺寸|geometry|来源|source/i);
    assert.equal(decode.mock.callCount(),0,'mismatched compressed output never enters the full PNG decoder');
    assert.deepEqual(f.reads,[],'wrong output is rejected before native gray planes or source PNG are read');
  }
});

test('small selection assets reject short PNG headers and wrong output depth before decoding or local reads',async(t)=>{
  const f=fixture(),eight=encodePng(f.output),sixteen=encodePng({...f.output,rgba:Uint16Array.from(f.output.rgba,value=>value*257)});
  const decode=t.mock.method(UPNG,'decode');
  for(const prepare of [prepareCandidate,preparation.prepareSelectionAssetApplication])for(const bytes of [eight.subarray(0,32),sixteen]){
    const f=fixture();
    await assert.rejects(prepare(f.record,bytes,f.read));
    assert.equal(decode.mock.callCount(),0);assert.deepEqual(f.reads,[]);
  }
  const expected16=fixture();expected16.record.template='qwen21-local-v3-rgba16';
  await assert.rejects(prepareCandidate(expected16.record,eight,expected16.read));
  assert.equal(decode.mock.callCount(),0);assert.deepEqual(expected16.reads,[]);
});

test('small selection assets reject a non-native source PNG depth before source decoding',async(t)=>{
  const decode=t.mock.method(UPNG,'decode');
  for(const prepare of [prepareCandidate,preparation.prepareSelectionAssetApplication])for(const nativeDepth of [8,16]){
    const f=fixture(),source:Raster={...f.source,rgba:nativeDepth===16?f.source.rgba:Uint16Array.from(f.source.rgba,value=>value*257)};
    let hash=2166136261;for(const value of source.rgba)hash=Math.imul(hash^value,16777619);
    Object.assign(f.record.snapshot as any,{nativeDepth,depth:nativeDepth,sourceHash:(hash>>>0).toString(16)});f.files[`${id}-source.png`]=encodePng(source);
    await assert.rejects(prepare(f.record,encodePng(f.output),f.read),/历史|history|位深|depth|来源|source/i);
    assert.equal(decode.mock.calls.some(call=>new DataView(call.arguments[0]).getUint32(16)===4),false,'the 4x1 source must not enter UPNG when its header depth differs from the frozen native depth');
    assert.deepEqual(f.reads,[`${id}-mask.bin`,`${id}-source.png`],'inconsistent source rejects before reading the other native planes');
  }
});

test('small contextual native16 sources retain non-257 samples while legacy source8/native16 edits remain readable',async()=>{
  const f=fixture(),source:Raster={width:4,height:1,rgba:new Uint16Array([12345,23456,34567,0,12345,23456,34567,16385,12345,23456,34567,32769,12345,23456,34567,65535])};
  let hash=2166136261;for(const value of source.rgba)hash=Math.imul(hash^value,16777619);
  Object.assign(f.record.snapshot as any,{nativeDepth:16,depth:16,sourceHash:(hash>>>0).toString(16)});f.files[`${id}-source.png`]=encodePng(source);
  assert.deepEqual((await prepareCandidate(f.record,encodePng(f.output),f.read)).image,f.output);
  const legacy=fixture();Object.assign(legacy.record.snapshot as any,{nativeDepth:16,depth:16});Object.assign(legacy.record.params as any,{mode:'edit',outputKind:'edit'});delete (legacy.record.params as any).assetContext;
  await assert.doesNotReject(prepareCandidate(legacy.record,encodePng(legacy.output),legacy.read));
});

test('matching small selection asset headers still require complete strict PNG validation',async()=>{
  const f=fixture(),bytes=encodePng(f.output);bytes[bytes.length-1]^=1;
  await assert.rejects(prepareCandidate(f.record,bytes,f.read),/PNG|CRC/i);
  await assert.rejects(preparation.prepareSelectionAssetApplication(f.record,bytes,f.read),/PNG|CRC/i);
});

test('selection asset preflight blocks a captured native16 scope whose candidate peak cannot fit before submission',async(t)=>{
  const f=fixture(),retained=90_000_000;
  Object.assign(f.record.snapshot as any,{width:3000,height:3000,nativeDepth:16,depth:16,bounds:{left:0,top:0,right:3000,bottom:3000}});
  (f.record.params as any).modelSize={width:1024,height:1024};
  assert.equal(planNativeCaptureMemory(3000,3000,16,retained).estimatedPeakBytes,501_000_000,'the real capture plan can fit while the later candidate plan cannot');
  const bytes=encodePng({width:1024,height:1024,rgba:new Uint8Array(1024*1024*4).fill(128)}),decode=t.mock.method(UPNG,'decode');
  await assert.rejects(prepareCandidate(f.record,bytes,f.read,retained),(error:any)=>error.code==='image-budget');
  assert.equal(decode.mock.callCount(),0);assert.deepEqual(f.reads,[]);
  const preflight=(preparation as any).preflightSelectionAssetCandidate;assert.equal(typeof preflight,'function');
  assert.throws(()=>preflight(f.record,retained),(error:any)=>error.code==='image-budget'&&error.stage==='capture'&&/分辨率|resolution/i.test(error.message));
  const bounded=structuredClone(f.record);Object.assign(bounded.snapshot as any,{captureGeometry:{kind:'edit-analysis',width:64,height:64},requiresClipping:false});
  assert.doesNotThrow(()=>preflight(bounded,retained),'bounded native16 source PNGs use their working grid instead of budgeting a full native RGBA source');
  assert.equal(decode.mock.callCount(),0);assert.deepEqual(f.reads,[],'preflight has no decoding or persistence input');
});

test('selection asset preflight covers small and bounded native8/16 geometry without changing records',()=>{
  const preflight=(preparation as any).preflightSelectionAssetCandidate;assert.equal(typeof preflight,'function');
  for(const nativeDepth of [8,16])for(const bounded of [false,true]){
    const f=fixture();Object.assign(f.record.snapshot as any,{nativeDepth,depth:nativeDepth,...(bounded?{captureGeometry:{kind:'edit-analysis',width:4,height:1},requiresClipping:false}:{})});
    const saved=structuredClone(f.record);assert.doesNotThrow(()=>preflight(f.record));
    assert.throws(()=>preflight(f.record,512_000_000),(error:any)=>error.code==='image-budget'&&error.stage==='capture');
    assert.deepEqual(f.record,saved);assert.deepEqual(f.reads,[]);
  }
});

test('selection asset preflight rejects missing markers and unsupported saved capture geometry',()=>{
  const preflight=(preparation as any).preflightSelectionAssetCandidate;assert.equal(typeof preflight,'function');
  for(const patch of [{assetContext:undefined},{assetContext:'selection-v2'},{outputKind:'edit'},{mode:'edit'}]){
    const f=fixture();Object.assign(f.record.params as any,patch);assert.throws(()=>preflight(f.record));assert.deepEqual(f.reads,[]);
  }
  const relight=fixture();(relight.record.snapshot as any).captureGeometry={kind:'relight-analysis',width:4,height:1};
  assert.throws(()=>preflight(relight.record));
});
