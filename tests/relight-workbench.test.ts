import test from 'node:test';
import assert from 'node:assert/strict';
import type {Capture} from '../src/infrastructure/photoshop/photoshop';

const sample=():Capture=>({image:{width:2,height:2,rgba:new Uint16Array([12345,23456,34567,65535,20000,30000,40000,65535,30000,20000,10000,65535,1,2,3,65535])},snapshot:{documentId:11,width:2,height:2,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:16,historyId:5,sessionId:'s1',sourceHash:'fnv-source',bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,0,255]),sourceLayerIds:[2]} as any,selectionMask:new Uint8Array([255,128,0,255]),protectionMask:new Uint8Array(4)});
const api=()=>import('../src/features/relight/relight-session').catch(()=>null) as Promise<any>;

test('session freezes native capture and scene independently of caller and editor changes',async()=>{
  const module=await api();assert.equal(typeof module?.RelightSession,'function','relight session must exist');
  const captured=sample(),s=new module.RelightSession(captured,'snapshot-1','light-1');
  captured.image.rgba[0]=0;captured.snapshot.mask[0]=0;
  const frozen=s.freeze();s.editor.updateLight('light-1',{intensity:3});
  assert.equal(frozen.capture.image.rgba[0],12345);assert.equal(frozen.capture.snapshot.mask[0],255);
  assert.equal(frozen.scene.lights[0].intensity,1);assert.notEqual(s.fingerprint,frozen.fingerprint);
  assert.ok(frozen.capture.image.rgba instanceof Uint16Array);
});

test('source matching includes exact gray mask, profile, history, source pixels and original document id',async()=>{
  const module=await api();assert.ok(module?.RelightSession);
  const s=new module.RelightSession(sample(),'snapshot-1','light-1');
  s.assertCaptureMatches(sample());
  for(const mutate of [(c:Capture)=>c.snapshot.mask[1]--,(c:Capture)=>c.snapshot.historyId++,(c:Capture)=>c.snapshot.documentId++,(c:Capture)=>c.snapshot.profile='Adobe RGB',(c:Capture)=>c.image.rgba[0]++]){
    const c=sample();mutate(c);assert.throws(()=>s.assertCaptureMatches(c),/重新读取|re-read/i);
  }
});

test('reopening saved lighting refuses changed source until explicit reuse and resets editor history',async()=>{
  const module=await api();assert.ok(module?.RelightSession);
  const s=new module.RelightSession(sample(),'snapshot-1','light-1'),saved=s.editor.snapshot();
  saved.source.historyId++;saved.lights[0].intensity=2;
  assert.throws(()=>s.restore(saved),/重新读取|re-use|reuse|复用/i);
  s.restore(saved,true);assert.equal(s.editor.snapshot().source.historyId,5);
  assert.equal(s.editor.snapshot().lights[0].intensity,2);assert.equal(s.editor.canUndo,false);
});

test('task metadata sanitizes capabilities and omits protocol seed zero when unsupported',async()=>{
  const module=await api();assert.ok(module?.relightTaskMetadata);
  const s=new module.RelightSession(sample(),'snapshot-1','light-1');
  const metadata=module.relightTaskMetadata(s.freeze(),'job-1',{provider:'gemini',model:'gemini-model',edit:true,maxInputImages:3,maskMode:'guide',seed:false,apiKey:'secret'}, {width:512,height:512},8,0);
  assert.equal(metadata.requestId,'job-1');assert.equal(metadata.seed,undefined);assert.equal(metadata.capabilities.seedSupport,false);
  assert.equal(metadata.color.retainedSourceDepth,16);assert.equal(metadata.color.modelInput,'sRGB8');
  assert.doesNotMatch(JSON.stringify(metadata),/secret|apiKey/);
});

test('bounded draft saves serialize and a failed write does not discard the next edited scene',async()=>{
  const module=await api();assert.ok(module?.RelightDraftStore);
  const calls:any[]=[];let release!:()=>void;const block=new Promise<void>(r=>release=r);
  const store=new module.RelightDraftStore({json:async(name:string,value:any)=>{calls.push({name,value});if(calls.length===1){await block;throw Error('disk');}},readJson:async()=>null});
  const s=new module.RelightSession(sample(),'snapshot-1','light-1');
  const a=store.save(s.editor.snapshot()).catch(()=>{});s.editor.updateLight('light-1',{intensity:2});const b=store.save(s.editor.snapshot());
  await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,1);release();await Promise.all([a,b]);
  assert.equal(calls.length,2);assert.equal(calls[1].name,'relight-draft.json');assert.equal(calls[1].value.scene.lights[0].intensity,2);
  assert.doesNotMatch(JSON.stringify(calls),/rgba|mask":\[/);
});
