import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter} from '../src/infrastructure/photoshop/photoshop';
import {IMAGE_BUDGETS} from '../src/imaging/budget';

function host(width=9000,height=5000,depth:8|16=16){
  const calls:any[]=[],doc:any={id:7,width,height,mode:'rgb',bitsPerChannel:depth,colorProfileName:'sRGB IEC61966-2.1',activeHistoryState:{id:3},selection:{bounds:{left:0,top:0,right:width,bottom:height}},layers:[{id:1,visible:true,kind:'normal',opacity:100,fillOpacity:100,blendMode:'normal'}]};
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'}},core:{executeAsModal:async(fn:any)=>fn({hostControl:{}})},imaging:{
    getPixels:async(o:any)=>{calls.push(['pixels',o]);const w=o.targetSize?.width??o.sourceBounds.right-o.sourceBounds.left,h=o.targetSize?.height??o.sourceBounds.bottom-o.sourceBounds.top,rgba=depth===16?new Uint16Array(w*h*4):new Uint8Array(w*h*4);for(let p=0;p<w*h;p++){rgba[p*4]=depth===16?12345:48;rgba[p*4+1]=rgba[p*4+2]=rgba[p*4];rgba[p*4+3]=depth===16?65535:255;}return {imageData:{width:w,height:h,components:4,componentSize:depth,getData:async()=>rgba,dispose:()=>calls.push('dispose')},sourceBounds:o.sourceBounds,level:0};},
    getSelection:async(o:any)=>{calls.push(['selection',o]);const w=o.sourceBounds.right-o.sourceBounds.left,h=o.sourceBounds.bottom-o.sourceBounds.top;return {imageData:{width:w,height:h,componentSize:8,components:1,getData:async()=>new Uint8Array(w*h).fill(128),dispose:()=>calls.push('dispose')},sourceBounds:o.sourceBounds,level:0};}
  }};return {ps,doc,calls,adapter:new PhotoshopAdapter(ps,'analysis-session')};
}
test('45M relight capture reads a bounded native16 analysis raster and retains exact native scope',async()=>{
  const h=host(),c=await h.adapter.capture(0,undefined,7,8,{selection:'document',preserveNativeDepth:true,purpose:'relight-analysis'} as any);
  assert.deepEqual(c.snapshot.bounds,{left:0,top:0,right:9000,bottom:5000});assert.equal(c.snapshot.mask.length,45_000_000);assert.equal(c.snapshot.mask[44_999_999],255);
  assert.ok(c.image.width*c.image.height<=IMAGE_BUDGETS.analysisPixels);assert.ok(c.image.rgba instanceof Uint16Array);assert.equal(c.image.rgba[0],12345);
  assert.deepEqual((c.snapshot as any).captureGeometry,{kind:'relight-analysis',width:c.image.width,height:c.image.height});
  assert.equal(h.calls.filter(c=>c[0]==='pixels').length,1);assert.equal(h.calls.some(c=>c[0]==='selection'),false);assert.ok(h.calls.find(c=>c[0]==='pixels')[1].targetSize);
});
test('capture records numeric native depth from actual Photoshop enum equality while retaining the raw enum identity',async()=>{
  const h=host(128,96,16);h.doc.bitsPerChannel='bitDepth16';h.ps.constants.BitsPerChannelType.SIXTEEN='bitDepth16';
  const c=await h.adapter.capture(0,undefined,7,8,{selection:'document',purpose:'relight-analysis'});
  assert.equal(c.snapshot.depth,'bitDepth16');assert.equal((c.snapshot as any).nativeDepth,16);assert.ok(c.image.rgba instanceof Uint16Array);
});
test('large-document small normal ROI is native and an over-limit document rejects before pixel or file access',async()=>{
  const h=host();h.doc.selection.bounds={left:100,top:200,right:104,bottom:203};const c=await h.adapter.capture(0,undefined,7);
  assert.equal((c.snapshot as any).captureGeometry,undefined);assert.equal(h.calls.find(c=>c[0]==='pixels')[1].targetSize,undefined);assert.ok(c.image.width*c.image.height<10_000);
  const bad=host(9001,5000);let files=0;const a=new PhotoshopAdapter(bad.ps,'analysis-session',async()=>{},async()=>{files++;return undefined;});
  await assert.rejects(a.capture(0,undefined,7,8,{selection:'document',purpose:'relight-analysis'} as any),/4500/);assert.equal(files,0);assert.equal(bad.calls.length,0);
});
test('analysis selection reads use bounded nonoverlapping native gray strips and detect a changed source',async()=>{
  const h=host(6000,4000,8);const original=h.ps.imaging.getSelection;let n=0;
  h.ps.imaging.getSelection=async(o:any)=>{if(++n===2)h.doc.activeHistoryState.id++;return original(o);};
  await assert.rejects(h.adapter.capture(0,undefined,7,8,{purpose:'relight-analysis'} as any),/改变/);
  assert.equal(h.calls.some(c=>c[0]==='pixels'),false);assert.ok(h.calls.filter(c=>c[0]==='selection').every(c=>(c[1].sourceBounds.right-c[1].sourceBounds.left)*(c[1].sourceBounds.bottom-c[1].sourceBounds.top)<=IMAGE_BUDGETS.stripPixels));
});
test('analysis mask restores cache coordinates and feathering directly in grayscale',async()=>{
  const h=host(4,2,8);h.ps.imaging.getSelection=async()=>({imageData:{width:2,height:1,componentSize:8,components:1,getData:async()=>new Uint8Array([0,255]),dispose(){}},sourceBounds:{left:0,top:0,right:2,bottom:1},level:1});
  const c=await h.adapter.capture(0,undefined,7,8,{purpose:'relight-analysis'});assert.deepEqual([...c.snapshot.mask],[0,64,191,255,0,64,191,255]);
});

