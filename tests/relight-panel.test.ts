import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {decodePng,encodePng,convertDepth,resize} from '../src/imaging/image';
import {defaultSettings} from '../src/infrastructure/config/profile';
import fs from 'node:fs/promises';
import {sceneFingerprint} from '../src/features/relight/relight-scene';

async function open(h:Awaited<ReturnType<typeof panelHarness>>){await h.wait();h.click('nav-create');h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');await new Promise(r=>setTimeout(r,80));}
async function useFullResult(h:Awaited<ReturnType<typeof panelHarness>>){h.el('relight-output').value='full-result';h.change('relight-output');h.click('relight-reread');await new Promise(r=>setTimeout(r,80));assert.equal(h.el('relight-output').value,'full-result');assert.equal(h.el('relight-generate').disabled,false);}
async function draft(h:Awaited<ReturnType<typeof panelHarness>>){h.click('relight-save');await new Promise(r=>setTimeout(r,15));return JSON.parse(String(h.files['relight-draft.json'])).scene;}

test('explicit reopen reads the current merged composite even when its layer keeps an applied result ID',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='2.8';h.change('relight-intensity');h.click('relight-generate');await h.wait();
    const job=h.records()[0],frozen=JSON.stringify(job.relight);h.click('relight-apply');await new Promise(r=>setTimeout(r,70));
    const merged=h.appliedLayers[0].layer;merged.visible=true;merged.opacity=100;h.ps.app.activeDocument.layers=[merged];h.ps.app.activeDocument.activeHistoryState={id:90};
    const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const result=await read(o);const get=result.imageData.getData;result.imageData.getData=async()=>{const pixels=(await get()).slice();pixels[0]=37;return pixels;};return result;};
    const before=await draft(h);h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.click('open-relight');await new Promise(r=>setTimeout(r,90));
    const after=await draft(h);assert.equal(after.source.historyId,90);assert.notEqual(after.source.snapshotId,before.source.snapshotId);assert.deepEqual(after.source.layerIds,[merged.id]);
    assert.equal(merged.opacity,100);assert.equal(merged.visible,true);assert.equal(h.ps.app.activeDocument.layers.length,1);assert.equal(after.lights[0].intensity,2.8);assert.equal(h.el('relight-generate').disabled,false);
    h.click('relight-tab-original');assert.equal(decodePng(Uint8Array.from(Buffer.from(h.el('relight-image').getAttribute('src').split(',')[1],'base64'))).rgba[0],37);
    assert.equal(h.el('relight-apply').disabled,true);assert.equal(h.el('relight-result-list').querySelectorAll('button').length,1);assert.equal(JSON.stringify(job.relight),frozen);
    const result=h.el('relight-result-list').querySelector('button');result.id='old-merged-result';h.click(result.id);assert.match(h.el('relight-apply').textContent,/检查来源/);assert.equal(h.el('relight-export').disabled,false);
    const applied=h.appliedLayers.length;h.click('relight-apply');await new Promise(r=>setTimeout(r,50));assert.equal(h.appliedLayers.length,applied);assert.equal(h.posts.length,1);
    assert.equal(h.el('relight-rebind-current'),null);assert.equal(h.el('relight-exclude-results'),null);
  }finally{await h.close();}
});

test('explicit reread follows the active document and reopening replaces a closed old source while retaining lights',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='3.4';h.change('relight-intensity');const old=await draft(h);
    h.switchDocument(22);h.click('relight-reread');await new Promise(r=>setTimeout(r,80));assert.equal((await draft(h)).source.documentId,22);assert.equal(h.ps.app.activeDocument.id,22);
    h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.setDocument(33);h.click('open-relight');await new Promise(r=>setTimeout(r,80));const next=await draft(h);
    assert.equal(next.source.documentId,33);assert.notEqual(next.source.snapshotId,old.source.snapshotId);assert.equal(next.lights[0].intensity,3.4);assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('more than one hundred unchanged explicit opens still read pixels without exhausting source identities',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='2.6';h.change('relight-intensity');const initial=await draft(h),reads=h.pixelRequests.length;
    for(let i=0;i<105;i++){
      h.click('relight-close');await new Promise(r=>setTimeout(r,5));h.click('open-relight');await new Promise(r=>setTimeout(r,5));
      assert.equal(h.el('relight-dialog').hasAttribute('open'),true,'open '+i);assert.equal(h.el('relight-generate').disabled,false,'generation remains available after open '+i);
    }
    const final=await draft(h);assert.equal(final.source.snapshotId,initial.source.snapshotId);assert.equal(final.lights[0].intensity,2.6);assert.equal(h.pixelRequests.length,reads+105);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('relight missing-selection guidance appears before file authorization and points at the explicit whole-image choice',async()=>{
  const h=await panelHarness({untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)})}});try{
    await h.wait();h.click('nav-create');h.setSelection({bounds:null as any,mask:new Uint8Array(4)});h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');
    assert.equal(h.el('relight-scope')?.value,'selection');h.click('open-relight');await h.wait();
    assert.equal(h.sourceAccessEvents.length,0);assert.equal(h.el('diagnostic-box').style.display,'block');assert.match(h.el('diagnostic-title').textContent,/选区/);assert.match(h.el('diagnostic-action').textContent,/整张图像/);assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'selection-required');
    assert.equal(h.uploads.length,0);assert.equal(h.ps.app.documents.length,1);
  }finally{await h.close();}
});

test('whole-image relight freezes opaque native16 and protection without reading a Photoshop selection',async()=>{
  const source={width:2,height:2,rgba:new Uint16Array([12345,23456,34567,65535,21000,31000,41000,65535,1000,3000,5000,65535,60000,50000,40000,65535])};
  const h=await panelHarness({source});try{
    await h.wait();h.ps.app.activeDocument.name='Lighting source';h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([0,128,0,0])});h.click('protect');await h.wait();const reads=h.captured.length;
    h.setSelection({bounds:null as any,mask:new Uint8Array(4)});h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');assert.ok(h.el('relight-scope'));
    h.el('relight-scope').value='document';h.change('relight-scope');h.el('resolution').value='32';h.click('open-relight');await new Promise(r=>setTimeout(r,80));
    assert.ok(h.el('relight-dialog').hasAttribute('open'));assert.match(h.el('relight-source').textContent,/Lighting source.*整张图像/);
    h.click('relight-generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.captured.length,reads);
    const job=h.records()[0],saved=decodePng(h.files[`${job.id}-source.png`] as Uint8Array);assert.ok(saved.rgba instanceof Uint16Array);assert.equal(saved.rgba[0],12345);
    assert.deepEqual([...h.files[`${job.id}-mask.bin`] as Uint8Array],[255,127,255,255]);assert.equal(h.ps.app.activeDocument.selection.bounds,null);
    assert.equal('scope' in h.posts[0],false);assert.equal('scope' in (job.relight as any).scene,false);
  }finally{await h.close();}
});

test('reopening reads the current scope and retains edited lighting without submitting',async()=>{
  const h=await panelHarness({selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
    await open(h);h.el('relight-intensity').value='2.5';h.change('relight-intensity');const old=await draft(h);assert.match(h.el('relight-source').textContent,/当前选区/);
    h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.el('relight-scope').value='document';h.change('relight-scope');h.click('open-relight');await new Promise(r=>setTimeout(r,70));
    assert.match(h.el('relight-source').textContent,/整张图像/);assert.equal(h.el('relight-intensity').value,'2.5');assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.posts.length,0);
    const next=await draft(h);assert.notEqual(next.source.snapshotId,old.source.snapshotId);h.setSelection({bounds:null as any,mask:new Uint8Array(4)});
    h.click('relight-generate');await h.wait();assert.equal(h.posts.length,1);assert.deepEqual([...h.files[h.records()[0].id+'-mask.bin'] as Uint8Array],[255,255,255,255]);
  }finally{await h.close();}
});

test('private access controls remember an already approved original, label its working copy, and clear stored grants',async()=>{
  const h=await panelHarness({untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)})}});try{
    await open(h);assert.match(h.el('relight-source').textContent,/sRGB 工作副本.*11/);assert.equal(!!h.el('remember-source-access')?.checked,false);
    h.click('relight-close');await new Promise(r=>setTimeout(r,20));assert.ok(h.el('remember-source-access'));assert.equal(h.el('advanced-body').style.display,'none');
    h.el('remember-source-access').checked=true;h.change('remember-source-access');await new Promise(r=>setTimeout(r,30));
    const saved=JSON.parse(String(h.files['source-file-access.json']));assert.equal(saved.remember,true);assert.equal(saved.entries[0].path,'c:/mock/source.webp');assert.equal(saved.entries.length,1);
    assert.equal(h.sourceAccessEvents.filter(v=>v==='picker').length,1);assert.equal(h.sourceAccessEvents.filter(v=>v==='token').length,1);
    assert.doesNotMatch(String(h.files['settings.json']??''),/source-token|remember|source.webp/);
    h.click('forget-source-access');await new Promise(r=>setTimeout(r,30));assert.deepEqual(JSON.parse(String(h.files['source-file-access.json'])).entries,[]);assert.match(h.el('source-access-status').textContent,/已清除/);
    h.el('remember-source-access').checked=false;h.change('remember-source-access');await new Promise(r=>setTimeout(r,30));assert.equal(JSON.parse(String(h.files['source-file-access.json'])).remember,false);
  }finally{await h.close();}
});

