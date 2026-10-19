import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoshopAdapter,type Capture} from '../src/infrastructure/photoshop/photoshop';
import type {SourceColorReason} from '../src/infrastructure/photoshop/source-color';

type RecoveryAdapter=PhotoshopAdapter&{
  colorRecoveryAvailability(id:number):'available'|'not-needed'|'unavailable';
  createRecoveredColorCopy(id:number):Promise<{documentId:number;workingCopyOf:number;colorReason:SourceColorReason}>;
};

// A native-history boundary double: setters change live state, while committed
// transactions add undoable states and duplication starts a separate history.
function recoveryHost(depth:8|16=8) {
  let nextDocument=10,nextHistory=100,nextLayer=1000,nextSuspension=0,inside=false,reads=0;
  const documents:any[]=[],timelines=new Map<number,{states:any[];cursor:number}>(),suspensions=new Map<number,{doc:any;state:any}>(),registered=new Set<number>();
  const calls:any[]=[];
  let cancelled=false,beforeModal:undefined|(()=>void),onRegister:undefined|((doc:any)=>void),onUnregister:undefined|(()=>void),failAssignment=false,failRead=false,failUnregister=false;
  const values=(layers:any[]):any[]=>layers.map(layer=>({id:layer.id,visible:layer.visible,opacity:layer.opacity,fillOpacity:layer.fillOpacity,kind:layer.kind,blendMode:layer.blendMode,isClippingMask:layer.isClippingMask,...(layer.layers?{layers:values(layer.layers)}:{})}));
  const state=(doc:any)=>({historyId:doc.activeHistoryState.id,width:doc.width,height:doc.height,mode:doc.mode,depth:doc.bitsPerChannel,profile:doc.colorProfileName,type:doc.colorProfileType,path:doc.path,saved:doc.saved,quickMask:doc.quickMaskMode,layers:values(doc.layers)});
  function layers(doc:any,raw:any[]):any[]{return raw.map(value=>({...value,...(value.layers?{layers:layers(doc,value.layers)}:{}),move:async()=>{},delete:async()=>{doc.layers=doc.layers.filter((layer:any)=>layer.id!==value.id);}}));}
  function restore(doc:any,s:any){Object.assign(doc,{width:s.width,height:s.height,mode:s.mode,bitsPerChannel:s.depth,_profile:s.profile,colorProfileType:s.type,path:s.path,saved:s.saved,quickMaskMode:s.quickMask,activeHistoryState:{id:s.historyId}});doc.layers=layers(doc,s.layers);}
  function commit(doc:any){doc.activeHistoryState={id:++nextHistory};const timeline=timelines.get(doc.id)!;timeline.states.splice(timeline.cursor+1);timeline.states.push(state(doc));timeline.cursor++;}
  function makeDoc(raw?:any):any {
    const doc:any={id:++nextDocument,name:'fixture',width:2,height:1,mode:'rgb',bitsPerChannel:depth,_profile:'None',colorProfileType:'none',path:'D:\\fixture.png',saved:false,quickMaskMode:false,selection:{bounds:{left:0,top:0,right:2,bottom:1}},activeHistoryState:{id:++nextHistory},layers:[],...raw};
    Object.defineProperty(doc,'colorProfileName',{get:()=>doc._profile,set:(value:string)=>{if(failAssignment)throw Error('assignment failed');doc._profile=value;doc.colorProfileType=value==='None'?'none':'custom';},configurable:true});
    doc.layers=layers(doc,raw?.layers??[{id:++nextLayer,visible:true,opacity:100,fillOpacity:100,kind:'normal',blendMode:'normal',isClippingMask:false,layers:[{id:++nextLayer,visible:false,opacity:100,fillOpacity:100,kind:'normal',blendMode:'normal',isClippingMask:false}]}]);
    Object.defineProperty(doc,'historyStates',{get:()=>[...timelines.get(doc.id)!.states.map(s=>({id:s.historyId})),{id:undefined},{id:undefined}]});
    doc.duplicate=async(_name:string,merged:boolean)=>{assert.equal(inside,true);assert.equal(merged,false);calls.push(['duplicate',doc.id]);const remap=(raw:any[]):any[]=>raw.map(layer=>({...layer,id:++nextLayer,...(layer.layers?{layers:remap(layer.layers)}:{})}));const copy=makeDoc({width:doc.width,height:doc.height,mode:doc.mode,bitsPerChannel:doc.bitsPerChannel,_profile:doc._profile,colorProfileType:doc.colorProfileType,path:undefined,saved:false,layers:remap(values(doc.layers))});ps.app.activeDocument=copy;return copy;};
    doc.closeWithoutSaving=async()=>{calls.push(['close',doc.id]);documents.splice(documents.findIndex(d=>d.id===doc.id),1);};
    doc.createLayer=async()=>{const layer=layers(doc,[{id:++nextLayer,visible:true,opacity:100,fillOpacity:100,kind:'normal',blendMode:'normal',isClippingMask:false}])[0];doc.layers.unshift(layer);return layer;};
    documents.push(doc);timelines.set(doc.id,{states:[state(doc)],cursor:0});return doc;
  }
  const source=makeDoc();
  const data=(bytes:Uint8Array|Uint16Array,components:number)=>({width:2,height:1,components,componentSize:bytes instanceof Uint16Array?16:8,getData:async()=>bytes,dispose(){}});
  const ps:any={app:{documents,activeDocument:source},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},ColorProfileType:{NONE:'none'},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'},ElementPlacement:{PLACEBEFORE:'before'}},
    core:{executeAsModal:async(fn:any)=>{assert.equal(inside,false);beforeModal?.();beforeModal=undefined;inside=true;try{return await fn({get isCancelled(){return cancelled;},hostControl:{
      registerAutoCloseDocument:async(id:number)=>{registered.add(id);onRegister?.(documents.find(doc=>doc.id===id));},
      unregisterAutoCloseDocument:async(id:number)=>{if(failUnregister){failUnregister=false;throw Error('unregister failed');}assert.equal(registered.delete(id),true);onUnregister?.();},
      suspendHistory:async(o:any)=>{const doc=documents.find(d=>d.id===o.documentID);const id=++nextSuspension;suspensions.set(id,{doc,state:state(doc)});return id;},
      resumeHistory:async(id:number,accept:boolean)=>{const pending=suspensions.get(id)!;calls.push(['resume',pending.doc.id,accept]);if(accept)commit(pending.doc);else restore(pending.doc,pending.state);suspensions.delete(id);}
    }});}finally{inside=false;}}},action:{batchPlay:async(cmd:any[])=>cmd.map(()=>({}))},imaging:{
      getSelection:async()=>({imageData:data(new Uint8Array([255,128]),1),sourceBounds:{left:0,top:0,right:2,bottom:1}}),
      getPixels:async(o:any)=>{if(failRead)throw Error('pixels failed');const doc=documents.find(d=>d.id===o.documentID),max=doc.bitsPerChannel===16?65535:255;const bytes=doc.bitsPerChannel===16?new Uint16Array([12345,23456,34567,max,11111,22222,33333,max]):new Uint8Array([20,30,40,max,50,60,70,max]);return {imageData:data(bytes,4),sourceBounds:{left:0,top:0,right:2,bottom:1}};},
      createImageDataFromBuffer:async(bytes:any,o:any)=>data(bytes,o.components),putPixels:async()=>{},putLayerMask:async()=>{}
    }};
  const reader=async(doc:any)=>{reads++;if(doc.path!==source.path)throw Error('no bound original');return {kind:'srgb' as const,format:'png' as const,width:2,height:1,depth,reason:'png-srgb' as const};};
  const adapter=new PhotoshopAdapter(ps,'session-a',async()=>{},reader) as RecoveryAdapter;
  const undo=(doc:any)=>{const t=timelines.get(doc.id)!;assert.ok(t.cursor>0);restore(doc,t.states[--t.cursor]);};
  const redo=(doc:any)=>{const t=timelines.get(doc.id)!;assert.ok(t.cursor<t.states.length-1);restore(doc,t.states[++t.cursor]);};
  const capture=(id=ps.app.activeDocument.id)=>adapter.capture(0,undefined,id,depth,{preserveNativeDepth:true});
  const fourRounds=async()=>{let captured:Capture|undefined;for(let i=0;i<4;i++){captured=await capture();const doc=documents.find(d=>d.id===captured!.snapshot.documentId);await adapter.apply(captured.snapshot,captured.image,'AI');await doc.layers[0].delete();commit(doc);}return captured!;};
  return {ps,source,adapter,capture,documents,calls,registered,state,timelines,undo,redo,commit,makeDoc,fourRounds,reads:()=>reads,
    cancel:()=>{cancelled=true;},beforeModal:(fn:()=>void)=>{beforeModal=fn;},onRegister:(fn:(doc:any)=>void)=>{onRegister=fn;},onUnregister:(fn:()=>void)=>{onUnregister=fn;},failAssignment:()=>{failAssignment=true;},failRead:()=>{failRead=true;},failUnregister:()=>{failUnregister=true;}};
}

