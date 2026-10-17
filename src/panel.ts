import {RelayController} from './relay-controller';import {isPlatform,PLATFORMS} from './platforms';import type {PlatformId} from './platforms';import {connectionId,rememberConnection,switchConnection} from './profile';import type {ConnectionId} from './profile';
import {ComfyClient,uuid,OutputFile} from './client';import {JobCoordinator,JobRecord,PENDING_STATES} from './jobs';
import {buildGraph,TEMPLATE_VERSION,templateForDepth} from './workflow';import {intent,Workspace} from './intent';import {BackendSettings,defaultSettings,validateSettings} from './profile';
import {Raster,encodePng,decodePng,decodeModelPng,resize,maskRaster,makeMapping,convertDepth,rasterDepth} from './image';
import {PhotoshopAdapter,Capture,Protection,Snapshot} from './photoshop';import {Storage} from './storage';import {runHostProbe} from './p0-host';
import {prepareEditCandidate} from './composite';
import {createSourceColorReader} from './source-color';
import {t,setLanguage,errorText} from './i18n';
import {normalizeBaseUrl,DEFAULT_MODELS} from './profile';
import {rangePreview} from './range-preview';
import {diagnostic,DiagnosticError} from './diagnostics';import type {Stage} from './diagnostics';import {checkEnvironment} from './environment';
import {GatewayClient} from './gateway-client';
import {DEFAULT_GATEWAY_MODEL,GATEWAY_TEMPLATE,validateGeneration} from './gateway-protocol';
import type {GatewayCapabilities,GenerationRequest} from './gateway-protocol';
declare const require:(name:string)=>any;
const ps=require('photoshop'),uxp=require('uxp'),store=new Storage(uxp),sourceColorReader=createSourceColorReader(uxp),adapter=new PhotoshopAdapter(ps,uuid(),stage=>store.trace(stage),async(doc,file)=>{if(!file)status(t('请选择当前文档的原文件，以读取保存的色彩信息'));return sourceColorReader(doc,file);});
let settings:BackendSettings=defaultSettings(),settingsReady=false,client:ComfyClient|GatewayClient=new ComfyClient(),coordinator=new JobCoordinator(client,store);
const relay=new RelayController(uxp),relayTokens=new Map<PlatformId,string>();
let draftConnections:BackendSettings['connections'],displayedConnection:ConnectionId='comfyui',keyRequest=0;
let gatewayCatalog:GatewayCapabilities|undefined,gatewayCatalogBase:string|undefined;
function backendClient(value:BackendSettings):ComfyClient|GatewayClient {
  if(value.backend!=='gateway')return new ComfyClient(value.baseUrl,fetch,30000,value.models);
  const backend=new GatewayClient(value.baseUrl,value.gatewayModel??DEFAULT_GATEWAY_MODEL,fetch,30000,value.platform?relayTokens.get(value.platform):undefined,!!value.platform);
  if(gatewayCatalogBase===value.baseUrl)backend.capabilities=gatewayCatalog;return backend;
}
async function checkBackend(backend:ComfyClient|GatewayClient,value:BackendSettings){
  let result;
  if(value.platform&&backend instanceof GatewayClient){const ready=await connectDraft(value);backend.token=(ready as GatewayClient).token;if(!(ready as GatewayClient).capabilities?.configured)throw new Error(t('请在面板保存此平台的 API Key，再连接'));}
  try{result=await backend.check(value.outputDepth??8);}
  finally{if(backend instanceof GatewayClient&&backend.capabilities){gatewayCatalog=backend.capabilities;gatewayCatalogBase=value.baseUrl;}}
  if(backend instanceof GatewayClient){
    if(!/^\d+\./.test(String(uxp.host?.version))||Number(String(uxp.host.version).split('.')[0])<27)throw new Error(t('需要 Photoshop 27.0 或更高版本'));
    gatewayCatalog=backend.capabilities;gatewayCatalogBase=value.baseUrl;
  }else checkEnvironment(String(uxp.host?.version??''),result.nodeInfo,value.models,value.outputDepth??8);
  return result;
}
const el=(id:string):any=>document.getElementById(id);
const modes={local:[['edit','局部物体 / 材质修改'],['remove','移除杂物'],['background','换背景（请先反选背景）']],cosplay:[['effect','特效素材'],['costume','服装 / 道具修复'],['reference','角色参考辅助'],['scene','场景替换'],['atmosphere','氛围素材'],['relight','光影重塑']],t2i:[['generate','文字生图']]};
let workspace:Workspace='local',capture:Capture|undefined,protection:Protection|undefined,reference:Raster|undefined;
let current:JobRecord|undefined,busy=false,stopBatch=false,zoomed=false;
let applied:{documentId:number;layerId:number}|undefined;
interface Candidate {job:JobRecord;image:Raster;bytes:Uint8Array;preview:string;snapshot?:Snapshot}
let candidates:Candidate[]=[];
let taskActive=false,taskSucceeded=false,batchPosition='';
let connectionState='未连接';
let operationStage:Stage='connection',setupStep=1,checkedSetup='';
function outputDepth():8|16{return el('output-depth').value==='16'?16:8;}
function draftSettings(id:ConnectionId=el('backend-kind').value):BackendSettings{return validateSettings({schemaVersion:1,baseUrl:el('backend-url').value,language:el('language').value,outputDepth:outputDepth(),connections:draftConnections,...(id!=='comfyui'?{backend:'gateway',gatewayModel:el('gateway-model').value}:{}),...(isPlatform(id)?{platform:id}:{}),models:{unet:el('model-unet').value,clip:el('model-clip').value,vae:el('model-vae').value}});}
async function keyStatus(){const id=el('backend-kind').value,request=++keyRequest;if(!isPlatform(id))return;const saved=await relay.hasKey(id);if(request===keyRequest&&el('backend-kind').value===id)el('key-status').textContent=t(saved?'Key 已保存（加密）':'尚未保存 Key');}
async function connectDraft(value:BackendSettings){if(!value.platform)return backendClient(value);const ready=await relay.connect(value.platform,value.gatewayModel??PLATFORMS[value.platform].model);relayTokens.set(value.platform,ready.token!);gatewayCatalog=ready.capabilities;gatewayCatalogBase=value.baseUrl;return ready;}
function connectionSignature(value:BackendSettings){return JSON.stringify([value.backend??'comfyui',value.platform,value.gatewayModel,value.baseUrl,value.models.unet,value.models.clip,value.models.vae,String(uxp.host?.version??'')]);}
function setupSignature(value:BackendSettings){return JSON.stringify([connectionSignature(value),templateForDepth(value.outputDepth)]);}
function platformName(){const id=isPlatform(el('backend-kind').value)?el('backend-kind').value:gatewayCatalog?.provider;return t(id==='bailian'?'百炼':id==='gemini'?'Google Gemini':id==='openai'?'OpenAI Images':id??'所选平台');}
function renderSetup(){
  el('setup-step').textContent=t('配置向导 · {0} / 3',setupStep);
  el('setup-help').textContent=t(setupStep===1?'展开“模型与连接”，填写地址后测试。':setupStep===2?(settings.backend==='gateway'?'读取服务端支持的平台模型，再检查服务配置。':'扫描实际模型文件，选择后检查环境。'):(settings.backend==='gateway'?'平台配置检查通过。运行示例会上传图片并调用平台，可能产生费用。':'环境检查通过。点击运行示例会使用模型，在独立测试文档中生成并应用。'));
  const preset=(['unet','clip','vae'] as const).every(k=>settings.models[k]===DEFAULT_MODELS[k]);
  el('setup-preset').textContent=t(settings.backend==='gateway'?'平台适配为实验功能；接口已做离线检查，生成效果待 API Key 验证。':preset?'已测试预设：Qwen-Image 2.1 GGUF；速度和显存依硬件而异。':'自定义模型映射：只检查文件和接口，不能据此证明模型架构兼容。');
  el('setup-privacy').textContent=settings.backend==='gateway'?t('图像和提示词会经本机适配服务上传 {0}；运行示例也会调用平台。',platformName()):t(/^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\])(?::\d+)?$/.test(settings.baseUrl)?'图像和提示词发往此本机服务；后端仍会保留输入与输出。':'远程地址：图像和提示词会发送给该服务。仅支持直接可访问的 ComfyUI 根地址；云平台、认证和子路径未验证。');
  el('setup-check').disabled=busy||setupStep<2;el('setup-example').disabled=busy||setupStep!==3;
}
function showSetup(step=1){setupStep=step;el('setup-body').style.display='block';renderSetup();}
function connection(value:string){connectionState=value;el('connection').textContent=t(value);}
function status(text:string){el('status').textContent=errorText(text);}
function taskPhase(text:string,percent=0){el('task-progress').style.display='block';el('task-progress').setAttribute('aria-busy',String(taskActive));el('progress-label').textContent=batchPosition+text;el('progress-bar').setAttribute('value',String(percent));}
function startTask(){taskActive=true;taskSucceeded=false;batchPosition='';taskPhase(t("准备任务…"));}
function endTask(){taskActive=false;taskPhase(taskSucceeded?t("候选已保存"):el('status').textContent,taskSucceeded?100:0);}
function option(select:any,value:string,text:string){const node=document.createElement('option');node.value=value;node.textContent=t(text);select.appendChild(node);}
function inputUi(){
  const standalone=el('destination').value==='document'&&(workspace==='t2i'||['effect','atmosphere'].includes(el('mode').value));el('selection-tools').style.display=standalone?'none':'block';el('prompt').setAttribute('placeholder',workspace==='t2i'?t("描述要生成的画面、主体与风格"):workspace==='cosplay'?t("描述服装道具、光影方向、角色参考或氛围效果"):t("描述选区中要修改的内容，及需要保留的细节"));
  const platform=isPlatform(el('backend-kind').value),cloud=el('backend-kind').value!=='comfyui',model=gatewayCatalogBase===el('backend-url').value?gatewayCatalog?.models.find(m=>m.id===el('gateway-model').value):undefined;
  const kind=workspace==='t2i'?'t2i':['effect','atmosphere'].includes(el('mode').value)?'asset':'edit';
  el('gateway-key-settings').style.display=platform?'block':'none';el('backend-url').disabled=busy||platform;
  el('local-model-settings').style.display=cloud?'none':'block';el('gateway-model-settings').style.display=cloud?'block':'none';
  el('steps').disabled=busy||cloud;el('output-depth').disabled=busy||cloud;
  el('seed').disabled=busy||!!(cloud&&model?.seedMax===0);el('lock-seed').disabled=el('seed').disabled;
  el('generate').disabled=busy||!!(cloud&&model&&!model.operations.includes(kind));
  el('cancel').textContent=t(cloud?'停止后续候选':'取消本任务');
  el('gateway-info').textContent=t('图像和提示词将上传 {0}。输出仅 8 位，步数由平台控制。',platformName())+(model&&!model.operations.includes('asset')?t(' 此模型不支持透明素材。'):'')+(model?.seedMax===0?t(' 此模型不支持设置随机种子。'):'')+(gatewayCatalog?.provider==='gemini'?t(' 使用方形上下文生成，再裁回原比例。'):'')+(gatewayCatalog?.provider==='openai'?t(' 开启范围辅助时使用平台蒙版；结果按请求比例还原。'):'');
}
function candidateUi(){
  const c=candidates[Number(el('candidate-select').value)],mode=c?.snapshot?adapter.applicationMode(c.snapshot):'unavailable';
  el('apply').disabled=busy||!c?.snapshot||mode==='unavailable';el('apply').textContent=t(mode==='replace'?'替换本轮候选图层':'应用为新图层');
  const s=c?.snapshot;el('candidate-target').textContent=s?t('来源文档 {0} · {1} · {2}',s.documentId,s.profile,mode==='unavailable'?t('来源已关闭、改变或会话已结束；候选仍可导出'):mode==='replace'?t('替换同次捕获的插件图层，其他图层保留'):t('新增独立结果，保留来源图层')):c?t('独立生成结果，可另存或新建文档'):'';
  for(const id of ['zoom','export','new-document'])el(id).disabled=busy||!c;el('candidate-select').disabled=busy||!c;el('opacity').disabled=busy||!applied;el('candidate-empty').style.display=candidates.length?'none':'block';el('detail-frame').style.display=c?'block':'none';
}
function setWorkspace(value:Workspace){workspace=value;const select=el('mode');select.innerHTML='';for(const [id,label] of modes[value])option(select,id,label);select.value=modes[value][0][0];for(const w of ['local','cosplay','t2i'])el(`tab-${w}`).className=w===value?'active':'';if(value==='t2i')el('destination').value='document';else el('destination').value='selection';inputUi();}
function lock(value:boolean){busy=value;for(const id of ['generate','capture','protect','clear-protection','reference','clear-reference','tab-local','tab-cosplay','tab-t2i','mode','prompt','output-depth','usage','guide','preserve-alpha','align-subject','match-color','destination','count','steps','resolution','seed','lock-seed','margin','p0','recover','load-history','repeat-history','apply','new-document','connect','scan-models','save-settings','import-settings','export-settings','model-unet','model-clip','model-vae','backend-url','backend-kind','gateway-model','api-key','save-key','clear-key','stop-relay','language','open-setup','close-setup','setup-connect','setup-check','setup-example'])el(id).disabled=value;el('cancel').disabled=!value&&!(current&&PENDING_STATES.includes(current.state));candidateUi();renderSetup();inputUi();}
function showGatewayModels(selected=settings.gatewayModel??DEFAULT_GATEWAY_MODEL){const select=el('gateway-model');select.innerHTML='';for(const id of new Set([selected,...(gatewayCatalogBase===el('backend-url').value?gatewayCatalog?.models.map(m=>m.id)??[]:[])]))option(select,id,id);select.value=selected;}
function showSettings(available?:Record<'unet'|'clip'|'vae',string[]>,value=settings) {for(const key of ['unet','clip','vae'] as const){const select=el(`model-${key}`);select.innerHTML='';for(const name of new Set([value.models[key],...(available?.[key]??[])]))option(select,name,name);select.value=value.models[key];}displayedConnection=connectionId(value);draftConnections=value.connections;el('backend-kind').value=displayedConnection;el('backend-url').value=value.baseUrl;el('output-depth').value=String(value.outputDepth??8);showGatewayModels(value.gatewayModel??(isPlatform(displayedConnection)?PLATFORMS[displayedConnection].model:DEFAULT_GATEWAY_MODEL));el('api-key').value='';void keyStatus();inputUi();}
async function saveSettings(value:unknown){const next=rememberConnection(validateSettings(value));await store.json('settings.json',next);settings=next;client=backendClient(settings);coordinator=new JobCoordinator(client,store);settingsReady=true;restoreSettingsLanguage();showSettings();connection('待检查');status(t(settings.backend==='gateway'?'平台配置已保存；请连接检查模型与 Key。':"模型配置已保存，请连接检查；文件名可迁移，模型权重需在后端准备"));}
async function configure(action:()=>Promise<void>){if(busy)return;lock(true);try{await action();}finally{lock(false);}}
function assertBackend(record:JobRecord){const origin=normalizeBaseUrl(record.baseUrl??'http://localhost:8188',!!settings.platform);if(origin!==settings.baseUrl)throw new Error(t('任务属于后端 {0}；请切回该地址后恢复或取消',origin));if((record.backend??'comfyui')!==(settings.backend??'comfyui'))throw new Error(t('任务使用的后端类型不同，请切回原后端类型后恢复或取消'));}
function restoreSettingsLanguage(){el('output-depth').value=String(settings.outputDepth??8);renderLanguage();}
function renderLanguage(){
  setLanguage(settings.language??'zh-CN');el('language').value=settings.language??'zh-CN';
  for(const node of Array.from(document.querySelectorAll('[data-i18n]')))if(node.id!=='connection')node.textContent=t(node.getAttribute('data-i18n')!);connection(connectionState);
  // UXP keeps the collapsed caption when existing option text is edited.
  for(const id of ['usage','destination','output-depth','backend-kind']){
    const select=el(id),value=select.value;
    const items=Array.from(select.querySelectorAll('option')) as HTMLOptionElement[];
    const labels=items.map(node=>[node.getAttribute('value')!,node.getAttribute('data-i18n')!]);
    select.innerHTML='';
    for(const [key,label] of labels){const node=document.createElement('option');node.setAttribute('value',key);node.setAttribute('data-i18n',label);node.textContent=t(label);select.appendChild(node);}
    select.value=value;
  }
  const mode=el('mode').value;el('mode').innerHTML='';for(const [id,label] of modes[workspace])option(el('mode'),id,label);el('mode').value=mode;
  for(const name of Object.keys(foldLabels))fold(name,el(`${name}-body`).style.display!=='none');
  const index=el('candidate-select').value;el('candidate-select').innerHTML='';candidates.forEach((c,i)=>option(el('candidate-select'),String(i),t('候选 {0} · {1}×{2}',i+1,c.image.width,c.image.height)));if(candidates.length)el('candidate-select').value=index;
  el('zoom').textContent=zoomed?t('适应预览'):t('100% 查看');inputUi();renderSetup();
}
function selected():Candidate {const c=candidates[Number(el('candidate-select').value)];if(!c)throw new Error(t("请先生成或读取一个候选"));return c;}
async function guarded(action:()=>Promise<void>){try{await action();}catch(error){status(error instanceof Error?error.message:String(error));const d=diagnostic(error,operationStage,!!current&&PENDING_STATES.includes(current.state));el('diagnostic-box').style.display='block';el('diagnostic-summary').textContent=[t('失败阶段：{0}',d.stageLabel),d.title,d.effect,d.action,d.retry].join('\n');el('diagnostic-details').value=JSON.stringify(d,null,2);el('diagnostic-details').style.display='none';console.error(error);await store.trace('operation.error');}}
async function preview(image:Raster,size=240):Promise<string> {
  const thumb=convertDepth(resize(image,Math.max(1,Math.round(image.width*Math.min(1,size/Math.max(image.width,image.height)))),Math.max(1,Math.round(image.height*Math.min(1,size/Math.max(image.width,image.height))))),8);
  for(let y=0;y<thumb.height;y++)for(let x=0;x<thumb.width;x++){const i=(y*thumb.width+x)*4,a=thumb.rgba[i+3]/255;const bg=((Math.floor(x/12)+Math.floor(y/12))%2)?105:160;for(let c=0;c<3;c++)thumb.rgba[i+c]=Math.round(thumb.rgba[i+c]*a+bg*(1-a));thumb.rgba[i+3]=255;}
  // Rendering a preview needs no Photoshop Imaging API or native JPEG encoder.
  const bytes=encodePng(thumb),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let encoded='';
  for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]??0)<<8)|(bytes[i+2]??0);encoded+=alphabet[n>>>18]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');}
  return 'data:image/png;base64,'+encoded;
}
function activeDocumentId():number|undefined{return ps.app.documents.length?ps.app.activeDocument?.id:undefined;}
async function captureArea(expectedDocumentId=activeDocumentId(),showPreview=true){
  capture=await adapter.capture(Number(el('margin').value)/100,protection,expectedDocumentId,outputDepth());
  const {snapshot:s,image}=capture;
  if(protection&&capture.workingCopyOf===protection.documentId)protection={...protection,documentId:s.documentId};
  const colorInfo=s.colorReason?t(s.colorReason==='webp-default'?' · WebP 默认 sRGB · 已创建工作副本':' · PNG sRGB 标记 · 已创建工作副本'):` · ${s.profile}`;
  el('source-info').textContent=t("文档 {0} · 区域 {1}×{2} · {3}{4}",s.documentId,image.width,image.height,protection?t('已扣除保护区'):t('未指定保护区'),colorInfo);el('source-preview').src=await preview(image);el('mask-preview').src=await preview(rangePreview(image,s.mask,capture.protectionMask));if(showPreview)el('selection-previews').style.display='flex';
}
async function refreshHistory(){const records=await store.history();const list=el('history'),old=list.value;list.innerHTML='';for(const r of records)option(list,r.id,`${r.createdAt.slice(0,16)} · ${r.state} · ${String(r.userPrompt??'').slice(0,22)}`);if(records.length)list.value=records.some(r=>r.id===old)?old:records[0].id;}
async function restoreSnapshot(record:JobRecord):Promise<Snapshot|undefined> {
  if(!record.snapshot)return undefined;const saved=record.snapshot as Omit<Snapshot,'mask'>;
  return {...saved,mask:await store.readBinary(`${record.id}-mask.bin`)};
}
async function addCandidate(record:JobRecord,bytes:Uint8Array){
  await store.trace('candidate.preview',record.id);
  const snapshot=await restoreSnapshot(record),params=record.params as any;
  let image=decodeModelPng(bytes,String(record.template??""));
  if(params.outputKind==='edit'&&snapshot){
    const expected=params.modelSize;if(!expected||image.width!==expected.width||image.height!==expected.height)throw new DiagnosticError('invalid-output','output',t("候选尺寸与输入工作流不符，已保留原始输出；请检查后端，避免拉伸错位"));
    const source=decodePng(await store.readBinary(`${record.id}-source.png`));
    const maskImage=resize(maskRaster(snapshot.mask,source.width,source.height),image.width,image.height);
    const mask=new Uint8Array(image.width*image.height);for(let i=0;i<mask.length;i++)mask[i]=maskImage.rgba[i*4];
    image=prepareEditCandidate(image,source,{preserveAlpha:params.preserveAlpha!==false,align:params.alignSubject!==false,matchColor:params.matchColor===true,mask});
    bytes=encodePng(image);
  }
  // All exported candidates, including standalone assets, declare sRGB explicitly.
  bytes=encodePng(image);
  const c:Candidate={job:record,bytes,image,preview:await preview(image),snapshot};
  if(candidates.length===4)candidates.shift();candidates.push(c);
  const list=el('candidate-select');list.innerHTML='';el('candidates').innerHTML='';
  candidates.forEach((candidate,index)=>{option(list,String(index),t("候选 {0} · {1}×{2}",index+1,candidate.image.width,candidate.image.height));const img=document.createElement('img');img.src=candidate.preview;img.addEventListener('click',()=>{list.value=String(index);void guarded(showSelected);});el('candidates').appendChild(img);});
  list.value=String(candidates.length-1);await showSelected();await store.trace('candidate.ready',record.id);
}
async function showSelected(){const c=selected();el('detail-preview').src=zoomed?await preview(c.image,Math.max(c.image.width,c.image.height)):c.preview;el('detail-preview').style.width=zoomed?`${c.image.width}px`:'100%';el('detail-preview').style.height=zoomed?`${c.image.height}px`:'170px';candidateUi();}
async function saveReady(record:JobRecord,images:OutputFile[]) {
  operationStage='output';
  record.state='downloading';record.outputs=images;
  try{await store.trace('candidate.download',record.id);const bytes=await client.output(images[0]);await store.binary(`${record.id}-output.png`,bytes);record.outputFile=`${record.id}-output.png`;decodeModelPng(bytes,String(record.template??""));record.state='ready';await store.save(record);await addCandidate(record,bytes);}
  catch(error){record.state='output-error';record.detail=error instanceof Error?error.message:String(error);await store.save(record);throw error;}
}
async function waitRecord(record:JobRecord):Promise<boolean> {
  let steps:{value:number;max:number}|undefined;
  function showSteps(){if(!steps)return;const percent=Math.round(steps.value/steps.max*100);taskPhase(t("推理 {0} / {1} 步 · {2}%",steps.value,steps.max,percent),percent);status(t("候选推理：{0} / {1} 步\n任务 {2}",steps.value,steps.max,record.id.slice(0,8)));}
  const closeSocket=client.watch(record.clientId,record.id,(step,max)=>{if(stopBatch||!Number.isFinite(step)||!Number.isFinite(max)||max<=0||step<0||step>max)return;steps={value:step,max};showSteps();});
  const start=Date.now();let unknownReads=0;
  try {
    while(Date.now()-start<3600000) {
      if(stopBatch){
        taskPhase(t(client instanceof GatewayClient?'后续候选已停止；当前平台任务继续，完成后保留结果':"正在确认取消…"));
        const result=await coordinator.cancel(record);
        if(result.state==='ready'){await saveReady(record,result.images!);status(t("任务已完成，候选已保留；后续候选停止"));return false;}
        if(result.state==='cancelled'){status(t("本任务取消已确认；已有候选保留"));return false;}
        if(result.state==='unknown')throw new Error(t("取消未确认，原任务 ID 已保留；请继续恢复或取消，不要重复生成"));
        if(result.state==='failed')throw new Error(result.detail||t("任务失败"));
        status(t(client instanceof GatewayClient?'后续候选已停止；当前平台任务继续，完成后保留结果':"已发送指定任务取消，等待后端终态…"));await new Promise(r=>setTimeout(r,2000));continue;
      }
      try {
        const result=await client.status(record.id);
        if(result.state==='ready') {
          taskPhase(t("推理完成，下载与保存候选…"),100);await saveReady(record,result.images!);taskPhase(t("候选已保存"),100);status(t("候选已就绪，请预览后应用"));return true;
        }
        if(result.state==='failed'||result.state==='cancelled'){record.state=result.state;record.detail=result.detail;await store.save(record);throw new DiagnosticError(result.code??'unknown','inference',result.detail||t("任务已取消"));}
        record.state=result.state;
        if(result.state==='unknown') {if(++unknownReads>=15)throw new Error(t("未确认任务状态，已保留 ID；请使用“恢复任务”，不要重复提交"));}
        else unknownReads=0;
        if(result.state==='running'&&steps)showSteps();else{const phase=result.state==='running'?t(client instanceof GatewayClient?'平台生成中（无步数进度）':"模型加载／推理中，等待步数"):result.state==='queued'?t("已排队，等待执行"):t("按原 ID 查询任务");taskPhase(phase);status(`${phase} · ${record.id.slice(0,8)}`);}
      }catch(error){
        if(record.state==='output-error')throw error;
        if(record.state==='failed'||record.state==='cancelled'||unknownReads>=15)throw error;
        taskPhase(t("连接中断，按原 ID 恢复…"));status(t("连接中断，正在按原 ID 恢复：{0}",record.id.slice(0,8)));
      }
      await new Promise(r=>setTimeout(r,2000));
    }
    throw new Error(t("等待已超时；任务保留，请按 ID 恢复"));
  } finally {closeSocket();await store.save(record);await refreshHistory();}
}
async function generate() {
  if(busy)return;
  if(!settingsReady)throw new Error(t("设置尚未加载或配置损坏，请保存或导入有效配置"));
  if(connectionSignature(draftSettings())!==connectionSignature(settings))throw new Error(t('后端配置已改变，请先保存并检查连接'));
  const expectedDocumentId=activeDocumentId();
  stopBatch=false;
  el('diagnostic-box').style.display='none';
  startTask();
  lock(true);
  try {
  await store.trace('generate.start');
  const pending=(await store.history()).find(r=>PENDING_STATES.includes(r.state));
  if(pending){current=pending;assertBackend(pending);throw new Error(t("存在尚未确认的任务，请先恢复或取消本任务"));}
  const mode=el('mode').value,userPrompt=el('prompt').value,guide=!!el('guide').checked,destination=el('destination').value,usage=el('usage').value;
  const request=intent(workspace,mode,userPrompt,!!reference,guide,usage,client instanceof GatewayClient?'semantic':'images');
  const depth=outputDepth();const count=Number(el('count').value),steps=Number(el('steps').value),resolution=Number(el('resolution').value),margin=Number(el('margin').value)/100;
  let baseSeed=el('lock-seed').checked?Number(el('seed').value):Math.floor(Math.random()*2**31),seedSupported=true;
  if(!Number.isInteger(count)||count<1||count>4)throw new Error(t("候选数量须为 1–4"));
  if(!(client instanceof GatewayClient))buildGraph({requestId:uuid(),prompt:request.prompt,seed:baseSeed+count-1,steps,resolution,models:settings.models,outputDepth:outputDepth()});
  if(request.kind==='edit'&&destination!=='selection')throw new Error(t("编辑补丁需要捕获来源选区"));
  if(destination==='selection'&&expectedDocumentId===undefined)throw new Error(t("请先打开 Photoshop 文档并建立选区"));
    operationStage='environment';const checking=t(client instanceof GatewayClient?'检查平台服务与模型能力…':"检查节点与本机模型…");taskPhase(checking);status(checking);await checkBackend(client,{...settings,outputDepth:depth});
    if(client instanceof GatewayClient){const chosenModel=client.model,model=client.capabilities!.models.find(m=>m.id===chosenModel)!;if(!model.operations.includes(request.kind))throw new Error(t('此平台模型不支持当前模式'));seedSupported=model.seedMax!==0;if(!seedSupported)baseSeed=0;else if(!Number.isSafeInteger(baseSeed)||baseSeed<0||baseSeed+count-1>model.seedMax)throw new Error(t('平台种子超出范围，请减小种子或候选数量'));}
    // Always recapture at submission; a thumbnail saved earlier is not a fresh document state.
    operationStage='capture';if(destination==='selection')await captureArea(expectedDocumentId);else capture=undefined;
    const captured=capture,ref=reference;
    for(let index=0;index<count&&!stopBatch;index++) {
      batchPosition=t("候选 {0} / {1} · ",index+1,count);taskPhase(t("准备与上传输入…"));status(t("上传候选 {0} / {1} 的输入…",index+1,count));const id=uuid(),clientId=uuid();
      const seed=seedSupported?baseSeed+index:0;
      const snapshot=captured?.snapshot;
      let source:string|undefined,guideName:string|undefined,referenceName:string|undefined,modelSize:{width:number;height:number}|undefined,generationRequest:GenerationRequest|undefined;
      if(client instanceof GatewayClient){
        const size=request.kind==='edit'?makeMapping(snapshot!.bounds,resolution):{width:resolution,height:resolution};
        generationRequest=validateGeneration({model:client.model,kind:request.kind,mode,prompt:request.prompt,seed,width:size.width,height:size.height,outputDepth:depth,...(request.kind==='edit'?{source:`${id}-source.png`,...(guide?{guide:`${id}-guide.png`}:{}),...(ref?{reference:`${id}-reference.png`}:{})}:{})},client.capabilities!);
      }
      if(snapshot){await store.binary(`${id}-mask.bin`,snapshot.mask);await store.binary(`${id}-source.png`,encodePng(captured!.image));}
      if(request.kind==='edit') {
        const mapping=makeMapping(snapshot!.bounds,resolution);
        modelSize={width:mapping.width,height:mapping.height};
        const image=resize(captured!.image,mapping.width,mapping.height);
        source=await client.upload(encodePng(convertDepth(image,8)),`${id}-source.png`);
        if(guide){const mask=resize(maskRaster(snapshot!.mask,captured!.image.width,captured!.image.height),mapping.width,mapping.height);guideName=await client.upload(encodePng(mask),`${id}-guide.png`);}
        if(ref){const refMap=makeMapping({left:0,top:0,right:ref.width,bottom:ref.height},resolution);referenceName=await client.upload(encodePng(resize(ref,refMap.width,refMap.height)),`${id}-reference.png`);}
      }
      if(stopBatch)break;
      const graph=client instanceof GatewayClient?{}:buildGraph({requestId:id,prompt:request.prompt,seed,steps,resolution,source,guide:guideName,reference:referenceName,models:settings.models,outputDepth:outputDepth()});
      const {mask:ignored,...metadata}=snapshot??{mask:undefined};
      current={id,clientId,baseUrl:settings.baseUrl,state:'created',createdAt:new Date().toISOString(),graph,...(generationRequest?{backend:'gateway' as const,request:generationRequest}:{}),userPrompt,params:{workspace,mode,steps,resolution,seed,outputDepth:depth,guide,margin,usage,destination,outputKind:request.kind,modelSize,preserveAlpha:!!el('preserve-alpha').checked,alignSubject:!!el('align-subject').checked,matchColor:!!el('match-color').checked},snapshot:snapshot?metadata:undefined,template:generationRequest?GATEWAY_TEMPLATE:templateForDepth(depth),...(generationRequest?{providerModel:generationRequest.model}:{models:{...settings.models}})};
      operationStage='inference';await store.trace('task.submit',id);await coordinator.submit(current);await store.trace('task.wait',id);
      if(current.state==='failed')throw new Error(current.detail);
      if(!await waitRecord(current))break;
      if(index===count-1)taskSucceeded=true;
    }
  }catch(error){status(error instanceof Error?error.message:String(error));throw error;}finally{endTask();lock(false);await refreshHistory();}
}
async function recover(){
  if(busy)return;startTask();lock(true);
  try {const records=await store.history();current=records.find(r=>r.id===el('history').value)||records.find(r=>PENDING_STATES.includes(r.state));
  if(!current)throw new Error(t("没有可恢复的任务"));
  assertBackend(current);if(settings.platform&&client instanceof GatewayClient){const ready=await connectDraft(settings) as GatewayClient;client.token=ready.token;}stopBatch=false;taskSucceeded=await waitRecord(current);}catch(error){status(error instanceof Error?error.message:String(error));throw error;}finally{endTask();lock(false);}
}
async function apply(){if(busy)return;lock(true);try{const c=selected();if(!c.snapshot)throw new Error(t("此候选没有来源选区，请使用新文档查看"));const params=c.job.params as any;const source=params.outputKind==='edit'&&params.preserveAlpha!==false?decodePng(await store.readBinary(`${c.job.id}-source.png`)):undefined;const layerId=await adapter.apply(c.snapshot,c.image,`PS-AI ${c.job.id.slice(0,8)}`,source);applied={documentId:c.snapshot.documentId,layerId};el('opacity').value=100;status(t("已应用为独立图层，蒙版可编辑；同次捕获切换候选替换此图层，Ctrl+Z 一次撤销"));}finally{lock(false);}}
function on(id:string,action:()=>Promise<void>){el(id).addEventListener('click',()=>void guarded(async()=>{operationStage=['apply','new-document','opacity'].includes(id)?'apply':['capture','protect','reference'].includes(id)?'capture':['scan-models','setup-check'].includes(id)?'environment':['recover','generate','setup-example','cancel'].includes(id)?'inference':'connection';await action();}));}
const foldLabels:Record<string,string>={settings:'模型与连接',reference:'参考图（可选）',advanced:'进阶参数',diagnostics:'宿主诊断'};
function fold(name:string,open:boolean){el(`${name}-body`).style.display=open?'block':'none';el(`toggle-${name}`).textContent=t(foldLabels[name])+(open?' ▾':' ▸');el(`toggle-${name}`).setAttribute('aria-expanded',String(open));}
for(const name of Object.keys(foldLabels)){fold(name,false);on(`toggle-${name}`,async()=>fold(name,el(`${name}-body`).style.display==='none'));}
el('selection-previews').style.display='none';
setWorkspace('local');
el('usage').value='服装';
el('preserve-alpha').checked=true;el('align-subject').checked=true;
showSettings();
el('output-depth').addEventListener('change',()=>void guarded(()=>configure(async()=>{const next=validateSettings({...settings,outputDepth:outputDepth()});await store.json('settings.json',next);settings=next;checkedSetup='';})));
el('language').addEventListener('change',()=>void guarded(()=>configure(async()=>{const next=validateSettings({...settings,language:el('language').value});await store.json('settings.json',next);settings=next;renderLanguage();})));
el('backend-kind').addEventListener('change',()=>void guarded(async()=>{const target=el('backend-kind').value as ConnectionId;try{const next=switchConnection(draftSettings(displayedConnection),target);checkedSetup='';showSettings(undefined,next);status(t('后端配置已改变，请先保存并检查连接'));}catch(error){el('backend-kind').value=displayedConnection;throw error;}}));
el('gateway-model').addEventListener('change',()=>{checkedSetup='';inputUi();});
on('scan-models',()=>configure(async()=>{
  if(el('backend-kind').value!=='comfyui'){
    const selected=el('gateway-model').value,probe=await connectDraft(draftSettings()),catalog=await (probe as GatewayClient).connect();gatewayCatalog=catalog;gatewayCatalogBase=normalizeBaseUrl(el('backend-url').value,isPlatform(el('backend-kind').value));showGatewayModels(selected);inputUi();status(t('已读取平台模型能力；账户权限和生成效果仍需 API Key 验证'));
  }else{const draft=draftSettings(),found=await new ComfyClient(draft.baseUrl,fetch,30000,draft.models).inspect();showSettings(found.models,draft);status(t("扫描完成；请选择 Qwen 2.1 对应模型后保存。扫描到文件不代表架构兼容。"));}
}));
on('save-settings',()=>configure(()=>saveSettings(draftSettings())));
on('save-key',()=>configure(async()=>{const id=el('backend-kind').value;if(!isPlatform(id))return;const key=el('api-key').value;el('api-key').value='';await relay.saveKey(id,key);const probe=await connectDraft(draftSettings());gatewayCatalog=(probe as GatewayClient).capabilities;gatewayCatalogBase=probe.base;showGatewayModels(el('gateway-model').value);await keyStatus();inputUi();status(t('Key 已保存（加密）'));}));
on('clear-key',()=>configure(async()=>{const id=el('backend-kind').value;if(!isPlatform(id))return;el('api-key').value='';await relay.clearKey(id);await keyStatus();connection('待检查');status(t('Key 已清除'));}));
on('stop-relay',()=>configure(async()=>{const id=el('backend-kind').value;if(isPlatform(id)){await relay.stop(id);relayTokens.clear();connection('未连接');status(t('本地服务正在停止；未完成任务会保留，连接平台可重新启动'));}}));
on('import-settings',()=>configure(async()=>{const file=await uxp.storage.localFileSystem.getFileForOpening({types:['json']});if(file)await saveSettings(JSON.parse(await file.read()));}));
on('export-settings',()=>configure(async()=>{if(!settingsReady)throw new Error(t("请先保存有效配置"));const file=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-settings.json',{types:['json']});if(file)await file.write(JSON.stringify(settings,null,2));}));
for(const w of ['local','cosplay','t2i'] as Workspace[])on(`tab-${w}`,async()=>{if(!busy)setWorkspace(w);});
on('connect',()=>configure(async()=>{const next=draftSettings();await checkBackend(backendClient(next),next);await saveSettings(next);connection('已连接');status(t(next.backend==='gateway'?'平台服务配置检查通过；真实生成效果仍需验收':'ComfyUI 与模型已连接'));el('diagnostic-box').style.display='none';}));
on('open-setup',async()=>{showSetup();fold('settings',true);});
on('close-setup',async()=>{el('setup-body').style.display='none';});
on('setup-connect',()=>configure(async()=>{
  const next=draftSettings();const probe=await connectDraft(next);await probe.connect();if(probe instanceof GatewayClient){gatewayCatalog=probe.capabilities;gatewayCatalogBase=next.baseUrl;}
  await saveSettings(next);checkedSetup='';showSetup(2);connection('待检查');el('diagnostic-box').style.display='none';
}));
on('setup-check',()=>configure(async()=>{
  const next=draftSettings(),result=await checkBackend(backendClient(next),next);
  await saveSettings(next);checkedSetup=setupSignature(next);
  const report={date:new Date().toISOString(),host:String(uxp.host?.version??''),backend:next.backend==='gateway'?`${gatewayCatalog?.provider??'unknown'} / ps-ai/1`:(result.stats as any)?.system?.comfyui_version??'unknown',template:next.backend==='gateway'?GATEWAY_TEMPLATE:templateForDepth(next.outputDepth),models:next.backend==='gateway'?next.gatewayModel:next.models,checked:next.backend==='gateway'?'Local protocol / server key presence; platform authorization and output require live acceptance':'API / nodes / model filenames; model architecture requires example generation'};
  await store.json('setup-check.json',report);el('setup-report').textContent=`Photoshop ${report.host} · ComfyUI ${report.backend} · ${report.template}`;
  showSetup(3);connection('已连接');el('diagnostic-box').style.display='none';
}));
on('setup-example',async()=>{
  if(busy)return;
  if(setupStep!==3||checkedSetup!==setupSignature(draftSettings())||checkedSetup!==setupSignature(settings))throw new Error(t('配置已改变，请重新检查环境后运行示例'));
  lock(true);
  const previous=ps.app.documents.length?ps.app.activeDocument:undefined;
  const oldWorkspace=workspace,oldReference=reference,oldProtection=protection,oldMode=el('mode').value;
  const fields=['prompt','count','steps','resolution','seed','margin','destination'],checks=['guide','preserve-alpha','align-subject','match-color','lock-seed'];
  const oldValues=fields.map(id=>el(id).value),oldChecks=checks.map(id=>el(id).checked);
  let completed=false;
  try{
    if((await store.history()).some(r=>PENDING_STATES.includes(r.state)))throw new Error(t('存在尚未确认的任务，请先恢复或取消本任务'));
    const width=128,height=128,rgba=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(x>=32&&x<96&&y>=32&&y<96?[170,85,65,255]:[110,110,110,255],(y*width+x)*4);
    const id=await adapter.newDocument({width,height,rgba},'PS-AI setup example');
    await ps.core.executeAsModal(async()=>{let mask:any;try{const gray=new Uint8Array(width*height);for(let y=32;y<96;y++)gray.fill(255,y*width+32,y*width+96);mask=await ps.imaging.createImageDataFromBuffer(gray,{width,height,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2'});await ps.imaging.putSelection({documentID:id,imageData:mask,replace:true});}finally{mask?.dispose();}},{commandName:'PS-AI setup selection'});
    reference=undefined;protection=undefined;setWorkspace('local');el('prompt').value='把中央棕色色块变为蓝色，保留其他区域。';el('count').value='1';el('steps').value='25';el('resolution').value='768';el('margin').value='15';el('guide').checked=true;el('align-subject').checked=false;el('match-color').checked=false;
    lock(false);await generate();
    if(!taskSucceeded||selected().snapshot?.documentId!==id)throw new Error(t('示例未完成，候选和任务记录已保留'));
    await apply();completed=true;el('setup-report').textContent=t('示例已生成并应用到独立测试文档；可预览蒙版并用 Ctrl+Z 撤销。');
    await store.json('setup-example.json',{date:new Date().toISOString(),passed:true,taskId:selected().job.id,documentId:id,layerId:applied?.layerId});
  }finally{
    reference=oldReference;protection=oldProtection;setWorkspace(oldWorkspace);el('mode').value=oldMode;
    fields.forEach((id,i)=>el(id).value=oldValues[i]);checks.forEach((id,i)=>el(id).checked=oldChecks[i]);capture=undefined;el('selection-previews').style.display='none';el('source-info').textContent=t('范围参数已改变，请重新预览选区');inputUi();lock(false);
    if(!completed&&previous&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===previous.id))await ps.core.executeAsModal(async()=>{ps.app.activeDocument=previous;},{commandName:'PS-AI restore document'});
  }
});
on('toggle-error-details',async()=>{el('diagnostic-details').style.display=el('diagnostic-details').style.display==='none'?'block':'none';});
on('capture',captureArea);
on('protect',async()=>{protection=await adapter.protection();capture=undefined;el('selection-previews').style.display='none';el('source-info').textContent=t("保护区已保存；请重新圈选编辑区，再捕获或生成");status(t("保护区保留原始像素，不依赖自动人脸识别"));});
on('clear-protection',async()=>{protection=undefined;capture=undefined;el('selection-previews').style.display='none';el('source-info').textContent=t("保护区已清除，请重新捕获");});
on('reference',async()=>{const file=await uxp.storage.localFileSystem.getFileForOpening({types:['png','jpg','jpeg','webp']});if(!file)return;reference=await adapter.importReference(file);el('reference-info').textContent=`${file.name} · ${reference.width}×${reference.height} · sRGB 8-bit`;});
on('clear-reference',async()=>{reference=undefined;el('reference-info').textContent=t("未选择参考图");});
on('generate',generate);on('apply',apply);on('recover',recover);
on('cancel',async()=>{stopBatch=true;if(!busy&&current){lock(true);try{assertBackend(current);const result=await coordinator.cancel(current);if(result.state==='ready'){await saveReady(current,result.images!);status(t("任务已完成，候选已保留"));}else status(result.state==='cancelled'?t("取消已确认；生成文件保留"):t(client instanceof GatewayClient?'后续候选已停止；当前平台任务继续，完成后保留结果':"取消尚未确认，请继续恢复或取消原任务"));await refreshHistory();}finally{lock(false);}}});
el('mode').addEventListener('change',()=>{inputUi();if(workspace==='cosplay'&&el('mode').value==='reference'){fold('reference',true);el('guide').checked=false;status(t("角色参考默认使用原图 + 参考图；范围辅助可能影响颜色，请按需试验"));}});
el('destination').addEventListener('change',inputUi);
el('margin').addEventListener('change',()=>{capture=undefined;el('selection-previews').style.display='none';el('source-info').textContent=t('范围参数已改变，请重新预览选区');});
el('candidate-select').addEventListener('change',()=>void guarded(showSelected));
on('zoom',async()=>{zoomed=!zoomed;el('zoom').textContent=zoomed?t("适应预览"):t("100% 查看");await showSelected();});
on('export',async()=>{const c=selected(),file=await uxp.storage.localFileSystem.getFileForSaving(`ps-ai-${c.job.id.slice(0,8)}.png`,{types:['png']});if(file)await file.write(new Uint8Array(c.bytes).buffer,{format:uxp.storage.formats.binary});});
on('new-document',async()=>{const c=selected();await adapter.newDocument(c.image,`ps-ai ${c.job.id.slice(0,8)}`);});
el('opacity').addEventListener('change',()=>void guarded(async()=>{if(!applied)throw new Error(t("请先应用一个候选"));await adapter.opacity(applied.documentId,applied.layerId,Number(el('opacity').value));}));
on('load-history',async()=>{const record=(await store.history()).find(r=>r.id===el('history').value);if(!record?.outputFile)throw new Error(t("此记录尚未保存候选，请恢复任务"));await addCandidate(record,await store.readBinary(String(record.outputFile)));});
on('repeat-history',async()=>{const r=(await store.history()).find(r=>r.id===el('history').value);if(!r)throw new Error(t("请选择历史记录"));const p=r.params as any;if(settings.backend==='gateway'&&p.outputDepth===16)throw new Error(t('此历史为 16 位输出，请切回 ComfyUI 后恢复参数；当前平台配置保留 8 位'));setWorkspace(p.workspace);el('mode').value=p.mode;el('prompt').value=r.userPrompt;for(const name of ['steps','resolution','seed','destination'])el(name).value=p[name];el('output-depth').value=String(p.outputDepth??8);el('usage').value=['服装','道具','材质','场景'].includes(p.usage)?p.usage:'服装';el('guide').checked=p.guide;el('preserve-alpha').checked=p.preserveAlpha!==false;el('align-subject').checked=p.alignSubject!==false;el('match-color').checked=p.matchColor===true;el('margin').value=p.margin*100;el('lock-seed').checked=true;inputUi();status(t("参数已恢复；参考图和保护区请重新指定，提交时重新捕获"));});
on('p0',async()=>{if(busy)return;lock(true);const trace:string[]=[];try{const report=await runHostProbe(ps,adapter,trace);await store.json('p0-host-report.json',report);status(t("P0 宿主往返通过：选区外/保护区像素、原图层、蒙版、异文档与一次撤销"));}catch(error){await store.json('p0-host-report.json',{passed:false,date:new Date().toISOString(),trace,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined});throw error;}finally{lock(false);}});
on('report',async()=>{const r=await store.readJson('p0-host-report.json',null);if(!r)throw new Error(t("请先运行 P0 图像往返验证"));const f=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-p0-host-report.json',{types:['json']});if(f)await f.write(JSON.stringify(r,null,2));});
on('export-log',async()=>{const r=await store.readJson('runtime-trace.json',null);if(!r)throw new Error(t("尚无操作阶段日志"));const f=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-runtime-trace.json',{types:['json']});if(f)await f.write(JSON.stringify(r,null,2));});
uxp.entrypoints.setup({panels:{psai:{show(){}}}});
void guarded(async()=>{lock(true);el('cancel').disabled=true;try{const savedSettings=await store.readJson<unknown>('settings.json',null);settings=validateSettings(savedSettings??defaultSettings());client=backendClient(settings);coordinator=new JobCoordinator(client,store);settingsReady=true;el('backend-url').value=settings.baseUrl;restoreSettingsLanguage();showSettings();await refreshHistory();const records=await store.history();const pending=records.find(r=>PENDING_STATES.includes(r.state));if(pending){current=pending;status(t("找到未确认任务 {0}，请选择恢复或取消",pending.id.slice(0,8)));}try{await checkBackend(client,settings);showGatewayModels();connection('已连接');if(!savedSettings)showSetup();}catch(error){connection('未连接');showSetup();throw error;}}catch(error){showSetup();fold('settings',true);throw error;}finally{lock(false);}});
