import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import {readFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseP0Options} from '../scripts/p0-config';
import {runP0} from '../scripts/p0-live';
import {encodePng} from '../src/imaging/image';

test('P0 requires explicit settings and output directory and rejects ambiguous arguments',()=>{
  assert.deepEqual(parseP0Options(['--settings','custom.json','--output-dir','new-run']),{settingsPath:'custom.json',outputDir:'new-run',run:false});
  assert.deepEqual(parseP0Options(['--run','--output-dir','new-run','--settings','custom.json']),{settingsPath:'custom.json',outputDir:'new-run',run:true});
  for(const args of [[],['--settings','file'],['--output-dir','dir'],['--settings','--run','--output-dir','dir'],['--settings','','--output-dir','dir'],['--settings','file','--output-dir','dir','--wat'],['--settings','file','--settings','other','--output-dir','dir'],['--settings','file','--output-dir','dir','--run','--run']])assert.throws(()=>parseP0Options(args));
});

const models={unet:'native/custom.safetensors',clip:'chosen/clip.safetensors',vae:'chosen/vae.safetensors'};
async function fixture(depth:8|16=8){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'psai-p0-')),settingsPath=path.join(root,'settings.json'),outputDir=path.join(root,'output');
  await fs.writeFile(settingsPath,JSON.stringify({schemaVersion:1,baseUrl:'http://chosen.test:9818',models,outputDepth:depth,apiKey:'private-secret',connections:{gateway:{baseUrl:'https://private.test',models}}}));
  return {root,settingsPath,outputDir,clean:()=>fs.rm(root,{recursive:true,force:true})};
}

test('P0 dry run prints a sanitized explicit plan without network or filesystem writes',async()=>{
  const setup=await fixture(),logs:string[]=[];
  try{
    const result=await runP0({...setup,run:false},{transport:async()=>{throw Error('dry run reached network');},log:value=>logs.push(value)});
    assert.equal(result.run,false);assert.equal(result.baseUrl,'http://chosen.test:9818');assert.equal(result.loader,'UNETLoader');
    assert.equal(result.examples.length,6);assert.ok(result.examples.some(example=>example.name==='rgba-lightning-992'&&example.kind==='text-to-image'));
    assert.doesNotMatch(logs.join('\n'),/private-secret|private.test|prompt/);assert.deepEqual(await fs.readdir(setup.root),['settings.json']);
  }finally{await setup.clean();}
});

test('P0 rejects gateway settings and an existing output directory before networking',async()=>{
  const setup=await fixture();let network=0;
  const runtime={transport:async()=>{network++;throw Error('unexpected network');},log:()=>{}};
  try{
    await fs.mkdir(setup.outputDir);await fs.writeFile(path.join(setup.outputDir,'keep.txt'),'untouched');
    await assert.rejects(runP0({...setup,run:true},runtime),/exist/i);assert.equal(await fs.readFile(path.join(setup.outputDir,'keep.txt'),'utf8'),'untouched');
    await fs.writeFile(setup.settingsPath,JSON.stringify({schemaVersion:1,backend:'gateway',baseUrl:'https://gateway.test',models}));
    await assert.rejects(runP0({...setup,run:false},runtime),/ComfyUI/);assert.equal(network,0);
  }finally{await setup.clean();}
});

function backend(setup:{outputDir:string},depth:8|16,mode:'ready'|'lost'|'unknown'|'timeout'|'invalid-output'='ready'){
  const requests:{url:string;method:string;body?:any}[]=[],posts:string[]=[],pixels=depth===16?new Uint16Array([1,2,3,65535,4,5,6,32768,7,8,9,0]):new Uint8Array([1,2,3,255,4,5,6,128,7,8,9,0]);
  const output=encodePng({width:3,height:1,rgba:pixels});let uploaded=0;
  const nodes=JSON.parse(readFileSync(new URL('./fixtures/comfy-nodes.json',import.meta.url),'utf8'));
  delete nodes.UnetLoaderGGUF;nodes.UNETLoader={input:{required:{unet_name:[[models.unet]],weight_dtype:[['default','fp8_e4m3fn']]}},output:['MODEL']};
  nodes.CLIPLoader.input.required.clip_name[0]=[models.clip];nodes.VAELoader.input.required.vae_name[0]=[models.vae];nodes.PS_AISavePNG16=structuredClone(nodes.SaveImage);
  const transport:typeof fetch=async(input,init)=>{
    const url=String(input),route=new URL(url).pathname,method=init?.method??'GET',body=route==='/prompt'?JSON.parse(String(init?.body)):undefined;
    requests.push({url,method,body});
    const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    if(route==='/system_stats')return json({});
    if(route.startsWith('/object_info/')){
      const cls=route.split('/').pop()!;
      return json(nodes[cls]?{[cls]:nodes[cls]}:{});
    }
    if(route==='/upload/image')return json({name:`input-${uploaded++}.png`,subfolder:'ps-ai'});
    if(route==='/prompt'){
      const files=(await fs.readdir(setup.outputDir)).filter(name=>name.endsWith('-job.json'));
      const record=(await Promise.all(files.map(async name=>JSON.parse(await fs.readFile(path.join(setup.outputDir,name),'utf8'))))).find(record=>record.id===body.prompt_id);
      assert.ok(record,'caller UUID must be on disk before POST');assert.equal(record.state,'submitting');assert.equal(record.baseUrl,'http://chosen.test:9818');
      assert.equal(record.loader,'UNETLoader');assert.deepEqual(record.models,models);assert.equal(record.outputDepth,depth);assert.equal(record.parameters.seed,42);
      assert.equal(body.prompt['1'].class_type,'UNETLoader');assert.equal(body.prompt['1'].inputs.unet_name,models.unet);assert.equal(body.prompt['2'].inputs.clip_name,models.clip);assert.equal(body.prompt['3'].inputs.vae_name,models.vae);
      assert.equal(body.prompt['8'].class_type,depth===16?'PS_AISavePNG16':'SaveImage');
      posts.push(body.prompt_id);if(mode==='lost'||mode==='unknown')throw new TypeError('private upstream prompt');return json({prompt_id:body.prompt_id});
    }
    if(route.startsWith('/history/')){
      const id=route.split('/').pop()!;assert.ok(posts.includes(id));
      return json(mode==='unknown'||mode==='timeout'?{}:{[id]:{status:{completed:true,status_str:'success',messages:[]},outputs:{'8':{images:[{filename:'out.png',subfolder:'ps-ai',type:'output'}]}}}});
    }
    if(route==='/queue')return json({queue_running:mode==='timeout'?[[0,posts[posts.length-1]]]:[],queue_pending:[]});
    if(route==='/view')return new Response(new Uint8Array(mode==='invalid-output'?[1,2,3]:output).buffer);
    throw Error(`unexpected endpoint ${url}`);
  };
  return {transport,requests,posts,nodes};
}

