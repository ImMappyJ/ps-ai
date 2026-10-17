import test from 'node:test';import assert from 'node:assert/strict';
import {cloudRequest,cloudPng,untagPng,testId} from './gateway-fixtures';
import {decodePng,encodePng} from '../src/image';
import {intent} from '../src/intent';

const request={...cloudRequest,model:'gpt-image-2.5-sunburst',seed:0,width:992,height:992};
function response(bytes=cloudPng(992,992)){return Response.json({data:[{b64_json:Buffer.from(bytes).toString('base64')}],output_format:'png'});}

test('OpenAI Images 原生生成只发一次指定请求，密钥留在请求头，不发送旧格式参数',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');let calls=0;
  const p=new OpenAIImagesProvider({apiKey:'fake-openai-key',transport:async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/images/generations');assert.equal((init!.headers as any).Authorization,'Bearer fake-openai-key');assert.equal(init!.redirect,'error');const body=JSON.parse(String(init!.body));assert.equal(body.model,request.model);assert.equal(body.n,1);assert.equal(body.size,'992x992');assert.equal(body.quality,'medium');assert.equal(body.output_format,'png');assert.equal(body.background,'opaque');for(const key of ['seed','steps','response_format','images','mask'])assert.equal(body[key],undefined);return response();}});
  const caps=p.capabilities();assert.equal(caps.provider,'openai');assert.equal(p.execution,'inline');assert.ok(caps.models.every(m=>m.seedMax===0&&m.outputDepths[0]===8));assert.ok(caps.models.some(m=>m.id==='gpt-image-1.5'));assert.doesNotMatch(JSON.stringify(caps),/fake-openai-key/);
  const r=await p.submit(request,[]);assert.equal(calls,1);assert.ok('image' in r);
});

test('OpenAI 编辑将范围辅助转换为原生alpha蒙版，来源第一张、参考紧随其后',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');const rgba=new Uint8Array(992*992*4).fill(255);for(let i=0;i<rgba.length;i+=4)rgba[i]=rgba[i+1]=rgba[i+2]=i===0?0:i===4?128:255;
  const source=cloudPng(992,992),guide=encodePng({width:992,height:992,rgba}),reference=cloudPng(512,512,true);
  const p=new OpenAIImagesProvider({apiKey:'fake',transport:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/images/edits');const body=JSON.parse(String(init!.body));assert.equal(body.images.length,2);const png=(data:string)=>decodePng(new Uint8Array(Buffer.from(data.split(',')[1],'base64')));assert.equal(png(body.images[0].image_url).width,992);assert.equal(png(body.images[1].image_url).width,512);const mask=png(body.mask.image_url);assert.equal(mask.rgba[3],255);assert.equal(mask.rgba[7],127);assert.equal(mask.rgba[11],0);assert.equal(body.input_fidelity,undefined);return response();}});
  await p.submit({...request,kind:'edit',mode:'reference',source:`${testId}-source.png`,guide:`${testId}-guide.png`,reference:`${testId}-reference.png`},[source,guide,reference]);
});

test('OpenAI 透明素材显式请求transparent，输出仍需真正的透明像素和sRGB8',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');const asset={...request,kind:'asset' as const,mode:'effect'};
  const p=new OpenAIImagesProvider({apiKey:'fake',transport:async(_url,init)=>{assert.equal(JSON.parse(String(init!.body)).background,'transparent');return response(cloudPng(992,992,true));}});
  const r=await p.submit(asset,[]);assert.equal(decodePng(p.normalizeOutput(r.image,asset)).rgba[3],0);
  assert.throws(()=>p.normalizeOutput(cloudPng(992,992),asset),/transparent/);assert.throws(()=>p.normalizeOutput(untagPng(cloudPng(992,992)),request),/sRGB/);assert.equal(decodePng(p.normalizeOutput(untagPng(cloudPng(992,992)),request,true)).width,992);
  const bad16=encodePng({width:992,height:992,rgba:new Uint16Array(992*992*4).fill(65535)});assert.throws(()=>p.normalizeOutput(bad16,request),/8-bit/);
});

test('OpenAI 尺寸计划满足平台预算，旧模型固定画布等比补边并按同一坐标逆裁',async()=>{
  const {OpenAIImagesProvider,openAIFrame}=await import('../server/providers/openai');const p=new OpenAIImagesProvider();
  for(const [width,height] of [[512,512],[1000,800],[2048,2048],[3520,1184]]){const box=openAIFrame({...request,width,height});assert.equal(box.canvasWidth%16,0);assert.equal(box.canvasHeight%16,0);assert.ok(box.canvasWidth*box.canvasHeight>=655360);assert.ok(box.canvasWidth<=3840&&box.canvasHeight<=3840);assert.ok(Math.max(box.canvasWidth/box.canvasHeight,box.canvasHeight/box.canvasWidth)<=3);}
  const old={...request,model:'gpt-image-1.5',width:1024,height:512},box=openAIFrame(old);assert.equal(box.canvasWidth,1536);assert.equal(box.canvasHeight,1024);assert.equal(box.top,128);
  const raw=decodePng(cloudPng(1536,1024));for(let y=128;y<896;y++)for(let x=0;x<1536;x++){const i=(y*1536+x)*4;raw.rgba[i]=0;}
  const result=decodePng(p.normalizeOutput(encodePng(raw),old));assert.equal(result.width,1024);assert.equal(result.height,512);assert.equal(result.rgba[0],0);assert.equal(result.rgba[result.rgba.length-4],0);assert.throws(()=>p.normalizeOutput(cloudPng(1024,1024),old),/dimensions/);
});

test('OpenAI 缺Key或非法输入不发请求，鉴权与安全错误脱敏且明确失败',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');let calls=0;
  await assert.rejects(new OpenAIImagesProvider({transport:async()=>{calls++;return response();}}).submit(request,[]),/OPENAI_API_KEY/);assert.equal(calls,0);
  const p=new OpenAIImagesProvider({apiKey:'fake-secret',transport:async()=>{calls++;return Response.json({error:{message:'fake-secret private prompt',code:'moderation_blocked'}},{status:400});}});
  await assert.rejects(p.submit(request,[]),(e:any)=>e.outcomeUnknown===false&&!e.message.includes('fake-secret')&&!e.message.includes('private prompt'));
  for(const patch of [{seed:1},{outputDepth:16},{model:'dall-e-3'},{kind:'edit',mode:'edit',source:`${testId}-source.png`}])await assert.rejects(p.submit({...request,...patch} as any,[]));assert.equal(calls,1);
});

