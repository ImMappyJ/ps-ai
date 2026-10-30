import test from 'node:test';import assert from 'node:assert/strict';import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {decodePng} from '../src/imaging/image';
const subjectSelection={bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])};

test('background and Portrait scene generate opaque scenery without a ComfyUI visual-mask reference',async()=>{
  for(const [tab,mode] of [['tab-local','background'],['tab-cosplay','scene']]){
    const source={width:2,height:2,rgba:new Uint8Array([60,90,120,0,60,90,120,128,60,90,120,255,60,90,120,255])};
    const h=await panelHarness({source,output:{width:32,height:32,rgba:Uint8Array.from({length:32*32*4},(_,i)=>[40,110,210,255][i%4])}});try{
      await h.wait();h.click(tab);h.el('mode').value=mode;h.change('mode');h.el('resolution').value='32';h.el('prompt').value='少女站在舞台上';h.click('generate');await h.wait();
      assert.equal(h.posts.length,1);assert.equal(h.posts[0].prompt['4'].inputs['images.image_2'],undefined);
      const p=h.records()[0].params as any;assert.equal(p.preserveAlpha,false);assert.equal(p.alignSubject,false);assert.equal(p.guide,false);
      const upload=h.uploads.find(u=>u.name.endsWith('-source.png'))!;assert.equal(upload.image.rgba[3],255);assert.deepEqual([...upload.image.rgba.slice(0,4)],[255,255,255,255]);
      const original=decodePng(h.files[h.records()[0].id+'-source.png'] as Uint8Array);assert.equal(original.rgba[3],0);
      const candidate=decodePng(new Uint8Array(Buffer.from(h.el('detail-preview').src.split(',')[1],'base64')));assert.deepEqual([...candidate.rgba.slice(0,4)],[40,110,210,255]);
    }finally{await h.close();}
  }
});

test('background controls disable conflicting options and restore local-edit choices when switching back',async()=>{
  const h=await panelHarness();try{await h.wait();h.el('guide').checked=true;h.el('preserve-alpha').checked=true;h.el('align-subject').checked=false;
    h.el('mode').value='background';h.change('mode');
    for(const id of ['guide','preserve-alpha','align-subject']){assert.equal(h.el(id).checked,false);assert.equal(h.el(id).disabled,true);}
    h.el('mode').value='edit';h.change('mode');assert.equal(h.el('guide').checked,true);assert.equal(h.el('preserve-alpha').checked,true);assert.equal(h.el('align-subject').checked,false);
  }finally{await h.close();}
});

test('background and scene disable context color matching for new jobs and restore the ordinary preference',async()=>{
  for(const [tab,mode] of [['tab-local','background'],['tab-cosplay','scene']]){
    const h=await panelHarness({selection:subjectSelection});try{
      await h.wait();h.el('match-color').checked=true;h.click(tab);h.el('mode').value=mode;h.change('mode');
      assert.equal(h.el('match-color').checked,false);assert.equal(h.el('match-color').disabled,true);
      h.el('resolution').value='32';h.click('generate');await h.wait();assert.equal((h.records()[0].params as any).matchColor,false);
      h.selectHistory(h.records()[0].id);h.click('repeat-history');await h.wait();assert.equal(h.el('match-color').checked,false);
      h.el('mode').value=tab==='tab-local'?'edit':'costume';h.change('mode');assert.equal(h.el('match-color').checked,true);assert.equal(h.el('match-color').disabled,false);
    }finally{await h.close();}
  }
});

