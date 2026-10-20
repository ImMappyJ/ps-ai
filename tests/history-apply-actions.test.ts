import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {decodePng,encodePng} from '../src/imaging/image';
import {defaultSettings} from '../src/infrastructure/config/profile';
import type {JobRecord} from '../src/generation/jobs';

type Harness=Awaited<ReturnType<typeof panelHarness>>;
const INVALID='aaaaaaaa-1111-4111-8111-111111111111';
const sleep=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(predicate:()=>boolean,message:string){for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(predicate(),message);}
async function generate(h:Harness,documentId=11):Promise<JobRecord>{
  h.switchDocument(documentId);h.el('resolution').value='32';h.click('generate');await h.wait();
  assert.equal(h.records()[0].state,'ready');return h.records()[0];
}
async function choose(h:Harness,index:number){h.el('candidate-select').value=String(index);h.change('candidate-select');await sleep();}
const diagnostic=(h:Harness)=>JSON.parse(h.el('diagnostic-details').value);
async function openFullRelight(h:Harness){
  await h.wait();h.click('nav-create');h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');
  await until(()=>h.el('relight-dialog').hasAttribute('open'),'workbench opens');h.el('relight-output').value='full-result';h.change('relight-output');h.click('relight-reread');
  await until(()=>!h.el('relight-generate').disabled,'full-result source is ready');h.click('relight-generate');await h.wait();
}
function assertCheckAction(h:Harness){
  assert.equal(h.el('apply').disabled,false,'an idle candidate with a frozen source must retain a clickable source check');
  assert.match(h.el('apply').textContent,/检查|恢复|Check|Recover/,'an unavailable source must not be presented as an immediately writable candidate');
}
function documentState(h:Harness){return JSON.stringify(h.ps.app.documents.map((doc:any)=>({id:doc.id,history:doc.activeHistoryState.id,profile:doc.colorProfileName,layers:doc.layers.map((layer:any)=>({id:layer.id,visible:layer.visible}))})));}

