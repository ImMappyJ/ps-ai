import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter,type Snapshot} from '../src/infrastructure/photoshop/photoshop';
import type {RelightLayerFields,RelightChannelKind} from '../src/features/relight/relight-layers';
import {sha256} from '@noble/hashes/sha2.js';

function host(depth:8|16=16,width=800,height=500,whole=false){
  const calls:any[]=[],resources:{disposed:boolean}[]=[],original:any={id:1,name:'Original',visible:true},bounds={left:whole?0:13,top:whole?0:7,right:(whole?0:13)+width,bottom:(whole?0:7)+height};let nextId=10;
  const doc:any={id:7,width:whole?width:1000,height:whole?height:700,mode:'rgb',colorProfileName:'sRGB IEC61966-2.1',bitsPerChannel:depth,activeHistoryState:{id:3},layers:[original]};
  const makeLayer=(options:any)=>{const l:any={id:nextId++,name:options.name,blendMode:options.blendMode,opacity:options.opacity??100,fillOpacity:100,visible:true,pieces:[],move:async()=>{},delete:async()=>{doc.layers=doc.layers.filter((n:any)=>n.id!==l.id);calls.push(['delete',l.id]);}};return l;};
  doc.createLayer=async(_kind:any,o:any)=>{const l=makeLayer(o);doc.layers.unshift(l);calls.push(['create',l]);return l;};
  doc.createLayerGroup=async(o:any)=>{const g={...makeLayer(o),layers:o.fromLayers};doc.layers=doc.layers.filter((l:any)=>!o.fromLayers.includes(l));doc.layers.unshift(g);calls.push(['group',g]);return g;};
  const data=(values:Uint8Array|Uint16Array,w:number,h:number,components:number)=>{const r={disposed:false};resources.push(r);return {width:w,height:h,componentSize:values instanceof Uint16Array?16:8,components,colorProfile:doc.colorProfileName,getData:async()=>values,dispose:()=>{assert.equal(r.disposed,false);r.disposed=true;}};};
  let baseline:any;
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal',MULTIPLY:'multiply',SCREEN:'screen',COLOR:'color'},ElementPlacement:{PLACEBEFORE:'before'}},
    core:{executeAsModal:async(fn:any)=>{calls.push('modal');return fn({hostControl:{suspendHistory:async()=>{const appearance=new Map<any,unknown>();const visit=(layers:any[])=>{for(const layer of layers){appearance.set(layer,{visible:layer.visible,opacity:layer.opacity});if(layer.layers)visit(layer.layers);}};visit(doc.layers);baseline={layers:[...doc.layers],history:doc.activeHistoryState,appearance};calls.push('suspend');return 1;},resumeHistory:async(_id:number,commit:boolean)=>{calls.push(['resume',commit]);if(commit)doc.activeHistoryState={id:doc.activeHistoryState.id+1};else{doc.layers=baseline.layers;doc.activeHistoryState=baseline.history;for(const [layer,appearance]of baseline.appearance)Object.assign(layer,appearance);}}}});}},
    action:{batchPlay:async(c:any[])=>{calls.push(['batch',c]);return c.map(()=>({}));}},imaging:{
      getPixels:async(o:any)=>{if(o.historyStateID!==undefined)assert.equal(o.historyStateID,3,'base must always use the frozen original history');const b=o.sourceBounds,w=b.right-b.left,h=b.bottom-b.top,max=depth===16?65535:255,rgba=depth===16?new Uint16Array(w*h*4):new Uint8Array(w*h*4);for(let p=0;p<w*h;p++){rgba[p*4]=depth===16?12345:48;rgba[p*4+1]=rgba[p*4+2]=rgba[p*4];rgba[p*4+3]=max;}calls.push(['read',o]);return {imageData:data(rgba,w,h,4),sourceBounds:b,level:0};},
      createImageDataFromBuffer:async(v:any,o:any)=>data(v,o.width,o.height,o.components),
      putPixels:async(o:any)=>{const layer=doc.layers.find((l:any)=>l.id===o.layerID),values=await o.imageData.getData({fullRange:true});if(o.replace)layer.pieces=[];layer.pieces.push({bounds:o.targetBounds,height:o.imageData.height,first:values[0]});calls.push(['write',o.layerID,o.replace,o.targetBounds]);},
      putLayerMask:async(o:any)=>{calls.push(['mask',o]);}
    }};
  const snapshot:Snapshot={documentId:7,width:doc.width,height:doc.height,profile:doc.colorProfileName,mode:'rgb',depth,historyId:3,sessionId:'s',bounds,mask:new Uint8Array(width*height).fill(128),sourceHash:'frozen',sourceLayerIds:[1],captureGeometry:{kind:'relight-analysis',width:128,height:96}};
  const fields:RelightLayerFields={version:'relight-fields-v1',width:128,height:96,source:{documentId:7,docWidth:doc.width,docHeight:doc.height,bounds,profile:doc.colorProfileName,documentMode:'rgb',documentDepth:depth,sessionId:'s',historyId:3,sourceHash:'frozen',layerIds:[1],snapshotId:'frozen-id',maskRef:'mask'},sceneFingerprint:'fingerprint',guide:new Float32Array(128*96).fill(.5),channels:[],summary:{structureConfidence:1,rejectedFraction:0,clippedFraction:0,warnings:[],channels:{shadow:'present','cast-shadow':'present','color-atmosphere':'present',light:'present','rim-light':'present'}}};
  fields.source.maskRef=`relight-mask-v1:sha256:${Array.from(sha256(snapshot.mask),v=>v.toString(16).padStart(2,'0')).join('')}`;
  for(const kind of ['shadow','cast-shadow','color-atmosphere','light','rim-light'] as RelightChannelKind[])fields.channels.push({kind,blendMode:kind==='color-atmosphere'?'color':kind==='shadow'||kind==='cast-shadow'?'multiply':'screen',amount:new Float32Array(128*96).fill(.1),...(kind==='color-atmosphere'?{color:new Float32Array(128*96*3).fill(.6)}:{}),energy:.1});
  return {ps,doc,calls,resources,snapshot,fields,original,adapter:new PhotoshopAdapter(ps,'s')};
}
test('native lighting group preserves source16, fixed channel order, earlier strips and a single effective mask',async()=>{
  const h=host(),progress:number[]=[];const id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting',{onProgress:(done,total)=>{progress.push(done);assert.ok(done<=total);}});
  const group=h.doc.layers.find((l:any)=>l.id===id);assert.equal(group.blendMode,'normal');assert.equal(h.doc.layers.includes(h.original),true);
  assert.deepEqual(group.layers.map((l:any)=>l.name),['Rim Light','Light','Color Atmosphere','Cast Shadow','Shadow','Source — frozen native composite']);
  for(const l of group.layers)assert.equal(l.pieces.length,2,'later strips must not clear earlier pixels');
  const base=group.layers[group.layers.length-1];assert.equal(base.pieces[0].first,12345);assert.equal(base.blendMode,'normal');assert.equal(h.calls.filter(c=>c==='suspend').length,1);assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]]);
  const masks=h.calls.filter(c=>c[0]==='mask');assert.equal(masks.length,2);assert.ok(masks.every(c=>c[1].layerID===id&&c[1].replace===false));assert.deepEqual(masks[0][1].targetBounds,{left:13,top:7});
  assert.equal(h.calls.filter(c=>c[0]==='batch').flatMap(c=>c[1]).filter(c=>c.using?._value==='hideAll').length,1);assert.equal(progress[progress.length-1],14);assert.ok(h.resources.every(r=>r.disposed));
});
test('mid-write cancellation and mask failures roll back the whole group and dispose native resources',async()=>{
  for(const failure of ['cancel','mask']){const h=host(8),signal=new AbortController();let masks=0;
    if(failure==='mask')h.ps.imaging.putLayerMask=async()=>{if(++masks===2)throw new Error('mask strip failure');};
    await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting',{signal:signal.signal,onProgress:done=>{if(failure==='cancel'&&done===3)signal.abort();}}),failure==='cancel'?/取消/:/mask strip/);
    assert.deepEqual(h.doc.layers,[h.original]);assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',false]]);assert.ok(h.resources.every(r=>r.disposed));
  }
});
test('wrong identity, changed source, unsupported ICC and semitransparent editable source never publish layers',async()=>{
  for(const failure of ['identity','history','profile','alpha']){const h=host();if(failure==='identity')h.fields.source.documentId=8;if(failure==='history')h.doc.activeHistoryState.id=4;if(failure==='profile'){h.snapshot.profile=h.doc.colorProfileName='Adobe RGB (1998)';h.fields.source.profile=h.snapshot.profile;}
    if(failure==='alpha'){const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const r=await read(o),old=r.imageData.getData;r.imageData.getData=async()=>{const values=await old();values[3]=65534;return values;};return r;};}
    await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'unsafe'));assert.deepEqual(h.doc.layers,[h.original]);
  }
});
test('owned group replacement is source-bound, and mutating the native mask revokes the owned history exception',async()=>{
  const h=host();const first=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'one'),second=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'two');assert.notEqual(first,second);assert.equal(h.doc.layers.length,2);
  assert.equal(h.adapter.sourceAvailability({...h.snapshot,mask:undefined} as any), 'changed');assert.equal(h.adapter.sourceAvailability({...h.snapshot,mask:undefined} as any,true),'current');
  h.snapshot.mask[0]=255;await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'mutated'),/改变/);assert.equal(h.doc.layers.length,2);
});
test('9000x5000 lighting apply traverses every native pixel in bounded source, influence and mask strips',async()=>{
  const h=host(8,9000,5000,true);h.fields.channels=h.fields.channels.filter(c=>c.kind==='light');let completed=0;
  const id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'45M',{onProgress:(done,total)=>{completed=done;if(done===total)assert.equal(total,519);}}),group=h.doc.layers.find((l:any)=>l.id===id);
  assert.equal(completed,519);assert.equal(h.calls.filter(c=>c[0]==='read').length,173);
  for(const layer of group.layers)assert.equal(layer.pieces.reduce((n:number,p:any)=>n+p.height*9000,0),45_000_000);
  assert.ok(h.calls.filter(c=>c[0]==='read').every(c=>(c[1].sourceBounds.bottom-c[1].sourceBounds.top)*9000<=262_144));assert.ok(h.resources.every(r=>r.disposed));
});
test('history suspension failure restores the previously active document before any layer creation',async()=>{
  const h=host(),other={...h.doc,id:99};h.ps.app.documents.push(other);h.ps.app.activeDocument=other;
  h.ps.core.executeAsModal=async(fn:any)=>fn({hostControl:{suspendHistory:async()=>{throw Error('host busy');}}});
  await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'busy'),/host busy/);assert.equal(h.ps.app.activeDocument.id,99);assert.deepEqual(h.doc.layers,[h.original]);
});

