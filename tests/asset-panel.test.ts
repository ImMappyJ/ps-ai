import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {decodePng} from '../src/imaging/image';

const output={width:32,height:32,rgba:Uint8Array.from({length:32*32*4},(_,i)=>[40,100,230,128][i%4])};
function asset(h:Awaited<ReturnType<typeof panelHarness>>){h.click('tab-cosplay');h.el('asset-input').value='selection-v1';h.change('asset-input');h.el('resolution').value='32';}

test('reloading the same subject asset in composite view never waits on its own pixel queue',async()=>{
  const h=await panelHarness({output});try{
    await h.wait();h.click('tab-cosplay');h.el('resolution').value='32';h.click('generate');await h.wait();
    const record=h.records()[0];h.el('asset-preview-view').value='composite';h.change('asset-preview-view');await h.wait();
    h.selectHistory(record.id);h.click('load-history');await h.wait();
    assert.equal(h.el('generate').disabled,false);assert.equal(h.el('detail-frame').getAttribute('aria-busy'),'false');assert.equal(h.posts.length,1);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('asset preview dropdown refreshes its native caption when language changes',async()=>{
  const h=await panelHarness({uxpSelect:true,output});try{
    await h.wait();h.click('tab-cosplay');
    for(const [control,value] of [['asset-preset','objects'],['asset-scope','context'],['asset-occlusion','front'],['asset-preview-view','raw']])assert.equal(h.el(control).value,value);
    h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('asset-preview-view').displayedCaption,'Asset only · inspect transparency and remnants');
    h.el('resolution').value='32';h.click('generate');await h.wait();assert.equal(h.posts.length,1,JSON.stringify(h.errors));
  }finally{await h.close();}
});

test('large RGB16 subject assets keep behind masks through disk history and native strip application',{timeout:60000},async()=>{
  const h=await panelHarness({output});try{
    await h.wait();const doc=h.ps.app.activeDocument;doc.width=6000;doc.height=3000;doc.bitsPerChannel=16;
    Object.defineProperty(doc,'selection',{get:()=>({bounds:{left:2000,top:0,right:4000,bottom:3000}}),configurable:true});
    h.ps.imaging.getSelection=async(options:any)=>{const bounds=options.sourceBounds,width=bounds.right-bounds.left,height=bounds.bottom-bounds.top;return {sourceBounds:bounds,imageData:{width,height,components:1,componentSize:8,getData:async()=>new Uint8Array(width*height).fill(128),dispose(){}}};};
    h.ps.imaging.getPixels=async(options:any)=>{const bounds=options.sourceBounds,width=options.targetSize?.width??bounds.right-bounds.left,height=options.targetSize?.height??bounds.bottom-bounds.top;assert.ok(options.targetSize||width*height<=262144);const values=new Uint16Array(width*height*4).fill(65535);values[0]=12345;return {sourceBounds:bounds,imageData:{width,height,components:4,componentSize:16,getData:async()=>values,dispose(){}}};};
    h.click('tab-cosplay');h.el('asset-scope').value='document';h.change('asset-scope');h.el('asset-occlusion').value='behind';h.change('asset-occlusion');h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.posts.length,1,JSON.stringify(h.errors));const record=h.records()[0];assert.equal((record.snapshot as any).captureGeometry.kind,'edit-analysis');
    const source=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);assert.ok(source.rgba instanceof Uint16Array);assert.equal(source.rgba[0],12345);
    const mask=h.files[`${record.id}-mask.bin`] as Uint8Array;assert.equal(mask.length,18_000_000);assert.equal(mask[0],255);assert.equal(mask[2000],127);assert.equal(mask[4000],255);
    h.selectHistory(record.id);h.click('load-history');await h.wait();
    let strips=0,writtenPixels=0;h.ps.imaging.putPixels=async(options:any)=>{strips++;assert.equal(options.imageData.values.BYTES_PER_ELEMENT,2);assert.equal(options.imageData.fullRange,true);};
    h.ps.imaging.putLayerMask=async(options:any)=>{const values=options.imageData.values;writtenPixels+=values.length;for(let offset=0;offset<values.length;offset++)assert.equal(values[offset],(offset%6000>=2000&&offset%6000<4000?127:255)*257);};
    h.click('apply');await h.wait();assert.equal(h.errors.length,0,h.el('diagnostic-details').value);assert.equal(h.appliedLayers.length,1);assert.ok(strips>1);assert.equal(writtenPixels,18_000_000);assert.equal(h.posts.length,1);assert.equal(h.uploads.length,3);
  }finally{await h.close();}
});

