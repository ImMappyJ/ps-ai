import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateOutputKind,prepareCandidate,prepareLightingLayerApplication,prepareEditAnalysisApplication,preflightEditAnalysisCandidate,loadCandidateSource} from '../src/app/candidate-preparation';
import {validateBlendTaskMetadata,withBlendProcessing,blendTaskMetadata} from '../src/features/blend/blend-session';
import {encodePng,type Raster} from '../src/imaging/image';
import {sha256} from '@noble/hashes/sha2.js';
import type {JobRecord} from '../src/generation/jobs';

const id='76000000-1111-4111-8111-111111111111';
function fixture(outputKind='lighting-layers',depth:8|16=8){
  const width=32,height=32,nativeWidth=64,nativeHeight=64,max=depth===16?65535:255;
  const source:Raster={width,height,rgba:depth===16?new Uint16Array(width*height*4):new Uint8Array(width*height*4)};
  const raw:Raster={width,height,rgba:source.rgba.slice()};
  for(let p=0;p<width*height;p++){source.rgba.set([Math.round(max*.3),Math.round(max*.4),Math.round(max*.5),max],p*4);raw.rgba.set([Math.round(max*.5),Math.round(max*.45),Math.round(max*.5),max],p*4);}
  const selection=new Uint8Array(nativeWidth*nativeHeight);for(let y=0;y<nativeHeight;y++)for(let x=0;x<40;x++)selection[y*nativeWidth+x]=x===39?128:255;
  const protection=new Uint8Array(selection.length);protection[0]=255;protection[1]=64;
  const mask=selection.map((v,p)=>Math.round(v*(1-protection[p]/255)));
  let hash=2166136261;for(const v of source.rgba)hash=Math.imul(hash^v,16777619);
  const snapshot={documentId:7,width:nativeWidth,height:nativeHeight,profile:'sRGB IEC61966-2.1',mode:'rgb',depth,nativeDepth:depth,historyId:3,sessionId:'blend-session',bounds:{left:0,top:0,right:nativeWidth,bottom:nativeHeight},sourceHash:(hash>>>0).toString(16),sourceLayerIds:[1],requiresClipping:false,blendOpaqueScope:true,captureGeometry:{kind:'blend-analysis',width,height}};
  const identity={documentId:7,docWidth:nativeWidth,docHeight:nativeHeight,profile:snapshot.profile,documentMode:'rgb',documentDepth:depth,historyId:3,sessionId:snapshot.sessionId,sourceHash:snapshot.sourceHash,bounds:snapshot.bounds,layerIds:[1],snapshotId:id,maskRef:`blend-mask-v1:sha256:${Buffer.from(sha256(mask)).toString('hex')}`};
  const record:JobRecord={id,clientId:id,createdAt:'2026-10-30T00:00:00Z',state:'ready',graph:{},template:depth===16?'qwen21-local-v3-rgba16':'qwen21-local-v2-rgba',outputFile:`${id}-output.png`,snapshot,params:{mode:'blend',outputKind:'edit',modelSize:{width,height},preserveAlpha:true,alignSubject:false,matchColor:false},blend:{schemaVersion:1,requestId:id,source:identity,outputKind}};
  const files:Record<string,Uint8Array>={[`${id}-source.png`]:encodePng(source),[`${id}-mask.bin`]:mask,[`${id}-subject-mask.bin`]:selection,[`${id}-protection-mask.bin`]:protection};
  return {record,source,raw,files,read:async(name:string)=>{if(!files[name])throw Error('Missing '+name);return files[name];}};
}
test('new blend same UUID switches local light extraction and redraw while legacy stays redraw',async()=>{
  const f=fixture(),saved=JSON.stringify(f.record),bytes=encodePng(f.raw);
  assert.equal(candidateOutputKind(f.record),'lighting-layers');
  const lighting=await prepareCandidate(f.record,bytes,f.read);
  assert.equal(lighting.lightingState,'composite');assert.equal(lighting.image.width,32);assert.equal(lighting.snapshot?.mask.length,4096);assert.notDeepEqual(lighting.image.rgba,f.raw.rgba);
  assert.equal(JSON.stringify(f.record),saved);
  (f.record.blend as any).outputKind='full-result';
  const redraw=await prepareCandidate(f.record,bytes,f.read),apply=await prepareEditAnalysisApplication(f.record,bytes,f.read);
  assert.equal(redraw.outputKind,'full-result');assert.equal(apply.snapshot.captureGeometry?.kind,'blend-analysis');assert.deepEqual(apply.image.rgba,f.raw.rgba);
  delete f.record.blend;delete (f.record.snapshot as any).captureGeometry;
  (f.record.snapshot as any).width=32;(f.record.snapshot as any).height=32;(f.record.snapshot as any).bounds={left:0,top:0,right:32,bottom:32};f.files[`${id}-mask.bin`]=new Uint8Array(1024).fill(255);
  assert.notEqual(candidateOutputKind(f.record),'lighting-layers');
  assert.equal((await prepareCandidate(f.record,bytes,f.read)).lightingState,undefined);
});
test('blend history verifies source bytes, native masks and exact metadata identity before extraction',async()=>{
  for(const failure of ['uuid','history','depth','missing','mask','source']){const f=fixture(),metadata=f.record.blend as any;
    if(failure==='uuid')metadata.requestId='00000000-1111-4111-8111-111111111111';if(failure==='history')metadata.source.historyId++;
    if(failure==='depth')(f.record.snapshot as any).nativeDepth=16;if(failure==='missing')delete f.files[`${id}-protection-mask.bin`];
    if(failure==='mask')f.files[`${id}-mask.bin`][3]=0;if(failure==='source'){const s={...f.source,rgba:f.source.rgba.slice()};s.rgba[0]++;f.files[`${id}-source.png`]=encodePng(s);}
    await assert.rejects(prepareLightingLayerApplication(f.record,encodePng(f.raw),f.read),()=>true,failure);
  }
});
test('blend RGB16 keeps source precision and exact protected feather mask',async()=>{
  const f=fixture('lighting-layers',16),prepared=await prepareLightingLayerApplication(f.record,encodePng(f.raw),f.read);
  assert.equal(prepared.fields.version,'blend-fields-v1');assert.ok(prepared.source.rgba instanceof Uint16Array);assert.equal(prepared.source.rgba[0],Math.round(65535*.3));
  assert.equal(prepared.snapshot.mask[0],0);assert.equal(prepared.snapshot.mask[1],191);assert.equal(prepared.snapshot.mask[39],128);
});
test('redraw source can remain non-sRGB and translucent but light switch fails safely with raw intact',async()=>{
  const f=fixture('full-result'),s=f.record.snapshot as any,m=(f.record.blend as any).source;s.profile=m.profile='Adobe RGB (1998)';
  assert.equal((await prepareCandidate(f.record,encodePng(f.raw),f.read)).outputKind,'full-result');
  (f.record.blend as any).outputKind='lighting-layers';const bytes=encodePng(f.raw),result=await prepareCandidate(f.record,bytes,f.read);
  assert.equal(result.lightingState,'reference-only');assert.deepEqual(result.image.rgba,f.raw.rgba);assert.ok(result.warning);
  await assert.rejects(prepareLightingLayerApplication(f.record,bytes,f.read),/sRGB|颜色|RGB/);
});
test('new blend native alpha proof and exact plane validation gate lighting without destroying raw output',async()=>{
  const f=fixture();(f.record.snapshot as any).blendOpaqueScope=false;
  const bytes=encodePng(f.raw),result=await prepareCandidate(f.record,bytes,f.read);assert.equal(result.lightingState,'reference-only');assert.deepEqual(result.image.rgba,f.raw.rgba);
  await assert.rejects(prepareLightingLayerApplication(f.record,bytes,f.read),/透明/);
  (f.record.blend as any).outputKind='full-result';assert.equal((await prepareCandidate(f.record,bytes,f.read)).outputKind,'full-result');
});
test('new bounded redraw preview preserves the source outside the subject mask',async()=>{
  const f=fixture('full-result'),preview=await prepareCandidate(f.record,encodePng(f.raw),f.read);
  const outside=(20*32+30)*4;assert.deepEqual(preview.image.rgba.slice(outside,outside+4),f.source.rgba.slice(outside,outside+4));
});
test('blend metadata creates immutable same-UUID processing copies and rejects invalid extraction before disk reads',async()=>{
  const f=fixture('full-result'),snapshot={...(f.record.snapshot as any),mask:f.files[`${id}-mask.bin`]},capture={snapshot,image:f.source,selectionMask:f.files[`${id}-subject-mask.bin`],protectionMask:f.files[`${id}-protection-mask.bin`]},metadata=blendTaskMetadata(capture,id,'full-result'),saved=JSON.stringify(metadata);
  const changed=withBlendProcessing(metadata,'lighting-layers',{fidelity:.4,detailProtection:.9});
  assert.equal(changed.requestId,id);assert.deepEqual(changed.source,metadata.source);assert.notEqual(changed.source,metadata.source);assert.equal(JSON.stringify(metadata),saved);
  assert.throws(()=>validateBlendTaskMetadata({...metadata,unexpected:true}));assert.throws(()=>validateBlendTaskMetadata({...metadata,source:{...metadata.source,snapshotId:'other'}}));
  f.record.blend={...changed,localExtraction:{fidelity:2,detailProtection:1}};const reads:string[]=[];
  await assert.rejects(prepareCandidate(f.record,encodePng(f.raw),async name=>{reads.push(name);return f.read(name);}));assert.deepEqual(reads,[]);
});
test('both new blend modes preflight paid candidate budgets and source views reload the original saved source',async()=>{
  const f=fixture();assert.doesNotThrow(()=>preflightEditAnalysisCandidate(f.record));(f.record.blend as any).outputKind='full-result';assert.doesNotThrow(()=>preflightEditAnalysisCandidate(f.record));
  assert.deepEqual((await loadCandidateSource(f.record,f.read)).rgba,f.source.rgba);assert.throws(()=>preflightEditAnalysisCandidate(f.record,512_000_000),/预算|内存/);
});
test('new blend rejects incompatible output header/depth before reading local masks or source',async()=>{
  for(const bad of ['size','depth']){const f=fixture(),bytes=bad==='size'?encodePng({width:16,height:16,rgba:new Uint8Array(16*16*4).fill(255)}):encodePng({width:32,height:32,rgba:new Uint16Array(32*32*4).fill(65535)}),reads:string[]=[];
    await assert.rejects(prepareCandidate(f.record,bytes,async name=>{reads.push(name);return f.read(name);}));assert.deepEqual(reads,[]);
  }
});

