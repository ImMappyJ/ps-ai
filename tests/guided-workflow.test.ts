import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';
import {SourceCaption} from '../src/app/panel-view';
import {parseHTML} from 'linkedom';
import {setLanguage} from '../src/localization/i18n';
import {encodePng} from '../src/imaging/image';

test('creation guidance routes to connection setup without submitting or capturing',async()=>{
  const panel=await panelHarness({settings:defaultSettings()});
  try{
    await panel.wait();assert.ok(panel.el('workflow-next'),'creation exposes one next-step action');
    assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'connection');
    panel.click('workflow-next');await panel.wait();
    assert.equal(panel.el('view-settings').style.display,'block');assert.equal(panel.el('settings-body').style.display,'block');
    assert.equal(panel.posts.length,0);assert.equal(panel.pixelRequests.length,0);assert.equal(panel.requests.length,0);
    panel.click('connect');await panel.wait();panel.click('nav-create');
    assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'source');
    panel.click('workflow-next');await panel.wait();
    assert.equal(panel.el('selection-previews').style.display,'flex');assert.equal(panel.posts.length,0);
    assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'ready');
    panel.click('workflow-next');await panel.wait();assert.equal(panel.el('generation-body').style.display,'block');assert.equal(panel.posts.length,0);
    panel.el('backend-url').value='http://localhost:8199';panel.event('backend-url','input');
    assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'connection');assert.match(panel.el('workflow-title').textContent,/保存/);
    panel.el('backend-url').value=defaultSettings().baseUrl;panel.event('backend-url','input');panel.switchDocument(33);panel.showPanel();await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'source');assert.equal(panel.posts.length,0);
  }finally{await panel.close();}
});

test('source-first controls and optional disclosure keep draft values while privacy stays in settings',async()=>{
  const panel=await panelHarness({settings:defaultSettings(),panelWidth:300});
  try{
    await panel.wait();
    const create=Array.from(panel.el('view-create').children);
    assert.ok(create.indexOf(panel.el('selection-tools'))<create.indexOf(panel.el('prompt-group')));
    assert.equal(panel.el('generation-body').style.display,'none');assert.equal(panel.el('protection-body').style.display,'none');
    assert.equal(panel.el('remember-source-access').closest('[data-panel-page]').id,'view-settings');
    assert.equal(panel.el('forget-source-access').closest('[data-panel-page]').id,'view-settings');
    panel.click('toggle-generation');panel.el('count').value='3';panel.change('count');
    assert.match(panel.el('generation-summary').textContent,/3/);panel.click('toggle-generation');
    panel.click('toggle-protection');assert.equal(panel.el('protection-body').style.display,'flex');
    panel.el('language').value='en-US';panel.change('language');await panel.wait();
    assert.equal(panel.el('count').value,'3');assert.equal(panel.el('generation-body').style.display,'none');
    assert.doesNotMatch(panel.el('generation-summary').textContent,/[一-龥]/);assert.doesNotMatch(panel.el('workflow-title').textContent,/[一-龥]/);
    panel.click('tab-t2i');await panel.wait();assert.match(panel.el('generation-summary').textContent,/New document/);assert.doesNotMatch(panel.el('generation-summary').textContent,/[一-龥]/);
    assert.equal(panel.posts.length,0);assert.equal(panel.requests.length,0);
  }finally{await panel.close();}
});

test('busy and unresolved guidance preserve cancellation and exact history ownership',async()=>{
  const pending={id:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222',state:'unknown' as const,createdAt:'2026-10-30',graph:{},baseUrl:'http://localhost:8188',params:{workspace:'local',mode:'edit'}};
  const panel=await panelHarness({settings:defaultSettings(),history:[pending]});
  try{
    await panel.wait();assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'pending');
    panel.click('workflow-next');await panel.wait();assert.equal(panel.el('history-id').value,pending.id);assert.equal(panel.posts.length,0);
    panel.click('nav-create');panel.holdCheck();panel.click('connect');await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(panel.el('workflow-next').disabled,true);assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'busy');
    panel.click('workflow-next');assert.equal(panel.posts.length,0);panel.releaseCheck();await panel.wait();
  }finally{panel.releaseCheck();await panel.close();}
});

test('approximate sRGB source warning remains distinct from verified PNG in both languages',()=>{
  const {document}=parseHTML('<p id="caption"></p><p id="warning"></p>');
  const caption=document.getElementById('caption')!,warning=document.getElementById('warning')!;
  const source=new SourceCaption(caption,warning);
  try{
    for(const language of ['zh-CN','en-US'] as const){
      setLanguage(language);source.show({documentId:22,width:2,height:2,profile:'sRGB IEC61966-2.1',protectedArea:false,colorReason:'assumed-srgb'});
      assert.equal(warning.style.display,'block');assert.match(caption.textContent!,/sRGB/);assert.doesNotMatch(caption.textContent!,/PNG|WebP/);
      assert.match(warning.textContent!,language==='en-US'?/colors may differ/i:/颜色可能有偏差/);
      source.show({documentId:22,width:2,height:2,profile:'sRGB IEC61966-2.1',protectedArea:false,colorReason:'png-srgb'});
      assert.equal(warning.style.display,'none');assert.match(caption.textContent!,/PNG/);
    }
  }finally{setLanguage('zh-CN');}
});

