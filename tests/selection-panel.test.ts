import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';import {decodePng,encodePng} from '../src/imaging/image';

type Harness=Awaited<ReturnType<typeof panelHarness>>;
const output={width:32,height:32,rgba:new Uint8Array(32*32*4).fill(255)};
function missing(h:Harness){h.setSelection({bounds:null as any,mask:new Uint8Array(h.ps.app.activeDocument.width*h.ps.app.activeDocument.height)});}
function selected(width=80,height=64){const mask=new Uint8Array(width*height);mask[32*width+40]=255;mask[32*width+41]=128;mask[33*width+41]=64;mask[33*width+42]=255;return {bounds:{left:40,top:32,right:43,bottom:34},mask};}
function source(){return {width:80,height:64,rgba:new Uint8Array(80*64*4).fill(255)};}
function restoreButton(h:Harness){assert.ok(h.el('restore-selection'),'main panel must offer explicit restoration');return h.el('restore-selection');}

test('ordinary edit undo with no selection needs explicit restoration, then captures current pixels/ICC/history and deducts protection once',async()=>{
  const image=source(),selection=selected(),h=await panelHarness({source:image,selection,output});try{
    await h.wait();const p=new Uint8Array(80*64);p[32*80+41]=128;h.setSelection({bounds:{left:41,top:32,right:42,bottom:33},mask:p});h.click('protect');await h.wait();h.setSelection(selection);
    h.el('resolution').value='32';h.click('generate');await h.wait();h.click('apply');await h.wait();assert.equal(h.posts.length,1);
    h.ps.app.activeDocument.activeHistoryState={id:1};h.ps.app.activeDocument.layers=h.ps.app.activeDocument.layers.filter((l:any)=>l.id===2);missing(h);
    h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.pixelRequests.length,1);assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'selection-required');assert.match(h.el('diagnostic-summary').textContent,/恢复上次选区|重新圈选/);assert.equal(restoreButton(h).disabled,false);
    for(let i=0;i<image.rgba.length;i+=4)image.rgba.set([50,60,70,255],i);h.ps.app.activeDocument.colorProfileName='Adobe RGB (1998)';h.ps.app.activeDocument.activeHistoryState={id:7};
    h.click('restore-selection');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.pixelRequests.length,2);assert.equal(h.selectionWrites.length,1);assert.deepEqual({...h.selectionWrites[0].targetBounds},{left:8,top:0});assert.deepEqual([...h.selectionState().mask],[...selection.mask]);assert.equal(h.el('selection-previews').style.display,'flex');assert.equal(h.el('apply').disabled,true);
    const freshPreview=decodePng(new Uint8Array(Buffer.from(h.el('source-preview').src.split(',')[1],'base64')));assert.deepEqual([...freshPreview.rgba.slice(0,4)],[50,60,70,255]);
    h.click('generate');await h.wait();assert.equal(h.posts.length,2);const record=h.records().find(r=>r.id===h.posts[1].prompt_id)!,s=record.snapshot as any;assert.equal(s.profile,'Adobe RGB (1998)');assert.equal(s.historyId,8);
    const uploaded=h.uploads.filter(u=>u.name.endsWith('-source.png')).slice(-1)[0];assert.deepEqual([...uploaded.image.rgba.slice(0,4)],[50,60,70,255]);const mask=h.files[`${record.id}-mask.bin`] as Uint8Array;assert.equal(mask[32*67+33],64);
  }finally{await h.close();}
});

test('range cache survives failed capture and parameter changes, is replaced only by success, and is unavailable in other modes or sessions',async()=>{
  const h=await panelHarness({source:source(),selection:selected(),output});try{
    await h.wait();assert.equal(restoreButton(h).disabled,true);h.click('capture');await h.wait();h.el('margin').value='0';h.change('margin');missing(h);h.click('capture');await h.wait();assert.equal(restoreButton(h).disabled,false);
    h.el('mode').value='remove';h.change('mode');assert.equal(restoreButton(h).disabled,true);h.el('mode').value='edit';h.change('mode');assert.equal(restoreButton(h).disabled,false);h.click('restore-selection');await h.wait();assert.deepEqual([...h.selectionState().mask],[...selected().mask]);
    const next=selected();next.mask.fill(0);next.mask[10*80+11]=128;next.bounds={left:11,top:10,right:12,bottom:11};h.setSelection(next);h.click('capture');await h.wait();missing(h);h.click('restore-selection');await h.wait();assert.deepEqual([...h.selectionState().mask],[...next.mask]);
    const another=await panelHarness({history:h.records()});try{await another.wait();assert.equal(restoreButton(another).disabled,true);}finally{await another.close();}
  }finally{await h.close();}
});