test('legacy background history still applies its saved color correction after the new background UI disables it',async()=>{
  const width=10,height=10,source={width,height,rgba:Uint8Array.from({length:width*height*4},(_,i)=>i%4===3?255:100)},mask=new Uint8Array(width*height);mask.fill(255,0,80);
  const h=await panelHarness({source,selection:{bounds:{left:0,top:0,right:10,bottom:8},mask},output:{width:32,height:32,rgba:Uint8Array.from({length:32*32*4},(_,i)=>i%4===3?255:120)}});try{
    await h.wait();h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    const records=h.records(),record=records[0],name='ps-ai-'+record.id.slice(0,8)+'.png';h.click('export');await h.wait();
    assert.deepEqual([...decodePng(h.files[name] as Uint8Array).rgba.slice(0,4)],[120,120,120,255]);
    delete (record.snapshot as any).backgroundComposite;(record.params as any).matchColor=true;h.files['history.json']=JSON.stringify(records);h.selectHistory(record.id);
    h.click('load-history');await h.wait();h.click('export');await h.wait();const legacy=decodePng(h.files[name] as Uint8Array);
    assert.equal(legacy.width,32);assert.deepEqual([...legacy.rgba.slice(0,4)],[100,100,100,255]);assert.equal((h.records()[0].params as any).matchColor,true);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('reusing corrected background history retains the ordinary edit checkbox preferences',async()=>{
  const h=await panelHarness({selection:subjectSelection});try{
    await h.wait();for(const id of ['guide','preserve-alpha','align-subject'])h.el(id).checked=true;
    h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    h.selectHistory(h.records()[0].id);h.click('repeat-history');await h.wait();
    h.el('mode').value='edit';h.change('mode');
    for(const id of ['guide','preserve-alpha','align-subject'])assert.equal(h.el(id).checked,true,id+' keeps the choice from ordinary editing');
  }finally{await h.close();}
});

test('transparent background failures remain exportable with a warning and cannot be applied',async()=>{
  const h=await panelHarness({selection:subjectSelection,output:{width:32,height:32,rgba:new Uint8Array(32*32*4)}});try{await h.wait();h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.records()[0].state,'ready');assert.equal(h.el('apply').disabled,true);assert.equal(h.el('export').disabled,false);assert.match(h.el('candidate-warning').textContent,/背景.*透明/);
  }finally{await h.close();}
});

test('old background history cannot restore conflicting settings or hide a transparent candidate failure',async()=>{
  const h=await panelHarness({selection:subjectSelection,output:{width:32,height:32,rgba:new Uint8Array(32*32*4)}});try{
    await h.wait();h.el('mode').value='background';h.change('mode');h.el('resolution').value='32';h.click('generate');await h.wait();
    const records=h.records(),id=records[0].id;Object.assign(records[0].params as Record<string,unknown>,{guide:true,preserveAlpha:true,alignSubject:true});delete (records[0].snapshot as any).backgroundComposite;delete h.files[id+'-subject-mask.bin'];delete h.files[id+'-protection-mask.bin'];h.files['history.json']=JSON.stringify(records);
    h.selectHistory(id);h.click('repeat-history');await h.wait();
    for(const key of ['guide','preserve-alpha','align-subject']){assert.equal(h.el(key).checked,false);assert.equal(h.el(key).disabled,true);}
    h.click('load-history');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.el('apply').disabled,true);assert.equal(h.el('export').disabled,false);
    h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('candidate-warning').textContent,/transparent/);assert.match(h.el('mode-help').textContent,/selection controls/);
    h.click('export');await h.wait();assert.ok(h.files['ps-ai-'+id.slice(0,8)+'.png']);assert.equal(h.records()[0].state,'ready');
  }finally{await h.close();}
});

test('ungranted source creates an explicitly approximate copy without picking and permits a second capture',async()=>{
  const {encodePng}=await import('../src/imaging/image');
  const h=await panelHarness({untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)})}});try{
    await h.wait();h.click('capture');await h.wait();
    assert.match(h.el('source-info').textContent,/22.*sRGB.*工作副本/);assert.doesNotMatch(h.el('source-info').textContent,/PNG sRGB/);assert.equal(h.sourceAccessEvents.filter(event=>event==='picker').length,0);
    h.el('language').value='en-US';h.change('language');await h.wait();h.click('capture');await h.wait();assert.match(h.el('source-info').textContent,/sRGB/);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('an imported file path never prompts or blocks automatic capture of an untagged composite',async()=>{
  const {encodePng}=await import('../src/imaging/image');
  const h=await panelHarness({untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)}),wrongPath:true}});try{
    await h.wait();h.click('capture');await h.wait();assert.equal(h.ps.app.activeDocument.id,22);assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.sourceAccessEvents.filter(event=>event==='picker').length,0);assert.match(h.el('source-info').textContent,/sRGB/);assert.equal(h.ps.app.documents.find((doc:any)=>doc.id===11).colorProfileName,'');
  }finally{await h.close();}
});

