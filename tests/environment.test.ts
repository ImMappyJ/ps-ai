import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {checkEnvironment} from '../src/diagnostics/environment';
const nodes=()=>JSON.parse(fs.readFileSync('tests/fixtures/comfy-nodes.json','utf8'));
test('template check accepts the observed API and rejects scalar and dynamic field drift',()=>{
  assert.doesNotThrow(()=>checkEnvironment('27.0.0',nodes()));
  for(const modify of [(n:any)=>delete n.KSampler.input.required.scheduler,(n:any)=>n.CLIPLoader.input.required.type=[['wrong']],(n:any)=>n.TextEncodeQwenImage21.input.required.resolution[1].min=1,(n:any)=>n.TextEncodeQwenImage21.input.required.images[1].template.names=['image_1']]){
    const n=nodes();modify(n);assert.throws(()=>checkEnvironment('27.0.0',n),(e:any)=>e.code==='incompatible-api');
  }
  assert.throws(()=>checkEnvironment('26.0.0',nodes()),/27/);
});

test('compatibility covers text-only generation as well as the edit/reference graph',()=>{
  const n=nodes();n.TextEncodeQwenImage21.input.required.resolution[1].max=0;
  assert.throws(()=>checkEnvironment('27.0.0',n),(e:any)=>e.code==='incompatible-api');
});

test('read-only compatibility rejects new required fields and scalar or dynamic link type drift',()=>{
  for(const modify of [
    (n:any)=>n.KSampler.input.required.new_input=['INT',{default:1}],
    (n:any)=>n.VAEDecode.input.required.samples=['IMAGE',{}],
    (n:any)=>n.TextEncodeQwenImage21.output[0]='STRING',
    (n:any)=>n.TextEncodeQwenImage21.input.required.images[1].template.input.required.image=['MASK',{}],
    (n:any)=>n.KSampler.input.required.steps=['STRING',{}]
  ]){const n=nodes();modify(n);assert.throws(()=>checkEnvironment('27.0.0',n),(e:any)=>e.code==='incompatible-api');}
  const optional=nodes();optional.KSampler.input.optional={new_input:['INT',{default:1}]};
  assert.doesNotThrow(()=>checkEnvironment('27.0.0',optional));
});

test('custom filenames pass read-only graph checks only when their loaders advertise them',()=>{
  const models={unet:'custom/qwen-image-2.1-Q5_K_M.gguf',clip:'custom/qwen21-compatible-encoder.safetensors',vae:'custom/qwen21-compatible-vae.safetensors'};
  const mappings=[['UnetLoaderGGUF','unet_name','unet'],['CLIPLoader','clip_name','clip'],['VAELoader','vae_name','vae']] as const;
  const customNodes=nodes();
  for(const [loader,field,role] of mappings)customNodes[loader].input.required[field][0]=[models[role]];
  assert.doesNotThrow(()=>checkEnvironment('27.0.0',customNodes,models));
  for(const [loader,field] of mappings){
    const missing=structuredClone(customNodes);missing[loader].input.required[field][0]=[];
    assert.throws(()=>checkEnvironment('27.0.0',missing,models),(error:any)=>error.code==='incompatible-api');
  }
  const mismatched=structuredClone(customNodes);mismatched.VAELoader.output[0]='IMAGE';
  assert.throws(()=>checkEnvironment('27.0.0',mismatched,models),(error:any)=>error.code==='incompatible-api');
});