test('unavailable token persistence keeps actionable status and translated scope/access controls without losing the scene',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),language:'en-US'},untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)}),tokenUnavailable:true}});try{
    await open(h);h.el('relight-intensity').value='2.5';h.change('relight-intensity');h.click('relight-close');await new Promise(r=>setTimeout(r,20));
    h.el('remember-source-access').checked=true;h.change('remember-source-access');await new Promise(r=>setTimeout(r,30));
    assert.match(h.el('source-access-status').textContent,/could not be saved.*session.*continue/i);assert.doesNotMatch(h.el('source-access-status').textContent,/[一-龥]/);
    assert.match(h.el('remember-source-access').textContent,/Remember/);assert.equal(h.el('relight-scope').displayedCaption,'Current selection');
    h.el('relight-scope').value='document';h.change('relight-scope');h.click('open-relight');await new Promise(r=>setTimeout(r,35));assert.match(h.el('relight-source').textContent,/Document 22.*Entire image/);assert.equal(h.el('relight-intensity').value,'2.5');
    assert.doesNotMatch(h.el('relight-status').textContent,/[一-龥]/);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('a missing selection during reread retains frozen scope and edited lighting with bilingual scope guidance',async()=>{
  for(const language of ['zh-CN','en-US'] as const){
    const h=await panelHarness({settings:{...defaultSettings(),language}});try{
      await open(h);h.el('relight-intensity').value='2.5';h.change('relight-intensity');const old=await draft(h);
      h.setSelection({bounds:null as any,mask:new Uint8Array(4)});h.click('relight-reread');await new Promise(r=>setTimeout(r,75));
      assert.equal(h.el('relight-dialog').hasAttribute('open'),true);assert.equal(h.el('relight-intensity').value,'2.5');
      assert.match(h.el('relight-status').textContent,language==='en-US'?/Entire image/:/整张图像/);assert.equal((await draft(h)).source.snapshotId,old.source.snapshotId);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
    }finally{await h.close();}
  }
});

test('relight opens its workbench without submitting or exposing the ordinary prompt draft',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('prompt').value='ordinary private draft';
    h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');
    assert.equal(h.el('prompt-group').style.display,'none');
    assert.ok(h.el('open-relight'));
    h.click('generate');await new Promise(r=>setTimeout(r,80));
    assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);
    assert.ok(h.el('relight-dialog').hasAttribute('open'));
    h.click('relight-close');await h.wait();
    h.el('mode').value='costume';h.change('mode');
    assert.equal(h.el('prompt').value,'ordinary private draft');
  }finally{await h.close();}
});

test('structured relight disables alignment and color matching, then restores ordinary preferences',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('align-subject').checked=true;h.el('match-color').checked=true;
    h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');
    for(const id of ['align-subject','match-color']){assert.equal(h.el(id).checked,false);assert.equal(h.el(id).disabled,true);}
    h.el('mode').value='costume';h.change('mode');
    for(const id of ['align-subject','match-color']){assert.equal(h.el(id).checked,true);assert.equal(h.el(id).disabled,false);}
  }finally{await h.close();}
});

test('workbench edits, view changes and empty AI tab never submit a request',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.click('generate');await new Promise(r=>setTimeout(r,80));
    assert.ok(h.el('relight-add'),'workbench controls must exist');
    h.click('relight-add');h.click('relight-duplicate');h.click('relight-undo');
    h.el('relight-intensity').value='2';h.change('relight-intensity');
    h.click('relight-tab-result');assert.equal(h.el('relight-image').getAttribute('src'),null);
    assert.match(h.el('relight-empty').textContent,/AI/);
    h.click('relight-fit');h.click('relight-hide-markers');
    assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
    h.click('relight-close');await h.wait();
  }finally{await h.close();}
});

test('generation closes for recapture, reopens for network, uploads the clean source and applies the matching result once',async()=>{
  const source={width:2,height:2,rgba:new Uint16Array([12345,23456,34567,65535,21000,31000,41000,65535,1000,3000,5000,65535,60000,50000,40000,65535])};
  const h=await panelHarness({source});try{
    await open(h);await useFullResult(h);const eventStart=h.nativeEvents.length;h.el('relight-intensity').value='2';h.change('relight-intensity');h.click('relight-generate');await h.wait();
    assert.equal(h.posts.length,1);assert.equal(h.el('relight-dialog').hasAttribute('open'),true);
    assert.deepEqual(h.nativeEvents.slice(eventStart,eventStart+3),['dialog-close','native','dialog-open']);
    const job=h.records()[0],metadata=job.relight as any,saved=decodePng(h.files[job.id+'-source.png'] as Uint8Array);
    assert.ok(saved.rgba instanceof Uint16Array);assert.equal(saved.rgba[0],12345);
    const upload=h.uploads.find(u=>u.name.endsWith('-source.png'))!.image;
    assert.deepEqual([...upload.rgba],[...convertDepth(resize(source,32,32),8).rgba]);
    assert.equal(metadata.requestId,job.id);assert.equal(metadata.result.jobId,job.id);assert.equal(metadata.scene.lights[0].intensity,2);assert.equal(metadata.outputKind,'full-result');
    assert.equal(metadata.color.documentDepth,16);assert.equal(metadata.color.modelInput,'sRGB8');
    assert.equal(h.el('relight-apply').disabled,false);h.click('relight-apply');await new Promise(r=>setTimeout(r,80));
    assert.equal(h.appliedLayers.length,1);assert.match(h.appliedLayers[0].layer.name,/光影重塑.*完整结果/);
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);h.click('relight-apply');await new Promise(r=>setTimeout(r,80));
    assert.equal(h.appliedLayers.length,2);assert.equal(h.ps.app.activeDocument.layers.length,2);
    assert.ok(h.nativeEvents.every((e,i,a)=>e!=='native'||a.lastIndexOf('dialog-open',i)<a.lastIndexOf('dialog-close',i)||a.lastIndexOf('dialog-open',i)===-1));
    assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('editing during generation keeps the submitted scene frozen and marks the returned actual result stale',async()=>{
  const h=await panelHarness();try{
    await open(h);h.setJobStatus('running');h.click('relight-generate');await new Promise(r=>setTimeout(r,100));
    assert.equal(h.posts.length,1);assert.equal(h.el('relight-intensity-slider').disabled,false);
    h.el('relight-intensity-slider').value='2.35';h.event('relight-intensity-slider','input');
    h.el('relight-intensity-slider').value='3';h.event('relight-intensity-slider','input');h.change('relight-intensity-slider');assert.equal(h.el('relight-intensity').value,'3');
    assert.equal((h.records()[0].relight as any).scene.lights[0].intensity,1);
    h.setJobStatus('ready');await h.wait();assert.match(h.el('relight-stale').textContent,/已修改/);
    assert.equal(h.el('relight-apply').disabled,false);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('a changed gray selection refuses submission and retains the edited scene after reopening',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='2.5';h.change('relight-intensity');
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,254,255,255])});
    h.click('relight-generate');await new Promise(r=>setTimeout(r,100));
    assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.el('relight-dialog').hasAttribute('open'),true);
    assert.equal(h.el('relight-intensity').value,'2.5');assert.match(h.el('relight-status').textContent,/重新读取/);
  }finally{await h.close();}
});

test('no-seed gateways retain semantic scene metadata without inventing a seed or request fields',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),backend:'gateway',gatewayModel:'gemini-2.5-flash-image',baseUrl:'http://localhost:8190'},gateway:{provider:'gemini'}});try{
    await open(h);h.el('resolution').value='512';h.click('relight-generate');await h.wait();
    assert.equal(h.gatewayPosts.length,1);const job=h.records()[0],metadata=job.relight as any,request=h.gatewayPosts[0].request;
    assert.equal(metadata.capabilities.seedSupport,false);assert.equal(metadata.seed,undefined);assert.equal(request.seed,0);
    assert.doesNotMatch(request.prompt,/<image\d>|Structured relighting/);assert.match(request.prompt,/key light/i);
    assert.equal(request.scene,undefined);assert.equal(request.lights,undefined);assert.equal(metadata.geometry.providerCanvas,'provider-owned-content-relative');
  }finally{await h.close();}
});

