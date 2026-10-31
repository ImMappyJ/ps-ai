import test from 'node:test';
import assert from 'node:assert/strict';
import * as preparation from '../src/app/candidate-preparation';
import {backgroundEditMask} from '../src/imaging/composite';
import {encodePng,type Raster} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';
import UPNG from 'upng-js';
import {outwardBlendMask} from '../src/features/editing/edge-blend';

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

test('versioned ordinary edge blend verifies saved raw selection/protection before preview or native apply',async()=>{
  const f=fixture(),s=f.record.snapshot as any,p=f.record.params as any;
  s.edgeBlend={version:'outward-v1',radius:2};p.edgeBlend=2;
  f.subject.fill(0);f.subject[2*8+3]=255;
  f.files[`${id}-mask.bin`]=outwardBlendMask(f.subject,8,6,2,f.protection);
  const applied=await preparation.prepareEditAnalysisApplication(f.record,encodePng(f.model),f.read);
  assert.deepEqual(applied.snapshot.mask,f.files[`${id}-mask.bin`]);assert.equal(applied.snapshot.mask[0],0);
  f.files[`${id}-mask.bin`][2*8+4]=0;
  await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/蒙版|范围|历史/);
  await assert.rejects(preparation.prepareEditAnalysisApplication(f.record,encodePng(f.model),f.read),/蒙版|范围|历史/);
});
test('edge blend cannot be inferred for markerless history or attached to other modes',async()=>{
  const legacy=fixture();await preparation.prepareCandidate(legacy.record,encodePng(legacy.model),legacy.read);
  assert.equal(legacy.reads.some(name=>name.endsWith('subject-mask.bin')),false);
  for(const mode of ['blend','remove','background']){
    const f=fixture(mode);(f.record.snapshot as any).edgeBlend={version:'outward-v1',radius:2};(f.record.params as any).edgeBlend=2;
    await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/历史|边缘|范围/);
  }
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

for(const mode of ['effect','atmosphere'])for(const depth of [8,16] as const)test(`${mode} selection assets keep raw${depth} alpha and native masks across bounded history and application`,async()=>{
  const f=fixture(mode,depth),params=f.record.params as any;
  Object.assign(params,{outputKind:'asset',assetContext:'selection-v1',preserveAlpha:true,alignSubject:true,matchColor:true});
  for(let p=0;p<f.source.width*f.source.height;p++)f.source.rgba[p*4+3]=0;
  let hash=2166136261;for(const value of f.source.rgba)hash=Math.imul(hash^value,16777619);
  (f.record.snapshot as any).sourceHash=(hash>>>0).toString(16);
  f.files[`${id}-source.png`]=encodePng(f.source);
  for(let p=0;p<f.mask.length;p++){f.subject[p]=[0,128,128,255][p%4];f.protection[p]=[0,128,0,0][p%4];f.mask[p]=[0,64,128,255][p%4];}
  const model:Raster=depth===16?{width:3,height:2,rgba:new Uint16Array([12345,23456,34567,16385,23457,34568,45679,32769,45679,23457,12345,65535,12345,23456,34567,0,23457,34568,45679,32769,45679,23457,12345,65535])}:f.model;
  if(depth===16)f.record.template='qwen21-local-v3-rgba16';
  const bytes=encodePng(model),candidate=await preparation.prepareCandidate(f.record,bytes,f.read);
  assert.deepEqual(candidate.image,model,'source alpha, alignment and edit color preferences must not change independent assets');
  assert.deepEqual(candidate.snapshot?.bounds,{left:12,top:21,right:20,bottom:27});
  assert.equal(candidate.snapshot?.mask.length,0,'history preview releases full native mask');
  assert.deepEqual((f.record.params as any).outputKind,'asset');
  const application=await preparation.prepareEditAnalysisApplication(f.record,bytes,f.read);
  assert.deepEqual(application.image,model,'application starts from raw model alpha before the native editable mask');
  assert.equal(application.preserveAlpha,false);
  assert.equal((application as any).assetContext,'selection-v1');
  assert.deepEqual(application.snapshot.mask,f.mask);
  assert.equal(f.record.id,id,'restoration retains the original UUID');
  assert.doesNotThrow(()=>preparation.preflightEditAnalysisCandidate(f.record));
});

test('new bounded assets require the frozen marker and cannot claim edit semantics',async()=>{
  const f=fixture('effect'),params=f.record.params as any;
  Object.assign(params,{outputKind:'asset',assetContext:'selection-v1'});
  for(const patch of [{assetContext:undefined},{assetContext:'selection-v2'},{outputKind:'edit'},{mode:'edit'}]){
    const saved={...params};Object.assign(params,patch);
    await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/历史|history|来源|source/i);
    Object.assign(params,saved);
  }
  assert.deepEqual(f.reads,[],'invalid saved semantics reject before reading local planes');
});

test('selection asset candidates reject broken native geometry and keep raw output bytes intact',async()=>{
  const f=fixture('effect');Object.assign(f.record.params as any,{outputKind:'asset',assetContext:'selection-v1'});
  const bytes=encodePng(f.model),saved=bytes.slice();
  f.files[`${id}-mask.bin`]=new Uint8Array(4*3).fill(128);
  await assert.rejects(preparation.prepareCandidate(f.record,bytes,f.read),/历史|history|蒙版|mask/i);
  assert.deepEqual(bytes,saved);
});

