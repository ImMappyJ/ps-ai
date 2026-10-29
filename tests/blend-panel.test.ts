import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import type {Raster} from '../src/imaging/image';
import {decodePng,encodePng} from '../src/imaging/image';
import {defaultSettings} from '../src/infrastructure/config/profile';

const source:Raster={width:8,height:8,rgba:Uint8Array.from({length:8*8*4},(_,i)=>[90,105,120,255][i%4])};
const output:Raster={width:32,height:32,rgba:Uint8Array.from({length:32*32*4},(_,i)=>[126,117,132,255][i%4])};
const selection={bounds:{left:1,top:1,right:5,bottom:5},mask:Uint8Array.from({length:64},(_,p)=>p%8>=1&&p%8<5&&Math.floor(p/8)>=1&&Math.floor(p/8)<5?255:0)};
async function blend(h:Awaited<ReturnType<typeof panelHarness>>){await h.wait();h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');h.el('resolution').value='32';}
async function settleLocal(h:Awaited<ReturnType<typeof panelHarness>>){for(let i=0;i<300;i++){await new Promise(r=>setTimeout(r,10));if(h.el('blend-result-controls')?.getAttribute('aria-busy')!=='true')return;}throw Error('Blend processing did not settle');}
function viewRaster(h:Awaited<ReturnType<typeof panelHarness>>):Raster{return decodePng(new Uint8Array(Buffer.from(h.el('detail-preview').getAttribute('src').split(',')[1],'base64')));}

test('blend create defaults to lighting with source first, folded settings and unavailable empty result actions',async()=>{
  const h=await panelHarness({source,output,selection});try{
    await blend(h);
    assert.equal(h.el('blend-output-kind')?.value,'lighting-layers');
    const create=Array.from(h.el('view-create').children) as HTMLElement[];
    assert.ok(create.indexOf(h.el('selection-tools'))<create.indexOf(h.el('prompt-group')));
    assert.equal(h.el('generate').textContent,'生成环境光参考');
    assert.equal(h.el('generation-body').style.display,'none');assert.equal(h.el('protection-body').style.display,'none');
    for(const id of ['margin-field','align-subject','match-color'])assert.equal(h.el(id).style.display,'none');
    for(const id of ['apply','blend-view-source','blend-view-composite','blend-view-ai','blend-result-output','blend-fidelity','blend-detail-protection'])assert.equal(h.el(id).disabled,true,id);
    h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('blend-output-kind').displayedCaption,'Preserve detail · lighting only');
    assert.equal(h.el('generate').textContent,'Generate environment lighting reference');
    h.el('mode').value='costume';h.change('mode');assert.equal(h.el('generation-body').style.display,'block');assert.notEqual(h.el('margin-field').style.display,'none');
  }finally{await h.close();}
});