test('light actions share one scene, cap at eight and keep marker visibility out of intent',async()=>{
  const h=await panelHarness();try{
    await open(h);const first=await draft(h);h.click('relight-duplicate');let scene=await draft(h);
    assert.equal(scene.lights.length,2);assert.notEqual(scene.lights[0].id,scene.lights[1].id);
    h.el('relight-name').value='Cold fill';h.change('relight-name');h.el('relight-role').value='fill';h.change('relight-role');h.el('relight-enabled').checked=false;h.change('relight-enabled');
    scene=await draft(h);assert.equal(scene.lights[1].name,'Cold fill');assert.equal(scene.lights[1].enabled,false);
    h.click('relight-hide-markers');assert.deepEqual(await draft(h),scene);
    h.click('relight-delete');scene=await draft(h);assert.equal(scene.lights.length,1);assert.equal(scene.lights[0].id,first.lights[0].id);
    for(let i=0;i<7;i++)h.click('relight-add');scene=await draft(h);assert.equal(scene.lights.length,8);assert.equal(h.el('relight-add').disabled,true);assert.equal(h.el('relight-duplicate').disabled,true);
    assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('one drag is one undo, locked position rejects movement, and text keys keep normal editing',async()=>{
  const h=await panelHarness();try{
    await open(h);const first=await draft(h);const marker=h.el('relight-markers').querySelector('[data-kind="light"]');marker.id='test-light';
    h.event('test-light','pointerdown',{button:0,pointerId:1,clientX:280,clientY:240});
    h.event('relight-viewport','pointermove',{pointerId:1,clientX:400,clientY:310});h.event('relight-viewport','pointermove',{pointerId:1,clientX:450,clientY:330});h.event('relight-viewport','pointerup',{pointerId:1});
    assert.notEqual((await draft(h)).lights[0].x,first.lights[0].x);h.click('relight-undo');assert.deepEqual(await draft(h),first);h.click('relight-redo');
    h.el('relight-locked').checked=true;h.change('relight-locked');const locked=await draft(h);h.event('test-light','pointerdown',{button:0,pointerId:2,clientX:450,clientY:330});h.event('relight-viewport','pointermove',{pointerId:2,clientX:200,clientY:220});h.event('relight-viewport','pointerup',{pointerId:2});assert.deepEqual(await draft(h),locked);
    const key=h.event('relight-name','keydown',{key:'Delete'});assert.equal(key.defaultPrevented,false);assert.equal((await draft(h)).lights.length,1);
    h.event('relight-viewport','keydown',{key:'Delete'});assert.equal((await draft(h)).lights.length,0);h.event('relight-viewport','keydown',{key:'z',ctrlKey:true});assert.equal((await draft(h)).lights.length,1);
  }finally{await h.close();}
});

test('directional markers edit direction and spot target handles edit targets, while pan and zoom preserve scene',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-type').value='directional';h.change('relight-type');assert.equal(h.el('relight-position').style.display,'none');assert.equal(h.el('relight-direction-fields').style.display,'block');
    const before=await draft(h),marker=h.el('relight-markers').querySelector('[data-kind="light"]');marker.id='test-directional';h.event('test-directional','pointerdown',{button:0,pointerId:1,clientX:400,clientY:300});h.event('relight-viewport','pointermove',{pointerId:1,clientX:200,clientY:325});h.event('relight-viewport','pointerup',{pointerId:1});
    let scene=await draft(h);assert.equal(scene.lights[0].x,before.lights[0].x);assert.notEqual(scene.lights[0].direction,before.lights[0].direction);
    h.el('relight-type').value='spot';h.change('relight-type');const target=h.el('relight-markers').querySelector('[data-kind="target"]');target.id='test-target';h.event('test-target','pointerdown',{button:0,pointerId:2,clientX:360,clientY:325});h.event('relight-viewport','pointermove',{pointerId:2,clientX:430,clientY:250});h.event('relight-viewport','pointerup',{pointerId:2});
    scene=await draft(h);assert.notEqual(scene.lights[0].targetX,.5);assert.equal(scene.lights[0].x,.25);
    h.click('relight-pan');h.event('relight-viewport','pointerdown',{button:0,clientX:200,clientY:200});h.event('relight-viewport','pointermove',{clientX:250,clientY:230});h.event('relight-viewport','pointerup');h.click('relight-zoom-in');h.event('relight-dialog','resize');h.click('relight-fit');assert.deepEqual(await draft(h),scene);
  }finally{await h.close();}
});

test('drag handles are focusable DOM nodes that retain capture across type changes and repeated gestures',async()=>{
  const h=await panelHarness();try{
    await open(h);const container=h.el('relight-markers'),marker=container.querySelector('[data-kind="light"]');
    assert.equal(marker.tagName,'DIV','native UXP buttons do not reliably deliver directional pointerdown');
    assert.equal(marker.getAttribute('role'),'button');assert.equal(marker.getAttribute('tabindex'),'0');assert.ok(marker.getAttribute('aria-label'));
    marker.id='stable-dom-light';let reparented=0;const append=container.appendChild.bind(container),insert=container.insertBefore.bind(container);
    container.appendChild=(node:any)=>{if(node===marker)reparented++;return append(node);};container.insertBefore=(node:any,before:any)=>{if(node===marker)reparented++;return insert(node,before);};
    h.el('relight-type').value='directional';h.change('relight-type');const initial=await draft(h);
    for(const [pointerId,x,y]of [[21,450,330],[22,220,240]]){
      const before=await draft(h);h.event('stable-dom-light','pointerdown',{button:0,pointerId,clientX:400,clientY:300});
      assert.equal(marker.capturedPointer,pointerId);h.event('relight-viewport','pointermove',{pointerId,clientX:x,clientY:y});
      assert.equal(container.querySelector('[data-kind="light"]'),marker);assert.equal(marker.parentElement,container);assert.equal(marker.capturedPointer,pointerId);
      h.event('relight-viewport','pointerup',{pointerId});const after=await draft(h);assert.notEqual(after.lights[0].direction,before.lights[0].direction);
      h.click('relight-undo');assert.deepEqual(await draft(h),before);h.click('relight-redo');assert.deepEqual(await draft(h),after);
    }
    assert.equal(reparented,0,'refresh must not move the node that owns pointer capture');assert.equal(marker.capturedPointer,undefined);
    h.click('relight-add');assert.ok(!marker.className.includes('selected'));
    const enter=h.event('stable-dom-light','keydown',{key:'Enter'});assert.equal(enter.defaultPrevented,true);assert.ok(marker.className.includes('selected'));assert.equal(h.el('relight-name').value,initial.lights[0].name);
    h.click('relight-add');const space=h.event('stable-dom-light','keydown',{key:' '});assert.equal(space.defaultPrevented,true);assert.ok(marker.className.includes('selected'));
    assert.equal(h.event('relight-name','keydown',{key:' '}).defaultPrevented,false);
    h.el('relight-type').value='spot';h.change('relight-type');const target=container.querySelector('[data-kind="target"]');
    assert.equal(target.tagName,'DIV');assert.equal(target.getAttribute('role'),'button');assert.equal(target.getAttribute('tabindex'),'0');assert.ok(target.getAttribute('aria-label'));assert.equal(target.textContent,'+');assert.equal(target.children.length,0);
    assert.equal(container.querySelector('[data-kind="light"]'),marker);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('guide decorations remain behind stable draggable markers',async()=>{
  const h=await panelHarness();try{
    await open(h);const container=h.el('relight-markers'),marker=container.querySelector('[data-kind="light"]');
    for(const type of ['directional','spot','point']){
      h.el('relight-type').value=type;h.change('relight-type');const children=Array.from(container.children) as any[],firstMarker=children.findIndex(n=>n.hasAttribute('data-light-id'));
      assert.ok(firstMarker>0);assert.ok(children.every((n,i)=>!n.hasAttribute('data-decoration')||i<firstMarker),'dots and range must precede every handle');assert.equal(container.querySelector('[data-kind="light"]'),marker);
    }
  }finally{await h.close();}
});

test('partial invalid numeric input retains the scene and blocks generation until corrected',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='';h.change('relight-intensity');assert.equal(h.el('relight-intensity').value,'');assert.equal((await draft(h)).lights[0].intensity,1);
    h.click('relight-generate');await new Promise(r=>setTimeout(r,20));assert.equal(h.posts.length,0);assert.match(h.el('relight-status').textContent,/修正/);
    h.el('relight-intensity').value='2';h.change('relight-intensity');assert.equal(h.el('relight-intensity').hasAttribute('aria-invalid'),false);
  }finally{await h.close();}
});

test('correcting light parameters dismisses validation status only after every invalid field is resolved',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-x').value='';h.change('relight-x');assert.match(h.el('relight-status').textContent,/参数未保存/);
    h.el('relight-ambient-intensity').value='';h.change('relight-ambient-intensity');const invalidStatus=h.el('relight-status').textContent;
    h.el('relight-x').value='.2';h.change('relight-x');assert.equal(h.el('relight-x').hasAttribute('aria-invalid'),false);assert.equal(h.el('relight-ambient-intensity').getAttribute('aria-invalid'),'true');assert.equal(h.el('relight-status').textContent,invalidStatus);
    h.el('relight-ambient-intensity').value='.4';h.change('relight-ambient-intensity');assert.equal(h.el('relight-ambient-intensity').hasAttribute('aria-invalid'),false);assert.match(h.el('relight-status').textContent,/编辑布光不会发起 AI 请求/);
    h.el('relight-x').value='';h.change('relight-x');h.click('relight-generate');assert.match(h.el('relight-status').textContent,/请先修正/);
    h.el('relight-x').value='.3';h.change('relight-x');assert.match(h.el('relight-status').textContent,/编辑布光不会发起 AI 请求/);
    const scene=await draft(h);assert.equal(scene.lights[0].x,.3);assert.equal(scene.ambient.intensity,.4);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('valid parameter edits preserve visible source, generation and application failures',async()=>{
  for(const kind of ['source','generation','application']){
    const h=await panelHarness();try{
      await open(h);await useFullResult(h);
      if(kind==='source'){h.click('relight-generate');await h.wait();assert.equal(h.records()[0].state,'ready');h.ps.app.activeDocument.activeHistoryState={id:9};h.ps.imaging.getPixels=async()=>{throw Error('source read failed');};h.click('relight-reread');await new Promise(r=>setTimeout(r,40));assert.match(h.el('relight-status').textContent,/source read failed/);assert.equal(h.el('relight-generate').disabled,true);}
      else if(kind==='generation'){h.el('backend-url').value='http://localhost:8199';h.click('relight-generate');await h.wait();assert.match(h.el('relight-status').textContent,/后端配置已改变/);}
      else {h.click('relight-generate');await h.wait();h.ps.app.activeDocument.activeHistoryState={id:99};h.click('relight-apply');await new Promise(r=>setTimeout(r,80));assert.match(h.el('relight-status').textContent,/改变|重新捕获/);}
      const failure=h.el('relight-status').textContent;h.el('relight-intensity').value='2';h.change('relight-intensity');assert.equal(h.el('relight-status').textContent,failure,kind+' error must remain actionable after editing');
    }finally{await h.close();}
  }
});

test('supplement conflicts require explicit acknowledgement before upload and preserve the exact supplement',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-supplement').value='  no shadows\nkeep logo  ';h.change('relight-supplement');h.click('relight-generate');await h.wait();
    assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.notEqual(h.el('relight-acknowledge').style.display,'none');
    h.el('relight-acknowledge').checked=true;h.change('relight-acknowledge');h.click('relight-generate');await h.wait();
    assert.equal(h.posts.length,1);assert.equal(h.records()[0].userPrompt,'  no shadows\nkeep logo  ');assert.match(h.posts[0].prompt['4'].inputs.prompt,/  no shadows\nkeep logo  /);assert.match(h.posts[0].prompt['4'].inputs.prompt,/Where additional instructions conflict, follow the structured lighting/);assert.equal((h.records()[0].relight as any).conflictResolution,'structured-lighting');
  }finally{await h.close();}
});

test('cancelled or user-closed requests keep history without selecting the late completion as a new success',async()=>{
  for(const action of ['relight-cancel','relight-close']){
    const h=await panelHarness();try{
      await open(h);h.setJobStatus('running');h.click('relight-generate');await new Promise(r=>setTimeout(r,100));assert.equal(h.posts.length,1);
      h.click(action);h.setJobStatus('ready');await h.wait();assert.equal(h.records()[0].state,'ready');
      if(action==='relight-close'){assert.equal(h.el('relight-image').getAttribute('src'),null);h.click('open-relight');await new Promise(r=>setTimeout(r,50));}
      h.click('relight-tab-result');assert.equal(h.el('relight-image').getAttribute('src'),null);assert.equal(h.el('relight-apply').disabled,true);
      const button=h.el('relight-result-list').querySelector('button');assert.ok(button);button.id='explicit-old-result';h.click('explicit-old-result');assert.equal(h.el('relight-apply').disabled,false);
      assert.equal(h.posts.length,1);
    }finally{await h.close();}
  }
});

test('same-session reopen rereads unchanged pixels without consuming another source identity and clears result selection',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='2.25';h.change('relight-intensity');h.click('relight-zoom-in');const original=await draft(h),reads=h.pixelRequests.length;
    h.click('relight-close');await new Promise(r=>setTimeout(r,25));assert.equal(h.el('relight-image').getAttribute('src'),null);
    h.click('open-relight');await new Promise(r=>setTimeout(r,40));assert.ok(h.pixelRequests.length>reads);assert.equal(h.el('relight-zoom-label').textContent,'125%');assert.deepEqual(await draft(h),original);
    h.click('relight-generate');await h.wait();assert.equal(h.el('relight-apply').disabled,false);
    h.click('relight-reread');await new Promise(r=>setTimeout(r,60));const rebound=await draft(h);assert.equal(rebound.source.snapshotId,original.source.snapshotId);assert.equal(rebound.lights[0].intensity,2.25);assert.equal(h.el('relight-apply').disabled,true);h.click('relight-tab-result');assert.equal(h.el('relight-image').getAttribute('src'),null);
  }finally{await h.close();}
});

