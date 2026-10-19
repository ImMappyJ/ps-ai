import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter,type Snapshot} from '../src/infrastructure/photoshop/photoshop';
import type {Bounds} from '../src/imaging/image';
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

/** PS27 clips intersecting reads and rejects requests outside selection bounds. */
function insetSelectionHost(){
  const h=host(6000,4000,8),selection={left:900,top:500,right:5500,bottom:3600},requests:Bounds[]=[];
  h.doc.selection.bounds=selection;
  h.selected((x,y)=>x<selection.left||x>=selection.right||y<selection.top||y>=selection.bottom||y>=1800&&y<2000?0:x===selection.left||x===selection.right-1||y===selection.top||y===selection.bottom-1?64:x===selection.left+1?128:255);
  const read=h.ps.imaging.getSelection;
  h.ps.imaging.getSelection=async(o:any)=>{
    const requested=o.sourceBounds;requests.push({...requested});
    const actual={left:Math.max(requested.left,selection.left),top:Math.max(requested.top,selection.top),right:Math.min(requested.right,selection.right),bottom:Math.min(requested.bottom,selection.bottom)};
    if(actual.right<=actual.left||actual.bottom<=actual.top)throw Error('Invalid Source Bounds');
    return read({...o,sourceBounds:actual});
  };
  return {...h,selection,requests};
}
for(const mode of ['ordinary','background','blend','relight'] as const)test(`selection strips preserve ${mode} context, offset feathering, protection and empty bands without out-of-selection reads`,async()=>{
  const h=insetSelectionHost(),s=h.selection,protection={documentId:7,sessionId:'s',width:6000,height:4000,bounds:{left:s.left,top:s.top,right:s.left+20,bottom:s.top+20},mask:new Uint8Array(400).fill(128)};
  const options=mode==='background'?{context:'document' as const,selection:'subject-background' as const}:mode==='blend'?{context:'document' as const,selection:'edit' as const}:mode==='relight'?{purpose:'relight-analysis' as const}:{};
  const c=await h.adapter.capture(.15,protection,7,8,{analysisResolution:32,...options}),b=c.snapshot.bounds,width=b.right-b.left;
  const raw=c.subjectMask??c.selectionMask,at=(x:number,y:number)=>((y-b.top)*width+x-b.left);
  assert.equal(c.snapshot.captureGeometry?.kind,mode==='relight'?'relight-analysis':'edit-analysis');
  assert.deepEqual(b,mode==='ordinary'||mode==='relight'?{left:435,top:35,right:5965,bottom:4000}:{left:0,top:0,right:6000,bottom:4000});
  assert.equal(raw.length,width*(b.bottom-b.top));assert.equal(raw[at(b.left,b.top)],0);assert.equal(raw[at(s.left,s.top+10)],64);assert.equal(raw[at(s.left+1,s.top+10)],128);assert.equal(raw[at(s.left+2,s.top+10)],255);
  assert.equal(raw[at(s.left+100,1900)],0,'empty pixels inside the bounding box must remain valid');assert.equal(raw[at(s.left+100,b.bottom-1)],0,'trailing context strips must stay zero');
  assert.deepEqual([c.snapshot.mask[at(s.left,s.top+10)],c.snapshot.mask[at(s.left+1,s.top+10)],c.snapshot.mask[at(s.left+2,s.top+10)]],mode==='background'?[95,63,0]:[32,64,127]);
  assert.equal(c.snapshot.mask[at(b.left,b.top)],mode==='background'?255:0);assert.ok(h.requests.length>1);
  assert.ok(h.requests.every(r=>r.left>=s.left&&r.top>=s.top&&r.right<=s.right&&r.bottom<=s.bottom&&r.left<r.right&&r.top<r.bottom),'only the frozen selection intersection may reach getSelection');
  assert.ok(h.requests.some(r=>r.top>=1800&&r.bottom<=2000),'valid all-zero strips within the selection bbox are read');
  assert.ok(h.resources.every(r=>r.disposed));
});

test('clipped cached selection strips map native16 feathering at the original document offset',async()=>{
  const h=host(8,4,16);h.doc.selection.bounds={left:2,top:0,right:6,bottom:4};let disposed=false;
  h.ps.imaging.getSelection=async(o:any)=>{
    assert.deepEqual(o.sourceBounds,{left:2,top:0,right:6,bottom:4});
    return {sourceBounds:{left:1,top:0,right:3,bottom:2},level:1,imageData:{width:2,height:2,components:1,componentSize:16,getData:async()=>new Uint16Array([64*257,128*257,64*257,128*257]),dispose(){disposed=true;}}};
  };
  const c=await h.adapter.capture(0,undefined,7,8,{purpose:'relight-analysis'});
  assert.deepEqual([...c.snapshot.mask],[0,0,64,80,112,128,0,0,0,0,64,80,112,128,0,0,0,0,64,80,112,128,0,0,0,0,64,80,112,128,0,0]);assert.equal(disposed,true);
});

