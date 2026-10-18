import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {RelightWorkbench,type RelightResult,type RelightWorkbenchHost} from '../src/features/relight/relight-workbench';
import {RelightSession} from '../src/features/relight/relight-session';
import type {Capture} from '../src/infrastructure/photoshop/photoshop';
import {decodePng,type Raster} from '../src/imaging/image';

async function panelHarness(source:Raster={width:2,height:2,rgba:new Uint8Array(16).fill(255)}){
  const {document,window}=parseHTML(await fs.readFile('plugin/index.html','utf8')),el=(id:string)=>document.getElementById(id) as any;
  for(const select of Array.from(document.querySelectorAll('select'))){let value=select.querySelector('option[selected]')?.getAttribute('value')??select.querySelector('option')?.getAttribute('value');Object.defineProperty(select,'value',{configurable:true,get:()=>value,set:(v:string)=>{value=String(v);}});}
  const dialog=el('relight-dialog');let close=()=>{};
  dialog.uxpShowModal=()=>{dialog.setAttribute('open','');return new Promise<void>(resolve=>{close=()=>{dialog.removeAttribute('open');resolve();};});};dialog.close=()=>close();
  el('relight-viewport').getBoundingClientRect=()=>({left:20,top:100,width:680,height:450});
  (window.HTMLElement.prototype as any).setPointerCapture=function(pointerId:number){this.capturedPointer=pointerId;};(window.HTMLElement.prototype as any).releasePointerCapture=function(){this.capturedPointer=undefined;};
  const capture=():Capture=>({image:source,snapshot:{documentId:11,width:source.width,height:source.height,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:source.rgba instanceof Uint16Array?16:8,historyId:1,sessionId:'session',sourceHash:'pixels',bounds:{left:0,top:0,right:source.width,bottom:source.height},mask:new Uint8Array(source.width*source.height).fill(255),sourceLayerIds:[2]},selectionMask:new Uint8Array(source.width*source.height).fill(255),protectionMask:new Uint8Array(source.width*source.height)});
  const session=new RelightSession(capture(),'snapshot-1','light-1'),files:Record<string,string>={},pixelRequests:unknown[]=[],posts:unknown[]=[],uploads:unknown[]=[],applied:string[]=[],errors:Error[]=[],results:RelightResult[]=[];
  type SourceState=ReturnType<NonNullable<RelightWorkbenchHost['sourceState']>>;
  let serial=1,sourceListener:(()=>void)|undefined,subscriptions=0,disposals=0,rereadError:Error|undefined,sourceState:SourceState='current';const rereadOptions:unknown[]=[];
  const workbench=new RelightWorkbench(dialog,session,{uuid:()=>`light-${++serial}`,save:async scene=>{files['relight-draft.json']=JSON.stringify({scene});},loadDraft:async()=>undefined,prepare:async()=>{pixelRequests.push('prepare');},generate:async(frozen)=>{posts.push(frozen);},cancel:async()=>{},reread:async options=>{rereadOptions.push(options);pixelRequests.push('reread');if(rereadError)throw rereadError;session.rebind(capture(),`snapshot-${++serial}`);sourceState='current';},apply:async id=>{applied.push(id);},export:async()=>{},results:()=>results,diagnostics:async()=>'',busy:()=>false,sourceState:()=>sourceState,observeSource:invalidate=>{sourceListener=invalidate;subscriptions++;return()=>{sourceListener=undefined;disposals++;};},reportError:error=>{errors.push(error);}});
  const event=(id:string,type:string,values:Record<string,unknown>={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,values);el(id).dispatchEvent(e);return e;};
  return {el,event,click:(id:string)=>event(id,'click'),change:(id:string)=>event(id,'change'),workbench,session,files,pixelRequests,posts,uploads,applied,errors,results,capture,rereadOptions,invalidate:()=>sourceListener?.(),setSourceState:(state:SourceState)=>{sourceState=state;},setRereadError:(error?:Error)=>{rereadError=error;},subscriptions:()=>({subscriptions,disposals}),close:async()=>{dialog.close();await new Promise(r=>setTimeout(r,15));}};
}
async function open(h:Awaited<ReturnType<typeof panelHarness>>){h.workbench.show();await new Promise(r=>setTimeout(r,65));}
async function scene(h:Awaited<ReturnType<typeof panelHarness>>){h.click('relight-save');await new Promise(r=>setTimeout(r,10));return JSON.parse(String(h.files['relight-draft.json'])).scene;}

