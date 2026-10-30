import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter,Snapshot} from '../src/infrastructure/photoshop/photoshop';
import {prepareBackgroundCandidate} from '../src/imaging/composite';

function host() {
  const calls:any[]=[];let inside=false;let serial=0;
  let layerSerial=55;
  const doc:any={id:11,width:100,height:80,colorProfileName:'sRGB IEC61966-2.1',mode:'rgb',bitsPerChannel:8,activeHistoryState:{id:91},selection:{bounds:{left:40,top:30,right:42,bottom:32}},layers:[{id:2,kind:'normal',blendMode:'normal',visible:true,opacity:100,fillOpacity:100,isClippingMask:false}],activeLayers:[],createLayer:async()=>{assert.equal(inside,true);calls.push('new-layer');const layer={id:layerSerial++,isClippingMask:false,move:async(...args:any[])=>calls.push(['move',...args]),delete:async()=>{calls.push(['delete',layer.id]);doc.layers=doc.layers.filter((l:any)=>l.id!==layer.id);}};doc.layers.unshift(layer);return layer;}};
  const data=(bytes:Uint8Array|Uint16Array,w:number,h:number,components:number)=>({width:w,height:h,components,componentSize:bytes instanceof Uint16Array?16:8,getData:async()=>bytes,dispose:()=>calls.push('dispose')});
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'},ElementPlacement:{PLACEBEFORE:'before'}},
    core:{executeAsModal:async(fn:any)=>{assert.equal(inside,false);inside=true;try{return await fn({hostControl:{suspendHistory:async(args:any)=>{calls.push(['suspend',args]);return ++serial;},resumeHistory:async(id:number,commit:boolean)=>{calls.push(['resume',id,commit]);if(commit)doc.activeHistoryState={id:doc.activeHistoryState.id+1};}}});}finally{inside=false;}}},
    action:{batchPlay:async(commands:any[])=>{assert.equal(inside,true);calls.push(['batch',commands]);return commands.map(()=>({}));}},
    imaging:{getSelection:async(options:any)=>{calls.push(['getSelection',options]);return {imageData:data(new Uint8Array([255,128,0,255]),2,2,1),sourceBounds:{left:40,top:30,right:42,bottom:32}};},
      getPixels:async(options:any)=>{calls.push(['getPixels',options]);return {imageData:data(new Uint8Array([20,30,40,255]),1,1,4),sourceBounds:{left:40,top:30,right:41,bottom:31},level:0};},
      createImageDataFromBuffer:async(bytes:Uint8Array|Uint16Array,options:any)=>{calls.push(['buffer',bytes.slice(),options]);return data(bytes,options.width,options.height,options.components);},
      putPixels:async(options:any)=>{calls.push(['putPixels',options]);},putLayerMask:async(options:any)=>calls.push(['putMask',options])}
  };return {ps,doc,calls,adapter:new PhotoshopAdapter(ps,'session-a')};
}
function snap():Snapshot {return {documentId:11,width:100,height:80,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:8,historyId:91,sessionId:'session-a',bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([255,128,0,255]),sourceHash:'fixture'};}

test('capture reports a required selection and oversized scope before requesting source-file access',async()=>{
  for(const oversized of [false,true]){
    const h=host();h.doc.colorProfileName='';let reads=0;
    if(oversized){h.doc.width=9001;h.doc.height=5000;h.doc.selection.bounds={left:0,top:0,right:9001,bottom:5000};}else h.doc.selection.bounds=null;
    const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>{reads++;throw Error('picker should not open');});
    await assert.rejects(adapter.capture(),(e:any)=>oversized?/4500/.test(e.message):e.code==='selection-required'&&e.stage==='capture');
    assert.equal(reads,0);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
  }
});

test('picker-time selection removal, scope changes and source switching stop before source mutation',async()=>{
  for(const change of ['remove','bounds','source']){
    const h=host();h.doc.colorProfileName='';let duplicates=0;h.doc.duplicate=async()=>{duplicates++;throw Error('must not duplicate');};
    const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>{
      if(change==='remove')h.doc.selection.bounds=null;
      if(change==='bounds')h.doc.selection.bounds={left:41,top:30,right:43,bottom:32};
      if(change==='source'){const other={...h.doc,id:22};h.ps.app.documents.push(other);h.ps.app.activeDocument=other;}
      return {kind:'srgb',format:'webp',width:100,height:80,depth:8,reason:'webp-default'};
    });
    await assert.rejects(adapter.capture(),(e:any)=>change==='remove'?e.code==='selection-required':/改变|切换/.test(e.message));
    assert.equal(duplicates,0);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
  }
});

test('explicit document scope captures opaque native16 with full editable coverage minus protection without reading or changing selection',async()=>{
  for(const depth of [8,16] as const){
    const h=host();h.doc.width=2;h.doc.height=1;h.doc.bitsPerChannel=depth;h.doc.selection.bounds=null;h.doc.colorProfileName='Adobe RGB (1998)';
    const pixels=depth===16?new Uint16Array([12345,23456,34567,65535,11111,22222,33333,65534]):new Uint8Array([20,30,40,255,50,60,70,255]);
    h.ps.imaging.getSelection=async()=>{throw Error('whole-image scope must not access Photoshop selection');};
    h.ps.imaging.getPixels=async(o:any)=>{h.calls.push(['getPixels',o]);return {imageData:{width:2,height:1,components:4,componentSize:depth,getData:async()=>pixels,dispose(){}},sourceBounds:{left:0,top:0,right:2,bottom:1}};};
    const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>{throw Error('valid ICC must not request a file');});
    const protection={documentId:11,width:2,height:1,bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([0,128]),sessionId:'session-a'};
    const c=await adapter.capture(0,protection,11,8,{selection:'document',preserveNativeDepth:true} as any);
    assert.deepEqual(c.snapshot.bounds,{left:0,top:0,right:2,bottom:1});assert.deepEqual([...c.selectionMask],[255,255]);assert.deepEqual([...c.snapshot.mask],[255,127]);
    assert.deepEqual([...c.image.rgba],[...pixels]);assert.equal(c.snapshot.profile,'Adobe RGB (1998)');assert.equal(h.doc.selection.bounds,null);assert.equal(h.calls.some(c=>c[0]==='batch'),false);
  }
});