for(const occlusion of ['front','behind'])test(`subject asset defaults separate reference from ${occlusion} placement and preserve saved masks`,async()=>{
  const source={width:2,height:2,rgba:new Uint8Array([200,80,40,255,200,80,40,255,200,80,40,255,200,80,40,255])};
  const h=await panelHarness({source,output,selection:{bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([0,255,128,0])}});
  try{
    await h.wait();h.click('tab-cosplay');assert.equal(h.el('asset-input').value,'subject-v1');
    assert.equal([...h.el('mode').options].some((option:any)=>option.value==='atmosphere'),false);
    h.el('asset-occlusion').value=occlusion;h.change('asset-occlusion');h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.posts.length,1,JSON.stringify(h.errors));assert.equal(h.uploads.length,3);
    const record=h.records()[0],params=record.params as any,expected=occlusion==='front'?[255,255,255,255]:[255,0,127,255];
    assert.equal(params.assetContext,'subject-v1');assert.deepEqual(params.assetPlacement,{version:'subject-v1',scope:'context',occlusion});
    assert.deepEqual([...h.files[`${record.id}-mask.bin`] as Uint8Array],expected);
    assert.deepEqual([...h.files[`${record.id}-subject-mask.bin`] as Uint8Array],[0,255,128,0]);
    assert.equal(h.uploads[1].image.rgba[0],0);assert.equal(h.uploads[2].image.rgba[0],255);
    const rawPreview=h.el('detail-preview').src;h.el('asset-preview-view').value='composite';h.change('asset-preview-view');await h.wait();assert.notEqual(h.el('detail-preview').src,rawPreview);assert.equal(h.posts.length,1);
    h.click('export');await h.wait();assert.deepEqual(decodePng(h.files[`ps-ai-${record.id.slice(0,8)}.png`] as Uint8Array),output);
    const masks:any[]=[];h.ps.imaging.putLayerMask=async(value:any)=>{masks.push(value);};
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.deepEqual([...masks[0].imageData.values],expected);
    h.selectHistory(record.id);h.click('repeat-history');await h.wait();assert.equal(h.el('asset-input').value,'subject-v1');assert.equal(h.el('asset-occlusion').value,occlusion);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

for(const mode of ['effect'])for(const destination of ['selection','document'])test(`${mode} legacy input retains current visible source and mandatory effective guide for ${destination} output`,async()=>{
  const h=await panelHarness({source:{width:2,height:2,rgba:new Uint16Array([12345,23456,34567,65534,12000,24000,36000,32768,15000,25000,35000,65535,10000,20000,30000,65535])},output});
  try{
    await h.wait();h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([0,128,0,255])});h.click('protect');await h.wait();
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,64,255])});
    asset(h);h.el('mode').value=mode;h.change('mode');h.el('guide').checked=false;h.el('destination').value=destination;h.change('destination');h.el('resolution').value='32';
    const prompt='  电弧 <image9> original  ';h.el('prompt').value=prompt;h.click('generate');await h.wait();
    assert.equal(h.posts.length,1);assert.equal(h.uploads.length,2);
    const record=h.records()[0],params=record.params as any;assert.equal(record.state,'ready');assert.equal(record.userPrompt,prompt);
    assert.equal(params.assetContext,'selection-v1');assert.equal(params.outputKind,'asset');assert.equal(params.destination,destination);assert.deepEqual(params.modelSize,{width:32,height:32});
    assert.equal(params.guide,true);for(const key of ['preserveAlpha','alignSubject','matchColor'])assert.equal(params[key],false);
    assert.deepEqual([...h.files[`${record.id}-subject-mask.bin`] as Uint8Array],[255,128,64,255]);assert.deepEqual([...h.files[`${record.id}-protection-mask.bin`] as Uint8Array],[0,128,0,255]);assert.deepEqual([...h.files[`${record.id}-mask.bin`] as Uint8Array],[255,64,64,0]);
    const saved=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);assert.ok(saved.rgba instanceof Uint16Array);assert.equal(saved.rgba[0],12345);assert.equal(saved.rgba[3],65534);
    const [source,guide]=h.uploads;assert.match(source.name,/-source.png$/);assert.match(guide.name,/-guide.png$/);assert.ok(source.image.rgba instanceof Uint8Array);assert.equal(source.image.width,guide.image.width);assert.equal(source.image.height,guide.image.height);
    assert.equal(guide.image.rgba[0],255);assert.equal(guide.image.rgba[(31*32+31)*4],0);assert.equal(h.posts[0].prompt['10'].inputs.image,'ps-ai/'+guide.name);
    assert.match(h.posts[0].prompt['4'].inputs.prompt,/独立可合成/);assert.equal(h.el('selection-tools').style.display,'block');
    assert.equal(h.errors.length,0);assert.doesNotMatch(String(h.files['runtime-trace.json']),/电弧|<image9>/);
  }finally{await h.close();}
});