test('cached selection bounds that cover neighboring cells do not write outside the frozen intersection',async()=>{
  const h=host(10,6,8),s={left:3,top:1,right:7,bottom:5};h.doc.selection.bounds=s;let disposed=false;
  h.ps.imaging.getSelection=async(o:any)=>{assert.deepEqual(o.sourceBounds,s);return {sourceBounds:{left:1,top:0,right:4,bottom:3},level:1,imageData:{width:3,height:3,components:1,componentSize:8,getData:async()=>new Uint8Array(9).fill(128),dispose(){disposed=true;}}};};
  const c=await h.adapter.capture(0,undefined,7,8,{purpose:'relight-analysis'});
  for(let y=0;y<6;y++)for(let x=0;x<10;x++)assert.equal(c.snapshot.mask[y*10+x],x>=s.left&&x<s.right&&y>=s.top&&y<s.bottom?128:0,`native (${x},${y})`);
  assert.equal(disposed,true);
});

test('selection-intersecting host errors still reject capture instead of becoming empty masks',async()=>{
  const h=insetSelectionHost(),read=h.ps.imaging.getSelection;let calls=0;
  h.ps.imaging.getSelection=async(o:any)=>{if(++calls===2)throw Error('Native selection read failed');return read(o);};
  await assert.rejects(h.adapter.capture(.15,undefined,7,8,{analysisResolution:32}),/Native selection read failed/);
  assert.equal(calls,2);assert.equal(h.calls.some(c=>c[0]==='pixels'),false);assert.ok(h.resources.every(r=>r.disposed));
});

test('source and cancellation guards survive skipped selection context strips and disposed reads',async()=>{
  for(const reason of ['source','selection','cancel']){const h=insetSelectionHost(),read=h.ps.imaging.getSelection;
    h.ps.imaging.getSelection=async(o:any)=>{const result=await read(o);if(reason==='source')h.doc.activeHistoryState.id++;if(reason==='selection')h.doc.selection.bounds={...h.selection,left:h.selection.left+1};if(reason==='cancel')h.context.isCancelled=true;return result;};
    await assert.rejects(h.adapter.capture(.15,undefined,7,8,{analysisResolution:32}),reason==='cancel'?/取消/:/改变/);assert.equal(h.calls.some(c=>c[0]==='pixels'),false);assert.ok(h.resources.every(r=>r.disposed));
  }
});

for(const depth of [8,16] as const)test(`selection asset strip apply keeps raw${depth} alpha and writes feather/protection exactly once`,async()=>{
  const h=host(800,500,depth),s=h.snapshot();s.requiresClipping=true;s.clipBaseLayerId=999;
  h.alpha(()=>0);
  for(let p=0;p<s.mask.length;p++)s.mask[p]=[0,64,128,255][p%4];
  const model={width:2,height:1,rgba:depth===16?new Uint16Array([12345,23456,34567,32769,12345,23456,34567,32769]):new Uint8Array([40,80,120,128,40,80,120,128])};
  const marker={assetContext:'selection-v1'} as const;
  await assert.rejects(h.adapter.applyEditAnalysis(s,model,'invalid',{preserveAlpha:true,...marker} as any),/策略|policy|素材|asset/i);
  assert.equal(h.calls.length,0,'asset retention is rejected before native IO');
  const id=await h.adapter.applyEditAnalysis(s,model,'asset',{preserveAlpha:false,...marker} as any);
  const layer=h.doc.layers.find((l:any)=>l.id===id);
  assert.deepEqual(layer.pieces[0].first,depth===16?[12345,23456,34567,32769]:[40,80,120,128]);
  assert.equal(layer.isClippingMask,undefined,'context source alpha never defines an asset silhouette');
  assert.equal(h.calls.some(c=>c[0]==='pixels'),false,'asset application must not bake source pixels or alpha');
  const masks=h.calls.filter(c=>c[0]==='mask');
  assert.ok(masks.length>1);
  assert.deepEqual([...((await masks[0][1].imageData.getData()).subarray(0,4))],depth===16?[0,64*257,128*257,65535]:[0,64,128,255]);
  assert.ok(h.calls.filter(c=>c[0]==='write'||c[0]==='mask').every(c=>c[1].replace===false));
  assert.deepEqual(h.doc.layers.filter((l:any)=>l.id===1),[h.original]);
  assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',true]],'one native history transaction');
  assert.ok(h.resources.every(r=>r.disposed));
});

