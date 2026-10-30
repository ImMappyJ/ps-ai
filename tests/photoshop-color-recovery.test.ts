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
function recoveryHost(depth:8|16=8,unverified=false) {
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
  const reader=async(doc:any)=>{reads++;if(unverified)return;if(doc.path!==source.path)throw Error('no bound original');return {kind:'srgb' as const,format:'png' as const,width:2,height:1,depth,reason:'png-srgb' as const};};
  const adapter=new PhotoshopAdapter(ps,'session-a',async()=>{},reader) as RecoveryAdapter;
  const undo=(doc:any)=>{const t=timelines.get(doc.id)!;assert.ok(t.cursor>0);restore(doc,t.states[--t.cursor]);};
  const redo=(doc:any)=>{const t=timelines.get(doc.id)!;assert.ok(t.cursor<t.states.length-1);restore(doc,t.states[++t.cursor]);};
  const capture=(id=ps.app.activeDocument.id)=>adapter.capture(0,undefined,id,depth,{preserveNativeDepth:true});
  const fourRounds=async()=>{let captured:Capture|undefined;for(let i=0;i<4;i++){captured=await capture();const doc=documents.find(d=>d.id===captured!.snapshot.documentId);await adapter.apply(captured.snapshot,captured.image,'AI');await doc.layers[0].delete();commit(doc);}return captured!;};
  return {ps,source,adapter,capture,documents,calls,registered,state,timelines,undo,redo,commit,makeDoc,fourRounds,reads:()=>reads,
    cancel:()=>{cancelled=true;},beforeModal:(fn:()=>void)=>{beforeModal=fn;},onRegister:(fn:(doc:any)=>void)=>{onRegister=fn;},onUnregister:(fn:()=>void)=>{onUnregister=fn;},failAssignment:()=>{failAssignment=true;},failRead:()=>{failRead=true;},failUnregister:()=>{failUnregister=true;}};
}

test('approximate capture retains layers, exact feathers/protection, native samples and its reason through undo/recovery',async()=>{
  for(const depth of [8,16] as const){
    const h=recoveryHost(depth,true);h.source.path=undefined;const original=h.state(h.source);
    const protection={documentId:h.source.id,width:2,height:1,bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([0,64]),sessionId:'session-a'};
    const captured=await h.adapter.capture(0,protection,h.source.id,depth,{preserveNativeDepth:true}),copy=h.ps.app.activeDocument;
    assert.equal(captured.snapshot.colorReason,'assumed-srgb');assert.deepEqual([...captured.selectionMask],[255,128]);assert.deepEqual([...captured.snapshot.mask],[255,96]);
    assert.equal(copy.layers[0].layers.length,1);assert.equal(copy.layers[0].layers[0].visible,false);assert.deepEqual(h.state(h.source),original);
    await h.adapter.apply(captured.snapshot,captured.image,'AI');h.undo(copy);
    const again=await h.capture(copy.id);assert.equal(again.snapshot.colorReason,'assumed-srgb');assert.deepEqual(again.image.rgba,captured.image.rgba);
    h.undo(copy);const undone=h.state(copy),redo=h.timelines.get(copy.id)!.states.map(state=>state.historyId);
    const recovered=await h.adapter.createRecoveredColorCopy(copy.id);assert.equal(recovered.colorReason,'assumed-srgb');
    const fresh=await h.capture(recovered.documentId);assert.equal(fresh.snapshot.colorReason,'assumed-srgb');assert.notEqual(fresh.snapshot.documentId,captured.snapshot.documentId);
    assert.deepEqual(h.state(copy),undone);assert.deepEqual(h.timelines.get(copy.id)!.states.map(state=>state.historyId),redo);assert.deepEqual(h.state(h.source),original);
    assert.equal(h.adapter.applicationMode(captured.snapshot),'unavailable');assert.equal(h.registered.size,0);
  }
});

test('dropped copy selections restore raw native feathers before snapshot and fresh capture, without baking protection',async()=>{
  for(const depth of [8,16] as const){
    const h=recoveryHost(depth,true),original=h.state(h.source),selection=JSON.stringify(h.source.selection),writes:any[]=[],buffers:any[]=[];
    h.onRegister(copy=>{copy.selection={bounds:null};});
    h.ps.imaging.createImageDataFromBuffer=async(values:any,options:any)=>{const data={values:values.slice(),...options,disposed:false,dispose(){this.disposed=true;}};buffers.push(data);return data;};
    h.ps.imaging.putSelection=async(options:any)=>{writes.push(options);h.ps.app.activeDocument.selection={bounds:{left:0,top:0,right:2,bottom:1}};};
    const protection={documentId:h.source.id,width:2,height:1,bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([0,64]),sessionId:'session-a'};
    const captured=await h.adapter.capture(0,protection,h.source.id,depth,{preserveNativeDepth:true}),copy=h.ps.app.activeDocument;
    assert.equal(writes.length,1);assert.equal(writes[0].documentID,copy.id);assert.deepEqual(writes[0].targetBounds,{left:0,top:0});assert.equal(writes[0].replace,true);
    assert.deepEqual([...buffers[0].values],depth===16?[65535,32896]:[255,128]);assert.equal(buffers[0].disposed,true);assert.equal(buffers[0].fullRange,depth===16?true:undefined);
    assert.deepEqual([...captured.selectionMask],[255,128]);assert.deepEqual([...captured.snapshot.mask],[255,96]);assert.equal(captured.snapshot.historyId,copy.activeHistoryState.id);
    await h.adapter.apply(captured.snapshot,captured.image,'AI');h.undo(copy);assert.equal(copy.activeHistoryState.id,captured.snapshot.historyId);
    const again=await h.capture(copy.id);assert.equal(again.snapshot.documentId,copy.id);assert.equal(again.snapshot.colorReason,'assumed-srgb');assert.deepEqual([...again.snapshot.mask],[255,128]);assert.equal(writes.length,1);
    assert.deepEqual(h.state(h.source),original);assert.equal(JSON.stringify(h.source.selection),selection);
  }
});

