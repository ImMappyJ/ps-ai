import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings,validateSettings,validateModels} from '../src/infrastructure/config/profile';
import {decodePng} from '../src/imaging/image';
import * as panelView from '../src/app/panel-view';
import {setLanguage} from '../src/localization/i18n';
import {parseHTML} from 'linkedom';

test('bounded capture captions keep document, native write, work, model and export sizes distinct in both languages',()=>{
 const format=(panelView as any).captureSizeSummary;assert.equal(typeof format,'function');
 const sizes={documentWidth:9000,documentHeight:5000,nativeWidth:8000,nativeHeight:4000,workWidth:1024,workHeight:512,modelWidth:1408,modelHeight:704,outputWidth:1024,outputHeight:512};
 try{for(const language of ['zh-CN','en-US'] as const){setLanguage(language);const caption=format(sizes);for(const value of ['9000×5000','8000×4000','1024×512','1408×704'])assert.ok(caption.includes(value),caption);if(language==='en-US')assert.doesNotMatch(caption,/[一-龥]/);}}
 finally{setLanguage('zh-CN');}
});
test('Blend captions explain adaptive analysis separately from original-sized masks in both languages',()=>{
  const sizes={documentWidth:7008,documentHeight:4672,nativeWidth:7008,nativeHeight:4672,workWidth:900,workHeight:600,blendAnalysis:true};
  try{setLanguage('zh-CN');assert.match(panelView.captureSizeSummary(sizes),/溶图.*分析.*蒙版/);setLanguage('en-US');const text=panelView.captureSizeSummary(sizes);assert.match(text,/Blend.*analysis.*masks/);assert.doesNotMatch(text,/[一-龥]/);}finally{setLanguage('zh-CN');}
});

test('view transitions notify once for both navigation clicks and programmatic shows without remounting controls',()=>{
 const {document,window}=parseHTML('<button data-panel-nav="create"></button><button data-panel-nav="results"></button><div data-panel-page="create"><input id="draft" value="keep"></div><div data-panel-page="results"></div><div data-panel-page="history"></div>'),changes:string[]=[],views=new panelView.PanelViews(document,page=>changes.push(page)),draft=document.getElementById('draft');
 assert.deepEqual(changes,[]);document.querySelector('[data-panel-nav="results"]')!.dispatchEvent(new window.Event('click',{bubbles:true}));views.show('history');views.show('history');views.show('create');assert.deepEqual(changes,['results','history','create']);assert.equal(document.getElementById('draft'),draft);assert.equal(draft?.getAttribute('value'),'keep');
});

test('view navigation preserves mounted inputs and captured state without capture, persistence or requests',async()=>{
  const h=await panelHarness({settings:defaultSettings()});
  try{
    await h.wait();assert.ok(h.el('nav-results'),'the panel exposes presentation-only navigation');
    h.el('prompt').value='keep this unsaved prompt';h.el('seed').value='123';h.el('count').value='2';
    h.click('capture');await h.wait();
    const prompt=h.el('prompt'),mode=h.el('mode'),source=h.el('source-preview').src,captured=h.captured.length;
    const saved=String(h.files['settings.json']),trace=String(h.files['runtime-trace.json']);
    for(const view of ['results','history','settings','create','settings','results','create'])h.click('nav-'+view);
    assert.equal(h.el('view-create').style.display,'block');assert.equal(h.el('view-results').style.display,'none');
    assert.equal(h.el('nav-create').getAttribute('aria-selected'),'true');
    assert.equal(h.el('prompt'),prompt);assert.equal(h.el('mode'),mode);assert.equal(prompt.value,'keep this unsaved prompt');
    assert.equal(h.el('seed').value,'123');assert.equal(h.el('count').value,'2');assert.equal(mode.value,'edit');
    assert.equal(h.el('source-preview').src,source);assert.equal(h.el('selection-previews').style.display,'flex');
    assert.equal(h.captured.length,captured);assert.equal(h.uploads.length,0);assert.equal(h.posts.length,0);
    assert.equal(String(h.files['settings.json']),saved);assert.equal(String(h.files['runtime-trace.json']),trace);
    assert.equal(h.el('view-create').querySelectorAll('#prompt').length,1);
  }finally{await h.close();}
});