test('four independently captured tasks keep their own source targets when switching thumbnails and the results select',async()=>{
  const h=await panelHarness();try{
    await h.wait();assert.equal(h.el('apply').disabled,true);
    const jobs:JobRecord[]=[];for(const documentId of [11,12,13,14])jobs.push(await generate(h,documentId));
    const before=documentState(h),reads=h.pixelRequests.length,requests=h.requests.length;
    for(const index of [3,0,2,1,3]){
      if(index%2){h.el('candidates').children[index].querySelector('button').click();await sleep();}else await choose(h,index);
      assert.equal(h.el('candidate-select').value,String(index));assert.equal(h.el('apply').disabled,false);
      assert.match(h.el('candidate-target').textContent,new RegExp(`来源文档 ${11+index} `));
    }
    assert.equal(documentState(h),before,'browsing cannot mutate any source history or layers');assert.equal(h.pixelRequests.length,reads);assert.equal(h.requests.length,requests);
    for(const index of [0,1,2,3]){await choose(h,index);h.click('apply');await h.wait();assert.equal(h.appliedLayers[h.appliedLayers.length-1].documentId,11+index);}
    assert.equal(h.posts.length,4);assert.equal(h.appliedLayers.length,4);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('current to invalid historical candidate to current keeps a per-UUID source check and direct application',async()=>{
  const h=await panelHarness();try{
    await h.wait();const old=await generate(h);h.ps.app.activeDocument.activeHistoryState={id:40};const current=await generate(h);
    const before=documentState(h),posts=h.posts.length;
    await choose(h,0);assertCheckAction(h);h.click('apply');await h.wait();
    assert.equal(diagnostic(h).code,'source-changed');assert.equal(diagnostic(h).taskId,old.id);assert.equal(diagnostic(h).documentId,11);
    assert.equal(h.appliedLayers.length,0);assert.equal(documentState(h),before);assert.equal(h.el('export').disabled,false);
    assert.notEqual(h.el('diagnostic-primary').style.display,'none','the failed source check must offer a recovery action');
    await choose(h,1);assert.equal(h.el('apply').disabled,false);assert.doesNotMatch(h.el('apply').textContent,/检查|恢复/);assert.equal(h.el('diagnostic-box').style.display,'none','a different candidate must not inherit the old source failure');
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.match(h.appliedLayers[0].layer.name,new RegExp(current.id.slice(0,8)));
    assert.equal(h.posts.length,posts);
  }finally{await h.close();}
});

test('merely selecting a changed old candidate does not poison a still-current candidate',async()=>{
  const h=await panelHarness();try{
    await h.wait();await generate(h);h.ps.app.activeDocument.activeHistoryState={id:40};const current=await generate(h);
    const before=documentState(h),requests=h.requests.length,reads=h.pixelRequests.length;
    await choose(h,0);await choose(h,1);await choose(h,0);await choose(h,1);
    assert.equal(h.el('apply').disabled,false);assert.doesNotMatch(h.el('apply').textContent,/检查|恢复/);
    assert.equal(documentState(h),before);assert.equal(h.requests.length,requests);assert.equal(h.pixelRequests.length,reads);
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.match(h.appliedLayers[0].layer.name,new RegExp(current.id.slice(0,8)));
  }finally{await h.close();}
});

test('same-source candidates remain replaceable after their snapshot mask is reloaded from disk',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('count').value='2';const last=await generate(h),jobs=h.records(),first=jobs.find(job=>job.id!==last.id)!;
    assert.equal(h.el('candidate-select').children.length,2);await choose(h,0);h.click('apply');await h.wait();
    const firstLayer=h.appliedLayers[0].layer.id;await choose(h,1);assert.match(h.el('apply').textContent,/替换/);h.click('apply');await h.wait();
    assert.equal(h.ps.app.activeDocument.layers.some((layer:any)=>layer.id===firstLayer),false);assert.equal(h.ps.app.activeDocument.layers.length,2);
    h.selectHistory(first.id);h.click('load-history');await h.wait();assert.equal(h.el('candidate-select').children.length,2);assert.match(h.el('apply').textContent,/替换/);
    h.click('apply');await h.wait();assert.equal(h.ps.app.activeDocument.layers.length,2);assert.match(h.appliedLayers[h.appliedLayers.length-1].layer.name,new RegExp(first.id.slice(0,8)));
    assert.equal(h.posts.length,2);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('missing or corrupt historical output releases the operation lock and preserves the selected current candidate',async()=>{
  for(const bytes of [undefined,new Uint8Array([1,2,3])]){
    const h=await panelHarness();try{
      await h.wait();const current=await generate(h),bad={...current,id:INVALID,outputFile:`${INVALID}-output.png`};
      h.files['history.json']=JSON.stringify([bad,current]);if(bytes)h.files[bad.outputFile]=bytes;
      await h.refreshHistory();h.selectHistory(INVALID);h.click('load-history');await h.wait();
      assert.equal(h.el('candidate-select').children.length,1);assert.equal(h.el('apply').disabled,false);assert.equal(h.el('candidate-select').disabled,false);
      h.click('nav-results');h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.match(h.appliedLayers[0].layer.name,new RegExp(current.id.slice(0,8)));
      assert.ok(h.files[current.outputFile as string]);assert.equal(h.posts.length,1);
    }finally{await h.close();}
  }
});

test('a late history preview cannot change the selected results UUID, its source check or current preview',async()=>{
  const h=await panelHarness();try{
    await h.wait();const old=await generate(h);h.ps.app.activeDocument.activeHistoryState={id:40};const current=await generate(h);
    const before=documentState(h),preview=h.el('detail-preview').src;
    const priorReads=h.fileReads.filter(name=>name===old.outputFile).length;
    h.holdFileRead(old.outputFile as string);h.selectHistory(old.id);await until(()=>h.fileReads.filter(name=>name===old.outputFile).length>priorReads,'historical output read starts');
    h.click('nav-results');h.el('candidate-select').value='0';h.change('candidate-select');h.el('candidate-select').value='1';h.change('candidate-select');h.releaseFileRead(old.outputFile as string);await sleep();
    assert.equal(h.el('candidate-select').value,'1');assert.equal(h.el('apply').disabled,false);assert.doesNotMatch(h.el('apply').textContent,/检查|恢复/);
    assert.equal(h.el('detail-preview').src,preview);assert.equal(documentState(h),before);
    h.click('apply');await h.wait();assert.match(h.appliedLayers[h.appliedLayers.length-1].layer.name,new RegExp(current.id.slice(0,8)));assert.equal(h.posts.length,2);
  }finally{for(const job of h.records())if(job.outputFile)h.releaseFileRead(job.outputFile as string);await h.close();}
});

test('four application and deletion rounds require a source check until undo returns to the captured state',async()=>{
  const h=await panelHarness();try{
    await h.wait();await generate(h);const doc=h.ps.app.activeDocument;
    for(let round=0;round<4;round++){
      h.click('apply');await h.wait();const layer=h.appliedLayers[h.appliedLayers.length-1].layer;await layer.delete();doc.activeHistoryState={id:100+round};
      await choose(h,0);assertCheckAction(h);
      h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,round+1,'deleting the owned layer cannot authorize a new write at another history state');
      doc.activeHistoryState={id:1};await choose(h,0);assert.equal(h.el('apply').disabled,false);assert.doesNotMatch(h.el('apply').textContent,/检查|恢复/);
    }
    assert.equal(h.posts.length,1);assert.equal(doc.layers.length,1);assert.equal(doc.colorProfileName,'sRGB IEC61966-2.1');
  }finally{await h.close();}
});

test('cross-session disk reload has a clickable source check but cannot rebind an old candidate',async()=>{
  const original=await panelHarness();let job:JobRecord,files:Record<string,Uint8Array|string>;
  try{await original.wait();job=await generate(original);files={...original.files};}finally{await original.close();}
  const h=await panelHarness({files:files!});try{
    await h.wait();h.selectHistory(job!.id);h.click('load-history');await h.wait();const before=documentState(h);assertCheckAction(h);
    h.click('apply');await h.wait();assert.equal(diagnostic(h).code,'source-unavailable');assert.equal(diagnostic(h).taskId,job!.id);
    assert.equal(h.appliedLayers.length,0);assert.equal(documentState(h),before);assert.equal(h.el('export').disabled,false);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('a closed historical source exposes a check without applying to the active replacement document',async()=>{
  const h=await panelHarness();try{
    await h.wait();const job=await generate(h);h.setDocument(22);await choose(h,0);const before=documentState(h);assertCheckAction(h);
    h.click('apply');await h.wait();assert.equal(diagnostic(h).code,'source-unavailable');assert.equal(diagnostic(h).taskId,job.id);assert.equal(diagnostic(h).documentId,11);
    assert.equal(h.appliedLayers.length,0);assert.equal(documentState(h),before);assert.equal(h.posts.length,1);h.click('diagnostic-primary');await h.wait();
    assert.equal(h.el('view-create').style.display,'block');assert.match(h.el('status').textContent,/选择正确.*来源/);assert.equal(documentState(h),before);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('writer rechecks the frozen selected source if it changes after the enabled button was painted',async()=>{
  const h=await panelHarness();try{
    await h.wait();const job=await generate(h);assert.equal(h.el('apply').disabled,false);h.switchDocument(22);
    h.ps.app.documents.find((doc:any)=>doc.id===11).activeHistoryState={id:90};const before=documentState(h);
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.equal(documentState(h),before);
    assert.equal(diagnostic(h).code,'source-changed');assert.equal(diagnostic(h).taskId,job.id);assert.equal(diagnostic(h).documentId,11);
    assertCheckAction(h);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('standalone historical images retain export without acquiring a source application action',async()=>{
  const png=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)}),job:JobRecord={id:INVALID,clientId:INVALID,state:'ready',graph:{},createdAt:'2026-10-20',template:'qwen21-local-v2-rgba',outputFile:`${INVALID}-output.png`,params:{workspace:'t2i',mode:'generate',outputKind:'t2i'}};
  const h=await panelHarness({settings:defaultSettings(),history:[job],files:{[job.outputFile as string]:png}});try{
    await h.wait();h.selectHistory(INVALID);h.click('load-history');await h.wait();assert.equal(h.el('apply').disabled,true);assert.equal(h.el('export').disabled,false);
    h.click('export');await h.wait();assert.equal(decodePng(h.files['ps-ai-aaaaaaaa.png'] as Uint8Array).width,2);assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,0);
  }finally{await h.close();}
});

test('source check labels and recovery guidance remain available in English without changing saved parameters',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),language:'en-US'}});try{
    await h.wait();const job=await generate(h),params=JSON.stringify(job.params);h.ps.app.activeDocument.activeHistoryState={id:90};await choose(h,0);
    assertCheckAction(h);assert.doesNotMatch(h.el('apply').textContent,/[一-龥]/);h.click('apply');await h.wait();
    assert.equal(diagnostic(h).taskId,job.id);assert.equal(diagnostic(h).code,'source-changed');assert.doesNotMatch(h.el('diagnostic-action').textContent,/[一-龥]/);
    assert.equal(JSON.stringify(h.records()[0].params),params);assert.equal(h.appliedLayers.length,0);
  }finally{await h.close();}
});

test('explicit workbench reopening recaptures current source while old result inspection stays read-only',async()=>{
  const h=await panelHarness();try{
    await openFullRelight(h);const job=h.records()[0];h.click('relight-close');await sleep();h.ps.app.activeDocument.activeHistoryState={id:90};
    const reads=h.pixelRequests.length;h.click('open-relight');await until(()=>h.el('relight-dialog').hasAttribute('open'),'stale workbench reopens');
    assert.equal(h.el('relight-generate').disabled,false);assert.equal(h.el('relight-apply').disabled,true);assert.ok(h.pixelRequests.length>reads);const choice=h.el('relight-result-list').querySelector('button');choice.id='stale-result';h.click(choice.id);assert.match(h.el('relight-apply').textContent,/检查|恢复/);
    h.click('relight-apply');await sleep();await until(()=>h.el('relight-dialog').hasAttribute('open'),'source check reopens editor');
    assert.equal(diagnostic(h).taskId,job.id);assert.equal(diagnostic(h).documentId,11);assert.equal(diagnostic(h).code,'source-changed');
    assert.ok(h.pixelRequests.length>reads);assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,1);assert.equal(h.el('relight-export').disabled,false);
  }finally{await h.close();}
});

test('a workbench result from an earlier snapshot exposes a check but gains no new write permission after reread',async()=>{
  const h=await panelHarness();try{
    await openFullRelight(h);const job=h.records()[0];h.ps.app.activeDocument.activeHistoryState={id:90};h.click('relight-reread');await until(()=>!h.el('relight-generate').disabled,'explicit reread completes');
    const button=h.el('relight-result-list').querySelector('button');button.id='historical-result';h.click('historical-result');
    assert.equal(h.el('relight-apply').disabled,false);assert.match(h.el('relight-apply').textContent,/检查|恢复/);h.click('relight-apply');await sleep();
    await until(()=>h.el('relight-dialog').hasAttribute('open'),'historical check reopens editor');
    assert.equal(diagnostic(h).taskId,job.id);assert.equal(diagnostic(h).code,'source-changed');assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('rejected lighting references expose their failure reason in both views without any native application',async()=>{
  const h=await panelHarness({output:{width:32,height:32,rgba:new Uint8Array(32*32*4)}});try{
    await h.wait();h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');
    await until(()=>h.el('relight-dialog').hasAttribute('open'),'workbench opens');h.click('relight-generate');await h.wait();const job=h.records()[0];
    assert.equal(job.state,'output-error');assert.equal(h.el('relight-apply').disabled,false);assert.match(h.el('relight-apply').textContent,/查看.*原因/);
    h.el('relight-output').value='full-result';h.change('relight-output');h.click('relight-apply');await sleep();await until(()=>h.el('relight-dialog').hasAttribute('open'),'reason inspection reopens editor');
    assert.equal(diagnostic(h).taskId,job.id);assert.equal(diagnostic(h).code,'relight-extraction');assert.equal(diagnostic(h).documentId,11);assert.equal(h.appliedLayers.length,0);
    h.click('relight-close');await sleep();h.click('nav-results');assert.equal(h.el('apply').disabled,false);assert.match(h.el('apply').textContent,/查看.*原因/);h.click('apply');await h.wait();
    assert.equal(diagnostic(h).taskId,job.id);assert.equal(diagnostic(h).code,'relight-extraction');assert.equal(h.appliedLayers.length,0);assert.equal(h.posts.length,1);assert.equal(h.el('export-ai-reference').disabled,false);
  }finally{await h.close();}
});

test('successful lighting composites retain direct application actions in the workbench and Results',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');
    await until(()=>h.el('relight-dialog').hasAttribute('open'),'workbench opens');h.click('relight-generate');await h.wait();
    assert.equal(h.records()[0].state,'ready');assert.equal(h.el('relight-apply').disabled,false);assert.match(h.el('relight-apply').textContent,/应用光影层组/);
    h.click('relight-close');await sleep();h.click('nav-results');assert.equal(h.el('apply').disabled,false);assert.match(h.el('apply').textContent,/应用到来源文档/);assert.match(h.el('candidate-caption').textContent,/光影合成预览/);
    assert.equal(h.posts.length,1);assert.equal(h.appliedLayers.length,0);
  }finally{await h.close();}
});

test('a painted source check stays read-only if Undo restores its source before the click',async()=>{
  const h=await panelHarness();try{
    await h.wait();await generate(h);const doc=h.ps.app.activeDocument;doc.activeHistoryState={id:90};await choose(h,0);assertCheckAction(h);
    doc.activeHistoryState={id:1};h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0,'a Check action cannot silently turn into a write');
    assert.doesNotMatch(h.el('apply').textContent,/检查|恢复/);h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);
  }finally{await h.close();}
});

test('native application still rejects source changes after asynchronous source loading starts',async()=>{
  const h=await panelHarness();let sourceName:string|undefined;try{
    await h.wait();const job=await generate(h);sourceName=`${job.id}-source.png`;const reads=h.fileReads.filter(name=>name===sourceName).length;h.holdFileRead(sourceName);h.click('apply');
    await until(()=>h.fileReads.filter(name=>name===sourceName).length>reads,'application source read starts');assert.equal(h.el('apply').disabled,true);
    h.ps.app.activeDocument.activeHistoryState={id:91};h.releaseFileRead(sourceName);await h.wait();
    assert.equal(h.appliedLayers.length,0);assert.equal(diagnostic(h).code,'source-changed');assert.equal(diagnostic(h).taskId,job.id);assertCheckAction(h);
  }finally{if(sourceName)h.releaseFileRead(sourceName);await h.close();}
});