test('修正参数重新生成后清除上次诊断，新的失败仍显示详情',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.click('nav-create');h.click('tab-t2i');h.el('count').value='0';h.click('generate');await h.wait();
    assert.equal(h.el('diagnostic-box').style.display,'block');
    h.el('count').value='1';h.click('generate');await h.wait();
    assert.equal(h.records()[0].state,'ready');assert.equal(h.el('diagnostic-box').style.display,'none');
    h.click('nav-create');h.el('count').value='0';h.click('generate');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');
  }finally{await h.close();}
});

test('复用16位历史后切换语言保留本次输出位深，不用旧偏好覆盖',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),outputDepth:8},uxpSelect:true});try{
    await h.wait();h.click('tab-t2i');h.click('generate');await h.wait();
    const records=h.records();(records[0].params as Record<string,unknown>).outputDepth=16;h.files['history.json']=JSON.stringify(records);
    h.click('repeat-history');await h.wait();assert.equal(h.el('output-depth').value,'16');
    for(const language of ['en-US','zh-CN']){h.el('language').value=language;h.change('language');await h.wait();assert.equal(h.el('output-depth').value,'16');}
    assert.equal(JSON.parse(String(h.files['settings.json'])).outputDepth,8);
  }finally{await h.close();}
});

test('连接失败直接复制技术详情；成功检查后清除对应旧错误',async()=>{
  const h=await panelHarness();try{await h.wait();h.el('backend-url').value='http://offline.invalid:9999';h.click('connect');await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');
    h.click('toggle-error-details');await h.wait();assert.equal(h.el('diagnostic-details').style.display,'none');assert.equal(h.clipboardWrites.length,1);assert.equal(JSON.parse(h.clipboardWrites[0]).code,'unreachable');assert.equal(h.el('diagnostic-box').style.display,'block');
    h.el('backend-url').value='http://localhost:8188';h.click('connect');await h.wait();assert.equal(h.el('connection').textContent,'节点已检查');assert.equal(h.el('diagnostic-box').style.display,'none');
  }finally{await h.close();}
});

test('语言切换刷新 UXP 已选中的应用位置和参考用途标题，保留参数值',async()=>{
  const h=await panelHarness({uxpSelect:true});try{
    h.el('usage').value='材质';h.el('destination').value='document';
    h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('usage').value,'材质');assert.equal(h.el('destination').value,'document');
    assert.match(h.el('usage').displayedCaption,/material/i);assert.match(h.el('destination').displayedCaption,/new document/i);
    h.el('language').value='zh-CN';h.change('language');await h.wait();
    assert.equal(h.el('usage').displayedCaption,'材质');assert.match(h.el('destination').displayedCaption,/新文档/);
  }finally{await h.close();}
});

test('候选显示冻结来源；来源关闭后可检查但不回填，仍保留导出',async()=>{
  const h=await panelHarness();try{
    h.el('resolution').value='32';h.click('generate');await h.wait();assert.match(h.el('candidate-target').textContent,/11.*sRGB/);assert.equal(h.el('apply').disabled,false);
    h.setDocument(22);h.change('candidate-select');await new Promise(r=>setTimeout(r,30));
    assert.equal(h.el('apply').disabled,false);assert.equal(h.el('apply').getAttribute('data-candidate-action'),'inspect');assert.equal(h.el('export').disabled,false);assert.match(h.el('candidate-target').textContent,/来源.*改变|关闭|会话/);
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.equal(h.ps.app.activeDocument.id,22);assert.equal(h.errors[0]?.code,'source-unavailable');
  }finally{await h.close();}
});