test('light dragging updates coordinates without rebuilding lists, rereading pixels, saving or submitting',async()=>{
  const h=await panelHarness();try{
    await open(h);await new Promise(r=>setTimeout(r,200));
    const row=h.el('relight-lights').firstChild,reads=h.pixelRequests.length,posts=h.posts.length,uploads=h.uploads.length;
    const draft=h.files['relight-draft.json'],marker=h.el('relight-markers').querySelector('[data-kind="light"]');marker.id='drag-performance';
    h.event(marker.id,'pointerdown',{button:0,pointerId:17,clientX:280,clientY:240});
    const selectedRow=h.el('relight-lights').firstChild;assert.ok(selectedRow===row,'pointerdown retains the existing light list');
    for(let x=300;x<420;x+=5)h.event('relight-viewport','pointermove',{pointerId:17,buttons:1,clientX:x,clientY:280});
    assert.ok(h.el('relight-lights').firstChild===row,'pointermove retains the existing light list');assert.notEqual(h.el('relight-x').value,'0.25');
    assert.equal(h.pixelRequests.length,reads);assert.equal(h.posts.length,posts);assert.equal(h.uploads.length,uploads);assert.equal(h.files['relight-draft.json'],draft);
    h.event('relight-viewport','pointerup',{pointerId:17});
    const moved=await scene(h);assert.notEqual(moved.lights[0].x,.25);h.click('relight-undo');assert.equal((await scene(h)).lights[0].x,.25);
  }finally{await h.close();}
});