test('relight can retain native16 capture independently of selected provider output depth',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getPixels=async()=>({imageData:{width:1,height:1,components:4,componentSize:16,getData:async()=>new Uint16Array([12345,23456,34567,65534]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const c=await h.adapter.capture(0,undefined,11,8,{preserveNativeDepth:true} as any);
  assert.ok(c.image.rgba instanceof Uint16Array);
  assert.deepEqual((c.snapshot as any).sourceLayerIds,[2]);
  await assert.rejects(h.adapter.capture(0,undefined,11,8,{preserveNativeDepth:'yes'} as any),/捕获策略/);
});
test('native16 capture and application retain non-257 colors/alpha;8 target converts explicitly',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getPixels=async()=>({imageData:{width:1,height:1,components:4,componentSize:16,getData:async()=>new Uint16Array([12345,23456,34567,45678]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const c=await h.adapter.capture(0,undefined,11,16);const at=(30*66+32)*4;assert.ok(c.image.rgba instanceof Uint16Array);assert.deepEqual([...c.image.rgba.slice(at,at+4)],[12345,23456,34567,45678]);
  const patch16={width:2,height:2,rgba:new Uint16Array([12345,23456,34567,45678,12345,23456,34567,65535,12345,23456,34567,65535,12345,23456,34567,65535])};
  await h.adapter.apply({...snap(),depth:16},patch16,'precise');assert.deepEqual([...h.calls.find(c=>c[0]==='buffer')[1].slice(0,4)],[12345,23456,34567,45678]);
  const h8=host();await h8.adapter.apply(snap(),patch16,'8 target');assert.deepEqual([...h8.calls.find(c=>c[0]==='buffer')[1].slice(0,4)],[48,91,135,178]);
});
const patch={width:2,height:2,rgba:new Uint8Array([255,0,0,128,255,0,0,255,255,0,0,255,255,0,0,255])};

// The live profile setter does not itself establish the duplicate's committed
// history baseline. Native undo reads the stored history state, not that setter.
function colorHistoryHost() {
  const h=host();h.ps.constants.ColorProfileType={NONE:'none',CUSTOM:'customEnum'};
  h.doc.path='D:\\Pictures\\source.webp';h.doc.colorProfileName='None';h.doc.colorProfileType='none';h.doc.saved=false;
  let profile='None',type='none',nextHistory=200,reads=0;
  const copy:any={...h.doc,id:22,path:undefined,activeHistoryState:{id:200},layers:h.doc.layers.map((l:any)=>({...l,id:9})),closeWithoutSaving:async()=>{h.ps.app.documents=h.ps.app.documents.filter((d:any)=>d!==copy);}};
  Object.defineProperties(copy,{
    colorProfileName:{get:()=>profile,set:(value:string)=>{profile=value;type=value==='None'?'none':'customEnum';},configurable:true},
    colorProfileType:{get:()=>type,set:(value:string)=>{type=value;},configurable:true}
  });
  copy.createLayer=async()=>{const layer={id:56,isClippingMask:false,move:async()=>{}};copy.layers.unshift(layer);return layer;};
  h.ps.imaging.putSelection=async(options:any)=>{h.calls.push(['putSelection',options]);copy.selection={bounds:{...h.doc.selection.bounds}};};
  const state=()=>({id:copy.activeHistoryState.id,profile,type,layers:[...copy.layers]});
  const history=[state()],suspensions=new Map<number,any>();let serial=0;
  h.doc.duplicate=async(_name:string,merge:boolean)=>{assert.equal(merge,false);h.ps.app.documents.push(copy);h.ps.app.activeDocument=copy;return copy;};
  const modal=h.ps.core.executeAsModal;
  h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{
    registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{},
    suspendHistory:async(options:any)=>{assert.equal(options.documentID,22);h.calls.push(['suspend-copy',options]);const id=++serial;suspensions.set(id,state());return id;},
    resumeHistory:async(id:number,commit:boolean)=>{h.calls.push(['resume-copy',id,commit]);if(commit){copy.activeHistoryState={id:++nextHistory};history.push(state());}else{const prior=suspensions.get(id);profile=prior.profile;type=prior.type;copy.layers=prior.layers;}suspensions.delete(id);}
  }}));
  const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async(doc:any)=>{
    reads++;if(doc.path!==h.doc.path)throw new Error('来源没有可核对的原文件；请在副本中指定正确配置文件后重试');
    return {kind:'srgb',format:'webp',width:100,height:80,depth:8,reason:'webp-default'};
  });
  const undo=()=>{assert.ok(history.length>1);history.pop();const prior=history[history.length-1]!;profile=prior.profile;type=prior.type;copy.activeHistoryState={id:prior.id};copy.layers=[...prior.layers];};
  return {...h,copy,adapter,undo,reads:()=>reads};
}

test('unprofiled imported composites capture an approximate isolated copy without reading a layer file',async()=>{
  for(const depth of [8,16] as const){
    const h=colorHistoryHost();h.doc.path=undefined;h.doc.bitsPerChannel=depth;h.copy.bitsPerChannel=depth;
    const adapter=new PhotoshopAdapter(h.ps,'session-a');
    const originalHistory=h.doc.activeHistoryState.id,originalSelection=JSON.stringify(h.doc.selection.bounds);
    const protection={documentId:11,width:100,height:80,bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([0,64,0,0]),sessionId:'session-a'};
    const captured=await adapter.capture(0,protection,11,8,{preserveNativeDepth:true});
    assert.equal(captured.snapshot.colorReason,'assumed-srgb');assert.equal(captured.snapshot.documentId,22);assert.equal(captured.workingCopyOf,11);
    assert.equal(captured.snapshot.nativeDepth,depth);assert.equal(h.doc.colorProfileName,'None');assert.equal(h.doc.activeHistoryState.id,originalHistory);
    assert.equal(JSON.stringify(h.doc.selection.bounds),originalSelection);assert.equal(captured.protectionMask.some(value=>value===64),true);
    const again=await adapter.capture(0,undefined,22);
    assert.equal(again.snapshot.documentId,22);assert.equal(again.snapshot.colorReason,'assumed-srgb');
    h.copy.colorProfileName='Adobe RGB (1998)';
    const converted=await adapter.capture(0,undefined,22);assert.equal(converted.snapshot.profile,'Adobe RGB (1998)');assert.equal(converted.snapshot.colorReason,undefined);
    await assert.rejects(adapter.apply(captured.snapshot,captured.image,'old candidate'),/改变|配置文件|色彩/);
  }
});

test('working-copy color is a committed baseline: apply then native undo can capture the pathless copy again',async()=>{
  const h=colorHistoryHost(),captured=await h.adapter.capture(0,undefined,11);
  await h.adapter.apply(captured.snapshot,captured.image,'AI');h.undo();
  const again=await h.adapter.capture(0,undefined,22);
  assert.equal(again.snapshot.documentId,22);assert.equal(again.snapshot.profile,'sRGB IEC61966-2.1');
  assert.equal(h.copy.path,undefined);assert.equal(h.copy.colorProfileType,'customEnum');assert.equal(h.reads(),1);
  assert.equal(h.copy.layers.length,1);assert.equal(h.doc.colorProfileName,'None');assert.equal(h.doc.activeHistoryState.id,91);
});

test('verified color-copy capture keeps the original frozen mask when native duplicate has no selection',async()=>{
  for(const analysis of [false,true]){
    const h=colorHistoryHost(),originalSelection=JSON.stringify(h.doc.selection.bounds);h.copy.selection={bounds:null};
    const captured=await h.adapter.capture(0,undefined,11,8,analysis?{purpose:'relight-analysis',preserveNativeDepth:true}:{});
    assert.equal(captured.snapshot.documentId,22);assert.equal(captured.workingCopyOf,11);assert.equal(captured.snapshot.profile,'sRGB IEC61966-2.1');
    const width=captured.snapshot.bounds.right-captured.snapshot.bounds.left,at=(30-captured.snapshot.bounds.top)*width+40-captured.snapshot.bounds.left;
    assert.deepEqual([...captured.selectionMask.slice(at,at+2)],[255,128]);assert.equal(captured.selectionMask[at+width],0);assert.equal(captured.selectionMask[at+width+1],255);
    assert.equal(JSON.stringify(h.doc.selection.bounds),originalSelection);assert.deepEqual(h.copy.selection.bounds,h.doc.selection.bounds);assert.equal(h.calls.filter(call=>call[0]==='putSelection').length,1);assert.equal(h.doc.activeHistoryState.id,91);assert.equal(h.reads(),1);
  }
});

test('copy capture still rejects original source or either document selection changes during pixel reads',async()=>{
  const changes=[(h:any)=>h.doc.activeHistoryState.id++,(h:any)=>h.doc.selection.bounds=null,(h:any)=>h.copy.activeHistoryState.id++,(h:any)=>h.copy.selection.bounds={left:40,top:30,right:41,bottom:32}];
  for(const change of changes){
    const h=colorHistoryHost();h.copy.selection={bounds:null};const getPixels=h.ps.imaging.getPixels;
    h.ps.imaging.getPixels=async(options:any)=>{const result=await getPixels(options),getData=result.imageData.getData;result.imageData.getData=async()=>{const values=await getData();change(h);return values;};return result;};
    await assert.rejects(h.adapter.capture(0,undefined,11,8,{purpose:'relight-analysis',preserveNativeDepth:true}),/来源.*改变/);
    assert.equal(h.ps.app.documents.length,1);assert.equal(h.ps.app.activeDocument.id,11);assert.equal(h.doc.colorProfileName,'None');
  }
});

test('a lost or inconsistent profile never authorizes an old candidate or unproven recovery',async()=>{
  const h=colorHistoryHost(),captured=await h.adapter.capture(0,undefined,11);
  h.copy.colorProfileType='none';
  await assert.rejects(h.adapter.apply(captured.snapshot,captured.image,'stale type'),/状态已改变|色彩|配置文件/);
  h.copy.colorProfileName='None';
  await assert.rejects(h.adapter.capture(0,undefined,22),/原文件|配置文件/);
  const fresh=new PhotoshopAdapter(h.ps,'session-b');assert.equal(fresh.colorRecoveryAvailability(22),'unavailable');
  const arbitrary={...h.copy,id:33,colorProfileName:'None',colorProfileType:'none'};h.ps.app.documents.push(arbitrary);h.ps.app.activeDocument=arbitrary;
  assert.equal(h.adapter.colorRecoveryAvailability(33),'unavailable');
  await assert.rejects(h.adapter.apply(captured.snapshot,captured.image,'different source'),/改变|色彩|配置文件/);
});

test('working-copy assignment failure rolls back its own history and closes it without reading pixels',async()=>{
  const h=colorHistoryHost();
  Object.defineProperty(h.copy,'colorProfileName',{get:()=> 'None',set:()=>{throw new Error('profile assignment failed');},configurable:true});
  await assert.rejects(h.adapter.capture(0,undefined,11),/profile assignment failed/);
  assert.deepEqual(h.calls.find(call=>call[0]==='resume-copy').slice(1),[1,false]);
  assert.equal(h.ps.app.documents.length,1);assert.equal(h.ps.app.activeDocument.id,11);assert.equal(h.doc.colorProfileName,'None');
  assert.equal(h.calls.some(call=>call[0]==='getPixels'),false);
});

test('the new working-copy baseline does not authorize changed geometry, depth, mode, history, ICC, closed documents or sessions',async()=>{
  const mutations=[
    (h:any,s:Snapshot)=>h.copy.width++, (h:any,s:Snapshot)=>h.copy.height++,
    (h:any,s:Snapshot)=>h.copy.bitsPerChannel=16, (h:any,s:Snapshot)=>h.copy.mode='gray',
    (h:any,s:Snapshot)=>h.copy.activeHistoryState.id++, (h:any,s:Snapshot)=>h.copy.colorProfileName='Adobe RGB (1998)',
    (h:any,s:Snapshot)=>h.ps.app.documents=[h.doc], (h:any,s:Snapshot)=>s.sessionId='previous-session'
  ];
  for(const mutate of mutations){
    const h=colorHistoryHost(),c=await h.adapter.capture(0,undefined,11);mutate(h,c.snapshot);
    await assert.rejects(h.adapter.apply(c.snapshot,c.image,'stale working copy'));
    assert.equal(h.copy.layers.length,1);assert.equal(h.doc.colorProfileName,'None');
  }
});

test('verified saved sRGB uses a tagged working copy for capture and apply without changing the original',async()=>{
  const h=host();h.doc.colorProfileName='';h.doc.saved=false;h.doc.layers.push({...h.doc.layers[0],id:3,opacity:40});
  const copy:any={...h.doc,id:22,colorProfileName:'',layers:h.doc.layers.map((l:any,i:number)=>({...l,id:9+i})),activeHistoryState:{id:200},closeWithoutSaving:async()=>{h.calls.push('close-copy');h.ps.app.documents=[h.doc];}};
  copy.createLayer=async()=>{h.calls.push('copy-layer');const layer={id:56,move:async()=>{}};copy.layers.unshift(layer);return layer;};
  h.doc.duplicate=async(_name:string,merge:boolean)=>{assert.equal(merge,false);h.ps.app.documents.push(copy);h.ps.app.activeDocument=copy;return copy;};
  const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{},resumeHistory:async(_id:number,commit:boolean)=>{if(commit)copy.activeHistoryState={id:copy.activeHistoryState.id+1};}}}));
  const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>({kind:'srgb',format:'webp',width:100,height:80,depth:8,reason:'webp-default'}));
  const captured=await adapter.capture(0,undefined,11);
  assert.equal(h.doc.colorProfileName,'');assert.equal(copy.colorProfileName,'sRGB IEC61966-2.1');
  assert.equal(captured.snapshot.documentId,22);assert.equal(captured.snapshot.colorReason,'webp-default');
  assert.equal(h.calls.find(c=>c[0]==='getPixels')[1].documentID,22);
  await adapter.apply(captured.snapshot,captured.image,'AI');
  assert.equal(h.calls.find(c=>c[0]==='putPixels')[1].documentID,22);assert.equal(h.doc.layers.length,2);assert.equal(h.doc.layers[1].opacity,40);
});