test('selection asset writer rejects unknown markers, background reconstruction and stale source authority',async()=>{
  const model={width:1,height:1,rgba:new Uint8Array([100,150,200,128])};
  for(const failure of ['marker','background','session','closed','history']){
    const h=host(800,500,8),s=h.snapshot();let assetContext='selection-v1';
    if(failure==='marker')assetContext='selection-v2';
    if(failure==='background')s.backgroundComposite='subject-background-v1';
    if(failure==='session')s.sessionId='old';
    if(failure==='closed')h.ps.app.documents=[];
    if(failure==='history')h.doc.activeHistoryState.id++;
    await assert.rejects(h.adapter.applyEditAnalysis(s,model,'invalid',{preserveAlpha:false,assetContext} as any));
    assert.deepEqual(h.doc.layers,[h.original]);assert.equal(h.calls.length,0);
  }
});

test('selection asset failure or cancellation after partial writing rolls back the layer and source history',async()=>{
  for(const failure of ['mask','cancel']){
    const h=host(800,500,16),s=h.snapshot(),controller=new AbortController();
    if(failure==='mask')h.ps.imaging.putLayerMask=async()=>{throw Error('asset mask failed');};
    await assert.rejects(h.adapter.applyEditAnalysis(s,{width:1,height:1,rgba:new Uint16Array([12345,23456,34567,32769])},'asset',{preserveAlpha:false,assetContext:'selection-v1',signal:controller.signal,onProgress:(done:number)=>{if(failure==='cancel'&&done===3)controller.abort();}} as any));
    assert.deepEqual(h.doc.layers,[h.original]);assert.equal(h.doc.activeHistoryState.id,3);
    assert.deepEqual(h.calls.filter(c=>c[0]==='resume'),[['resume',false]]);assert.ok(h.resources.every(r=>r.disposed));
  }
});

test('opaque selection asset writing is blocked at the native strategy boundary before any host IO',async()=>{
  const h=host(800,500,8);
  await assert.rejects(h.adapter.applyEditAnalysis(h.snapshot(),{width:1,height:1,rgba:new Uint8Array([100,150,200,255])},'opaque',{preserveAlpha:false,assetContext:'selection-v1'}),/透明|transparen/i);
  assert.equal(h.calls.length,0);assert.deepEqual(h.doc.layers,[h.original]);
});

test('8-bit asset strips use native offsets, premultiplied sampling and one 16-bit feather without source alpha',async()=>{
  const h=host(800,500,16),s=h.snapshot(4,1);s.bounds={left:12,top:21,right:16,bottom:22};s.captureGeometry={kind:'edit-analysis',width:2,height:1};s.mask=new Uint8Array([0,64,128,255]);h.alpha(()=>0);
  let written:any;
  h.ps.imaging.putPixels=async(o:any)=>{written={bounds:o.targetBounds,rgba:[...await o.imageData.getData()]};};
  await h.adapter.applyEditAnalysis(s,{width:2,height:1,rgba:new Uint8Array([0,0,0,0,100,150,200,128])},'offset',{preserveAlpha:false,assetContext:'selection-v1'});
  assert.deepEqual(written,{bounds:{left:12,top:21},rgba:[0,0,0,0,25700,38550,51400,8224,25700,38550,51400,24672,25700,38550,51400,32896]});
  const mask=h.calls.find(c=>c[0]==='mask')[1];assert.deepEqual(mask.targetBounds,{left:12,top:21});assert.deepEqual([...await mask.imageData.getData()],[0,16448,32896,65535]);
  assert.equal(h.calls.some(c=>c[0]==='pixels'),false);
});