const recover=(h:ReturnType<typeof host>,validate?:(capture:any)=>void)=>h.adapter.capture(0,undefined,h.doc.id,8,{selection:'document',purpose:'relight-analysis',preserveNativeDepth:true,excludeApplications:true},validate);

test('recovery finds owned groups nested under visible parents and ignores hidden parents, deleted results and names',async()=>{
  const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id),parent={id:500,visible:true,layers:[group]},unrelated={id:501,visible:true,name:'PS-AI Lighting'};
  h.doc.layers=[parent,unrelated,h.original];assert.equal(h.adapter.hasVisibleApplication(h.doc.id),true);
  parent.visible=false;assert.equal(h.adapter.hasVisibleApplication(h.doc.id),false);const hidden=await recover(h);assert.equal(group.visible,true);assert.equal(parent.visible,false);assert.equal(hidden.snapshot.historyId,4);
  parent.visible=true;h.doc.activeHistoryState={id:20};const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{assert.equal(group.visible,true);assert.equal(group.opacity,0);assert.equal(unrelated.visible,true);return read(o);};
  const captured=await recover(h);assert.equal(captured.snapshot.historyId,21);assert.equal(h.doc.activeHistoryState.id,21);assert.equal(group.visible,true);assert.equal(group.opacity,0);assert.equal(parent.visible,true);assert.equal(unrelated.visible,true);assert.deepEqual(captured.snapshot.sourceLayerIds,[500,501,1]);
  group.visible=true;parent.layers=[];assert.equal(h.adapter.hasVisibleApplication(h.doc.id),false);assert.equal(unrelated.visible,true);
});