test('saved source mismatch requires explicit reuse and no saved scene can contain unknown private metadata',async()=>{
  const h=await panelHarness();try{
    await open(h);const scene=await draft(h);scene.source.historyId++;scene.lights[0].intensity=3;h.files['relight-draft.json']=JSON.stringify({schemaVersion:1,scene});
    h.click('relight-load-draft');await new Promise(r=>setTimeout(r,25));assert.equal(h.el('relight-intensity').value,'1');assert.notEqual(h.el('relight-reuse-draft').style.display,'none');
    h.click('relight-reuse-draft');assert.equal(h.el('relight-intensity').value,'3');assert.equal((await draft(h)).source.historyId,1);
    const invalid=await draft(h);invalid.apiKey='private';h.files['relight-draft.json']=JSON.stringify({schemaVersion:1,scene:invalid});h.click('relight-load-draft');await new Promise(r=>setTimeout(r,20));assert.equal(h.el('relight-intensity').value,'3');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('language changes preserve scene and compiler text, including the ordinary hidden prompt draft',async()=>{
  const h=await panelHarness({uxpSelect:true});try{
    await h.wait();h.el('prompt').value='ordinary draft';await open(h);h.el('relight-supplement').value='  keep engraving  ';h.change('relight-supplement');const before=await draft(h);h.click('relight-close');await new Promise(r=>setTimeout(r,20));
    h.el('language').value='en-US';h.change('language');await h.wait();h.click('open-relight');await new Promise(r=>setTimeout(r,40));assert.equal(h.el('relight-add').textContent,'Add light');assert.equal(h.el('relight-type').displayedCaption,'Point light');assert.deepEqual(await draft(h),before);
    h.click('relight-generate');await h.wait();const metadata=h.records()[0].relight as any;assert.deepEqual(metadata.scene,before);assert.equal(h.records()[0].userPrompt,'  keep engraving  ');
    h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.el('mode').value='costume';h.change('mode');assert.equal(h.el('prompt').value,'ordinary draft');
  }finally{await h.close();}
});

test('legacy relight history stays exportable and reusable only by an explicit fresh-scene action',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('resolution').value='32';h.el('prompt').value='old lighting description';h.click('generate');await h.wait();const records=h.records(),job=records[0];(job.params as any).workspace='cosplay';(job.params as any).mode='relight';h.files['history.json']=JSON.stringify(records);
    h.el('prompt').value='ordinary draft to retain';h.selectHistory(job.id);h.click('repeat-history');await h.wait();assert.equal(h.el('relight-dialog').hasAttribute('open'),false);assert.notEqual(h.el('relight-reuse-history').style.display,'none');assert.equal(h.posts.length,1);
    h.click('load-history');await h.wait();h.click('export');await h.wait();assert.ok(h.files['ps-ai-'+job.id.slice(0,8)+'.png']);
    h.click('relight-reuse-history');await new Promise(r=>setTimeout(r,60));assert.equal(h.el('relight-supplement').value,'old lighting description');assert.equal(h.posts.length,1);h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.el('mode').value='costume';h.change('mode');assert.equal(h.el('prompt').value,'ordinary draft to retain');
  }finally{await h.close();}
});

test('unsupported dialog and fully transparent source fail before uploads with actionable errors',async()=>{
  for(const options of [{dialogUnsupported:true},{source:{width:2,height:2,rgba:new Uint8Array(16)}}]){
    const h=await panelHarness(options);try{await open(h);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.match(h.el('status').textContent,/宿主|可见像素/);}finally{await h.close();}
  }
});

test('source document switching never redirects capture or either supported output choice',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.switchDocument(22);h.click('relight-generate');await h.wait();assert.equal((h.records()[0].snapshot as any).documentId,11);assert.equal(h.ps.app.activeDocument.id,22);
    assert.deepEqual(Array.from(h.el('relight-output').querySelectorAll('option'),(option:any)=>option.value),['lighting-layers','full-result']);assert.equal(h.el('relight-compensation'),null);assert.equal(h.el('relight-compensation-info'),null);
    h.click('relight-apply');await new Promise(r=>setTimeout(r,50));assert.equal(h.appliedLayers[0].documentId,11);assert.equal(h.ps.app.activeDocument.id,22);
    const before=h.appliedLayers.length;h.ps.app.documents.find((d:any)=>d.id===11).activeHistoryState={id:99};h.click('relight-apply');await new Promise(r=>setTimeout(r,50));assert.equal(h.appliedLayers.length,before);assert.match(h.el('relight-status').textContent,/改变|重新捕获/);
    assert.equal(h.el('relight-export').disabled,false);
  }finally{await h.close();}
});