test('untagged PNG16 working copy preserves high samples, semi-alpha and original protection coordinates',async()=>{
  const h=host();h.doc.colorProfileName='';h.doc.saved=false;h.doc.bitsPerChannel='bitDepth16';h.ps.constants.BitsPerChannelType.SIXTEEN='bitDepth16';
  const copy:any={...h.doc,id:22,layers:[{...h.doc.layers[0],id:9}],closeWithoutSaving:async()=>{}};
  h.doc.duplicate=async()=>{h.ps.app.documents.push(copy);h.ps.app.activeDocument=copy;return copy;};
  const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{},resumeHistory:async(_id:number,commit:boolean)=>{if(commit)copy.activeHistoryState={id:copy.activeHistoryState.id+1};}}}));
  h.ps.imaging.getPixels=async()=>({imageData:{width:1,height:1,components:4,componentSize:16,getData:async()=>new Uint16Array([12345,23456,34567,45678]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>({kind:'srgb',format:'png',width:100,height:80,depth:16,reason:'png-srgb'}));
  const protection={documentId:11,width:100,height:80,bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([0,255,0,0]),sessionId:'session-a'};
  const c=await adapter.capture(0,protection,11,16),pixel=30*66+32;
  assert.ok(c.image.rgba instanceof Uint16Array);assert.deepEqual([...c.image.rgba.slice(pixel*4,pixel*4+4)],[12345,23456,34567,45678]);
  assert.equal(c.snapshot.clipBaseLayerId,9);assert.equal(c.snapshot.mask[pixel],255);assert.equal(c.snapshot.mask[pixel+1],0);assert.equal(c.workingCopyOf,11);assert.equal(h.doc.colorProfileName,'');
});

test('current ICC wins after editing; stale saved color never reinterprets or duplicates a tagged document',async()=>{
  const h=host();h.doc.colorProfileName='Adobe RGB (1998)';h.doc.saved=false;
  const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>{throw new Error('must not read stale source metadata');});
  const c=await adapter.capture();assert.equal(c.snapshot.documentId,11);assert.equal(c.snapshot.profile,'Adobe RGB (1998)');
});