test('首次向导逐步检查，连接成功才保存地址，不自动生成',async()=>{
  const h=await panelHarness();try{
    assert.equal(h.el('setup-body').style.display,'block');assert.match(h.el('setup-step').textContent,/1/);assert.equal(h.posts.length,0);
    assert.equal(h.el('setup-check').disabled,true);assert.equal(h.el('setup-example').disabled,true);
    h.el('backend-url').value='http://localhost:8199';h.click('setup-connect');await h.wait();
    assert.equal(JSON.parse(String(h.files['settings.json'])).baseUrl,'http://localhost:8199');assert.match(h.el('setup-step').textContent,/2/);assert.equal(h.posts.length,0);
    h.click('setup-check');await h.wait();assert.match(h.el('setup-step').textContent,/3/);assert.match(h.el('setup-report').textContent,/27\.0|qwen21/);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});
test('已有有效配置进入主界面；重新打开向导也不提交任务',async()=>{
  const h=await panelHarness({settings:defaultSettings()});try{
    assert.equal(h.el('setup-body').style.display,'none');h.click('open-setup');await h.wait();assert.equal(h.el('setup-body').style.display,'block');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});
test('连接失败不覆盖有效设置，显示下一步和可复制详情',async()=>{
  const h=await panelHarness({settings:defaultSettings()});try{
    h.click('open-setup');await h.wait();h.el('backend-url').value='http://offline.invalid:9999';h.click('setup-connect');await h.wait();
    assert.equal(JSON.parse(String(h.files['settings.json'])).baseUrl,'http://localhost:8188');assert.equal(h.posts.length,0);
    assert.match(h.el('diagnostic-title').textContent,/后端/);assert.match(h.el('diagnostic-action').textContent,/地址|端口/);assert.equal(h.el('diagnostic-details').style.display,'none');h.click('toggle-error-details');assert.match(h.el('diagnostic-details').value,/unreachable/);
  }finally{await h.close();}
});
test('英文向导和诊断给出操作建议，未知异常不猜测内存不足',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),language:'en-US'}});try{
    h.click('open-setup');await h.wait();assert.match(h.el('setup-step').textContent,/setup/i);assert.doesNotMatch(h.el('setup-help').textContent,/[一-龥]/);
    h.el('backend-url').value='http://offline.invalid:9999';h.click('setup-connect');await h.wait();assert.doesNotMatch(h.el('diagnostic-summary').textContent,/[一-龥]/);assert.match(h.el('diagnostic-action').textContent,/port|address/i);
  }finally{await h.close();}
});

test('保存地址与语言后重载仍使用新后端，英文界面保留参数',async()=>{
  const h=await panelHarness();try{
    assert.ok(h.el('backend-url'));h.el('backend-url').value='http://localhost:8199/';h.el('language').value='en-US';h.el('seed').value='123';h.click('save-settings');await h.wait();
    const saved=JSON.parse(String(h.files['settings.json']));assert.equal(saved.baseUrl,'http://localhost:8199');assert.equal(saved.language,'en-US');assert.equal(h.el('generate').textContent,'Generate');assert.equal(h.el('seed').value,'123');
    h.click('tab-t2i');h.click('generate');await h.wait();assert.equal(h.records()[0].baseUrl,'http://localhost:8199');assert.match(h.el('status').textContent,/candidate/i);
    const reload=await panelHarness({settings:saved});try{assert.equal(reload.el('backend-url').value,saved.baseUrl);assert.equal(reload.el('generate').textContent,'Generate');}finally{await reload.close();}
  }finally{await h.close();}
});
test('切换后端后恢复或取消旧任务时不向新后端发送请求',async()=>{
  const h=await panelHarness();try{
    h.files['history.json']=JSON.stringify([{id:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222',createdAt:new Date().toISOString(),state:'unknown',graph:{},baseUrl:'http://localhost:8188'}]);
    h.el('backend-url').value='http://localhost:8199';h.click('save-settings');await h.wait();h.click('recover');await h.wait();assert.match(h.el('status').textContent,/8188/);assert.equal(h.records()[0].state,'unknown');
  }finally{await h.close();}
});
test('英文界面翻译进度与宿主错误，保留用户提示词和参考用途值',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),language:'en-US'},noDocuments:true});try{
    assert.equal(h.el('usage').value,'服装');h.click('generate');await h.wait();assert.match(h.el('status').textContent,/Photoshop document/);assert.doesNotMatch(h.el('status').textContent,/[一-龥]/);
    h.click('tab-t2i');h.el('count').value='0';h.click('generate');await h.wait();assert.match(h.el('status').textContent,/1–4/);assert.doesNotMatch(h.el('progress-label').textContent,/[一-龥]/);
  }finally{await h.close();}
});
test('语言切换保留未保存地址并使旧节点检查失效',async()=>{
  const h=await panelHarness();try{
    h.click('connect');await h.wait();assert.equal(h.el('connection').textContent,'节点已检查');h.el('backend-url').value='http://localhost:8199';h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('connection').textContent,'Unchecked');assert.equal(h.el('backend-url').value,'http://localhost:8199');assert.equal(JSON.parse(String(h.files['settings.json'])).baseUrl,'http://localhost:8188');
  }finally{await h.close();}
});

