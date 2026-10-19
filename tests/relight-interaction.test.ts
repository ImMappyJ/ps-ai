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
  type Scene=ReturnType<typeof session.editor.snapshot>;
  let busy=false,draft:Scene|Promise<Scene|undefined>|undefined;const saves:unknown[]=[];
  let serial=1,sourceListener:(()=>void)|undefined,subscriptions=0,disposals=0,rereadError:Error|undefined,sourceState:SourceState='current';const rereadOptions:unknown[]=[];
  const workbench=new RelightWorkbench(dialog,session,{uuid:()=>`light-${++serial}`,save:async scene=>{files['relight-draft.json']=JSON.stringify({scene});saves.push(scene);},loadDraft:async()=>draft,prepare:async()=>{pixelRequests.push('prepare');},generate:async(frozen)=>{posts.push(frozen);},cancel:async()=>{},reread:async options=>{rereadOptions.push(options);pixelRequests.push('reread');if(rereadError)throw rereadError;session.rebind(capture(),`snapshot-${++serial}`);sourceState='current';},apply:async id=>{applied.push(id);},export:async()=>{},results:()=>results,busy:()=>busy,sourceState:()=>sourceState,observeSource:invalidate=>{sourceListener=invalidate;subscriptions++;return()=>{sourceListener=undefined;disposals++;};},reportError:error=>{errors.push(error);}});
  const event=(id:string,type:string,values:Record<string,unknown>={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,values);el(id).dispatchEvent(e);return e;};
  return {el,event,click:(id:string)=>event(id,'click'),change:(id:string)=>event(id,'change'),workbench,session,files,saves,setBusy:(value:boolean)=>{busy=value;workbench.refreshAvailability();},setDraft:(value:typeof draft)=>{draft=value;},pixelRequests,posts,uploads,applied,errors,results,capture,rereadOptions,invalidate:()=>sourceListener?.(),setSourceState:(state:SourceState)=>{sourceState=state;},setRereadError:(error?:Error)=>{rereadError=error;},subscriptions:()=>({subscriptions,disposals}),close:async()=>{dialog.close();await new Promise(r=>setTimeout(r,15));}};
}
async function open(h:Awaited<ReturnType<typeof panelHarness>>){h.workbench.show();await new Promise(r=>setTimeout(r,65));}
async function scene(h:Awaited<ReturnType<typeof panelHarness>>){h.click('relight-save');await new Promise(r=>setTimeout(r,10));return JSON.parse(String(h.files['relight-draft.json'])).scene;}

function slider(h:Awaited<ReturnType<typeof panelHarness>>,id='intensity'){
  const node=h.el(`relight-${id}-slider`);assert.ok(node,`${id} has a native horizontal slider`);return node;
}
function slide(h:Awaited<ReturnType<typeof panelHarness>>,value:string,id='intensity'){
  slider(h,id).value=value;h.event(`relight-${id}-slider`,'input');
}

test('slider and precise input share a clamped scene value and reject malformed numbers',async()=>{
  const h=await panelHarness();try{
    await open(h);const node=slider(h);assert.equal(node.min,'0');assert.equal(node.max,'4');assert.equal(node.step,'0.05');
    slide(h,'2.35');h.change('relight-intensity-slider');assert.equal(h.el('relight-intensity').value,'2.35');assert.equal(h.session.editor.snapshot().lights[0].intensity,2.35);
    h.el('relight-intensity').value='1.234';h.change('relight-intensity');assert.equal(String(node.value),'1.234');assert.equal(h.session.editor.snapshot().lights[0].intensity,1.234);
    for(const [input,want]of [['99',4],['-2',0]] as const){h.el('relight-intensity').value=input;h.change('relight-intensity');assert.equal(String(node.value),String(want));assert.equal(h.el('relight-intensity').value,String(want));assert.equal(h.session.editor.snapshot().lights[0].intensity,want);}
    for(const value of ['', 'NaN', 'Infinity']){h.el('relight-intensity').value=value;h.change('relight-intensity');assert.equal(h.session.editor.snapshot().lights[0].intensity,0);assert.equal(String(node.value),'0');assert.equal(h.el('relight-intensity').getAttribute('aria-invalid'),'true');}
    slide(h,'1.05');h.change('relight-intensity-slider');assert.equal(h.el('relight-intensity').hasAttribute('aria-invalid'),false);assert.equal(h.el('relight-intensity').value,'1.05');assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);
  }finally{await h.close();}
});

