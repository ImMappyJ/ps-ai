import test from 'node:test';import assert from 'node:assert/strict';
import {setLanguage,t,errorText} from '../src/localization/i18n';
import {diagnostic,DiagnosticError} from '../src/diagnostics/diagnostics';
import {candidateOutputKind,prepareCandidate} from '../src/app/candidate-preparation';
import {encodePng} from '../src/imaging/image';
import {planRelightMemory} from '../src/imaging/budget';

test('large edit sizing, budget preflight and native alpha failures translate without changing numeric limits',()=>{
 const messages=['当前分辨率的候选准备预计需要 600 MB，超过图像内存预算；请降低分辨率后重新读取。','大区域历史的来源尺寸、原生蒙版或位深不一致；原始输出已保留','背景原生蒙版与冻结来源、主体或保护区不一致，请重新捕获','半透明来源的剪贴底层透明度不匹配，请重新捕获','生成背景的有效覆盖不足 90%；保留原始输出供检查和导出'];
 setLanguage('en-US');try{for(const message of messages)assert.doesNotMatch(errorText(message),/[一-龥]/);assert.match(errorText(messages[0]),/600 MB/);assert.match(errorText(messages[4]),/90%/);}
 finally{setLanguage('zh-CN');}
});

test('English budget diagnostics preserve numeric limits and source error contracts',()=>{
 setLanguage('en-US');try{
  assert.throws(()=>planRelightMemory(9001,5000,8),(error:any)=>{assert.equal(error.code,'image-budget');assert.match(error.message,/4500 万/);assert.match(errorText(error.message),/45 million/);return true;});
  const message='图像内存预算不足：预计峰值 765 MB，预算 384 MB；请缩小作用范围',error=new DiagnosticError('image-budget','capture',message),d=diagnostic(error,'capture');
  assert.equal(error.message,message);assert.match(d.summary,/765 MB.*384 MB/);assert.doesNotMatch(d.summary,/[一-龥]/);
  assert.match(errorText('结构保护排除了 25% 的不可靠区域。'),/25%/);assert.doesNotMatch(errorText('结构保护排除了 25% 的不可靠区域。'),/[一-龥]/);
 }finally{setLanguage('zh-CN');}
});

test('English layer and source action copy translates the newly added UI strings without rewriting IDs',()=>{
 const keys=['重新读取当前文档','来源文档已关闭；请重新读取当前文档。布光配置和可导出候选已保留。','已读取当前文档的可见合成，布光配置已保留；请检查位置后生成。旧候选仍可检查或导出。','来源范围已改变，请明确重新读取当前文档；布光配置已保留','正在提取光影影响场…','PS-AI 光影层 {0}','写入光影层 {0} / {1}','已应用独立光影层组；可编辑各通道、蒙版与不透明度，Ctrl+Z 一次撤销','光影层暂不支持作用范围内的透明/半透明来源；请缩小到不透明区域，或明确使用整图重绘并检查透明度','光影影响场的选区或保护区已改变，请重新读取原图'];
 setLanguage('en-US');try{
  for(const key of keys)assert.doesNotMatch(t(key,'abcd1234',5),/[一-龥]/);
  assert.equal(t('PS-AI 光影层 {0}','abcd1234'),'PS-AI lighting layers abcd1234');assert.equal(t('写入光影层 {0} / {1}',2,5),'Writing lighting layers 2 / 5');
  assert.throws(()=>candidateOutputKind({relight:{outputKind:'unsupported'}} as any),(error:any)=>error.code==='invalid-output'&&!/[一-龥]/.test(error.message));
 }finally{setLanguage('zh-CN');}
});

test('stale applied opacity guidance translates in English without changing the source error',()=>{
 const message='来源文档内容已改变，请在 PS 图层面板调整不透明度或重新读取原图',error=new Error(message);
 setLanguage('en-US');try{
  assert.match(errorText(message),/source document.*changed/i);assert.match(errorText(message),/Photoshop Layers panel/);assert.match(errorText(message),/opacity.*read the source again/i);
  assert.doesNotMatch(errorText(message),/[一-龥]/);assert.equal(diagnostic(error,'apply').summary,errorText(message));assert.equal(error.message,message);
 }finally{setLanguage('zh-CN');}
});

test('a rejected lighting reference translates the nested cause while keeping its output identity',async()=>{
 const {RelightSession,relightTaskMetadata}=await import('../src/features/relight/relight-session');
 const source={width:2,height:2,rgba:new Uint8Array(16).fill(255)},mask=new Uint8Array(4).fill(255),snapshot={documentId:11,width:2,height:2,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:8,historyId:1,sessionId:'source-session',bounds:{left:0,top:0,right:2,bottom:2},mask,sourceHash:'opaque',sourceLayerIds:[2],captureGeometry:{kind:'relight-analysis' as const,width:2,height:2}};
 const session=new RelightSession({image:source,snapshot,selectionMask:mask,protectionMask:new Uint8Array(4)},'snapshot','scene','document'),id='11111111-1111-4111-8111-111111111111',frozen=session.freeze(),metadata=relightTaskMetadata(frozen,id,{provider:'comfyui',model:'fixture',edit:true,maxInputImages:3,maskMode:'none',seed:true},{width:2,height:2},8,0);
 const record:any={id,createdAt:'2026-10-19',template:'qwen21-local-v2-rgba',snapshot:(({mask:_,...rest})=>rest)(snapshot),relight:metadata,params:{mode:'relight',outputKind:'edit',modelSize:{width:2,height:2}}};
 setLanguage('en-US');try{
  const result=await prepareCandidate(record,encodePng({width:2,height:2,rgba:new Uint8Array(16)}),async name=>name.endsWith('mask.bin')?mask:encodePng(source));
  assert.equal(result.outputKind,'lighting-layers');assert.ok(result.warning);assert.match(result.warning!,/AI reference/);assert.doesNotMatch(result.warning!,/[一-龥]/);assert.equal(result.image.rgba[3],0,'raw rejected output is retained rather than a redraw fallback');
 }finally{setLanguage('zh-CN');}
});
