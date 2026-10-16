import test from 'node:test';import assert from 'node:assert/strict';
import {ComfyClient,uuid} from '../src/client';
import {diagnostic} from '../src/diagnostics';import {setLanguage} from '../src/i18n';

test('diagnostics identify the failed stage and keep pending-task retry instructions',()=>{
  setLanguage('en-US');try{
    const d=diagnostic(new Error('unexpected device response'),'apply',true);
    assert.equal(d.code,'apply-failed');assert.match(d.stageLabel,/Photoshop/);assert.match(d.retry,/original task ID/);assert.doesNotMatch(d.action,/[一-龥]/);
    assert.equal(diagnostic(new Error('maybe memory?'),'inference').code,'unknown');
  }finally{setLanguage('zh-CN');}
});

test('connection refusal, malformed API and timeout have distinct actionable codes',async()=>{
  const broken=new ComfyClient('http://localhost:8188',async()=>{throw new TypeError('fetch failed');});
  await assert.rejects(broken.inspect(),(e:any)=>e.code==='unreachable');
  const malformed=new ComfyClient('http://localhost:8188',async()=>new Response('<html>proxy</html>'));
  await assert.rejects(malformed.inspect(),(e:any)=>e.code==='incompatible-api');
  const timeout=new ComfyClient('http://localhost:8188',async()=>new Promise(()=>{}),10);
  await assert.rejects(timeout.inspect(),(e:any)=>e.code==='timeout');
  const missingApi=new ComfyClient('http://localhost:8188',async()=>new Response('Not found',{status:404}));
  await assert.rejects(missingApi.inspect(),(e:any)=>e.code==='incompatible-api');
});
test('missing nodes and model/schema mismatch retain the exact failed item',async()=>{
  const nodes=new ComfyClient('http://localhost:8188',async()=>Response.json({}));
  await assert.rejects(nodes.inspect(),(e:any)=>e.code==='missing-node'&&e.message.includes('UnetLoaderGGUF'));
  const schema=new ComfyClient('http://localhost:8188',async(url)=>{const cls=String(url).split('/').pop()!;return Response.json(String(url).endsWith('system_stats')?{}:{[cls]:{}});});
  await assert.rejects(schema.inspect(),(e:any)=>e.code==='incompatible-api'&&e.message.includes('unet_name'));
});
test('only explicit backend OOM is resource exhaustion, unknown failures remain unknown',async()=>{
  const id=uuid();
  for(const [exception_type,exception_message,want] of [['torch.OutOfMemoryError','allocation failed','resource-exhausted'],['RuntimeError','CUDA out of memory. Tried to allocate','resource-exhausted'],['RuntimeError','device disappeared','unknown']]){
    const client=new ComfyClient('http://localhost:8188',async()=>Response.json({[id]:{status:{status_str:'error',messages:[['execution_error',{exception_type,exception_message}]]}}}));
    const result=await client.status(id);assert.equal(result.state,'failed');assert.equal(result.code,want);
  }
});
