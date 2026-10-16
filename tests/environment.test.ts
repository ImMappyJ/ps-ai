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