test('approximate source provenance remains visible on saved candidate results and history',async()=>{
  const panel=await panelHarness({settings:defaultSettings(),untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)})}});
  try{
    await panel.wait();panel.el('resolution').value='32';panel.click('generate');await panel.wait();
    assert.equal((panel.records()[0].snapshot as any).colorReason,'assumed-srgb');
    assert.equal(panel.el('candidate-color-warning')?.style.display,'block');assert.match(panel.el('candidate-color-warning').textContent,/颜色可能有偏差/);
    panel.selectHistory(panel.records()[0].id);panel.click('nav-history');assert.match(panel.el('history-details').textContent,/假定 sRGB/);
    panel.el('language').value='en-US';panel.change('language');await panel.wait();
    assert.match(panel.el('candidate-color-warning').textContent,/colors may differ/);assert.match(panel.el('history-details').textContent,/assumed sRGB/);
    assert.equal(panel.sourceAccessEvents.filter(event=>event==='picker').length,0);assert.equal(panel.posts.length,1);
  }finally{await panel.close();}
});

test('guided preview restores a dropped working-copy selection before fresh Generate capture',async()=>{
  const panel=await panelHarness({settings:defaultSettings(),untaggedSource:{bytes:encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)})}});
  try{
    const original=panel.ps.app.activeDocument,duplicate=original.duplicate;let dropped=false;
    original.duplicate=async(...args:any[])=>{
      const copy=await duplicate(...args);dropped=true;
      Object.defineProperty(copy,'selection',{configurable:true,get:()=>({bounds:dropped?null:panel.selectionState().bounds})});return copy;
    };
    const putSelection=panel.ps.imaging.putSelection;panel.ps.imaging.putSelection=async(options:any)=>{await putSelection(options);dropped=false;};
    await panel.wait();panel.click('connect');await panel.wait();panel.click('nav-create');panel.click('workflow-next');await panel.wait();
    assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'ready');assert.ok(panel.ps.app.activeDocument.selection.bounds);
    const previewReads=panel.pixelRequests.length;panel.el('resolution').value='32';panel.click('generate');await panel.wait();
    assert.equal(panel.posts.length,1);assert.ok(panel.pixelRequests.length>previewReads);assert.equal(panel.selectionWrites.length,1);assert.equal(panel.selectionWrites[0].documentID,22);
    assert.equal(original.colorProfileName,'');assert.equal(original.activeHistoryState.id,1);assert.equal(panel.sourceAccessEvents.filter(event=>event==='picker').length,0);
    assert.equal((panel.records()[0].snapshot as any).documentId,22);
  }finally{await panel.close();}
});

test('model scan reports rerender on language changes without new network reads or mapping changes',async()=>{
  const panel=await panelHarness({settings:defaultSettings()});
  try{
    await panel.wait();panel.click('scan-models');await panel.wait();
    assert.match(panel.el('model-scan-report').textContent,/已保留/);const requests=panel.requests.length;
    const models=['model-unet','model-clip','model-vae'].map(id=>panel.el(id).value);
    panel.el('language').value='en-US';panel.change('language');await panel.wait();
    assert.doesNotMatch(panel.el('model-scan-report').textContent,/[一-龥]/);assert.match(panel.el('model-scan-report').textContent,/preserved|retained|unique/i);
    assert.equal(panel.requests.length,requests);assert.deepEqual(['model-unet','model-clip','model-vae'].map(id=>panel.el(id).value),models);assert.equal(panel.posts.length,0);
    panel.el('language').value='zh-CN';panel.change('language');await panel.wait();assert.match(panel.el('model-scan-report').textContent,/已保留/);assert.equal(panel.requests.length,requests);
  }finally{await panel.close();}
});

test('missing and ambiguous model roles retain their guidance and exact names across language changes',async()=>{
  const panel=await panelHarness({settings:defaultSettings(),modelInventory:{unet:[],clip:[`a/${defaultSettings().models.clip}`,`b/${defaultSettings().models.clip}`],vae:[]}});
  try{
    await panel.wait();panel.click('scan-models');await panel.wait();assert.match(panel.el('model-scan-report').textContent,/缺失.*unet, clip, vae/);
    const requests=panel.requests.length,models=['model-unet','model-clip','model-vae'].map(id=>panel.el(id).value);
    panel.el('language').value='en-US';panel.change('language');await panel.wait();assert.match(panel.el('model-scan-report').textContent,/unet, clip, vae/);assert.doesNotMatch(panel.el('model-scan-report').textContent,/[一-龥]/);
    assert.deepEqual(['model-unet','model-clip','model-vae'].map(id=>panel.el(id).value),models);assert.equal(panel.requests.length,requests);assert.equal(panel.posts.length,0);
  }finally{await panel.close();}
});