test('OpenAI 断线、超时和未读完整提交响应保留unknown，不自动重试',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');
  for(const transport of [async()=>{throw new Error('fake-secret');},async()=>new Response('{not-json'),async()=>Response.json({},{headers:{'Content-Length':String(32*1024*1024+1)}}),async()=>new Response('bad',{status:503})]){
    let calls=0;const p=new OpenAIImagesProvider({apiKey:'fake-secret',transport:async()=>{calls++;return transport();}});await assert.rejects(p.submit(request,[]),(e:any)=>e.outcomeUnknown===true&&!e.message.includes('fake-secret'));assert.equal(calls,1);
  }
  const p=new OpenAIImagesProvider({apiKey:'fake',timeoutMs:5,transport:async()=>new Promise(()=>{})});await assert.rejects(p.submit(request,[]),(e:any)=>e.outcomeUnknown===true&&e.code==='timeout');
});

test('OpenAI 完整无图、多图、坏Base64或URL响应均明确失败，不下载任意地址',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');
  for(const value of [{data:[]},{data:[{url:'http://localhost/private'}]},{data:[{b64_json:'AA=='},{b64_json:'AA=='}]},{data:[{b64_json:'***'}]},{output_format:'jpeg',data:[{b64_json:'AA=='}]}]){let calls=0;const p=new OpenAIImagesProvider({apiKey:'fake',transport:async()=>{calls++;return Response.json(value);}});await assert.rejects(p.submit(request,[]),(e:any)=>e.code==='invalid-output'&&!e.outcomeUnknown);assert.equal(calls,1);}
});

test('OpenAI 鉴权/配额不泄露错误内容；HTTP请求超时仍保留不确定窗口',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');
  for(const status of [401,403,408,429]){let calls=0;const p=new OpenAIImagesProvider({apiKey:'fake-secret',transport:async()=>{calls++;return Response.json({error:{message:'fake-secret private prompt'}},{status});}});await assert.rejects(p.submit(request,[]),(e:any)=>!e.message.includes('fake-secret')&&!e.message.includes('private prompt')&&e.outcomeUnknown===(status===408));assert.equal(calls,1);}
});

test('编辑意图到OpenAI载荷不把参考图误写成第2张蒙版，也不改写原始提示',async()=>{
  const {OpenAIImagesProvider}=await import('../server/providers/openai');const original='给腿部穿上白色过膝袜，保留姿势';const edit=intent('cosplay','reference',original,true,true,'服装','semantic');
  let body:any;const p=new OpenAIImagesProvider({apiKey:'fake',transport:async(_url,init)=>{body=JSON.parse(String(init!.body));return response();}});
  await p.submit({...request,kind:'edit',mode:'reference',prompt:edit.prompt,source:`${testId}-source.png`,guide:`${testId}-guide.png`,reference:`${testId}-reference.png`},[cloudPng(992,992),cloudPng(992,992),cloudPng()]);
  assert.equal(body.images.length,2);assert.ok(body.mask);assert.doesNotMatch(body.prompt,/<image[123]>/);assert.ok(body.prompt.includes(original));assert.match(body.prompt,/next image is a reference/);
});