test('slider drag and native keyboard order each commit one undo without saving during input',async()=>{
  const h=await panelHarness();try{
    await open(h);slider(h);const saves=h.saves.length;
    h.event('relight-intensity-slider','pointerdown',{button:0,pointerId:40});for(const value of ['1.2','1.8','2.35'])slide(h,value);
    await new Promise(r=>setTimeout(r,240));assert.equal(h.saves.length,saves);assert.equal(h.session.editor.canUndo,false);
    h.change('relight-intensity-slider');h.event('relight-intensity-slider','pointerup',{pointerId:40});
    h.click('relight-undo');assert.equal(h.el('relight-intensity').value,'1');assert.equal(String(slider(h).value),'1');assert.equal(h.session.editor.canUndo,false);
    h.click('relight-redo');assert.equal(h.el('relight-intensity').value,'2.35');
    // PS27 dispatches input/change before bubbled keydown, without keyup.
    slide(h,'2.4');h.change('relight-intensity-slider');h.event('relight-intensity-slider','keydown',{key:'ArrowRight'});
    h.click('relight-undo');assert.equal(h.el('relight-intensity').value,'2.35');h.click('relight-redo');assert.equal(String(slider(h).value),'2.4');
    h.event('relight-intensity-slider','pointerdown',{button:0,pointerId:41});slide(h,'3');h.event('relight-intensity-slider','pointerup',{pointerId:41});h.click('relight-undo');assert.equal(h.session.editor.snapshot().lights[0].intensity,2.4);
    assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);assert.doesNotMatch(h.el('relight-status').textContent,/already active|active relight gesture/);
  }finally{await h.close();}
});

