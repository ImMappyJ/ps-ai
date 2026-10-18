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

test('relight scope is frozen locally and changes only with explicit rebind while retaining edited lights',async()=>{
  const module=await api(),s=new module!.RelightSession(sample(),'snapshot-1','light-1');
  s.editor.updateLight('light-1',{intensity:2.5});const frozen=s.freeze();assert.equal(frozen.scope,'selection');
  const next=sample();next.snapshot.mask.fill(255);s.rebind(next,'snapshot-2','document');
  assert.equal(s.scope,'document');assert.equal(s.freeze().scope,'document');assert.equal(frozen.scope,'selection');
  assert.equal(s.editor.snapshot().lights[0].intensity,2.5);assert.equal(s.editor.snapshot().source.snapshotId,'snapshot-2');
  assert.equal('scope' in s.editor.snapshot(),false,'scope is local capture policy, not part of provider lighting instructions');
});

test('source matching includes exact gray mask, profile, history, source pixels and original document id',async()=>{
  const module=await api();assert.ok(module?.RelightSession);
  const s=new module.RelightSession(sample(),'snapshot-1','light-1');
  s.assertCaptureMatches(sample());
  for(const mutate of [(c:Capture)=>c.snapshot.mask[1]--,(c:Capture)=>c.selectionMask[1]--,(c:Capture)=>c.protectionMask[1]++,(c:Capture)=>c.snapshot.historyId++,(c:Capture)=>c.snapshot.documentId++,(c:Capture)=>c.snapshot.profile='Adobe RGB',(c:Capture)=>c.image.rgba[0]++]){
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

test('new relight submissions freeze an explicit output choice while legacy metadata keeps full results',async()=>{
  const module=await api(),session=new module!.RelightSession(sample(),'snapshot-1','light-1');
  assert.equal(session.freeze().outputKind,'lighting-layers');
  const frozen=session.freeze();session.setOutputKind('full-result');
  assert.equal(frozen.outputKind,'lighting-layers');assert.equal(session.freeze().outputKind,'full-result');
  const metadata=module!.relightTaskMetadata(frozen,'job-1',{provider:'comfyui',model:'qwen',edit:true,maxInputImages:3,maskMode:'guide',seed:true},{width:512,height:512},8,7);
  assert.equal(metadata.outputKind,'lighting-layers');assert.equal(module!.relightOutputKind({schemaVersion:1}),'full-result');
  assert.throws(()=>session.setOutputKind('compensation'),/output/i);
  assert.throws(()=>module!.relightOutputKind({outputKind:'unknown'}),/output/i);
  assert.throws(()=>module!.relightOutputKind({outputKind:null}),/output/i);
});

test('analysis source maps native mask coverage to the small raster and retains the host depth and frozen buffers',async()=>{
  const module=await api(),captured=sample();
  captured.snapshot.width=6;captured.snapshot.height=4;captured.snapshot.bounds={left:0,top:0,right:6,bottom:4};
  captured.snapshot.mask=new Uint8Array(24);captured.snapshot.mask.fill(255,12);
  captured.selectionMask=captured.snapshot.mask.slice();captured.protectionMask=new Uint8Array(24);
  (captured.snapshot as any).captureGeometry={kind:'relight-analysis',width:2,height:2};
  captured.image.rgba.fill(0);captured.image.rgba[11]=65535;captured.image.rgba[15]=65535;
  const session=new module!.RelightSession(captured,'analysis-1','light-1'),frozen=session.freeze();
  assert.equal(frozen.scene.source.documentDepth,16);assert.equal(frozen.capture.snapshot.mask,captured.snapshot.mask,'analysis owns native masks without another full-size clone');
  const next=sample();session.rebind(next,'native-2');
  assert.equal(frozen.capture.snapshot.captureGeometry.kind,'relight-analysis');assert.equal(frozen.capture.snapshot.mask.length,24);
  assert.equal(session.freeze().scene.source.snapshotId,'native-2');
});

test('source reread retains exact session snapshot ownership and rejects an invalid replacement atomically',async()=>{
  const module=await api(),session=new module!.RelightSession(sample(),'snapshot-1','light-1'),previous=session.freeze();
  assert.equal(typeof session.ownsSnapshot,'function');session.rebind(sample(),'snapshot-2');
  assert.equal(session.ownsSnapshot('snapshot-1'),true);assert.equal(session.ownsSnapshot('snapshot-2'),true);assert.equal(session.ownsSnapshot('foreign'),false);
  const active=session.freeze(),invalid=sample();invalid.snapshot.historyId=98;
  assert.throws(()=>session.rebind(invalid,''));assert.equal(session.freeze().capture,active.capture);assert.equal(session.freeze().scene.source.snapshotId,'snapshot-2');
  assert.equal(previous.scene.source.snapshotId,'snapshot-1');
  for(let id=3;id<=100;id++)session.rebind(sample(),`snapshot-${id}`);
  assert.throws(()=>session.rebind(sample(),'snapshot-101'),/上限|limit/i);assert.equal(session.ownsSnapshot('snapshot-1'),true);assert.equal(session.ownsSnapshot('snapshot-101'),false);
});

test('session accepts host enum depth only through the validated numeric capture depth and rejects ambiguous analysis',async()=>{
  const module=await api();
  for(const depth of [8,16] as const){
    const captured=sample();captured.snapshot.depth=depth===8?'bitDepth8':'bitDepth16';captured.snapshot.nativeDepth=depth;
    captured.snapshot.captureGeometry={kind:'relight-analysis',width:2,height:2};if(depth===8)captured.image.rgba=new Uint8Array(16).fill(255);
    const session=new module!.RelightSession(captured,'native-enum','light-1');assert.equal(session.freeze().scene.source.documentDepth,depth);
    assert.equal(session.sourceCapture.snapshot.depth,depth===8?'bitDepth8':'bitDepth16');
  }
  const ambiguous=sample();ambiguous.snapshot.depth='unknown-depth';assert.throws(()=>new module!.RelightSession(ambiguous,'bad','light-1'),/depth/i);
  const mismatch=sample();mismatch.snapshot.depth='bitDepth16';mismatch.snapshot.nativeDepth=16;mismatch.snapshot.captureGeometry={kind:'relight-analysis',width:2,height:2};mismatch.image.rgba=new Uint8Array(16).fill(255);
  assert.throws(()=>new module!.RelightSession(mismatch,'mismatch','light-1'),/depth/i);
});
