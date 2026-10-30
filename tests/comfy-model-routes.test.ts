import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ComfyClient} from '../src/infrastructure/backends/client';
import {DEFAULT_MODELS,defaultSettings,validateModels,validateSettings,switchConnection} from '../src/infrastructure/config/profile';
import {buildGraph} from '../src/generation/workflow';
import {checkEnvironment} from '../src/diagnostics/environment';
import {suggestModelMappings} from '../src/diagnostics/model-discovery';
import {panelHarness} from './uxp-harness';

const nativeModels={...DEFAULT_MODELS,unet:'owned/qwen-image-2.1-bf16.safetensors'};
function nodes(){const result=JSON.parse(fs.readFileSync('tests/fixtures/comfy-nodes.json','utf8'));result.UNETLoader={input:{required:{unet_name:[[nativeModels.unet]],weight_dtype:[['default','fp8_e4m3fn']]}},output:['MODEL']};return result;}
function client(info:Record<string,any>,models=DEFAULT_MODELS,override?:(loader:string)=>Response|undefined){return new ComfyClient('http://localhost:8188',async(url)=>{const loader=String(url).split('/').pop()!;return loader==='system_stats'?Response.json({}):override?.(loader)??Response.json(info[loader]?{[loader]:info[loader]}:{});},30000,models);}

test('native diffusion settings preserve schema 1 and survive platform round trips',()=>{
  for(const unet of [nativeModels.unet,'owned\\QWEN.SAFETENSORS']){
    const settings=validateSettings({...defaultSettings(),models:{...nativeModels,unet}});
    assert.equal(settings.schemaVersion,1);assert.equal(switchConnection(switchConnection(settings,'openai'),'comfyui').models.unet,unet);
  }
  for(const unet of ['D:\\weights\\model.safetensors','/model.safetensors','../model.safetensors','nested/../model.safetensors','nested//model.safetensors','model.ckpt','model.bin','model.safetensors ',...[':', '*', '?', '"', '<', '>', '|'].map(character=>`owned${character}/model.safetensors`)])assert.throws(()=>validateModels({...nativeModels,unet}));
  for(const role of ['clip','vae'])assert.throws(()=>validateModels({...nativeModels,[role]:'model.gguf'}));
});

test('native graphs replace only the diffusion loader for text/edit and both output depths',()=>{
  for(const source of [undefined,'source.png'])for(const outputDepth of [8,16] as const){
    const options={requestId:'route-test',prompt:'blue cup',seed:42,steps:25,resolution:768,source,...(source?{guide:'guide.png',reference:'reference.png'}:{}),outputDepth};
    const legacy=buildGraph(options),native=buildGraph({...options,models:nativeModels});
    assert.deepEqual(native['1'],{class_type:'UNETLoader',inputs:{unet_name:nativeModels.unet,weight_dtype:'default'}});
    assert.deepEqual(legacy['1'],{class_type:'UnetLoaderGGUF',inputs:{unet_name:DEFAULT_MODELS.unet}});
    const {['1']:legacyLoader,...legacyRest}=legacy,{['1']:nativeLoader,...nativeRest}=native;assert.deepEqual(nativeRest,legacyRest);
    assert.equal(native['8'].class_type,outputDepth===16?'PS_AISavePNG16':'SaveImage');
    if(source){assert.deepEqual(native['12'].inputs.alpha,['9',1]);assert.deepEqual(native['4'].inputs['images.image_3'],['14',0]);}
  }
});

test('native-only discovery works with old GGUF defaults and lists only matching-format relative files',async()=>{
  const info=nodes();delete info.UnetLoaderGGUF;info.UNETLoader.input.required.unet_name[0].push('wrong.gguf','../escape.safetensors');
  info.CLIPLoader.input.required.clip_name[0].push('wrong.gguf');
  const result=await client(info).inspect();assert.deepEqual(result.models,{unet:[nativeModels.unet],clip:[DEFAULT_MODELS.clip],vae:[DEFAULT_MODELS.vae]});
  await client(info,nativeModels).check();await assert.rejects(client(info).check(),(error:any)=>error.code==='missing-node'&&error.message.includes('UnetLoaderGGUF'));
});

test('loader selection ignores extension case while backend filename matching remains exact',async()=>{
  const models={...nativeModels,unet:'owned/QWEN.SAFETENSORS'},info=nodes();info.UNETLoader.input.required.unet_name[0]=[models.unet];
  assert.deepEqual(buildGraph({requestId:'case-test',prompt:'blue cup',seed:42,steps:25,resolution:768,models})['1'],{class_type:'UNETLoader',inputs:{unet_name:models.unet,weight_dtype:'default'}});
  assert.deepEqual((await client(info,models).inspect()).models.unet,[DEFAULT_MODELS.unet,models.unet]);await client(info,models).check();
  await assert.rejects(client(info,{...models,unet:models.unet.toLowerCase()}).check(),(error:any)=>error.code==='missing-model');
});