test('retained session buffers reject ordinary capture before source pixels are read',async()=>{
  const h=host(100,100,8);
  await assert.rejects(h.adapter.capture(0,undefined,7,8,{retainedBytes:512_000_000} as any),/预算/);
  assert.equal(h.calls.length,0);
});

test('blend analysis freezes full visible environment and native16 subject/protection without native RGBA allocation',async()=>{
  const h=host(1200,800,16);h.doc.selection.bounds={left:100,top:100,right:700,bottom:700};
  const c=await h.adapter.capture(0,undefined,7,8,{purpose:'blend-analysis',preserveNativeDepth:true} as any);
  assert.equal(c.snapshot.captureGeometry?.kind,'blend-analysis');assert.deepEqual(c.snapshot.bounds,{left:0,top:0,right:1200,bottom:800});
  assert.ok(c.image.rgba instanceof Uint16Array);assert.equal(c.snapshot.mask.length,960000);assert.equal(c.snapshot.requiresClipping,false);
  assert.ok(h.calls.filter(c=>c[0]==='pixels').every(c=>c[1].targetSize||(c[1].sourceBounds.right-c[1].sourceBounds.left)*(c[1].sourceBounds.bottom-c[1].sourceBounds.top)<=IMAGE_BUDGETS.stripPixels));
  assert.equal(c.selectionMask[0],0);assert.equal(c.selectionMask[200*1200+200],128);
});
test('blend capture requires a subject selection plus visible outside environment and rejects document scope',async()=>{
  const h=host(64,64,8);
  await assert.rejects(h.adapter.capture(0,undefined,7,8,{purpose:'blend-analysis',selection:'document'} as any),/策略/);
  await assert.rejects(h.adapter.capture(0,undefined,7,8,{purpose:'blend-analysis'} as any),/选区外/);
  h.doc.selection.bounds=undefined;await assert.rejects(h.adapter.capture(0,undefined,7,8,{purpose:'blend-analysis'} as any),/选区/);
});
test('45M blend capture preserves native16 analysis values while every unscaled read stays bounded',async()=>{
  const h=host(9000,5000,16);h.doc.selection.bounds={left:0,top:0,right:4500,bottom:5000};
  const c=await h.adapter.capture(0,undefined,7,8,{purpose:'blend-analysis'});
  assert.equal(c.snapshot.blendOpaqueScope,true);assert.equal(c.snapshot.mask.length,45_000_000);assert.ok(c.image.rgba instanceof Uint16Array);assert.equal(c.image.rgba[0],12345);assert.ok(c.image.width*c.image.height<=IMAGE_BUDGETS.analysisPixels);
  const reads=h.calls.filter(c=>c[0]==='pixels');assert.equal(reads.filter(c=>c[1].targetSize).length,1);assert.ok(reads.filter(c=>!c[1].targetSize).every(c=>(c[1].sourceBounds.right-c[1].sourceBounds.left)*(c[1].sourceBounds.bottom-c[1].sourceBounds.top)<=IMAGE_BUDGETS.stripPixels));
});
test('blend redraw may capture a transparent subject area with visible environment while native lighting proof stays false',async()=>{
  const h=host(64,64,8);h.doc.selection.bounds={left:0,top:0,right:32,bottom:64};const read=h.ps.imaging.getPixels;
  h.ps.imaging.getPixels=async(o:any)=>{const r=await read(o),get=r.imageData.getData;r.imageData.getData=async()=>{const rgba=await get();for(let y=0;y<r.imageData.height;y++)for(let x=0;x<r.imageData.width;x++)if(o.sourceBounds.left+(x+.5)*(o.sourceBounds.right-o.sourceBounds.left)/r.imageData.width<32)rgba[(y*r.imageData.width+x)*4+3]=0;return rgba;};return r;};
  const c=await h.adapter.capture(0,undefined,7,8,{purpose:'blend-analysis'});assert.equal(c.snapshot.blendOpaqueScope,false);assert.equal(c.snapshot.requiresClipping,false);assert.equal(c.image.rgba[3],0);
});