test('reopening an ungenerated same-source edit refreshes pixels and history while preserving the lighting design',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='2.6';h.change('relight-intensity');const before=await draft(h),reads=h.pixelRequests.length;h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.ps.app.activeDocument.activeHistoryState={id:9};h.click('open-relight');await new Promise(r=>setTimeout(r,80));
    const after=await draft(h);assert.equal(h.el('relight-generate').disabled,false);assert.notEqual(after.source.snapshotId,before.source.snapshotId);assert.equal(after.source.historyId,9);assert.equal(after.lights[0].intensity,2.6);assert.ok(h.pixelRequests.length>reads);assert.equal(h.el('relight-reread').disabled,false);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('running close and immediate reopen refreshes availability and retained results without selecting the late success',async()=>{
  const h=await panelHarness();try{
    await open(h);h.setJobStatus('running');h.click('relight-generate');await new Promise(r=>setTimeout(r,100));h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.click('open-relight');await new Promise(r=>setTimeout(r,30));
    assert.equal(h.el('relight-generate').disabled,true);h.setJobStatus('ready');await new Promise(r=>setTimeout(r,2200));
    assert.equal(h.records()[0].state,'ready');assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.el('relight-cancel').disabled,true);assert.equal(h.el('relight-result-list').querySelectorAll('button').length,1);
    h.click('relight-tab-result');assert.equal(h.el('relight-image').getAttribute('src'),null);assert.equal(h.el('relight-apply').disabled,true);
    const result=h.el('relight-result-list').querySelector('button');result.id='retained-result';h.click('retained-result');assert.equal(h.el('relight-apply').disabled,false);
  }finally{await h.close();}
});

test('global recovery busy disables workbench submission and application without reporting an unwritten success',async()=>{
  const h=await panelHarness();try{
    await open(h);h.click('relight-generate');await h.wait();h.click('relight-close');await new Promise(r=>setTimeout(r,20));
    h.holdHistory();h.click('recover');await new Promise(r=>setTimeout(r,20));h.click('open-relight');await new Promise(r=>setTimeout(r,30));
    assert.equal(h.el('generate').disabled,true);assert.equal(h.el('relight-generate').disabled,true);assert.equal(h.el('relight-apply').disabled,true);
    h.click('relight-apply');h.click('relight-generate');await new Promise(r=>setTimeout(r,30));assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,1);assert.doesNotMatch(h.el('relight-status').textContent,/完整结果已应用/);
    h.releaseHistory();await h.wait();assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.el('relight-apply').disabled,false);
  }finally{h.releaseHistory();await h.close();}
});

test('synchronous and asynchronous native dialog opening failures reach the visible main panel with an action',async()=>{
  for(const rejected of [false,true]){
    const h=await panelHarness();try{
      await h.wait();h.click('nav-create');h.el('relight-dialog').uxpShowModal=()=>{if(rejected)return Promise.reject(Error('native open failed'));throw Error('native open failed');};
      h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.click('open-relight');await new Promise(r=>setTimeout(r,60));
      assert.equal(h.el('relight-dialog').hasAttribute('open'),false);assert.equal(h.el('view-create').style.display,'block');assert.match(h.el('diagnostic-summary').textContent,/打开失败.*重新加载/);assert.ok(h.el('diagnostic-title').textContent);assert.ok(h.el('diagnostic-action').textContent);assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(JSON.parse(h.el('diagnostic-details').value).page,'create');assert.equal(h.posts.length,0);
    }finally{await h.close();}
  }
});

test('inactive or discarded light input errors do not block a valid directional or ambient-only scene',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-range').value='';h.change('relight-range');assert.equal(h.el('relight-range').getAttribute('aria-invalid'),'true');
    h.el('relight-type').value='directional';h.change('relight-type');assert.equal(h.el('relight-range-field').style.display,'none');assert.equal(h.el('relight-range').hasAttribute('aria-invalid'),false);
    h.click('relight-generate');await h.wait();assert.equal(h.posts.length,1);
    h.el('relight-name').value='';h.change('relight-name');h.click('relight-add');assert.equal(h.el('relight-name').hasAttribute('aria-invalid'),false);assert.ok(h.el('relight-name').value);
    h.el('relight-name').value='';h.change('relight-name');h.click('relight-delete');h.el('relight-name').value='';h.change('relight-name');h.click('relight-delete');assert.equal((await draft(h)).lights.length,0);
    h.click('relight-generate');await h.wait();assert.equal(h.posts.length,2);assert.equal((h.records()[0].relight as any).scene.lights.length,0);
  }finally{await h.close();}
});

test('spot and directional guides use bounded diagonal DOM points and a visible target cross',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-type').value='spot';h.change('relight-type');
    const points=Array.from(h.el('relight-markers').querySelectorAll('.relight-line-dot')) as any[];
    assert.ok(points.length>1&&points.length<=96);assert.notEqual(points[0].style.left,points[points.length-1].style.left);assert.notEqual(points[0].style.top,points[points.length-1].style.top);assert.ok(points.every(n=>!n.style.transform));
    const target=h.el('relight-markers').querySelector('[data-kind="target"]');assert.equal(target.textContent,'+');assert.equal(target.children.length,0);assert.ok(target.getAttribute('aria-label'));
    h.el('relight-type').value='directional';h.change('relight-type');assert.ok(h.el('relight-markers').querySelectorAll('.relight-line-dot').length>1);
  }finally{await h.close();}
});