test('default selection assets reject missing source even when output is a new document',async()=>{
  const h=await panelHarness({noDocuments:true});try{
    await h.wait();h.click('tab-cosplay');h.el('destination').value='document';h.change('destination');h.click('generate');await h.wait();
    assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.records().length,0);assert.match(h.el('status').textContent,/文档.*选区/);
  }finally{await h.close();}
});

test('selection assets reject absent selection and completely protected ranges without reusing a preview',async()=>{
  for(const failure of ['missing','protected','capture']){
    const h=await panelHarness({output});try{
      await h.wait();asset(h);h.click('capture');await h.wait();
      if(failure==='missing')h.setSelection({bounds:null as any,mask:new Uint8Array(4)});
      else if(failure==='protected'){h.click('protect');await h.wait();}
      else h.ps.imaging.getPixels=async()=>{throw new Error('Pixel read failed');};
      h.click('generate');await h.wait();assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.records().length,0);assert.equal(h.el('selection-previews').style.display,'none');assert.equal(h.errors.length,1);
    }finally{await h.close();}
  }
});

test('selection asset source changes during uploads prevent submission',async()=>{
  const h=await panelHarness({output});try{
    await h.wait();asset(h);const doc=h.ps.app.activeDocument;
    Object.defineProperty(doc,'activeHistoryState',{get:()=>({id:h.uploads.length>=2?2:1}),configurable:true});
    h.click('generate');await h.wait();assert.equal(h.uploads.length,2);assert.equal(h.posts.length,0);assert.equal(h.records().length,0);assert.match(h.el('status').textContent,/来源.*改变/);
  }finally{await h.close();}
});

test('cancel before selection asset capture discards the previous preview and the next attempt rereads visible pixels',async()=>{
  const source={width:2,height:2,rgba:new Uint8Array(16).fill(255)},h=await panelHarness({source,output});try{
    await h.wait();asset(h);h.click('capture');await h.wait();h.holdCheck();h.click('generate');
    for(let i=0;i<100&&!h.requests.some(r=>r.url.endsWith('/system_stats'));i++)await new Promise(r=>setTimeout(r,5));
    h.click('cancel');h.releaseCheck();await h.wait();assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.el('selection-previews').style.display,'none');
    source.rgba[0]=20;source.rgba[1]=40;source.rgba[2]=60;h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.deepEqual([...h.uploads[0].image.rgba.slice(0,3)],[20,40,60]);
  }finally{h.releaseCheck();await h.close();}
});

test('marked small asset application rereads original raw output and exact UUID masks instead of cached candidate pixels',async()=>{
  for(const damaged of ['raw','mask']){
    const h=await panelHarness({output});try{
      await h.wait();asset(h);h.click('generate');await h.wait();const record=h.records()[0];assert.equal(record.state,'ready');
      if(damaged==='raw')h.files[record.outputFile as string]=new Uint8Array([0]);else delete h.files[`${record.id}-subject-mask.bin`];
      h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,1);assert.ok(h.errors.length);assert.ok(h.fileReads.includes(record.outputFile as string));
    }finally{await h.close();}
  }
});

for(const bounded of [false,true])test(`selection asset ${bounded?'bounded':'small'} apply preserves model alpha and writes the native effective mask once`,async()=>{
  const source={width:2,height:2,rgba:new Uint8Array([200,80,40,128,90,110,130,255,40,50,60,64,80,90,100,255])},h=await panelHarness({source,output});try{
    await h.wait();h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([0,128,0,255])});h.click('protect');await h.wait();
    h.setSelection({bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,64,255])});asset(h);h.click('generate');await h.wait();
    const record=h.records()[0];if(bounded){const records=h.records();Object.assign(records[0].snapshot as any,{captureGeometry:{kind:'edit-analysis',width:2,height:2},requiresClipping:false});h.files['history.json']=JSON.stringify(records);await h.refreshHistory();h.selectHistory(record.id);h.click('load-history');await h.wait();}
    const pixels:any[]=[],masks:any[]=[];h.ps.imaging.putPixels=async(value:any)=>{pixels.push(value);};h.ps.imaging.putLayerMask=async(value:any)=>{masks.push(value);};
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.equal(pixels.length,1);assert.equal(masks.length,1);assert.deepEqual([...masks[0].imageData.values],[255,64,64,0]);
    assert.deepEqual([...pixels[0].imageData.values],[40,100,230,128,40,100,230,128,40,100,230,128,40,100,230,128]);assert.equal(h.appliedLayers[0].layer.isClippingMask,false);
    assert.equal(h.posts.length,1);assert.equal(h.errors.length,0);assert.ok(h.fileReads.includes(record.outputFile as string));
  }finally{await h.close();}
});

