import test from 'node:test';import assert from 'node:assert/strict';import {defaultSettings,validateSettings,validateModels,switchConnection,rememberConnection} from '../src/profile';import {buildGraph} from '../src/workflow';
const models={unet:'qwen/qwen-image-2.1-Q4_K_M.gguf',clip:'qwen/qwen3vl_8b_int8_convrot.safetensors',vae:'qwen/qwen_image_2.1_vae_bf16.safetensors'};
test('platform profiles preserve custom ComfyUI address/depth and each model without exporting secrets',()=>{
  const local={...defaultSettings(),baseUrl:'http://192.168.1.10:8288',outputDepth:16 as const};
  const openai=switchConnection(local,'openai');assert.equal(openai.baseUrl,'http://localhost:8193');assert.equal(openai.backend,'gateway');assert.equal(openai.platform,'openai');assert.equal(openai.outputDepth,8);
  const saved=rememberConnection({...openai,gatewayModel:'gpt-image-2.5-flare'});const gemini=switchConnection(saved,'gemini');assert.equal(gemini.gatewayModel,'gemini-2.5-flash-image');
  assert.equal(switchConnection(gemini,'openai').gatewayModel,'gpt-image-2.5-flare');const restored=switchConnection(gemini,'comfyui');assert.equal(restored.baseUrl,local.baseUrl);assert.equal(restored.outputDepth,16);
  assert.throws(()=>validateSettings({...openai,baseUrl:'https://evil.example'}));assert.throws(()=>validateSettings({...openai,platform:'other'}));
  assert.doesNotMatch(JSON.stringify(validateSettings({...saved,apiKey:'private-key'})),/private-key/);
});
test('迁移设置只包含服务与模型搜索相对名，默认值不共享可变对象',()=>{
  const a=defaultSettings(),b=defaultSettings();a.models.unet='changed.gguf';assert.equal(b.models.unet,'qwen-image-2.1-Q4_K_M.gguf');
  assert.equal(defaultSettings().baseUrl,'http://localhost:8188');
  assert.deepEqual(validateSettings({schemaVersion:1,baseUrl:' http://127.0.0.1:8188/ ',models}),{schemaVersion:1,baseUrl:'http://localhost:8188',models});
  assert.deepEqual(validateSettings({schemaVersion:1,baseUrl:'http://localhost:8188',models}),{schemaVersion:1,baseUrl:'http://localhost:8188',models});
});
test('配置允许自定义 HTTP(S) 主机与端口，只接受服务根地址',()=>{
  for(const baseUrl of ['http://localhost:8199','http://192.168.1.10:8188','https://comfy.example.com','http://[::1]:8188'])assert.equal(validateSettings({schemaVersion:1,baseUrl,models}).baseUrl,baseUrl);
  for(const baseUrl of ['file:///tmp','ftp://host','http://user:password@host','http://host/path','http://host?token=x','http://host#x','http://host:0','http://host:65536','http://host\\evil','http://host\n.evil'])assert.throws(()=>validateSettings({schemaVersion:1,baseUrl,models}));
  for(const value of [{schemaVersion:2,baseUrl:'http://127.0.0.1:8188',models},{schemaVersion:1,baseUrl:'http://127.0.0.1:8188',models:{unet:'x.gguf'}}])assert.throws(()=>validateSettings(value));
});
test('语言选择随可迁移配置保存，旧配置仍可读取',()=>{
  assert.equal(validateSettings({schemaVersion:1,baseUrl:'http://localhost:8188',models,language:'en-US'}).language,'en-US');
  assert.throws(()=>validateSettings({schemaVersion:1,baseUrl:'http://localhost:8188',models,language:'xx'}));
});
test('模型映射拒绝绝对路径、遍历与不匹配格式，保留后端返回的相对分隔符',()=>{
  assert.equal(validateModels({...models,unet:'qwen\\model.gguf'}).unet,'qwen\\model.gguf');
  for(const unet of ['D:\\models\\x.gguf','/models/x.gguf','../x.gguf','qwen/../../x.gguf','x.safetensors'])assert.throws(()=>validateModels({...models,unet}));
});
test('配置的三个模型字段进入固定图，不覆盖参考图或工作流结构',()=>{
  const g=buildGraph({requestId:'test',prompt:'repair prop',seed:42,steps:25,resolution:992,source:'original.png',models});
  assert.equal(g['1'].inputs.unet_name,models.unet);assert.equal(g['2'].inputs.clip_name,models.clip);assert.equal(g['3'].inputs.vae_name,models.vae);
  assert.deepEqual(g['4'].inputs['images.image_1'],['12',0]);assert.equal(g['4'].inputs.resolution,0);
});