test('an asynchronous preview keeps its original workspace/mode binding after the user switches workspaces',async()=>{
  const h=await panelHarness();let release=()=>{};try{
    await h.wait();const getPixels=h.ps.imaging.getPixels,gate=new Promise<void>(r=>{release=r;});let entered=()=>{};const reading=new Promise<void>(r=>{entered=r;});
    h.ps.imaging.getPixels=async(o:any)=>{entered();await gate;return getPixels(o);};h.click('capture');await reading;
    h.click('tab-cosplay');h.el('mode').value='costume';h.change('mode');release();await new Promise(r=>setTimeout(r,40));
    assert.equal(restoreButton(h).disabled,true);h.click('tab-local');assert.equal(restoreButton(h).disabled,false);missing(h);h.click('restore-selection');await h.wait();assert.equal(h.selectionWrites.length,1);
  }finally{release();await h.close();}
});

test('saved selections belong to the tagged working copy rather than its untagged original',async()=>{
  const h=await panelHarness({untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)})}});try{
    await h.wait();h.click('capture');await h.wait();assert.equal(h.ps.app.activeDocument.id,22);missing(h);restoreButton(h);h.click('restore-selection');await h.wait();assert.equal(h.selectionWrites[0].documentID,22);assert.equal(h.pixelRequests.slice(-1)[0].documentID,22);assert.equal(h.ps.app.documents.find((d:any)=>d.id===11).colorProfileName,'');assert.equal(h.sourceAccessEvents.filter(e=>e==='picker').length,1);
  }finally{await h.close();}
});

test('background/scene restore raw subject coverage and blend keeps full context without widening the editable mask',async()=>{
  for(const mode of ['background','scene','blend']){
    const h=await panelHarness({source:source(),selection:selected(),output});try{
      await h.wait();if(mode!=='background')h.click('tab-cosplay');h.el('mode').value=mode;h.change('mode');h.el('resolution').value='32';h.click('capture');await h.wait();missing(h);restoreButton(h);h.click('restore-selection');await h.wait();assert.deepEqual([...h.selectionState().mask],[...selected().mask]);assert.deepEqual({...h.pixelRequests.slice(-1)[0].sourceBounds},{left:0,top:0,right:80,bottom:64});assert.equal(h.posts.length,0);
      h.click('generate');await h.wait();const record=h.records()[0],mask=h.files[`${record.id}-mask.bin`] as Uint8Array;
      if(mode==='blend'){assert.equal(mask[0],0);assert.equal(mask[32*80+41],128);}else{assert.deepEqual([...(h.files[`${record.id}-subject-mask.bin`] as Uint8Array)],[...selected().mask]);assert.equal(mask[0],255);assert.equal(mask[32*80+41],127);}
    }finally{await h.close();}
  }
});

test('restoring clears stale source pixels when reread fails and still permits a later verified reread',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.click('capture');await h.wait();missing(h);h.ps.app.activeDocument.colorProfileName='';restoreButton(h);h.click('restore-selection');await h.wait();assert.equal(h.selectionWrites.length,1);assert.equal(h.pixelRequests.length,1);assert.equal(h.el('selection-previews').style.display,'none');assert.match(h.el('status').textContent,/选区已恢复.*读取/);assert.equal(h.posts.length,0);
    h.click('generate');await h.wait();assert.equal(h.posts.length,0);h.ps.app.activeDocument.colorProfileName='sRGB IEC61966-2.1';h.click('restore-selection');await h.wait();assert.equal(h.pixelRequests.length,2);assert.equal(h.el('selection-previews').style.display,'flex');
  }finally{await h.close();}
});

test('source switching after selection restoration cannot redirect the following capture',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.click('capture');await h.wait();missing(h);const put=h.ps.imaging.putSelection;h.ps.imaging.putSelection=async(o:any)=>{await put(o);h.switchDocument(22);};restoreButton(h);h.click('restore-selection');await h.wait();assert.equal(h.selectionWrites[0].documentID,11);assert.equal(h.pixelRequests.length,1);assert.equal(h.el('selection-previews').style.display,'none');assert.match(h.el('status').textContent,/选区已恢复.*活动文档/);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('settings and copyable diagnostic details identify the injected build while unbuilt harnesses are explicit',async()=>{
  const buildId='PS-AI 0.5.0 · 01234567-dirty',h=await panelHarness({buildId});try{
    await h.wait();assert.equal(h.el('build-id')?.textContent,buildId);missing(h);h.click('capture');await h.wait();assert.equal(JSON.parse(h.el('diagnostic-details').value).build,buildId);
    h.el('language').value='en-US';h.change('language');await h.wait();assert.equal(h.el('build-id').textContent,buildId);assert.match(restoreButton(h).textContent,/Restore.*selection/);h.click('capture');await h.wait();assert.doesNotMatch(h.el('diagnostic-summary').textContent,/[一-龥]/);
  }finally{await h.close();}
  const dev=await panelHarness();try{await dev.wait();assert.match(dev.el('build-id')?.textContent??'',/dev|unbuilt/);}finally{await dev.close();}
});
