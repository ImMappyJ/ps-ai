import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';import {defaultSettings} from '../src/infrastructure/config/profile';import {uuid} from '../src/infrastructure/backends/client';
const settings={...defaultSettings(),backend:'gateway',baseUrl:'http://localhost:8190',gatewayModel:'qwen-image-2.1-pro',outputDepth:8};

test('selection asset capability is required before any upload or generation POST',async()=>{
  for(const language of ['zh-CN','en-US']){const h=await panelHarness({settings:{...settings,language}});try{
    await h.wait();h.click('tab-cosplay');h.el('resolution').value='512';h.el('destination').value='document';h.change('destination');h.click('generate');await h.wait();
    assert.equal(h.uploads.length,0);assert.equal(h.gatewayPosts.length,0);assert.equal(h.records().length,0);assert.match(h.el('status').textContent,language==='zh-CN'?/不支持参考当前图片与选区/:/current image and selection/);assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'unsupported');
  }finally{await h.close();}}
});

test('supported gateway selection assets send paired source and guide for new-document output',async()=>{
  const h=await panelHarness({settings:{...settings,gatewayModel:'gpt-image-2.5-sunburst'},gateway:{provider:'openai',assetContexts:['selection-v1']}});try{
    await h.wait();h.click('tab-cosplay');h.el('resolution').value='512';h.el('guide').checked=false;h.el('destination').value='document';h.change('destination');h.click('generate');await h.wait();
    assert.equal(h.gatewayPosts.length,1);const request=h.gatewayPosts[0].request;assert.equal(request.assetContext,'selection-v1');assert.equal(request.kind,'asset');assert.equal(request.seed,0);assert.equal(request.reference,undefined);assert.ok(request.source);assert.ok(request.guide);assert.equal(h.uploads.length,2);assert.doesNotMatch(request.prompt,/<image[123]>/);assert.equal((h.records()[0].params as any).destination,'document');
  }finally{await h.close();}
});
test('gateway background modes retain provider guide uploads while disabling source silhouette restoration',async()=>{
  for(const [tab,mode] of [['tab-local','background'],['tab-cosplay','scene']]){
    const h=await panelHarness({settings,selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
      await h.wait();h.click(tab);h.el('mode').value=mode;h.change('mode');assert.equal(h.el('guide').checked,true);assert.equal(h.el('guide').disabled,false);
      // This guide/parameter regression only needs the gateway's minimum 512px canvas.
      h.el('resolution').value='512';h.el('prompt').value='少女站在舞台上';h.click('generate');await h.wait();assert.equal(h.gatewayPosts.length,1);
      const request=h.gatewayPosts[0].request;assert.ok(request.guide);assert.ok(h.uploads.some(u=>u.name.endsWith('-guide.png')));assert.doesNotMatch(request.prompt,/<image[123]>/);assert.match(request.prompt,/少女站在舞台上/);
      const params=h.records()[0].params as any;assert.equal(params.preserveAlpha,false);assert.equal(params.alignSubject,false);assert.equal(params.guide,true);
    }finally{await h.close();}
  }
});
test('面板读取百炼后端配置，隐藏本机权重，禁用步数和16位输出',async()=>{
  const h=await panelHarness({settings});try{await h.wait();assert.ok(h.el('backend-kind'),'Backend selector must exist');assert.equal(h.el('backend-kind').value,'gateway');assert.equal(h.el('local-model-settings').style.display,'none');assert.equal(h.el('steps').disabled,true);assert.equal(h.el('output-depth').disabled,true);assert.match(h.el('cancel').textContent,/停止后续/);assert.match(h.el('gateway-info').textContent,/上传/);}finally{await h.close();}
});
test('百炼启动不检查 Key，显式生成时在捕获和上传前拒绝缺失 Key',async()=>{
  const h=await panelHarness({settings,gateway:{configured:false}});try{await h.wait();assert.equal(h.requests.length,0);assert.equal(h.errors.length,0);h.click('generate');await h.wait();assert.ok(h.errors.some(e=>String(e).includes('DASHSCOPE_API_KEY')));assert.equal(h.captured.length,0);assert.equal(h.uploads.length,0);assert.equal(h.gatewayPosts.length,0);}finally{await h.close();}
});
test('百炼文字生图提交语义请求，候选与历史保持原任务身份',async()=>{
  const h=await panelHarness({settings,noDocuments:true});try{await h.wait();h.click('tab-t2i');h.el('prompt').value='white stockings';h.click('generate');await h.wait();assert.equal(h.gatewayPosts.length,1);assert.equal(h.posts.length,0);const request=h.gatewayPosts[0].request;assert.equal(request.kind,'t2i');assert.equal(request.model,'qwen-image-2.1-pro');assert.equal(request.steps,undefined);assert.equal(h.records()[0].backend,'gateway');assert.equal(h.records()[0].template,'gateway-v1-srgb8');assert.equal(h.records()[0].state,'ready');}finally{await h.close();}
});
test('不支持透明素材的平台模型禁用该模式，仍保留局部编辑',async()=>{
  const h=await panelHarness({settings:{...settings,gatewayModel:'qwen-image-3.0-pro'}});try{await h.wait();h.click('connect');await h.wait();h.click('tab-cosplay');assert.equal(h.el('generate').disabled,true);h.el('mode').value='costume';h.change('mode');assert.equal(h.el('generate').disabled,false);}finally{await h.close();}
});
test('同地址不同后端的旧历史不被误查为网关任务',async()=>{
  const id=uuid(),h=await panelHarness({settings,history:[{id,clientId:uuid(),graph:{},state:'queued',createdAt:'2026-10-17',baseUrl:settings.baseUrl}]});try{await h.wait();assert.equal(h.historySelectedId(),id);h.click('recover');await h.wait();assert.equal(JSON.parse(h.el('diagnostic-details').value).code,'pending-backend');assert.equal(h.requests.some(r=>r.url.includes('/jobs/')),false);assert.equal(h.gatewayPosts.length,0);}finally{await h.close();}
});
test('英文百炼界面说明云端传输和停止后续候选，不改模型或提示词',async()=>{
  const h=await panelHarness({settings:{...settings,language:'en-US'}});try{await h.wait();h.click('connect');await h.wait();assert.equal(h.el('cancel').textContent,'Stop remaining candidates');assert.match(h.el('gateway-info').textContent,/uploaded to Bailian/);assert.equal(h.el('gateway-model').value,'qwen-image-2.1-pro');assert.equal(h.el('prompt').value,'blue lightning');}finally{await h.close();}
});
test('后端类型或地址尚未保存时阻止生成，避免向界面以外的服务发图',async()=>{
  const h=await panelHarness({settings});try{await h.wait();h.el('backend-kind').value='comfyui';h.change('backend-kind');h.click('generate');await h.wait();assert.equal(h.posts.length,0);assert.equal(h.gatewayPosts.length,0);assert.equal(h.captured.length,0);assert.ok(h.errors.some(e=>String(e).includes('先保存')));}finally{await h.close();}
});

test('百炼恢复16位本地历史前明确拒绝，保留可用的8位配置',async()=>{
  const h=await panelHarness({settings});try{await h.wait();const id=uuid();h.files['history.json']=JSON.stringify([{id,clientId:uuid(),graph:{},state:'ready',createdAt:'2026-10-17',params:{workspace:'t2i',mode:'generate',outputDepth:16},userPrompt:'old prompt'}]);await h.refreshHistory();h.selectHistory(id);h.click('repeat-history');await h.wait();assert.equal(h.el('output-depth').value,'8');assert.ok(h.errors.some(e=>String(e).includes('16')));assert.equal(h.el('prompt').value,'blue lightning');}finally{await h.close();}
});

test('Gemini 面板展示实际平台，禁用不支持的种子并可连续生成候选',async()=>{
  const h=await panelHarness({settings:{...settings,language:'en-US',gatewayModel:'gemini-2.5-flash-image'},gateway:{provider:'gemini'},noDocuments:true});try{await h.wait();h.click('connect');await h.wait();assert.match(h.el('gateway-info').textContent,/uploaded to Google Gemini/);assert.equal(h.el('seed').disabled,true);h.click('tab-t2i');h.el('count').value='2';h.click('generate');await h.wait();assert.deepEqual(h.gatewayPosts.map(p=>p.request.seed),[0,0]);assert.equal(h.records().length,2);}finally{await h.close();}
});

test('网关停止期间不声称已发送平台取消，当前完成后保留结果',async()=>{
  const h=await panelHarness({settings,noDocuments:true});try{await h.wait();h.setJobStatus('running');h.click('tab-t2i');h.click('generate');for(let i=0;i<100&&!h.gatewayPosts.length;i++)await new Promise(r=>setTimeout(r,10));h.click('cancel');for(let i=0;i<150&&!h.el('status').textContent.includes('当前平台任务继续');i++)await new Promise(r=>setTimeout(r,20));assert.doesNotMatch(h.el('status').textContent,/已发送指定任务取消/);assert.match(h.el('status').textContent,/当前平台任务继续/);h.setJobStatus('ready');await h.wait();assert.equal(h.records()[0].state,'ready');}finally{h.setJobStatus('ready');await h.wait();await h.close();}
});

test('本地16位历史可作为任务参数复用，不要求改全局8位默认连接',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),outputDepth:8},save16Node:true,noDocuments:true,output:{width:2,height:2,rgba:new Uint16Array(16).fill(65535)}});
  try{await h.wait();const id=uuid();h.files['history.json']=JSON.stringify([{id,clientId:uuid(),graph:{},state:'ready',createdAt:'2026-10-17',params:{workspace:'t2i',mode:'generate',outputDepth:16,steps:4,resolution:32,seed:42,destination:'document',margin:0.1},userPrompt:'white stockings'}]);await h.refreshHistory();h.selectHistory(id);h.click('repeat-history');await h.wait();h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.records()[0].state,'ready');assert.equal(JSON.parse(String(h.files['settings.json'])).outputDepth,8);}finally{await h.close();}
});