test('Escape cancels an active slider and restores both controls without an undo record',async()=>{
  const h=await panelHarness();try{
    await open(h);slider(h);h.event('relight-intensity-slider','pointerdown',{button:0,pointerId:42});slide(h,'3');
    const escaped=h.event('relight-intensity-slider','keydown',{key:'Escape'});assert.equal(escaped.defaultPrevented,true);
    assert.equal(h.session.editor.snapshot().lights[0].intensity,1);assert.equal(h.el('relight-intensity').value,'1');assert.equal(String(slider(h).value),'1');assert.equal(h.session.editor.canUndo,false);
    h.event('relight-intensity-slider','pointerup',{pointerId:42});slide(h,'2');h.change('relight-intensity-slider');h.click('relight-undo');assert.equal(h.el('relight-intensity').value,'1');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('workbench keyboard undo ends a slider gesture when native blur is absent',async()=>{
  const h=await panelHarness();try{
    await open(h);slide(h,'2');slide(h,'2.5');
    assert.doesNotThrow(()=>h.event('relight-viewport','keydown',{key:'z',ctrlKey:true}));
    assert.equal(h.session.editor.snapshot().lights[0].intensity,1);assert.equal(String(slider(h).value),'1');assert.equal(h.session.editor.canUndo,false);
  }finally{await h.close();}
});

for(const termination of ['blur','pointercancel','close','busy','source-invalid','source-state'])test(`slider ${termination} ends its gesture and permits a later undo`,async()=>{
  const h=await panelHarness();try{
    await open(h);slider(h);h.event('relight-intensity-slider','pointerdown',{button:0,pointerId:43});slide(h,'2.75');
    if(termination==='close'){await h.close();await open(h);}
    else if(termination==='busy'){h.setBusy(true);assert.equal(slider(h).disabled,true);assert.equal(h.el('relight-intensity').disabled,true);h.setBusy(false);}
    else if(termination==='source-invalid'){h.workbench.invalidateSource();h.workbench.setSourceInvalid(false);}
    else if(termination==='source-state'){h.setSourceState('closed');h.workbench.refreshAvailability();h.setSourceState('current');h.workbench.setSourceInvalid(false);}
    else h.event('relight-intensity-slider',termination,{pointerId:43});
    const cancelled=termination==='pointercancel';assert.equal(h.session.editor.snapshot().lights[0].intensity,cancelled?1:2.75);assert.equal(String(slider(h).value),cancelled?'1':'2.75');
    assert.doesNotThrow(()=>h.session.editor.undo());assert.equal(h.session.editor.snapshot().lights[0].intensity,1);
    h.workbench.refreshAvailability();slide(h,'1.5');h.change('relight-intensity-slider');h.click('relight-undo');assert.equal(h.el('relight-intensity').value,'1');assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);
  }finally{await h.close();}
});

test('light selection and restored drafts synchronize sliders without sharing undo gestures',async()=>{
  const h=await panelHarness();try{
    await open(h);slider(h);const saved=h.session.editor.snapshot();saved.lights[0].intensity=3.15;h.setDraft(saved);
    h.click('relight-add');const second=h.session.editor.selectedId!;h.event('relight-intensity-slider','pointerdown',{button:0,pointerId:44});slide(h,'2.5');
    const first=h.el('relight-lights').querySelector('[data-light-id="light-1"]');first.id='first-light';h.click('first-light');assert.equal(String(slider(h).value),'1');
    h.click('relight-undo');assert.equal(h.session.editor.snapshot().lights.find(l=>l.id===second)?.intensity,1);assert.equal(h.session.editor.snapshot().lights.length,2);
    h.click('relight-load-draft');await new Promise(r=>setTimeout(r,20));assert.equal(String(slider(h).value),'3.15');assert.equal(h.el('relight-intensity').value,'3.15');
    await h.close();await open(h);assert.equal(String(slider(h).value),'3.15');assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);
  }finally{await h.close();}
});

test('a draft resolving during slider input ends the old editor gesture before restoring',async()=>{
  const h=await panelHarness();try{
    await open(h);slider(h);const saved=h.session.editor.snapshot();saved.lights[0].intensity=3.15;
    let resolve!:(value:typeof saved)=>void;h.setDraft(new Promise(r=>{resolve=r;}));h.click('relight-load-draft');slide(h,'2');
    resolve(saved);await new Promise(r=>setTimeout(r,20));assert.equal(String(slider(h).value),'3.15');
    slide(h,'3.5');slide(h,'3.75');h.change('relight-intensity-slider');h.click('relight-undo');
    assert.equal(h.session.editor.snapshot().lights[0].intensity,3.15);assert.equal(h.session.editor.canUndo,false);assert.equal(h.pixelRequests.length,0);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('continuous light and global controls bind existing ranges and follow type, color and lock availability',async()=>{
  const h=await panelHarness();try{
    await open(h);h.click('relight-advanced-toggle');h.el('relight-type').value='spot';h.change('relight-type');
    const fields=[['z','-1','1','0.05','-0.25'],['temperature','2000','12000','100','7300'],['range','0.05','3','0.05','1.4'],['softness','0','1','0.05','0.65'],['cone','5','160','1','78'],['ambient-intensity','0','4','0.05','0.85'],['shadow-strength','0','1','0.05','0.25'],['shadow-softness','0','1','0.05','0.75']];
    for(const [id,min,max,step,value]of fields){const node=slider(h,id);assert.equal(node.min,min,id);assert.equal(node.max,max,id);assert.equal(node.step,step,id);slide(h,value,id);h.change(`relight-${id}-slider`);assert.equal(h.el(`relight-${id}`).value,value,id);}
    const s=h.session.editor.snapshot();assert.equal(s.lights[0].z,-.25);assert.deepEqual(s.lights[0].color,{mode:'temperature',kelvin:7300});assert.equal(s.lights[0].range,1.4);assert.equal(s.lights[0].softness,.65);assert.equal(s.lights[0].cone,78);assert.equal(s.ambient.intensity,.85);assert.equal(s.shadow.strength,.25);assert.equal(s.shadow.softness,.75);
    h.el('relight-locked').checked=true;h.change('relight-locked');assert.equal(slider(h,'z').disabled,true);assert.equal(h.el('relight-z').disabled,true);assert.equal(slider(h).disabled,false);
    h.el('relight-color-mode').value='custom';h.change('relight-color-mode');assert.equal(slider(h,'temperature').disabled,true);assert.equal(h.el('relight-temperature-field').style.display,'none');
    h.el('relight-type').value='directional';h.change('relight-type');assert.equal(slider(h,'range').disabled,true);assert.equal(slider(h,'cone').disabled,true);assert.equal(h.el('relight-direction-fields').style.display,'block');
    for(const [id,min,max,value]of [['direction','-180','180','122'],['elevation','-90','90','-45']]){const node=slider(h,id);assert.equal(node.min,min);assert.equal(node.max,max);assert.equal(node.step,'1');assert.equal(node.disabled,false);slide(h,value,id);h.change(`relight-${id}-slider`);assert.equal(h.el(`relight-${id}`).value,value);}
    assert.equal(h.session.editor.snapshot().lights[0].direction,122);assert.equal(h.session.editor.snapshot().lights[0].elevation,-45);assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);
  }finally{await h.close();}
});

test('rapid slider input coalesces a low-resolution illustration and release produces the final preview',async()=>{
  const source:Raster={width:800,height:600,rgba:new Uint8Array(800*600*4).fill(100)};for(let p=3;p<source.rgba.length;p+=4)source.rgba[p]=255;
  const h=await panelHarness(source);try{
    await open(h);slider(h);await until(()=>h.workbench.previewStats.completed>0);const before=h.workbench.previewStats,saves=h.saves.length;
    h.event('relight-intensity-slider','pointerdown',{button:0,pointerId:45});for(let i=0;i<80;i++)slide(h,String(i*.05));
    const image=()=>decodePng(new Uint8Array(Buffer.from(String(h.el('relight-image').getAttribute('src')).split(',')[1],'base64')));
    await until(()=>h.workbench.previewStats.completed>before.completed&&!h.workbench.previewStats.running);assert.equal(image().width,240);assert.ok(h.workbench.previewStats.started-before.started<=2);assert.equal(h.saves.length,saves);
    h.change('relight-intensity-slider');h.event('relight-intensity-slider','pointerup',{pointerId:45});await until(()=>!h.workbench.previewStats.running&&!h.workbench.previewStats.pending&&image().width===480);
    assert.equal(image().height,360);h.click('relight-undo');assert.equal(h.session.editor.snapshot().lights[0].intensity,1);assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);
  }finally{await h.close();}
});

test('workbench mounts and reopens with only the two supported output choices',async()=>{
  const h=await panelHarness();try{
    for(let opening=0;opening<2;opening++){
      await open(h);assert.equal(h.workbench.isOpen,true);assert.equal(h.el('relight-dialog').hasAttribute('open'),true);
      assert.deepEqual(Array.from(h.el('relight-output').querySelectorAll('option'),(option:any)=>[option.value,!!option.disabled]),[['lighting-layers',false],['full-result',false]]);
      assert.equal(h.el('relight-compensation'),null);assert.equal(h.el('relight-compensation-info'),null);
      h.el('relight-intensity').value='2.4';h.change('relight-intensity');await h.close();
    }
    assert.equal(h.session.editor.snapshot().lights[0].intensity,2.4);assert.deepEqual(h.errors,[]);assert.equal(h.posts.length,0);assert.equal(h.pixelRequests.length,0);
  }finally{await h.close();}
});

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

test('output switching requires reread while existing full-result and lighting candidates keep their own apply action',async()=>{
  const h=await panelHarness();try{
    await open(h);assert.equal(h.el('relight-output').value,'lighting-layers');h.el('relight-output').value='full-result';h.change('relight-output');assert.equal(h.el('relight-generate').disabled,true);
    h.click('relight-reread');await new Promise(r=>setTimeout(r,45));assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.session.freeze().outputKind,'full-result');
    const candidates:RelightResult[]=[
      {jobId:'legacy-job',fingerprint:h.session.fingerprint,image:h.session.sourceCapture.image},
      {jobId:'full-job',fingerprint:h.session.fingerprint,image:h.session.sourceCapture.image,outputKind:'full-result'},
      {jobId:'lighting-job',fingerprint:h.session.fingerprint,image:h.session.sourceCapture.image,outputKind:'lighting-layers',lightingState:'composite'}
    ];
    h.results.push(...candidates);h.workbench.refreshAvailability();
    for(const candidate of candidates){
      const lighting=candidate.jobId==='lighting-job',result=h.el('relight-result-list').querySelector(`[data-job-id="${candidate.jobId}"]`);result.id=candidate.jobId+'-choice';h.click(result.id);
      assert.match(result.textContent,lighting?/光影合成预览/:/整图重绘/);
      for(const choice of ['lighting-layers','full-result']){
        h.el('relight-output').value=choice;h.change('relight-output');
        assert.equal(h.el('relight-generate').disabled,true);assert.equal(h.workbench.currentResultId,candidate.jobId);
        assert.match(h.el('relight-apply').textContent,lighting?/应用光影层组/:/应用整图结果/);
        h.click('relight-apply');await new Promise(r=>setTimeout(r,45));assert.equal(h.applied[h.applied.length-1],candidate.jobId);
        assert.equal(candidate.outputKind,lighting?'lighting-layers':candidate.jobId==='full-job'?'full-result':undefined);
      }
    }
    assert.deepEqual(h.applied,['legacy-job','legacy-job','full-job','full-job','lighting-job','lighting-job']);assert.equal(h.posts.length,0);
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
