import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter,type Snapshot} from '../src/infrastructure/photoshop/photoshop';
import {IMAGE_BUDGETS} from '../src/imaging/budget';

function host(width=6000,height=4000,depth:8|16=8){
  const calls:any[]=[],resources:{disposed:boolean}[]=[],original:any={id:1,visible:true,kind:'normal',opacity:100,fillOpacity:100,blendMode:'normal'},max=depth===16?65535:255;let next=10,baseline:any;
  const doc:any={id:7,width,height,mode:'rgb',bitsPerChannel:depth,colorProfileName:'sRGB IEC61966-2.1',activeHistoryState:{id:3},selection:{bounds:{left:0,top:0,right:width,bottom:height}},layers:[original]};
  let alpha:(x:number,y:number)=>number=(x,y)=>max,selected=(x:number,y:number)=>128;
  const data=(values:Uint8Array|Uint16Array,w:number,h:number,components:number)=>{const r={disposed:false};resources.push(r);return {width:w,height:h,components,componentSize:values instanceof Uint16Array?16:8,getData:async()=>values,dispose:()=>{assert.equal(r.disposed,false);r.disposed=true;}};};
  const context:any={isCancelled:false,hostControl:{suspendHistory:async()=>{baseline={layers:[...doc.layers],history:doc.activeHistoryState};calls.push('suspend');return 1;},resumeHistory:async(_id:number,commit:boolean)=>{calls.push(['resume',commit]);if(commit)doc.activeHistoryState={id:doc.activeHistoryState.id+1};else{doc.layers=baseline.layers;doc.activeHistoryState=baseline.history;}}}};
  doc.createLayer=async(_kind:any,o:any)=>{const layer:any={...o,id:next++,pieces:[],move:async()=>{},delete:async()=>{doc.layers=doc.layers.filter((l:any)=>l.id!==layer.id);}};doc.layers.unshift(layer);return layer;};
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'},ElementPlacement:{PLACEBEFORE:'before'}},core:{executeAsModal:async(fn:any)=>fn(context)},action:{batchPlay:async(o:any[])=>{calls.push(['batch',o]);return o.map(()=>({}));}},imaging:{
    getSelection:async(o:any)=>{const b=o.sourceBounds,w=b.right-b.left,h=b.bottom-b.top;calls.push(['selection',o]);assert.ok(w*h<=IMAGE_BUDGETS.stripPixels,'native selection must be grayscale strips');const gray=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=selected(x+b.left,y+b.top);return {imageData:data(gray,w,h,1),sourceBounds:b,level:0};},
    getPixels:async(o:any)=>{calls.push(['pixels',o]);const b=o.sourceBounds,w=o.targetSize?.width??b.right-b.left,h=o.targetSize?.height??b.bottom-b.top;if(!o.targetSize)assert.ok(w*h<=IMAGE_BUDGETS.stripPixels,'never allocate native large RGBA');const rgba=depth===16?new Uint16Array(w*h*4):new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;rgba[i]=depth===16?12345:48;rgba[i+1]=rgba[i+2]=rgba[i];rgba[i+3]=alpha(b.left+Math.floor(x*(b.right-b.left)/w),b.top+Math.floor(y*(b.bottom-b.top)/h));}return {imageData:data(rgba,w,h,4),sourceBounds:b,level:0};},
    createImageDataFromBuffer:async(values:any,o:any)=>data(values,o.width,o.height,o.components),
    putPixels:async(o:any)=>{const values=await o.imageData.getData(),layer=doc.layers.find((l:any)=>l.id===o.layerID);if(o.replace)layer.pieces=[];layer.pieces.push({top:o.targetBounds.top,height:o.imageData.height,first:[...values.subarray(0,4)]});calls.push(['write',o]);},
    putLayerMask:async(o:any)=>{calls.push(['mask',o]);},putSelection:async(o:any)=>calls.push(['selection-write',o])
  }};
  const adapter=new PhotoshopAdapter(ps,'s'),snapshot=(w=width,h=height):Snapshot=>({documentId:7,width:doc.width,height:doc.height,profile:doc.colorProfileName,mode:'rgb',depth,nativeDepth:depth,historyId:3,sessionId:'s',bounds:{left:0,top:0,right:w,bottom:h},mask:new Uint8Array(w*h).fill(128),sourceHash:'frozen',sourceLayerIds:[1],requiresClipping:false,captureGeometry:{kind:'edit-analysis',width:32,height:32}} as any);
  return {ps,doc,calls,resources,context,adapter,snapshot,original,max,alpha(fn:typeof alpha){alpha=fn;},selected(fn:typeof selected){selected=fn;}};
}
test('24M/36M/45M ordinary captures automatically use bounded work grids with full native masks',async()=>{
  for(const [w,h,d] of [[6000,4000,8],[9000,4000,8],[9000,5000,16]] as const){const hst=host(w,h,d),c=await hst.adapter.capture(0,undefined,7,8);
    assert.equal(c.snapshot.captureGeometry?.kind,'edit-analysis');assert.ok(c.image.width*c.image.height<=1024*1024);assert.equal(c.snapshot.mask.length,w*h);assert.equal(c.snapshot.mask[w*h-1],128);assert.equal((c.snapshot as any).requiresClipping,false);assert.equal(c.snapshot.nativeDepth,d);assert.equal(c.image.rgba instanceof Uint16Array,d===16);assert.ok(hst.resources.every(r=>r.disposed));
  }
});
test('native16 alpha scan detects a 65534 edge omitted by the bounded raster and validates the clipping base',async()=>{
  const h=host(6000,4000,16);h.alpha((x,y)=>x===5999&&y===3999?65534:65535);
  const c=await h.adapter.capture(0,undefined,7,8,{analysisResolution:32} as any);assert.equal((c.snapshot as any).requiresClipping,true);assert.equal(c.snapshot.clipBaseLayerId,1);
  assert.ok(h.calls.filter(c=>c[0]==='pixels'&&!c[1].targetSize).some(c=>c[1].layerID===1));
});
test('native16 strip apply retains source alpha once, pins history and preserves earlier strips',async()=>{
  const h=host(800,500,16),s=h.snapshot();(s as any).requiresClipping=true;s.clipBaseLayerId=1;h.alpha(()=>32768);
  const id=await (h.adapter as any).applyEditAnalysis(s,{width:2,height:2,rgba:new Uint16Array([50000,50000,50000,16384,50000,50000,50000,16384,50000,50000,50000,16384,50000,50000,50000,16384])},'Candidate',{preserveAlpha:true});
  const layer=h.doc.layers.find((l:any)=>l.id===id);assert.equal(layer.pieces.length,2);assert.deepEqual(layer.pieces[0].first,[31173,31173,31173,65535]);assert.equal(layer.isClippingMask,true);
  assert.ok(h.calls.filter(c=>c[0]==='pixels').every(c=>c[1].historyStateID===3));assert.ok(h.calls.filter(c=>c[0]==='write'||c[0]==='mask').every(c=>c[1].replace===false));assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]]);assert.ok(h.resources.every(r=>r.disposed));
});
test('edit strip apply cancellation, mask failure and changed source never publish a partial result',async()=>{
  for(const failure of ['cancel','mask','history']){const h=host(800,500,8),s=h.snapshot(),controller=new AbortController();if(failure==='history')h.doc.activeHistoryState.id=4;if(failure==='mask')h.ps.imaging.putLayerMask=async()=>{throw Error('mask failed');};
    await assert.rejects((h.adapter as any).applyEditAnalysis(s,{width:1,height:1,rgba:new Uint8Array([200,200,200,255])},'Candidate',{preserveAlpha:true,signal:controller.signal,onProgress:(done:number)=>{if(failure==='cancel'&&done===3)controller.abort();}}));
    assert.deepEqual(h.doc.layers,[h.original]);assert.ok(h.resources.every(r=>r.disposed));if(failure!=='history')assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',false]]);
  }
});
test('background capture derives exact native alpha-aware mask and strip apply reconstructs min(subject,alpha)',async()=>{
  const h=host(6000,4000,16);h.alpha(()=>32768);h.selected(()=>128);const c=await h.adapter.capture(0,undefined,7,8,{selection:'subject-background',analysisResolution:32} as any);
  assert.equal(c.snapshot.mask[0],255);assert.equal(c.subjectMask?.[0],128);assert.equal(c.selectionMask[0],255);assert.equal((c.snapshot as any).requiresClipping,false);
  const small=host(800,500,16),s=small.snapshot();s.backgroundComposite='subject-background-v1';s.mask.fill(255);small.alpha(()=>32768);
  const id=await (small.adapter as any).applyEditAnalysis(s,{width:1,height:1,rgba:new Uint16Array([50000,50000,50000,65535])},'Background',{preserveAlpha:false,subjectMask:new Uint8Array(800*500).fill(128),protectionMask:new Uint8Array(800*500)});
  const first=small.doc.layers.find((l:any)=>l.id===id).pieces[0].first;assert.deepEqual(first,[31172,31172,31172,65535]);
  s.mask[0]=0;await assert.rejects((small.adapter as any).applyEditAnalysis(s,{width:1,height:1,rgba:new Uint16Array([50000,50000,50000,65535])},'Mismatch',{preserveAlpha:false,subjectMask:new Uint8Array(800*500).fill(128),protectionMask:new Uint8Array(800*500)}));
});
test('large protection and selection restoration keep grayscale strips with one undo step',async()=>{
  const h=host(6000,4000,16),p=await h.adapter.protection();assert.equal(p.mask.length,24_000_000);assert.equal(p.mask[23_999_999],128);
  await h.adapter.restoreSelection({documentId:7,sessionId:'s',width:6000,height:4000,mode:'rgb',depth:16,bounds:p.bounds,mask:p.mask});
  const writes=h.calls.filter(c=>c[0]==='selection-write');assert.ok(writes.length>1);assert.equal(writes[0][1].replace,true);assert.ok(writes.slice(1).every(c=>c[1].replace===false));assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]]);assert.ok(h.resources.every(r=>r.disposed));
});
test('edit capture guards source/selection changes and cancellation during the native alpha scan',async()=>{
  for(const failure of ['history','selection','cancel']){const h=host(6000,3000,16),read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const result=await read(o);if(!o.targetSize){if(failure==='history')h.doc.activeHistoryState.id++;if(failure==='selection')h.doc.selection.bounds={...h.doc.selection.bounds,right:5999};if(failure==='cancel')h.context.isCancelled=true;}return result;};
    await assert.rejects(h.adapter.capture(0,undefined,7,8),failure==='cancel'?/取消/:/改变/);assert.deepEqual(h.doc.layers,[h.original]);assert.ok(h.resources.every(r=>r.disposed));
  }
});
test('valid completely transparent native strips support background filling and retain ordinary zero alpha',async()=>{
  for(const background of [false,true]){const h=host(800,500,16),s=h.snapshot();h.alpha(()=>0);s.mask.fill(255);if(background)s.backgroundComposite='subject-background-v1';
    const id=await h.adapter.applyEditAnalysis(s,{width:1,height:1,rgba:new Uint16Array([50000,23456,12345,65535])},'Transparent',{preserveAlpha:!background,...(background?{subjectMask:new Uint8Array(800*500).fill(128),protectionMask:new Uint8Array(800*500)}:{})});
    assert.deepEqual(h.doc.layers.find((l:any)=>l.id===id).pieces[0].first,background?[50000,23456,12345,65535]:[0,0,0,0]);assert.ok(h.resources.every(r=>r.disposed));
  }
});
test('a large ordinary transparent selection can generate an edit without a false bounded-visibility rejection',async()=>{
  const h=host(6000,3000,8);h.alpha(()=>0);const c=await h.adapter.capture(0,undefined,7,8,{analysisResolution:32});assert.equal(c.snapshot.captureGeometry?.kind,'edit-analysis');assert.equal(c.snapshot.requiresClipping,false);assert.ok(c.image.rgba.every(v=>v===0));
});
test('owned edit candidates read frozen history on replacement; mask mutations and ambiguous clipping cannot reuse authority',async()=>{
  const h=host(800,500,8),s=h.snapshot(),model={width:1,height:1,rgba:new Uint8Array([200,200,200,255])};
  const first=await h.adapter.applyEditAnalysis(s,model,'one',{preserveAlpha:true}),second=await h.adapter.applyEditAnalysis(s,model,'two',{preserveAlpha:true});assert.notEqual(first,second);assert.equal(h.doc.layers.length,2);assert.ok(h.calls.filter(c=>c[0]==='pixels').every(c=>c[1].historyStateID===3));
  s.mask[0]=255;await assert.rejects(h.adapter.applyEditAnalysis(s,model,'mutated',{preserveAlpha:true}),/改变/);assert.equal(h.doc.layers.length,2);
  const bad=host(800,500,16),missing=bad.snapshot();bad.alpha(()=>65534);await assert.rejects(bad.adapter.applyEditAnalysis(missing,model,'ambiguous',{preserveAlpha:true}),/透明度/);assert.deepEqual(bad.doc.layers,[bad.original]);
});
test('background protection is written once and insufficient raw model alpha rolls back',async()=>{
  const h=host(800,500,16),s=h.snapshot();s.backgroundComposite='subject-background-v1';s.mask.fill(127);h.alpha(()=>32768);
  const options={preserveAlpha:false,subjectMask:new Uint8Array(800*500).fill(128),protectionMask:new Uint8Array(800*500).fill(128)};
  const id=await h.adapter.applyEditAnalysis(s,{width:1,height:1,rgba:new Uint16Array([50000,50000,50000,65535])},'Protected',options);
  assert.deepEqual(h.doc.layers.find((l:any)=>l.id===id).pieces[0].first,[31172,31172,31172,65535]);
  const masks=h.calls.filter(c=>c[0]==='mask');assert.ok(masks.every(c=>c[1].replace===false));assert.equal((await masks[0][1].imageData.getData())[0],127*257);
  await assert.rejects(h.adapter.applyEditAnalysis(s,{width:1,height:1,rgba:new Uint16Array([50000,50000,50000,0])},'Unsafe',options),/90%/);assert.equal(h.doc.layers.length,2);assert.equal(h.doc.layers[0].id,id);
});
test('native work grid replies above the allocated pixel plan and retained apply memory stop safely',async()=>{
  const h=host(6000,3000,8),read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=(o:any)=>read(o.targetSize?{...o,targetSize:{width:100,height:100}}:o);
  await assert.rejects(h.adapter.capture(0,undefined,7,8,{analysisResolution:32}),/预算/);assert.ok(h.resources.every(r=>r.disposed));
  const small=host(800,500,8);await assert.rejects(small.adapter.applyEditAnalysis(small.snapshot(),{width:1,height:1,rgba:new Uint8Array([200,200,200,255])},'Over budget',{preserveAlpha:false,retainedBytes:512_000_000}),/预算/);assert.equal(small.calls.length,0);
});
test('45M edit apply covers the native canvas in bounded strips with one effective mask and one undo',async()=>{
  const h=host(9000,5000,8),s=h.snapshot();let pixelArea=0,maskArea=0,writes=0,masks=0,completed=0;
  h.ps.imaging.putPixels=async(o:any)=>{assert.equal(o.replace,false);assert.ok(o.imageData.width*o.imageData.height<=IMAGE_BUDGETS.stripPixels);pixelArea+=o.imageData.width*o.imageData.height;writes++;const v=await o.imageData.getData();assert.deepEqual([...v.subarray(0,4)],[80,120,160,255]);};
  h.ps.imaging.putLayerMask=async(o:any)=>{assert.equal(o.replace,false);maskArea+=o.imageData.width*o.imageData.height;masks++;const v=await o.imageData.getData();assert.equal(v[0],128);};
  const id=await h.adapter.applyEditAnalysis(s,{width:1,height:1,rgba:new Uint8Array([80,120,160,255])},'45M',{preserveAlpha:false,onProgress:(done,total)=>{completed=done;assert.equal(total,346);}});
  assert.equal(pixelArea,45_000_000);assert.equal(maskArea,45_000_000);assert.equal(writes,173);assert.equal(masks,173);assert.equal(completed,346);assert.equal(h.doc.layers[0].id,id);assert.ok(h.doc.layers.includes(h.original));assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]]);assert.ok(h.resources.every(r=>r.disposed));
});