test('new blend records retain a frozen lighting choice and switch views and processing locally under the same UUID',async()=>{
  const h=await panelHarness({source,output,selection});try{
    await blend(h);h.click('generate');await h.wait();
    assert.equal(h.posts.length,1);const record=h.records()[0],id=record.id;
    assert.equal((record.blend as any)?.outputKind,'lighting-layers');assert.equal((record.snapshot as any).captureGeometry.kind,'blend-analysis');
    assert.equal(h.el('blend-fidelity').value,'100');assert.equal(h.el('blend-detail-protection').value,'65');
    const composite=h.el('detail-preview').getAttribute('src'),compositeRaster=viewRaster(h);assert.deepEqual([compositeRaster.width,compositeRaster.height],[8,8]);assert.equal(compositeRaster.rgba[0],90,'the saved environment is preserved outside the mask');
    h.click('blend-view-source');await new Promise(r=>setTimeout(r,80));assert.equal(h.el('apply').disabled,true);assert.notEqual(h.el('detail-preview').getAttribute('src'),composite);assert.deepEqual([viewRaster(h).width,viewRaster(h).height],[8,8]);assert.equal(viewRaster(h).rgba[0],90);
    h.click('blend-view-ai');await new Promise(r=>setTimeout(r,80));assert.equal(h.el('apply').disabled,true);assert.deepEqual([viewRaster(h).width,viewRaster(h).height],[8,8]);assert.equal(viewRaster(h).rgba[0],126);
    h.click('blend-view-composite');await new Promise(r=>setTimeout(r,30));assert.equal(h.el('apply').disabled,false);
    h.el('blend-result-output').value='full-result';h.change('blend-result-output');await settleLocal(h);
    assert.equal(h.records()[0].id,id);assert.equal((h.records()[0].blend as any).outputKind,'full-result');assert.equal(h.posts.length,1);
    assert.equal(h.el('apply').textContent,'应用重绘主体');assert.equal(h.el('blend-extraction-controls').style.display,'none');assert.equal(h.el('export-ai-reference').style.display,'block');
    h.el('blend-result-output').value='lighting-layers';h.change('blend-result-output');await settleLocal(h);
    h.el('blend-fidelity').value='75';h.event('blend-fidelity','input');h.el('blend-fidelity').value='45';h.event('blend-fidelity','input');h.el('blend-detail-protection').value='80';h.change('blend-detail-protection');
    assert.equal(h.el('apply').disabled,true);await settleLocal(h);
    assert.deepEqual((h.records()[0].blend as any).localExtraction,{fidelity:.45,detailProtection:.8});assert.equal(h.posts.length,1);assert.equal(h.el('apply').textContent,'应用光影组');
    assert.equal(h.el('blend-fidelity-slider').value,45);
  }finally{await h.close();}
});

test('a stale local blend adjustment cannot persist after candidate focus changes',async()=>{
  // Auto-navigation has separate coverage; its queued completion must not change
  // the explicit candidate selection whose in-flight local work this test owns.
  const h=await panelHarness({source,output,selection,settings:{...defaultSettings(),autoViewResults:false}});let heldFile:string|undefined;
  try{
    await blend(h);h.el('count').value='2';h.click('generate');await h.wait();assert.equal(h.posts.length,2);
    const selectedId=h.posts[1].prompt_id;assert.ok(h.records().some(record=>record.id===selectedId));
    h.el('candidate-select').value='1';h.change('candidate-select');
    heldFile=`${selectedId}-output.png`;h.holdFileRead(heldFile);const reads=h.fileReads.length;
    h.el('blend-fidelity').value='20';h.change('blend-fidelity');
    for(let attempt=0;attempt<300&&!h.fileReads.slice(reads).includes(heldFile);attempt++)await new Promise(r=>setTimeout(r,10));
    assert.ok(h.fileReads.slice(reads).includes(heldFile),'the explicitly selected candidate is blocked inside local processing');
    assert.equal(h.el('candidate-select').value,'1');assert.equal(h.el('blend-result-controls').getAttribute('aria-busy'),'true');
    h.el('candidate-select').value='0';h.change('candidate-select');h.releaseFileRead(heldFile);heldFile=undefined;
    // The released read and stale-owner check finish through microtasks before
    // the next event-loop turn; no guessed processing duration is required.
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.ok(h.records().every(record=>(record.blend as any).localExtraction===undefined));assert.equal(h.posts.length,2);
    assert.equal(h.el('blend-fidelity').value,'100');assert.equal(h.el('apply').disabled,false);
  }finally{if(heldFile)h.releaseFileRead(heldFile);await h.close();}
});