test('display previews ignore obsolete completions, bound fit caching and never cache full-size copies',async()=>{
  const Preview=(panelView as any).CandidatePreview;
  assert.equal(typeof Preview,'function','candidate display rendering has an independent lifecycle');
  const images=Array.from({length:6},(_,i)=>({width:1,height:1,rgba:new Uint8Array([i,0,0,255])}));
  const pending:Array<{resolve:(value:string)=>void;size:number;image:unknown}>=[];
  const preview=new Preview((image:unknown,size:number)=>new Promise<string>(resolve=>pending.push({resolve,size,image})));
  const displayed:string[]=[];
  const old=preview.show(images[0],false,(url:string)=>displayed.push(url));
  const latest=preview.show(images[1],false,(url:string)=>displayed.push(url));
  pending[1].resolve('latest');await latest;pending[0].resolve('old');await old;
  assert.deepEqual(displayed,['latest']);assert.equal(pending[0].size,1280);
  await preview.show(images[1],false,(url:string)=>displayed.push(url));assert.equal(pending.length,2,'reselecting a fit image reuses its display copy');
  for(let i=2;i<6;i++){const show=preview.show(images[i],false,()=>{});pending[pending.length-1].resolve(String(i));await show;}
  const firstAgain=preview.show(images[0],false,()=>{});assert.equal(pending.length,7,'an evicted candidate must render again');pending[6].resolve('new');await firstAgain;
  for(let i=0;i<2;i++){const full=preview.show(images[5],true,()=>{});pending[pending.length-1].resolve('full');await full;}
  assert.equal(pending.length,9,'full-size copies are not retained in the fit cache');assert.equal(pending[8].size,1);
});

test('8 and 16-bit display copies leave source pixels and encoded candidate bytes unchanged',async()=>{
  for(const values of [new Uint8Array([30,70,90,128,10,20,40,255]),new Uint16Array([12345,23456,34567,32768,100,200,300,65535])]){
    const image={width:2,height:1,rgba:values},pixels=values.slice();
    const {encodePng}=await import('../src/imaging/image'),before=encodePng(image);
    const url=await panelView.displayPreview(image,1280),display=decodePng(new Uint8Array(Buffer.from(url.split(',')[1],'base64')));
    assert.deepEqual(image.rgba,pixels);assert.deepEqual(encodePng(image),before);assert.equal(display.rgba[3],255);
    assert.ok(display.rgba instanceof Uint8Array);assert.equal(display.width,2);assert.equal(display.height,1);
  }
});

test('an obsolete display failure cannot replace a newer preview with an error',async()=>{
  const image={width:1,height:1,rgba:new Uint8Array([0,0,0,255])};
  let fail:(error:Error)=>void=()=>{};
  const preview=new panelView.CandidatePreview((_image,size)=>size===1280?new Promise<string>((_resolve,reject)=>{fail=reject;}):Promise.resolve('current'));
  const displayed:string[]=[],old=preview.show(image,false,url=>displayed.push(url));
  await preview.show(image,true,url=>displayed.push(url));fail(new Error('old preview failed'));
  await assert.doesNotReject(old);assert.deepEqual(displayed,['current']);
});

test('a current display failure remains visible to the caller and can be retried',async()=>{
  const image={width:1,height:1,rgba:new Uint8Array([0,0,0,255])};let attempts=0;
  const preview=new panelView.CandidatePreview(async()=>{if(++attempts===1)throw new Error('current preview failed');return 'retried';});
  await assert.rejects(preview.show(image,false,()=>{}),/current preview failed/);
  const displayed:string[]=[];await preview.show(image,false,url=>displayed.push(url));assert.deepEqual(displayed,['retried']);assert.equal(attempts,2);
});

test('navigation remains available during a task without unlocking inputs or restarting the task',async()=>{
  const h=await panelHarness({settings:defaultSettings()});
  try{
    await h.wait();assert.ok(h.el('nav-settings'),'the panel exposes settings navigation');
    h.el('resolution').value='32';h.holdCheck();h.click('generate');await new Promise(r=>setTimeout(r,30));
    for(const view of ['settings','history','results','create']){
      assert.equal(!!h.el('nav-'+view).disabled,false);h.click('nav-'+view);
      assert.equal(h.el('view-'+view).style.display,'block');assert.equal(h.el('nav-'+view).getAttribute('aria-selected'),'true');
      for(const id of ['generate','prompt','mode','language','save-settings','apply'])assert.equal(h.el(id).disabled,true,id);
      assert.equal(h.el('cancel').disabled,false);assert.equal(h.el('task-progress').getAttribute('aria-busy'),'true');
    }
    assert.equal(h.posts.length,0);assert.equal(h.captured.length,0);h.releaseCheck();await h.wait();
    assert.equal(h.posts.length,1);assert.equal(h.records().length,1);assert.equal(h.el('generate').disabled,false);
    assert.equal(h.el('nav-create').getAttribute('aria-selected'),'true');
  }finally{h.releaseCheck();await h.close();}
});

