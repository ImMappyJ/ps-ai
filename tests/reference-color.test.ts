import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter} from '../src/infrastructure/photoshop/photoshop';
import {diagnostic} from '../src/diagnostics/diagnostics';

function referenceHost(depth:8|16=8,profile='',owned=true){
  const calls:string[]=[],previous:any={id:1},documents:any[]=[previous];let cancelled=false;
  const pixels=depth===16?new Uint16Array([12345,23456,34567,65535,22222,33333,44444,32768]):new Uint8Array([48,91,135,255,86,130,173,128]);
  const reference:any={id:2,name:'reference.jpg',width:2,height:1,mode:'rgb',bitsPerChannel:depth,colorProfileName:profile,activeHistoryState:{id:1},layers:[{id:3}],selection:{bounds:null},path:'C:/fixture/reference.jpg'};
  const close=(doc:any)=>async()=>{calls.push(`close:${doc.id}`);documents.splice(documents.indexOf(doc),1);};reference.closeWithoutSaving=close(reference);
  if(!owned)documents.push(reference);
  const context={get isCancelled(){return cancelled;},hostControl:{registerAutoCloseDocument:async(id:number)=>{calls.push(`register:${id}`);},unregisterAutoCloseDocument:async(id:number)=>{calls.push(`unregister:${id}`);},suspendHistory:async()=>1,resumeHistory:async()=>{}}};
  const ps:any={constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16}},app:{documents,activeDocument:previous,open:async()=>{calls.push('open');if(owned)documents.push(reference);ps.app.activeDocument=reference;return reference;}},
    core:{executeAsModal:async(fn:any)=>{try{return await fn(context);}catch(error){throw String(error);}}},
    imaging:{getPixels:async(o:any)=>{calls.push(`pixels:${o.documentID}`);return {sourceBounds:o.sourceBounds,imageData:{width:2,height:1,componentSize:depth,components:4,getData:async()=>pixels,dispose:()=>{calls.push('dispose');}}};}}};
  reference.duplicate=async()=>{calls.push('duplicate');const copy={...reference,id:4,path:undefined};copy.closeWithoutSaving=close(copy);documents.push(copy);ps.app.activeDocument=copy;return copy;};
  const adapter=new PhotoshopAdapter(ps,'reference-session');
  return {adapter,ps,reference,previous,documents,calls,pixels,context,cancel:()=>{cancelled=true;}};
}

test('reference profile failures retain their typed diagnostic through a stringifying Photoshop modal boundary',async()=>{
  const h=referenceHost();await assert.rejects(h.adapter.importReference({name:'reference.jpg'}),(error:any)=>{
    assert.equal(error.code,'source-profile');assert.equal(diagnostic(error,'capture').code,'source-profile');return true;
  });
  assert.deepEqual(h.documents,[h.previous]);assert.equal(h.ps.app.activeDocument,h.previous);assert.equal(h.calls.some(c=>c.startsWith('pixels')),false);
});

for(const depth of [8,16] as const)for(const owned of [true,false])test(`explicit approximate reference import preserves the original RGB${depth} document (owned=${owned})`,async()=>{
  const h=referenceHost(depth,'',owned),before=JSON.stringify(h.reference);
  const result=await h.adapter.importReference({name:'reference.jpg'},0,{assumeSrgb:true});
  assert.equal(result.colorReason,'assumed-srgb');assert.equal(JSON.stringify(h.reference),before);
  assert.ok(h.calls.includes('pixels:4'));assert.ok(h.calls.includes('close:4'));assert.equal(h.calls.includes('close:2'),owned);assert.ok(h.calls.includes('dispose'));
  assert.equal(h.ps.app.activeDocument,h.previous);assert.deepEqual(h.documents,owned?[h.previous]:[h.previous,h.reference]);assert.equal(result.rgba instanceof Uint8Array,true);
  assert.equal(result.rgba[3],255);assert.equal(result.rgba[7],128);
});

test('an explicit reference approximation never replaces the current tagged profile or unsupported modes',async()=>{
  const h=referenceHost(8,'Adobe RGB (1998)');const result=await h.adapter.importReference({name:'reference.jpg'},0,{assumeSrgb:true});
  assert.equal(result.colorReason,undefined);assert.equal(h.calls.includes('duplicate'),false);assert.ok(h.calls.includes('pixels:2'));
  for(const [mode,depth] of [['gray',8],['cmyk',8],['rgb',32]] as const){const bad=referenceHost();bad.reference.mode=mode;bad.reference.bitsPerChannel=depth;await assert.rejects(bad.adapter.importReference({},0,{assumeSrgb:true}));assert.equal(bad.calls.includes('duplicate'),false);assert.equal(bad.calls.some(c=>c.startsWith('pixels')),false);}
});

