import test from 'node:test';
import assert from 'node:assert/strict';
import * as preparation from '../src/app/candidate-preparation';
import {backgroundEditMask} from '../src/imaging/composite';
import {encodePng,type Raster} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';

const id='91000000-1111-4111-8111-111111111111';
function fixture(mode='edit',depth:8|16=8){
  const width=4,height=3,nativeWidth=8,nativeHeight=6,max=depth===16?65535:255;
  const source:Raster={width,height,rgba:depth===16?new Uint16Array(width*height*4):new Uint8Array(width*height*4)};
  for(let p=0;p<width*height;p++)source.rgba.set(depth===16?[12345,23456,34567,32769]:[40,80,120,128],p*4);
  const model:Raster={width:3,height:2,rgba:new Uint8Array(3*2*4)};
  for(let p=0;p<6;p++)model.rgba.set(mode==='background'?[20,60,120,255]:[210,20,50,64],p*4);
  const native:Raster={width:nativeWidth,height:nativeHeight,rgba:depth===16?new Uint16Array(nativeWidth*nativeHeight*4):new Uint8Array(nativeWidth*nativeHeight*4)};
  for(let p=0;p<nativeWidth*nativeHeight;p++)native.rgba.set(depth===16?[12345,23456,34567,32769]:[40,80,120,128],p*4);
  const subject=new Uint8Array(nativeWidth*nativeHeight).fill(128),protection=new Uint8Array(nativeWidth*nativeHeight);protection[0]=255;protection[1]=128;
  const mask=mode==='background'?backgroundEditMask(native,subject,protection):new Uint8Array(nativeWidth*nativeHeight).fill(255);
  let hash=2166136261;for(const value of source.rgba)hash=Math.imul(hash^value,16777619);
  const snapshot={documentId:7,width:120,height:90,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:depth===16?'bitDepth16':'bitDepth8',nativeDepth:depth,historyId:33,sessionId:'captured-session',bounds:{left:12,top:21,right:12+nativeWidth,bottom:21+nativeHeight},sourceHash:(hash>>>0).toString(16),sourceLayerIds:[3],captureGeometry:{kind:'edit-analysis',width,height},requiresClipping:mode!=='background',...(mode==='background'?{backgroundComposite:'subject-background-v1'}:{clipBaseLayerId:3})};
  const record:JobRecord={id,clientId:id,state:'ready',createdAt:'2026-10-19T02:00:00.000Z',graph:{},template:'qwen21-local-v2-rgba',outputFile:`${id}-output.png`,snapshot,params:{mode,workspace:mode==='blend'?'cosplay':'local',outputKind:'edit',modelSize:{width:model.width,height:model.height},preserveAlpha:mode!=='background',alignSubject:false,matchColor:false}};
  const files:Record<string,Uint8Array>={[`${id}-source.png`]:encodePng(source),[`${id}-mask.bin`]:mask,[`${id}-subject-mask.bin`]:subject,[`${id}-protection-mask.bin`]:protection};
  const reads:string[]=[];
  const read=async(name:string)=>{reads.push(name);assert.ok(files[name],name);return files[name];};
  return {record,source,model,mask,subject,protection,files,reads,read,max};
}

test('ordinary edit and blend history keep native masks separate from bounded source and model pixels',async()=>{
  for(const mode of ['edit','blend']){
    const f=fixture(mode),result=await preparation.prepareCandidate(f.record,encodePng(f.model),f.read);
    assert.equal(result.warning,undefined);
    assert.equal(result.outputKind,undefined,'ordinary editing must not become a relighting output');
    assert.deepEqual([result.image.width,result.image.height],[3,2]);
    assert.equal(result.snapshot?.mask.length,0,'display restoration does not retain a full native mask');
    assert.deepEqual(result.snapshot?.bounds,{left:12,top:21,right:20,bottom:27});
    assert.equal(result.image.rgba[3],128,'display preview may retain bounded source alpha');
  }
});

test('native edit application receives model pixels before source-alpha retention',async()=>{
  const f=fixture(),prepare=(preparation as any).prepareEditAnalysisApplication;
  assert.equal(typeof prepare,'function');
  const result=await prepare(f.record,encodePng(f.model),f.read);
  assert.equal(result.preserveAlpha,true);
  assert.deepEqual(result.image.rgba,f.model.rgba,'retain source alpha exactly once in native strips, not in this preparation');
  assert.equal(result.snapshot.mask.length,8*6);
  assert.equal(result.subjectMask,undefined);
  assert.equal(result.protectionMask,undefined);
});