test('language round trips translate source labels while retaining reference, metadata and pixels',async()=>{
  const h=await panelHarness({settings:defaultSettings()});
  try{
    await h.wait();h.click('capture');await h.wait();
    const source=h.el('source-info').textContent,reference='fixture.png · 640×480 · sRGB 8-bit',pixels=h.el('source-preview').src,captured=h.captured.length;
    h.el('reference-info').textContent=reference;
    for(const language of ['en-US','zh-CN']){
      h.el('language').value=language;h.change('language');await h.wait();
      assert.equal(h.el('reference-info').textContent,reference);
      if(language==='en-US')assert.equal(h.el('source-info').textContent,'Document 11 · Area 2×2 · No protected area · sRGB IEC61966-2.1');
      else assert.equal(h.el('source-info').textContent,source);
      assert.equal(h.el('source-preview').src,pixels);assert.equal(h.captured.length,captured);
    }
    h.click('protect');await h.wait();const protectedCaptures=h.captured.length;
    h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('source-info').textContent,/Protected area saved/);
    h.click('clear-protection');await h.wait();assert.match(h.el('source-info').textContent,/Protection cleared/);
    h.el('language').value='zh-CN';h.change('language');await h.wait();assert.match(h.el('source-info').textContent,/保护区已清除/);
    h.change('margin');h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('source-info').textContent,/Range settings changed/);
    assert.equal(h.captured.length,protectedCaptures);
    assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('known local validation failures explain the correction in both languages without capture or requests',async()=>{
  const cases=[
    {name:'prompt',zh:'请描述希望生成或修改的内容',en:'Describe what to generate or change',prepare:(h:any)=>{h.el('prompt').value='';}},
    {name:'reference',zh:'角色参考辅助需要选择一张参考图',en:'Choose an image for character reference',prepare:(h:any)=>{h.click('tab-cosplay');h.el('mode').value='reference';h.change('mode');}},
    {name:'count',zh:'候选数量须为 1–4',en:'Candidate count must be 1–4',prepare:(h:any)=>{h.el('count').value='0';}},
    {name:'draft',zh:'后端配置已改变，请先保存并检查连接',en:'Backend settings changed. Save them and check the connection before generating.',prepare:(h:any)=>{h.el('backend-url').value='http://localhost:8199';}}
  ];
  for(const language of ['zh-CN','en-US'] as const)for(const fixture of cases){
    const h=await panelHarness({settings:{...defaultSettings(),language}});
    try{
      await h.wait();fixture.prepare(h);h.click('generate');await h.wait();
      assert.equal(h.el('diagnostic-box').style.display,'block',fixture.name);
      assert.ok(h.el('diagnostic-summary').textContent.includes(language==='en-US'?fixture.en:fixture.zh),fixture.name+' explains the actionable reason');
      assert.doesNotMatch(h.el('diagnostic-summary').textContent,/原因尚未确认|cause is not yet known/i);
      assert.equal(h.el('diagnostic-details').style.display,'none');assert.equal(h.captured.length,0);
      assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);assert.equal(h.uploads.length,0);
    }finally{await h.close();}
  }
});

test('invalid origins and addresses remain actionable on Save in both languages without saving or uploading',async()=>{
  const fixtures=[
    {url:'http://localhost:8188/api',zh:'请输入 HTTP(S) 服务根地址，例如 http://localhost:8188；不要包含路径、密码或查询参数',en:'Enter an HTTP(S) origin, e.g. http://localhost:8188, without a path, password or query string.'},
    {url:'http://[1:2:3]:8188',zh:'IPv6 地址无效',en:'Invalid IPv6 address'},
    {url:'http://a..b:8188',zh:'主机地址无效',en:'Invalid hostname'},
    {url:'http://localhost:65536',zh:'端口须为 1–65535',en:'Port must be 1–65535'}
  ];
  for(const language of ['zh-CN','en-US'] as const)for(const fixture of fixtures){
    const h=await panelHarness({settings:{...defaultSettings(),language}});
    try{
      await h.wait();const saved=String(h.files['settings.json']);h.click('nav-settings');h.click('toggle-settings');
      h.el('backend-url').value=fixture.url;h.click('save-settings');await h.wait();
      assert.equal(h.el('diagnostic-box').style.display,'block');
      assert.ok(h.el('diagnostic-summary').textContent.includes(language==='en-US'?fixture.en:fixture.zh),fixture.url);
      assert.doesNotMatch(h.el('diagnostic-summary').textContent,/原因尚未确认|cause is not yet known/i);
      assert.equal(h.el('diagnostic-details').style.display,'none');assert.equal(String(h.files['settings.json']),saved);
      assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.captured.length,0);
    }finally{await h.close();}
  }
});