for(const phase of ['debounce','processing'] as const)test(`invalidating ${phase} blend adjustments restores the same candidate controls and apply availability`,async()=>{
  const h=await panelHarness({source,output,selection});let heldFile:string|undefined;
  try{
    await blend(h);h.click('generate');await h.wait();const record=h.records()[0],previous=h.el('detail-preview').getAttribute('src');
    if(phase==='processing'){heldFile=`${record.id}-output.png`;h.holdFileRead(heldFile);}
    const reads=h.fileReads.length;h.el('blend-fidelity').value='20';h.change('blend-fidelity');assert.equal(h.el('apply').disabled,true);
    if(phase==='processing'){
      for(let attempt=0;attempt<100&&!h.fileReads.slice(reads).includes(heldFile!);attempt++)await new Promise(r=>setTimeout(r,10));
      assert.ok(h.fileReads.slice(reads).includes(heldFile!),'the local adjustment started before invalidation');
    }
    h.click('nav-create');
    if(phase==='debounce'){h.el('resolution').value='64';h.change('resolution');}
    else{h.el('mode').value='costume';h.change('mode');}
    h.click('nav-results');
    assert.equal(h.el('blend-result-controls').getAttribute('aria-busy'),'false');
    assert.equal(h.el('blend-fidelity').value,'100');assert.equal(h.el('blend-fidelity-slider').value,100);assert.equal(h.el('blend-detail-protection').value,'65');
    assert.equal(h.el('blend-result-output').value,'lighting-layers');assert.equal(h.el('apply').disabled,false);assert.equal(h.el('blend-view-composite').disabled,false);
    assert.equal(h.el('blend-processing-status').textContent,'');assert.equal(h.el('detail-preview').getAttribute('src'),previous);
    if(heldFile){h.releaseFileRead(heldFile);heldFile=undefined;}
    await new Promise(r=>setTimeout(r,180));
    assert.equal((h.records()[0].blend as any).localExtraction,undefined);assert.equal(h.posts.length,1);assert.equal(h.el('blend-fidelity').value,'100');assert.equal(h.el('apply').disabled,false);
  }finally{if(heldFile)h.releaseFileRead(heldFile);await h.close();}
});

for(const view of ['source','ai'] as const)test(`capture invalidation lets the same candidate ${view} preview finish while later view changes still win`,async()=>{
  const h=await panelHarness({source,output,selection});let heldFile:string|undefined;
  try{
    await blend(h);h.click('generate');await h.wait();const record=h.records()[0],composite=h.el('detail-preview').getAttribute('src');
    heldFile=`${record.id}-${view==='source'?'source':'output'}.png`;h.holdFileRead(heldFile);const reads=h.fileReads.length;
    h.click(`blend-view-${view}`);
    for(let attempt=0;attempt<100&&!h.fileReads.slice(reads).includes(heldFile);attempt++)await new Promise(r=>setTimeout(r,10));
    assert.ok(h.fileReads.slice(reads).includes(heldFile),'the selected preview is waiting on its saved raster');
    h.click('nav-create');h.el('resolution').value='64';h.change('resolution');h.click('nav-results');h.releaseFileRead(heldFile);heldFile=undefined;
    for(let attempt=0;attempt<50&&h.el('detail-frame').getAttribute('aria-busy')==='true';attempt++)await new Promise(r=>setTimeout(r,10));
    assert.equal(h.el('detail-preview').style.visibility,'visible');assert.equal(h.el('detail-frame').getAttribute('aria-busy'),'false');
    assert.equal(h.el(`blend-view-${view}`).getAttribute('aria-pressed'),'true');assert.equal(viewRaster(h).rgba[0],view==='source'?90:126);assert.equal(h.el('apply').disabled,true);
    heldFile=`${record.id}-${view==='source'?'source':'output'}.png`;h.holdFileRead(heldFile);h.click(`blend-view-${view}`);
    h.click('blend-view-composite');h.releaseFileRead(heldFile);heldFile=undefined;await new Promise(r=>setTimeout(r,50));
    assert.equal(h.el('detail-preview').getAttribute('src'),composite);assert.equal(h.el('detail-preview').style.visibility,'visible');assert.equal(h.el('detail-frame').getAttribute('aria-busy'),'false');
    assert.equal(h.el('blend-view-composite').getAttribute('aria-pressed'),'true');assert.equal(h.posts.length,1);assert.equal((h.records()[0].blend as any).localExtraction,undefined);
  }finally{if(heldFile)h.releaseFileRead(heldFile);await h.close();}
});