test('discarding light errors preserves a visible global error until that field is corrected',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-ambient-intensity').value='';h.change('relight-ambient-intensity');h.el('relight-range').value='';h.change('relight-range');
    h.el('relight-type').value='directional';h.change('relight-type');h.click('relight-add');h.click('relight-delete');h.click('relight-delete');
    assert.equal(h.el('relight-ambient-intensity').getAttribute('aria-invalid'),'true');assert.equal(h.el('relight-ambient-intensity').value,'');
    h.click('relight-generate');await new Promise(r=>setTimeout(r,20));assert.equal(h.posts.length,0);assert.match(h.el('relight-status').textContent,/修正/);
    h.el('relight-ambient-intensity').value='.2';h.change('relight-ambient-intensity');h.click('relight-generate');await h.wait();assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('native dialog sizing is not fixed by CSS and resized viewport geometry preserves lighting intent',async()=>{
  const css=await fs.readFile('plugin/style.css','utf8'),rule=css.match(/\.relight-workbench\{([^}]+)\}/)![1];
  assert.doesNotMatch(rule,/(?:^|;)(?:min-|max-)?(?:width|height):\s*\d+(?:\.\d+)?px/,'native modal size owns initial and resize bounds');
  assert.match(rule,/box-sizing:border-box/);
  const h=await panelHarness();try{
    await open(h);const before=await draft(h),fingerprint=sceneFingerprint(before),width=h.el('relight-image').style.width,marker=h.el('relight-markers').querySelector('[data-kind="light"]'),left=marker.style.left;
    h.el('relight-viewport').getBoundingClientRect=()=>({left:20,top:100,width:810,height:545,right:830,bottom:645});h.event('relight-dialog','resize');
    assert.notEqual(h.el('relight-image').style.width,width);assert.notEqual(marker.style.left,left);assert.equal(sceneFingerprint(await draft(h)),fingerprint);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('identical native resize notifications leave image source and guide DOM untouched',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-type').value='directional';h.change('relight-type');h.click('relight-tab-original');
    const image=h.el('relight-image'),point=h.el('relight-markers').querySelector('.relight-line-dot');let sourceWrites=0;
    Object.defineProperty(image,'src',{configurable:true,get:()=>image.getAttribute('src')??'',set:(value:string)=>{sourceWrites++;image.setAttribute('src',value);}});
    const fingerprint=sceneFingerprint(await draft(h));for(let i=0;i<40;i++)h.event('relight-dialog','resize');
    assert.equal(sourceWrites,0,'unchanged resize must not reload an already displayed PNG');assert.equal(h.el('relight-markers').querySelector('.relight-line-dot'),point,'unchanged bounds must not rebuild the guide');
    const width=image.style.width;h.el('relight-viewport').getBoundingClientRect=()=>({left:20,top:100,width:810,height:545,right:830,bottom:645});h.event('relight-dialog','resize');
    assert.notEqual(image.style.width,width);assert.equal(sourceWrites,0);assert.notEqual(h.el('relight-markers').querySelector('.relight-line-dot'),point);assert.equal(sceneFingerprint(await draft(h)),fingerprint);
    h.el('relight-viewport').getBoundingClientRect=()=>({left:80,top:145,width:810,height:545,right:890,bottom:690});h.event('relight-dialog','resize');assert.equal(sourceWrites,0);assert.equal(sceneFingerprint(await draft(h)),fingerprint);
    const marker=h.el('relight-markers').querySelector('[data-kind="light"]');marker.id='moved-origin-light';h.event('moved-origin-light','pointerdown',{button:0,pointerId:7,clientX:550,clientY:450});h.event('relight-viewport','pointermove',{pointerId:7,clientX:585,clientY:417.5});h.event('relight-viewport','pointerup',{pointerId:7});
    assert.ok(Math.abs((await draft(h)).lights[0].direction)<1e-9,'a moved viewport origin must update the client-to-scene transform');
  }finally{await h.close();}
});

test('image-load resize feedback settles while tab changes and fresh previews still update the displayed image',async()=>{
  const source={width:2,height:2,rgba:new Uint8Array([30,40,50,255,60,70,80,255,90,100,110,255,120,130,140,255])};
  const h=await panelHarness({source});try{
    await open(h);h.click('relight-tab-original');const image=h.el('relight-image'),original=image.getAttribute('src');let writes=0,loads=0;
    Object.defineProperty(image,'src',{configurable:true,get:()=>image.getAttribute('src')??'',set:(value:string)=>{writes++;image.setAttribute('src',value);if(loads<12)setTimeout(()=>{loads++;h.event('relight-image','load');h.event('relight-dialog','resize');},0);}});
    h.click('relight-tab-illustration');await new Promise(r=>setTimeout(r,35));assert.notEqual(image.getAttribute('src'),original);assert.equal(writes,1);assert.equal(loads,1,'a load-induced resize must not write src again');
    const illustration=image.getAttribute('src');h.click('relight-hide-markers');h.click('relight-tab-illustration');await new Promise(r=>setTimeout(r,25));assert.equal(writes,1);
    h.el('relight-intensity').value='3';h.change('relight-intensity');await new Promise(r=>setTimeout(r,160));assert.notEqual(image.getAttribute('src'),illustration);assert.equal(writes,2);
    h.click('relight-tab-original');assert.equal(image.getAttribute('src'),original);h.click('relight-tab-result');assert.equal(image.getAttribute('src'),null);
    h.click('relight-generate');await h.wait();const result=image.getAttribute('src');assert.ok(result);assert.notEqual(result,original);const afterResult=writes;
    h.click('relight-tab-result');h.event('relight-dialog','resize');await new Promise(r=>setTimeout(r,25));assert.equal(writes,afterResult);assert.equal(image.getAttribute('src'),result);
    h.click('relight-close');await new Promise(r=>setTimeout(r,20));assert.equal(image.getAttribute('src'),null);h.click('open-relight');await new Promise(r=>setTimeout(r,80));assert.notEqual(image.getAttribute('src'),result);assert.equal(h.el('relight-apply').disabled,true);h.click('relight-tab-original');assert.equal(image.getAttribute('src'),original);
  }finally{await h.close();}
});

test('diagnostic recovery explicitly reads visible applied results while retaining edited lighting',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='2.7';h.change('relight-intensity');h.click('relight-generate');await h.wait();h.click('relight-apply');await new Promise(r=>setTimeout(r,70));
    const applied=h.appliedLayers[0].layer;applied.visible=true;applied.opacity=100;h.ps.app.activeDocument.activeHistoryState={id:90};const read=h.ps.imaging.getPixels;
    h.ps.imaging.getPixels=async()=>{throw Error('source read failed');};h.click('relight-reread');await new Promise(r=>setTimeout(r,70));h.click('relight-close');await new Promise(r=>setTimeout(r,20));
    h.ps.imaging.getPixels=read;h.click('nav-create');const reads=h.pixelRequests.length;h.click('diagnostic-primary');await new Promise(r=>setTimeout(r,90));
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);assert.equal(h.el('relight-intensity').value,'2.7');assert.equal(h.el('relight-generate').disabled,false);assert.ok(h.pixelRequests.length>reads);
    assert.equal(applied.opacity,100);assert.equal(applied.visible,true);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('explicit reread includes visible applied output and uploads current pixels only on the next explicit generation',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='2.8';h.change('relight-intensity');h.click('relight-generate');await h.wait();h.click('relight-apply');await new Promise(r=>setTimeout(r,70));
    const applied=h.appliedLayers[0].layer;applied.visible=true;applied.opacity=100;h.ps.app.activeDocument.activeHistoryState={id:90};const before=await draft(h),read=h.ps.imaging.getPixels;
    h.ps.imaging.getPixels=async(o:any)=>{assert.equal(applied.opacity,100);const result=await read(o),get=result.imageData.getData;result.imageData.getData=async()=>{const values=(await get()).slice();values[0]=37;return values;};return result;};
    h.click('relight-reread');await new Promise(r=>setTimeout(r,80));const next=await draft(h);assert.equal(next.source.historyId,90);assert.notEqual(next.source.snapshotId,before.source.snapshotId);assert.equal(next.lights[0].intensity,2.8);assert.equal(applied.visible,true);assert.equal(applied.opacity,100);assert.equal(h.posts.length,1);
    const result=h.el('relight-result-list').querySelector('button');result.id='old-result';h.click('old-result');assert.match(h.el('relight-apply').textContent,/检查来源/);const count=h.appliedLayers.length;h.click('relight-apply');await new Promise(r=>setTimeout(r,40));assert.equal(h.appliedLayers.length,count);assert.equal(h.el('relight-export').disabled,false);
    h.click('relight-generate');await h.wait();assert.equal(h.posts.length,2);const sources=h.uploads.filter(u=>u.name.includes('source'));assert.equal(sources[sources.length-1]?.image.rgba[0],37);
  }finally{await h.close();}
});

test('failed explicit opens stay closed and retain lighting and candidates until a successful read',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='3.1';h.change('relight-intensity');h.click('relight-generate');await h.wait();
    const before=await draft(h),job=h.records()[0],saved=JSON.stringify(job);h.click('relight-close');await new Promise(r=>setTimeout(r,20));
    h.click('nav-create');h.setSelection({bounds:null as any,mask:new Uint8Array(4)});
    for(const button of ['open-relight','diagnostic-primary']){
      h.click(button);await new Promise(r=>setTimeout(r,100));
      assert.equal(h.el('relight-dialog').hasAttribute('open'),false,button+' must not display a stale source');
      assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'selection-required');
      assert.equal(JSON.stringify(h.records()[0]),saved);assert.equal(JSON.parse(String(h.files['relight-draft.json'])).scene.lights[0].intensity,3.1);
    }
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array(4).fill(255)});h.click('diagnostic-primary');await new Promise(r=>setTimeout(r,100));
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);assert.equal(h.el('relight-intensity').value,'3.1');assert.equal(h.el('relight-result-list').querySelectorAll('button').length,1);assert.equal(h.el('relight-apply').disabled,true);
    assert.equal((await draft(h)).source.snapshotId,before.source.snapshotId);h.click('relight-close');await new Promise(r=>setTimeout(r,20));assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.posts.length,1);assert.equal(h.uploads.length,2);
  }finally{await h.close();}
});

