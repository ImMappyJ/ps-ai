import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoshopAdapter,type Snapshot} from '../src/infrastructure/photoshop/photoshop';
import {IMAGE_BUDGETS} from '../src/imaging/budget';

function fixture(depth:8|16=8,gray=false,width=12,height=8){
  const max=depth===16?65535:255,components=gray?2:4,make=(length:number)=>depth===16?new Uint16Array(length):new Uint8Array(length);
  let live=make(width*height*components);for(let p=0;p<width*height;p++){for(let c=0;c<components-1;c++)live[p*components+c]=(p+c+20)%max;live[p*components+components-1]=max;}
  const states=new Map<number,Uint8Array|Uint16Array>([[7,live.slice()],[8,live.slice()]]),reads:any[]=[],writes:any[]=[],disposed:any[]=[];
  let context:any,onRead:((options:any)=>void)|undefined,serial=50;
  const doc:any={id:11,width,height,mode:gray?'gray':'rgb',bitsPerChannel:depth,colorProfileName:gray?'Gray Gamma 2.2':depth===16?'ProPhoto RGB':'sRGB IEC61966-2.1',activeHistoryState:{id:8},selection:{bounds:null},layers:[{id:2,kind:'normal',visible:true,opacity:100,fillOpacity:100,isClippingMask:false}],activeLayers:[]};
  Object.defineProperty(doc,'historyStates',{get:()=>[...states.keys()].map(id=>({id}))});
  doc.createLayer=async()=>{const layer={id:++serial,delete:async()=>{writes.push(['delete',layer.id]);doc.layers=doc.layers.filter((l:any)=>l.id!==layer.id);}};doc.layers.unshift(layer);return layer;};
  const data=(values:Uint8Array|Uint16Array,w:number,h:number,n:number)=>({width:w,height:h,components:n,componentSize:depth,values,getData:async()=>values,dispose(){disposed.push(this);}});
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'},ElementPlacement:{PLACEBEFORE:'before'}},
    core:{executeAsModal:async(fn:any)=>{context={isCancelled:false,hostControl:{suspendHistory:async()=>1,resumeHistory:async(_id:number,commit:boolean)=>{if(commit){doc.activeHistoryState={id:doc.activeHistoryState.id+1};states.set(doc.activeHistoryState.id,live.slice());}}}};return fn(context);}},
    action:{batchPlay:async(commands:any[])=>commands.map(()=>({}))},
    imaging:{getPixels:async(o:any)=>{reads.push(o);const b=o.sourceBounds,w=b.right-b.left,h=b.bottom-b.top,source=states.get(o.historyStateID);assert.ok(source,'unknown historical pixels must not silently fall back');const out=make(w*h*components);for(let y=0;y<h;y++)out.set(source.subarray(((b.top+y)*width+b.left)*components,((b.top+y)*width+b.right)*components),y*w*components);onRead?.(o);return {sourceBounds:b,level:0,imageData:data(out,w,h,components)};},
      createImageDataFromBuffer:async(values:any,o:any)=>data(values,o.width,o.height,o.components),putPixels:async(o:any)=>{writes.push(['pixels',o]);live[0]=o.imageData.values[0];},putLayerMask:async(o:any)=>writes.push(['mask',o])}};
  const snapshot:Snapshot={documentId:11,width,height,mode:doc.mode,depth,profile:doc.colorProfileName,nativeDepth:depth,historyId:7,sessionId:'session',bounds:{left:1,top:1,right:3,bottom:3},mask:Uint8Array.from([255,128,0,255]),sourceHash:'source'};
  const adapter=new PhotoshopAdapter(ps,'session');
  const next=()=>{live=states.get(doc.activeHistoryState.id)!.slice();doc.activeHistoryState={id:doc.activeHistoryState.id+1};states.set(doc.activeHistoryState.id,live.slice());};
  return {doc,ps,adapter,snapshot,reads,writes,disposed,states,next,set onRead(fn:typeof onRead){onRead=fn;},get context(){return context;}};
}
const result={width:2,height:2,rgba:new Uint8Array([180,20,30,255,180,20,30,255,180,20,30,255,180,20,30,255])};

test('source proof rejects cancellation and changes while awaiting modal entry',async()=>{
  const h=fixture(),run=h.ps.core.executeAsModal;h.ps.core.executeAsModal=async(fn:any)=>{h.doc.colorProfileName='other';return run(fn);};
  await assert.rejects(h.adapter.verifyCandidateSource(h.snapshot));assert.deepEqual(h.reads,[]);
  const current=fixture();current.doc.activeHistoryState={id:7};const controller=new AbortController();controller.abort();
  await assert.rejects(current.adapter.verifyCandidateSource(current.snapshot,{signal:controller.signal}),/取消/);
});
test('source proof rejects host buffers at the wrong depth, size or cache level',async()=>{
  for(const fault of ['depth','size','level','buffer']){
    const h=fixture(16),read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const r=await read(o);if(fault==='depth')r.imageData.componentSize=8;if(fault==='size')r.imageData.width++;if(fault==='level')r.level=1;if(fault==='buffer')r.imageData.getData=async()=>new Uint8Array(r.imageData.width*r.imageData.height*4);return r;};
    await assert.rejects(h.adapter.verifyCandidateSource(h.snapshot));assert.equal(h.disposed.length,h.reads.length);assert.deepEqual(h.writes,[]);
  }
});