test('full document capture never restores or modifies a dropped duplicate selection',async()=>{
  const h=recoveryHost(8,true),selection=JSON.stringify(h.source.selection);let writes=0;
  h.onRegister(copy=>{copy.selection={bounds:null};});h.ps.imaging.putSelection=async()=>{writes++;};
  const captured=await h.adapter.capture(0,undefined,h.source.id,8,{selection:'document'});
  assert.deepEqual([...captured.snapshot.mask],[255,255]);assert.equal(h.ps.app.activeDocument.selection.bounds,null);assert.equal(JSON.stringify(h.source.selection),selection);assert.equal(writes,0);
});

test('failed or cancelled copy-selection writes roll back before pixels and close the new copy',async()=>{
  for(const failure of ['write','cancel','source-change','copy-profile']){
    const h=recoveryHost(8,true),original=h.state(h.source),selection=JSON.stringify(h.source.selection);let pixels=0;
    h.onRegister(copy=>{copy.selection={bounds:null};});h.ps.imaging.createImageDataFromBuffer=async(values:any,options:any)=>({values,...options,dispose(){}});
    h.ps.imaging.putSelection=async()=>{h.ps.app.activeDocument.selection={bounds:{left:0,top:0,right:2,bottom:1}};if(failure==='write')throw Error('selection write failed');if(failure==='cancel')h.cancel();if(failure==='source-change')h.source.activeHistoryState.id++;if(failure==='copy-profile')h.ps.app.activeDocument.colorProfileName='Adobe RGB (1998)';};
    h.ps.imaging.getPixels=async()=>{pixels++;throw Error('must not read pixels');};
    await assert.rejects(h.capture(),/selection write failed|取消|来源.*改变/);assert.equal(pixels,0);assert.equal(h.documents.length,1);assert.equal(h.ps.app.activeDocument.id,h.source.id);assert.equal(h.registered.size,0);
    assert.ok(h.calls.some(call=>call[0]==='resume'&&call[1]!==h.source.id&&call[2]===false));assert.equal(JSON.stringify(h.source.selection),selection);
    if(failure!=='source-change')assert.deepEqual(h.state(h.source),original);
  }
});

test('approximate capture cancellation, profile assignment failure and pixel failures close only the new copy',async()=>{
  for(const failure of ['cancel','assignment','pixels']){
    const h=recoveryHost(8,true),original=h.state(h.source);
    if(failure==='cancel')h.onRegister(()=>h.cancel());if(failure==='assignment')h.failAssignment();if(failure==='pixels')h.failRead();
    await assert.rejects(h.capture(),/取消|assignment failed|pixels failed/);
    assert.equal(h.documents.length,1);assert.deepEqual(h.state(h.source),original);assert.equal(h.ps.app.activeDocument.id,h.source.id);assert.equal(h.registered.size,0);
  }
});

test('unknown source reads still reject changed history before creating an approximate copy',async()=>{
  const h=recoveryHost(8,true),adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>{h.source.activeHistoryState.id++;return undefined;});
  await assert.rejects(adapter.capture(0,undefined,h.source.id),/状态已改变/);assert.equal(h.documents.length,1);assert.equal(h.calls.some(call=>call[0]==='duplicate'),false);
});

test('approximate capture cancelled after unregister cannot retain its newly assigned copy',async()=>{
  const h=recoveryHost(8,true),original=h.state(h.source);h.onUnregister(()=>h.cancel());
  await assert.rejects(h.capture(),/取消/);assert.equal(h.documents.length,1);assert.deepEqual(h.state(h.source),original);assert.equal(h.ps.app.activeDocument.id,h.source.id);assert.equal(h.registered.size,0);
});

test('failed close after late capture cancellation restores native auto-close protection',async()=>{
  const h=recoveryHost(8,true),original=h.state(h.source);
  h.onUnregister(()=>{h.cancel();h.ps.app.activeDocument.closeWithoutSaving=async()=>{throw Error('cancelled close');};});
  await assert.rejects(h.capture(),/cancelled close/);const copy=h.documents.find(doc=>doc.id!==h.source.id)!;
  assert.ok(copy);assert.deepEqual([...h.registered],[copy.id]);assert.deepEqual(h.state(h.source),original);assert.equal(h.ps.app.activeDocument.id,h.source.id);h.undo(copy);assert.equal(h.adapter.colorRecoveryAvailability(copy.id),'unavailable');
});

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

