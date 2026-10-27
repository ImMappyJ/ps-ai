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
test('opacity control rejects a merged layer retaining the output ID after its application history changes',async()=>{
  const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),merged={id,name:'Lighting',kind:'normal',visible:true,opacity:100};
  h.doc.layers=[merged];h.doc.activeHistoryState={id:30};
  await assert.rejects(h.adapter.opacity(h.doc.id,id,0),/改变|重新/);assert.equal(merged.opacity,100);assert.equal(h.doc.activeHistoryState.id,30);assert.deepEqual(h.doc.layers,[merged]);
});
test('repeated authorized opacity changes track their own native history and retain candidate replacement',async()=>{
  const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id);let value=group.opacity;
  Object.defineProperty(group,'opacity',{enumerable:true,get:()=>value,set:next=>{value=next;h.doc.activeHistoryState={id:h.doc.activeHistoryState.id+1};}});
  await h.adapter.opacity(h.doc.id,id,37);assert.equal(group.opacity,37);assert.equal(h.doc.activeHistoryState.id,5);assert.equal(h.adapter.applicationMode(h.snapshot),'replace');
  await h.adapter.opacity(h.doc.id,id,62);assert.equal(group.opacity,62);assert.equal(h.doc.activeHistoryState.id,6);assert.equal(h.adapter.applicationMode(h.snapshot),'replace');
  const replacement=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Replacement');assert.notEqual(replacement,id);assert.equal(h.doc.layers.some((l:any)=>l.id===id),false);assert.equal(h.doc.layers.some((l:any)=>l.id===replacement),true);assert.equal(h.adapter.applicationMode(h.snapshot),'replace');
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

const current=(h:ReturnType<typeof host>,validate?:(capture:any)=>void)=>h.adapter.capture(0,undefined,h.doc.id,8,{selection:'document',purpose:'relight-analysis',preserveNativeDepth:true},validate);
const appearance=(h:ReturnType<typeof host>)=>JSON.stringify({history:h.doc.activeHistoryState,layers:h.doc.layers});
const writes=(h:ReturnType<typeof host>)=>h.calls.filter(c=>c==='suspend'||Array.isArray(c)&&['resume','write','mask','create','group','delete','batch'].includes(c[0]));

test('obsolete exclusion requests reject before changing or reading a merged layer retaining an output ID',async()=>{
  for(const excludeApplications of [true,false]){
    const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting');
    const merged={id,name:'Lighting',kind:'normal',visible:true,opacity:100,fillOpacity:100};h.doc.layers=[merged];h.doc.activeHistoryState={id:30};
    const before=appearance(h),calls=h.calls.length;let reads=0;
    h.ps.imaging.getPixels=async()=>{reads++;assert.equal(merged.opacity,100,'obsolete options must never hide merged user content');throw Error('merged composite must not be read for an obsolete option');};
    await assert.rejects(h.adapter.capture(0,undefined,h.doc.id,8,{selection:'document',purpose:'relight-analysis',preserveNativeDepth:true,excludeApplications} as any),/捕获策略/);
    assert.equal(reads,0);assert.equal(appearance(h),before);assert.equal(h.calls.length,calls,'invalid options must not enter modal history or pixel APIs');
  }
});

test('current composite capture includes visible owned lighting groups without altering their opacity or history',async()=>{
  const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id),parent={id:500,visible:true,opacity:55,layers:[group]},unrelated={id:501,visible:true,name:'PS-AI Lighting'};
  group.opacity=37;h.doc.layers=[parent,unrelated,h.original];h.doc.activeHistoryState={id:30};const before=appearance(h),beforeWrites=writes(h).length;
  const captured=await current(h);
  assert.equal(captured.snapshot.historyId,30);assert.ok(captured.snapshot.sourceLayerIds!.includes(id));assert.ok(captured.snapshot.sourceLayerIds!.includes(500));assert.ok(captured.snapshot.sourceLayerIds!.includes(501));assert.ok(captured.snapshot.sourceLayerIds!.includes(1));
  assert.equal(appearance(h),before);assert.equal(writes(h).length,beforeWrites);assert.ok(h.resources.every(r=>r.disposed));
});

