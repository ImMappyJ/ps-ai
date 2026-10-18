import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {ComfyClient,uuid} from '../src/infrastructure/backends/client';import {JobCoordinator,JobRecord} from '../src/generation/jobs';
import {buildGraph} from '../src/generation/workflow';
test('检查使用所选模型映射，发现模型时允许当前映射暂缺',async()=>{
  const models={unet:'preset/model.gguf',clip:'preset/clip.safetensors',vae:'preset/vae.safetensors'};
  const infos:any={UnetLoaderGGUF:{input:{required:{unet_name:[[models.unet]]}}},CLIPLoader:{input:{required:{clip_name:[[models.clip]]}}},VAELoader:{input:{required:{vae_name:[[models.vae]]}}},TextEncodeQwenImage21:{input:{required:{images:['COMFY_AUTOGROW_V3',{template:{names:['image_1','image_3']}}]}}}};
  const s=await server((req,res)=>{const cls=req.url?.split('/').pop()!;res.end(JSON.stringify(req.url==='/system_stats'?{}:{[cls]:infos[cls]??{}}));});
  try{await new ComfyClient(s.client.base,fetch,30000,models).check();const inventory=await s.client.inspect();assert.deepEqual(inventory.models, {unet:[models.unet],clip:[models.clip],vae:[models.vae]});await assert.rejects(s.client.check(),/缺少模型/);}finally{await s.close();}
});
async function server(handler:(req:http.IncomingMessage,res:http.ServerResponse,body:Buffer)=>void) {
  let active=false;
  const s=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);if(active)handler(req,res,Buffer.concat(chunks));else {res.writeHead(204);res.end();}});
  // Validate an OS allocation with fetch before enabling the fixture handler.
  // This uses fetch's actual forbidden-port policy, including on systems whose
  // ephemeral range consists of low but mostly valid ports.
  let port=0;for(let attempt=0;attempt<32;attempt++){
    await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));port=(s.address() as {port:number}).port;
    try{await fetch(`http://127.0.0.1:${port}`);active=true;break;}
    catch(error){await new Promise<void>((r,j)=>s.close(e=>e?j(e):r()));if((error as {cause?:{message?:string}}).cause?.message!=='bad port')throw error;}
  }
  if(!active)throw new Error('OS did not allocate a fetch-safe test port');
  return {client:new ComfyClient(`http://127.0.0.1:${port}`),close:()=>new Promise<void>((r,j)=>s.close(e=>e?j(e):r()))};
}
test('后端支持自定义地址，拒绝带凭据的 URL',()=>{assert.doesNotThrow(()=>new ComfyClient('http://localhost:8199'));assert.doesNotThrow(()=>new ComfyClient('https://example.com'));assert.throws(()=>new ComfyClient('http://127.0.0.1@evil.test'));});
test('HTTPS 后端使用 WSS，且进度只接收本任务',()=>{
  const previous=globalThis.WebSocket;let socket:any;const events:number[]=[];
  try{globalThis.WebSocket=class {url:string;constructor(url:string){this.url=url;socket=this;}close(){}} as any;
    const id=uuid(),close=new ComfyClient('https://comfy.example.com:9443/').watch(uuid(),id,n=>events.push(n));assert.match(socket.url,/^wss:\/\/comfy\.example\.com:9443\/ws\?clientId=/);
    for(const prompt_id of [uuid(),id])socket.onmessage({data:JSON.stringify({type:'progress',data:{prompt_id,value:5,max:25}})});assert.deepEqual(events,[5]);close();
  }finally{globalThis.WebSocket=previous;}
});
test('二进制上传保留 PNG 字节并使用任务隔离目录',async()=>{
  const bytes=new Uint8Array([137,80,78,71,0,255]);let received=false;
  const s=await server((req,res,body)=>{assert.equal(req.url,'/upload/image');assert.equal(body.includes(Buffer.from(bytes)),true);assert.match(body.toString('latin1'),/ps-ai/);received=true;res.end(JSON.stringify({name:'job.png',subfolder:'ps-ai'}));});
  try{assert.equal(await s.client.upload(bytes,'job.png'),'ps-ai/job.png');assert.equal(received,true);}finally{await s.close();}
});
test('只接收指定任务的节点 8 输出，其他任务和预览节点不污染候选',async()=>{
  const id=uuid();const image={filename:'own.png',subfolder:'ps-ai',type:'output'};
  const s=await server((_req,res)=>res.end(JSON.stringify({[id]:{status:{completed:true,status_str:'success'},outputs:{'8':{images:[image]},'30':{images:[{filename:'preview.png'}]}}},other:{outputs:{'8':{images:[{filename:'wrong.png'}]}}}})));
  try{assert.deepEqual(await s.client.status(id),{state:'ready',images:[image]});}finally{await s.close();}
});
test('任务错误先于已有部分输出处理',async()=>{
  const id=uuid();const s=await server((_req,res)=>res.end(JSON.stringify({[id]:{status:{completed:false,status_str:'error',messages:[['execution_error',{exception_message:'out of memory'}]]},outputs:{'8':{images:[{filename:'partial.png'}]}}}})));
  try{assert.equal((await s.client.status(id)).state,'failed');}finally{await s.close();}
});
test('未知 ID 不借用正在运行的其他任务',async()=>{
  const s=await server((req,res)=>res.end(JSON.stringify(req.url?.startsWith('/history')?{}:{queue_running:[[0,uuid()]],queue_pending:[]})));
  try{assert.deepEqual(await s.client.status(uuid()),{state:'unknown'});}finally{await s.close();}
});
test('取消使用宿主已确认的按 ID 原子接口，不发送全局 interrupt',async()=>{
  const id=uuid();let calls=0;const s=await server((req,res,body)=>{calls++;assert.equal(req.url,`/api/jobs/${id}/cancel`);assert.equal(req.method,'POST');res.end(JSON.stringify({cancelled:true}));});
  try{await s.client.cancel(id);assert.equal(calls,1);await assert.rejects(s.client.cancel(''),/ID/);}finally{await s.close();}
});
test('丢失提交回包：先持久化 UUID，再按同一个 ID 恢复，绝不重复 POST',async()=>{
  const id=uuid();const records:JobRecord[]=[];let posts=0;
  const s=await server((req,res,body)=>{
    if(req.method==='POST'){posts++;assert.equal(records[0].state,'submitting');assert.equal(JSON.parse(body.toString()).prompt_id,id);res.destroy();}
    else if(req.url?.startsWith('/history'))res.end('{}');else res.end(JSON.stringify({queue_running:[[0,id]],queue_pending:[]}));
  });
  try{
    const graph=buildGraph({requestId:id,prompt:'blue lightning',seed:42,steps:25,resolution:992});
    const record:JobRecord={id,clientId:uuid(),graph,state:'created',createdAt:'2026-10-12'};
    await new JobCoordinator(s.client,{save:async(r)=>{records.push(structuredClone(r));}}).submit(record);
    assert.equal(record.state,'unknown');assert.equal((await s.client.status(id)).state,'running');assert.equal(posts,1);
  }finally{await s.close();}
});
test('取消无确认且 ID 未知时保留不确定状态，不释放重复提交保护',async()=>{
  const id=uuid();const s=await server((req,res)=>res.end(JSON.stringify(req.url?.includes('/cancel')?{cancelled:false}:req.url?.startsWith('/history')?{}:{queue_running:[],queue_pending:[]})));
  const record:JobRecord={id,clientId:uuid(),state:'unknown',graph:{},createdAt:'2026-10-13'};
  try{await (new JobCoordinator(s.client,{save:async()=>{}}) as any).cancel(record);assert.equal(record.state,'unknown');}finally{await s.close();}
});
test('取消已完成任务不能丢弃候选，返回 ready 状态与文件',async()=>{
  const id=uuid(),image={filename:'own.png',subfolder:'ps-ai',type:'output'};
  const s=await server((req,res)=>res.end(JSON.stringify(req.url?.includes('/cancel')?{cancelled:false}:{[id]:{status:{completed:true,status_str:'success'},outputs:{'8':{images:[image]}}}})));
  const record:JobRecord={id,clientId:uuid(),state:'running',graph:{},createdAt:'2026-10-13'};
  try{const status=await (new JobCoordinator(s.client,{save:async()=>{}}) as any).cancel(record);assert.equal(record.state,'ready');assert.deepEqual(status.images,[image]);}finally{await s.close();}
});
test('收到 HTTP 头但 JSON 响应体卡住时仍超时退出',async()=>{
  const s=await server((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');});
  try{const client=new (ComfyClient as any)(s.client.base,fetch,40);await assert.rejects(client.status(uuid()),/超时/);}finally{await s.close();}
});