test('four apply/delete rounds recover only the exact preassignment state into a new RGB8/16 copy, retaining old redo',async()=>{
  for(const depth of [8,16] as const){
    const h=recoveryHost(depth),original=h.state(h.source),oldCandidate=await h.fourRounds(),old=h.ps.app.activeDocument,tail=h.state(old),timeline=h.timelines.get(old.id)!;
    assert.equal(h.adapter.colorRecoveryAvailability?.(old.id),'not-needed');
    for(let i=0;i<8;i++)h.undo(old);
    assert.equal(h.adapter.colorRecoveryAvailability(old.id),'not-needed');
    h.undo(old);const undone=h.state(old),redoIds=timeline.states.map(s=>s.historyId);
    assert.equal(old.colorProfileType,'none');assert.equal(old.path,undefined);assert.equal(h.adapter.colorRecoveryAvailability(old.id),'available');
    const result=await h.adapter.createRecoveredColorCopy(old.id),fresh=h.ps.app.activeDocument;
    assert.notEqual(result.documentId,old.id);assert.deepEqual(result,{documentId:fresh.id,workingCopyOf:old.id,colorReason:'png-srgb'});
    assert.deepEqual(h.state(old),undone);assert.deepEqual(timeline.states.map(s=>s.historyId),redoIds);assert.equal(timeline.cursor,0);
    assert.deepEqual(h.state(h.source),original);assert.equal(h.reads(),1);assert.equal(h.registered.size,0);
    assert.equal(h.adapter.applicationMode(oldCandidate.snapshot),'unavailable');
    const captured=await h.capture(fresh.id);assert.equal(captured.snapshot.documentId,fresh.id);assert.equal(captured.snapshot.profile,'sRGB IEC61966-2.1');assert.equal(captured.snapshot.nativeDepth,depth);assert.deepEqual(captured.image.rgba,oldCandidate.image.rgba);
    assert.equal(h.adapter.sourceAvailability(oldCandidate.snapshot),'changed');
    for(let i=0;i<9;i++)h.redo(old);assert.deepEqual(h.state(old),tail);
    h.undo(fresh);assert.equal(h.adapter.colorRecoveryAvailability(fresh.id),'available');
  }
});