for(const [name,modify] of [
  ['missing weight dtype',(nodes:any)=>delete nodes.UNETLoader.input.required.weight_dtype],
  ['unsupported default dtype',(nodes:any)=>nodes.UNETLoader.input.required.weight_dtype=[['fp8_e4m3fn']]],
  ['wrong model socket',(nodes:any)=>nodes.UNETLoader.output=['IMAGE']]
] as const)test(`P0 rejects ${name} before any uploads or inference`,async()=>{
  const setup=await fixture(),fake=backend(setup,8);modify(fake.nodes);
  try{
    await assert.rejects(runP0({...setup,run:true},{transport:fake.transport,log:()=>{},sampleVram:()=>undefined,pollMs:0}),(error:any)=>error.code==='incompatible-api');
    assert.equal(fake.requests.filter(request=>request.method==='POST').length,0);
  }finally{await setup.clean();}
});

for(const depth of [8,16] as const)test(`P0 passes explicit native settings through six submissions and ${depth}-bit output decoding`,async()=>{
  const setup=await fixture(depth),fake=backend(setup,depth);
  try{
    await runP0({...setup,run:true},{transport:fake.transport,log:()=>{},sampleVram:()=>undefined,pollMs:0});
    assert.equal(fake.posts.length,6);assert.equal(new Set(fake.posts).size,6);assert.ok(fake.requests.every(request=>request.url.startsWith('http://chosen.test:9818/')));
    const report=JSON.parse(await fs.readFile(path.join(setup.outputDir,'report.json'),'utf8'));
    assert.equal(report.cases.length,6);assert.ok(report.cases.every((item:any)=>item.state==='ready'&&item.outputDepth===depth));assert.deepEqual(report.cases[0].alpha,{transparent:1,partial:1,opaque:1});
    const graph=fake.requests.filter(request=>request.body)[3].body.prompt;
    assert.deepEqual(graph['4'].inputs['images.image_1'],['12',0]);assert.deepEqual(graph['4'].inputs['images.image_2'],['10',0]);assert.deepEqual(graph['4'].inputs['images.image_3'],['14',0]);
  }finally{await setup.clean();}
});

test('P0 recovers a lost response at its saved endpoint and UUID without duplicate POST',async()=>{
  const setup=await fixture(),fake=backend(setup,8,'lost'),logs:string[]=[];
  try{
    await runP0({...setup,run:true},{transport:fake.transport,log:value=>logs.push(value),sampleVram:()=>undefined,pollMs:0});
    assert.equal(fake.posts.length,6);assert.equal(new Set(fake.posts).size,6);
    assert.ok(fake.posts.every(id=>fake.requests.some(request=>request.url===`http://chosen.test:9818/history/${id}`)));
    assert.doesNotMatch(logs.join('\n'),/private upstream prompt/);
  }finally{await setup.clean();}
});

for(const mode of ['unknown','timeout'] as const)test(`P0 stops its batch on ${mode}, retaining the original recovery record`,async()=>{
  const setup=await fixture(),fake=backend(setup,8,mode);
  try{
    await assert.rejects(runP0({...setup,run:true},{transport:fake.transport,log:()=>{},sampleVram:()=>undefined,pollMs:0,timeoutMs:5}),/recover|resubmit/i);
    assert.equal(fake.posts.length,1);
    const record=JSON.parse(await fs.readFile(path.join(setup.outputDir,'edit-clean-992-job.json'),'utf8'));
    assert.equal(record.id,fake.posts[0]);assert.equal(record.baseUrl,'http://chosen.test:9818');assert.equal(record.state,'unknown');
    assert.equal(fake.requests.filter(request=>request.url.endsWith('/prompt')).length,1);assert.ok(fake.requests.every(request=>!request.url.includes('interrupt')));
  }finally{await setup.clean();}
});

test('P0 retains raw invalid output and stops before submitting another example',async()=>{
  const setup=await fixture(),fake=backend(setup,8,'invalid-output');
  try{
    await assert.rejects(runP0({...setup,run:true},{transport:fake.transport,log:()=>{},sampleVram:()=>undefined,pollMs:0}));
    assert.equal(fake.posts.length,1);assert.deepEqual(await fs.readFile(path.join(setup.outputDir,'edit-clean-992.png')),Buffer.from([1,2,3]));
    const record=JSON.parse(await fs.readFile(path.join(setup.outputDir,'edit-clean-992-job.json'),'utf8'));assert.equal(record.state,'ready');
  }finally{await setup.clean();}
});
