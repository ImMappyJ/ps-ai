import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {decodePng} from '../src/imaging/image';

test('remove hides the whole prompt group, submits no hidden draft and restores the ordinary draft after language changes',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('prompt').value='PRIVATE DRAFT: preserve this ordinary edit';
    h.el('mode').value='remove';h.change('mode');
    assert.equal(h.el('prompt-group')?.style.display,'none');
    h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('prompt-group').style.display,'none');
    h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.posts.length,1);assert.equal(h.records()[0].userPrompt,'');
    assert.doesNotMatch(h.posts[0].prompt['4'].inputs.prompt,/PRIVATE DRAFT/);
    h.selectHistory(h.records()[0].id);h.click('repeat-history');await h.wait();
    h.el('mode').value='edit';h.change('mode');
    assert.notEqual(h.el('prompt-group').style.display,'none');
    assert.equal(h.el('prompt').value,'PRIVATE DRAFT: preserve this ordinary edit');
  }finally{await h.close();}
});

test('remove accepts an empty prompt in the panel',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('prompt').value='';h.el('mode').value='remove';h.change('mode');
    h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.posts.length,1);assert.equal(h.records()[0].state,'ready');assert.equal(h.records()[0].userPrompt,'');
  }finally{await h.close();}
});

test('Image Blending has a separate optional draft, translated label and restores ordinary checkbox preferences',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('prompt').value='ordinary edit draft';h.el('guide').checked=true;h.el('align-subject').checked=true;h.el('match-color').checked=true;
    h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');
    assert.equal(h.el('mode').querySelector('option[value="blend"]')?.textContent,'溶图');assert.equal(h.el('prompt').value,'');
    assert.match(h.el('prompt-label').textContent,/可选/);
    for(const id of ['guide','align-subject','match-color']){assert.equal(h.el(id).checked,false);assert.equal(h.el(id).disabled,true);}
    assert.match(h.el('mode-help').textContent,/不.*送入 ComfyUI/);
    h.el('prompt').value='补充：暖色轮廓光';h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('mode').querySelector('option[value="blend"]').textContent,'Image Blending');assert.equal(h.el('prompt').value,'补充：暖色轮廓光');assert.match(h.el('mode-help').textContent,/whole canvas|full canvas/i);assert.match(h.el('mode-help').textContent,/not sent to ComfyUI/i);assert.doesNotMatch(h.el('mode-help').textContent,/[一-龥]/);
    h.el('mode').value='costume';h.change('mode');assert.equal(h.el('prompt').value,'ordinary edit draft');
    for(const id of ['guide','align-subject','match-color']){assert.equal(h.el(id).checked,true);assert.equal(h.el(id).disabled,false);}
    h.el('mode').value='blend';h.change('mode');assert.equal(h.el('prompt').value,'补充：暖色轮廓光');
  }finally{await h.close();}
});

