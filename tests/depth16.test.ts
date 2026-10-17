import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {buildGraph,templateForDepth} from '../src/workflow';import {checkEnvironment} from '../src/environment';import {defaultSettings,validateSettings} from '../src/profile';import {ComfyClient} from '../src/client';import {panelHarness} from './uxp-harness';import {decodePng} from '../src/image';
const opts={requestId:'depth-test',prompt:'blue',seed:42,steps:25,resolution:768};
const schema={input:{required:{images:['IMAGE',{}],filename_prefix:['STRING',{default:'ps-ai/image'}]}},output:[]};
test('16-bit workflow is pinned separately and optional node does not block8',async()=>{
  assert.equal(buildGraph(opts)['8'].class_type,'SaveImage');assert.equal(buildGraph({...opts,outputDepth:16})['8'].class_type,'PS_AISavePNG16');assert.equal(templateForDepth(16),'qwen21-local-v3-rgba16');assert.equal(templateForDepth(8),'qwen21-local-v2-rgba');
  assert.throws(()=>buildGraph({...opts,outputDepth:12 as any}),/位深|depth/);
  const nodes=JSON.parse(fs.readFileSync('tests/fixtures/comfy-nodes.json','utf8'));assert.doesNotThrow(()=>checkEnvironment('27.0',nodes));
  assert.throws(()=>checkEnvironment('27.0',nodes,undefined,16),(e:any)=>e.code==='missing-node'&&/PS_AISavePNG16/.test(e.message));
  nodes.PS_AISavePNG16=schema;assert.doesNotThrow(()=>checkEnvironment('27.0',nodes,undefined,16));nodes.PS_AISavePNG16.input.required.images=['STRING',{}];assert.throws(()=>checkEnvironment('27.0',nodes,undefined,16));
});
test('settings persist output depth while old schema1 remains valid; reject ambiguous values',()=>{
  assert.equal(validateSettings({...defaultSettings(),outputDepth:16}).outputDepth,16);assert.equal(validateSettings(defaultSettings()).outputDepth,undefined);
  for(const outputDepth of [0,12,32,'16',null])assert.throws(()=>validateSettings({...defaultSettings(),outputDepth}));
});
// Full-size PNG round trips take 16–19s on hosted Windows runners; keep the
// real 768px fixture and all assertions without making host CPU speed a failure.
test('panel16 uses dedicated template,8-bit uploads/preview and16-bit stored export; history restores depth',{timeout:60_000},async()=>{
  const output={width:768,height:768,rgba:new Uint16Array(768*768*4)};for(let p=0;p<768*768;p++)output.rgba.set([12345,23456,34567,65535],p*4);
  const h=await panelHarness({settings:{...defaultSettings(),outputDepth:16},output,save16Node:true});try{
    await h.wait();assert.equal(h.el('output-depth').value,'16');h.el('resolution').value='768';h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.posts[0].prompt['8'].class_type,'PS_AISavePNG16');
    const record=h.records()[0];assert.equal(record.template,'qwen21-local-v3-rgba16');assert.equal((record.params as any).outputDepth,16);assert.ok(decodePng(h.files[String(record.outputFile)] as Uint8Array).rgba instanceof Uint16Array);
    assert.equal(h.uploads[0].image.rgba.BYTES_PER_ELEMENT,1);assert.equal(decodePng(Buffer.from(h.el('detail-preview').src.split(',')[1],'base64')).rgba.BYTES_PER_ELEMENT,1);
    h.el('output-depth').value='8';h.click('repeat-history');await h.wait();assert.equal(h.el('output-depth').value,'16');h.click('load-history');await h.wait();assert.ok(!h.errors.length);
  }finally{await h.close();}
});
test('missing16 node fails before posting/uploading while8 remains compatible',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),outputDepth:16}});try{await h.wait();h.click('generate');await h.wait();assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.match(h.el('diagnostic-summary').textContent,/节点|node/);}finally{await h.close();}
});