test('透明原图上传保留 alpha，预览及导出候选使用来源轮廓；编辑尺寸异常拒绝应用',async()=>{
  const h=await panelHarness({source:{width:2,height:2,rgba:new Uint8Array([0,0,0,0,40,60,80,128,80,100,120,255,120,140,160,255])}});
  try{h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.uploads[0].image.rgba[3],0);assert.equal(h.uploads[0].image.rgba[h.uploads[0].image.rgba.length-1],255);
    assert.equal(h.records()[0].state,'ready');assert.equal((h.records()[0].params as any).preserveAlpha,true);
    const output=decodePng(new Uint8Array(h.files[String(h.records()[0].outputFile)] as Uint8Array));assert.equal(output.width,32);
    h.click('export');await new Promise(r=>setTimeout(r,60));const saved=decodePng(h.files[`ps-ai-${h.records()[0].id.slice(0,8)}.png`] as Uint8Array);assert.equal(saved.rgba[3],0);assert.equal(saved.rgba[saved.rgba.length-1],255);
    assert.match(h.el('status').textContent,/候选/);assert.equal(h.errors.length,0);
  }finally{await h.close();}
  const bad=await panelHarness({output:{width:2,height:2,rgba:new Uint8Array(16).fill(255)}});
  try{bad.click('generate');await bad.wait();assert.equal(bad.records()[0].state,'output-error');assert.match(bad.el('status').textContent,/尺寸/);assert.equal(bad.el('apply').disabled,true);}finally{await bad.close();}
});

