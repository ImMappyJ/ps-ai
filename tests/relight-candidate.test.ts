import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCandidate,prepareLightingLayerApplication} from '../src/app/candidate-preparation';
import {createRelightScene} from '../src/features/relight/relight-scene';
import {encodePng,type Raster} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';
import {sha256} from '@noble/hashes/sha2.js';

const id='89000000-1111-4111-8111-111111111111';
function fixture(outputKind?:string){
  const width=64,height=64,nativeWidth=128,nativeHeight=128;
  const image:Raster={width,height,rgba:new Uint8Array(width*height*4)};
  for(let p=0;p<width*height;p++)image.rgba.set([70+p%64,90+Math.floor(p/64),110,255],p*4);
  const source={documentId:1,layerIds:[3],sessionId:'session',historyId:4,sourceHash:'source',snapshotId:'snapshot',docWidth:nativeWidth,docHeight:nativeHeight,bounds:{left:0,top:0,right:nativeWidth,bottom:nativeHeight},profile:'sRGB IEC61966-2.1',documentMode:'rgb',documentDepth:8 as const,maskRef:'mask'};
  source.maskRef=`relight-mask-v1:sha256:${Buffer.from(sha256(new Uint8Array(nativeWidth*nativeHeight).fill(255))).toString('hex')}`;
  const scene=createRelightScene(source,'light-1');
  const snapshot={documentId:1,width:nativeWidth,height:nativeHeight,mode:'rgb',depth:8,profile:source.profile,sessionId:'session',historyId:4,sourceHash:'source',bounds:source.bounds,sourceLayerIds:[3],...(outputKind?{captureGeometry:{kind:'relight-analysis',width,height}}:{})};
  const record:JobRecord={id,clientId:id,createdAt:'2026-10-19T00:00:00.000Z',state:'ready',graph:{},template:'qwen21-local-v2-rgba',outputFile:`${id}-output.png`,snapshot,params:{mode:'relight',workspace:'cosplay',outputKind:'edit',modelSize:{width,height},preserveAlpha:true,alignSubject:false,matchColor:false},relight:{schemaVersion:1,requestId:id,scene,...(outputKind?{outputKind}:{})}};
  const files:Record<string,Uint8Array>={[`${id}-source.png`]:encodePng(image),[`${id}-mask.bin`]:new Uint8Array(nativeWidth*nativeHeight).fill(255)};
  return {image,record,files,read:async(name:string)=>{assert.ok(files[name],name);return files[name];}};
}

test('lighting history keeps native mask geometry separate from analysis preview and identifies output type',async()=>{
  const f=fixture('lighting-layers');
  const result=await prepareCandidate(f.record,encodePng(f.image),f.read);
  assert.equal((result as any).outputKind,'lighting-layers');
  assert.equal(result.lightingState,'composite');
  assert.equal(result.warning,undefined);
  assert.equal(result.image.width,64);
  assert.deepEqual(result.image.rgba,f.image.rgba,'neutral lighting must retain actual source values');
  assert.equal(result.snapshot?.mask.length,128*128,'native effective mask must survive history restoration');
});

test('a failed lighting extraction is an inspection reference with the same typed failure on apply',async()=>{
  const f=fixture('lighting-layers'),target={...f.image,rgba:f.image.rgba.slice()};
  for(let p=0;p<target.width*target.height;p++){const v=p%2?220:20;target.rgba.set([v,v,v,255],p*4);}
  const bytes=encodePng(target),saved=JSON.stringify(f.record),result=await prepareCandidate(f.record,bytes,f.read);
  assert.equal(result.outputKind,'lighting-layers');
  assert.equal(result.lightingState,'reference-only');
  assert.equal((result.lightingFailure as any)?.code,'relight-extraction');
  assert.equal((result.lightingFailure as any)?.reason,'structure-mismatch');
  assert.deepEqual(result.image.rgba,target.rgba,'failed extraction keeps the original reference inspectable');
  assert.equal(result.lightingSummary,undefined);
  assert.match(result.warning!,/参考图.*不能回填/);
  assert.equal(JSON.stringify(f.record),saved,'local extraction does not change task identity or saved mode');
  await assert.rejects(prepareLightingLayerApplication(f.record,bytes,f.read),(error:any)=>error.code==='relight-extraction'&&error.reason==='structure-mismatch');
});

test('successful lighting preview is a source composite rather than the original AI reference',async()=>{
  const f=fixture('lighting-layers'),target={...f.image,rgba:f.image.rgba.slice()};
  for(let p=0;p<target.width*target.height;p++){target.rgba[p*4]+=30;target.rgba[p*4+1]+=10;target.rgba[p*4+2]+=10;}
  const result=await prepareCandidate(f.record,encodePng(target),f.read);
  assert.equal(result.lightingState,'composite');
  assert.equal(result.lightingFailure,undefined);
  assert.equal(result.warning,undefined);
  assert.ok(result.lightingSummary);
  assert.notDeepEqual(result.image.rgba,target.rgba,'an AI reference is never used as the successful lighting preview');
  assert.notDeepEqual(result.image.rgba,f.image.rgba,'the derived preview has an observable lighting effect');
  for(let p=0;p<target.width*target.height;p++)assert.equal(result.image.rgba[p*4+3],255);
});

test('legacy relight record never becomes lighting layers by default',async()=>{
  const f=fixture();f.record.snapshot={...(f.record.snapshot as any),width:64,height:64,bounds:{left:0,top:0,right:64,bottom:64}};
  f.files[`${id}-mask.bin`]=new Uint8Array(64*64).fill(255);
  const result=await prepareCandidate(f.record,encodePng(f.image),f.read);
  assert.equal((result as any).outputKind,'full-result');
  assert.deepEqual(result.image.rgba,f.image.rgba);
});

test('unknown output type and analysis marker on a legacy full result fail closed',async()=>{
  const f=fixture('invented');
  await assert.rejects(prepareCandidate(f.record,encodePng(f.image),f.read),/光影|lighting|output/i);
  (f.record.relight as any).outputKind='full-result';
  await assert.rejects(prepareCandidate(f.record,encodePng(f.image),f.read),/光影|lighting|analysis|分析/i);
});

test('lighting restoration rejects inconsistent scene identity and native mask before derivation',async()=>{
  const f=fixture('lighting-layers');
  (f.record.relight as any).scene.source.documentId=2;
  await assert.rejects(prepareCandidate(f.record,encodePng(f.image),f.read),/来源|source|光影|lighting/i);
  (f.record.relight as any).scene.source.documentId=1;
  f.files[`${id}-mask.bin`]=new Uint8Array(64*64).fill(255);
  await assert.rejects(prepareCandidate(f.record,encodePng(f.image),f.read),/mask|蒙版|光影|lighting/i);
});

test('lighting history rejects a changed native source depth or quantized source cache',async()=>{
  const f=fixture('lighting-layers');(f.record.snapshot as any).nativeDepth=16;
  await assert.rejects(prepareCandidate(f.record,encodePng(f.image),f.read),/来源|source|光影|lighting/i);
  (f.record.relight as any).scene.source.documentDepth=16;
  await assert.rejects(prepareCandidate(f.record,encodePng(f.image),f.read),/来源|source|光影|lighting/i);
});