// Three provider canvas/PNG round trips take 18s on serial hosted Windows.
test('Image Blending with no supplemental prompt submits a semantic edit to each platform',{timeout:60_000},async()=>{
  for(const [provider,gatewayModel] of [['bailian','qwen-image-2.1-pro'],['gemini','gemini-2.5-flash-image'],['openai','gpt-image-1.5']] as const){
    const h=await panelHarness({settings:{...defaultSettings(),backend:'gateway',gatewayModel,baseUrl:'http://localhost:8190'},gateway:{provider},selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
      await h.wait();h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');h.el('resolution').value='512';h.el('prompt').value='';h.click('generate');await h.wait();
      assert.equal(h.el('guide').disabled,false);assert.equal(h.el('guide').checked,true);assert.doesNotMatch(h.el('mode-help').textContent,/不送入 ComfyUI/);
      assert.equal(h.gatewayPosts.length,1,provider);const request=h.gatewayPosts[0].request;
      assert.equal(request.kind,'edit');assert.equal(request.mode,'blend');assert.doesNotMatch(request.prompt,/<image[123]>/);
      assert.ok(request.source);assert.ok(request.guide);assert.equal(h.records()[0].userPrompt,'');
      assert.equal((h.records()[0].params as any).alignSubject,false);assert.equal((h.records()[0].params as any).matchColor,false);
    }finally{await h.close();}
  }
});

test('Blend restores the current guide preference when switching between ComfyUI and a gateway',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('guide').checked=true;h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');assert.equal(h.el('guide').checked,false);assert.equal(h.el('guide').disabled,true);
    h.el('backend-kind').value='gateway';h.change('backend-kind');await h.wait();assert.equal(h.el('guide').checked,true);assert.equal(h.el('guide').disabled,false);
    h.el('guide').checked=false;h.change('guide');h.el('backend-kind').value='comfyui';h.change('backend-kind');await h.wait();assert.equal(h.el('guide').checked,false);assert.equal(h.el('guide').disabled,true);
    h.el('mode').value='costume';h.change('mode');assert.equal(h.el('guide').checked,false);assert.equal(h.el('guide').disabled,false);assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);
  }finally{await h.close();}
});

test('Image Blending previews and submits the full canvas while ordinary editing captures a local context',async()=>{
  const width=80,height=64,source={width,height,rgba:new Uint8Array(width*height*4).fill(255)},mask=new Uint8Array(width*height);mask[32*width+40]=255;
  const h=await panelHarness({source,selection:{bounds:{left:40,top:32,right:41,bottom:33},mask}});try{
    await h.wait();h.click('capture');await h.wait();assert.deepEqual({...h.pixelRequests[0].sourceBounds},{left:8,top:0,right:73,bottom:64});
    h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');assert.equal(h.el('selection-previews').style.display,'none');h.click('capture');await h.wait();
    assert.deepEqual({...h.pixelRequests[h.pixelRequests.length-1].sourceBounds},{left:0,top:0,right:80,bottom:64});
    h.el('resolution').value='32';h.click('generate');await h.wait();assert.equal(h.posts.length,1);
    assert.equal(h.uploads.length,1);assert.match(h.uploads[0].name,/-source\.png$/);assert.equal(h.posts[0].prompt['4'].inputs['images.image_2'],undefined);assert.doesNotMatch(h.posts[0].prompt['4'].inputs.prompt,/范围蒙版|<image2>/);assert.equal((h.records()[0].params as any).guide,false);
    assert.deepEqual((h.records()[0].snapshot as any).bounds,{left:0,top:0,right:80,bottom:64});
    const saved=decodePng(h.files[h.records()[0].id+'-source.png'] as Uint8Array);assert.equal(saved.width,80);assert.equal(saved.height,64);
    const effective=h.files[h.records()[0].id+'-mask.bin'] as Uint8Array;assert.equal(effective[32*80+40],255);assert.equal(effective[0],0);
  }finally{await h.close();}
});

test('Image Blending rejects a subject without any visible environment before upload',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.match(h.el('status').textContent,/可见环境/);
  }finally{await h.close();}
});

test('background and scene preview the whole canvas with the subject excluded from the edit mask',async()=>{
  for(const [tab,mode] of [['tab-local','background'],['tab-cosplay','scene']]){
    const width=80,height=64,mask=new Uint8Array(width*height);mask[32*width+40]=255;
    const h=await panelHarness({source:{width,height,rgba:new Uint8Array(width*height*4).fill(255)},selection:{bounds:{left:40,top:32,right:41,bottom:33},mask}});try{
      await h.wait();h.click(tab);h.el('mode').value=mode;h.change('mode');h.click('capture');await h.wait();
      assert.deepEqual({...h.pixelRequests[h.pixelRequests.length-1].sourceBounds},{left:0,top:0,right:80,bottom:64});
      assert.match(h.el('mode-help').textContent,/选中.*主体.*无需反选/);h.el('resolution').value='32';h.click('generate');await h.wait();
      const record=h.records()[0],saved=h.files[record.id+'-mask.bin'] as Uint8Array;
      assert.equal(saved[0],255);assert.equal(saved[32*80+40],0);assert.equal(saved[saved.length-1],255);
    }finally{await h.close();}
  }
});