test('生成及选区预览不依赖 Photoshop 原生预览编码器，诊断记录不含提示词',async()=>{
  const h=await panelHarness({nativePreviewUnavailable:true});try{
    h.click('capture');await new Promise(r=>setTimeout(r,60));
    assert.match(h.el('source-preview').src,/^data:image\/png;base64,/);
    const thumbnail=decodePng(new Uint8Array(Buffer.from(h.el('source-preview').src.split(',')[1],'base64')));
    assert.equal(thumbnail.width,2);assert.equal(thumbnail.height,2);assert.deepEqual(Array.from(thumbnail.rgba),new Array(16).fill(255));
    h.click('tab-t2i');h.click('generate');await h.wait();
    assert.equal(h.records()[0].state,'ready');assert.match(h.el('detail-preview').src,/^data:image\/png;base64,/);
    assert.equal(h.errors.length,0);
    const trace=JSON.parse(String(h.files['runtime-trace.json']));
    assert.ok(trace.events.some((e:any)=>e.stage==='capture.pixels.read'));
    assert.ok(trace.events.some((e:any)=>e.stage==='candidate.ready'));
    assert.doesNotMatch(JSON.stringify(trace),/blue lightning|qwen.*safetensors/);
  }finally{await h.close();}
});
test('取消期间等待后端确认，完成的候选保留且进度不宣称整批完成',async()=>{
  const h=await panelHarness();try{h.click('tab-t2i');h.setJobStatus('running');h.click('generate');await new Promise(r=>setTimeout(r,80));h.progress(h.posts[0].prompt_id,5,25);h.click('cancel');h.progress(h.posts[0].prompt_id,20,25);assert.equal(h.el('progress-bar').getAttribute('value'),'20');await new Promise(r=>setTimeout(r,2000));assert.match(h.el('progress-label').textContent,/取消/);h.setJobStatus('ready');await h.wait();assert.equal(h.el('task-progress').getAttribute('aria-busy'),'false');assert.equal(h.records()[0].state,'ready');assert.match(h.el('progress-label').textContent,/保留/);assert.equal(h.el('progress-bar').getAttribute('value'),'0');}finally{h.setJobStatus('ready');await h.close();}
});
test('生成显示真实任务进度，忽略其他 ID，轮询不覆盖步数，成功与错误结束忙碌状态',async()=>{
  const h=await panelHarness();try{h.click('tab-t2i');h.holdCheck();h.click('generate');await new Promise(r=>setTimeout(r,30));assert.equal(h.el('task-progress').style.display,'block');assert.match(h.el('progress-label').textContent,/检查/);h.setJobStatus('queued');h.releaseCheck();await new Promise(r=>setTimeout(r,60));const id=h.posts[0].prompt_id;assert.match(h.el('progress-label').textContent,/排队/);assert.equal(h.el('progress-bar').getAttribute('value'),'0');h.setJobStatus('running');h.progress('00000000-0000-0000-0000-000000000000',10,25);assert.equal(h.el('progress-bar').getAttribute('value'),'0');h.progress(id,10,25);assert.equal(h.el('progress-bar').getAttribute('value'),'40');assert.match(h.el('progress-label').textContent,/10 \/ 25/);h.progress(id,NaN,0);assert.equal(h.el('progress-bar').getAttribute('value'),'40');await new Promise(r=>setTimeout(r,2100));assert.equal(h.el('progress-bar').getAttribute('value'),'40');assert.match(h.el('status').textContent,/10 \/ 25/);h.setJobStatus('ready');await h.wait();assert.equal(h.el('progress-bar').getAttribute('value'),'100');assert.equal(h.el('task-progress').getAttribute('aria-busy'),'false');h.el('count').value='0';h.click('generate');await new Promise(r=>setTimeout(r,50));assert.equal(h.el('task-progress').getAttribute('aria-busy'),'false');assert.equal(h.el('progress-bar').getAttribute('value'),'0');}finally{h.releaseCheck();h.setJobStatus('ready');await h.close();}
});
test('生成时显示实际范围，边距和保护变化后收起过期预览',async()=>{
  const h=await panelHarness();try{h.el('resolution').value='32';h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.el('selection-previews').style.display,'flex');assert.match(h.el('range-legend').textContent,/编辑.*保护.*上下文/);h.el('margin').value='50';h.change('margin');assert.equal(h.el('selection-previews').style.display,'none');h.click('capture');await new Promise(r=>setTimeout(r,40));assert.equal(h.el('selection-previews').style.display,'flex');h.click('clear-protection');await new Promise(r=>setTimeout(r,20));assert.equal(h.el('selection-previews').style.display,'none');}finally{await h.close();}
});
test('复用独立氛围素材历史时隐藏选区操作并保留应用位置',async()=>{
  const h=await panelHarness({uxpSelect:true});try{h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();const records=h.records();Object.assign(records[0].params as Record<string,unknown>,{workspace:'cosplay',mode:'atmosphere',destination:'document'});h.files['history.json']=JSON.stringify(records);h.click('repeat-history');await new Promise(r=>setTimeout(r,30));assert.equal(h.el('mode').value,'atmosphere');assert.equal(h.el('destination').value,'document');assert.equal(h.el('selection-tools').style.display,'none');}finally{await h.close();}
});
test('紧凑面板折叠配置和进阶参数，展开收起保留输入与模型',async()=>{
  const h=await panelHarness();try{assert.equal(h.el('settings-body').style.display,'none');assert.equal(h.el('advanced-body').style.display,'none');h.click('toggle-settings');assert.equal(h.el('settings-body').style.display,'block');h.el('seed').value='123';h.click('toggle-advanced');h.click('toggle-advanced');assert.equal(h.el('seed').value,'123');assert.equal(h.el('model-unet').value,defaultSettings().models.unet);}finally{await h.close();}
});
test('生图新文档隐藏选区辅助，切回局部编辑恢复；无候选时禁用应用',async()=>{
  const h=await panelHarness({uxpSelect:true});try{assert.equal(h.el('apply').disabled,true);h.click('tab-t2i');assert.equal(h.el('selection-tools').style.display,'none');assert.equal(h.el('prompt').getAttribute('placeholder'),'描述要生成的画面、主体与风格');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();assert.equal(h.el('apply').disabled,true);assert.equal(h.el('new-document').disabled,false);h.click('tab-local');assert.equal(h.el('selection-tools').style.display,'block');}finally{await h.close();}
});
test('UXP 动态模式下拉框显式选择默认项，生成后选中新历史行',async()=>{
  const h=await panelHarness({uxpSelect:true});try{assert.equal(h.el('mode').value,'edit');h.click('tab-t2i');assert.equal(h.el('mode').value,'generate');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();assert.equal(h.records().length,1);assert.equal(h.historySelectedId(),h.records()[0].id);}finally{await h.close();}
});
test('UXP 未交互的参考用途有有效默认项并保存到任务参数',async()=>{
  const h=await panelHarness({uxpSelect:true});try{assert.equal(h.el('usage').value,'服装');h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();assert.equal((h.records()[0].params as Record<string,unknown>).usage,'服装');}finally{await h.close();}
});
test('复用旧历史时缺失或非法参考用途保持有效默认项',async()=>{
  const h=await panelHarness({uxpSelect:true});try{h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();for(const usage of [undefined,'unknown']){const records=h.records();(records[0].params as Record<string,unknown>).usage=usage;h.files['history.json']=JSON.stringify(records);h.click('repeat-history');await new Promise(r=>setTimeout(r,30));assert.equal(h.el('usage').value,'服装');}}finally{await h.close();}
});
test('启动配置读取未完成时锁定保存和生成，旧读取不覆盖新配置',async()=>{
  const h=await panelHarness({delaySettings:true,settings:defaultSettings()});try{h.el('model-unet').value='new.gguf';h.click('save-settings');h.click('generate');await new Promise(r=>setTimeout(r,30));assert.equal(h.el('save-settings').disabled,true);assert.equal(JSON.parse(String(h.files['settings.json'])).models.unet,defaultSettings().models.unet);assert.equal(h.posts.length,0);h.releaseSettings();await new Promise(r=>setTimeout(r,70));assert.equal(h.el('save-settings').disabled,false);h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();assert.equal(h.posts.length,1);assert.equal(h.posts[0].prompt['1'].inputs.unet_name,defaultSettings().models.unet);}finally{h.releaseSettings();await h.close();}
});
test('无打开文档时文字生图仍可提交，不读取会抛错的 activeDocument',async()=>{
  const h=await panelHarness({noDocuments:true});try{h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();assert.equal(h.posts.length,1);assert.equal(h.records()[0].state,'ready');}finally{await h.close();}
});
test('保存的可迁移模型配置用于连接检查、提交图与历史',async()=>{
  const settings=defaultSettings();settings.models={unet:'custom/qwen.gguf',clip:'custom/clip.safetensors',vae:'custom/vae.safetensors'};
  const h=await panelHarness({settings,models:settings.models});try{h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();assert.equal(h.posts.length,1);assert.equal(h.posts[0].prompt['1'].inputs.unet_name,settings.models.unet);assert.deepEqual(h.records()[0].models,settings.models);}finally{await h.close();}
});
test('损坏配置阻止生成，显式保存有效配置后可继续',async()=>{
  const h=await panelHarness({settings:{schemaVersion:99}});try{assert.equal(h.el('setup-body').style.display,'block');h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,50));assert.equal(h.posts.length,0);assert.match(h.el('status').textContent,/配置|设置/);h.click('save-settings');await new Promise(r=>setTimeout(r,50));assert.equal(JSON.parse(String(h.files['settings.json'])).schemaVersion,1);h.click('generate');await new Promise(r=>setTimeout(r,80));await h.wait();assert.equal(h.posts.length,1);}finally{await h.close();}
});
test('UXP option.value 需要显式属性，默认分辨率可生成候选',async()=>{
  const h=await panelHarness({uxpSelect:true});try{h.click('tab-t2i');h.click('generate');await new Promise(r=>setTimeout(r,50));await h.wait();assert.equal(h.posts.length,1);assert.equal(h.posts[0].prompt['4'].inputs.resolution,992);assert.equal(h.records()[0].state,'ready');}finally{await h.close();}
});
test('连续点击生成时先锁定，再读取历史，仅有一个提交',async()=>{
  const h=await panelHarness();try{h.click('tab-t2i');h.holdHistory();h.click('generate');h.click('generate');await new Promise(r=>setTimeout(r,30));h.releaseHistory();await new Promise(r=>setTimeout(r,60));await h.wait();assert.equal(h.posts.length,1);assert.equal(h.records().length,1);}finally{h.releaseHistory();await h.close();}
});
test('点击生成后在服务检查阶段换文档，不捕获或提交新活动文档',async()=>{
  const h=await panelHarness();try{h.holdCheck();h.click('generate');await new Promise(r=>setTimeout(r,30));h.setDocument(22);h.releaseCheck();await new Promise(r=>setTimeout(r,60));await h.wait();assert.deepEqual(h.captured,[]);assert.equal(h.posts.length,0);assert.match(h.el('status').textContent,/文档/);}finally{h.releaseCheck();await h.close();}
});
test('历史检查尚未完成时取消，不提交后续 GPU 任务',async()=>{
  const h=await panelHarness();try{h.click('tab-t2i');h.holdHistory();h.click('generate');h.click('cancel');h.releaseHistory();await new Promise(r=>setTimeout(r,70));await h.wait();assert.equal(h.posts.length,0);}finally{h.releaseHistory();await h.close();}
});
