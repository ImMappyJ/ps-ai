import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_MODELS,defaultSettings} from '../src/infrastructure/config/profile';
import {panelHarness} from './uxp-harness';

const nativeModels={...DEFAULT_MODELS,unet:'owned/Qwen-Image-2.1.SAFETENSORS'};
function assertReadOnly(panel:Awaited<ReturnType<typeof panelHarness>>){assert.equal(panel.posts.length,0);assert.equal(panel.uploads.length,0);assert.ok(panel.requests.every(request=>request.method==='GET'));}

for(const [name,models,label,loader] of [['native',nativeModels,/原生 Safetensors/,/UNETLoader/],['GGUF',DEFAULT_MODELS,/GGUF/,/UnetLoaderGGUF/]] as const)test(`${name} route is derived from the exact selected filename and reports only checked nodes`,async()=>{
  const panel=await panelHarness({settings:{...defaultSettings(),models},models});
  try{
    await panel.wait();assert.ok(panel.el('model-route'),'selected diffusion route is visible');assert.match(panel.el('model-route').textContent,label);assert.match(panel.el('model-route').textContent,loader);
    panel.click('connect');await panel.wait();assert.equal(panel.el('connection').textContent,'节点已检查');
    assert.match(panel.el('status').textContent,/权重.*未验证/);assertReadOnly(panel);
    const saved=JSON.parse(String(panel.files['settings.json']));assert.equal(saved.schemaVersion,1);assert.equal(saved.models.unet,models.unet);assert.equal(saved.route,undefined);
    panel.el('language').value='en-US';panel.change('language');await panel.wait();assert.equal(panel.el('connection').textContent,'Nodes checked');
    assert.match(panel.el('model-route').textContent,name==='native'?/Native Safetensors.*ComfyUI built-in.*UNETLoader/:/GGUF.*UnetLoaderGGUF/);assert.equal(panel.el('model-unet').value,models.unet);
  }finally{await panel.close();}
});

for(const field of ['unet','clip','vae'] as const)test(`changing selected ${field} invalidates the successful node check`,async()=>{
  const panel=await panelHarness({settings:defaultSettings()});
  try{
    await panel.wait();panel.click('connect');await panel.wait();
    panel.el(`model-${field}`).value=field==='unet'?nativeModels.unet:`owned/other-${field}.safetensors`;panel.change(`model-${field}`);
    assert.equal(panel.el('connection').textContent,'待检查');assert.equal(panel.el('workflow-guide').getAttribute('data-step'),'connection');
    if(field==='unet')assert.match(panel.el('model-route').textContent,/原生 Safetensors.*UNETLoader/);assertReadOnly(panel);
  }finally{await panel.close();}
});

test('manual gateway retains platform connection wording and hides the local route',async()=>{
  const panel=await panelHarness({settings:{...defaultSettings(),backend:'gateway',gatewayModel:'qwen-image-2.1-pro'},gateway:{provider:'bailian'}});
  try{
    await panel.wait();panel.click('connect');await panel.wait();assert.equal(panel.el('connection').textContent,'已连接');
    assert.match(panel.el('status').textContent,/平台服务配置检查通过/);assert.equal(panel.el('local-model-settings').style.display,'none');assertReadOnly(panel);
  }finally{await panel.close();}
});

for(const [name,options,title] of [
  ['file',{models:nativeModels,modelInventory:{unet:['other.safetensors'],clip:[nativeModels.clip],vae:[nativeModels.vae]}},'后端缺少模型'],
  ['node',{},'后端缺少节点'],
  ['network',{baseUrl:'http://offline.invalid:9999'},'无法连接后端']
] as const)test(`native ${name} failure stays distinct and never recommends installing GGUF`,async()=>{
  const {baseUrl,...harnessOptions}=options as any;
  const panel=await panelHarness({...harnessOptions,settings:{...defaultSettings(),models:nativeModels,...(baseUrl?{baseUrl}:{})}});
  try{
    await panel.wait();panel.click('connect');await panel.wait();assert.equal(panel.el('diagnostic-title').textContent,title);
    assert.notEqual(panel.el('connection').textContent,'节点已检查');assert.doesNotMatch(panel.el('diagnostic-action').textContent,/GGUF/);assertReadOnly(panel);
  }finally{await panel.close();}
});

test('scanning retains an explicit missing native selection without claiming checked weights',async()=>{
  const panel=await panelHarness({settings:{...defaultSettings(),models:nativeModels},modelInventory:{unet:[DEFAULT_MODELS.unet,'other.safetensors'],clip:[nativeModels.clip],vae:[nativeModels.vae]}});
  try{
    await panel.wait();panel.click('scan-models');await panel.wait();assert.equal(panel.el('model-unet').value,nativeModels.unet);
    assert.ok(panel.el('model-route'),'selected diffusion route is visible');assert.match(panel.el('model-route').textContent,/原生 Safetensors/);assert.match(panel.el('model-scan-report').textContent,/unet/);
    assert.match(panel.el('status').textContent,/不代表架构兼容/);assert.notEqual(panel.el('connection').textContent,'节点已检查');assertReadOnly(panel);
  }finally{await panel.close();}
});