test('reference cancellation after opening reads no pixels and restores the previous document',async()=>{
  const h=referenceHost(8,'sRGB IEC61966-2.1');const open=h.ps.app.open;h.ps.app.open=async()=>{const doc=await open();h.cancel();return doc;};
  await assert.rejects(h.adapter.importReference({},0,{assumeSrgb:true}),(e:any)=>e.code==='cancelled');
  assert.deepEqual(h.documents,[h.previous]);assert.equal(h.ps.app.activeDocument,h.previous);assert.equal(h.calls.some(c=>c.startsWith('pixels')),false);
});

test('approximate reference failures still dispose and close temporary documents',async()=>{
  const h=referenceHost();h.ps.imaging.getPixels=async()=>{throw new Error('pixel read failed');};
  await assert.rejects(h.adapter.importReference({},0,{assumeSrgb:true}),/pixel read failed/);
  assert.ok(h.calls.includes('close:4'));assert.ok(h.calls.includes('close:2'));assert.equal(h.reference.colorProfileName,'');assert.equal(h.ps.app.activeDocument,h.previous);
});

test('reference auto-close registration failure still closes its owned document and restores focus',async()=>{
  const h=referenceHost();h.ps.core.executeAsModal=async(fn:any)=>fn({hostControl:{registerAutoCloseDocument:async()=>{throw Error('register failed');},unregisterAutoCloseDocument:async()=>{}}});
  await assert.rejects(h.adapter.importReference({},0,{assumeSrgb:true}),/register failed/);
  assert.deepEqual(h.documents,[h.previous]);assert.equal(h.ps.app.activeDocument,h.previous);
});

test('reference cancellation or source changes during pixel materialization reject and clean up',async()=>{
  for(const change of ['cancel','source'] as const){const h=referenceHost(),read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const result=await read(o);result.imageData.getData=async()=>{if(change==='cancel')h.cancel();else h.reference.activeHistoryState={id:2};return h.pixels;};return result;};
    await assert.rejects(h.adapter.importReference({},0,{assumeSrgb:true}),change==='cancel'?/取消/:/状态已改变/);
    assert.ok(h.calls.includes('dispose'));assert.deepEqual(h.documents,[h.previous]);assert.equal(h.ps.app.activeDocument,h.previous);
  }
});

test('reference disposal and copy-close errors still attempt all remaining owned cleanup',async()=>{
  for(const fault of ['dispose','close-copy'] as const){const h=referenceHost(),read=h.ps.imaging.getPixels,duplicate=h.reference.duplicate;
    if(fault==='dispose')h.ps.imaging.getPixels=async(o:any)=>{const result=await read(o);result.imageData.dispose=()=>{throw Error('dispose failed');};return result;};
    else h.reference.duplicate=async()=>{const copy=await duplicate();copy.closeWithoutSaving=async()=>{throw Error('close-copy failed');};return copy;};
    await assert.rejects(h.adapter.importReference({},0,{assumeSrgb:true}),/failed/);
    assert.ok(h.calls.includes('close:2'));assert.equal(h.ps.app.activeDocument,h.previous);
    if(fault==='close-copy'){assert.ok(h.calls.includes('register:4'));assert.equal(h.calls.includes('unregister:4'),false);}else assert.ok(h.calls.includes('close:4'));
  }
});

test('verified file sRGB declarations remain exact even when approximation is allowed',async()=>{
  const h=referenceHost();const adapter=new PhotoshopAdapter(h.ps,'reference-session',async()=>{},async()=>({kind:'srgb',format:'png',width:2,height:1,depth:8,reason:'png-srgb'}));
  const image=await adapter.importReference({},0,{assumeSrgb:true});assert.equal(image.colorReason,undefined);assert.ok(h.calls.includes('duplicate'));assert.deepEqual(h.documents,[h.previous]);
});

test('reference import rejects cancellation during copy close or final owned unregister',async()=>{
  for(const phase of ['copy-close','final-unregister'] as const){const h=referenceHost(),duplicate=h.reference.duplicate,unregister=h.context.hostControl.unregisterAutoCloseDocument;
    if(phase==='copy-close')h.reference.duplicate=async()=>{const copy=await duplicate(),close=copy.closeWithoutSaving;copy.closeWithoutSaving=async()=>{await close();h.cancel();};return copy;};
    else h.context.hostControl.unregisterAutoCloseDocument=async(id:number)=>{await unregister(id);if(id===2)h.cancel();};
    await assert.rejects(h.adapter.importReference({},0,{assumeSrgb:true}),(error:any)=>error.code==='cancelled');
    assert.deepEqual(h.documents,[h.previous]);assert.equal(h.ps.app.activeDocument,h.previous);
  }
});

test('reference import rejects an already-open original changing during temporary copy cleanup',async()=>{
  const h=referenceHost(8,'',false),duplicate=h.reference.duplicate;
  h.reference.duplicate=async()=>{const copy=await duplicate(),close=copy.closeWithoutSaving;copy.closeWithoutSaving=async()=>{await close();h.reference.activeHistoryState={id:2};};return copy;};
  await assert.rejects(h.adapter.importReference({},0,{assumeSrgb:true}),/状态已改变/);
  assert.deepEqual(h.documents,[h.previous,h.reference]);assert.equal(h.ps.app.activeDocument,h.previous);
});
