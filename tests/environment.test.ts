import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {checkEnvironment} from '../src/environment';
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