test('unproven pathless documents and old sessions cannot recover even with a residual ICC name',async()=>{
  const h=recoveryHost();await h.capture();const doc=h.ps.app.activeDocument;h.undo(doc);
  doc._profile='sRGB IEC61966-2.1';
  for(const session of ['session-a','session-b']){
    const restarted=new PhotoshopAdapter(h.ps,session) as RecoveryAdapter;
    assert.equal(restarted.colorRecoveryAvailability?.(doc.id),'unavailable');await assert.rejects(restarted.createRecoveredColorCopy(doc.id));
  }
  const arbitrary=h.makeDoc({path:undefined,_profile:'sRGB IEC61966-2.1'});assert.equal(h.adapter.colorRecoveryAvailability(arbitrary.id),'unavailable');
  await assert.rejects(h.adapter.createRecoveredColorCopy(arbitrary.id));assert.equal(h.documents.length,3);
});

test('proven NONE origins remain recoverable after tagged recapture and an Undo residual profile name',async()=>{
  for(const depth of [8,16] as const){
    const h=recoveryHost(depth),oldCandidate=await h.capture(),doc=h.ps.app.activeDocument;
    await h.capture();assert.equal(h.adapter.colorRecoveryAvailability(doc.id),'not-needed');
    h.undo(doc);doc._profile='sRGB IEC61966-2.1';
    const before=h.state(doc),timeline=h.timelines.get(doc.id)!,redo=timeline.states.map(s=>s.historyId);
    assert.equal(doc.colorProfileType,'none');assert.equal(h.adapter.colorRecoveryAvailability(doc.id),'available');
    await assert.rejects(h.capture(),/色彩空间|配置文件/);assert.equal(h.documents.length,2);
    const result=await h.adapter.createRecoveredColorCopy(doc.id),fresh=h.ps.app.activeDocument;
    assert.notEqual(result.documentId,doc.id);assert.equal(fresh.colorProfileType,'custom');
    assert.deepEqual(h.state(doc),before);assert.deepEqual(timeline.states.map(s=>s.historyId),redo);
    assert.equal(h.adapter.applicationMode(oldCandidate.snapshot),'unavailable');
    const captured=await h.capture();assert.equal(captured.snapshot.documentId,fresh.id);assert.equal(captured.snapshot.nativeDepth,depth);
    assert.equal(h.reads(),1);assert.equal(h.documents.length,3);
  }
});

test('exact recovery rejects manual profile, geometry, native depth, recursive layers, path and unrelated history changes',async()=>{
  const mutations=[(d:any)=>d.colorProfileType='unknown',(d:any)=>d.width++,(d:any)=>d.height++,(d:any)=>d.mode='gray',(d:any)=>d.bitsPerChannel=16,(d:any)=>d.layers[0].layers[0].id++,(d:any)=>d.layers.push({...d.layers[0],id:99999}),(d:any)=>d.path='D:\\other.png',(d:any)=>d.activeHistoryState={id:d.activeHistoryState.id+10000},(d:any)=>d.quickMaskMode=true];
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

test('cancellation after unregister retains host auto-close protection when explicit copy close fails',async()=>{
  const h=recoveryHost();await h.capture();const old=h.ps.app.activeDocument;h.undo(old);
  const before=h.state(old),redo=h.timelines.get(old.id)!.states.map(s=>s.historyId);h.ps.app.activeDocument=h.source;
  h.onUnregister(()=>{h.cancel();h.ps.app.activeDocument.closeWithoutSaving=async()=>{throw Error('cancelled close');};});
  await assert.rejects(h.adapter.createRecoveredColorCopy(old.id),/cancelled close/);
  const failed=h.documents.find(doc=>doc.id!==h.source.id&&doc.id!==old.id)!;
  assert.ok(failed);assert.deepEqual([...h.registered],[failed.id]);
  assert.deepEqual(h.state(old),before);assert.deepEqual(h.timelines.get(old.id)!.states.map(s=>s.historyId),redo);
  assert.equal(h.ps.app.activeDocument.id,h.source.id);assert.equal(h.adapter.colorRecoveryAvailability(old.id),'available');
  h.undo(failed);assert.equal(h.adapter.colorRecoveryAvailability(failed.id),'unavailable');
});

test('session recovery provenance is bounded while retaining the newest verified copies',async()=>{
  const h=recoveryHost(),copies:any[]=[];
  for(let i=0;i<33;i++){h.ps.app.activeDocument=h.source;await h.capture();copies.push(h.ps.app.activeDocument);}
  for(const doc of copies)h.undo(doc);
  assert.equal(h.adapter.colorRecoveryAvailability?.(copies[0].id),'unavailable');assert.equal(h.adapter.colorRecoveryAvailability(copies[32].id),'available');
  assert.equal(h.documents.length,34);assert.equal(h.reads(),33);
});