for(const sourceDepth of [8,16] as const)for(const outputDepth of [8,16] as const)for(const outputAlpha of [255,64]){
  test(`redraw RGB${sourceDepth}/output${outputDepth} preview retains source alpha and one protected feather when AI alpha is ${outputAlpha}`,async()=>{
    const f=fixture('full-result',sourceDepth),sourceScale=sourceDepth===16?257:1,outputScale=outputDepth===16?257:1,sourceValue=100*sourceScale+(sourceDepth===16?11:0),sourceAlpha=128*sourceScale+(sourceDepth===16?1:0);
    for(let p=0;p<1024;p++)f.source.rgba.set([sourceValue,sourceValue,sourceValue,sourceAlpha],p*4);
    const raw:Raster={width:32,height:32,rgba:outputDepth===16?new Uint16Array(4096):new Uint8Array(4096)};for(let p=0;p<1024;p++)raw.rgba.set([180*outputScale,180*outputScale,180*outputScale,outputAlpha*outputScale],p*4);
    const selection=new Uint8Array(1024).fill(255),protection=new Uint8Array(1024);selection.set([255,128,255,128,255,0]);protection.set([0,0,128,64,255,0]);
    const mask=selection.map((v,p)=>Math.round(v*(255-protection[p])/255)),snapshot=f.record.snapshot as any,identity=(f.record.blend as any).source;
    Object.assign(snapshot,{width:32,height:32,bounds:{left:0,top:0,right:32,bottom:32},requiresClipping:true,clipBaseLayerId:1,blendOpaqueScope:false});
    let hash=2166136261;for(const v of f.source.rgba)hash=Math.imul(hash^v,16777619);snapshot.sourceHash=(hash>>>0).toString(16);
    Object.assign(identity,{docWidth:32,docHeight:32,bounds:snapshot.bounds,sourceHash:snapshot.sourceHash,maskRef:`blend-mask-v1:sha256:${Buffer.from(sha256(mask)).toString('hex')}`});
    f.files[`${id}-mask.bin`]=mask;f.files[`${id}-subject-mask.bin`]=selection;f.files[`${id}-protection-mask.bin`]=protection;f.files[`${id}-source.png`]=encodePng(f.source);f.record.template=outputDepth===16?'qwen21-local-v3-rgba16':'qwen21-local-v2-rgba';
    const bytes=encodePng(raw),saved=JSON.stringify(f.record),before=f.files[`${id}-source.png`].slice(),preview=await prepareCandidate(f.record,bytes,f.read),application=await prepareEditAnalysisApplication(f.record,bytes,f.read);
    assert.equal(preview.image.rgba instanceof Uint16Array,sourceDepth===16,'preview follows native writer depth, without quantizing a native16 source');
    assert.equal(JSON.stringify(f.record),saved);assert.deepEqual(f.files[`${id}-source.png`],before);assert.deepEqual(application.image.rgba,raw.rgba,'apply still receives untouched AI pixels for native source-alpha reconstruction');
    const coverage=Math.min(1,outputAlpha*sourceScale/sourceAlpha),patch=Math.round(180*sourceScale*coverage+sourceValue*(1-coverage));
    for(let p=0;p<1024;p++){
      const expected=Math.round(sourceValue+(patch-sourceValue)*mask[p]/255);
      assert.deepEqual(Array.from(preview.image.rgba.slice(p*4,p*4+4)),[expected,expected,expected,sourceAlpha],`pixel ${p}: one exact effective mask; source alpha retained`);
    }
  });
}