test('a document changed during source file selection is rejected before duplication or pixel reads',async()=>{
  const h=host();h.doc.colorProfileName='';
  const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>{h.doc.activeHistoryState.id++;return {kind:'srgb',format:'webp',width:100,height:80,depth:8,reason:'webp-default'};});
  await assert.rejects(adapter.capture(),/状态已改变/);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
});

test('failed copy capture closes the copy and restores the original; selecting a protection mask needs no color guess',async()=>{
  const h=host();h.doc.colorProfileName='';
  const protection=await h.adapter.protection();assert.equal(protection.documentId,11);
  const copy:any={...h.doc,id:22,closeWithoutSaving:async()=>{h.calls.push('close-copy');h.ps.app.documents=[h.doc];}};
  h.doc.duplicate=async()=>{h.ps.app.documents.push(copy);h.ps.app.activeDocument=copy;return copy;};
  const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{}}}));
  h.ps.imaging.getPixels=async()=>{throw new Error('pixel read failed');};
  const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>({kind:'srgb',format:'png',width:100,height:80,depth:8,reason:'png-srgb'}));
  await assert.rejects(adapter.capture(),/pixel read failed/);assert.equal(h.calls.includes('close-copy'),true);assert.equal(h.ps.app.activeDocument.id,11);assert.equal(h.doc.colorProfileName,'');
});

test('unusable saved declarations create an approximate copy without claiming verified color',async()=>{
  for(const change of [{depth:16},{width:101},{kind:'icc' as const}]){
    const h=colorHistoryHost();
    const adapter=new PhotoshopAdapter(h.ps,'session-a',async()=>{},async()=>({kind:'srgb',format:'webp',width:100,height:80,depth:8,...change}));
    const captured=await adapter.capture();assert.equal(captured.snapshot.colorReason,'assumed-srgb');assert.equal(captured.snapshot.documentId,22);assert.equal(h.doc.colorProfileName,'None');
  }
});

