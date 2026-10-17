import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings,defaultSettings} from '../src/profile';
import {uuid} from '../src/client';

export const capabilities={protocol:'ps-ai/1',provider:'bailian',configured:true,cancellation:'none',progress:'stages',models:[{id:'qwen-image-2.1-pro',label:'Qwen Image 2.1 Pro',operations:['t2i','edit','asset'],maxInputImages:10,outputDepths:[8],seedMax:2147483647,minPixels:262144,maxPixels:4194304,maxAspectRatio:8}]};
test('relight is an edit-only gateway operation with a source image',async()=>{const {validateCapabilities,validateGeneration}=await import('../src/gateway-protocol');const id=uuid(),request={model:'qwen-image-2.1-pro',kind:'edit',mode:'relight',prompt:'warm soft light',seed:0,width:768,height:768,outputDepth:8,source:id+'-source.png'};assert.equal(validateGeneration(request,validateCapabilities(capabilities)).mode,'relight');assert.throws(()=>validateGeneration({...request,source:undefined},validateCapabilities(capabilities)));assert.throws(()=>validateGeneration({...request,kind:'asset'},validateCapabilities(capabilities)));});

test('网关配置保留服务类型与平台模型，旧配置不改变且不导出密钥',()=>{
  const saved=validateSettings({...defaultSettings(),backend:'gateway',baseUrl:'http://localhost:8190',gatewayModel:'qwen-image-2.1-pro',apiKey:'must-not-be-exported'}) as any;
  assert.equal(saved.backend,'gateway');assert.equal(saved.gatewayModel,'qwen-image-2.1-pro');assert.equal(saved.apiKey,undefined);
  assert.equal((validateSettings(defaultSettings()) as any).backend,undefined);
  assert.throws(()=>validateSettings({...defaultSettings(),backend:'unknown'}));
  assert.throws(()=>validateSettings({...defaultSettings(),backend:'gateway',outputDepth:16}),/8/);
});

test('网关客户端从能力清单读取模型，无密钥时在上传之前失败',async()=>{
  const {GatewayClient}=await import('../src/gateway-client');let calls=0;
  const c=new GatewayClient('http://localhost:8190','qwen-image-2.1-pro',async()=>{calls++;return Response.json({...capabilities,configured:false});});
  const info=await c.connect();assert.equal(info.provider,'bailian');
  await assert.rejects(c.check(8),/DASHSCOPE_API_KEY/);assert.equal(calls,2);
});

test('语义协议校验模型能力、编辑来源、种子范围和输出位深',async()=>{
  const {validateCapabilities,validateGeneration}=await import('../src/gateway-protocol');
  const cap=validateCapabilities(capabilities),base={model:'qwen-image-2.1-pro',kind:'t2i',mode:'generate',prompt:'white stockings',seed:42,width:768,height:768,outputDepth:8};
  assert.equal(validateGeneration(base,cap).model,base.model);
  for(const patch of [{outputDepth:16},{seed:2147483648},{width:32,height:32},{width:4096,height:256},{model:'other'},{kind:'edit',mode:'edit'},{source:'https://example.com/private.png'}])assert.throws(()=>validateGeneration({...base,...patch},cap));
  const noAsset=validateCapabilities({...capabilities,models:[{...capabilities.models[0],operations:['t2i','edit']}]});
  assert.throws(()=>validateGeneration({...base,kind:'asset',mode:'effect'},noAsset));
  assert.throws(()=>validateCapabilities({...capabilities,protocol:'ps-ai/99'}));
  assert.throws(()=>validateGeneration({...base,steps:30},cap),/parameter/);
});

test('网关客户端使用语义请求与 UUID，不生成 ComfyUI 节点图',async()=>{
  const {GatewayClient}=await import('../src/gateway-client');const id=uuid(),requests:{url:string;body:any}[]=[];
  const transport=async(url:any,init:any)=>{requests.push({url:String(url),body:init?.body});if(String(url).endsWith('/capabilities'))return Response.json(capabilities);if(String(url).includes('/uploads/'))return Response.json({name:`${id}-source.png`});if(String(url).endsWith('/jobs'))return Response.json({id});if(String(url).includes('/outputs/'))return new Response(new Uint8Array([1,2,3]));return Response.json({state:'ready',images:[{filename:`${id}.png`,subfolder:'',type:'output'}]});};
  const c=new GatewayClient('http://localhost:8190','qwen-image-2.1-pro',transport);await c.check(8);
  await c.upload(new Uint8Array([1,2]),`${id}-source.png`);
  const record:any={id,clientId:uuid(),graph:{},request:{model:'qwen-image-2.1-pro',kind:'edit',mode:'edit',prompt:'repair',seed:42,width:768,height:768,source:`${id}-source.png`,outputDepth:8}};
  assert.equal(await c.submitJob(record),id);const posted=JSON.parse(requests.find(r=>r.url.endsWith('/jobs'))!.body);assert.equal(posted.request.source,`${id}-source.png`);assert.equal(posted.prompt,undefined);assert.equal(posted.graph,undefined);
  const result=await c.status(id);assert.equal(result.state,'ready');assert.deepEqual(Array.from(await c.output(result.images![0])),[1,2,3]);
  assert.doesNotThrow(c.watch(uuid(),id,()=>{}));
});

test('云平台模板仍要求带 sRGB 标记的真实 8 位 PNG',async()=>{
  const {GATEWAY_TEMPLATE}=await import('../src/gateway-protocol');const {decodeModelPng,encodePng}=await import('../src/image');
  assert.equal(GATEWAY_TEMPLATE,'gateway-v1-srgb8');
  const png=Buffer.from(encodePng({width:1,height:1,rgba:new Uint8Array([1,2,3,255])})),parts=[png.subarray(0,8)];
  for(let at=8;at<png.length;){const end=at+png.readUInt32BE(at)+12;if(png.toString('ascii',at+4,at+8)!=='sRGB')parts.push(png.subarray(at,end));at=end;}
  assert.throws(()=>decodeModelPng(new Uint8Array(Buffer.concat(parts)),GATEWAY_TEMPLATE),/未标记 sRGB/);
});