test('an unsupported redraw source keeps its previous preview and metadata when local lighting fails',async()=>{
  const h=await panelHarness({source,output,selection});try{
    await blend(h);h.ps.app.activeDocument.colorProfileName='Adobe RGB (1998)';
    h.click('generate');await h.wait();assert.equal(h.posts.length,0,'default lighting rejects before upload');assert.equal(h.uploads.length,0);
    h.el('blend-output-kind').value='full-result';h.change('blend-output-kind');h.click('generate');await h.wait();
    assert.equal(h.posts.length,1);const id=h.records()[0].id,previous=h.el('detail-preview').getAttribute('src');
    h.el('blend-result-output').value='lighting-layers';h.change('blend-result-output');await settleLocal(h);
    assert.equal(h.el('detail-preview').getAttribute('src'),previous);assert.equal((h.records()[0].blend as any).outputKind,'full-result');
    assert.equal(h.el('blend-result-output').value,'full-result');assert.match(h.el('blend-processing-status').textContent,/保留原候选/);assert.equal(h.posts.length,1);
    h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('blend-processing-status').textContent,/Local adjustment failed/);assert.match(h.el('blend-processing-status').textContent,/tagged sRGB/);
    h.click('export-ai-reference');await h.wait();assert.ok(h.files[`ps-ai-${id.slice(0,8)}-ai-reference.png`]);
  }finally{await h.close();}
});

test('reusing legacy blend history explicitly retains redraw and does not authorize local processing of the old candidate',async()=>{
  const id='86000000-1111-4111-8111-111111111111';
  const record={id,clientId:id,state:'ready' as const,createdAt:'2026-10-30T00:00:00Z',graph:{},outputFile:`${id}-output.png`,template:'qwen21-local-v2-rgba',userPrompt:'legacy supplement',params:{workspace:'cosplay',mode:'blend',outputKind:'edit',steps:25,resolution:32,seed:42,destination:'selection',margin:.15,modelSize:{width:32,height:32}}};
  const h=await panelHarness({source,output,selection,history:[record],files:{[`${id}-output.png`]:encodePng(output)}});try{
    await h.wait();h.selectHistory(id);h.click('repeat-history');await h.wait();assert.equal(h.el('blend-output-kind').value,'full-result');assert.equal(h.el('prompt').value,'legacy supplement');
    h.selectHistory(id);h.click('load-history');await h.wait();assert.equal(h.el('blend-result-controls').style.display,'none');assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('blend local processing retains a native RGB16 saved source with 16-bit output selected',async()=>{
  const nativeSource={...source,rgba:Uint16Array.from(source.rgba,v=>v*257)},nativeOutput={...output,rgba:Uint16Array.from(output.rgba,v=>v*257)};
  const h=await panelHarness({source:nativeSource,output:nativeOutput,selection,save16Node:true,settings:{...defaultSettings(),outputDepth:16}});try{
    await blend(h);assert.equal(h.el('output-depth').value,'16');h.click('generate');await h.wait();assert.equal(h.posts.length,1);
    const record=h.records()[0],saved=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);assert.ok(saved.rgba instanceof Uint16Array);assert.equal(saved.rgba[0],23130);assert.equal((record.blend as any).source.documentDepth,16);
    h.el('blend-detail-protection').value='0';h.change('blend-detail-protection');await settleLocal(h);assert.equal((h.records()[0].blend as any).localExtraction.detailProtection,0);assert.equal(h.posts.length,1);
    h.ps.app.activeDocument.activeHistoryState={id:999};h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.match(h.el('diagnostic-summary').textContent,/来源.*改变|来源/);
  }finally{await h.close();}
});

test('a successful local redraw conversion clears a saved extraction error without another submission',async()=>{
  const h=await panelHarness({source,output,selection});try{
    await blend(h);h.ps.app.activeDocument.colorProfileName='Adobe RGB (1998)';h.el('blend-output-kind').value='full-result';h.change('blend-output-kind');h.click('generate');await h.wait();
    const record=h.records()[0];(record.blend as any).outputKind='lighting-layers';record.state='output-error';record.detail='previous extraction failed';h.files['history.json']=JSON.stringify([record]);await h.refreshHistory();h.selectHistory(record.id);h.click('load-history');await h.wait();
    assert.equal(h.el('apply').textContent,'查看提取失败原因');
    h.el('blend-result-output').value='full-result';h.change('blend-result-output');await settleLocal(h);
    assert.equal(h.records()[0].state,'ready');assert.equal(h.records()[0].detail,undefined);assert.equal(h.posts.length,1);assert.equal(h.el('apply').textContent,'应用重绘主体');
  }finally{await h.close();}
});