test('local configuration and bounded model validation produce translated display reasons without exposing input text',()=>{
  const fixtures=[
    {value:null,zh:'设置无效',en:'Invalid settings'},
    {value:{...defaultSettings(),schemaVersion:99},zh:'不支持的设置版本，请重新保存配置',en:'Unsupported settings version. Save the settings again.'},
    {value:{...defaultSettings(),language:'unknown'},zh:'不支持的界面语言',en:'Unsupported interface language'},
    {value:{...defaultSettings(),outputDepth:32},zh:'输出位深须为 8 或 16',en:'Output depth must be 8 or 16'},
    {value:{...defaultSettings(),backend:'unknown'},zh:'不支持的后端类型',en:'Unsupported backend type'},
    {value:{...defaultSettings(),models:null},zh:'模型映射无效',en:'Invalid model mapping'},
    {value:{...defaultSettings(),platform:'unknown'},zh:'平台配置需要对应的本机适配地址',en:'This platform requires its own local relay address.'},
    {value:{...defaultSettings(),backend:'gateway',outputDepth:16},zh:'平台后端仅支持 8 位输出；16 位请切回 ComfyUI',en:'The gateway supports 8-bit output only. Use ComfyUI for 16-bit.'},
    {value:{...defaultSettings(),gatewayModel:'bad model'},zh:'平台模型 ID 无效',en:'Invalid platform model ID'},
    {value:{...defaultSettings(),connections:[]},zh:'平台配置无效',en:'Invalid platform profile.'}
  ];
  const modelFixtures=[
    {field:'unet',extension:'.gguf / .safetensors',en:'Model unet needs a relative .gguf / .safetensors filename from the backend search paths'},
    {field:'clip',extension:'.safetensors',en:'Model clip needs a relative .safetensors filename from the backend search paths'},
    {field:'vae',extension:'.safetensors',en:'Model vae needs a relative .safetensors filename from the backend search paths'}
  ];
  try{
    for(const language of ['zh-CN','en-US'] as const){
      setLanguage(language);
      for(const fixture of fixtures)assert.throws(()=>validateSettings(fixture.value),(error:any)=>{
        assert.equal(error.message,fixture.zh);assert.equal(panelView.localValidationMessage(error.message),language==='en-US'?fixture.en:fixture.zh);return true;
      });
      for(const fixture of modelFixtures)assert.throws(()=>validateModels({...defaultSettings().models,[fixture.field]:'../private-fixture.txt'}),(error:any)=>{
        const zh=`模型 ${fixture.field} 需要后端搜索目录中的相对 ${fixture.extension} 文件名`;
        assert.equal(error.message,zh);assert.equal(panelView.localValidationMessage(error.message),language==='en-US'?fixture.en:zh);
        assert.equal(panelView.localValidationMessage(fixture.en),language==='en-US'?fixture.en:zh);return true;
      });
      for(const unknown of ['模型 private-token 需要后端搜索目录中的相对 .gguf 文件名','模型 clip 需要后端搜索目录中的相对 .gguf 文件名','模型 unet 需要后端搜索目录中的相对 .exe 文件名','模型 unet 需要后端搜索目录中的相对 .gguf 文件名\nprivate-token','Provider error: Invalid hostname','C:\\private\\host-error'])assert.equal(panelView.localValidationMessage(unknown),undefined);
    }
  }finally{setLanguage('zh-CN');}
});