test('unknown grayscale sources and unknown reference profiles still stop before pixel reading',async()=>{
  for(const profile of ['', 'Untagged RGB', '未标记的 RGB']){
    const h=host();h.doc.colorProfileName=profile;h.doc.mode='gray';
    await assert.rejects(h.adapter.capture(),/配置文件|profile/);
    assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
  }
  const h=host();let closed=false;
  const reference={...h.doc,id:22,colorProfileName:'',closeWithoutSaving:async()=>{closed=true;h.ps.app.documents=[h.doc];}};
  h.ps.app.open=async()=>{h.ps.app.documents.push(reference);return reference;};
  const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{}}}));
  await assert.rejects(h.adapter.importReference({name:'untagged.png'}),/配置文件|profile/);
  assert.equal(closed,true);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
});
test('没有打开文档时捕获给出明确错误，参考导入可独立读取并关闭自建文档',async()=>{
  const h=host();h.ps.app.documents=[];Object.defineProperty(h.ps.app,'activeDocument',{get(){if(!h.ps.app.documents.length)throw new Error('No active document');return h.ps.app.documents[0];},set(){},configurable:true});
  await assert.rejects(h.adapter.capture(),/请先打开/);
  let closed=false;const reference={...h.doc,id:22,closeWithoutSaving:async()=>{closed=true;h.ps.app.documents=[];}};h.ps.app.open=async()=>{h.ps.app.documents=[reference];return reference;};
  const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{}}}));
  await h.adapter.importReference({name:'reference.png'});assert.equal(closed,true);
});
test('未验证的参考图模式也明确拒绝，不对 HDR 或 CMYK 静默降位',async()=>{
  for(const [mode,depth] of [['rgb',32],['cmyk',8],['lab',16]]){
    const h=host();let closed=false;const ref={...h.doc,id:22,mode,bitsPerChannel:depth,closeWithoutSaving:async()=>{closed=true;}};
    h.ps.app.open=async()=>{h.ps.app.documents.push(ref);h.ps.app.activeDocument=ref;return ref;};
    const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{}}}));
    await assert.rejects(h.adapter.importReference({name:'unsupported.jpg'}),/RGB|灰度/);assert.equal(closed,true);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
  }
});
test('捕获真实选区灰度和透明裁边，保护区在原坐标减去',async()=>{
  const h=host();const p={documentId:11,width:100,height:80,bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([0,255,0,0]),sessionId:'session-a'};
  const c=await h.adapter.capture(0,p);
  assert.deepEqual(c.snapshot.bounds,{left:8,top:0,right:74,bottom:64});
  assert.equal(c.snapshot.mask[30*66+32],255);assert.equal(c.snapshot.mask[30*66+33],0);
  assert.equal(c.selectionMask[30*66+33],128);assert.equal(c.protectionMask[30*66+33],255);
  assert.equal(c.selectionMask[30*66+32],255);assert.equal(c.protectionMask[30*66+32],0);
  assert.equal(c.image.rgba[(30*66+32)*4],20);assert.equal(c.image.rgba[3],0);
  assert.equal(h.calls.filter(c=>c==='dispose').length,2);
});

test('subject-background captures the whole canvas including transparent corners, preserving raw subject/protection and source',async()=>{
  const h=host(),protection={documentId:11,width:100,height:80,bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([0,128,255,0]),sessionId:'session-a'};
  h.ps.imaging.getPixels=async(o:any)=>{h.calls.push(['getPixels',o]);return {imageData:{width:2,height:2,components:4,componentSize:8,getData:async()=>new Uint8Array([20,30,40,255,80,90,100,128,120,130,140,0,10,20,30,255]),dispose(){}},sourceBounds:{left:40,top:30,right:42,bottom:32}};};
  const c=await h.adapter.capture(0,protection,11,8,{context:'document',selection:'subject-background'}),p=30*100+40;
  assert.deepEqual(c.snapshot.bounds,{left:0,top:0,right:100,bottom:80});assert.equal(c.snapshot.backgroundComposite,'subject-background-v1');assert.ok(c.subjectMask);
  assert.deepEqual([c.snapshot.mask[0],c.snapshot.mask[7999],c.snapshot.mask[p],c.snapshot.mask[p+1],c.snapshot.mask[p+100]],[255,255,0,127,0]);
  assert.deepEqual([c.subjectMask[p],c.subjectMask[p+1],c.subjectMask[p+100],c.subjectMask[p+101]],[255,128,0,255]);
  assert.equal(c.selectionMask[p+1],255);assert.equal(c.protectionMask[p+1],128);
  assert.deepEqual([...c.image.rgba.slice((p+1)*4,(p+1)*4+4)],[80,90,100,128]);assert.equal(c.image.rgba[3],0);
  assert.deepEqual(h.calls.find(c=>c[0]==='getPixels')[1].sourceBounds,{left:0,top:0,right:100,bottom:80});
});

test('document/edit captures visible environment but only the subject minus feathered protection is editable',async()=>{
  const h=host(),protection={documentId:11,width:100,height:80,bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([0,128,0,0]),sessionId:'session-a'};
  h.ps.imaging.getPixels=async()=>({imageData:{width:3,height:1,components:4,componentSize:8,getData:async()=>new Uint8Array([10,20,30,255,20,30,40,255,30,40,50,128]),dispose(){}},sourceBounds:{left:39,top:30,right:42,bottom:31}});
  const c=await h.adapter.capture(0,protection,11,8,{context:'document',selection:'edit'}),p=30*100+40;
  assert.deepEqual(c.snapshot.bounds,{left:0,top:0,right:100,bottom:80});assert.equal(c.snapshot.backgroundComposite,undefined);assert.equal(c.subjectMask,undefined);
  assert.deepEqual([c.snapshot.mask[p-1],c.snapshot.mask[p],c.snapshot.mask[p+1]],[0,255,64]);
  assert.deepEqual([...c.image.rgba.slice((p-1)*4,(p-1)*4+4)],[10,20,30,255]);
});