test('successful in-dialog reread clears the corresponding main-panel capture error',async()=>{
  const h=await panelHarness();try{
    await open(h);h.setSelection({bounds:null as any,mask:new Uint8Array(4)});h.click('relight-reread');await new Promise(r=>setTimeout(r,80));
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'selection-required');
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array(4).fill(255)});h.click('relight-reread');await new Promise(r=>setTimeout(r,80));h.click('relight-close');await new Promise(r=>setTimeout(r,20));
    assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('failed current-composite reread retains the old source and candidate without modifying layers, then explicit retry succeeds',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='3.3';h.change('relight-intensity');h.click('relight-generate');await h.wait();h.click('relight-apply');await new Promise(r=>setTimeout(r,60));
    const applied=h.appliedLayers[0].layer;applied.visible=true;applied.opacity=100;h.ps.app.activeDocument.activeHistoryState={id:50};const before=await draft(h),read=h.ps.imaging.getPixels;
    h.ps.imaging.getPixels=async()=>{assert.equal(applied.opacity,100);assert.equal(applied.visible,true);throw Error('source read failed');};h.click('relight-reread');await new Promise(r=>setTimeout(r,80));
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);assert.equal((await draft(h)).source.snapshotId,before.source.snapshotId);assert.equal(h.el('relight-intensity').value,'3.3');assert.equal(h.el('relight-generate').disabled,true);assert.equal(h.el('relight-export').disabled,false);assert.equal(h.ps.app.activeDocument.activeHistoryState.id,50);
    h.ps.imaging.getPixels=read;h.click('relight-reread');await new Promise(r=>setTimeout(r,80));assert.equal(applied.opacity,100);assert.equal(applied.visible,true);assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('reread switches active source in both directions while preserving visible outputs and lighting',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='3.4';h.change('relight-intensity');h.click('relight-generate');await h.wait();h.click('relight-apply');await new Promise(r=>setTimeout(r,60));const applied=h.appliedLayers[0].layer;applied.visible=true;applied.opacity=100;
    h.switchDocument(22);h.click('relight-reread');await new Promise(r=>setTimeout(r,60));assert.equal((await draft(h)).source.documentId,22);
    h.switchDocument(11);h.ps.app.activeDocument.activeHistoryState={id:80};h.click('relight-reread');await new Promise(r=>setTimeout(r,80));const after=await draft(h);assert.equal(after.source.documentId,11);assert.equal(after.source.historyId,80);assert.equal(applied.opacity,100);assert.equal(applied.visible,true);assert.equal(h.el('relight-intensity').value,'3.4');assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('reopening after the old source closes immediately reads the active replacement and retains lighting',async()=>{
  const h=await panelHarness();try{
    await open(h);h.el('relight-intensity').value='3.5';h.change('relight-intensity');const before=await draft(h);h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.setDocument(22);h.click('open-relight');await new Promise(r=>setTimeout(r,70));
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);const next=await draft(h);assert.equal(next.source.documentId,22);assert.notEqual(next.source.snapshotId,before.source.snapshotId);assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.el('relight-intensity').value,'3.5');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('explicit history lighting reuse reads the current composite including visible applied output without another submission',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='1.3';h.change('relight-intensity');h.click('relight-generate');await h.wait();const job=h.records()[0];h.click('relight-apply');await new Promise(r=>setTimeout(r,60));
    const applied=h.appliedLayers[0].layer;applied.visible=true;applied.opacity=100;h.el('relight-intensity').value='2.9';h.change('relight-intensity');h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.ps.app.activeDocument.activeHistoryState={id:90};h.selectHistory(job.id);h.click('repeat-history');await h.wait();
    const reads=h.pixelRequests.length;h.click('relight-reuse-history');await new Promise(r=>setTimeout(r,80));const reused=await draft(h);assert.ok(h.pixelRequests.length>reads);assert.equal(h.el('relight-dialog').hasAttribute('open'),true);assert.equal(reused.lights[0].intensity,1.3);assert.equal(reused.source.layerIds.includes(applied.id),true);assert.equal(applied.opacity,100);assert.equal(applied.visible,true);assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('a fresh relight entry reads visible generated layers immediately without a recovery prerequisite',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('resolution').value='32';h.click('generate');await h.wait();h.click('apply');await h.wait();const applied=h.appliedLayers[0].layer;applied.visible=true;applied.opacity=100;h.ps.app.activeDocument.activeHistoryState={id:80};
    h.click('nav-create');h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');const reads=h.pixelRequests.length;h.click('open-relight');await new Promise(r=>setTimeout(r,80));assert.ok(h.pixelRequests.length>reads);assert.equal(h.el('relight-dialog').hasAttribute('open'),true);const captured=await draft(h);assert.equal(captured.source.layerIds.includes(applied.id),true);assert.equal(captured.source.historyId,80);assert.equal(applied.opacity,100);assert.equal(applied.visible,true);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('an invalid historical supplement never replaces the retained session or loses exportable results',async()=>{
  const h=await panelHarness();try{
    await open(h);await useFullResult(h);h.el('relight-intensity').value='3.1';h.change('relight-intensity');h.click('relight-generate');await h.wait();const prior=await draft(h),records=h.records();delete records[0].relight;records[0].userPrompt='x'.repeat(8001);h.files['history.json']=JSON.stringify(records);
    h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.selectHistory(records[0].id);h.click('repeat-history');await h.wait();h.click('relight-reuse-history');await new Promise(r=>setTimeout(r,60));h.click('open-relight');await new Promise(r=>setTimeout(r,60));
    assert.equal((await draft(h)).source.snapshotId,prior.source.snapshotId);assert.equal(h.el('relight-intensity').value,'3.1');assert.equal(h.el('relight-result-list').querySelectorAll('button').length,1);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('translated reopening reads the active document without touching previously applied layers',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('resolution').value='32';h.click('generate');await h.wait();h.click('apply');await h.wait();const applied=h.appliedLayers[0].layer;applied.visible=true;applied.opacity=100;
    h.click('nav-create');h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.click('open-relight');await new Promise(r=>setTimeout(r,60));h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('open-relight').textContent,/Open lighting workbench/);
    h.switchDocument(22);h.click('open-relight');await new Promise(r=>setTimeout(r,70));assert.equal((await draft(h)).source.documentId,22);assert.equal(applied.visible,true);assert.equal(applied.opacity,100);assert.equal(h.el('relight-reread').textContent,'Re-read current document');assert.doesNotMatch(h.el('relight-status').textContent,/[一-龥]/);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});


test('a fresh relight open clears prior capture failures from both entry buttons only after successful binding',async()=>{
 const h=await panelHarness();try{
  await h.wait();h.click('nav-create');h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.setSelection({bounds:null as any,mask:new Uint8Array(4)});
  h.click('open-relight');await new Promise(r=>setTimeout(r,70));h.click('diagnostic-primary');await new Promise(r=>setTimeout(r,70));assert.equal(h.el('diagnostic-box').style.display,'block',JSON.stringify({errors:h.errors.map(e=>({message:e.message,code:e.code})),details:h.el('diagnostic-details').value,mode:h.el('mode').value,doc:h.ps.app.activeDocument.id}));
  h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array(4).fill(255)});h.click('open-relight');await new Promise(r=>setTimeout(r,80));assert.equal(h.el('relight-dialog').hasAttribute('open'),true);
  h.click('relight-close');await new Promise(r=>setTimeout(r,20));assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.posts.length,0);
 }finally{await h.close();}
});



test('diagnostic retry clears an unclassified source-read failure only after fresh relight pixels are committed',async()=>{
 const h=await panelHarness();try{
  await open(h);h.click('relight-close');await new Promise(r=>setTimeout(r,20));const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async()=>{throw Error('source read failed');};
  h.click('open-relight');await new Promise(r=>setTimeout(r,80));assert.equal(h.el('relight-dialog').hasAttribute('open'),false);assert.equal(h.el('diagnostic-box').style.display,'block');assert.notEqual(h.el('diagnostic-primary').style.display,'none');
  h.click('clear-protection');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block','unrelated successful controls must retain the read failure');h.click('diagnostic-primary');await new Promise(r=>setTimeout(r,80));assert.equal(h.el('relight-dialog').hasAttribute('open'),false);assert.equal(h.el('diagnostic-box').style.display,'block');
  h.ps.imaging.getPixels=read;h.click('diagnostic-primary');await new Promise(r=>setTimeout(r,80));assert.equal(h.el('relight-dialog').hasAttribute('open'),true);h.click('relight-close');await new Promise(r=>setTimeout(r,20));assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
 }finally{await h.close();}
});