test('OpenAI 界面正确标记平台与缺Key说明，生成前不捕获或上传',async()=>{
  const h=await panelHarness({settings:{...settings,gatewayModel:'gpt-image-2.5-sunburst'},gateway:{provider:'openai',configured:false}});
  try{await h.wait();assert.equal(h.requests.length,0);h.click('connect');await h.wait();assert.match(h.el('gateway-info').textContent,/OpenAI Images/);assert.ok(h.errors.some(e=>String(e).includes('OPENAI_API_KEY')));h.click('generate');await h.wait();assert.equal(h.captured.length,0);assert.equal(h.uploads.length,0);assert.equal(h.gatewayPosts.length,0);}finally{await h.close();}
});

test('OpenAI 英文素材模式可提交，不误报方形1K上下文或支持种子',async()=>{
  const h=await panelHarness({settings:{...settings,gatewayModel:'gpt-image-2.5-sunburst',language:'en-US'},gateway:{provider:'openai'},noDocuments:true});
  try{await h.wait();h.click('connect');await h.wait();assert.match(h.el('gateway-info').textContent,/OpenAI Images/);assert.doesNotMatch(h.el('gateway-info').textContent,/square context/);assert.equal(h.el('seed').disabled,true);h.click('tab-cosplay');h.el('asset-input').value='text';h.change('asset-input');h.click('generate');await h.wait();assert.equal(h.gatewayPosts.length,1);assert.equal(h.gatewayPosts[0].request.kind,'asset');assert.equal(h.gatewayPosts[0].request.seed,0);assert.equal(h.captured.length,0);assert.equal(h.uploads.length,0);assert.equal(h.gatewayPosts[0].request.assetContext,undefined);}finally{await h.close();}
});

// The native provider canvas/PNG path takes 20s on serial hosted Windows.
test('面板平台请求使用无编号语义意图，保留原始提示和范围辅助输入',{timeout:60_000},async()=>{
  const h=await panelHarness({settings:{...settings,gatewayModel:'gpt-image-2.5-sunburst'},gateway:{provider:'openai'}});
  try{await h.wait();h.click('generate');await h.wait();assert.equal(h.gatewayPosts.length,1);const request=h.gatewayPosts[0].request;assert.ok(request.guide);assert.doesNotMatch(request.prompt,/<image[123]>/);assert.ok(request.prompt.includes('blue lightning'));assert.equal(h.records()[0].userPrompt,'blue lightning');assert.equal(h.el('prompt').value,'blue lightning');}finally{await h.close();}
});
