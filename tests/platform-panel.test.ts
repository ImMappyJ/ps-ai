import test from 'node:test';import assert from 'node:assert/strict';import {panelHarness} from './uxp-harness';import {defaultSettings} from '../src/infrastructure/config/profile';

test('ComfyUI never starts a relay, platform selection is explicit and per-platform profiles survive switches',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),baseUrl:'http://localhost:8288'}});
  try{await h.wait();assert.equal(h.relayLaunches.length,0);assert.ok(h.el('backend-kind').querySelector('option[value="gemini"]'));
    h.el('backend-kind').value='openai';h.change('backend-kind');await h.wait();assert.equal(h.el('backend-url').value,'http://127.0.0.1:8193');assert.equal(h.el('backend-url').disabled,true);assert.equal(h.el('gateway-key-settings').style.display,'block');
    h.el('api-key').value='test-secret';h.click('save-key');await h.wait();assert.equal(h.relayLaunches.length,1);assert.equal(h.el('api-key').value,'');assert.match(h.el('key-status').textContent,/已保存/);
    h.click('connect');await h.wait();assert.equal(h.configuredKeys.get('openai'),'test-secret');assert.equal(JSON.parse(String(h.files['settings.json'])).platform,'openai');assert.equal(h.el('connection').textContent,'已连接');assert.equal(h.gatewayPosts.length,0);assert.equal(h.captured.length,0);assert.doesNotMatch(String(h.files['settings.json']),/test-secret|apiKey/);
    h.el('backend-kind').value='comfyui';h.change('backend-kind');await h.wait();assert.equal(h.el('backend-url').value,'http://localhost:8288');assert.equal(h.relayLaunches.length,1);assert.equal(h.el('gateway-key-settings').style.display,'none');
  }finally{await h.close();}
});

test('managed Nano Banana disables transparent assets and seeds, keeps password out of language and history state',async()=>{
  const h=await panelHarness({settings:defaultSettings(),noDocuments:true});
  try{await h.wait();h.el('backend-kind').value='gemini';h.change('backend-kind');await h.wait();h.el('api-key').value='gemini-secret';h.click('save-key');await h.wait();h.click('connect');await h.wait();
    assert.equal(h.el('seed').disabled,true);assert.equal(h.el('output-depth').value,'8');h.click('tab-cosplay');assert.equal(h.el('generate').disabled,true);
    h.el('mode').value='costume';h.change('mode');h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('gateway-info').textContent,/Google Gemini|Nano Banana/);assert.equal(h.el('api-key').value,'');
    h.click('tab-t2i');h.click('generate');await h.wait();assert.equal(h.gatewayPosts.length,1);assert.equal(h.gatewayPosts[0].request.seed,0);assert.doesNotMatch(String(h.files['history.json']),/gemini-secret|apiKey/);
    h.click('clear-key');await h.wait();assert.equal(h.secrets.size,0);
  }finally{await h.close();}
});

test('saved managed profile starts without generating and blocks missing credentials before capture',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),backend:'gateway',platform:'bailian',baseUrl:'http://127.0.0.1:8191',gatewayModel:'qwen-image-2.1-pro',outputDepth:8}});
  try{await h.wait();assert.equal(h.relayLaunches.length,1);assert.ok(h.errors.some(e=>String(e).includes('面板保存')));h.click('generate');await h.wait();assert.equal(h.captured.length,0);assert.equal(h.uploads.length,0);assert.equal(h.gatewayPosts.length,0);assert.equal(h.el('backend-kind').value,'bailian');}finally{await h.close();}
});
test('scanning ComfyUI models preserves the unsaved custom address and selected depth',async()=>{const h=await panelHarness();try{await h.wait();h.el('backend-url').value='http://localhost:8288';h.el('output-depth').value='16';h.click('scan-models');await h.wait();assert.equal(h.el('backend-url').value,'http://localhost:8288');assert.equal(h.el('output-depth').value,'16');}finally{await h.close();}});

test('a completed managed output remains recoverable after its provider key is cleared',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),backend:'gateway',platform:'openai',baseUrl:'http://127.0.0.1:8193',gatewayModel:'gpt-image-1.5',outputDepth:8},noDocuments:true});
  try{
    await h.wait();h.el('api-key').value='synthetic-saved-key';h.click('save-key');await h.wait();h.click('connect');await h.wait();
    h.click('tab-t2i');h.click('generate');await h.wait();
    assert.equal(h.records()[0].state,'ready');
    // Represent a previously interrupted output download; the mock server keeps its completed result.
    const record=h.records()[0];record.state='output-error';delete record.outputFile;
    h.files['history.json']=JSON.stringify([record]);h.selectHistory(record.id);
    h.click('clear-key');await h.wait();assert.equal(h.secrets.size,0);
    h.click('recover');await h.wait();
    assert.equal(h.records()[0].state,'ready','Recovering an already completed output must not require an upstream API key');
  }finally{await h.close();}
});