test('a queued second open cannot expose the stale workbench or steal a pending native capture failure',async()=>{
 const h=await panelHarness();let release=()=>{};try{
  await open(h);h.el('relight-intensity').value='3.4';h.change('relight-intensity');const before=await draft(h);h.click('relight-close');await new Promise(r=>setTimeout(r,20));
  let started=()=>{};const entered=new Promise<void>(resolve=>{started=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});h.ps.imaging.getPixels=async()=>{started();await barrier;throw Error('source read failed');};
  h.click('open-relight');await entered;assert.equal(h.el('relight-dialog').hasAttribute('open'),false);h.click('open-relight');await new Promise(r=>setTimeout(r,20));assert.equal(h.el('relight-dialog').hasAttribute('open'),false,'a capture in flight cannot reopen stale pixels');
  release();await h.wait();assert.equal(h.el('relight-dialog').hasAttribute('open'),false);assert.equal(h.el('diagnostic-box').style.display,'block');assert.match(h.el('diagnostic-summary').textContent,/source read failed/);assert.equal(JSON.parse(String(h.files['relight-draft.json'])).scene.source.snapshotId,before.source.snapshotId);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
 }finally{release();await h.wait();await h.close();}
});
test('candidate extraction controls commit once at gesture end, retain the original UUID and never submit',async()=>{
  const source={width:2,height:2,rgba:new Uint8Array([50,80,110,255,70,90,130,255,90,100,140,255,100,120,150,255])};
  const h=await panelHarness({source});try{
    await open(h);assert.ok(h.el('relight-fidelity-slider'),'local result controls must exist');
    assert.equal(h.el('relight-fidelity-slider').disabled,true);h.click('relight-generate');await h.wait();
    const original=h.records()[0],metadata=original.relight as any,savedScene=JSON.stringify(metadata.scene),fingerprint=metadata.fingerprint,raw=(h.files[original.outputFile as string] as Uint8Array).slice();
    assert.equal(h.el('relight-fidelity-slider').disabled,false);assert.equal(h.el('relight-fidelity').value,'1');assert.equal(h.el('relight-detail-protection').value,'0.65');
    h.el('relight-fidelity-slider').value='.6';h.event('relight-fidelity-slider','input');h.el('relight-fidelity-slider').value='0';h.event('relight-fidelity-slider','input');
    const writes=h.fileWrites.length;await new Promise(r=>setTimeout(r,30));assert.equal(h.fileWrites.length,writes,'intermediate slider events do not write local files');
    assert.equal(h.el('relight-fidelity').value,'0');assert.equal((h.records()[0].relight as any).localExtraction,undefined);
    h.change('relight-fidelity-slider');await h.wait();const adjusted=h.records()[0];
    assert.deepEqual((adjusted.relight as any).localExtraction,{fidelity:0,detailProtection:.65});assert.equal(adjusted.id,original.id);assert.equal(JSON.stringify((adjusted.relight as any).scene),savedScene);assert.equal((adjusted.relight as any).fingerprint,fingerprint);
    assert.deepEqual(h.files[original.outputFile as string],raw);assert.equal(h.posts.length,1);assert.equal(h.uploads.length,2);assert.equal(h.gatewayPosts.length,0);
    const preview=h.el('relight-image').getAttribute('src');h.click('relight-close');await new Promise(r=>setTimeout(r,20));h.selectHistory(adjusted.id);h.click('load-history');await h.wait();
    h.click('open-relight');await new Promise(r=>setTimeout(r,70));const button=h.el('relight-result-list').querySelector('button');button.id='saved-extraction-result';h.click('saved-extraction-result');
    assert.equal(h.el('relight-fidelity').value,'0');assert.equal(h.el('relight-image').getAttribute('src'),preview);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('local extraction failure preserves useful preview, settings and original files',async()=>{
  const h=await panelHarness();try{
    await open(h);h.click('relight-generate');await h.wait();const record=h.records()[0],name=record.outputFile as string,saved=JSON.stringify(record),raw=h.files[name],preview=h.el('relight-image').getAttribute('src');
    h.files[name]=encodePng({width:32,height:32,rgba:new Uint8Array(32*32*4)});
    h.el('relight-detail-protection').value='.9';h.change('relight-detail-protection');await h.wait();
    assert.equal(JSON.stringify(h.records()[0]),saved);assert.equal(h.el('relight-image').getAttribute('src'),preview);assert.equal(h.el('relight-detail-protection').value,'0.65');assert.match(h.el('relight-status').textContent,/失败.*保留/);assert.equal(h.el('relight-apply').disabled,false);
    h.files[name]=raw;h.failMoves.add('history.json');h.el('relight-detail-protection').value='.9';h.change('relight-detail-protection');await h.wait();
    assert.equal(JSON.stringify(h.records()[0]),saved);assert.equal(h.el('relight-image').getAttribute('src'),preview);assert.equal(h.el('relight-detail-protection').value,'0.65');assert.match(h.el('relight-status').textContent,/失败.*保留/);h.failMoves.delete('history.json');assert.equal(h.posts.length,1);assert.equal(h.uploads.length,2);
  }finally{await h.close();}
});

test('pending generation disables extraction of an already selected lighting candidate',async()=>{
  const h=await panelHarness();try{
    await open(h);h.click('relight-generate');await h.wait();const first=h.records()[0];assert.equal(h.el('relight-fidelity').disabled,false);
    h.setJobStatus('running');h.click('relight-generate');await new Promise(r=>setTimeout(r,120));assert.equal(h.posts.length,2);assert.equal(h.el('relight-fidelity').disabled,true);assert.equal(h.el('relight-detail-protection-slider').disabled,true);
    h.el('relight-fidelity').value='.1';h.change('relight-fidelity');assert.equal((h.records().find(r=>r.id===first.id)!.relight as any).localExtraction,undefined);
    h.setJobStatus('ready');await h.wait();assert.equal(h.el('relight-fidelity').disabled,false);assert.equal(h.el('relight-fidelity').value,'1');
  }finally{h.setJobStatus('ready');await h.close();}
});

for(const abandon of ['selection','close'] as const)test(`an extraction abandoned by ${abandon} before persistence cannot replace or save a candidate`,async()=>{
  const h=await panelHarness();try{
    await open(h);h.click('relight-generate');await h.wait();const first=h.records()[0];h.click('relight-generate');await h.wait();const second=h.records()[0];
    const select=(id:string)=>{const button=h.el('relight-result-list').querySelector(`[data-job-id="${id}"]`);button.id='choose-extraction-result';h.click('choose-extraction-result');};
    select(first.id);h.holdFileRead(first.outputFile as string);const saved=JSON.stringify(h.records());h.el('relight-fidelity').value='.3';h.change('relight-fidelity');await new Promise(r=>setTimeout(r,20));
    assert.equal(h.el('relight-fidelity').disabled,true);
    if(abandon==='selection')select(second.id);else h.click('relight-close');
    h.releaseFileRead(first.outputFile as string);await h.wait();assert.equal(JSON.stringify(h.records()),saved);assert.equal(h.posts.length,2);assert.equal(h.uploads.length,4);
    if(abandon==='selection'){assert.equal(h.el('relight-result-list').querySelector('.active').getAttribute('data-job-id'),second.id);assert.equal(h.el('relight-fidelity').value,'1');}
    else assert.equal(h.el('relight-dialog').hasAttribute('open'),false);
  }finally{await h.close();}
});

test('a selection change after extraction persistence begins keeps that selection and each candidate settings',async()=>{
  const h=await panelHarness();try{
    await open(h);h.click('relight-generate');await h.wait();const first=h.records()[0];h.click('relight-generate');await h.wait();const second=h.records()[0];
    const choose=(id:string)=>{const button=h.el('relight-result-list').querySelector(`[data-job-id="${id}"]`);button.id='choose-extraction-result';h.click('choose-extraction-result');};
    choose(first.id);const mainSelection=h.el('candidate-select').value;h.holdFileWrite('history.json.tmp');const writes=h.fileWrites.length;h.el('relight-fidelity').value='.25';h.change('relight-fidelity');
    for(let i=0;i<80&&!h.fileWrites.slice(writes).includes('history.json.tmp');i++)await new Promise(r=>setTimeout(r,10));
    assert.ok(h.fileWrites.slice(writes).includes('history.json.tmp'),'extraction reached the metadata commit');choose(second.id);const preview=h.el('relight-image').getAttribute('src');h.releaseFileWrite('history.json.tmp');await h.wait();
    assert.equal(h.el('relight-result-list').querySelector('.active').getAttribute('data-job-id'),second.id);assert.equal(h.el('relight-fidelity').value,'1');assert.equal(h.el('relight-image').getAttribute('src'),preview);
    assert.equal(h.el('candidate-select').value,mainSelection,'late completion does not select its original main-panel candidate');
    assert.deepEqual((h.records().find(r=>r.id===first.id)!.relight as any).localExtraction,{fidelity:.25,detailProtection:.65});assert.equal((h.records().find(r=>r.id===second.id)!.relight as any).localExtraction,undefined);
    choose(first.id);assert.equal(h.el('relight-fidelity').value,'0.25');assert.equal(h.posts.length,2);
  }finally{h.releaseFileWrite('history.json.tmp');await h.close();}
});

test('local extraction gestures cancel with Escape and saved settings stay isolated between candidates',async()=>{
  const h=await panelHarness();try{
    await open(h);h.click('relight-generate');await h.wait();const first=h.records()[0];
    const saved=JSON.stringify(h.records()),writes=h.fileWrites.length;h.event('relight-fidelity-slider','pointerdown',{button:0,pointerId:17});h.el('relight-fidelity-slider').value='.2';h.event('relight-fidelity-slider','input');h.event('relight-fidelity-slider','keydown',{key:'Escape'});h.event('relight-fidelity-slider','pointerup',{pointerId:17});await new Promise(r=>setTimeout(r,25));
    assert.equal(h.el('relight-fidelity').value,'1');assert.equal(JSON.stringify(h.records()),saved);assert.equal(h.fileWrites.length,writes);
    h.el('relight-detail-protection').value='1.5';h.change('relight-detail-protection');await h.wait();assert.equal(h.el('relight-detail-protection').value,'1');assert.deepEqual((h.records()[0].relight as any).localExtraction,{fidelity:1,detailProtection:1});
    h.click('relight-generate');await h.wait();assert.equal(h.el('relight-detail-protection').value,'0.65');const next=h.records()[0];assert.notEqual(next.id,first.id);
    const button=h.el('relight-result-list').querySelector(`[data-job-id="${first.id}"]`);button.id='first-local-settings';h.click('first-local-settings');assert.equal(h.el('relight-detail-protection').value,'1');assert.equal(h.posts.length,2);
    h.el('relight-fidelity').value='';h.change('relight-fidelity');await h.wait();assert.equal(h.el('relight-fidelity').value,'1');assert.match(h.el('relight-status').textContent,/有限数值/);
  }finally{await h.close();}
});

test('local extraction controls and failure feedback are translated without changing the frozen scene',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),language:'en-US'}});try{
    await open(h);h.click('relight-generate');await h.wait();const record=h.records()[0],scene=JSON.stringify((record.relight as any).scene);
    assert.equal(h.el('relight-fidelity-slider').getAttribute('aria-label'),'Light fidelity');assert.equal(h.el('relight-detail-protection').getAttribute('aria-label'),'Precise value: Detail protection');
    h.files[record.outputFile as string]=encodePng({width:32,height:32,rgba:new Uint8Array(32*32*4)});h.el('relight-fidelity').value='.5';h.change('relight-fidelity');await h.wait();
    assert.match(h.el('relight-status').textContent,/Local adjustment failed.*retained/);assert.doesNotMatch(h.el('relight-status').textContent,/[一-龥]/);assert.equal(JSON.stringify((h.records()[0].relight as any).scene),scene);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});