test('recovery failures in pixel capture, validation and history commit restore opacity and the old baseline',async()=>{
  for(const failure of ['pixels','validation','commit']){
    const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id);h.doc.activeHistoryState={id:30};
    if(failure==='pixels')h.ps.imaging.getPixels=async()=>{assert.equal(group.visible,true);assert.equal(group.opacity,0);throw Error('capture failed');};
    if(failure==='commit'){const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((context:any)=>{const resume=context.hostControl.resumeHistory;context.hostControl.resumeHistory=async(id:number,commit:boolean)=>{if(commit)throw Error('commit failed');return resume(id,commit);};return fn(context);});}
    await assert.rejects(recover(h,failure==='validation'?()=>{throw Error('binding failed');}:undefined),/failed/);
    assert.equal(group.visible,true,failure+' preserves visibility');assert.equal(group.opacity,100,failure+' restores opacity');assert.equal(h.doc.activeHistoryState.id,30);assert.deepEqual(h.calls.filter(c=>c[0]==='resume').slice(-1),[['resume',false]]);assert.ok(h.resources.every(r=>r.disposed));
  }
});

test('multiple recorded results are excluded together and deleted or undone IDs cannot hide replacement layers',async()=>{
  const h=host(8,8,6,true),first=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'one'),group=h.doc.layers.find((l:any)=>l.id===first);group.visible=false;
  const captured=await recover(h);h.fields.source={...h.fields.source,...captured.snapshot,layerIds:captured.snapshot.sourceLayerIds!,snapshotId:'second',documentMode:captured.snapshot.mode,documentDepth:8,docWidth:captured.snapshot.width,docHeight:captured.snapshot.height,maskRef:`relight-mask-v1:sha256:${Array.from(sha256(captured.snapshot.mask),v=>v.toString(16).padStart(2,'0')).join('')}`};
  h.fields.width=captured.snapshot.captureGeometry!.width;h.fields.height=captured.snapshot.captureGeometry!.height;const count=h.fields.width*h.fields.height;h.fields.guide=new Float32Array(count).fill(.5);h.fields.channels=h.fields.channels.map(channel=>({...channel,amount:new Float32Array(count).fill(.1),...(channel.color?{color:new Float32Array(count*3).fill(.6)}:{})}));
  // The capture is history 4; the test reader also verifies strip history is frozen.
  const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=(o:any)=>read({...o,...(o.historyStateID!==undefined?{historyStateID:3}:{})});
  const second=await h.adapter.applyRelightLayers(captured.snapshot,h.fields,'two');group.visible=true;const other=h.doc.layers.find((l:any)=>l.id===second);h.doc.activeHistoryState={id:40};
  await recover(h);assert.equal(group.visible,true);assert.equal(other.visible,true);assert.equal(group.opacity,0);assert.equal(other.opacity,0);assert.equal(h.doc.activeHistoryState.id,41);
  h.doc.layers=[h.original,{id:999,name:'one',visible:true}];assert.equal(h.adapter.hasVisibleApplication(h.doc.id),false);await recover(h);assert.equal(h.doc.layers[1].visible,true);assert.equal(h.doc.activeHistoryState.id,41,'no empty undo step after deletion or undo');
});