test('selection assets verify original selection and protection against the saved effective plane',async()=>{
  const f=fixture('effect');Object.assign(f.record.params as any,{outputKind:'asset',assetContext:'selection-v1'});
  f.mask.fill(128);f.protection.fill(0);
  const bytes=encodePng(f.model);
  await preparation.prepareCandidate(f.record,bytes,f.read);
  for(const suffix of ['subject-mask.bin','protection-mask.bin']){
    const name=`${id}-${suffix}`,saved=f.files[name];f.files[name]=saved.subarray(0,saved.length-1);
    await assert.rejects(preparation.prepareCandidate(f.record,bytes,f.read),/历史|history|蒙版|mask/i);f.files[name]=saved;
  }
  f.protection[2]=128;
  await assert.rejects(preparation.prepareEditAnalysisApplication(f.record,bytes,f.read),/历史|history|蒙版|mask/i);
});

test('bounded selection assets retain opaque output for export but every application preparation blocks it',async()=>{
  const f=fixture('effect');Object.assign(f.record.params as any,{outputKind:'asset',assetContext:'selection-v1'});f.protection.fill(0);f.mask.fill(128);
  for(let p=3;p<f.model.rgba.length;p+=4)f.model.rgba[p]=255;
  const bytes=encodePng(f.model),candidate=await preparation.prepareCandidate(f.record,bytes,f.read);
  assert.match(candidate.warning??'',/透明|transparen/i);assert.deepEqual(candidate.image,f.model);
  await assert.rejects(preparation.prepareEditAnalysisApplication(f.record,bytes,f.read),(error:any)=>error.code==='invalid-output');
  await assert.rejects((preparation as any).prepareSelectionAssetApplication(f.record,bytes,f.read),(error:any)=>error.code==='invalid-output');
});

test('bounded selection assets reject output depth mismatches before any PNG decoding or local reads',async(t)=>{
  const decode=t.mock.method(UPNG,'decode');
  for(const prepare of [preparation.prepareCandidate,preparation.prepareEditAnalysisApplication,preparation.prepareSelectionAssetApplication])for(const expected of [8,16]){
    const f=fixture('effect');Object.assign(f.record.params as any,{outputKind:'asset',assetContext:'selection-v1'});
    f.record.template=expected===16?'qwen21-local-v3-rgba16':'qwen21-local-v2-rgba';
    const bytes=encodePng({...f.model,rgba:expected===16?f.model.rgba:Uint16Array.from(f.model.rgba,value=>value*257)});
    await assert.rejects(prepare(f.record,bytes,f.read));
    assert.equal(decode.mock.callCount(),0,'budgeted model depth is checked before bounded source or model decoding');assert.deepEqual(f.reads,[]);
  }
});


test('native edge history rejects changed source pixels, depth and geometry',async()=>{
  for(const corruption of ['pixels','depth','geometry']){
    const f=fixture(),s=f.record.snapshot as any,p=f.record.params as any;
    delete s.captureGeometry;s.bounds.right=s.bounds.left+4;s.bounds.bottom=s.bounds.top+3;
    s.edgeBlend={version:'outward-v1',radius:2};p.edgeBlend=2;
    const raw=new Uint8Array(12);raw[5]=255;
    f.files[id+'-subject-mask.bin']=raw;f.files[id+'-protection-mask.bin']=new Uint8Array(12);
    f.files[id+'-mask.bin']=outwardBlendMask(raw,4,3,2);
    await preparation.prepareCandidate(f.record,encodePng(f.model),f.read);
    const changed={...f.source,rgba:f.source.rgba.slice()};
    if(corruption==='pixels')changed.rgba[0]++;
    if(corruption==='depth')changed.rgba=new Uint16Array(changed.rgba);
    if(corruption==='geometry'){changed.width=3;changed.height=4;}
    f.files[id+'-source.png']=encodePng(changed);
    await assert.rejects(preparation.prepareCandidate(f.record,encodePng(f.model),f.read),/历史|位深|来源/);
  }
});

test('bounded edge blend rejects output depth mismatches before any PNG decoding or local reads',async(t)=>{
  const decode=t.mock.method(UPNG,'decode');
  for(const prepare of [preparation.prepareCandidate,preparation.prepareEditAnalysisApplication])for(const expected of [8,16]){
    const f=fixture();(f.record.snapshot as any).edgeBlend={version:'outward-v1',radius:2};(f.record.params as any).edgeBlend=2;
    f.files[`${id}-mask.bin`]=outwardBlendMask(f.subject,8,6,2,f.protection);
    f.record.template=expected===16?'qwen21-local-v3-rgba16':'qwen21-local-v2-rgba';
    const bytes=encodePng({...f.model,rgba:expected===16?f.model.rgba:Uint16Array.from(f.model.rgba,value=>value*257)});
    await assert.rejects(prepare(f.record,bytes,f.read));
    assert.equal(decode.mock.callCount(),0,'the budgeted depth must be checked before source or model decoding');assert.deepEqual(f.reads,[]);
  }
});

test('native edge candidate rejects a changed output grid before reading saved masks',async()=>{
  const f=fixture(),s=f.record.snapshot as any,p=f.record.params as any;
  delete s.captureGeometry;s.bounds.right=s.bounds.left+4;s.bounds.bottom=s.bounds.top+3;
  s.edgeBlend={version:'outward-v1',radius:2};p.edgeBlend=2;
  const bytes=encodePng(f.model).slice();new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(16,4096);
  await assert.rejects(preparation.prepareCandidate(f.record,bytes,f.read));
  assert.equal(f.reads.length,0);
});