test('current composite capture reads merged pixels retaining ordinary or lighting output IDs without reviving old apply permission',async()=>{
  for(const depth of [8,16] as const)for(const kind of ['ordinary','lighting']){
    const h=host(depth,8,6,true),rgba=depth===16?new Uint16Array(8*6*4).fill(65535):new Uint8Array(8*6*4).fill(255);
    const id=kind==='lighting'?await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'):await h.adapter.apply(h.snapshot,{width:8,height:6,rgba},'Background');
    const merged={id,name:kind==='lighting'?'Lighting':'Background',kind:'normal',visible:true,opacity:100,fillOpacity:100};h.doc.layers=[merged];h.doc.activeHistoryState={id:30};
    const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{assert.equal(o.historyStateID,undefined,'recapture must read the current composite');assert.equal(o.layerID,undefined);assert.equal(merged.opacity,100);const result=await read(o),getData=result.imageData.getData;result.imageData.getData=async()=>{const values=await getData();values[0]=depth===16?45679:178;return values;};return result;};
    const before=appearance(h),beforeWrites=writes(h).length,captured=await current(h);
    assert.equal(captured.image.rgba[0],depth===16?45679:178);assert.equal(captured.image.rgba[3],depth===16?65535:255);assert.equal(captured.image.rgba instanceof Uint16Array,depth===16);
    assert.deepEqual(captured.snapshot.sourceLayerIds,[id]);assert.equal(captured.snapshot.historyId,30);assert.notEqual(captured.snapshot.sourceHash,h.snapshot.sourceHash);
    h.adapter.assertSourceCurrent(captured.snapshot);assert.equal(h.adapter.sourceAvailability(h.snapshot,true),'changed');assert.equal(h.adapter.applicationMode(h.snapshot),'unavailable');
    assert.throws(()=>h.adapter.assertSourceCurrent(h.snapshot),/改变/);await assert.rejects(h.adapter.apply(h.snapshot,{width:8,height:6,rgba},'Stale candidate'),/改变/);
    assert.equal(appearance(h),before);assert.equal(writes(h).length,beforeWrites);assert.ok(h.resources.every(r=>r.disposed));
  }
});

test('current capture leaves user-hidden and zero-opacity outputs unchanged and omits them from visible provenance',async()=>{
  for(const hidden of ['parent-opacity','parent-visible','output-opacity','output-visible']){
    const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id),parent={id:500,visible:true,opacity:55,layers:[group]};
    group.opacity=37;if(hidden==='parent-opacity')parent.opacity=0;if(hidden==='parent-visible')parent.visible=false;if(hidden==='output-opacity')group.opacity=0;if(hidden==='output-visible')group.visible=false;
    h.doc.layers=[parent,h.original];h.doc.activeHistoryState={id:30};const before=appearance(h),beforeWrites=writes(h).length,captured=await current(h);
    assert.deepEqual(captured.snapshot.sourceLayerIds,hidden.startsWith('parent')?[1]:[500,1]);assert.equal(captured.snapshot.historyId,30);assert.equal(appearance(h),before);assert.equal(writes(h).length,beforeWrites);
  }
});

test('failed current pixel reads and capture validation never mutate source layers or create history',async()=>{
  for(const failure of ['pixels','validation']){
    const h=host(8,8,6,true),id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Lighting'),group=h.doc.layers.find((l:any)=>l.id===id);group.opacity=37;h.doc.activeHistoryState={id:30};
    const before=appearance(h),beforeWrites=writes(h).length;
    if(failure==='pixels')h.ps.imaging.getPixels=async()=>{assert.equal(group.opacity,37);throw Error('capture failed');};
    await assert.rejects(current(h,failure==='validation'?()=>{throw Error('binding failed');}:undefined),/failed/);
    assert.equal(appearance(h),before);assert.equal(writes(h).length,beforeWrites);assert.ok(h.resources.every(r=>r.disposed));
  }
});

for(const depth of [8,16] as const)test(`native RGB${depth} lighting writes independent color amounts and one group mask`,async()=>{
  const h=host(depth,32,16,true),n=h.fields.width*h.fields.height,max=depth===16?65535:255;
  h.fields.channels=h.fields.channels.filter(c=>c.kind==='shadow'||c.kind==='light');
  for(const channel of h.fields.channels){channel.amount.fill(.6);const rgb=new Float32Array(n*3);for(let p=0;p<n;p++)rgb.set([.1,.3,.6],p*3);(channel as any).rgbAmount=rgb;}
  const written=new Map<number,number[]>(),put=h.ps.imaging.putPixels;
  h.ps.imaging.putPixels=async(o:any)=>{written.set(o.layerID,Array.from((await o.imageData.getData()).slice(0,4)));return put(o);};
  const id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'RGB lighting'),group=h.doc.layers.find((l:any)=>l.id===id);
  for(const channel of h.fields.channels){const layer=group.layers.find((l:any)=>l.blendMode===channel.blendMode),actual=written.get(layer.id)!;
    const expected=channel.blendMode==='multiply'?[.9,.7,.4]:[.1,.3,.6];
    for(let c=0;c<3;c++)assert.ok(Math.abs(actual[c]-Math.round(expected[c]*max))<=1,`${channel.kind} component${c}: ${actual[c]}`);
    assert.equal(actual[3],max);
  }
  assert.equal(h.calls.filter(c=>c[0]==='mask'&&c[1].layerID===id).length,1);
  assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]]);
  assert.ok(h.resources.every(r=>r.disposed));
});