test('recovery remains undoable when Photoshop history ignores visibility and restores the user opacity',async()=>{
  const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id);group.opacity=37;h.doc.activeHistoryState={id:30};let undo=()=>{};
  h.ps.core.executeAsModal=async(fn:any)=>fn({hostControl:{suspendHistory:async()=>{const historyId=h.doc.activeHistoryState.id,opacity=group.opacity;undo=()=>{group.opacity=opacity;h.doc.activeHistoryState={id:historyId};};return 1;},resumeHistory:async(_id:number,commit:boolean)=>{if(commit)h.doc.activeHistoryState={id:h.doc.activeHistoryState.id+1};else undo();}}});
  const captured=await recover(h);assert.equal(group.visible,true,'exclusion must preserve visibility when visibility is outside native undo');assert.equal(group.opacity,0);assert.equal(h.adapter.hasVisibleApplication(h.doc.id),false);assert.equal(captured.snapshot.sourceLayerIds!.includes(id),false);assert.equal(captured.snapshot.historyId,31);
  undo();assert.equal(group.visible,true);assert.equal(group.opacity,37);assert.equal(h.doc.activeHistoryState.id,30);assert.equal(h.adapter.hasVisibleApplication(h.doc.id),true);
  h.ps.imaging.getPixels=async()=>{throw Error('capture failed');};await assert.rejects(recover(h),/capture failed/);assert.equal(group.visible,true);assert.equal(group.opacity,37);assert.equal(h.doc.activeHistoryState.id,30);
});

test('zero-opacity ancestors and outputs are excluded from provenance without changing their visibility or creating an empty undo',async()=>{
  const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id),parent={id:500,visible:true,opacity:0,layers:[group]};group.opacity=37;h.doc.layers=[parent,h.original];
  assert.equal(h.adapter.hasVisibleApplication(h.doc.id),false);const before=h.doc.activeHistoryState.id,captured=await recover(h);assert.deepEqual(captured.snapshot.sourceLayerIds,[1]);assert.equal(captured.snapshot.historyId,before);assert.equal(group.opacity,37);assert.equal(group.visible,true);assert.equal(parent.opacity,0);
  parent.opacity=55;assert.equal(h.adapter.hasVisibleApplication(h.doc.id),true);await recover(h);assert.equal(group.opacity,0);assert.equal(group.visible,true);assert.equal(parent.opacity,55);assert.equal(parent.visible,true);assert.equal(h.doc.activeHistoryState.id,before+1);
});
