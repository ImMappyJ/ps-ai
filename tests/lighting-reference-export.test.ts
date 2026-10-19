import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {RelightSession,relightTaskMetadata} from '../src/features/relight/relight-session';
import {encodePng} from '../src/imaging/image';
import type {JobRecord} from '../src/generation/jobs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
function taggedRaw(bytes:Uint8Array,label:string):Uint8Array {
 const data=new TextEncoder().encode(`Reference\0${label}`),chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write('tEXt',4);chunk.set(data,8);let crc=0xffffffff;
 for(const value of chunk.subarray(4,-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
 return new Uint8Array(Buffer.concat([bytes.subarray(0,-12),chunk,bytes.subarray(-12)]));
}
function fixture(id=A){
 const image={width:2,height:2,rgba:new Uint8Array(16).fill(255)},mask=new Uint8Array(4).fill(255),snapshot={documentId:11,width:2,height:2,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:8,historyId:1,sessionId:'source-session',bounds:{left:0,top:0,right:2,bottom:2},mask,sourceHash:'opaque',sourceLayerIds:[2],captureGeometry:{kind:'relight-analysis' as const,width:2,height:2}};
 const session=new RelightSession({image,snapshot,selectionMask:mask,protectionMask:new Uint8Array(4)},'snapshot-'+id,'light','document'),frozen=session.freeze(),metadata=relightTaskMetadata(frozen,id,{provider:'comfyui',model:'fixture',edit:true,maxInputImages:3,maskMode:'none',seed:true},{width:2,height:2},8,0),raw=taggedRaw(encodePng(image),id);
 const record:JobRecord={id,clientId:id,state:'ready',graph:{},createdAt:'2026-10-19T00:00:00Z',template:'qwen21-local-v2-rgba',snapshot:(({mask:_,...rest})=>rest)(snapshot),relight:metadata,outputFile:`${id}-output.png`,params:{workspace:'cosplay',mode:'relight',outputKind:'edit',modelSize:{width:2,height:2}}};
 return {record,raw,files:{[`${id}-output.png`]:raw,[`${id}-source.png`]:encodePng(image),[`${id}-mask.bin`]:mask}};
}

test('lighting Results export exact saved AI reference bytes separately from the local reconstruction, without backend or source changes',async()=>{
 const f=fixture(),h=await panelHarness({settings:defaultSettings(),history:[f.record],files:f.files});try{
  await h.wait();h.selectHistory(A);h.click('load-history');await h.wait();assert.ok(h.el('export-ai-reference'));assert.equal(h.el('export-ai-reference').style.display,'block');assert.equal(h.el('export-ai-reference').textContent,'另存 AI 参考图');assert.match(h.el('ai-reference-export-info').textContent,/本地光影重组.*模型原始输出/);
  assert.match(h.el('candidate-caption').textContent,/光影合成预览/);
  const preview=h.el('detail-preview').src,caption=h.el('candidate-target').textContent,record=JSON.stringify(h.records());h.click('export');await h.wait();const local=h.files['ps-ai-11111111.png'];assert.ok(local);assert.notDeepEqual(local,f.raw,'the tagged raw bytes differ from a reconstructed PNG');
  const requests=h.requests.length;h.click('export-ai-reference');await h.wait();assert.deepEqual(h.files['ps-ai-11111111-ai-reference.png'],f.raw);assert.equal(h.requests.length,requests);assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);assert.equal(h.pixelRequests.length,0);assert.equal(h.appliedLayers.length,0);assert.equal(h.el('detail-preview').src,preview);assert.equal(h.el('candidate-target').textContent,caption);assert.equal(JSON.stringify(h.records()),record);
  h.el('language').value='en-US';h.change('language');await h.wait();assert.equal(h.el('export-ai-reference').textContent,'Save AI reference');assert.match(h.el('ai-reference-export-info').textContent,/local lighting reconstruction.*original model output/);
  assert.match(h.el('candidate-caption').textContent,/Lighting composite preview/);
 }finally{await h.close();}
});

test('AI reference export freezes the selected job UUID before asynchronous reads and rejects unsafe saved output paths',async()=>{
 const first=fixture(),second=fixture(B),h=await panelHarness({settings:defaultSettings(),history:[first.record,second.record],files:{...first.files,...second.files}});try{
  await h.wait();for(const id of [A,B]){h.selectHistory(id);h.click('load-history');await h.wait();}h.el('candidate-select').value='0';h.change('candidate-select');await h.wait();
  h.holdFileRead(`${A}-output.png`);h.click('export-ai-reference');await pause();h.el('candidate-select').value='1';h.change('candidate-select');h.releaseFileRead(`${A}-output.png`);await h.wait();assert.deepEqual(h.files['ps-ai-11111111-ai-reference.png'],first.raw);assert.equal(h.files['ps-ai-22222222-ai-reference.png'],undefined);
  const records=h.records();records.find(record=>record.id===B)!.outputFile='../private.png';h.files['history.json']=JSON.stringify(records);const reads=h.fileReads.length;h.click('export-ai-reference');await h.wait();assert.equal(h.files['ps-ai-22222222-ai-reference.png'],undefined);assert.equal(h.fileReads.slice(reads).some(name=>name.includes('../')),false);assert.match(h.el('diagnostic-summary').textContent,/不安全/);assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);
 }finally{h.releaseFileRead(`${A}-output.png`);await h.close();}
});