test('valid current ICC on a pathless document bypasses recovery and original-file access',async()=>{
  const h=recoveryHost(),doc=h.makeDoc({_profile:'Adobe RGB (1998)',colorProfileType:'custom',path:undefined});h.ps.app.activeDocument=doc;
  assert.equal(h.adapter.colorRecoveryAvailability?.(doc.id),'not-needed');
  await assert.rejects(h.adapter.createRecoveredColorCopy(doc.id));
  const captured=await h.capture(doc.id);assert.equal(captured.snapshot.profile,'Adobe RGB (1998)');assert.equal(h.reads(),0);assert.equal(h.documents.length,2);
});

test('unproven pathless documents, old sessions and NONE with a residual ICC name cannot recover',async()=>{
  const h=recoveryHost();await h.capture();const doc=h.ps.app.activeDocument;h.undo(doc);
  const previous=new PhotoshopAdapter(h.ps,'session-b') as RecoveryAdapter;
  assert.equal(previous.colorRecoveryAvailability?.(doc.id),'unavailable');await assert.rejects(previous.createRecoveredColorCopy(doc.id));
  const arbitrary=h.makeDoc({path:undefined});assert.equal(h.adapter.colorRecoveryAvailability(arbitrary.id),'unavailable');
  doc._profile='sRGB IEC61966-2.1';doc.colorProfileType='none';assert.equal(h.adapter.colorRecoveryAvailability(doc.id),'unavailable');
  await assert.rejects(h.adapter.createRecoveredColorCopy(doc.id));assert.equal(h.documents.length,3);
});

test('exact recovery rejects manual profile, geometry, native depth, recursive layers, path and unrelated history changes',async()=>{
  const mutations=[(d:any)=>d._profile='different untagged name',(d:any)=>d.width++,(d:any)=>d.height++,(d:any)=>d.mode='gray',(d:any)=>d.bitsPerChannel=16,(d:any)=>d.layers[0].layers[0].id++,(d:any)=>d.layers.push({...d.layers[0],id:99999}),(d:any)=>d.path='D:\\other.png',(d:any)=>d.activeHistoryState={id:d.activeHistoryState.id+10000},(d:any)=>d.quickMaskMode=true];
  for(const mutate of mutations){
    const h=recoveryHost();await h.capture();const doc=h.ps.app.activeDocument;h.undo(doc);assert.equal(h.adapter.colorRecoveryAvailability?.(doc.id),'available');
    mutate(doc);assert.equal(h.adapter.colorRecoveryAvailability(doc.id),'unavailable');await assert.rejects(h.adapter.createRecoveredColorCopy(doc.id));assert.equal(h.documents.length,2);assert.equal(h.reads(),1);
  }
});