test('bounded background history retains native subject/protection for native reconstruction',async()=>{
  const f=fixture('background'),result=await preparation.prepareCandidate(f.record,encodePng(f.model),f.read);
  assert.equal(result.warning,undefined);
  assert.ok(result.image.width*result.image.height<=Math.max(f.source.width*f.source.height,f.model.width*f.model.height),'history browsing must not allocate a native candidate raster');
  assert.equal(result.snapshot?.mask.length,0,'display restoration releases native mask planes');
  const prepare=(preparation as any).prepareEditAnalysisApplication;assert.equal(typeof prepare,'function');
  const application=await prepare(f.record,encodePng(f.model),f.read);
  assert.equal(application.preserveAlpha,false);
  assert.deepEqual(application.image.rgba,f.model.rgba,'native background reconstruction starts with the raw model target');
  assert.deepEqual(application.subjectMask,f.subject);
  assert.deepEqual(application.protectionMask,f.protection);
});

test('bounded source cache preserves native16 samples while model output stays8',async()=>{
  const f=fixture('edit',16),result=await preparation.prepareCandidate(f.record,encodePng(f.model),f.read);
  assert.equal(result.snapshot?.nativeDepth,16);
  assert.equal(result.image.rgba instanceof Uint8Array,true);
  assert.deepEqual(f.source.rgba.slice(0,4),new Uint16Array([12345,23456,34567,32769]));
  f.files[`${id}-source.png`]=encodePng({width:f.source.width,height:f.source.height,rgba:new Uint8Array(f.source.width*f.source.height*4)});
  await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/位深|depth|来源|source/i);
});

test('edit-analysis restoration fails closed on wrong native mask lengths or saved source geometry',async()=>{
  const f=fixture();await preparation.prepareCandidate(f.record,encodePng(f.model),f.read);f.files[`${id}-mask.bin`]=new Uint8Array(f.source.width*f.source.height).fill(255);
  await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/原生|native|蒙版|mask/i);
  f.files[`${id}-mask.bin`]=f.mask;
  f.files[`${id}-source.png`]=encodePng({width:1,height:1,rgba:new Uint8Array([20,30,40,255])});
  await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/尺寸|geometry|来源|source/i);
});

test('bounded history rejects oversized returned model geometry and retained-memory overflow before native BIN reads',async()=>{
  const f=fixture(),wrong=encodePng({width:4,height:2,rgba:new Uint8Array(4*2*4).fill(255)});
  await assert.rejects(preparation.prepareCandidate(f.record,wrong,f.read),/尺寸|geometry|来源|source/i);
  assert.deepEqual(f.reads,[]);
  await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read,512_000_000),(error:any)=>error.code==='image-budget');
  assert.deepEqual(f.reads,[]);
});

test('paid large-area responses are budgeted before submission and excessive2K has capture guidance',()=>{
  const f=fixture('background'),snapshot=f.record.snapshot as any;
  Object.assign(snapshot,{width:9000,height:5000,bounds:{left:0,top:0,right:9000,bottom:5000},captureGeometry:{kind:'edit-analysis',width:1373,height:763}});
  (f.record.params as any).modelSize={width:1376,height:768};
  assert.doesNotThrow(()=>preparation.preflightEditAnalysisCandidate(f.record,275_000_000));
  (f.record.params as any).modelSize={width:2752,height:1536};
  assert.throws(()=>preparation.preflightEditAnalysisCandidate(f.record,275_000_000),(error:any)=>{assert.equal(error.code,'image-budget');assert.equal(error.stage,'capture');assert.match(error.message,/分辨率|resolution/i);return true;});
  assert.deepEqual(f.reads,[]);
});

test('edit-analysis background rejects missing native matte data and preserves low-alpha raw output warning',async()=>{
  const f=fixture('background');delete f.files[`${id}-subject-mask.bin`];
  await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/背景|background|蒙版|mask/i);
  f.files[`${id}-subject-mask.bin`]=f.subject;
  f.model.rgba.fill(0);
  const result=await preparation.prepareCandidate(f.record,encodePng(f.model),f.read);
  assert.match(result.warning??'',/透明|transparent/i);
  assert.deepEqual(result.image.rgba,f.model.rgba,'unsafe raw output stays exportable and is not made opaque');
});