test('document capture maps cache-level bounds to the full native16 canvas without quantizing samples',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getSelection=async()=>({imageData:{width:1,height:1,componentSize:16,components:1,getData:async()=>new Uint16Array([32768]),dispose(){}},sourceBounds:{left:20,top:15,right:21,bottom:16},level:1});
  h.ps.imaging.getPixels=async()=>({imageData:{width:1,height:1,components:4,componentSize:16,getData:async()=>new Uint16Array([12345,23456,34567,32769]),dispose(){}},sourceBounds:{left:20,top:15,right:21,bottom:16},level:1});
  const c=await h.adapter.capture(0,undefined,11,16,{context:'document',selection:'subject-background'}),p=30*100+40;
  assert.ok(c.image.rgba instanceof Uint16Array);assert.equal(c.image.width,100);assert.equal(c.image.height,80);assert.ok(c.subjectMask);
  assert.deepEqual([...c.image.rgba.slice(p*4,p*4+4)],[12345,23456,34567,32769]);assert.equal(c.subjectMask[p],128);assert.equal(c.subjectMask[p+1],128);assert.equal(c.snapshot.mask[p],255);
});

test('background keeps native16 source alpha even when the provider output is 8-bit',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getPixels=async()=>({imageData:{width:1,height:1,components:4,componentSize:16,getData:async()=>new Uint16Array([12345,23456,34567,65534]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const c=await h.adapter.capture(0,undefined,11,8,{context:'document',selection:'subject-background'}),p=30*100+40;
  assert.ok(c.image.rgba instanceof Uint16Array);assert.equal(c.image.rgba[p*4+3],65534);assert.equal(c.snapshot.mask[p],255);
});

test('blend does not count protected subject pixels, feather-only edges or transparent surroundings as environment',async()=>{
  for(const subject of [new Uint8Array([255,255]),new Uint8Array([255,254])]){
    const h=host();h.doc.width=2;h.doc.height=1;h.doc.selection.bounds={left:0,top:0,right:2,bottom:1};
    h.ps.imaging.getSelection=async()=>({imageData:{width:2,height:1,componentSize:8,components:1,getData:async()=>subject,dispose(){}},sourceBounds:{left:0,top:0,right:2,bottom:1}});
    h.ps.imaging.getPixels=async()=>({imageData:{width:2,height:1,componentSize:8,components:4,getData:async()=>new Uint8Array([20,30,40,255,20,30,40,255]),dispose(){}},sourceBounds:{left:0,top:0,right:2,bottom:1}});
    const protection={documentId:11,width:2,height:1,bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([0,255]),sessionId:'session-a'};
    await assert.rejects(h.adapter.capture(0,protection,11,8,{context:'document',selection:'edit'}),/主体选区外没有可见环境/);
  }
  const transparent=host();await assert.rejects(transparent.adapter.capture(0,undefined,11,8,{context:'document',selection:'edit'}),/主体选区外没有可见环境/);
});

test('background apply writes its reconstructed patch and actual grayscale mask in one ordinary undo transaction',async()=>{
  const h=host();h.doc.width=3;h.doc.height=1;h.doc.selection.bounds={left:0,top:0,right:2,bottom:1};
  h.ps.imaging.getSelection=async()=>({imageData:{width:2,height:1,componentSize:8,components:1,getData:async()=>new Uint8Array([255,128]),dispose(){}},sourceBounds:{left:0,top:0,right:2,bottom:1}});
  h.ps.imaging.getPixels=async()=>({imageData:{width:3,height:1,componentSize:8,components:4,getData:async()=>new Uint8Array([200,100,50,255,200,100,50,128,0,0,0,0]),dispose(){}},sourceBounds:{left:0,top:0,right:3,bottom:1}});
  const protection={documentId:11,width:3,height:1,bounds:{left:0,top:0,right:3,bottom:1},mask:new Uint8Array([0,128,0]),sessionId:'session-a'};
  const c=await h.adapter.capture(0,protection,11,8,{context:'document',selection:'subject-background'}),prepared=prepareBackgroundCandidate({width:1,height:1,rgba:new Uint8Array([20,60,120,255])},c.image,c.subjectMask!,c.protectionMask);
  await h.adapter.apply(c.snapshot,prepared,'background');
  const buffers=h.calls.filter(call=>call[0]==='buffer');
  assert.deepEqual([...buffers[0][1]],[20,60,120,255,110,80,85,255,20,60,120,255]);assert.deepEqual([...buffers[1][1]],[0,127,255]);
  assert.equal(h.doc.layers[0].isClippingMask,false);assert.equal(h.calls.filter(call=>call[0]==='suspend').length,1);assert.deepEqual(h.calls.find(call=>call[0]==='resume').slice(1),[1,true]);
  h.ps.imaging.putLayerMask=async()=>{throw new Error('background mask write failed');};
  await assert.rejects(h.adapter.apply(c.snapshot,prepared,'bad background'),/background mask write failed/);
  assert.deepEqual(h.calls.filter(call=>call[0]==='resume')[1].slice(1),[2,false]);assert.equal(h.calls.filter(call=>call==='dispose').length,4);
});

test('full-canvas strategies reject empty selections, unavailable environment and pixel-budget excess',async()=>{
  const noEnvironment=host();
  await assert.rejects(noEnvironment.adapter.capture(0,undefined,11,8,{context:'document',selection:'edit'}),/主体选区外没有可见环境/);
  const empty=host();empty.ps.imaging.getSelection=async()=>({imageData:{width:2,height:2,componentSize:8,components:1,getData:async()=>new Uint8Array(4),dispose(){}},sourceBounds:{left:40,top:30,right:42,bottom:32}});
  await assert.rejects(empty.adapter.capture(0,undefined,11,8,{context:'document',selection:'subject-background'}),/选区为空/);
  const large=host();large.doc.width=9001;large.doc.height=5000;
  await assert.rejects(large.adapter.capture(0,undefined,11,8,{context:'document',selection:'subject-background'}),/4500/);assert.equal(large.calls.some(c=>c[0]==='getPixels'),false);
  const full=host();full.doc.width=2;full.doc.height=2;full.doc.selection.bounds={left:0,top:0,right:2,bottom:2};
  full.ps.imaging.getSelection=async()=>({imageData:{width:2,height:2,componentSize:8,components:1,getData:async()=>new Uint8Array([255,255,255,255]),dispose(){}},sourceBounds:{left:0,top:0,right:2,bottom:2}});
  full.ps.imaging.getPixels=async()=>({imageData:{width:2,height:2,componentSize:8,components:4,getData:async()=>new Uint8Array([20,30,40,255,20,30,40,255,20,30,40,255,20,30,40,255]),dispose(){}},sourceBounds:{left:0,top:0,right:2,bottom:2}});
  await assert.rejects(full.adapter.capture(0,undefined,11,8,{context:'document',selection:'subject-background'}),/没有可替换背景/);
});
test('拒绝不同会话、关闭、尺寸、颜色与内容改变，写入前无新图层',async()=>{
  for(const mutate of [(s:Snapshot,h:any)=>s.sessionId='old-session',(s:Snapshot,h:any)=>h.ps.app.documents=[],(s:Snapshot,h:any)=>h.doc.width=101,(s:Snapshot,h:any)=>h.doc.colorProfileName='Adobe RGB',(s:Snapshot,h:any)=>h.doc.activeHistoryState.id=92]){
    const h=host(),s=snap();mutate(s,h);await assert.rejects(h.adapter.apply(s,patch,'AI'));assert.equal(h.calls.includes('new-layer'),false);
  }
});
test('切换到别的文档仍指定来源，新蒙版先 hideAll，再写真实灰度；RGBA 不预乘',async()=>{
  const h=host();h.ps.app.activeDocument={id:22};
  await h.adapter.apply(snap(),patch,'AI');
  const pixel=h.calls.find(c=>c[0]==='putPixels')[1];assert.equal(pixel.documentID,11);assert.equal(pixel.layerID,55);
  const bytes=h.calls.find(c=>c[0]==='buffer'&&c[2].components===4)[1];assert.deepEqual([...bytes.slice(0,4)],[255,0,0,128]);
  const commands=h.calls.filter(c=>c[0]==='batch').flatMap(c=>c[1]);assert.equal(commands.some((c:any)=>c.using?._value==='hideAll'),true);
  const mask=h.calls.find(c=>c[0]==='putMask')[1];assert.equal(mask.replace,false);assert.deepEqual(mask.targetBounds,{left:40,top:30});
  assert.deepEqual(h.calls.find(c=>c[0]==='resume').slice(1),[1,true]);
});
test('写入失败回滚整次新建层事务并释放 pixel/mask 数据',async()=>{
  const h=host();h.ps.imaging.putLayerMask=async()=>{throw new Error('host write failed');};
  await assert.rejects(h.adapter.apply(snap(),patch,'AI'),/host write failed/);
  assert.deepEqual(h.calls.find(c=>c[0]==='resume').slice(1),[1,false]);
  assert.equal(h.calls.filter(c=>c==='dispose').length,2);
});
test('RGB 和灰度的 8/16 位捕获不改变原文档模式、位深或 ICC',async()=>{
  for(const mode of ['rgb','gray'])for(const depth of [8,16]){
    const h=host();h.doc.mode=mode;h.doc.bitsPerChannel=depth;h.doc.colorProfileName=mode==='gray'?'Gray Gamma 2.2':'Adobe RGB (1998)';
    const c=await h.adapter.capture();assert.equal(c.snapshot.depth,depth);assert.equal(c.snapshot.mode,mode);assert.equal(h.doc.bitsPerChannel,depth);
    assert.equal(h.calls.find(c=>c[0]==='getPixels')[1].colorProfile,'sRGB IEC61966-2.1');
  }
  for(const [mode,depth] of [['cmyk',8],['lab',8],['rgb',32]]){const h=host();h.doc.mode=mode;h.doc.bitsPerChannel=depth;await assert.rejects(h.adapter.capture(),/RGB|灰度/);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);}
  const h=host();h.doc.selection.bounds=null;await assert.rejects(h.adapter.capture(),/选区/);
});

test('16 位选区按完整范围归一化，不截断成 8 位或改变羽化',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getSelection=async()=>({imageData:{width:2,height:2,componentSize:16,components:1,getData:async(o:any)=>{assert.equal(o.fullRange,true);return new Uint16Array([0,32768,65535,16384]);},dispose(){}},sourceBounds:{left:40,top:30,right:42,bottom:32}});
  const c=await h.adapter.capture(0);const p=30*66+32;
  assert.deepEqual([c.snapshot.mask[p],c.snapshot.mask[p+1],c.snapshot.mask[p+66],c.snapshot.mask[p+67]],[0,128,255,64]);
});

test('16 位来源按原生位深读取后转换模型字节，避免宿主 getPixels 直接降位错误',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getPixels=async(o:any)=>{assert.equal(o.componentSize,16);return {imageData:{width:1,height:1,components:4,componentSize:16,getData:async(opts:any)=>{assert.equal(opts.fullRange,true);return new Uint16Array([65535,32768,16384,32768]);},dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31},level:0};};
  const c=await h.adapter.capture(0);assert.deepEqual([...c.image.rgba.slice((30*66+32)*4,(30*66+32)*4+4)],[255,128,64,128]);
});