test('unknown failures show their safe cause and technical details copies a redacted report',async()=>{
  const h=await panelHarness({settings:defaultSettings()});
  try{
    await h.wait();h.click('tab-t2i');
    const technical='Synthetic storage failure at C:\\fixture\\private-token-'+('x'.repeat(1500));
    Object.defineProperty(h.files,'history.json',{get:()=>{throw new Error(technical);},configurable:true,enumerable:true});
    h.click('generate');await h.wait();
    assert.equal(h.el('status').style.display,'none','raw error text does not compete with classified guidance');
    assert.equal(h.el('task-progress').style.display,'none','a failed task does not repeat its raw error in the progress label');
    assert.match(h.el('diagnostic-summary').textContent,/Synthetic storage failure/);assert.match(h.el('diagnostic-action').textContent,/技术详情/);
    assert.equal(h.el('diagnostic-details').style.display,'none');assert.doesNotMatch(h.el('status').textContent,/private-token|C:\\fixture/);
    assert.doesNotMatch(h.el('diagnostic-summary').textContent,/private-token|C:\\fixture/);
    h.click('toggle-error-details');await h.wait();assert.equal(h.el('diagnostic-details').style.display,'none');assert.equal(h.clipboardWrites.length,1);assert.match(h.clipboardWrites[0],/Synthetic storage failure/);assert.doesNotMatch(h.clipboardWrites[0],/private-token|C:\\fixture/);
    delete h.files['history.json'];h.click('generate');await h.wait();
    assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.el('status').style.display,'block');
  }finally{await h.close();}
});

test('candidate selection is numbered and explicit while display navigation leaves export bytes intact',async()=>{
  const output={width:640,height:320,rgba:Uint8Array.from({length:640*320*4},(_,i)=>[30,90,180,255][i%4])};
  const h=await panelHarness({settings:defaultSettings(),output});
  try{
    await h.wait();h.click('tab-t2i');h.el('count').value='2';h.click('generate');await h.wait();
    assert.ok(h.el('candidate-caption'),'a preview identifies its selected candidate');
    assert.match(h.el('candidate-caption').textContent,/1 \/ 2/);
    const buttons=h.el('candidates').querySelectorAll('button');assert.equal(buttons.length,2);assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
    buttons[1].dispatchEvent(new (h.el('prompt').ownerDocument.defaultView!.Event)('click'));await h.wait();
    assert.equal(buttons[1].getAttribute('aria-pressed'),'true');assert.match(buttons[1].textContent,/2/);
    const display=decodePng(new Uint8Array(Buffer.from(h.el('detail-preview').src.split(',')[1],'base64')));
    assert.equal(display.width,640,'the fit preview is independent of the 240px thumbnail');assert.equal(display.height,320);
    h.click('export');await h.wait();const record=h.records()[0],name='ps-ai-'+record.id.slice(0,8)+'.png';
    const before=new Uint8Array(h.files[name] as Uint8Array);
    for(const view of ['settings','history','create','results'])h.click('nav-'+view);
    h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('nav-results').getAttribute('aria-selected'),'true');assert.match(h.el('candidate-caption').textContent,/2 \/ 2/);
    h.click('zoom');await h.wait();h.click('zoom');await h.wait();h.click('export');await h.wait();
    assert.deepEqual(h.files[name],before);assert.deepEqual(decodePng(h.files[name] as Uint8Array).rgba,output.rgba);
    buttons[0].dispatchEvent(new (h.el('prompt').ownerDocument.defaultView!.Event)('click'));await h.wait();
    assert.equal(h.el('candidate-select').value,'0');assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
    assert.equal(buttons[1].getAttribute('aria-pressed'),'false');assert.match(h.el('candidate-caption').textContent,/1 \/ 2/);
  }finally{await h.close();}
});

test('candidate cards keep images outside native button subtrees and use a text-only selection button',async()=>{
  const h=await panelHarness({settings:defaultSettings()});
  try{
    await h.wait();h.click('tab-t2i');h.el('count').value='2';h.click('generate');await h.wait();
    const cards=Array.from(h.el('candidates').children) as HTMLElement[];assert.equal(cards.length,2);
    for(const card of cards){
      const img=card.querySelector('img')!;assert.ok(img);
      assert.equal(img.closest('button')===null,true,'native candidate images must not be descendants of BUTTON');
      assert.equal(card.tagName,'DIV');
      const button=card.querySelector('button')!;assert.ok(button,'each image has a sibling keyboard-accessible native selection button');
      assert.equal(img.parentElement,card);assert.equal(button.parentElement,card);
      assert.equal(button.children.length,0,'native selection buttons contain text only');
      const number=String(Number(card.getAttribute('data-candidate-index'))+1);
      assert.equal(button.textContent,number,'narrow native buttons keep the candidate number visible');
      assert.equal(button.getAttribute('aria-label'),'候选 '+number);
      const status=card.querySelector('.candidate-status')!;assert.ok(status,'selected status has an independent ordinary text node');
      assert.equal(status.tagName,'SPAN');assert.equal(status.parentElement,card);
      assert.equal(status.closest('button')===null,true,'native candidate status must stay outside BUTTON');
      assert.equal(status.textContent,card.classList.contains('selected')?' · 已选中':'');
      assert.equal(button.getAttribute('aria-pressed'),card.classList.contains('selected')?'true':'false');
    }
  }finally{await h.close();}
});

