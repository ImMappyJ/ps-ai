import test from 'node:test';import assert from 'node:assert/strict';
import {ComfyClient,uuid} from '../src/infrastructure/backends/client';
import {diagnostic,DiagnosticError} from '../src/diagnostics/diagnostics';import {setLanguage} from '../src/localization/i18n';
import {RelightExtractionError} from '../src/features/relight/relight-layers';

test('typed lighting extraction reports its local stage and precise reason in both languages without PNG guidance',()=>{
  for(const language of ['zh-CN','en-US'] as const)for(const reason of ['structure-mismatch','unsupported-boundary'] as const){
    setLanguage(language);
    try{
      const error=new RelightExtractionError(reason,{structureConfidence:.3,rejectedFraction:.7,boundaryPixels:21});
      error.message='private source filename portrait.png; private image description';
      (error as any).cause=new Error('private nested image description');
      (error.metrics as any).privatePrompt='private prompt';
      (error.metrics as any).invalid=Infinity;
      const d=diagnostic(error,'output',true);
      assert.equal(d.code,'relight-extraction');assert.equal(d.stage,'lighting-extraction');assert.equal(d.reason,reason);
      assert.deepEqual(d.metrics,{structureConfidence:.3,rejectedFraction:.7,boundaryPixels:21});
      assert.match(d.stageLabel,language==='en-US'?/Local lighting extraction/:/本地光影提取/);
      assert.match(d.summary,reason==='structure-mismatch'?(language==='en-US'?/structure or texture/:/整体结构或纹理/):(language==='en-US'?/local.*boundar/:/局部.*边界/));
      assert.match(d.action,language==='en-US'?/original AI reference/:/原始 AI 参考图/);
      assert.match(d.retry,language==='en-US'?/original task ID/:/原 ID/);
      assert.doesNotMatch(JSON.stringify(d),/PNG|ICC|sRGB|portrait\.png|private|Infinity/);
      if(language==='en-US')assert.doesNotMatch(d.title+d.action+d.summary+d.stageLabel+d.effect+d.retry,/[一-龥]/);
    }finally{setLanguage('zh-CN');}
  }
});

test('only exact local selection errors at capture are normalized after an ordinary Error boundary',()=>{
  for(const message of ['请先建立编辑选区','选区为空','Make an edit selection first','The selection is empty']){
    const d=diagnostic(new Error(message),'capture');assert.equal(d.code,'selection-required');assert.equal(d.stage,'capture');assert.match(d.action,/恢复上次选区|重新圈选/);
    assert.equal(diagnostic(new Error(message),'inference').code,'unknown');
  }
  for(const error of [new Error('请先建立编辑选区: remote failure'),new Error('selection unavailable'),{code:'selection-required',stage:'capture',message:'请先建立编辑选区'},'请先建立编辑选区'])assert.equal(diagnostic(error,'capture').code,'unknown');
  assert.equal(diagnostic(new DiagnosticError('timeout','connection','请先建立编辑选区'),'capture').code,'timeout');
});

test('selection-required diagnostics point to explicit relight scope in both languages',()=>{
  for(const language of ['zh-CN','en-US'] as const){
    setLanguage(language);
    try{const d=diagnostic(new DiagnosticError('selection-required' as any,'capture','selection missing'),'inference');
      assert.equal(d.code,'selection-required');assert.equal(d.stage,'capture');
      assert.match(d.action,language==='en-US'?/Entire image|entire image/:/整张图像/);
      if(language==='en-US')assert.doesNotMatch(d.title+d.action+d.effect,/[一-龥]/);
    }finally{setLanguage('zh-CN');}
  }
});

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
