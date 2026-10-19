import test from 'node:test';
import assert from 'node:assert/strict';
import * as preparation from '../src/app/candidate-preparation';
import {encodePng,decodePng,type Raster} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';
const {prepareCandidate}=preparation;

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
