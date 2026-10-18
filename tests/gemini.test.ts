import test from 'node:test';import assert from 'node:assert/strict';
import {cloudRequest,cloudPng,untagPng,testId} from './gateway-fixtures';
import {decodePng} from '../src/imaging/image';

test('Gemini 适配独立于百炼：原生接口、私密请求头、图片顺序和能力限制',async()=>{
  const {GeminiProvider}=await import('../server/providers/gemini');let url='',init:any;
  const p=new GeminiProvider({apiKey:'fake-google-key',transport:async(u,i)=>{url=String(u);init=i;return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from(cloudPng(1024,1024)).toString('base64')}}]}}]});}});
  assert.equal(p.execution,'inline');assert.equal(p.capabilities().provider,'gemini');assert.ok(p.capabilities().models.some(m=>m.id==='gemini-nano-banana-2.1'));assert.ok(p.capabilities().models.every(m=>!m.operations.includes('asset')&&m.seedMax===0));
  const request={...cloudRequest,model:'gemini-2.5-flash-image',kind:'edit' as const,mode:'edit',seed:0,width:768,height:512,source:`${testId}-source.png`,guide:`${testId}-guide.png`,reference:`${testId}-reference.png`};
  const r=await p.submit(request,[cloudPng(768,512),cloudPng(768,512),cloudPng(512,512)]);
  assert.match(url,/^https:\/\/generativelanguage\.googleapis\.com\/v1\/models\/gemini-2\.5-flash-image:generateContent$/);assert.doesNotMatch(url,/fake-google-key/);assert.equal((init.headers as any)['x-goog-api-key'],'fake-google-key');
  const body=JSON.parse(init.body),parts=body.contents[0].parts;assert.equal(parts.length,4);assert.match(parts[3].text,/white over-knee/);assert.equal(body.generationConfig.responseFormat.image.aspectRatio,'1:1');assert.equal(body.generationConfig.seed,undefined);
  assert.equal(decodePng(new Uint8Array(Buffer.from(parts[0].inlineData.data,'base64'))).width,1024);assert.ok('image' in r);
});

test('Gemini 编辑补齐方形上下文，回填裁回原比例而不拉伸主体',async()=>{
  const {GeminiProvider}=await import('../server/providers/gemini');const p=new GeminiProvider();
  const bytes=cloudPng(1024,1024);const raw=decodePng(bytes);for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const i=(y*1024+x)*4;raw.rgba[i]=y<256||y>=768?255:0;raw.rgba[i+1]=y>=256&&y<768?255:0;}
  const {encodePng}=await import('../src/imaging/image');const request={...cloudRequest,model:'gemini-2.5-flash-image',seed:0,width:1024,height:512};
  const output=decodePng(p.normalizeOutput(encodePng(raw),request));assert.equal(output.width,1024);assert.equal(output.height,512);assert.equal(output.rgba[1],255);assert.equal(output.rgba[0],0);
  assert.throws(()=>p.normalizeOutput(cloudPng(1024,768),request),/square/);assert.throws(()=>p.normalizeOutput(untagPng(bytes),request),/sRGB/);
});

test('Gemini 无 Key、安全拒绝、非PNG和网络不确定失败均不伪造成功或可恢复平台ID',async()=>{
  const {GeminiProvider}=await import('../server/providers/gemini');const request={...cloudRequest,model:'gemini-2.5-flash-image',seed:0};
  await assert.rejects(new GeminiProvider().submit(request,[]),/GEMINI_API_KEY/);
  for(const value of [{promptFeedback:{blockReason:'SAFETY'}},{candidates:[{content:{parts:[{text:'No image'}]}}]},{candidates:[{content:{parts:[{inlineData:{mimeType:'image/jpeg',data:'AA=='}}]}}]}]){
    const p=new GeminiProvider({apiKey:'fake',transport:async()=>Response.json(value)});await assert.rejects(p.submit(request,[]),/image|PNG|blocked/);
  }
  const p=new GeminiProvider({apiKey:'fake-secret',transport:async()=>{throw new Error('fake-secret');}});
  await assert.rejects(p.submit(request,[]),(e:any)=>e.outcomeUnknown===true&&!e.message.includes('fake-secret'));
  const oversized=new GeminiProvider({apiKey:'fake',transport:async()=>Response.json({},{headers:{'Content-Length':String(16*1024*1024+1)}})});
  await assert.rejects(oversized.submit(request,[]),(e:any)=>e.outcomeUnknown===true);
});