test('ordinary and legacy full-image candidates hide the AI-reference-only export action',async()=>{
 const bytes=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)}),record:JobRecord={id:A,clientId:A,state:'ready',graph:{},createdAt:'2026-10-19',template:'qwen21-local-v2-rgba',outputFile:`${A}-output.png`,params:{workspace:'t2i',mode:'generate',outputKind:'t2i'}};
 for(const relight of [undefined,{schemaVersion:1}]){const h=await panelHarness({settings:defaultSettings(),history:[{...record,...(relight?{relight}:{})}],files:{[`${A}-output.png`]:bytes}});try{await h.wait();assert.equal(h.el('export-ai-reference')?.style.display,'none');h.selectHistory(A);h.click('load-history');await h.wait();assert.equal(h.el('export-ai-reference').style.display,'none');assert.equal(h.el('ai-reference-export-info').style.display,'none');}finally{await h.close();}}
});

test('rejected lighting references remain explicitly exportable without claiming a usable local reconstruction',async()=>{
 const f=fixture(),raw=taggedRaw(encodePng({width:2,height:2,rgba:new Uint8Array(16)}),'rejected'),h=await panelHarness({settings:defaultSettings(),history:[f.record],files:{...f.files,[`${A}-output.png`]:raw}});try{
  await h.wait();h.selectHistory(A);h.click('load-history');await h.wait();assert.equal(h.el('apply').disabled,false);assert.match(h.el('apply').textContent,/查看.*原因/);h.click('apply');await h.wait();assert.equal(JSON.parse(h.el('diagnostic-details').value).taskId,A);assert.equal(h.appliedLayers.length,0);assert.equal(h.el('export-ai-reference').disabled,false);assert.match(h.el('ai-reference-export-info').textContent,/未形成可用光影重组/);h.click('export-ai-reference');await h.wait();assert.deepEqual(h.files['ps-ai-11111111-ai-reference.png'],raw);assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);
  assert.match(h.el('candidate-caption').textContent,/AI 参考图.*提取失败/);
  assert.doesNotMatch(h.el('candidate-target').textContent,/应用到绑定文档/);
 }finally{await h.close();}
});

test('lighting generation, original-ID recovery and historical loading preserve a rejected reference and its local reason',async()=>{
 const width=32,height=32,source={width,height,rgba:new Uint8Array(width*height*4)},output={width,height,rgba:new Uint8Array(width*height*4)};
 for(let p=0;p<width*height;p++){source.rgba.set([70+p%width,90+Math.floor(p/width),110,255],p*4);const v=p%2?220:20;output.rgba.set([v,v,v,255],p*4);}
 const h=await panelHarness({source,output});try{
  await h.wait();h.click('nav-create');h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';h.click('open-relight');await new Promise(r=>setTimeout(r,80));
  h.click('relight-generate');await h.wait();
  const job=h.records()[0],raw=(h.files[`${job.id}-output.png`] as Uint8Array).slice();
  assert.equal(h.posts.length,1);assert.equal(job.state,'output-error');assert.equal((job.relight as any).outputKind,'lighting-layers');
  const checkDiagnostic=()=>{const d=JSON.parse(h.el('diagnostic-details').value);assert.equal(d.taskId,job.id);assert.equal(d.code,'relight-extraction');assert.equal(d.stage,'lighting-extraction');assert.equal(d.reason,'structure-mismatch');assert.ok(Number.isFinite(d.metrics.structureConfidence));assert.doesNotMatch(d.action,/PNG|ICC|sRGB/);};
  checkDiagnostic();assert.match(h.el('relight-result-list').textContent,/AI 参考图.*提取失败/);assert.equal(h.el('relight-apply').disabled,false);assert.match(h.el('relight-apply').textContent,/查看.*原因/);assert.equal(h.el('relight-export').disabled,false);
  h.el('relight-output').value='full-result';h.change('relight-output');assert.equal(h.el('relight-apply').disabled,false);assert.match(h.el('relight-apply').textContent,/查看.*原因/);h.click('relight-apply');await pause();checkDiagnostic();assert.equal(h.appliedLayers.length,0);assert.match(h.el('relight-result-list').textContent,/AI 参考图.*提取失败/);
  h.click('relight-close');await pause();h.click('nav-history');h.selectHistory(job.id);h.click('recover');await h.wait();checkDiagnostic();
  assert.equal(h.posts.length,1,'recovering the original UUID never submits generation');assert.deepEqual(h.files[`${job.id}-output.png`],raw);
  assert.ok(h.requests.some(r=>r.url.endsWith(`/history/${job.id}`)));
  h.selectHistory(job.id);await new Promise(r=>setTimeout(r,60));assert.match(h.el('history-preview-status').textContent,/AI 参考图.*提取失败/);
  h.click('load-history');await h.wait();checkDiagnostic();assert.equal(h.el('view-results').style.display,'block');assert.equal(h.el('diagnostic-box').style.display,'block');assert.match(h.el('candidate-caption').textContent,/AI 参考图.*提取失败/);assert.equal(h.el('apply').disabled,false);assert.match(h.el('apply').textContent,/查看.*原因/);h.click('apply');await h.wait();checkDiagnostic();assert.equal(h.appliedLayers.length,0);
  h.click('export-ai-reference');await h.wait();assert.deepEqual(h.files[`ps-ai-${job.id.slice(0,8)}-ai-reference.png`],raw);assert.equal(h.posts.length,1);assert.equal(h.appliedLayers.length,0);
  const trace=JSON.parse(String(h.files['runtime-trace.json']));assert.ok(trace.events.some((event:any)=>event.taskId===job.id&&event.stage==='relight.extraction.failed.structure-mismatch'));
 }finally{await h.close();}
});
