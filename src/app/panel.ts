import {RelayController} from '../infrastructure/backends/relay-controller';import {isPlatform,PLATFORMS} from '../infrastructure/backends/platforms';import type {PlatformId} from '../infrastructure/backends/platforms';import {connectionId,rememberConnection,switchConnection} from '../infrastructure/config/profile';import type {ConnectionId} from '../infrastructure/config/profile';
import {ComfyClient,uuid,OutputFile} from '../infrastructure/backends/client';import {JobCoordinator,JobRecord,blocksGeneration} from '../generation/jobs';
import {buildGraph,TEMPLATE_VERSION,templateForDepth} from '../generation/workflow';import {intent,Workspace,isBackgroundMode} from '../generation/intent';import {BackendSettings,defaultSettings,validateSettings} from '../infrastructure/config/profile';
import {Raster,encodePng,decodePng,decodeModelPng,resize,maskRaster,makeMapping,rasterDepth} from '../imaging/image';
import {PhotoshopAdapter,Capture,Protection,Snapshot,SelectionRange} from '../infrastructure/photoshop/photoshop';import {Storage,type HistoryCleanupStatus} from '../infrastructure/storage/storage';import {runHostProbe} from '../diagnostics/p0-host';
import {createSourceColorReader} from '../infrastructure/photoshop/source-color';
import {editBehavior,editModelInput} from '../features/editing/edit-behavior';
import {t,setLanguage,errorText,english} from '../localization/i18n';
import {normalizeBaseUrl,DEFAULT_MODELS} from '../infrastructure/config/profile';
import {rangePreview} from '../features/editing/range-preview';
import {diagnostic,DiagnosticError} from '../diagnostics/diagnostics';import type {Stage} from '../diagnostics/diagnostics';import {checkEnvironment} from '../diagnostics/environment';
import {BUILD_ID} from '../diagnostics/build';
import {GatewayClient} from '../infrastructure/backends/gateway-client';
import {DEFAULT_GATEWAY_MODEL,GATEWAY_TEMPLATE,validateGeneration} from '../infrastructure/backends/gateway-protocol';
import type {GatewayCapabilities,GenerationRequest} from '../infrastructure/backends/gateway-protocol';
import {RelightSession,RelightDraftStore,relightTaskMetadata,type FrozenRelightSubmission,type RelightTaskMetadata,type RelightScope} from '../features/relight/relight-session';
import {RelightWorkbench,type RelightResult} from '../features/relight/relight-workbench';
import {compileRelightScene,validateRelightScene,type RelightScene,type RelightCapabilities} from '../features/relight/relight-scene';
import {decomposeRelightCompensation} from '../features/relight/relight-compensation';
import {PanelViews,CandidatePreview,SourceCaption,localValidationMessage,createCandidateCard,setCandidateCardState,displayPreview as preview} from './panel-view';
import {HistoryTable,historyTaskType,historyPrompt,historyState,historySource,historyDate} from './history-table';
import {prepareCandidate,historyOutputName} from './candidate-preparation';
import {HistoryPreview} from './history-preview';
declare const require:(name:string)=>any;
const ps=require('photoshop'),uxp=require('uxp'),store=new Storage(uxp),sourceColorReader=createSourceColorReader(uxp,{storage:store,onPicker:()=>status(t('请选择当前文档的原文件，以读取保存的色彩信息')),onStatus:sourceAccessStatus}),adapter=new PhotoshopAdapter(ps,uuid(),stage=>store.trace(stage),sourceColorReader);
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
const views=new PanelViews(document),candidatePreview=new CandidatePreview(),sourceCaption=new SourceCaption(el('source-info'));
el('build-id').textContent=BUILD_ID;
const modes={local:[['edit','局部物体 / 材质修改'],['remove','移除杂物'],['background','换背景（选择主体）']],cosplay:[['effect','特效素材'],['costume','服装 / 道具修复'],['reference','角色参考辅助'],['scene','场景替换'],['atmosphere','氛围素材'],['relight','光影重塑'],['blend','溶图']],t2i:[['generate','文字生图']]};
let workspace:Workspace='local',capture:Capture|undefined,protection:Protection|undefined,reference:Raster|undefined;
let lastSelection:{range:SelectionRange;workspace:Workspace;mode:string}|undefined;
let current:JobRecord|undefined,busy=false,stopBatch=false,zoomed=false;
let historyRecords:JobRecord[]=[],detachAcknowledgedId:string|undefined;
let applied:{documentId:number;layerId:number;jobId:string}|undefined;
interface Candidate {job:JobRecord;image:Raster;bytes:Uint8Array;preview:string;snapshot?:Snapshot;warning?:string}
let candidates:Candidate[]=[];
let taskActive=false,taskSucceeded=false,batchPosition='';
let connectionState='未连接';
let operationStage:Stage='connection',setupStep=1,checkedSetup='';
let sourceAccessMessage='',sourceAccessNotice=0,sourceAccessOperation=0;
const overriddenChecks=new Map<string,boolean>();
let promptKind:'ordinary'|'blend'='ordinary';
const promptDrafts={ordinary:'',blend:''};
const relightDrafts=new RelightDraftStore(store);
let relightWorkbench:RelightWorkbench|undefined,relightSession:RelightSession|undefined,relightMargin=.15,relightReuse:RelightScene|undefined,relightReuseDescription:string|undefined;
let clearConfirmation:{ids:readonly string[];revision:number;signature:string;unresolved:number}|undefined;
let cleanupStatus:HistoryCleanupStatus|undefined,historyNotice='',lastHistoryFocus:string|undefined;
let pendingDetailReveal=false,historyRevealTimer:ReturnType<typeof setTimeout>|undefined;
const historyPreview=new HistoryPreview(el('history-preview'),el('history-preview-status'),async record=>{
  const name=historyOutputName(record),bytes=await store.readBinary(name),prepared=await prepareCandidate(record,bytes,name=>store.readBinary(name));
  return {url:await preview(prepared.image,480),warning:prepared.warning};
});
const historyTable=new HistoryTable(el('history-browser'),{busy:()=>busy,changed:()=>{detachAcknowledgedId=undefined;clearConfirmation=undefined;historyNotice='';historyUi();},refresh:()=>void guarded(()=>configure(()=>refreshHistory()))});
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
function showSetup(step=1){setupStep=step;views.show('settings');el('setup-body').style.display='block';renderSetup();}
function connection(value:string){connectionState=value;el('connection').textContent=t(value);}
function status(text:string){el('status').textContent=errorText(text);el('status').style.display='block';}
function sourceAccessStatus(message:string){sourceAccessNotice++;sourceAccessMessage=message;el('source-access-status').textContent=t(message);}
function relightScope():RelightScope {const scope=el('relight-scope').value;if(scope!=='selection'&&scope!=='document')throw new Error(t('布光范围无效，请重新选择'));return scope;}
function taskPhase(text:string,percent=0){el('task-progress').style.display='block';el('task-progress').setAttribute('aria-busy',String(taskActive));el('progress-label').textContent=batchPosition+text;el('progress-bar').setAttribute('value',String(percent));relightWorkbench?.progress(batchPosition+text);}
function startTask(){taskActive=true;taskSucceeded=false;batchPosition='';taskPhase(t("准备任务…"));}
function endTask(){taskActive=false;taskPhase(taskSucceeded?t("候选已保存"):el('status').textContent,taskSucceeded?100:0);}
function option(select:any,value:string,text:string){const node=document.createElement('option');node.value=value;node.textContent=t(text);select.appendChild(node);}
function inputUi(){
  const mode=el('mode').value,blend=mode==='blend',structuredRelight=mode==='relight',nextPromptKind=blend?'blend':mode==='remove'||structuredRelight?undefined:'ordinary';
  if(nextPromptKind&&nextPromptKind!==promptKind){promptDrafts[promptKind]=el('prompt').value;el('prompt').value=promptDrafts[nextPromptKind];promptKind=nextPromptKind;}
  el('prompt-group').style.display=mode==='remove'||structuredRelight?'none':'block';el('prompt-label').textContent=t(blend?'补充要求（可选）':'描述修改或生成内容');
  el('relight-entry').style.display=structuredRelight?'block':'none';el('generate').textContent=t(structuredRelight?'打开布光工作台':'生成候选');
  const standalone=el('destination').value==='document'&&(workspace==='t2i'||['effect','atmosphere'].includes(mode));el('selection-tools').style.display=standalone?'none':'block';el('prompt').setAttribute('placeholder',blend?t('可选：补充光影、色彩或融合要求'):workspace==='t2i'?t("描述要生成的画面、主体与风格"):workspace==='cosplay'?t("描述服装道具、光影方向、角色参考或氛围效果"):t("描述选区中要修改的内容，及需要保留的细节"));
  const restorable=workspace!=='t2i'&&mode!=='relight'&&el('destination').value==='selection';el('restore-selection').style.display=restorable?'block':'none';el('restore-selection').disabled=busy||!restorable||lastSelection?.workspace!==workspace||lastSelection?.mode!==mode;
  const platform=isPlatform(el('backend-kind').value),cloud=el('backend-kind').value!=='comfyui',model=gatewayCatalogBase===el('backend-url').value?gatewayCatalog?.models.find(m=>m.id===el('gateway-model').value):undefined;
  const background=isBackgroundMode(mode);
  for(const [id,forced] of [['preserve-alpha',background],['align-subject',background||blend||structuredRelight],['match-color',background||blend||structuredRelight],['guide',background&&!cloud]] as const){
    if(forced){if(!overriddenChecks.has(id))overriddenChecks.set(id,!!el(id).checked);el(id).checked=false;}
    else if(overriddenChecks.has(id)){el(id).checked=overriddenChecks.get(id);overriddenChecks.delete(id);}
    el(id).disabled=busy||forced;
  }
  el('mode-help').textContent=background?t(cloud?'选中要保留的主体，无需反选。整张画布用于生成不透明背景，保留主体核心并融合半透明边缘；保护区保留原样。':'选中要保留的主体，无需反选。整张画布用于生成背景；选区精确控制回填，不作为黑白参考图送入 ComfyUI。主体核心和保护区保留，半透明边缘与新背景融合。'):blend?t('选中主体，整张画布提供环境参考；只回填主体并扣除保护区。统一光影、颜色、纹理与空间感，保留身份和姿态；全图缩放可能降低小主体细节。'):mode==='remove'?t('圈选要移除的对象后直接生成，周边用于补齐背景。'):'';
  el('mode-help').style.display=background||blend||mode==='remove'?'block':'none';
  const kind=workspace==='t2i'?'t2i':['effect','atmosphere'].includes(el('mode').value)?'asset':'edit';
  el('gateway-key-settings').style.display=platform?'block':'none';el('backend-url').disabled=busy||platform;
  el('local-model-settings').style.display=cloud?'none':'block';el('gateway-model-settings').style.display=cloud?'block':'none';
  el('steps').disabled=busy||cloud;el('output-depth').disabled=busy||cloud;
  el('seed').disabled=busy||!!(cloud&&model?.seedMax===0);el('lock-seed').disabled=el('seed').disabled;
  el('generate').disabled=busy||!!(cloud&&model&&!model.operations.includes(kind));
  el('gateway-info').textContent=t('图像和提示词将上传 {0}。输出仅 8 位，步数由平台控制。',platformName())+(model&&!model.operations.includes('asset')?t(' 此模型不支持透明素材。'):'')+(model?.seedMax===0?t(' 此模型不支持设置随机种子。'):'')+(gatewayCatalog?.provider==='gemini'?t(' 使用方形上下文生成，再裁回原比例。'):'')+(gatewayCatalog?.provider==='openai'?t(' 开启范围辅助时使用平台蒙版；结果按请求比例还原。'):'');
  el('submission-info').textContent=cloud?el('gateway-info').textContent:t('图像和提示词将发送至 {0}；模型输入为 sRGB 8-bit。',el('backend-url').value);
  historyUi();
}
function candidateUi(){
  const c=candidates[Number(el('candidate-select').value)],mode=c?.snapshot?adapter.applicationMode(c.snapshot):'unavailable';
  el('apply').disabled=busy||!c?.snapshot||!!c.warning||mode==='unavailable';el('apply').textContent=t(mode==='replace'?'替换本轮候选图层':'应用为新图层');
  el('candidate-warning').textContent=c?.warning?t(c.warning):'';el('candidate-warning').style.display=c?.warning?'block':'none';
  const s=c?.snapshot;el('candidate-target').textContent=s?t('来源文档 {0} · {1} · {2}',s.documentId,s.profile,mode==='unavailable'?t('来源已关闭、改变或会话已结束；候选仍可导出'):mode==='replace'?t('替换同次捕获的插件图层，其他图层保留'):t('新增独立结果，保留来源图层')):c?t('独立生成结果，可另存或新建文档'):'';
  for(const id of ['zoom','export','new-document'])el(id).disabled=busy||!c;el('candidate-select').disabled=busy||!c;el('opacity').disabled=busy||!applied;el('candidate-empty').style.display=candidates.length?'none':'block';el('detail-frame').style.display=c?'block':'none';
  const index=Number(el('candidate-select').value);
  el('candidate-caption').textContent=c?t('候选 {0} / {1} · {2}×{3} · {4}-bit',index+1,candidates.length,c.image.width,c.image.height,rasterDepth(c.image)):'';
  el('nav-results').textContent=t('结果')+(candidates.length?` · ${candidates.length}`:'');
  el('candidates').setAttribute('aria-label',t('候选预览'));
  for(const card of Array.from(el('candidates').children) as HTMLElement[])setCandidateCardState(card,Number(card.getAttribute('data-candidate-index'))===index,busy);
  el('applied-opacity').style.display=applied?'flex':'none';
}
function invalidateCapture(){capture=undefined;const visible=el('selection-previews').style.display!=='none';el('selection-previews').style.display='none';if(visible)sourceCaption.show('范围参数已改变，请重新预览选区');}
function setWorkspace(value:Workspace,mode=modes[value][0][0]){if(workspace!==value||el('mode').value!==mode)invalidateCapture();workspace=value;const select=el('mode');select.innerHTML='';for(const [id,label] of modes[value])option(select,id,label);select.value=mode;for(const w of ['local','cosplay','t2i'])el(`tab-${w}`).className=w===value?'active':'';if(value==='t2i')el('destination').value='document';else el('destination').value='selection';inputUi();}
function lock(value:boolean){busy=value;for(const id of ['generate','capture','restore-selection','protect','clear-protection','reference','clear-reference','tab-local','tab-cosplay','tab-t2i','mode','prompt','output-depth','usage','guide','preserve-alpha','align-subject','match-color','destination','count','steps','resolution','seed','lock-seed','margin','p0','recover','load-history','repeat-history','apply','new-document','connect','scan-models','save-settings','import-settings','export-settings','model-unet','model-clip','model-vae','backend-url','backend-kind','gateway-model','api-key','save-key','clear-key','stop-relay','language','open-setup','close-setup','setup-connect','setup-check','setup-example','relight-scope','remember-source-access','forget-source-access'])el(id).disabled=value;candidateUi();renderSetup();inputUi();relightWorkbench?.refreshAvailability();}
function showGatewayModels(selected=settings.gatewayModel??DEFAULT_GATEWAY_MODEL){const select=el('gateway-model');select.innerHTML='';for(const id of new Set([selected,...(gatewayCatalogBase===el('backend-url').value?gatewayCatalog?.models.map(m=>m.id)??[]:[])]))option(select,id,id);select.value=selected;}
function showSettings(available?:Record<'unet'|'clip'|'vae',string[]>,value=settings) {for(const key of ['unet','clip','vae'] as const){const select=el(`model-${key}`);select.innerHTML='';for(const name of new Set([value.models[key],...(available?.[key]??[])]))option(select,name,name);select.value=value.models[key];}displayedConnection=connectionId(value);draftConnections=value.connections;el('backend-kind').value=displayedConnection;el('backend-url').value=value.baseUrl;el('output-depth').value=String(value.outputDepth??8);showGatewayModels(value.gatewayModel??(isPlatform(displayedConnection)?PLATFORMS[displayedConnection].model:DEFAULT_GATEWAY_MODEL));el('api-key').value='';void keyStatus();inputUi();}
async function saveSettings(value:unknown){const next=rememberConnection(validateSettings(value));await store.json('settings.json',next);settings=next;client=backendClient(settings);coordinator=new JobCoordinator(client,store);settingsReady=true;restoreSettingsLanguage();showSettings();await refreshHistory();connection('待检查');status(t(settings.backend==='gateway'?'平台配置已保存；请连接检查模型与 Key。':"模型配置已保存，请连接检查；文件名可迁移，模型权重需在后端准备"));}
async function configure(action:()=>Promise<void>){if(busy)return;lock(true);try{await action();}finally{lock(false);}}
function assertBackend(record:JobRecord){const origin=normalizeBaseUrl(record.baseUrl??'http://localhost:8188',!!settings.platform);if(origin!==settings.baseUrl||(record.backend??'comfyui')!==(settings.backend??'comfyui'))throw new DiagnosticError('pending-backend','inference',t('任务 {0} 属于 {1} · {2}；请在设置中切回该类型和地址后恢复或取消',record.id,record.backend==='gateway'?t('平台适配服务'):'ComfyUI',origin));}
function restoreSettingsLanguage(){el('output-depth').value=String(settings.outputDepth??8);renderLanguage();}
function renderLanguage(){
  setLanguage(settings.language??'zh-CN');el('language').value=settings.language??'zh-CN';
  for(const node of Array.from(document.querySelectorAll('[data-i18n]'))){
    if(node.id==='connection'||node.id==='source-info')continue;
    const key=node.getAttribute('data-i18n')!;
    // Preserve the reference filename, dimensions and fixed color declaration.
    if(node.id==='reference-info'&&node.textContent!==key&&node.textContent!==english[key])continue;
    node.textContent=t(key);
  }
  connection(connectionState);sourceCaption.render();
  // UXP keeps the collapsed caption when existing option text is edited.
  el('source-access-status').textContent=t(sourceAccessMessage);
  for(const id of ['usage','destination','output-depth','backend-kind','relight-scope']){
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
  el('zoom').textContent=zoomed?t('适应预览'):t('100% 查看');inputUi();renderSetup();candidateUi();
}
function selected():Candidate {const c=candidates[Number(el('candidate-select').value)];if(!c)throw new Error(t("请先生成或读取一个候选"));return c;}
async function guarded(action:()=>Promise<void>){try{await action();}catch(error){status(error instanceof Error?error.message:String(error));const d=diagnostic(error,operationStage,historyRecords.some(blocksGeneration));el('diagnostic-box').style.display='block';const reason=localValidationMessage(error instanceof Error?error.message:String(error))??(error instanceof DiagnosticError&&['pending-task','pending-backend'].includes(error.code)?error.message:undefined);el('diagnostic-summary').textContent=(reason?[reason,d.action,d.effect,d.retry,t('失败阶段：{0}',d.stageLabel)]:[d.title,d.effect,d.action,d.retry,t('失败阶段：{0}',d.stageLabel)]).join('\n');el('status').style.display='none';if(!taskActive)el('task-progress').style.display='none';el('diagnostic-details').value=JSON.stringify(d,null,2);el('diagnostic-details').style.display='none';console.error(error);await store.trace('operation.error');}}
function activeDocumentId():number|undefined{return ps.app.documents.length?ps.app.activeDocument?.id:undefined;}
function clearCapturePreview(){capture=undefined;el('selection-previews').style.display='none';for(const id of ['source-preview','mask-preview'])el(id).removeAttribute('src');}
async function captureArea(expectedDocumentId=activeDocumentId(),showPreview=true){
  const mode=el('mode').value,capturedWorkspace=workspace;
  clearCapturePreview();
  const captured=await adapter.capture(Number(el('margin').value)/100,protection,expectedDocumentId,outputDepth(),isBackgroundMode(mode)?{context:'document',selection:'subject-background'}:mode==='blend'?{context:'document',selection:'edit'}:undefined);
  const {snapshot:s,image}=captured;
  if(capturedWorkspace!=='t2i'&&mode!=='relight')lastSelection={workspace:capturedWorkspace,mode,range:{documentId:s.documentId,sessionId:s.sessionId,width:s.width,height:s.height,mode:s.mode,depth:s.depth,bounds:{...s.bounds},mask:(captured.subjectMask??captured.selectionMask).slice()}};
  if(protection&&captured.workingCopyOf===protection.documentId)protection={...protection,documentId:s.documentId};
  if(workspace!==capturedWorkspace||el('mode').value!==mode){inputUi();return;}
  capture=captured;
  sourceCaption.show({documentId:s.documentId,width:image.width,height:image.height,protectedArea:!!protection,profile:s.profile,colorReason:s.colorReason});el('source-preview').src=await preview(image);el('mask-preview').src=await preview(rangePreview(image,s.mask,captured.protectionMask));if(showPreview&&workspace===capturedWorkspace&&el('mode').value===mode)el('selection-previews').style.display='flex';
  inputUi();
}
async function restoreSelectionArea(){
  if(busy)return;
  const saved=lastSelection;
  if(!saved||saved.workspace!==workspace||saved.mode!==el('mode').value||workspace==='t2i'||saved.mode==='relight'||el('destination').value!=='selection')throw new Error(t('没有可用于当前模式的本次会话选区，请重新圈选后预览'));
  lock(true);clearCapturePreview();let restored=false;
  try{
    await adapter.restoreSelection(saved.range);restored=true;
    await captureArea(saved.range.documentId);
    el('diagnostic-box').style.display='none';status(t('已恢复上次选区并读取当前像素；请检查范围预览，再明确生成'));
  }catch(error){
    clearCapturePreview();
    if(restored){sourceCaption.show('选区已恢复，但原图读取未完成，请检查来源后重新预览');throw new DiagnosticError(diagnostic(error,'capture').code,'capture',t('选区已恢复，但原图读取失败：{0}',errorText(error instanceof Error?error.message:String(error))));}
    throw error;
  }finally{lock(false);}
}
async function captureRelight(expectedDocumentId=activeDocumentId(),scope:RelightScope=relightScope()):Promise<Capture>{
  const previous=activeDocumentId();
  if(expectedDocumentId===undefined)throw new Error(t('请先打开 Photoshop 文档并建立选区'));
  const target=Array.from(ps.app.documents as any[]).find(d=>d.id===expectedDocumentId);
  if(!target)throw new Error(t('来源文档已关闭，候选已保留'));
  if(previous!==expectedDocumentId)await ps.core.executeAsModal(async()=>{ps.app.activeDocument=target;},{commandName:'PS-AI relight source'});
  try {
    const captured=await adapter.capture(Number(el('margin').value)/100,protection,expectedDocumentId,outputDepth(),{selection:scope==='document'?'document':'edit',preserveNativeDepth:true});
    if(protection&&captured.workingCopyOf===protection.documentId)protection={...protection,documentId:captured.snapshot.documentId};
    return captured;
  }finally{const prior=Array.from(ps.app.documents as any[]).find(d=>d.id===previous);if(prior&&previous!==expectedDocumentId)await ps.core.executeAsModal(async()=>{ps.app.activeDocument=prior;},{commandName:'PS-AI restore document'});}
}
function relightResults():RelightResult[]{
  const source=relightSession?.editor.snapshot().source;
  return candidates.flatMap(c=>{const metadata=c.job.relight as RelightTaskMetadata|undefined;if(!metadata||metadata.schemaVersion!==1||metadata.scene?.source?.snapshotId!==source?.snapshotId)return [];return [{jobId:c.job.id,fingerprint:metadata.fingerprint,image:c.image,warning:c.warning}];});
}
function candidateById(id:string):Candidate {const candidate=candidates.find(c=>c.job.id===id);if(!candidate)throw new Error(t('此 AI 结果已离开内存，请从历史重新读取后应用'));return candidate;}
async function exportCandidate(id:string):Promise<void>{if(busy)throw new Error(t('已有任务正在进行，请等待完成后再生成或应用；可以继续编辑布光'));await configure(async()=>{const c=candidateById(id),file=await uxp.storage.localFileSystem.getFileForSaving(`ps-ai-${c.job.id.slice(0,8)}.png`,{types:['png']});if(file)await file.write(new Uint8Array(c.bytes).buffer,{format:uxp.storage.formats.binary});});}
export async function openRelightWorkbench(reuse?:RelightScene,description?:string):Promise<void>{
  if(relightWorkbench&&!reuse&&description===undefined){relightWorkbench.setSourceInvalid(!!relightSession&&adapter.applicationMode(relightSession.sourceCapture.snapshot)==='unavailable');relightWorkbench.setScopePending(relightScope()!==relightSession?.scope);relightWorkbench.show();return;}
  if(typeof el('relight-dialog')?.uxpShowModal!=='function')throw new Error(t('当前宿主无法打开布光对话框，请使用 Photoshop 27+ 并重新加载开发插件'));
  if(busy)throw new Error(t('请等待当前任务结束后重新读取原图'));
  lock(true);
  try {
    operationStage='capture';const scope=relightScope(),fresh=await captureRelight(undefined,scope);relightMargin=Number(el('margin').value)/100;
    relightSession=new RelightSession(fresh,uuid(),uuid(),scope);capture=relightSession.sourceCapture;
    if(reuse)relightSession.restore(reuse,true);
    if(description!==undefined)relightSession.editor.updateScene({supplement:description});
    const session=relightSession;
    relightWorkbench=new RelightWorkbench(el('relight-dialog'),session,{
      uuid,save:scene=>relightDrafts.save(scene),loadDraft:()=>relightDrafts.load(),busy:()=>busy,reportError:error=>void guarded(async()=>{throw error;}),
      prepare:async(frozen)=>{if(relightScope()!==frozen.scope)throw new Error(t('布光范围已改变，请重新读取原图；原有布光配置已保留'));if(Number(el('margin').value)/100!==relightMargin)throw new Error(t('范围参数已改变，请重新读取原图'));adapter.assertSourceCurrent(frozen.capture.snapshot);const fresh=await captureRelight(frozen.capture.snapshot.documentId,frozen.scope);session.assertCaptureMatches(fresh);},
      generate:(frozen,onJob)=>generate(frozen,onJob),cancel:async()=>{stopBatch=true;},pendingTasks:()=>historyRecords.filter(blocksGeneration).length,openPendingTasks:()=>showPending(),
      reread:async()=>{const scope=relightScope(),fresh=await captureRelight(undefined,scope);session.rebind(fresh,uuid(),scope);capture=session.sourceCapture;relightMargin=Number(el('margin').value)/100;},
      apply:id=>apply(id),export:exportCandidate,results:relightResults,
      diagnostics:async(id)=>{const c=candidateById(id);try{const source=decodePng(await store.readBinary(`${id}-source.png`)),target=resize(c.image,source.width,source.height),result=decomposeRelightCompensation(source,target,{colorSpace:'encoded-srgb',documentProfile:c.snapshot?.profile??'',blend:{order:'multiply-screen',opacity:1,fillOpacity:1,group:'isolated-with-base',gamma:'encoded-srgb',mask:'none'}});return t('补偿诊断：encoded sRGB，{0} 位，先 Multiply 后 Screen，量化后 RGB 绝对误差（不含 Alpha）：max={1}，mean={2}，RMSE={3}；归一化 max={4}。这不代表仅改变光照，应用仍不可用。',rasterDepth(source),result.error.code.maxAbs,result.error.code.meanAbs,result.error.code.rmse,result.error.normalized.maxAbs);}catch(error){return t('无法可靠计算补偿，请使用完整结果：{0}',error instanceof Error?error.message:String(error));}}
    });
    relightWorkbench.show();
  }finally{lock(false);}
}
function historyUi(){
  historyTable.refresh();
  const pending=historyRecords.filter(blocksGeneration),record=historyRecords.find(r=>r.id===historyTable.selectedId);
  el('pending-notice').style.display=pending.length?'block':'none';el('pending-summary').textContent=t('{0} 个未确认任务；请按原 ID 处理后再生成',pending.length);el('open-pending').disabled=busy;
  el('history-id').value=record?.id??'';
  const source=record?.snapshot as {documentId?:number}|undefined;
  el('history-details').textContent=record?[t('任务类型：{0}',historyTaskType(record)),t('状态：{0}',`${historyState(record)} (${record.state})`),t('后端：{0} · {1}',record.backend==='gateway'?t('平台适配服务'):'ComfyUI',String(record.baseUrl??'http://localhost:8188')),t('时间：{0}',historyDate(record).join(' ')),t('来源文档：{0}{1}',source?.documentId??t('未保存'),` · ${historySource(record)}`),...(record.tracking==='detached'?[t('本地已停止跟踪；远端状态仍未知，可按原 ID 恢复')]:[])].join('\n'):t('请选择历史记录');
  el('history-prompt').value=record?historyPrompt(record):'';
  if(lastHistoryFocus!==record?.id){el('history-detail-pane').scrollTop=0;lastHistoryFocus=record?.id;}
  if(el('view-history').style.display!=='none')historyPreview.show(record);
  el('next-pending').style.display=pending.length>1?'block':'none';el('next-pending').disabled=busy;
  el('recover').disabled=busy||!record;el('load-history').disabled=busy||!record?.outputFile;el('repeat-history').disabled=busy||!record?.params;
  el('cancel').disabled=busy?!taskActive:!record||!blocksGeneration(record);
  el('cancel').textContent=t((busy||!record?client instanceof GatewayClient:record.backend==='gateway')?'停止后续候选':'取消本任务');
  el('history-cancel').disabled=busy||!record||!blocksGeneration(record);el('history-cancel').textContent=t(record?.backend==='gateway'?'停止后续候选':'取消本任务');
  const detachable=!!record&&record.state==='unknown'&&record.tracking!=='detached';
  el('stop-tracking').style.display=detachable?'block':'none';el('stop-tracking').disabled=busy||!detachable;
  const confirming=detachable&&detachAcknowledgedId===record.id;
  el('detach-confirmation').style.display=confirming?'block':'none';el('confirm-stop-tracking').disabled=busy||!confirming;el('keep-tracking').disabled=busy;
  el('detach-warning').textContent=confirming?t('仅停止本地跟踪任务 {0}。这不会取消远端任务、停止计费或证明失败。新生成可能重复执行并计费；原 ID、来源和结果全部保留，仍可恢复。',record.id):'';
  const count=historyTable.checkedIds.length,armed=!!clearConfirmation&&clearConfirmation.revision===historyTable.selectionRevision;
  el('clear-history').textContent=t('清除勾选历史（{0}）',count);el('clear-history').disabled=busy||!count;
  el('history-clear-confirmation').style.display=armed?'block':'none';el('confirm-clear-history').disabled=busy||!armed;el('keep-history').disabled=busy;
  el('history-clear-warning').textContent=armed?t('将清除 {0} 条记录（其中 {1} 个未确认任务）及插件保存的来源、蒙版和候选文件。原文档、已应用图层及外部导出保留。不会取消远端任务，任务和计费可能继续。',clearConfirmation!.ids.length,clearConfirmation!.unresolved):'';
  const cleanup=cleanupStatus,notices:string[]=historyNotice?[t(historyNotice)]:[];
  if(cleanup?.removedIds.length){
    notices.push(t('已清除 {0} 条本地历史记录',cleanup.removedIds.length));
    if(cleanup.pendingFiles)notices.push(t('{0} 个文件待清理；请重试本地清理',cleanup.pendingFiles));
    if(cleanup.metadataPending)notices.push(t('历史元数据更新待重试；已清除记录不会阻挡生成'));
    if(cleanup.retainedSharedFiles)notices.push(t('保留共享文件：{0} 个，其他历史记录仍在使用',cleanup.retainedSharedFiles));
    if(cleanup.skippedUnsafeFiles)notices.push(t('跳过不安全或非标准文件：{0} 个；未访问这些路径',cleanup.skippedUnsafeFiles));
  }
  el('history-cleanup-status').textContent=notices.join('\n');
  el('retry-history-cleanup').style.display=cleanup&&(cleanup.pendingFiles||cleanup.metadataPending)?'block':'none';el('retry-history-cleanup').disabled=busy;
  if(!busy&&el('view-history').style.display!=='none'){
    if(historyRevealTimer)clearTimeout(historyRevealTimer);
    historyRevealTimer=setTimeout(()=>{
      historyRevealTimer=undefined;if(busy||el('view-history').style.display==='none')return;
      historyTable.scrollRevealed();
      if(pendingDetailReveal){
        const pane=el('history-detail-pane');pane.scrollTop=0;
        try{if(typeof pane.scrollIntoView==='function')pane.scrollIntoView(true);else el('view-history').scrollTop=Math.max(0,pane.offsetTop-el('view-history').offsetTop);}catch{el('view-history').scrollTop=Math.max(0,pane.offsetTop-el('view-history').offsetTop);}
        pendingDetailReveal=false;
      }
    },0);
  }
}
async function refreshHistory(preferredId?:string,preferPending=false){
  clearConfirmation=undefined;detachAcknowledgedId=undefined;historyPreview.invalidate();
  historyRecords=await store.history();cleanupStatus=await store.historyCleanupStatus();historyTable.setRecords(historyRecords,{selectId:preferredId,preferPending});
  historyUi();relightWorkbench?.refreshAvailability();
}
function updateHistoryRecord(record:JobRecord){clearConfirmation=undefined;const index=historyRecords.findIndex(r=>r.id===record.id);if(index<0)historyRecords.unshift(record);else historyRecords[index]=record;historyTable.setRecords(historyRecords,{selectId:record.id});historyUi();relightWorkbench?.refreshAvailability();}
async function showPending(next=false){
  if(busy)return;const old=historyTable.selectedId;lock(true);
  try{await refreshHistory();const pending=historyRecords.filter(blocksGeneration);
    if(pending.length){const index=pending.findIndex(r=>r.id===old);historyTable.reveal(pending[next?(index+1)%pending.length:Math.max(0,index)].id);}
    views.show('history');pendingDetailReveal=true;el('history-detail-pane').scrollTop=0;historyUi();
  }finally{lock(false);}
}
function selectionSignature(ids:readonly string[],records:readonly JobRecord[]):string {return JSON.stringify(ids.map(id=>records.find(record=>record.id===id)??null));}
function clearPendingDiagnostic():void {
  if(historyRecords.some(blocksGeneration))return;
  try{if(['pending-task','pending-backend'].includes(JSON.parse(el('diagnostic-details').value).code)){el('diagnostic-box').style.display='none';el('diagnostic-details').value='';el('diagnostic-summary').textContent='';}}catch{/* No stored diagnostic, or an unrelated error. */}
}
async function evictHistoryCandidates(ids:readonly string[]):Promise<void> {
  const removed=new Set(ids),previous=candidates[Number(el('candidate-select').value)]?.job.id;
  candidates=candidates.filter(candidate=>!removed.has(candidate.job.id));
  if(current&&removed.has(current.id))current=undefined;
  if(applied&&removed.has(applied.jobId))applied=undefined;
  candidatePreview.retain(candidates.map(candidate=>candidate.image));
  el('detail-preview').removeAttribute('src');
  relightWorkbench?.invalidateResults(ids);await renderCandidates(previous);
}
async function clearHistory(confirm=false):Promise<void> {
  if(busy)return;
  if(!confirm){
    const ids=Object.freeze([...historyTable.checkedIds]);if(!ids.length)return;
    detachAcknowledgedId=undefined;historyNotice='';clearConfirmation={ids,revision:historyTable.selectionRevision,signature:selectionSignature(ids,historyRecords),unresolved:historyRecords.filter(record=>ids.includes(record.id)&&blocksGeneration(record)).length};historyUi();return;
  }
  const frozen=clearConfirmation;if(!frozen||frozen.revision!==historyTable.selectionRevision)return;
  lock(true);historyPreview.invalidate();
  try{
    const records=await store.history();
    if(clearConfirmation!==frozen||frozen.revision!==historyTable.selectionRevision||selectionSignature(frozen.ids,records)!==frozen.signature){await refreshHistory();historyNotice='勾选记录已改变，请重新核对并确认清除';return;}
    clearConfirmation=undefined;
    const result=await store.clearHistory(frozen.ids);cleanupStatus=result;
    await evictHistoryCandidates(result.removedIds);historyTable.clearChecked();
    await refreshHistory();clearPendingDiagnostic();
  }finally{clearConfirmation=undefined;lock(false);}
}
async function retryHistoryCleanup():Promise<void> {
  if(busy||!cleanupStatus||!cleanupStatus.pendingFiles&&!cleanupStatus.metadataPending)return;
  lock(true);clearConfirmation=undefined;detachAcknowledgedId=undefined;historyPreview.invalidate();
  try{cleanupStatus=await store.retryHistoryCleanup();await evictHistoryCandidates(cleanupStatus.removedIds);await refreshHistory();clearPendingDiagnostic();}
  finally{lock(false);}
}
async function stopTracking(confirm=false){
  if(busy)return;const id=historyTable.selectedId;
  if(confirm&&detachAcknowledgedId!==id)return;
  lock(true);
  try{const record=(await store.history()).find(r=>r.id===id);
    if(historyTable.selectedId!==id||confirm&&detachAcknowledgedId!==id||!record||record.state!=='unknown'||record.tracking==='detached'){await refreshHistory(id);return;}
    if(!confirm){detachAcknowledgedId=id;historyUi();return;}
    detachAcknowledgedId=undefined;record.tracking='detached';await store.save(record);await store.trace('task.detach',id);await refreshHistory(id);status(t('已停止此任务的本地跟踪；远端状态仍未知，原 ID 保留'));
  }finally{lock(false);}
}
async function addCandidate(record:JobRecord,bytes:Uint8Array){
  await store.trace('candidate.preview',record.id);
  const {image,snapshot,warning}=await prepareCandidate(record,bytes,name=>store.readBinary(name));
  // All exported candidates, including standalone assets, declare sRGB explicitly.
  bytes=encodePng(image);
  const c:Candidate={job:record,bytes,image,preview:await preview(image),snapshot,warning};
  if(candidates.length===4)candidates.shift();candidates.push(c);
  await renderCandidates(record.id);await store.trace('candidate.ready',record.id);
  relightWorkbench?.notifyResult(record.id);
}
async function renderCandidates(preferredId?:string):Promise<void> {
  const list=el('candidate-select');list.innerHTML='';el('candidates').innerHTML='';
  candidatePreview.retain(candidates.map(candidate=>candidate.image));
  candidates.forEach((candidate,index)=>{
    option(list,String(index),t("候选 {0} · {1}×{2}",index+1,candidate.image.width,candidate.image.height));
    el('candidates').appendChild(createCandidateCard(document,index,candidate.preview,()=>{list.value=String(index);void guarded(showSelected);},()=>busy));
  });
  const preferred=candidates.map(candidate=>candidate.job.id).lastIndexOf(preferredId??'');list.value=String(preferred>=0?preferred:Math.max(0,candidates.length-1));
  if(candidates.length)await showSelected();else{el('detail-preview').removeAttribute('src');el('detail-preview').style.visibility='hidden';candidateUi();}
}
async function showSelected(){
  const c=selected(),actualSize=zoomed,img=el('detail-preview'),frame=el('detail-frame');
  candidateUi();frame.setAttribute('aria-busy','true');img.style.visibility='hidden';
  await candidatePreview.show(c.image,actualSize,url=>{
    if(img.getAttribute('src')!==url)img.src=url;
    img.style.width=actualSize?`${c.image.width}px`:'100%';img.style.height=actualSize?`${c.image.height}px`:'100%';
    img.alt=el('candidate-caption').textContent;img.style.visibility='visible';frame.setAttribute('aria-busy','false');
  });
}
async function saveReady(record:JobRecord,images:OutputFile[]) {
  operationStage='output';
  record.state='downloading';record.outputs=images;
  try{await store.trace('candidate.download',record.id);const bytes=await client.output(images[0]);await store.binary(`${record.id}-output.png`,bytes);record.outputFile=`${record.id}-output.png`;decodeModelPng(bytes,String(record.template??""));record.state='ready';if(record.relight)(record.relight as RelightTaskMetadata).result={jobId:record.id,outputFile:record.outputFile as string};await store.save(record);await addCandidate(record,bytes);}
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
        if(result.state==='unknown')throw new DiagnosticError('pending-task','inference',t("取消未确认，原任务 ID 已保留；请继续恢复或取消，不要重复生成"));
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
        updateHistoryRecord(record);
        if(result.state==='unknown') {if(++unknownReads>=15)throw new DiagnosticError('pending-task','inference',t("未确认任务状态，已保留 ID；请使用“恢复任务”，不要重复提交"));}
        else unknownReads=0;
        if(result.state==='running'&&steps)showSteps();else{const phase=result.state==='running'?t(client instanceof GatewayClient?'平台生成中（无步数进度）':"模型加载／推理中，等待步数"):result.state==='queued'?t("已排队，等待执行"):t("按原 ID 查询任务");taskPhase(phase);status(`${phase} · ${record.id.slice(0,8)}`);}
      }catch(error){
        if(record.state==='output-error')throw error;
        if(record.state==='failed'||record.state==='cancelled'||unknownReads>=15)throw error;
        if(++unknownReads>=15){record.state='unknown';throw new DiagnosticError('pending-task','inference',t('连续无法确认任务状态，已保留 ID；请按原 ID 重试恢复，或明确停止本地跟踪'));}
        taskPhase(t("连接中断，按原 ID 恢复…"));status(t("连接中断，正在按原 ID 恢复：{0}",record.id.slice(0,8)));
      }
      await new Promise(r=>setTimeout(r,2000));
    }
    record.state='unknown';throw new DiagnosticError('pending-task','inference',t("等待已超时；任务保留，请按 ID 恢复"));
  } finally {closeSocket();await store.save(record);await refreshHistory(record.id);}
}
async function generate(frozenRelight?:FrozenRelightSubmission,onRelightJob?:(id:string)=>void) {
  if(!frozenRelight&&el('mode').value==='relight'){await openRelightWorkbench();return;}
  if(busy){if(frozenRelight)throw new Error(t('已有任务正在进行，请等待完成后再生成或应用；可以继续编辑布光'));return;}
  if(!settingsReady)throw new Error(t("设置尚未加载或配置损坏，请保存或导入有效配置"));
  if(connectionSignature(draftSettings())!==connectionSignature(settings))throw new Error(t('后端配置已改变，请先保存并检查连接'));
  const expectedDocumentId=frozenRelight?.capture.snapshot.documentId??activeDocumentId();
  stopBatch=false;
  el('diagnostic-box').style.display='none';
  startTask();
  lock(true);
  try {
  await store.trace('generate.start');
  const pending=(await store.history()).find(blocksGeneration);
  if(pending){await refreshHistory(pending.id);views.show('history');pendingDetailReveal=true;throw new DiagnosticError('pending-task','inference',t('任务 {0} 尚未确认，请在历史中按原 ID 恢复或取消',pending.id));}
  const mode=frozenRelight?'relight':el('mode').value,userPrompt=frozenRelight?frozenRelight.scene.supplement:mode==='remove'?'':el('prompt').value,destination=frozenRelight?'selection':el('destination').value,usage=el('usage').value;
  const behavior=editBehavior(mode,{guide:!!el('guide').checked,preserveAlpha:!!el('preserve-alpha').checked,alignSubject:frozenRelight?false:!!el('align-subject').checked,matchColor:frozenRelight?false:!!el('match-color').checked},settings.backend??'comfyui'),guide=behavior.guide;
  let request=intent(frozenRelight?'cosplay':workspace,mode,frozenRelight?'Structured relighting':userPrompt,!!reference,guide,usage,client instanceof GatewayClient?'semantic':'images');
  const depth=outputDepth();const count=Number(el('count').value),steps=Number(el('steps').value),resolution=Number(el('resolution').value),margin=Number(el('margin').value)/100;
  let baseSeed=el('lock-seed').checked?Number(el('seed').value):Math.floor(Math.random()*2**31),seedSupported=true;
  if(!Number.isInteger(count)||count<1||count>4)throw new Error(t("候选数量须为 1–4"));
  if(!(client instanceof GatewayClient))buildGraph({requestId:uuid(),prompt:request.prompt,seed:baseSeed+count-1,steps,resolution,models:settings.models,outputDepth:outputDepth()});
  if(request.kind==='edit'&&destination!=='selection')throw new Error(t("编辑补丁需要捕获来源选区"));
  if(destination==='selection'&&expectedDocumentId===undefined)throw new Error(t("请先打开 Photoshop 文档并建立选区"));
    operationStage='environment';const checking=t(client instanceof GatewayClient?'检查平台服务与模型能力…':"检查节点与本机模型…");taskPhase(checking);status(checking);await checkBackend(client,{...settings,outputDepth:depth});
    if(client instanceof GatewayClient){const chosenModel=client.model,model=client.capabilities!.models.find(m=>m.id===chosenModel)!;if(!model.operations.includes(request.kind))throw new Error(t('此平台模型不支持当前模式'));seedSupported=model.seedMax!==0;if(!seedSupported)baseSeed=0;else if(!Number.isSafeInteger(baseSeed)||baseSeed<0||baseSeed+count-1>model.seedMax)throw new Error(t('平台种子超出范围，请减小种子或候选数量'));}
    let relightCaps:RelightCapabilities|undefined,relightConflictResolution:'structured-lighting'|undefined;
    if(frozenRelight){
      const chosenModel=client instanceof GatewayClient?client.model:undefined;
      const model=client instanceof GatewayClient?client.capabilities!.models.find(m=>m.id===chosenModel)!:undefined;
      relightCaps={provider:client instanceof GatewayClient?client.capabilities!.provider:'comfyui',model:client instanceof GatewayClient?client.model:settings.models.unet,edit:!model||model.operations.includes('edit'),maxInputImages:model?.maxInputImages??3,maskMode:guide?(client instanceof GatewayClient&&client.capabilities!.provider==='openai'?'native':'guide'):'none',seed:seedSupported};
      const compilation=compileRelightScene(frozenRelight.scene,relightCaps);relightWorkbench?.setWarnings(compilation.warnings);
      if(compilation.warnings.some(w=>/Resolve this conflict/.test(w))){if(!relightWorkbench?.conflictAcknowledged)throw new Error(t('布光与补充描述存在冲突，请修改或明确确认后生成'));relightConflictResolution='structured-lighting';}
      const compiledPrompt=(relightConflictResolution?'Where additional instructions conflict, follow the structured lighting settings below. Preserve the additional instructions verbatim for nonconflicting details.\n':'')+compilation.prompt;
      request=intent('cosplay','relight',compiledPrompt,!!reference,guide,usage,client instanceof GatewayClient?'semantic':'images',true);
      adapter.assertSourceCurrent(frozenRelight.capture.snapshot);
    }
    // Always recapture at submission; a thumbnail saved earlier is not a fresh document state.
    operationStage='capture';if(!frozenRelight){if(destination==='selection')await captureArea(expectedDocumentId);else capture=undefined;}
    const captured=frozenRelight?.capture??capture,ref=reference;
    for(let index=0;index<count&&!stopBatch;index++) {
      batchPosition=t("候选 {0} / {1} · ",index+1,count);taskPhase(t("准备与上传输入…"));status(t("上传候选 {0} / {1} 的输入…",index+1,count));const id=uuid(),clientId=uuid();
      const seed=seedSupported?baseSeed+index:0;
      const snapshot=captured?.snapshot;
      let source:string|undefined,guideName:string|undefined,referenceName:string|undefined,modelSize:{width:number;height:number}|undefined,generationRequest:GenerationRequest|undefined;
      if(client instanceof GatewayClient){
        const size=request.kind==='edit'?makeMapping(snapshot!.bounds,resolution):{width:resolution,height:resolution};
        generationRequest=validateGeneration({model:client.model,kind:request.kind,mode,prompt:request.prompt,seed,width:size.width,height:size.height,outputDepth:depth,...(request.kind==='edit'?{source:`${id}-source.png`,...(guide?{guide:`${id}-guide.png`}:{}),...(ref?{reference:`${id}-reference.png`}:{})}:{})},client.capabilities!);
      }
      if(snapshot){
        await store.binary(`${id}-mask.bin`,snapshot.mask);await store.binary(`${id}-source.png`,encodePng(captured!.image));
        if(snapshot.backgroundComposite==='subject-background-v1'){
          if(!captured!.subjectMask)throw new Error(t('背景历史的蒙版数据缺失或损坏，无法安全重建候选；原始输出已保留'));
          await store.binary(`${id}-subject-mask.bin`,captured!.subjectMask);await store.binary(`${id}-protection-mask.bin`,captured!.protectionMask);
        }
      }
      if(request.kind==='edit') {
        if(frozenRelight)adapter.assertSourceCurrent(snapshot!);
        const mapping=makeMapping(snapshot!.bounds,resolution);
        modelSize={width:mapping.width,height:mapping.height};
        const image=resize(captured!.image,mapping.width,mapping.height);
        source=await client.upload(encodePng(editModelInput(mode,image)),`${id}-source.png`);
        if(guide){const mask=resize(maskRaster(snapshot!.mask,captured!.image.width,captured!.image.height),mapping.width,mapping.height);guideName=await client.upload(encodePng(mask),`${id}-guide.png`);}
        if(ref){const refMap=makeMapping({left:0,top:0,right:ref.width,bottom:ref.height},resolution);referenceName=await client.upload(encodePng(resize(ref,refMap.width,refMap.height)),`${id}-reference.png`);}
      }
      if(stopBatch)break;
      const graph=client instanceof GatewayClient?{}:buildGraph({requestId:id,prompt:request.prompt,seed,steps,resolution,source,guide:guideName,reference:referenceName,models:settings.models,outputDepth:outputDepth()});
      const {mask:ignored,...metadata}=snapshot??{mask:undefined};
      current={id,clientId,baseUrl:settings.baseUrl,state:'created',createdAt:new Date().toISOString(),graph,...(generationRequest?{backend:'gateway' as const,request:generationRequest}:{}),userPrompt,params:{workspace,mode,steps,resolution,seed,outputDepth:depth,guide,margin,usage,destination,outputKind:request.kind,modelSize,preserveAlpha:behavior.preserveAlpha,alignSubject:behavior.alignSubject,matchColor:behavior.matchColor},snapshot:snapshot?metadata:undefined,template:generationRequest?GATEWAY_TEMPLATE:templateForDepth(depth),...(generationRequest?{providerModel:generationRequest.model}:{models:{...settings.models}})};
      if(captured?.documentName)current.sourceName=captured.documentName;
      if(frozenRelight&&relightCaps){current.relight={...relightTaskMetadata(frozenRelight,id,relightCaps,modelSize!,depth,seed),...(relightConflictResolution?{conflictResolution:relightConflictResolution}:{})};onRelightJob?.(id);}
      operationStage='inference';await store.trace('task.submit',id);await coordinator.submit(current);await refreshHistory(id);await store.trace('task.wait',id);
      if(current.state==='failed')throw new Error(current.detail);
      if(!await waitRecord(current))break;
      if(index===count-1)taskSucceeded=true;
    }
  }catch(error){status(error instanceof Error?error.message:String(error));throw error;}finally{endTask();try{await refreshHistory();}finally{lock(false);}}
}
async function recover(){
  if(busy)return;const id=historyTable.selectedId;detachAcknowledgedId=undefined;stopBatch=false;startTask();lock(true);
  try {const records=await store.history();current=records.find(r=>r.id===id);
  if(!current)throw new Error(t("没有可恢复的任务"));
  assertBackend(current);if(current.tracking==='detached'){delete current.tracking;await store.save(current);await refreshHistory(id);}if(settings.platform&&client instanceof GatewayClient){const ready=await connectDraft(settings) as GatewayClient;client.token=ready.token;}taskSucceeded=await waitRecord(current);}catch(error){status(error instanceof Error?error.message:String(error));throw error;}finally{endTask();try{await refreshHistory(id);}finally{lock(false);}}
}
async function cancelSelected(){
  // Busy cancellation belongs to the active batch, regardless of visible history.
  if(busy){if(taskActive)stopBatch=true;return;}
  const id=historyTable.selectedId;detachAcknowledgedId=undefined;lock(true);
  try{const record=(await store.history()).find(r=>r.id===id);if(!record||!blocksGeneration(record))return;
    assertBackend(record);current=record;stopBatch=true;
    if(settings.platform&&client instanceof GatewayClient){const ready=await connectDraft(settings) as GatewayClient;client.token=ready.token;}
    const result=await coordinator.cancel(record);if(result.state==='ready'){await saveReady(record,result.images!);status(t("任务已完成，候选已保留"));}else status(result.state==='cancelled'?t("取消已确认；生成文件保留"):t(client instanceof GatewayClient?'后续候选已停止；当前平台任务继续，完成后保留结果':"取消尚未确认，请继续恢复或取消原任务"));
  }finally{try{await refreshHistory(id);}finally{lock(false);}}
}
async function apply(jobId?:string){if(busy){if(jobId)throw new Error(t('已有任务正在进行，请等待完成后再生成或应用；可以继续编辑布光'));return;}lock(true);try{const c=jobId?candidateById(jobId):selected();if(c.warning)throw new DiagnosticError('invalid-output','output',c.warning);if(!c.snapshot)throw new Error(t("此候选没有来源选区，请使用新文档查看"));const params=c.job.params as any,behavior=editBehavior(params.mode,params,c.job.backend??'comfyui');const source=params.outputKind==='edit'&&behavior.preserveAlpha?decodePng(await store.readBinary(`${c.job.id}-source.png`)):undefined;const name=c.job.relight?t('PS-AI 光影重塑 · 完整结果 {0}',c.job.id.slice(0,8)):`PS-AI ${c.job.id.slice(0,8)}`;const layerId=await adapter.apply(c.snapshot,c.image,name,source);applied={documentId:c.snapshot.documentId,layerId,jobId:c.job.id};el('opacity').value=100;status(t("已应用为独立图层，蒙版可编辑；同次捕获切换候选替换此图层，Ctrl+Z 一次撤销"));}finally{lock(false);}}
function on(id:string,action:()=>Promise<void>){el(id).addEventListener('click',()=>void guarded(async()=>{operationStage=['apply','new-document','opacity'].includes(id)?'apply':['capture','restore-selection','protect','reference'].includes(id)?'capture':['scan-models','setup-check'].includes(id)?'environment':['recover','generate','setup-example','cancel'].includes(id)?'inference':'connection';await action();}));}
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
on('close-setup',async()=>{el('setup-body').style.display='none';views.show('create');});
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
  const oldWorkspace=workspace,oldReference=reference,oldProtection=protection,oldMode=el('mode').value,oldOverrides=new Map(overriddenChecks);
  const fields=['prompt','count','steps','resolution','seed','margin','destination'],checks=['guide','preserve-alpha','align-subject','match-color','lock-seed'];
  const oldValues=fields.map(id=>el(id).value),oldChecks=checks.map(id=>el(id).checked);
  let completed=false;
  try{
    const pending=(await store.history()).find(blocksGeneration);if(pending){await refreshHistory(pending.id);views.show('history');pendingDetailReveal=true;throw new DiagnosticError('pending-task','inference',t('任务 {0} 尚未确认，请在历史中按原 ID 恢复或取消',pending.id));}
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
    reference=oldReference;protection=oldProtection;setWorkspace(oldWorkspace,oldMode);
    fields.forEach((id,i)=>el(id).value=oldValues[i]);checks.forEach((id,i)=>el(id).checked=oldChecks[i]);overriddenChecks.clear();for(const [id,value] of oldOverrides)overriddenChecks.set(id,value);capture=undefined;el('selection-previews').style.display='none';sourceCaption.show('范围参数已改变，请重新预览选区');inputUi();lock(false);
    if(!completed&&previous&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===previous.id))await ps.core.executeAsModal(async()=>{ps.app.activeDocument=previous;},{commandName:'PS-AI restore document'});
  }
});
on('toggle-error-details',async()=>{el('diagnostic-details').style.display=el('diagnostic-details').style.display==='none'?'block':'none';});
on('capture',()=>configure(()=>captureArea()));
on('restore-selection',restoreSelectionArea);
on('protect',()=>configure(async()=>{protection=await adapter.protection();capture=undefined;el('selection-previews').style.display='none';sourceCaption.show('保护区已保存；请重新圈选编辑区，再捕获或生成');status(t("保护区保留原始像素，不依赖自动人脸识别"));}));
on('clear-protection',()=>configure(async()=>{protection=undefined;capture=undefined;el('selection-previews').style.display='none';sourceCaption.show('保护区已清除，请重新捕获');}));
on('reference',()=>configure(async()=>{const file=await uxp.storage.localFileSystem.getFileForOpening({types:['png','jpg','jpeg','webp']});if(!file)return;reference=await adapter.importReference(file);el('reference-info').textContent=`${file.name} · ${reference.width}×${reference.height} · sRGB 8-bit`;}));
on('clear-reference',async()=>{reference=undefined;el('reference-info').setAttribute('data-i18n','未选择参考图');el('reference-info').textContent=t("未选择参考图");});
on('open-relight',()=>openRelightWorkbench());
on('relight-reuse-history',()=>openRelightWorkbench(relightReuse,relightReuseDescription));
el('relight-scope').addEventListener('change',()=>{if(relightSession)relightWorkbench?.setScopePending(relightScope()!==relightSession.scope);});
el('remember-source-access').addEventListener('change',()=>void guarded(async()=>{const operation=++sourceAccessOperation,notice=sourceAccessNotice;await sourceColorReader.setRemember(!!el('remember-source-access').checked);if(operation!==sourceAccessOperation)return;el('remember-source-access').checked=sourceColorReader.remember;if(notice===sourceAccessNotice)sourceAccessStatus(sourceColorReader.remember?'已开启记住原图文件授权；仍会重新检查文件内容和颜色声明':'已关闭记住原图文件授权；已移除保存的授权，本次会话访问仍可使用');}));
on('forget-source-access',async()=>{const operation=++sourceAccessOperation;await sourceColorReader.forget();if(operation===sourceAccessOperation)sourceAccessStatus('已清除保存和本次会话的原图文件授权；需要时请重新选择原图');});
on('generate',generate);on('apply',apply);on('recover',recover);
on('cancel',cancelSelected);on('open-pending',()=>showPending());on('next-pending',()=>showPending(true));
on('history-cancel',async()=>{if(!busy)await cancelSelected();});
on('clear-history',()=>clearHistory());on('confirm-clear-history',()=>clearHistory(true));on('keep-history',async()=>{if(!busy){clearConfirmation=undefined;historyUi();}});on('retry-history-cleanup',retryHistoryCleanup);
el('nav-history').addEventListener('click',historyUi);
on('stop-tracking',()=>stopTracking());on('confirm-stop-tracking',()=>stopTracking(true));on('keep-tracking',async()=>{detachAcknowledgedId=undefined;historyUi();});
el('mode').addEventListener('change',()=>{invalidateCapture();inputUi();if(workspace==='cosplay'&&el('mode').value==='reference'){fold('reference',true);el('guide').checked=false;status(t("角色参考默认使用原图 + 参考图；范围辅助可能影响颜色，请按需试验"));}});
el('destination').addEventListener('change',inputUi);
el('margin').addEventListener('change',()=>{capture=undefined;el('selection-previews').style.display='none';sourceCaption.show('范围参数已改变，请重新预览选区');});
el('candidate-select').addEventListener('change',()=>void guarded(showSelected));
on('zoom',async()=>{zoomed=!zoomed;el('zoom').textContent=zoomed?t("适应预览"):t("100% 查看");await showSelected();});
on('export',()=>configure(async()=>{const c=selected(),file=await uxp.storage.localFileSystem.getFileForSaving(`ps-ai-${c.job.id.slice(0,8)}.png`,{types:['png']});if(file)await file.write(new Uint8Array(c.bytes).buffer,{format:uxp.storage.formats.binary});}));
on('new-document',()=>configure(async()=>{const c=selected();await adapter.newDocument(c.image,`ps-ai ${c.job.id.slice(0,8)}`);}));
el('opacity').addEventListener('change',()=>void guarded(()=>configure(async()=>{if(!applied)throw new Error(t("请先应用一个候选"));await adapter.opacity(applied.documentId,applied.layerId,Number(el('opacity').value));})));
on('load-history',async()=>{if(busy)return;const id=historyTable.selectedId;lock(true);try{const record=(await store.history()).find(r=>r.id===id);if(!record?.outputFile)throw new Error(t("此记录尚未保存候选，请恢复任务"));await addCandidate(record,await store.readBinary(historyOutputName(record)));views.show('results');}finally{lock(false);}});
on('repeat-history',async()=>{
  if(busy)return;const id=historyTable.selectedId;lock(true);
  try{const r=(await store.history()).find(r=>r.id===id);if(!r)throw new Error(t("请选择历史记录"));const p=r.params as any;
    if(settings.backend==='gateway'&&p.outputDepth===16)throw new Error(t('此历史为 16 位输出，请切回 ComfyUI 后恢复参数；当前平台配置保留 8 位'));views.show('create');
    if(p.mode==='relight'){const metadata=r.relight as RelightTaskMetadata|undefined;relightReuse=metadata?validateRelightScene(metadata.scene):undefined;relightReuseDescription=metadata?undefined:String(r.userPrompt??'');setWorkspace('cosplay','relight');el('relight-reuse-history').style.display='block';status(t('历史光影参数已准备，请明确点击复用到当前原图；旧候选仍可读取、应用或导出'));return;}
    setWorkspace(p.workspace,p.mode);if(p.mode!=='remove')el('prompt').value=r.userPrompt;for(const name of ['steps','resolution','seed','destination'])el(name).value=p[name];el('output-depth').value=String(p.outputDepth??8);el('usage').value=['服装','道具','材质','场景'].includes(p.usage)?p.usage:'服装';el('guide').checked=p.guide;el('preserve-alpha').checked=p.preserveAlpha!==false;el('align-subject').checked=p.alignSubject!==false;el('match-color').checked=p.matchColor===true;el('margin').value=p.margin*100;el('lock-seed').checked=true;inputUi();status(t("参数已恢复；参考图和保护区请重新指定，提交时重新捕获"));
  }finally{lock(false);}
});
on('p0',async()=>{if(busy)return;lock(true);const trace:string[]=[];try{const report=await runHostProbe(ps,adapter,trace);await store.json('p0-host-report.json',report);status(t("P0 宿主往返通过：选区外/保护区像素、原图层、蒙版、异文档与一次撤销"));}catch(error){await store.json('p0-host-report.json',{passed:false,date:new Date().toISOString(),trace,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined});throw error;}finally{lock(false);}});
on('report',async()=>{const r=await store.readJson('p0-host-report.json',null);if(!r)throw new Error(t("请先运行 P0 图像往返验证"));const f=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-p0-host-report.json',{types:['json']});if(f)await f.write(JSON.stringify(r,null,2));});
on('export-log',async()=>{const r=await store.readJson('runtime-trace.json',null);if(!r)throw new Error(t("尚无操作阶段日志"));const f=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-runtime-trace.json',{types:['json']});if(f)await f.write(JSON.stringify(r,null,2));});
uxp.entrypoints.setup({panels:{psai:{show(){}}}});
void guarded(async()=>{lock(true);el('cancel').disabled=true;try{await sourceColorReader.ready();el('remember-source-access').checked=sourceColorReader.remember;const savedSettings=await store.readJson<unknown>('settings.json',null);settings=validateSettings(savedSettings??defaultSettings());client=backendClient(settings);coordinator=new JobCoordinator(client,store);settingsReady=true;el('backend-url').value=settings.baseUrl;restoreSettingsLanguage();showSettings();await refreshHistory(undefined,true);try{await checkBackend(client,settings);showGatewayModels();connection('已连接');if(!savedSettings)showSetup();}catch(error){connection('未连接');showSetup();throw error;}}catch(error){showSetup();fold('settings',true);throw error;}finally{lock(false);}});