test('opaque marked assets retain raw export and explicitly refuse application',async()=>{
  const h=await panelHarness({output:{width:32,height:32,rgba:new Uint8Array(32*32*4).fill(255)}});try{
    await h.wait();asset(h);h.click('generate');await h.wait();const record=h.records()[0];assert.equal(record.state,'ready');assert.equal(h.el('apply').disabled,true);assert.match(h.el('candidate-warning').textContent,/没有透明部分/);
    h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('candidate-warning').textContent,/has no transparency/);
    h.click('export');await h.wait();assert.ok(h.files[`ps-ai-${record.id.slice(0,8)}.png`]);h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('recovering a marked asset queries its original UUID and preserves frozen source parameters without a new POST',async()=>{
  const h=await panelHarness({output});try{
    await h.wait();asset(h);h.click('generate');await h.wait();const records=h.records(),record=records[0],params=structuredClone(record.params);record.state='unknown';h.files['history.json']=JSON.stringify(records);await h.refreshHistory();h.selectHistory(record.id);h.click('recover');await h.wait();
    assert.equal(h.posts.length,1);assert.equal(h.records()[0].id,record.id);assert.equal(h.records()[0].state,'ready');assert.deepEqual(h.records()[0].params,params);assert.ok(h.requests.some(r=>r.url.endsWith(`/history/${record.id}`)));
  }finally{await h.close();}
});

test('selection asset preview displays the same source grid and grayscale placement guide that are uploaded',async()=>{
  const h=await panelHarness({output,selection:{bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,64,0])}});try{
    await h.wait();asset(h);h.el('destination').value='document';h.change('destination');h.click('capture');await h.wait();
    const fromPreview=(id:string)=>decodePng(new Uint8Array(Buffer.from(h.el(id).src.split(',')[1],'base64'))),source=fromPreview('source-preview'),guide=fromPreview('mask-preview');
    assert.equal(source.width,32);assert.equal(guide.width,32);assert.equal(h.el('restore-selection').style.display,'block');assert.match(h.el('source-info').textContent,/32×32/);
    h.click('generate');await h.wait();assert.deepEqual(guide.rgba,h.uploads[1].image.rgba);assert.deepEqual(source.rgba,h.uploads[0].image.rgba);
  }finally{await h.close();}
});

test('explicit text assets use no current pixels and visibly offer only independent output',async()=>{
  const h=await panelHarness({noDocuments:true,output});try{
    await h.wait();asset(h);assert.ok(h.el('asset-input'),'Explicit asset input control is required');h.el('asset-input').value='text';h.change('asset-input');
    assert.equal(h.el('destination').value,'document');assert.equal(h.el('destination').disabled,true);assert.equal(h.el('selection-tools').style.display,'none');assert.match(h.el('asset-input-help').textContent,/不读取当前图片/);
    h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.captured.length,0);assert.equal(h.pixelRequests.length,0);assert.equal(h.uploads.length,0);assert.equal(h.records()[0].snapshot,undefined);assert.equal((h.records()[0].params as any).assetContext,undefined);
  }finally{await h.close();}
});

test('asset input and destination remain separate choices and language changes preserve literal prompt and input',async()=>{
  const h=await panelHarness({uxpSelect:true,output});try{
    await h.wait();asset(h);assert.ok(h.el('asset-input'));assert.equal(h.el('asset-input').value,'selection-v1');assert.equal(h.el('destination').disabled,false);assert.equal(h.el('toggle-reference').parentElement.style.display,'none');
    h.el('destination').value='document';h.change('destination');assert.equal(h.el('asset-input').value,'selection-v1');assert.equal(h.el('selection-tools').style.display,'block');assert.match(h.el('asset-input-help').textContent,/残留来源人物/);
    h.el('prompt').value='  原始 <image9> 提示  ';h.el('language').value='en-US';h.change('language');await h.wait();assert.equal(h.el('asset-input').value,'selection-v1');assert.equal(h.el('asset-input').displayedCaption,'Reference current image and selection');assert.equal(h.el('prompt').value,'  原始 <image9> 提示  ');assert.match(h.el('asset-input-help').textContent,/source people, background or guide/);
    h.el('asset-input').value='text';h.change('asset-input');h.el('mode').value='costume';h.change('mode');assert.equal(h.el('asset-input-group').style.display,'none');assert.equal(h.el('destination').disabled,false);assert.equal(h.el('toggle-reference').parentElement.style.display,'block');
    for(const id of ['preserve-alpha','align-subject'])assert.equal(h.el(id).checked,true);
  }finally{await h.close();}
});