test('16 位回填的颜色和灰度蒙版都按宿主位深传入，不使用原生隐式降位转换',async()=>{
  const h=host();h.doc.bitsPerChannel=16;const s={...snap(),depth:16};
  await h.adapter.apply(s,patch,'AI16');
  const buffers=h.calls.filter(c=>c[0]==='buffer');assert.equal(buffers.length,2);
  for(const b of buffers){assert.ok(b[1] instanceof Uint16Array);assert.equal(b[2].fullRange,true);}
  assert.deepEqual([...buffers[0][1].slice(0,4)],[65535,0,0,32896]);
  assert.deepEqual([...buffers[1][1]],[65535,32896,0,65535]);
});

test('切换同次捕获的候选只替换插件上次图层；外部修改仍阻止回填',async()=>{
  const h=host(),s=snap();assert.equal(h.adapter.applicationMode(s),'new');assert.equal(await h.adapter.apply(s,patch,'AI1'),55);
  assert.equal(h.adapter.applicationMode(s),'replace');
  assert.equal(await h.adapter.apply({...s,mask:new Uint8Array(s.mask)},patch,'AI2'),56);
  assert.deepEqual(h.calls.filter(c=>c[0]==='delete'),[['delete',55]]);assert.deepEqual(h.doc.layers.map((l:any)=>l.id),[56,2]);
  h.doc.activeHistoryState.id++;
  assert.equal(h.adapter.applicationMode(s),'unavailable');
  await assert.rejects(h.adapter.apply(s,patch,'AI3'),/状态已改变/);assert.equal(h.calls.filter(c=>c==='new-layer').length,2);
});