for(const depth of [8,16] as const)test(`selection-asset purpose captures native${depth} transparent editable pixels with visible context or a transparent source`,async()=>{
  for(const allTransparent of [false,true]){
    const h=host(8,4,depth),selection={left:2,top:1,right:6,bottom:3};h.doc.selection.bounds=selection;
    h.selected((x,y)=>x>=2&&x<6&&y>=1&&y<3?[64,128,255,255][x-2]:0);
    h.alpha((x,y)=>allTransparent||x>=2&&x<6&&y>=1&&y<3?0:h.max);
    const protection={documentId:7,sessionId:'s',width:8,height:4,bounds:{left:2,top:1,right:4,bottom:3},mask:new Uint8Array(4).fill(128)};
    const before={history:h.doc.activeHistoryState.id,layers:[...h.doc.layers],selection:{...h.doc.selection.bounds}};
    const capture=await h.adapter.capture(.5,protection,7,8,{purpose:'selection-asset',preserveNativeDepth:true} as any);
    assert.deepEqual(capture.snapshot.bounds,{left:0,top:0,right:8,bottom:4});
    assert.equal(capture.snapshot.nativeDepth,depth);assert.equal(capture.image.rgba instanceof Uint16Array,depth===16);
    assert.equal(capture.image.rgba[0],depth===16?12345:48,'native source precision is not reduced to model depth');
    assert.deepEqual([...capture.snapshot.mask.subarray(10,14)],[32,64,255,255]);
    assert.deepEqual([...capture.selectionMask.subarray(10,14)],[64,128,255,255]);
    assert.deepEqual([...capture.protectionMask.subarray(10,14)],[128,128,0,0]);
    assert.equal(capture.image.rgba[(1*8+2)*4+3],0);assert.equal(capture.image.rgba[3],allTransparent?0:h.max);
    assert.deepEqual({history:h.doc.activeHistoryState.id,layers:h.doc.layers,selection:h.doc.selection.bounds},before);
    assert.ok(h.resources.every(r=>r.disposed));
  }
});

test('selection-asset purpose itself freezes native depth while old visibility and ordinary capture rules remain',async()=>{
  const h=host(8,4,16);h.alpha(()=>0);
  const marked=await h.adapter.capture(0,undefined,7,8,{purpose:'selection-asset'} as any);
  assert.equal(marked.image.rgba instanceof Uint16Array,true);
  for(const options of [{preserveNativeDepth:true},{purpose:'relight-analysis',preserveNativeDepth:true}])await assert.rejects(h.adapter.capture(0,undefined,7,8,options as any),/可见像素/);
  const ordinary=await h.adapter.capture(0,undefined,7,8);
  assert.equal(ordinary.image.rgba instanceof Uint8Array,true,'unmarked small capture keeps its model-depth representation');
  assert.equal(ordinary.image.rgba[3],0);assert.ok(h.resources.every(r=>r.disposed));
});

test('selection-asset capture retains selection, protection, ICC, history and cancellation guards',async()=>{
  for(const failure of ['selection','protection','ICC','history','cancel']){
    const h=host(8,4,16);h.alpha(()=>0);let protection:any;
    if(failure==='selection')h.doc.selection.bounds=null;
    if(failure==='protection')protection={documentId:7,sessionId:'s',width:8,height:4,bounds:{left:0,top:0,right:8,bottom:4},mask:new Uint8Array(32).fill(255)};
    if(failure==='ICC')h.doc.colorProfileName='';
    if(failure==='history'||failure==='cancel'){const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const result=await read(o);if(failure==='history')h.doc.activeHistoryState.id++;else h.context.isCancelled=true;return result;};}
    await assert.rejects(h.adapter.capture(0,protection,7,8,{purpose:'selection-asset',preserveNativeDepth:true}),failure==='selection'?/选区/:failure==='protection'?/保护/:failure==='ICC'?/色彩|配置文件|来源/:failure==='history'?/改变/:/取消/);
    assert.deepEqual(h.doc.layers,[h.original]);assert.ok(h.resources.every(r=>r.disposed));
  }
});

test('invalid selection-asset purpose combinations reject before host reads',async()=>{
  for(const patch of [{purpose:'selection-asset-v2'},{selection:'document'},{selection:'subject-background'},{context:'document'},{preserveNativeDepth:false}]){
    const h=host(8,4,16);
    await assert.rejects(h.adapter.capture(0,undefined,7,8,{purpose:'selection-asset',...patch} as any),/捕获策略/);
    assert.equal(h.calls.length,0);assert.equal(h.resources.length,0);
  }
});

test('large selection-asset capture keeps edit-analysis geometry and native masks for an entirely transparent source',async()=>{
  const h=host(6000,3000,16);h.alpha(()=>0);
  const c=await h.adapter.capture(0,undefined,7,8,{purpose:'selection-asset',preserveNativeDepth:true,analysisResolution:32} as any);
  assert.equal(c.snapshot.captureGeometry?.kind,'edit-analysis');assert.equal(c.snapshot.mask.length,18_000_000);
  assert.equal(c.snapshot.mask[17_999_999],128);assert.equal(c.image.rgba instanceof Uint16Array,true);
  assert.equal(c.snapshot.requiresClipping,false);assert.equal(c.snapshot.clipBaseLayerId,undefined);
  assert.ok(h.resources.every(r=>r.disposed));
});