test('selection assets can place an effect in a transparent selected pixel while keeping visible context as the actual input',async()=>{
  const source={width:4,height:4,rgba:Uint8Array.from({length:4*4*4},(_,i)=>[190,80,40,255][i%4])};source.rgba[(1*4+1)*4+3]=0;
  const h=await panelHarness({source,output,selection:{bounds:{left:1,top:1,right:2,bottom:2},mask:new Uint8Array([0,0,0,0,0,128,0,0,0,0,0,0,0,0,0,0])}});try{
    await h.wait();asset(h);h.el('margin').value='100';h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.uploads.length,2);const record=h.records()[0],saved=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);
    assert.equal(saved.width,4);assert.equal(saved.height,4);assert.equal(saved.rgba[(1*4+1)*4+3],0);assert.equal(saved.rgba[3],255);assert.deepEqual([...saved.rgba.slice(0,3)],[190,80,40]);assert.equal((h.files[`${record.id}-mask.bin`] as Uint8Array)[5],128);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('large selection assets keep asset kind and marker through bounded capture preflight and native-plane persistence',async()=>{
  const h=await panelHarness({output});try{
    await h.wait();asset(h);const doc=h.ps.app.activeDocument;doc.width=6000;doc.height=3000;Object.defineProperty(doc,'selection',{get:()=>({bounds:{left:0,top:0,right:6000,bottom:3000}}),configurable:true});
    h.ps.imaging.getSelection=async(o:any)=>{const b=o.sourceBounds,width=b.right-b.left,height=b.bottom-b.top;return {sourceBounds:b,imageData:{width,height,components:1,componentSize:8,getData:async()=>new Uint8Array(width*height).fill(255),dispose(){}}};};
    h.ps.imaging.getPixels=async(o:any)=>{const b=o.sourceBounds,width=o.targetSize?.width??b.right-b.left,height=o.targetSize?.height??b.bottom-b.top;assert.ok(o.targetSize||width*height<=262144);return {sourceBounds:b,imageData:{width,height,components:4,componentSize:8,getData:async()=>new Uint8Array(width*height*4).fill(255),dispose(){}}};};
    h.click('generate');await h.wait();assert.equal(h.posts.length,1,JSON.stringify(h.errors));const record=h.records()[0],params=record.params as any,snapshot=record.snapshot as any;
    assert.equal(record.state,'ready');assert.equal(snapshot.captureGeometry.kind,'edit-analysis');assert.equal(params.outputKind,'asset');assert.equal(params.assetContext,'selection-v1');assert.deepEqual(params.modelSize,{width:32,height:32});
    const saved=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);assert.equal(saved.width,45);assert.equal(saved.height,22);for(const suffix of ['mask','subject-mask','protection-mask'])assert.equal((h.files[`${record.id}-${suffix}.bin`] as Uint8Array).length,18_000_000);
    assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('reusing legacy asset parameters explicitly selects text without changing or resubmitting the old task',async()=>{
  const h=await panelHarness({output});try{
    await h.wait();asset(h);h.click('generate');await h.wait();const records=h.records(),record=records[0];delete (record.params as any).assetContext;h.files['history.json']=JSON.stringify(records);await h.refreshHistory();h.selectHistory(record.id);h.click('repeat-history');await h.wait();
    assert.ok(h.el('asset-input'));assert.equal(h.el('asset-input').value,'text');assert.equal(h.el('destination').value,'document');assert.equal(h.el('selection-tools').style.display,'none');assert.equal(h.posts.length,1);assert.deepEqual(h.records()[0],record);
    const reads=h.pixelRequests.length;h.click('generate');await h.wait();assert.equal(h.posts.length,2);assert.equal(h.pixelRequests.length,reads);assert.equal(h.records()[0].snapshot,undefined);assert.equal((h.records()[0].params as any).assetContext,undefined);
  }finally{await h.close();}
});