test('半透明编辑剪贴到经过验证的来源底层，文档 alpha 不因 NORMAL 叠加加倍',async()=>{
  const h=host();h.ps.imaging.getPixels=async(o:any)=>({imageData:{width:1,height:1,components:4,componentSize:8,getData:async()=>new Uint8Array([30,40,50,128]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const c=await h.adapter.capture(0);assert.equal(c.snapshot.clipBaseLayerId,2);
  await h.adapter.apply(c.snapshot,patch,'alpha edit',c.image);
  assert.equal(h.doc.layers[0].isClippingMask,true);
  const written=h.calls.find(c=>c[0]==='buffer'&&c[2].components===4)[1];const p=(30*66+32)*4;
  assert.equal(written[p+3],255); // Clipping supplies alpha128 exactly once.
  assert.equal(await h.adapter.apply(c.snapshot,patch,'replace alpha edit',c.image),56);
  assert.equal(h.doc.layers[0].isClippingMask,true);assert.equal(h.doc.layers.length,2);
  await h.adapter.apply(c.snapshot,patch,'preservation off');assert.equal(h.doc.layers[0].isClippingMask,false);
  await h.adapter.apply(c.snapshot,patch,'preservation on',c.image);assert.equal(h.doc.layers[0].isClippingMask,true);
});

test('半透明复杂合成没有安全剪贴底层时拒绝回填，仍允许不保留透明度的普通应用',async()=>{
  const h=host(),s=snap(),source={...patch,rgba:new Uint8Array(patch.rgba)};
  await assert.rejects(h.adapter.apply(s,patch,'unsafe alpha',source),/半透明.*副本/);
  assert.equal(h.calls.includes('new-layer'),false);
  await h.adapter.apply(s,patch,'ordinary overlay');assert.equal(h.doc.layers[0].isClippingMask,false);
});

test('捕获不会把 alpha 不同的来源层当成安全剪贴底层',async()=>{
  const h=host();h.ps.imaging.getPixels=async(o:any)=>({imageData:{width:1,height:1,components:4,componentSize:8,getData:async()=>new Uint8Array([30,40,50,o.layerID?64:128]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const c=await h.adapter.capture(0);assert.equal(c.snapshot.clipBaseLayerId,undefined);
  await assert.rejects(h.adapter.apply(c.snapshot,patch,'unsafe alpha',c.image),/半透明.*副本/);
  assert.equal(h.calls.includes('new-layer'),false);
});

test('其他文档相同图层和历史 ID 的不透明度操作不授权来源文档的新历史',async()=>{
  const h=host(),s=snap();await h.adapter.apply(s,patch,'AI1');
  const other:any={id:22,activeHistoryState:{id:h.doc.activeHistoryState.id},layers:[]};
  let opacity=100;const history=other.activeHistoryState.id,layer:any={id:55};Object.defineProperty(layer,'opacity',{get:()=>opacity,set(value){opacity=value;other.activeHistoryState.id++;}});other.layers=[layer];h.ps.app.documents.push(other);
  await assert.rejects(h.adapter.opacity(22,55,50),/改变/);assert.equal(opacity,100);assert.equal(other.activeHistoryState.id,history);assert.equal(await h.adapter.apply(s,patch,'AI2'),56);
});
test('新文档显式使用 sRGB profile，失败时留给宿主自动关闭',async()=>{
  const h=host();h.ps.constants.NewDocumentMode={RGB:'RGBColorMode'};h.ps.constants.DocumentFill={TRANSPARENT:'transparent'};
  let registered=false,unregistered=false;
  h.ps.core.executeAsModal=async(fn:any)=>fn({hostControl:{registerAutoCloseDocument:()=>{registered=true;},unregisterAutoCloseDocument:()=>{unregistered=true;}}});
  h.ps.app.createDocument=async(options:any)=>{assert.equal(options.profile,'sRGB IEC61966-2.1');return {...h.doc,createLayer:async()=>({id:55})};};
  assert.equal(await h.adapter.newDocument(patch,'candidate'),11);assert.equal(registered,true);assert.equal(unregistered,true);
});
test('modal 等待期间切换文档时，捕获拒绝错文档',async()=>{
  const h=host();h.ps.core.executeAsModal=async(fn:any)=>{h.ps.app.activeDocument={...h.doc,id:22};return fn({});};
  await assert.rejects((h.adapter as any).capture(0,undefined,11),/文档/);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
});
test('外部参考通过 Photoshop 转 sRGB8，关闭自建参考文档并恢复原活动文档',async()=>{
  const h=host();let closed=false;
  const reference={...h.doc,id:22,colorProfileName:'Adobe RGB (1998)',closeWithoutSaving:async()=>{closed=true;}};
  h.ps.app.open=async()=>{h.ps.app.documents.push(reference);h.ps.app.activeDocument=reference;return reference;};
  const originalModal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>originalModal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{}}}));
  const result=await h.adapter.importReference({name:'color-reference.png'});
  const request=h.calls.find(c=>c[0]==='getPixels')[1];assert.equal(request.documentID,22);assert.equal(request.colorProfile,'sRGB IEC61966-2.1');assert.equal(request.componentSize,8);
  assert.equal(result.width,100);assert.equal(closed,true);assert.equal(h.ps.app.activeDocument.id,11);
});
