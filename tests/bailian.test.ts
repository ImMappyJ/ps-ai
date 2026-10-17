import test from 'node:test';import assert from 'node:assert/strict';
import {cloudPng,untagPng,cloudRequest,testId} from './gateway-fixtures';
import {decodeModelPng} from '../src/image';import {GATEWAY_TEMPLATE} from '../src/gateway-protocol';

test('百炼模型能力按官方区分透明素材，平台 API Key 不进入清单',async()=>{
  const {BailianProvider}=await import('../server/providers/bailian');const p=new BailianProvider({apiKey:'test-server-secret'}),cap=p.capabilities();
  assert.equal(cap.configured,true);assert.equal(cap.cancellation,'none');assert.equal(cap.models.find(m=>m.id==='qwen-image-3.0-pro')!.operations.includes('asset'),false);
  assert.equal(cap.models.find(m=>m.id==='qwen-image-2.1-pro')!.operations.includes('asset'),true);assert.doesNotMatch(JSON.stringify(cap),/test-server-secret/);
});
test('百炼异步请求使用正确独立端点、Header、尺寸和有序 Base64 图片',async()=>{
  const {BailianProvider}=await import('../server/providers/bailian');let posted:any;const images=[cloudPng(),cloudPng(512,512,true),cloudPng()];
  const p=new BailianProvider({apiKey:'test-server-secret',transport:async(url:any,init:any)=>{
    assert.equal(String(url),'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation');assert.equal(init.headers['X-DashScope-Async'],'enable');assert.equal(init.headers.Authorization,'Bearer test-server-secret');posted=JSON.parse(init.body);return Response.json({output:{task_id:testId,task_status:'PENDING'}});
  }});
  const req={...cloudRequest,kind:'edit' as const,mode:'reference',source:`${testId}-source.png`,guide:`${testId}-guide.png`,reference:`${testId}-reference.png`};
  assert.equal((await p.submit(req,images)).taskId,testId);
  assert.equal(posted.parameters.size,'512*512');assert.equal(posted.parameters.n,1);assert.equal(posted.parameters.seed,42);assert.equal(posted.parameters.steps,undefined);
  const content=posted.input.messages[0].content;assert.deepEqual(content.slice(0,3),images.map(b=>({image:'data:image/png;base64,'+Buffer.from(b).toString('base64')})));assert.ok(content[3].text.endsWith(req.prompt));assert.match(content[3].text,/<image1>.*来源/);assert.match(content[3].text,/<image2>.*白色/);assert.match(content[3].text,/<image3>.*参考/);
});
test('百炼查询隔离平台 task ID，读取官方 choices 图片结果',async()=>{
  const {BailianProvider}=await import('../server/providers/bailian');const image='https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/result.png';
  const p=new BailianProvider({apiKey:'test-secret',transport:async(url:any)=>{assert.ok(String(url).endsWith(`/tasks/${testId}`));return Response.json({output:{task_id:testId,task_status:'SUCCEEDED',choices:[{message:{content:[{image}]}}]}});}});
  assert.deepEqual(await p.poll(testId),{state:'ready',imageUrl:image});
});
test('没有 Key 不请求平台；鉴权错误不回显平台的原始敏感 message',async()=>{
  const {BailianProvider}=await import('../server/providers/bailian');let calls=0;const empty=new BailianProvider({transport:async()=>{calls++;throw new Error('unexpected');}});
  await assert.rejects(empty.submit(cloudRequest,[]),/DASHSCOPE_API_KEY/);assert.equal(calls,0);
  const p=new BailianProvider({apiKey:'test-secret',transport:async()=>Response.json({code:'InvalidApiKey',message:'test-secret was invalid'},{status:401})});
  await assert.rejects(p.submit(cloudRequest,[]),(e:any)=>e.status===401&&!e.message.includes('test-secret'));
  assert.throws(()=>new BailianProvider({apiKey:'test-secret',baseUrl:'https://attacker.example/api/v1'}));
});
test('平台结果只从受信 OSS HTTPS 下载，绝不向图片地址发送 API Key',async()=>{
  const {BailianProvider}=await import('../server/providers/bailian');let calls=0;
  const p=new BailianProvider({apiKey:'test-secret',transport:async(_url:any,init:any)=>{calls++;assert.equal(init.headers?.Authorization,undefined);assert.equal(init.redirect,'error');return new Response(new Uint8Array([1,2]));}});
  for(const url of ['http://127.0.0.1/secret','https://attacker.example/out.png','https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com@evil.example/out.png'])await assert.rejects(p.download(url));
  assert.equal(calls,0);assert.deepEqual([...await p.download('https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/out.png')],[1,2]);
});
test('云输出校验真实位深、编辑尺寸、透明素材与未标记颜色策略',async()=>{
  const {normalizeOutput}=await import('../server/shared/images');
  const png=cloudPng(),raw=untagPng(png),req={...cloudRequest,kind:'edit' as const,mode:'edit',source:`${testId}-source.png`};
  assert.throws(()=>normalizeOutput(raw,req,false),/sRGB/);
  assert.equal(decodeModelPng(normalizeOutput(raw,req,true),GATEWAY_TEMPLATE).width,512);
  assert.throws(()=>normalizeOutput(cloudPng(256,512),req,true),/dimensions/);
  assert.throws(()=>normalizeOutput(png,{...cloudRequest,kind:'asset',mode:'effect'},false),/transparent/);
  const result=decodeModelPng(normalizeOutput(cloudPng(512,512,true),{...cloudRequest,kind:'asset',mode:'effect'},false),GATEWAY_TEMPLATE);assert.equal(result.rgba[3],0);
});

test('平台输入严格要求已标记的sRGB8，不借用输出兼容开关',async()=>{
  const {validateInput}=await import('../server/shared/images');assert.throws(()=>validateInput(untagPng(cloudPng())),/sRGB/);
});

test('平台已接受但提交响应超过预算时保留不确定窗口，不能认作确定失败',async()=>{
  const {BailianProvider}=await import('../server/providers/bailian');
  for(const response of [()=>Response.json({output:{task_id:testId}},{headers:{'Content-Length':'1048577'}}),()=>new Response('x'.repeat(1048577))]){
    const p=new BailianProvider({apiKey:'fake',transport:async()=>response()});await assert.rejects(p.submit(cloudRequest,[]),(e:any)=>e.outcomeUnknown===true);
  }
});