for(const termination of ['blur','pointercancel','lostpointercapture','buttons-released','pointerout'])test(`drag ${termination} restores pointer state without a stuck gesture`,async()=>{
  const h=await panelHarness();try{
    await open(h);const before=await scene(h),marker=h.el('relight-markers').querySelector('[data-kind="light"]');marker.id='interrupted-drag';
    h.event(marker.id,'pointerdown',{button:0,pointerId:23,clientX:280,clientY:240});h.event('relight-viewport','pointermove',{pointerId:23,buttons:1,clientX:420,clientY:300});
    if(termination==='buttons-released')h.event('relight-viewport','pointermove',{pointerId:23,buttons:0,clientX:420,clientY:300});
    else h.event(termination==='lostpointercapture'?marker.id:'relight-dialog',termination,{pointerId:23,buttons:termination==='pointerout'?0:1,relatedTarget:null});
    assert.equal(marker.capturedPointer,undefined);assert.equal(h.el('relight-viewport').className.includes('dragging'),false);
    const ended=await scene(h);
    if(termination==='pointercancel')assert.deepEqual(ended,before);
    else {assert.notEqual(ended.lights[0].x,before.lights[0].x);h.click('relight-undo');assert.deepEqual(await scene(h),before);}
    h.event(marker.id,'pointerdown',{button:0,pointerId:24,clientX:280,clientY:240});h.event('relight-viewport','pointermove',{pointerId:24,buttons:1,clientX:450,clientY:320});h.event('relight-viewport','pointerup',{pointerId:24});
    assert.notEqual((await scene(h)).lights[0].x,before.lights[0].x);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

async function until(check:()=>boolean){for(let attempt=0;attempt<200;attempt++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('workbench did not settle');}
test('rapid drag previews converge at low resolution and release produces the final resolution without backlog',async()=>{
  const source:Raster={width:800,height:600,rgba:new Uint8Array(800*600*4).fill(80)};for(let p=3;p<source.rgba.length;p+=4)source.rgba[p]=255;
  const h=await panelHarness(source);try{
    await open(h);await until(()=>h.workbench.previewStats.completed>0);const baseline=h.workbench.previewStats;
    const marker=h.el('relight-markers').querySelector('[data-kind="light"]');marker.id='quality-drag';h.event(marker.id,'pointerdown',{button:0,pointerId:31,clientX:280,clientY:240});
    for(let x=300;x<500;x++)h.event('relight-viewport','pointermove',{pointerId:31,buttons:1,clientX:x,clientY:300});
    await until(()=>h.workbench.previewStats.completed>baseline.completed&&!h.workbench.previewStats.running);
    const readImage=()=>decodePng(new Uint8Array(Buffer.from(String(h.el('relight-image').getAttribute('src')).split(',')[1],'base64')));
    assert.equal(readImage().width,240);assert.ok(h.workbench.previewStats.started-baseline.started<=2,'coalesced moves must not queue a preview per event');
    h.event('relight-viewport','pointerup',{pointerId:31});await until(()=>!h.workbench.previewStats.running&&!h.workbench.previewStats.pending&&readImage().width===480);
    assert.equal(readImage().height,360);assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);
  }finally{await h.close();}
});

test('source invalidation cancels queued preview and closing disposes only its owned listeners',async()=>{
  const h=await panelHarness();try{
    await open(h);const encoded=h.workbench.previewStats.encoded;
    h.el('relight-intensity').value='2';h.change('relight-intensity');h.invalidate();await new Promise(r=>setTimeout(r,45));
    assert.equal(h.workbench.previewStats.encoded,encoded);assert.equal(h.el('relight-generate').disabled,true);assert.match(h.el('relight-source').textContent,/来源已过期/);
    h.click('relight-close');await new Promise(r=>setTimeout(r,25));assert.deepEqual(h.subscriptions(),{subscriptions:1,disposals:1});assert.equal(h.el('relight-image').getAttribute('src'),null);
    h.workbench.setSourceInvalid(false);await open(h);assert.deepEqual(h.subscriptions(),{subscriptions:2,disposals:1});assert.equal(h.posts.length,0);
  }finally{await h.close();assert.deepEqual(h.subscriptions(),{subscriptions:2,disposals:2});}
});

test('failed source reread remains visibly stale and a later successful reread atomically keeps edited lighting',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='2.7';h.change('relight-intensity');const frozen=h.session.freeze();
    h.setSourceState('changed');h.setRereadError(new Error('source access failed'));h.click('relight-reread');await new Promise(r=>setTimeout(r,45));
    assert.equal(h.session.freeze().scene.source.snapshotId,'snapshot-1');assert.equal(h.el('relight-generate').disabled,true);assert.match(h.el('relight-status').textContent,/source access failed/);
    h.setRereadError();h.click('relight-reread');await new Promise(r=>setTimeout(r,45));
    assert.notEqual(h.session.freeze().scene.source.snapshotId,'snapshot-1');assert.equal(h.session.freeze().scene.lights[0].intensity,2.7);assert.equal(h.el('relight-generate').disabled,false);
    assert.equal(frozen.scene.source.snapshotId,'snapshot-1');assert.equal(frozen.scene.lights[0].intensity,2.7);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('output switching requires reread while a legacy selected result retains its complete-result apply action',async()=>{
  const h=await panelHarness();try{
    await open(h);assert.equal(h.el('relight-output').value,'lighting-layers');h.el('relight-output').value='full-result';h.change('relight-output');assert.equal(h.el('relight-generate').disabled,true);
    h.click('relight-reread');await new Promise(r=>setTimeout(r,45));assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.session.freeze().outputKind,'full-result');
    h.results.push({jobId:'legacy-job',fingerprint:h.session.fingerprint,image:h.session.sourceCapture.image});h.workbench.refreshAvailability();
    const result=h.el('relight-result-list').querySelector('button');result.id='legacy-choice';h.click(result.id);assert.match(result.textContent,/整图重绘/);assert.match(h.el('relight-apply').textContent,/整图结果/);
    h.click('relight-apply');await new Promise(r=>setTimeout(r,45));assert.deepEqual(h.applied,['legacy-job']);
  }finally{await h.close();}
});

test('safe visible source changes reread once before generation while preserving the lighting design',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='2.4';h.change('relight-intensity');const frozen=h.session.freeze();
    h.setSourceState('changed');h.invalidate();h.invalidate();h.invalidate();
    await until(()=>h.pixelRequests.length===1&&h.workbench.isOpen&&h.session.freeze().scene.source.snapshotId!=='snapshot-1');
    assert.deepEqual(h.rereadOptions,[{explicit:false}]);assert.equal(h.session.freeze().scene.lights[0].intensity,2.4);assert.equal(frozen.scene.source.snapshotId,'snapshot-1');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

for(const scenario of ['retained-result','different-geometry','failed-reread'])test(`source autosync ${scenario} keeps a clear recovery boundary`,async()=>{
  const h=await panelHarness();try{
    await open(h);if(scenario==='retained-result')h.results.push({jobId:'old-result',fingerprint:h.session.fingerprint,image:h.session.sourceCapture.image});
    if(scenario==='failed-reread')h.setRereadError(new Error('source unavailable'));
    h.setSourceState(scenario==='different-geometry'?'rebind-required':'changed');h.invalidate();
    await new Promise(r=>setTimeout(r,100));assert.equal(h.el('relight-generate').disabled,true);
    assert.equal(h.pixelRequests.length,scenario==='failed-reread'?1:0);
    if(scenario==='failed-reread'){assert.match(h.el('relight-status').textContent,/source unavailable/);h.workbench.refreshAvailability();await new Promise(r=>setTimeout(r,60));assert.equal(h.pixelRequests.length,1,'failed autosync does not loop on stale metadata');}
    assert.equal(h.session.freeze().scene.source.snapshotId,'snapshot-1');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});