test('recovery revalidates session proof after modal entry and keeps the previous active document on rejection',async()=>{
  const h=recoveryHost();await h.capture();const doc=h.ps.app.activeDocument;h.undo(doc);h.ps.app.activeDocument=h.source;
  assert.equal(h.adapter.colorRecoveryAvailability?.(doc.id),'available');h.beforeModal(()=>doc.layers[0].layers[0].id++);
  await assert.rejects(h.adapter.createRecoveredColorCopy(doc.id));assert.equal(h.ps.app.activeDocument.id,h.source.id);assert.equal(h.documents.length,2);assert.equal(h.calls.filter(c=>c[0]==='duplicate').length,1);
});

test('native wrapper replacement preserves exact proof while adapter session changes revoke it',async()=>{
  const h=recoveryHost();await h.capture();const doc=h.ps.app.activeDocument;h.undo(doc);
  const wrapper=Object.create(doc);h.documents.splice(h.documents.indexOf(doc),1,wrapper);h.ps.app.activeDocument=wrapper;
  assert.equal(h.adapter.colorRecoveryAvailability(wrapper.id),'available');
  doc._profile='Adobe RGB (1998)';doc.colorProfileType='custom';assert.equal(h.adapter.colorRecoveryAvailability(wrapper.id),'not-needed');
  doc._profile='None';doc.colorProfileType='none';h.adapter.sessionId='session-b';assert.equal(h.adapter.colorRecoveryAvailability(wrapper.id),'unavailable');
  h.adapter.sessionId='session-a';assert.equal(h.adapter.colorRecoveryAvailability(wrapper.id),'unavailable');
});

test('cancelled or failed recovery closes only its new document and retains the old redo chain and activity',async()=>{
  for(const failure of ['before','after-duplicate','assignment','unregister','after-unregister']){
    const h=recoveryHost();await h.capture();const doc=h.ps.app.activeDocument;h.undo(doc);const old=h.state(doc),history=h.timelines.get(doc.id)!.states.map(s=>s.historyId);h.ps.app.activeDocument=h.source;
    assert.equal(h.adapter.colorRecoveryAvailability?.(doc.id),'available');
    if(failure==='before')h.cancel();if(failure==='after-duplicate')h.onRegister(()=>h.cancel());if(failure==='assignment')h.failAssignment();if(failure==='unregister')h.failUnregister();if(failure==='after-unregister')h.onUnregister(()=>h.cancel());
    await assert.rejects(h.adapter.createRecoveredColorCopy(doc.id));
    assert.deepEqual(h.state(doc),old);assert.deepEqual(h.timelines.get(doc.id)!.states.map(s=>s.historyId),history);assert.equal(h.ps.app.activeDocument.id,h.source.id);assert.equal(h.documents.length,2);assert.equal(h.registered.size,0);assert.equal(h.reads(),1);
  }
});

test('failed capture does not register recovery provenance and closed document identities are forgotten',async()=>{
  const h=recoveryHost();h.failRead();await assert.rejects(h.capture(),/pixels failed/);assert.equal(h.documents.length,1);
  const failedId=h.calls.find(c=>c[0]==='close')[1];assert.equal(h.adapter.colorRecoveryAvailability?.(failedId),'unavailable');
  const live=recoveryHost();await live.capture();const doc=live.ps.app.activeDocument;live.undo(doc);const id=doc.id;assert.equal(live.adapter.colorRecoveryAvailability(id),'available');
  await doc.closeWithoutSaving();assert.equal(live.adapter.colorRecoveryAvailability(id),'unavailable');
  const reused=live.makeDoc({id,path:undefined});assert.equal(live.adapter.colorRecoveryAvailability(reused.id),'unavailable');
});

test('session recovery provenance is bounded while retaining the newest verified copies',async()=>{
  const h=recoveryHost(),copies:any[]=[];
  for(let i=0;i<33;i++){h.ps.app.activeDocument=h.source;await h.capture();copies.push(h.ps.app.activeDocument);}
  for(const doc of copies)h.undo(doc);
  assert.equal(h.adapter.colorRecoveryAvailability?.(copies[0].id),'unavailable');assert.equal(h.adapter.colorRecoveryAvailability(copies[32].id),'available');
  assert.equal(h.documents.length,34);assert.equal(h.reads(),33);
});
