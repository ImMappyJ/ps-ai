import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {HistoryPreview} from '../src/app/history-preview';
import {RelightExtractionError} from '../src/features/relight/relight-layers';
import {setLanguage} from '../src/localization/i18n';
import type {JobRecord} from '../src/generation/jobs';

const record:JobRecord={id:'11111111-1111-4111-8111-111111111111',clientId:'client',state:'ready',graph:{},createdAt:'2026-10-19',outputFile:'saved.png'};

test('history preview labels a lighting composite separately from an extraction-failed reference and translates cached reasons',async()=>{
 const {document}=parseHTML('<html><img id="image"><p id="caption"></p></html>'),image=document.getElementById('image') as unknown as HTMLImageElement,caption=document.getElementById('caption')!;
 let current={url:'data:image/png;base64,composite',label:'光影合成预览',lightingFailure:undefined as Error|undefined},reads=0;
 const preview=new HistoryPreview(image,caption,async()=>{reads++;return current;});
 try{
  preview.show(record);await Promise.resolve();await Promise.resolve();assert.equal(caption.textContent,'光影合成预览');assert.equal(image.alt,'光影合成预览');
  current={url:'data:image/png;base64,reference',label:'AI 参考图（提取失败，仅供检查）',lightingFailure:new RelightExtractionError('unsupported-boundary',{boundaryPixels:7})};
  preview.invalidate();preview.show(record);await Promise.resolve();await Promise.resolve();assert.match(caption.textContent,/AI 参考图.*提取失败.*仅供检查/);assert.match(caption.textContent,/局部.*边界/);assert.equal(image.alt,'AI 参考图（提取失败，仅供检查）');
  setLanguage('en-US');preview.show(record);assert.match(caption.textContent,/AI reference.*extraction failed.*inspection only/);assert.match(caption.textContent,/local.*boundar/);assert.doesNotMatch(caption.textContent,/[一-龥]/);assert.equal(reads,2,'language changes render the cached local result without another decode');
 }finally{setLanguage('zh-CN');}
});