test('selected loader must advertise its own format even when the wrong loader lists the filename',async()=>{
  for(const [selected,wrong,models] of [['UNETLoader','UnetLoaderGGUF',nativeModels],['UnetLoaderGGUF','UNETLoader',DEFAULT_MODELS]] as const){
    const info=nodes();info[selected].input.required.unet_name[0]=[];info[wrong].input.required.unet_name[0]=[models.unet];
    assert.deepEqual((await client(info,models).inspect()).models.unet,[]);
    await assert.rejects(client(info,models).check(),(error:any)=>error.code==='missing-model');
    delete info[selected];await assert.rejects(client(info,models).check(),(error:any)=>error.code==='missing-node'&&error.message.includes(selected));
  }
});

test('absent unused loader is optional while malformed or failed loader responses remain errors',async()=>{
  const info=nodes();delete info.UNETLoader;await client(info).check();
  for(const response of [null,[],42,{}, {input:{required:{unet_name:['STRING']}}},{input:{required:{unet_name:[[42]]}}}]){
    await assert.rejects(client({...info,UNETLoader:response},DEFAULT_MODELS,loader=>loader==='UNETLoader'?Response.json({UNETLoader:response}):undefined).inspect(),(error:any)=>error.code==='incompatible-api');
  }
  for(const body of [null,[],42,{OtherLoader:{}}])await assert.rejects(client(info,DEFAULT_MODELS,loader=>loader==='UNETLoader'?Response.json(body):undefined).inspect(),(error:any)=>error.code==='incompatible-api');
  await assert.rejects(client(info,DEFAULT_MODELS,loader=>{if(loader==='UNETLoader')throw new TypeError('offline');return undefined;}).inspect(),(error:any)=>error.code==='unreachable');
  await assert.rejects(client(info,DEFAULT_MODELS,loader=>loader==='UNETLoader'?new Response('not found',{status:404}):undefined).inspect(),(error:any)=>error.code==='incompatible-api');
});

for(const [unused,models] of [['UNETLoader',DEFAULT_MODELS],['UnetLoaderGGUF',nativeModels]] as const)test(`object-shaped model definition in unused ${unused} rejects before submission`,async()=>{
  const info=nodes(),id='00000000-0000-4000-8000-000000000001';let submissions=0;
  info[unused].input.required.unet_name={'0':[unused==='UNETLoader'?nativeModels.unet:DEFAULT_MODELS.unet]};
  const backend=client(info,models,route=>{if(route!=='prompt')return undefined;submissions++;return Response.json({prompt_id:id});});
  await assert.rejects(async()=>{await backend.check();await backend.submit(buildGraph({requestId:id,prompt:'blue cup',seed:42,steps:25,resolution:768,models}),id,id);},(error:any)=>error.code==='incompatible-api'&&error.message.includes(`${unused}.unet_name`));
  assert.equal(submissions,0);
  await assert.rejects(backend.inspect(),(error:any)=>error.code==='incompatible-api'&&error.message.includes(`${unused}.unet_name`));
});

test('environment validates native weight dtype and model socket without requiring GGUF',()=>{
  const info=nodes();delete info.UnetLoaderGGUF;assert.doesNotThrow(()=>checkEnvironment('27.0.0',info,nativeModels));
  for(const modify of [(value:any)=>value.UNETLoader.input.required.weight_dtype=[['fp8_e4m3fn']],(value:any)=>delete value.UNETLoader.input.required.weight_dtype,(value:any)=>value.UNETLoader.output=['IMAGE'],(value:any)=>value.UNETLoader.input.required.extra=['STRING']]){
    const broken=structuredClone(info);modify(broken);assert.throws(()=>checkEnvironment('27.0.0',broken,nativeModels),(error:any)=>error.code==='incompatible-api');
  }
});

test('discovery never silently replaces a missing native mapping with a GGUF preset',()=>{
  const current={...nativeModels};const inventory={unet:[DEFAULT_MODELS.unet,'other.safetensors'],clip:[current.clip],vae:[current.vae]};
  assert.deepEqual(suggestModelMappings(inventory,current),{models:current,changed:[],unresolved:['unet']});
  inventory.unet.push(current.unet);assert.deepEqual(suggestModelMappings(inventory,current),{models:current,changed:[],unresolved:[]});
});

test('panel submits native settings through the native loader after connection checks',async()=>{
  const panel=await panelHarness({settings:{...defaultSettings(),models:nativeModels},models:nativeModels});
  try{await panel.wait();panel.el('resolution').value='32';panel.click('generate');await panel.wait();assert.equal(panel.posts.length,1);assert.deepEqual(panel.posts[0].prompt['1'],{class_type:'UNETLoader',inputs:{unet_name:nativeModels.unet,weight_dtype:'default'}});}finally{await panel.close();}
});

test('panel scanning retains a missing native mapping and requires explicit selection',async()=>{
  const panel=await panelHarness({settings:{...defaultSettings(),models:nativeModels},modelInventory:{unet:[DEFAULT_MODELS.unet],clip:[nativeModels.clip],vae:[nativeModels.vae]}});
  try{await panel.wait();panel.click('scan-models');await panel.wait();assert.equal(panel.el('model-unet').value,nativeModels.unet);assert.match(panel.el('model-scan-report').textContent,/unet/);assert.equal(panel.posts.length,0);}finally{await panel.close();}
});
