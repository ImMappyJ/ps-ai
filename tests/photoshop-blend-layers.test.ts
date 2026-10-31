import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter,type Snapshot} from '../src/infrastructure/photoshop/photoshop';
import type {RelightLayerFields,RelightChannelKind} from '../src/features/relight/relight-layers';
import {sha256} from '@noble/hashes/sha2.js';
function host(depth:8|16=16,width=800,height=500,whole=false){
  const calls:any[]=[],resources:{disposed:boolean}[]=[],original:any={id:1,name:'Original',visible:true},bounds={left:whole?0:13,top:whole?0:7,right:(whole?0:13)+width,bottom:(whole?0:7)+height};let nextId=10;
  const doc:any={id:7,width:whole?width:1000,height:whole?height:700,mode:'rgb',colorProfileName:'sRGB IEC61966-2.1',bitsPerChannel:depth,activeHistoryState:{id:3},layers:[original]};
  const makeLayer=(options:any)=>{const l:any={id:nextId++,name:options.name,blendMode:options.blendMode,opacity:options.opacity??100,fillOpacity:100,visible:true,pieces:[],move:async(target:any,placement:any)=>{assert.equal(placement,'before');doc.layers=doc.layers.filter((n:any)=>n.id!==l.id);const at=doc.layers.findIndex((n:any)=>n.id===target.id);assert.ok(at>=0);doc.layers.splice(at,0,l);calls.push(['move',l.id,target.id]);},delete:async()=>{doc.layers=doc.layers.filter((n:any)=>n.id!==l.id);calls.push(['delete',l.id]);}};return l;};
  doc.createLayer=async(_kind:any,o:any)=>{const l=makeLayer(o);doc.layers.unshift(l);calls.push(['create',l]);return l;};
  doc.createLayerGroup=async(o:any)=>{const g=makeLayer(o);g.layers=o.fromLayers;doc.layers=doc.layers.filter((l:any)=>!o.fromLayers.includes(l));doc.layers.unshift(g);calls.push(['group',g]);return g;};
  const data=(values:Uint8Array|Uint16Array,w:number,h:number,components:number)=>{const r={disposed:false};resources.push(r);return {width:w,height:h,componentSize:values instanceof Uint16Array?16:8,components,colorProfile:doc.colorProfileName,getData:async()=>values,dispose:()=>{assert.equal(r.disposed,false);r.disposed=true;}};};
  let baseline:any;
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal',PASSTHROUGH:'passThrough',MULTIPLY:'multiply',SCREEN:'screen',COLOR:'color'},ElementPlacement:{PLACEBEFORE:'before'}},
    core:{executeAsModal:async(fn:any)=>{calls.push('modal');return fn({hostControl:{suspendHistory:async()=>{const appearance=new Map<any,unknown>();const visit=(layers:any[])=>{for(const layer of layers){appearance.set(layer,{visible:layer.visible,opacity:layer.opacity});if(layer.layers)visit(layer.layers);}};visit(doc.layers);baseline={layers:[...doc.layers],history:doc.activeHistoryState,appearance};calls.push('suspend');return 1;},resumeHistory:async(_id:number,commit:boolean)=>{calls.push(['resume',commit]);if(commit)doc.activeHistoryState={id:doc.activeHistoryState.id+1};else{doc.layers=baseline.layers;doc.activeHistoryState=baseline.history;for(const [layer,appearance]of baseline.appearance)Object.assign(layer,appearance);}}}});}},
    action:{batchPlay:async(c:any[])=>{calls.push(['batch',c]);return c.map(()=>({}));}},imaging:{
      getPixels:async(o:any)=>{if(o.historyStateID!==undefined)assert.equal(o.historyStateID,3,'source validation must always use the frozen original history');const b=o.sourceBounds,w=b.right-b.left,h=b.bottom-b.top,max=depth===16?65535:255,rgba=depth===16?new Uint16Array(w*h*4):new Uint8Array(w*h*4);for(let p=0;p<w*h;p++){rgba[p*4]=depth===16?12345:48;rgba[p*4+1]=rgba[p*4+2]=rgba[p*4];rgba[p*4+3]=max;}calls.push(['read',o]);return {imageData:data(rgba,w,h,4),sourceBounds:b,level:0};},
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
function blend(depth:8|16=8){
  const h=host(depth,8,6,true);h.snapshot.captureGeometry={kind:'blend-analysis',width:8,height:6};h.snapshot.nativeDepth=depth;h.snapshot.requiresClipping=false;h.snapshot.blendOpaqueScope=true;
  h.snapshot.mask.set([0,1,64,128,255]);
  const {sceneFingerprint,...shared}=h.fields;
  const fields:RelightLayerFields={...shared,version:'blend-fields-v1',width:8,height:6,guide:new Float32Array(48).fill(.5),channels:h.fields.channels.filter(c=>c.kind==='shadow'||c.kind==='light').map(c=>({...c,amount:new Float32Array(48).fill(.1),rgbAmount:new Float32Array(144).fill(.1)}))};
  fields.source.maskRef=`blend-mask-v1:sha256:${Buffer.from(sha256(h.snapshot.mask)).toString('hex')}`;
  return {...h,fields};
}
test('blend native RGB8/16 passes through shadow/light with one effective mask and one history step',async()=>{
  for(const depth of [8,16] as const){const h=blend(depth),samples:number[][]=[];
    h.ps.imaging.putLayerMask=async(o:any)=>{samples.push(Array.from((await o.imageData.getData()).slice(0,5)));};
    const id=await h.adapter.applyRelightLayers(h.snapshot,h.fields,'Blend'),group=h.doc.layers.find((l:any)=>l.id===id);
    assert.equal(group.blendMode,'passThrough');assert.deepEqual(h.doc.layers,[group,h.original]);assert.deepEqual(group.layers.map((l:any)=>l.name),['Light','Shadow']);
    assert.deepEqual(samples[0],depth===16?[0,257,16448,32896,65535]:[0,1,64,128,255]);assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]]);assert.ok(h.resources.every(r=>r.disposed));
  }
});
test('Blend native writer rejects retained memory pressure before modal or writes',async()=>{
  const h=blend(16);
  await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'Blend',{retainedBytes:512_000_000}),/预算/);
  assert.equal(h.calls.length,0);
});
test('blend writer checks discriminated metadata, layers, opaque scope and history without publishing a group',async()=>{
  for(const failure of ['kind','layers','opaque','history','alpha']){const h=blend();
    if(failure==='kind')h.snapshot.captureGeometry!.kind='relight-analysis';if(failure==='layers')h.fields.source.layerIds=[2];if(failure==='opaque')h.snapshot.blendOpaqueScope=false;if(failure==='history')h.doc.activeHistoryState.id++;
    if(failure==='alpha'){const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const r=await read(o),get=r.imageData.getData;r.imageData.getData=async()=>{const p=await get();p[2*4+3]=0;return p;};return r;};}
    await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'unsafe'));assert.deepEqual(h.doc.layers,[h.original]);
  }
});
test('blend partial-write failure and cancellation roll back native group and retain resources',async()=>{
  for(const failure of ['write','cancel']){const h=blend(16),abort=new AbortController();if(failure==='write')h.ps.imaging.putPixels=async()=>{throw Error('injected strip failure');};
    await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'partial',{signal:abort.signal,onProgress:done=>{if(failure==='cancel'&&done===2)abort.abort();}}));
    assert.deepEqual(h.doc.layers,[h.original]);assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',false]]);assert.ok(h.resources.every(r=>r.disposed));
  }
});
test('new bounded blend redraw uses native strip writer without lighting-only ICC restrictions',async()=>{
  const h=blend(16);h.snapshot.captureGeometry={kind:'blend-analysis',width:4,height:3};h.snapshot.profile=h.doc.colorProfileName='Adobe RGB (1998)';
  const image={width:4,height:3,rgba:new Uint16Array(4*3*4).fill(65535)};
  const id=await h.adapter.applyEditAnalysis(h.snapshot,image,'Redraw',{preserveAlpha:false});assert.equal(h.doc.layers[0].id,id);assert.equal(h.doc.layers[1],h.original);assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]]);
});
test('blend writer rejects a wrong native-depth marker and partial-canvas geometry',async()=>{
  for(const failure of ['depth','bounds']){const h=blend();if(failure==='depth')h.snapshot.nativeDepth=16;
    if(failure==='bounds'){h.snapshot.bounds={left:0,top:0,right:4,bottom:6};h.snapshot.mask=new Uint8Array(24).fill(255);h.fields.source.bounds=h.snapshot.bounds;h.fields.source.maskRef=`blend-mask-v1:sha256:${Buffer.from(sha256(h.snapshot.mask)).toString('hex')}`;}
    await assert.rejects(h.adapter.applyRelightLayers(h.snapshot,h.fields,'invalid'));assert.deepEqual(h.doc.layers,[h.original]);
  }
});
