import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopLightingColor} from '../src/infrastructure/photoshop/lighting-color';
import {createIccSeed} from '../src/imaging/icc-profile';
test('cancelled color conversion does not create a temporary document or file',async()=>{const ctrl=new AbortController();ctrl.abort();const service=new PhotoshopLightingColor({},{});await assert.rejects(()=>service.toLinear({width:1,height:1,depth:8,profileName:'x',profileBytes:new Uint8Array(),nativePixels:new Uint8Array(4),calibration:''},undefined,ctrl.signal),/取消/);});

function profile(){const b=new Uint8Array(160),v=new DataView(b.buffer);v.setUint32(0,160);b[8]=2;b.set(Buffer.from('mntrRGB XYZ '),12);b.set(Buffer.from('acsp'),36);v.setUint32(128,1);b.set(Buffer.from('desc'),132);v.setUint32(136,144);v.setUint32(140,16);return b;}
function host(failure:'policy'|'save'|'cancel'|'partial-open'){
  const bytes=profile(),ctrl=new AbortController(),original={id:1,name:'User source',history:7},files=new Map<string,any>(),app:any={documents:[original],activeDocument:original};let id=2;
  const uxp:any={storage:{formats:{binary:'binary'},localFileSystem:{getTemporaryFolder:async()=>({createFile:async(name:string)=>{const f={bytes:new Uint8Array(),write:async(b:any)=>{f.bytes=new Uint8Array(b);},getMetadata:async()=>({size:f.bytes.length}),read:async()=>f.bytes.buffer,delete:async()=>{files.delete(name);}};files.set(name,f);return f;}}),createSessionToken:()=> 'owned-token'}}};
  const ps:any={app,core:{executeAsModal:async(fn:any)=>fn({hostControl:{registerAutoCloseDocument:async()=>{if(failure==='cancel')ctrl.abort();}}})},action:{batchPlay:async()=>{const d:any={id:id++,closeWithoutSaving:async()=>{app.documents=app.documents.filter((x:any)=>x!==d);},saveAs:{psd:async(f:any)=>{if(failure==='save')throw Error('save failed');const changed=bytes.slice();changed[150]=1;f.bytes=createIccSeed(changed);}}};app.documents.push(d);app.activeDocument=d;if(failure==='partial-open')throw Error('open failed after creation');return [{}];}}};
  return {service:new PhotoshopLightingColor(ps,uxp),ps,ctrl,files,app,original,source:{width:1,height:1,depth:8 as const,profileName:'test',profileBytes:bytes,nativePixels:new Uint8Array([20,40,60,255]),calibration:'a'.repeat(64)}};
}
for(const failure of ['policy','save','cancel'] as const)test(`ICC ${failure} failure closes its containers and files while restoring the existing document`,async()=>{const h=host(failure);await assert.rejects(()=>h.service.toLinear(h.source,undefined,h.ctrl.signal),failure==='policy'?/打开策略改变/:failure==='save'?/save failed/:/取消/);assert.deepEqual(h.app.documents,[h.original]);assert.equal(h.app.activeDocument,h.original);assert.equal(h.original.history,7);assert.equal(h.files.size,0);});
test('a host open rejecting after document creation still closes the owned container',async()=>{const h=host('partial-open');await assert.rejects(()=>h.service.toLinear(h.source),/open failed/);assert.deepEqual(h.app.documents,[h.original]);assert.equal(h.app.activeDocument,h.original);assert.equal(h.files.size,0);});
test('typed cancellation survives a stringifying native modal boundary',async()=>{const h=host('cancel'),modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=async(fn:any)=>{try{return await modal(fn);}catch(e){throw String(e);}};await assert.rejects(()=>h.service.toLinear(h.source,undefined,h.ctrl.signal),(e:any)=>e?.code==='cancelled');assert.deepEqual(h.app.documents,[h.original]);});
test('profile extraction cleans a duplicate created before the host rejects',async()=>{
  const h=host('policy');h.ps.constants={DocumentMode:{RGB:'rgb'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},ColorProfileType:{NONE:'none'}};
  Object.assign(h.original,{width:8,height:8,mode:'rgb',bitsPerChannel:8,colorProfileName:'test',colorProfileType:'custom',activeHistoryState:{id:7},duplicate:async()=>{await h.ps.action.batchPlay();throw Error('duplicate failed after creation');}});
  await assert.rejects(()=>h.service.captureProfile(h.original.id),/duplicate failed/);assert.deepEqual(h.app.documents,[h.original]);assert.equal(h.app.activeDocument,h.original);assert.equal(h.files.size,0);
});

test('owned writes retain the verified source ICC baseline for undo without another full document duplicate',async()=>{
  let copies=0;const bytes=profile(),doc:any={id:1,width:9000,height:5000,mode:'rgb',bitsPerChannel:16,colorProfileName:'wide',colorProfileType:'custom',activeHistoryState:{id:7},duplicate:async()=>{copies++;throw Error('uncached history');}};
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},ColorProfileType:{NONE:'none'}},core:{executeAsModal:async(fn:any)=>fn({hostControl:{}})}};
  const service=new PhotoshopLightingColor(ps,{storage:{localFileSystem:{getTemporaryFolder:async()=>({})}}});
  service.rememberWrittenProfile(doc.id,bytes);doc.activeHistoryState.id=8;service.rememberWrittenProfile(doc.id,bytes);doc.activeHistoryState.id=9;service.rememberWrittenProfile(doc.id,bytes);
  doc.activeHistoryState.id=7;assert.deepEqual(await service.captureProfile(doc.id,150_000_000),bytes);assert.equal(copies,0);
  doc.activeHistoryState.id=10;await assert.rejects(()=>service.captureProfile(doc.id),/uncached history/);assert.equal(copies,1,'an unrelated history never inherits the cache');
});