test('candidate image and selection-button clicks select once through the same busy guard',async()=>{
  const h=await panelHarness({settings:defaultSettings()});
  try{
    await h.wait();h.click('tab-t2i');h.el('count').value='2';h.click('generate');await h.wait();
    const images=h.el('candidates').querySelectorAll('img'),buttons=h.el('candidates').querySelectorAll('button'),statuses=h.el('candidates').querySelectorAll('.candidate-status'),select=h.el('candidate-select');
    assert.equal(statuses.length,2,'each candidate has an independent selected-status label');
    const native=Object.getOwnPropertyDescriptor(select,'value')!;assert.ok(native.get&&native.set);let selections=0;
    Object.defineProperty(select,'value',{configurable:true,get:()=>native.get!.call(select),set:(value:string)=>{selections++;native.set!.call(select,value);}});
    const click=(node:HTMLElement)=>node.dispatchEvent(new (h.el('prompt').ownerDocument.defaultView!.Event)('click',{bubbles:true}));
    try{
      selections=0;click(images[0]);await h.wait();assert.equal(select.value,'0');assert.equal(selections,1,'an image click activates only once');
      assert.match(h.el('candidate-caption').textContent,/1 \/ 2/);assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
      assert.equal(statuses[0].textContent,' · 已选中');assert.equal(statuses[1].textContent,'');
      selections=0;click(buttons[1]);await h.wait();assert.equal(select.value,'1');assert.equal(selections,1,'a button click does not activate a parent handler again');
      assert.match(h.el('candidate-caption').textContent,/2 \/ 2/);assert.equal(buttons[1].getAttribute('aria-pressed'),'true');
      assert.equal(statuses[0].textContent,'');assert.equal(statuses[1].textContent,' · 已选中');
      for(const language of ['en-US','zh-CN']){
        h.el('language').value=language;h.change('language');await h.wait();
        assert.equal(buttons[0].textContent,'1');assert.equal(buttons[1].textContent,'2');
        assert.equal(buttons[0].getAttribute('aria-label'),language==='en-US'?'Candidate 1':'候选 1');
        assert.equal(buttons[1].getAttribute('aria-label'),language==='en-US'?'Candidate 2':'候选 2');
        assert.equal(statuses[0].textContent,'');assert.equal(statuses[1].textContent,language==='en-US'?' · Selected':' · 已选中');
      }
      h.holdHistory();h.click('generate');await new Promise(r=>setTimeout(r,30));selections=0;
      assert.equal(buttons[0].disabled,true);assert.equal(buttons[1].disabled,true);
      click(images[0]);click(buttons[0]);await new Promise(r=>setTimeout(r,10));assert.equal(select.value,'1');assert.equal(selections,0,'both pointer paths remain blocked even for directly dispatched events');
      h.click('cancel');h.releaseHistory();await h.wait();assert.equal(h.posts.length,2,'the cancelled busy fixture adds no inference request');
    }finally{Object.defineProperty(select,'value',native);}
  }finally{h.releaseHistory();await h.close();}
});


test('a disabled retry does not clear an unresolved error or supersede the running capture owner',async()=>{
 const h=await panelHarness();try{
  await h.wait();h.click('nav-create');h.setSelection({bounds:null as any,mask:new Uint8Array(4)});h.click('capture');await h.wait();const failed=h.el('diagnostic-box').getAttribute('data-operation-id');
  h.holdCheck();h.click('connect');await new Promise(r=>setTimeout(r,30));h.click('nav-create');assert.equal(h.el('capture').disabled,true);h.click('capture');await new Promise(r=>setTimeout(r,20));
  assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(h.el('diagnostic-box').getAttribute('data-operation-id'),failed);
  h.releaseCheck();await h.wait();assert.equal(h.el('diagnostic-box').style.display,'block');assert.equal(h.posts.length,0);
 }finally{h.releaseCheck();await h.close();}
});