test('new background history persists native subject and protection masks as binary and reloads the same prepared candidate',async()=>{
  const source={width:2,height:2,rgba:new Uint8Array([200,80,40,255,200,80,40,128,0,0,0,0,50,60,70,255])};
  const subject={bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([255,128,0,0])};
  const h=await panelHarness({source,output:{width:32,height:32,rgba:Uint8Array.from({length:32*32*4},(_,i)=>[40,110,210,255][i%4])}});try{
    await h.wait();h.setSelection({bounds:{left:1,top:1,right:2,bottom:2},mask:new Uint8Array([0,0,0,255])});h.click('protect');await h.wait();
    h.setSelection(subject);h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.records()[0].state,'ready');const record=h.records()[0],snapshot=record.snapshot as any;
    assert.equal(snapshot.backgroundComposite,'subject-background-v1');assert.equal(snapshot.mask,undefined);assert.equal(snapshot.subjectMask,undefined);assert.equal(snapshot.protectionMask,undefined);
    assert.deepEqual([...h.files[record.id+'-subject-mask.bin'] as Uint8Array],[255,128,0,0]);
    assert.deepEqual([...h.files[record.id+'-protection-mask.bin'] as Uint8Array],[0,0,0,255]);
    const mask=h.files[record.id+'-mask.bin'] as Uint8Array;assert.equal(mask[0],0);assert.equal(mask[2],255);assert.equal(mask[3],0);
    h.click('export');await h.wait();const name='ps-ai-'+record.id.slice(0,8)+'.png',before=(h.files[name] as Uint8Array).slice(),prepared=decodePng(before);
    assert.equal(prepared.width,2);assert.equal(prepared.height,2);assert.equal(prepared.rgba[11],255);
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array(4).fill(255)});
    h.selectHistory(record.id);h.click('load-history');await h.wait();h.click('export');await h.wait();
    assert.deepEqual(h.files[name],before);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('old background history retains its stored edit direction without requiring new binary masks',async()=>{
  const h=await panelHarness({selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
    await h.wait();h.el('resolution').value='32';h.click('generate');await h.wait();
    const records=h.records(),record=records[0];(record.params as any).mode='background';delete (record.snapshot as any).backgroundComposite;
    h.files['history.json']=JSON.stringify(records);const saved=(h.files[record.id+'-mask.bin'] as Uint8Array).slice();
    h.selectHistory(record.id);h.click('load-history');await h.wait();
    assert.deepEqual(h.files[record.id+'-mask.bin'],saved);assert.equal(h.files[record.id+'-subject-mask.bin'],undefined);
    assert.equal(h.errors.length,0);assert.equal(h.el('export').disabled,false);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('a new background history with missing or damaged mask data fails explicitly while keeping its raw output',async()=>{
  const h=await panelHarness({selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
    await h.wait();h.el('resolution').value='32';h.click('generate');await h.wait();
    const records=h.records(),record=records[0];(record.params as any).mode='background';(record.snapshot as any).backgroundComposite='subject-background-v1';h.files['history.json']=JSON.stringify(records);
    h.selectHistory(record.id);h.click('load-history');await h.wait();
    assert.match(h.el('status').textContent,/背景历史.*蒙版/);assert.ok(h.files[record.outputFile as string]);
    h.files[record.id+'-subject-mask.bin']=new Uint8Array([0]);h.files[record.id+'-protection-mask.bin']=new Uint8Array(4);
    h.click('load-history');await h.wait();assert.match(h.el('status').textContent,/背景历史.*蒙版/);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('transparent new background candidates retain the raw failed output for export before any opaque reconstruction',async()=>{
  const h=await panelHarness({selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])},output:{width:32,height:32,rgba:new Uint8Array(32*32*4)}});try{
    await h.wait();h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.el('apply').disabled,true);assert.match(h.el('candidate-warning').textContent,/背景.*透明/);
    h.click('export');await h.wait();const record=h.records()[0],image=decodePng(h.files['ps-ai-'+record.id.slice(0,8)+'.png'] as Uint8Array);
    assert.equal(image.width,32);assert.ok(image.rgba.every(v=>v===0));assert.ok(h.files[record.outputFile as string]);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('reusing Image Blending history retains supplemental text without overwriting the ordinary draft or checkbox choices',async()=>{
  const h=await panelHarness({selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
    await h.wait();h.el('prompt').value='ordinary edit draft';h.el('align-subject').checked=true;h.el('match-color').checked=true;
    h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');const extra='  补充暖光，保留标签 <image9>  ';h.el('prompt').value=extra;h.el('resolution').value='32';h.click('generate');await h.wait();
    const record=h.records()[0];assert.equal(record.userPrompt,extra);assert.equal((record.params as any).mode,'blend');
    h.el('mode').value='costume';h.change('mode');h.el('prompt').value='new ordinary edit draft';
    h.selectHistory(record.id);h.click('repeat-history');await h.wait();assert.equal(h.el('prompt').value,extra);
    h.el('language').value='en-US';h.change('language');await h.wait();h.click('load-history');await h.wait();assert.equal(h.el('prompt').value,extra);
    h.el('mode').value='costume';h.change('mode');assert.equal(h.el('prompt').value,'new ordinary edit draft');
    for(const id of ['align-subject','match-color'])assert.equal(h.el(id).checked,true);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('Image Blending subtracts feathered protection only from the selected subject',async()=>{
  const subject={bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([255,255,0,0])};
  const h=await panelHarness();try{
    await h.wait();h.setSelection({bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([128,255,0,0])});h.click('protect');await h.wait();
    h.setSelection(subject);h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    const record=h.records()[0];assert.deepEqual([...h.files[record.id+'-mask.bin'] as Uint8Array],[127,0,0,0]);
    assert.equal((record.snapshot as any).backgroundComposite,undefined);assert.equal(h.posts.length,1);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('new background history retains native 16-bit source alpha even for 8-bit generation',async()=>{
  const source={width:2,height:2,rgba:new Uint16Array([12345,23456,34567,65534,15000,25000,35000,32768,0,0,0,0,10000,20000,30000,65535])};
  const h=await panelHarness({source,selection:{bounds:{left:0,top:0,right:2,bottom:1},mask:new Uint8Array([255,128,0,0])}});try{
    await h.wait();h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    const record=h.records()[0],saved=decodePng(h.files[record.id+'-source.png'] as Uint8Array);assert.ok(saved.rgba instanceof Uint16Array);assert.equal(saved.rgba[3],65534);
    assert.equal((h.files[record.id+'-mask.bin'] as Uint8Array)[0],255);assert.ok(h.uploads[0].image.rgba instanceof Uint8Array);
    h.selectHistory(record.id);h.click('load-history');await h.wait();assert.equal(h.errors.length,0);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('new background history rejects a missing or inconsistent application mask',async()=>{
  const h=await panelHarness({selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
    await h.wait();h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    const record=h.records()[0],name=record.id+'-mask.bin',saved=(h.files[name] as Uint8Array).slice();delete h.files[name];
    h.selectHistory(record.id);h.click('load-history');await h.wait();assert.match(h.el('status').textContent,/背景历史.*蒙版/);
    h.files[name]=saved.slice();(h.files[name] as Uint8Array)[0]=255;h.click('load-history');await h.wait();assert.match(h.el('status').textContent,/背景历史.*蒙版/);
    assert.ok(h.files[record.outputFile as string]);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});