for(const depth of [8,16] as const)for(const gray of [false,true])test(`native ${gray?'gray':'RGB'}${depth} source proof permits application after deselection without loosening fresh-submission checks`,async()=>{
  const h=fixture(depth,gray),verify=(h.adapter as any).verifyCandidateSource;assert.equal(typeof verify,'function');
  await verify.call(h.adapter,h.snapshot);
  assert.equal(h.adapter.applicationMode(h.snapshot),'new');assert.throws(()=>h.adapter.assertSourceCurrent(h.snapshot),/改变/);
  const id=await h.adapter.apply(h.snapshot,result,'old result');assert.ok(id);assert.equal(h.adapter.applicationMode(h.snapshot),'replace');
  assert.equal(h.writes.filter(w=>w[0]==='pixels').length,1);assert.ok(h.reads.every(r=>r.colorProfile===h.snapshot.profile&&r.componentSize===depth&&r.colorSpace===(gray?'Grayscale':'RGB')));
  assert.equal(h.snapshot.historyId,7,'saved source provenance is not rebound');
});
test('a native low-bit wide-gamut change outside the edit ROI rejects without writing or granting permission',async()=>{
  const h=fixture(16);h.states.get(8)![h.doc.width*h.doc.height*4-4]++;
  await assert.rejects((h.adapter as any).verifyCandidateSource(h.snapshot),/改变|不同/);
  assert.equal(h.adapter.applicationMode(h.snapshot),'unavailable');assert.deepEqual(h.writes,[]);assert.ok(h.reads.every(r=>r.colorProfile==='ProPhoto RGB'));
});
test('source proof requires the exact session, profile, geometry and a surviving original historical baseline',async()=>{
  for(const change of ['session','profile','size','depth','missing']){
    const h=fixture();if(change==='session')h.snapshot.sessionId='other';if(change==='profile')h.doc.colorProfileName='Adobe RGB (1998)';if(change==='size')h.doc.width++;if(change==='depth')h.doc.bitsPerChannel=16;if(change==='missing')h.states.delete(7);
    await assert.rejects((h.adapter as any).verifyCandidateSource(h.snapshot));assert.deepEqual(h.reads,[]);assert.deepEqual(h.writes,[]);
  }
});
test('proof becomes unusable after another history change or a changed application mask',async()=>{
  for(const change of ['history','mask']){
    const h=fixture();await (h.adapter as any).verifyCandidateSource(h.snapshot);
    if(change==='history')h.next();else h.snapshot.mask[0]=1;
    await assert.rejects(h.adapter.apply(h.snapshot,result,'stale proof'));assert.deepEqual(h.writes,[]);
  }
});
test('rechecking after selection changes preserves exact owned-layer replacement instead of stacking another layer',async()=>{
  const h=fixture();h.doc.activeHistoryState={id:7};const first=await h.adapter.apply(h.snapshot,result,'first');h.next();h.reads.length=0;
  await (h.adapter as any).verifyCandidateSource(h.snapshot);assert.equal(h.adapter.applicationMode(h.snapshot),'replace');
  await h.adapter.apply(h.snapshot,result,'replacement');assert.equal(h.doc.layers.length,2);assert.ok(h.writes.some(w=>w[0]==='delete'&&w[1]===first));
  assert.ok(h.reads.some(r=>r.historyStateID===8),'compare against the owned application, not its earlier unmodified source');
});
test('source proof cancellation and concurrent document mutation dispose reads without granting permission',async()=>{
  for(const mutation of ['cancel','history','closed']){
    const h=fixture();h.onRead=()=>{if(mutation==='cancel')h.context.isCancelled=true;if(mutation==='history')h.doc.activeHistoryState={id:99};if(mutation==='closed')h.ps.app.documents=[];};
    await assert.rejects((h.adapter as any).verifyCandidateSource(h.snapshot));assert.equal(h.disposed.length,h.reads.length);assert.deepEqual(h.writes,[]);assert.equal(h.adapter.applicationMode(h.snapshot),'unavailable');
  }
});
test('source proof scans the entire native canvas in bounded strips and rejects impossible memory before reads',async()=>{
  const h=fixture(16,false,6000,100);await (h.adapter as any).verifyCandidateSource(h.snapshot);
  for(const id of [7,8])assert.equal(h.reads.filter(r=>r.historyStateID===id).reduce((sum,r)=>sum+(r.sourceBounds.right-r.sourceBounds.left)*(r.sourceBounds.bottom-r.sourceBounds.top),0),600000);
  assert.ok(h.reads.every(r=>(r.sourceBounds.right-r.sourceBounds.left)*(r.sourceBounds.bottom-r.sourceBounds.top)<=IMAGE_BUDGETS.stripPixels&&!r.targetSize));
  const blocked=fixture();await assert.rejects((blocked.adapter as any).verifyCandidateSource(blocked.snapshot,{retainedBytes:512_000_000}));assert.deepEqual(blocked.reads,[]);
});
test('a verified historical source also authorizes the native strip writer with the original effective mask',async()=>{
  const h=fixture();h.snapshot.captureGeometry={kind:'edit-analysis',width:1,height:1};h.snapshot.requiresClipping=false;
  await h.adapter.verifyCandidateSource(h.snapshot);await h.adapter.applyEditAnalysis(h.snapshot,result,'bounded history',{preserveAlpha:true});
  assert.equal(h.writes.filter(w=>w[0]==='pixels').length,1);assert.deepEqual([...h.writes.find(w=>w[0]==='mask')[1].imageData.values],[...h.snapshot.mask]);assert.equal(h.snapshot.historyId,7);
});
