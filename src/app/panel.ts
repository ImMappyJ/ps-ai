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
import type {GatewayCapabilities,GenerationRequest,AssetContext} from '../infrastructure/backends/gateway-protocol';
import {RelightSession,RelightDraftStore,relightTaskMetadata,type FrozenRelightSubmission,type RelightTaskMetadata,type RelightScope,type RelightOutputKind} from '../features/relight/relight-session';
import {RelightWorkbench,type RelightResult} from '../features/relight/relight-workbench';
import {validateRelightExtractionSettings,type RelightExtractionSettings} from '../features/relight/relight-layers';
import {blendTaskMetadata,validateBlendTaskMetadata,withBlendProcessing,assertBlendLightingCapture,type BlendTaskMetadata} from '../features/blend/blend-session';
import {compileRelightScene,validateRelightScene,type RelightScene,type RelightCapabilities} from '../features/relight/relight-scene';
import {PanelViews,OperationFeedback,ResultNavigation,CandidatePreview,SourceCaption,captureSizeSummary,localValidationMessage,isSourceCaptureDiagnostic,createCandidateCard,setCandidateCardState,displayPreview as preview} from './panel-view';import type {OperationContext,PanelPage,CaptureSizeDetails} from './panel-view';
import {HistoryTable,historyTaskType,historyPrompt,historyState,historySource,historyDate} from './history-table';
import {prepareCandidate,prepareLightingLayerApplication,prepareEditAnalysisApplication,prepareSelectionAssetApplication,preflightEditAnalysisCandidate,preflightSelectionAssetCandidate,historyOutputName,loadCandidateSource,type PreparedCandidate} from './candidate-preparation';
import {planRelightMemory,downsampleSnapshotMask,resampleGray} from '../imaging/budget';
import {observeRelightSource} from './relight-source-monitor';
import {suggestModelMappings} from '../diagnostics/model-discovery';
import {HistoryPreview} from './history-preview';
declare const require:(name:string)=>any;
const ps=require('photoshop'),uxp=require('uxp'),store=new Storage(uxp);
let sourceColorReader:ReturnType<typeof createSourceColorReader>;
const adapter=new PhotoshopAdapter(ps,uuid(),stage=>store.trace(stage),(doc,file)=>sourceColorReader(doc,file));
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
  if(value.platform&&backend instanceof GatewayClient){const ready=await connectDraft(value);backend.token=(ready as GatewayClient).token;if(!(ready as GatewayClient).capabilities?.configured)throw new DiagnosticError('unauthorized','connection',t('请在面板保存此平台的 API Key，再连接'));}
  try{result=await backend.check(value.outputDepth??8);}
  finally{if(backend instanceof GatewayClient&&backend.capabilities){gatewayCatalog=backend.capabilities;gatewayCatalogBase=value.baseUrl;}}
  if(backend instanceof GatewayClient){
    if(!/^\d+\./.test(String(uxp.host?.version))||Number(String(uxp.host.version).split('.')[0])<27)throw new Error(t('需要 Photoshop 27.0 或更高版本'));
    gatewayCatalog=backend.capabilities;gatewayCatalogBase=value.baseUrl;
  }else checkEnvironment(String(uxp.host?.version??''),result.nodeInfo,value.models,value.outputDepth??8);
  return result;
}
const el=(id:string):any=>document.getElementById(id);
const feedback=new OperationFeedback(),resultNavigation=new ResultNavigation();
let activeOperation:OperationContext|undefined,panelVisible=false,initialization:Promise<void>|undefined,pointerActive=false,navigationTimer:ReturnType<typeof setTimeout>|undefined,copyTimer:ReturnType<typeof setTimeout>|undefined;
let historyDetail=false,historyScrollTop=0;
const views=new PanelViews(document,()=>{clearConfirmation=undefined;historyUi();renderDiagnostic();}),candidatePreview=new CandidatePreview(),sourceCaption=new SourceCaption(el('source-info'),el('source-color-warning'));
el('build-id').textContent=BUILD_ID;
const modes={local:[['edit','局部物体 / 材质修改'],['remove','移除杂物'],['background','换背景（选择主体）']],cosplay:[['effect','特效素材'],['costume','服装 / 道具修复'],['reference','角色参考辅助'],['scene','场景替换'],['atmosphere','氛围素材'],['relight','光影重塑'],['blend','溶图']],t2i:[['generate','文字生图']]};
let workspace:Workspace='local',capture:Capture|undefined,protection:Protection|undefined,reference:Raster|undefined;
let lastSelection:{range:SelectionRange;workspace:Workspace;mode:string}|undefined;
let current:JobRecord|undefined,busy=false,stopBatch=false,zoomed=false;
let historyRecords:JobRecord[]=[],detachAcknowledgedId:string|undefined;
let applied:{documentId:number;layerId:number;jobId:string}|undefined;
interface Candidate extends PreparedCandidate {job:JobRecord;bytes:Uint8Array;preview:string}
function lightingPreviewLabel(candidate:PreparedCandidate):string|undefined {return candidate.outputKind==='lighting-layers'?candidate.lightingState==='composite'?'光影合成预览':'AI 参考图（提取失败，仅供检查）':undefined;}
function assertLightingComposite(candidate:Candidate):void {if(candidate.outputKind==='lighting-layers'&&candidate.lightingState!=='composite')throw candidate.lightingFailure??new DiagnosticError('relight-extraction','lighting-extraction',t('本地光影提取未完成；原始 AI 参考图已保留，请检查参考图和来源的作用范围。'));}
let candidates:Candidate[]=[];
type BlendView='source'|'composite'|'ai';
let blendView:BlendView='composite',blendSelectedId:string|undefined,blendRevision=0,blendViewRevision=0,blendPending=false,blendCommitting=false;
let blendTimer:ReturnType<typeof setTimeout>|undefined,blendGenerationOpen=false,blendProtectionOpen=false;
let blendDraft:{outputKind:RelightOutputKind;extraction:RelightExtractionSettings}|undefined;
let blendMessage:{key:string;values:string[]}|undefined;
function blendStatus(key?:string,...values:string[]):void {blendMessage=key?{key,values}:undefined;renderBlendStatus();}
function renderBlendStatus():void {el('blend-processing-status').textContent=blendMessage?t(blendMessage.key,...blendMessage.values.map(errorText)):'';}
let imageOperation:Promise<void>=Promise.resolve();
function withImagePixels<T>(action:()=>Promise<T>):Promise<T>{const work=imageOperation.then(action);imageOperation=work.then(()=>{},()=>{});return work;}
let taskActive=false,taskSucceeded=false,batchPosition='';
let sourceCaptures=0;
function relightOpenBlocked():boolean{return sourceCaptures>0||busy&&!taskActive;}
async function withSourceCapture<T>(action:()=>Promise<T>):Promise<T>{sourceCaptures++;inputUi();try{return await action();}finally{sourceCaptures--;inputUi();}}
let connectionState='未连接';
let setupStep=1,checkedSetup='';
let sourceAccessMessage='',sourceAccessNotice=0,sourceAccessOperation=0;
let modelScanUnresolved:readonly string[]|undefined;
function renderModelScanReport(){el('model-scan-report').textContent=modelScanUnresolved?t(modelScanUnresolved.length?'以下模型缺失或匹配不唯一，请手动选择：{0}。':'已保留可用映射，并选择唯一匹配的预设文件；请保存并连接检查。',modelScanUnresolved.join(', ')):'';}
const overriddenChecks=new Map<string,boolean>();
let promptKind:'ordinary'|'blend'='ordinary';
const promptDrafts={ordinary:'',blend:''};
const relightDrafts=new RelightDraftStore(store);
let relightWorkbench:RelightWorkbench|undefined,relightSession:RelightSession|undefined,relightMargin=.15,relightReuse:RelightScene|undefined,relightReuseDescription:string|undefined;
// A successful recovery copy can outlive a failed read. It grants no snapshot
// or application rights; only the matching explicit UI action may retry it.
let pendingColorCapture:{sourceDocumentId:number;documentId:number;colorReason:NonNullable<Snapshot['colorReason']>;workspace:Workspace;mode:string;geometry:{width:number;height:number;mode:unknown;depth:unknown};session?:RelightSession;scope?:RelightScope}|undefined;
let clearConfirmation:{ids:readonly string[];revision:number;signature:string;unresolved:number}|undefined;
let cleanupStatus:HistoryCleanupStatus|undefined,historyNotice='',lastHistoryFocus:string|undefined;
let pendingDetailReveal=false,historyRevealTimer:ReturnType<typeof setTimeout>|undefined;
const historyPreview=new HistoryPreview(el('history-preview'),el('history-preview-status'),record=>withImagePixels(async()=>{
  const name=historyOutputName(record),bytes=await store.readBinary(name),prepared=await prepareCandidate(record,bytes,name=>store.readBinary(name),retainedImageBytes(true));
  return {url:await preview(prepared.image,480),warning:prepared.warning,label:lightingPreviewLabel(prepared),lightingFailure:prepared.lightingFailure};
}));
const historyTable=new HistoryTable(el('history-browser'),{busy:()=>busy,changed:()=>{detachAcknowledgedId=undefined;clearConfirmation=undefined;historyNotice='';historyUi();},focused:()=>{historyScrollTop=el('history-rows').scrollTop;historyDetail=true;historyUi();},refresh:()=>void guarded(()=>configure(()=>refreshHistory()),{page:'history',feature:'history-refresh'})});
function outputDepth():8|16{return el('output-depth').value==='16'?16:8;}
function draftSettings(id:ConnectionId=el('backend-kind').value):BackendSettings{return validateSettings({schemaVersion:1,baseUrl:el('backend-url').value,language:el('language').value,autoViewResults:el('auto-view-results').checked!==false,outputDepth:outputDepth(),connections:draftConnections,...(id!=='comfyui'?{backend:'gateway',gatewayModel:el('gateway-model').value}:{}),...(isPlatform(id)?{platform:id}:{}),models:{unet:el('model-unet').value,clip:el('model-clip').value,vae:el('model-vae').value}});}
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
function connection(value:string){connectionState=value;el('connection').textContent=t(value);workflowUi();}
function workflowUi():void {
  const mode=el('mode').value,pending=historyRecords.some(blocksGeneration);
  let dirty=!settingsReady;
  try{dirty=dirty||connectionSignature(draftSettings())!==connectionSignature(settings);}catch{dirty=true;}
  let sourceReady=!!capture;
  if(capture)try{sourceReady=activeDocumentId()===capture.snapshot.documentId&&adapter.sourceAvailability(capture.snapshot,true)==='current';}catch{sourceReady=false;}
  const needsSource=el('selection-tools').style.display!=='none';
  const step=busy?'busy':pending?'pending':dirty||connectionState!=='已连接'?'connection':mode==='relight'?'relight':needsSource&&!sourceReady?'source':mode==='reference'&&!reference?'reference':mode!=='remove'&&mode!=='blend'&&!el('prompt').value.trim()?'prompt':'ready';
  const copy:Record<string,[string,string,string]>={
    busy:['正在处理当前操作','可切换页面查看信息；生成任务的取消操作始终位于底部。','正在处理…'],
    pending:['先处理未确认任务','按原任务 ID 恢复或取消，避免重复提交。','处理未确认任务'],
    connection:[dirty?'保存并检查连接':'先检查服务连接','进入设置连接已有服务。检查连接不会生成图片。','打开连接设置'],
    relight:['选择范围并布置光照','打开工作台读取来源，调整光照后再明确生成。','打开布光工作台'],
    source:['先确认来源与范围','在 Photoshop 建立选区，再读取预览；生成前仍会重新捕获。','预览选区'],
    reference:['添加角色参考图','选择参考图片，再描述希望借用的外观或服装。','选择图片'],
    prompt:['描述希望发生的变化','说明要改变什么，以及需要保留的形状与细节。','填写描述'],
    ready:['已准备好生成','检查范围和参数后，点击底部生成按钮。结果将在单独页面比较。','查看生成设置']
  };
  const [title,help,action]=copy[step];
  el('workflow-guide').setAttribute('data-step',step);el('workflow-title').textContent=t(title);el('workflow-help').textContent=t(help);el('workflow-next').textContent=t(action);el('workflow-next').disabled=busy;
  el('generation-summary').textContent=t('{0} 个候选 · {1}px · {2} 位 · {3}',el('count').value,el('resolution').value,outputDepth(),t(el('destination').value==='document'?'新文档':'来源选区'));
}
function status(text:string){el('status').textContent=errorText(text);el('status').style.display='block';}
function sourceAccessStatus(message:string){sourceAccessNotice++;sourceAccessMessage=message;el('source-access-status').textContent=t(message);}
function relightScope():RelightScope {const scope=el('relight-scope').value;if(scope!=='selection'&&scope!=='document')throw new Error(t('布光范围无效，请重新选择'));return scope;}
function taskPhase(text:string,percent=0){el('task-progress').style.display='block';el('task-progress').setAttribute('aria-busy',String(taskActive));el('progress-label').textContent=batchPosition+text;el('progress-bar').setAttribute('value',String(percent));relightWorkbench?.progress(batchPosition+text);}
function startTask(){taskActive=true;taskSucceeded=false;batchPosition='';taskPhase(t("准备任务…"));}
function endTask(){taskActive=false;taskPhase(taskSucceeded?t("候选已保存"):el('status').textContent,taskSucceeded?100:0);}
function option(select:any,value:string,text:string){const node=document.createElement('option');node.value=value;node.textContent=t(text);select.appendChild(node);}
function assetMode(mode=el('mode').value):boolean{return workspace==='cosplay'&&['effect','atmosphere'].includes(mode);}
function assetContext():AssetContext|undefined {
  if(!assetMode())return;
  const value=el('asset-input').value;
  if(value!=='selection-v1'&&value!=='text')throw new Error(t('素材输入方式无效，请重新选择'));
  return value==='selection-v1'?value:undefined;
}
function inputUi(){
  const mode=el('mode').value,blend=mode==='blend',structuredRelight=mode==='relight',nextPromptKind=blend?'blend':mode==='remove'||structuredRelight?undefined:'ordinary';
  const create=el('view-create');create.insertBefore(el('selection-tools'),el('prompt-group'));
  create.insertBefore(el('blend-create-controls'),blend?el('prompt-group'):el('toggle-reference').parentElement);
  el('blend-create-controls').style.display=blend?'block':'none';el('blend-output-kind').disabled=busy;
  el('capture').textContent=t(blend?'读取当前图片与选区':'预览选区');
  el('toggle-protection').style.display='block';el('protection-body').style.display=blendProtectionOpen?'flex':'none';
  el('toggle-protection').textContent=t('保护区')+(blendProtectionOpen?' ▾':' ▸');el('toggle-protection').setAttribute('aria-expanded',String(blendProtectionOpen));
  el('generation-title').style.display='block';el('toggle-generation').style.display='block';el('generation-body').style.display=blendGenerationOpen?'block':'none';
  el('toggle-generation').textContent=t('生成设置')+(blendGenerationOpen?' ▾':' ▸');el('toggle-generation').setAttribute('aria-expanded',String(blendGenerationOpen));
  for(const id of ['margin-field','align-subject','match-color','edit-controls-help'])el(id).style.display=blend?'none':'';
  if(blend){el('selection-tools').insertBefore(el('selection-previews'),el('capture-actions'));el('destination').value='selection';}
  else el('selection-tools').insertBefore(el('selection-previews'),el('range-legend'));
  if(nextPromptKind&&nextPromptKind!==promptKind){promptDrafts[promptKind]=el('prompt').value;el('prompt').value=promptDrafts[nextPromptKind];promptKind=nextPromptKind;}
  el('prompt-group').style.display=mode==='remove'||structuredRelight?'none':'block';el('prompt-label').textContent=t(blend?'补充要求（可选）':'描述修改或生成内容');
  el('relight-entry').style.display=structuredRelight?'block':'none';el('open-relight').disabled=relightOpenBlocked();el('relight-reuse-history').disabled=busy||sourceCaptures>0;el('generate').textContent=t(structuredRelight?'打开布光工作台':blend?'生成环境光参考':'生成候选');
  const asset=assetMode(mode),context=assetContext(),standalone=workspace==='t2i'&&el('destination').value==='document'||asset&&!context;el('selection-tools').style.display=standalone?'none':'block';el('prompt').setAttribute('placeholder',blend?t('可选：补充光影、色彩或融合要求'):workspace==='t2i'?t("描述要生成的画面、主体与风格"):workspace==='cosplay'?t("描述服装道具、光影方向、角色参考或氛围效果"):t("描述选区中要修改的内容，及需要保留的细节"));
  el('asset-input-group').style.display=asset?'block':'none';el('asset-input').disabled=busy;
  el('asset-input-help').textContent=t(context?'来源图与有效灰度范围图会一起送模，输出位置不改变输入。范围仅供参考，请检查结果是否残留来源人物、背景或范围图。':'仅使用文字生成独立素材，不读取当前图片；可另存 PNG 或新建文档。');
  if(asset&&!context)el('destination').value='document';el('destination').disabled=busy||blend||asset&&!context;
  el('toggle-reference').parentElement.style.display=asset?'none':'block';
  el('range-legend').textContent=t(context?'实际送模预览：左为 sRGB 8-bit 来源图，右为扣除保护区后的灰度范围图；白色可放置，黑色不放置，灰色为羽化。':'橙色：实际编辑 · 蓝色：手动保护 · 灰色：只提供上下文。回填使用真实灰度蒙版。');
  const restorable=workspace!=='t2i'&&mode!=='relight'&&!standalone&&(!!context||el('destination').value==='selection');el('restore-selection').style.display=restorable?'block':'none';el('restore-selection').disabled=busy||!restorable||lastSelection?.workspace!==workspace||lastSelection?.mode!==mode;
  const platform=isPlatform(el('backend-kind').value),cloud=el('backend-kind').value!=='comfyui',model=gatewayCatalogBase===el('backend-url').value?gatewayCatalog?.models.find(m=>m.id===el('gateway-model').value):undefined;
  const background=isBackgroundMode(mode);
  el('selection-tools').querySelector('h3').textContent=t('2 · 确定来源与范围');
  el('generation-title').textContent=t('3 · 生成与输出');
  el('selection-instruction').textContent=t(background?'选择要保留的主体，不要反选。':blend?'选择已放入环境中的前景主体。':structuredRelight?'选择要布光的范围，或明确选择整张图像。':context?'选择素材应出现的区域。':'选择要修改的区域；保护区可保留重要细节。');
  for(const [id,forced] of [['preserve-alpha',background||asset],['align-subject',background||blend||structuredRelight||asset],['match-color',background||blend||structuredRelight||asset],['guide',(background||blend)&&!cloud||asset]] as const){
    if(forced){if(!overriddenChecks.has(id))overriddenChecks.set(id,!!el(id).checked);el(id).checked=false;}
    else if(overriddenChecks.has(id)){el(id).checked=overriddenChecks.get(id);overriddenChecks.delete(id);}
    el(id).disabled=busy||forced;
  }
  if(context)el('guide').checked=true;
  el('mode-help').textContent=background?t(cloud?'选中要保留的主体，无需反选。整张画布用于生成不透明背景，保留主体核心并融合半透明边缘；保护区保留原样。':'选中要保留的主体，无需反选。整张画布用于生成背景；选区精确控制回填，不作为黑白参考图送入 ComfyUI。主体核心和保护区保留，半透明边缘与新背景融合。'):blend?t(cloud?'选中主体，整张画布提供环境参考；只回填主体并扣除保护区。重新匹配曝光、受光和环境色，保留插画或摄影风格；请检查身份、细节和边缘。全图缩放可能降低小主体细节。':'选中主体，整张画布提供环境参考；灰度范围图不送入 ComfyUI，只用于精确回填主体并扣除保护区。重新匹配曝光、受光和环境色，保留插画或摄影风格；请检查身份、细节和边缘。全图缩放可能降低小主体细节。'):mode==='remove'?t('圈选要移除的对象后直接生成，周边用于补齐背景。'):'';
  el('mode-help').style.display=background||blend||mode==='remove'?'block':'none';
  const kind=workspace==='t2i'?'t2i':['effect','atmosphere'].includes(el('mode').value)?'asset':'edit';
  el('gateway-key-settings').style.display=platform?'block':'none';el('backend-url').disabled=busy||platform;
  el('local-model-settings').style.display=cloud?'none':'block';el('gateway-model-settings').style.display=cloud?'block':'none';
  el('steps').disabled=busy||cloud;el('output-depth').disabled=busy||cloud;
  el('seed').disabled=busy||!!(cloud&&model?.seedMax===0);el('lock-seed').disabled=el('seed').disabled;
  el('generate').disabled=busy||!!(cloud&&model&&!model.operations.includes(kind));
  el('gateway-info').textContent=t('图像和提示词将上传 {0}。输出仅 8 位，步数由平台控制。',platformName())+(model&&!model.operations.includes('asset')?t(' 此模型不支持透明素材。'):'')+(model?.seedMax===0?t(' 此模型不支持设置随机种子。'):'')+(gatewayCatalog?.provider==='gemini'?t(' 使用方形上下文生成，再裁回原比例。'):'')+(gatewayCatalog?.provider==='openai'?t(' 开启范围辅助时使用平台蒙版；结果按请求比例还原。'):'');
  el('submission-info').textContent=cloud?el('gateway-info').textContent:t('图像和提示词将发送至 {0}；模型输入为 sRGB 8-bit。',el('backend-url').value);
  historyUi();renderDiagnostic();workflowUi();
}
function candidateApplicationMode(c?:Candidate):'new'|'replace'|'bound'|'unavailable' {return c?.snapshot?(c.snapshot.captureGeometry?(adapter.sourceAvailability(c.snapshot,true)==='current'?'bound':'unavailable'):adapter.applicationMode(c.snapshot)):'unavailable';}
function assertCandidateSource(c:Candidate):void {
  const s=c.snapshot;if(!s)return;
  if(s.sessionId!==adapter.sessionId)throw new DiagnosticError('source-unavailable','apply',t('来源会话已结束，请重新捕获；候选仍可另存或新建文档'));
  if(!Array.from(ps.app.documents as any[]).some(doc=>doc.id===s.documentId))throw new DiagnosticError('source-unavailable','apply',t('来源文档已关闭，候选已保留'));
  if(adapter.sourceAvailability(s,true)!=='current')throw new DiagnosticError('source-changed','apply',t('来源文档尺寸、颜色或内容状态已改变，请重新捕获'));
}
function candidateUi(){
  const c=candidates[Number(el('candidate-select').value)],bounded=!!c?.snapshot?.captureGeometry,mode=candidateApplicationMode(c);
  const lighting=c?.outputKind==='lighting-layers',referenceOnly=lighting&&c.lightingState!=='composite';
  const blend=!!c?.job.blend,localPending=blend&&blendPending;
  el('apply').disabled=busy||!c?.snapshot||!!c.warning&&!referenceOnly;el('apply').textContent=t(referenceOnly?'查看提取失败原因':mode==='unavailable'?'检查来源':bounded?'应用到来源文档':mode==='replace'?'替换本轮候选图层':'应用为新图层');
  el('apply').setAttribute('data-candidate-action',referenceOnly||mode==='unavailable'?'inspect':'apply');
  if(blend){el('apply').disabled=el('apply').disabled||localPending||blendView!=='composite';if(!referenceOnly&&mode!=='unavailable')el('apply').textContent=t(lighting?'应用光影组':'应用重绘主体');}
  el('blend-result-controls').style.display=blend?'block':'none';el('blend-result-controls').setAttribute('aria-busy',String(localPending));
  renderBlendStatus();
  const processing=blendDraft??{outputKind:c?.outputKind??'lighting-layers',extraction:(c?.job.blend as BlendTaskMetadata|undefined)?.localExtraction??{fidelity:1,detailProtection:.65}};
  el('blend-result-output').disabled=busy||!blend;el('blend-result-output').value=processing.outputKind;
  el('blend-extraction-controls').style.display=processing.outputKind==='lighting-layers'?'block':'none';
  for(const [id,key] of [['blend-fidelity','fidelity'],['blend-detail-protection','detailProtection']] as const){
    const value=Math.round(processing.extraction[key]*100);el(id).value=String(value);el(`${id}-slider`).value=value;
    el(id).disabled=busy||!blend||processing.outputKind!=='lighting-layers';el(`${id}-slider`).disabled=el(id).disabled;
  }
  for(const view of ['source','composite','ai'] as const){el(`blend-view-${view}`).disabled=busy||!blend;el(`blend-view-${view}`).setAttribute('aria-pressed',String(blendView===view));}
  const notes=c?.lightingFailure?diagnostic(c.lightingFailure,'lighting-extraction').summary:c?.warning??c?.lightingSummary?.warnings.map(message=>errorText(message)).join(' ');el('candidate-warning').textContent=notes?errorText(notes):'';el('candidate-warning').style.display=notes?'block':'none';
  const s=c?.snapshot;el('candidate-target').textContent=s?t('来源文档 {0} · {1} · {2}',s.documentId,s.profile,referenceOnly?t('提取失败；AI 参考图仅供检查和导出，不能作为光影层应用'):mode==='unavailable'?t('来源已关闭、改变或会话已结束；候选仍可导出'):bounded?t('应用到绑定文档；同次捕获会替换插件结果，其他图层保留'):mode==='replace'?t('替换同次捕获的插件图层，其他图层保留'):t('新增独立结果，保留来源图层')):c?t('独立生成结果，可另存或新建文档'):'';
  if(c&&s){const sizes=captureSizes(s,(c.job.params as any)?.modelSize,c.image);if(sizes)el('candidate-target').textContent+='\n'+captureSizeSummary(sizes);}
  el('candidate-color-warning').style.display=s?.colorReason==='assumed-srgb'?'block':'none';
  el('candidate-color-warning').textContent=s?.colorReason==='assumed-srgb'?t('来源色彩：假定 sRGB；颜色可能有偏差。'):'';
  for(const id of ['zoom','export','new-document'])el(id).disabled=busy||!c;el('candidate-select').disabled=busy||!c;el('opacity').disabled=busy||!applied;el('candidate-empty').style.display=candidates.length?'none':'block';el('detail-frame').style.display=c?'block':'none';
  el('export').textContent=t(blend?'另存融合预览':'另存 PNG');
  el('export-ai-reference').style.display=lighting||blend?'block':'none';el('export-ai-reference').disabled=busy||!c||!lighting&&!blend;el('ai-reference-export-info').style.display=lighting||blend?'block':'none';
  el('ai-reference-export-info').textContent=t(referenceOnly?'此候选未形成可用光影重组；另存 AI 参考图保留模型原始输出。':'另存 PNG 保存本地光影重组；AI 参考图保存模型原始输出。');
  const index=Number(el('candidate-select').value);
  const label=blend?(blendView==='source'?'原图':blendView==='ai'?'AI 参考':'融合预览'):c?lightingPreviewLabel(c):undefined;
  el('candidate-caption').textContent=c?t('候选 {0} / {1} · {2}×{3} · {4}-bit',index+1,candidates.length,c.image.width,c.image.height,rasterDepth(c.image))+(label?' · '+t(label):''):'';
  el('nav-results').textContent=t('结果')+(candidates.length?` · ${candidates.length}`:'');
  el('candidates').setAttribute('aria-label',t('候选预览'));
  for(const card of Array.from(el('candidates').children) as HTMLElement[])setCandidateCardState(card,Number(card.getAttribute('data-candidate-index'))===index,busy);
  el('applied-opacity').style.display=applied?'flex':'none';
}
function invalidateCapture(){invalidateBlendProcessing();capture=undefined;const visible=el('selection-previews').style.display!=='none';el('selection-previews').style.display='none';if(visible)sourceCaption.show('范围参数已改变，请重新预览选区');}
function setWorkspace(value:Workspace,mode=modes[value][0][0]){if(workspace!==value||el('mode').value!==mode)invalidateCapture();workspace=value;const select=el('mode');select.innerHTML='';for(const [id,label] of modes[value])option(select,id,label);select.value=mode;for(const w of ['local','cosplay','t2i'])el(`tab-${w}`).className=w===value?'active':'';if(value==='t2i')el('destination').value='document';else el('destination').value='selection';inputUi();}
function lock(value:boolean){busy=value;for(const id of ['generate','capture','restore-selection','protect','clear-protection','reference','clear-reference','tab-local','tab-cosplay','tab-t2i','mode','prompt','output-depth','usage','guide','preserve-alpha','align-subject','match-color','destination','count','steps','resolution','seed','lock-seed','margin','p0','recover','load-history','repeat-history','apply','new-document','connect','scan-models','save-settings','import-settings','export-settings','model-unet','model-clip','model-vae','backend-url','backend-kind','gateway-model','api-key','save-key','clear-key','stop-relay','language','auto-view-results','open-setup','close-setup','setup-connect','setup-check','setup-example','relight-scope','remember-source-access','forget-source-access'])el(id).disabled=value;candidateUi();renderSetup();inputUi();relightWorkbench?.refreshAvailability();}
function showGatewayModels(selected=settings.gatewayModel??DEFAULT_GATEWAY_MODEL){const select=el('gateway-model');select.innerHTML='';for(const id of new Set([selected,...(gatewayCatalogBase===el('backend-url').value?gatewayCatalog?.models.map(m=>m.id)??[]:[])]))option(select,id,id);select.value=selected;}
function showSettings(available?:Record<'unet'|'clip'|'vae',string[]>,value=settings) {for(const key of ['unet','clip','vae'] as const){const select=el(`model-${key}`);select.innerHTML='';for(const name of new Set([value.models[key],...(available?.[key]??[])]))option(select,name,name);select.value=value.models[key];}displayedConnection=connectionId(value);draftConnections=value.connections;el('backend-kind').value=displayedConnection;el('backend-url').value=value.baseUrl;el('output-depth').value=String(value.outputDepth??8);el('auto-view-results').checked=value.autoViewResults!==false;showGatewayModels(value.gatewayModel??(isPlatform(displayedConnection)?PLATFORMS[displayedConnection].model:DEFAULT_GATEWAY_MODEL));el('api-key').value='';void keyStatus();inputUi();}
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
  connection(connectionState);sourceCaption.render();renderModelScanReport();
  // UXP keeps the collapsed caption when existing option text is edited.
  el('source-access-status').textContent=t(sourceAccessMessage);
  for(const id of ['usage','destination','output-depth','backend-kind','relight-scope','asset-input','blend-output-kind','blend-result-output']){
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
async function guarded(action:(operation:OperationContext)=>Promise<void>,options:Partial<Pick<OperationContext,'page'|'feature'|'stage'>>={}){
  const operation=feedback.begin({page:options.page??views.current,feature:options.feature??'panel-action',stage:options.stage??'connection',documentId:activeDocumentId(),mode:el('mode').value});
  activeOperation=operation;
  try{await action(operation);feedback.succeed(operation);if(['generate','recover','capture','restore-selection','apply','connect','panel-initialize'].includes(operation.feature))await store.trace(`operation.${operation.feature}.complete.${operation.stage}`,operation.taskId,{operationId:operation.id,documentId:operation.documentId,durationMs:Date.now()-operation.startedAt});}
  catch(error){
    const d=diagnostic(error,operation.stage,historyRecords.some(blocksGeneration),{mode:operation.mode,selectionScope:operation.mode==='relight'?el('relight-scope').value:undefined});
    const reason=localValidationMessage(error instanceof Error?error.message:String(error));
    const report={...d,...(reason?{summary:reason}:{}),operationId:operation.id,feature:operation.feature,page:operation.page,...(operation.taskId?{taskId:operation.taskId}:{}),...(operation.documentId!==undefined?{documentId:operation.documentId}:{}),durationMs:Date.now()-operation.startedAt};
    if(feedback.fail(operation,report)){el('status').textContent=report.summary;el('status').style.display='none';el('diagnostic-details').value=JSON.stringify(report,null,2);el('diagnostic-summary').textContent=report.summary;if(!taskActive)el('task-progress').style.display='none';}
    console.error(Object.assign(new Error(report.summary),{code:d.code,stage:d.stage,operationId:operation.id}));await store.trace(`operation.error.${d.code}`,operation.taskId,{operationId:operation.id,documentId:operation.documentId,durationMs:Date.now()-operation.startedAt});
  }finally{feedback.finish(operation);activeOperation=feedback.active;renderDiagnostic();queueResultNavigation();}
}
function currentDiagnostic(){const report=feedback.forPage(views.current,{mode:el('mode').value,documentId:activeDocumentId()});return views.current==='results'&&report?.operation.taskId&&['apply','load-history'].includes(report.operation.feature)&&report.operation.taskId!==candidates[Number(el('candidate-select').value)]?.job.id?undefined:report;}
function renderDiagnostic():void {
  const current=currentDiagnostic(),box=el('diagnostic-box');box.style.display=current?'block':'none';
  if(!current)return;
  const {operation,diagnostic:d}=current,page=operation.page==='history'?el('history-layout').parentElement:el(`view-${operation.page}`);
  if(box.parentElement!==page)page.insertBefore(box,page.firstChild);
  el('diagnostic-title').textContent=d.title;el('diagnostic-summary').textContent=d.summary;el('diagnostic-action').textContent=d.action;
  el('diagnostic-details').value=JSON.stringify(d,null,2);el('diagnostic-details').style.display='none';
  const primary=el('diagnostic-primary'),selection=d.code==='selection-required',source=['source-changed','source-unavailable','empty-range'].includes(d.code)||d.code==='unknown'&&isSourceCaptureDiagnostic(operation,d);
  const color=(d.code==='source-profile'||operation.feature==='recover-color')&&operation.documentId!==undefined?colorRecoveryAction(operation.documentId):undefined;
  primary.style.display=selection||source||color?'block':'none';primary.disabled=busy;
  if(color)primary.setAttribute('data-color-recovery',operation.id);
  else primary.removeAttribute('data-color-recovery');
  primary.textContent=t(color==='retry'?'重试读取已恢复的色彩副本':color==='create'?'创建已恢复色彩副本并重新读取':d.stage==='apply'&&source&&(operation.documentId!==activeDocumentId()||operation.mode!==el('mode').value)?'返回创建检查来源':selection&&canRestoreSelection()?'恢复上次选区并重新读取':operation.mode==='relight'?'打开布光工作台':'预览选区');
  if(color)el('diagnostic-action').textContent=t(color==='retry'?'已恢复的色彩副本已保留；重试只读取该副本，不会创建另一份或自动生成。':'仅能恢复本次会话已验证的撤销状态。此操作创建新的色彩副本并重新读取，保留旧来源和候选；不会自动生成。');
  box.setAttribute('data-operation-id',operation.id);
  if(box.getAttribute('data-copy-operation')!==operation.id){box.setAttribute('data-copy-operation',operation.id);el('diagnostic-copy-status').textContent='';el('export-error-report').style.display='none';}
}
function canRestoreSelection():boolean {
  const range=lastSelection?.range,doc=ps.app.documents.length?ps.app.activeDocument:undefined;
  return !!range&&lastSelection?.workspace===workspace&&lastSelection.mode===el('mode').value&&range.documentId===doc?.id&&range.width===doc.width&&range.height===doc.height&&range.mode===doc.mode&&range.depth===doc.bitsPerChannel;
}
async function copyDiagnostic():Promise<void> {
  const report=currentDiagnostic();if(!report)return;
  const id=report.operation.id,text=JSON.stringify(report.diagnostic,null,2);
  try{
    if(typeof (navigator.clipboard as any)?.setContent!=='function')throw new DiagnosticError('clipboard-failed','connection','当前宿主没有可用的剪贴板写入接口');
    await (navigator.clipboard as any).setContent({'text/plain':text});
    if(currentDiagnostic()?.operation.id!==id)return;
    el('diagnostic-copy-status').textContent=t('已复制');el('export-error-report').style.display='none';
    if(copyTimer)clearTimeout(copyTimer);copyTimer=setTimeout(()=>{copyTimer=undefined;if(el('diagnostic-box').getAttribute('data-copy-operation')===id)el('diagnostic-copy-status').textContent='';},1800);
  }catch{
    if(currentDiagnostic()?.operation.id!==id)return;
    el('diagnostic-copy-status').textContent=t('复制失败：请检查剪贴板权限，或导出诊断报告。');el('export-error-report').style.display='block';
  }
}
function activeDocumentId():number|undefined{return ps.app.documents.length?ps.app.activeDocument?.id:undefined;}
function captureSizes(snapshot:Pick<Snapshot,'width'|'height'|'bounds'|'captureGeometry'>,model?:{width:number;height:number},output?:{width:number;height:number}):CaptureSizeDetails|undefined {
  const geometry=snapshot.captureGeometry;if(!geometry)return;
  return {documentWidth:snapshot.width,documentHeight:snapshot.height,nativeWidth:snapshot.bounds.right-snapshot.bounds.left,nativeHeight:snapshot.bounds.bottom-snapshot.bounds.top,workWidth:geometry.width,workHeight:geometry.height,...(model?{modelWidth:model.width,modelHeight:model.height}:{}),...(output?{outputWidth:output.width,outputHeight:output.height}:{})};
}
function clearCapturePreview(){invalidateBlendProcessing();capture=undefined;el('selection-previews').style.display='none';for(const id of ['source-preview','mask-preview'])el(id).removeAttribute('src');}
async function captureArea(expectedDocumentId=activeDocumentId(),showPreview=true,captureProtection=protection,beforeCommit?:(captured:Capture)=>void){
  const operation=activeOperation;
  return withSourceCapture(()=>withImagePixels(async()=>{
  const mode=el('mode').value,capturedWorkspace=workspace,context=assetContext();
  clearCapturePreview();
  const captured=await adapter.capture(Number(el('margin').value)/100,captureProtection,expectedDocumentId,outputDepth(),{analysisResolution:Number(el('resolution').value),retainedBytes:retainedImageBytes(true),...(context?{purpose:'selection-asset' as const,preserveNativeDepth:true}:{}),...(isBackgroundMode(mode)?{context:'document' as const,selection:'subject-background' as const}:mode==='blend'?{context:'document' as const,selection:'edit' as const,purpose:'blend-analysis' as const,preserveNativeDepth:true}:{})},beforeCommit);
  const {snapshot:s,image}=captured;
  if(capturedWorkspace!=='t2i'&&mode!=='relight'){const raw=captured.subjectMask??captured.selectionMask;lastSelection={workspace:capturedWorkspace,mode,range:{documentId:s.documentId,sessionId:s.sessionId,width:s.width,height:s.height,mode:s.mode,depth:s.depth,bounds:{...s.bounds},mask:s.captureGeometry?raw:raw.slice()}};}
  if(captureProtection&&captured.workingCopyOf===captureProtection.documentId)captureProtection={...captureProtection,documentId:s.documentId};
  if(workspace!==capturedWorkspace||el('mode').value!==mode){inputUi();return;}
  capture=captured;
  if(operation)operation.documentId=s.documentId;
  protection=captureProtection;
  const mapping=makeMapping(s.bounds,Number(el('resolution').value)),sizes=captureSizes(s,mapping)??(context?{documentWidth:s.width,documentHeight:s.height,nativeWidth:s.bounds.right-s.bounds.left,nativeHeight:s.bounds.bottom-s.bounds.top,workWidth:image.width,workHeight:image.height,modelWidth:mapping.width,modelHeight:mapping.height}:undefined);
  const edit=s.captureGeometry?downsampleSnapshotMask(s,image.width,image.height):s.mask,protectedMask=s.captureGeometry?resampleGray(captured.protectionMask,s.bounds.right-s.bounds.left,s.bounds.bottom-s.bounds.top,image.width,image.height):captured.protectionMask;
  sourceCaption.show({documentId:s.documentId,width:image.width,height:image.height,protectedArea:!!protection,profile:s.profile,colorReason:s.colorReason,sizes});
  el('source-preview').src=await preview(context?editModelInput(mode,resize(image,mapping.width,mapping.height)):image);
  el('mask-preview').src=await preview(context?maskRaster(resampleGray(s.mask,s.bounds.right-s.bounds.left,s.bounds.bottom-s.bounds.top,mapping.width,mapping.height),mapping.width,mapping.height):rangePreview(image,edit,protectedMask));
  if(showPreview&&workspace===capturedWorkspace&&el('mode').value===mode)el('selection-previews').style.display='flex';
  if(operation&&activeDocumentId()===s.documentId)feedback.resolveCapture(operation);
  inputUi();
  }));
}
async function restoreSelectionArea(){
  if(busy)return;
  const saved=lastSelection;
  if(!saved||saved.workspace!==workspace||saved.mode!==el('mode').value||workspace==='t2i'||saved.mode==='relight'||!assetContext()&&el('destination').value!=='selection')throw new Error(t('没有可用于当前模式的本次会话选区，请重新圈选后预览'));
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
function retainedImageBytes(includeRelight=false):number {
  const seen=new Set<ArrayBufferLike>();let bytes=0;
  const count=(value?:ArrayBufferView)=>{if(value&&!seen.has(value.buffer)){seen.add(value.buffer);bytes+=value.buffer.byteLength;}};
  if(capture){count(capture.image.rgba);count(capture.snapshot.mask);count(capture.selectionMask);count(capture.protectionMask);count(capture.subjectMask);}
  if(includeRelight&&relightSession){const c=relightSession.sourceCapture;count(c.image.rgba);count(c.snapshot.mask);count(c.selectionMask);count(c.protectionMask);count(c.subjectMask);}
  count(reference?.rgba);count(lastSelection?.range.mask);
  if(includeRelight||pendingColorCapture)count(protection?.mask);
  for(const c of candidates){count(c.image.rgba);count(c.bytes);count(c.snapshot?.mask);bytes+=c.preview.length*2;}
  bytes+=candidatePreview.retainedBytes;
  for(const id of ['source-preview','mask-preview','detail-preview','history-preview'])bytes+=(el(id).getAttribute('src')?.length??0)*2;
  return bytes;
}
function preflightLightingSource(captured:Capture):void {
  const s=captured.snapshot;
  if(s.mode!==ps.constants.DocumentMode.RGB||!/^sRGB(?: IEC61966-2\.1)?$/i.test(s.profile.trim()))throw new DiagnosticError('unsupported','capture',t('实验光影层目前需要已标记的 sRGB RGB 8/16 位原文档；其他颜色空间可明确选择整图重绘'));
  const mask=downsampleSnapshotMask(s,captured.image.width,captured.image.height),max=rasterDepth(captured.image)===16?65535:255;
  if(mask.some((value,p)=>value>0&&captured.image.rgba[p*4+3]!==max))throw new DiagnosticError('unsupported','capture',t('光影层暂不支持作用范围内的透明/半透明来源；请缩小到不透明区域，或明确使用整图重绘并检查透明度'));
}
async function captureRelight(expectedDocumentId=activeDocumentId(),scope:RelightScope=relightScope(),kind:RelightOutputKind='lighting-layers',beforeCommit?:(capture:Capture)=>void,captureProtection=protection):Promise<Capture>{
  return withSourceCapture(()=>withImagePixels(async()=>{
  const previous=activeDocumentId();
  if(expectedDocumentId===undefined)throw new Error(t('请先打开 Photoshop 文档并建立选区'));
  const target=Array.from(ps.app.documents as any[]).find(d=>d.id===expectedDocumentId);
  if(!target)throw new Error(t('来源文档已关闭，候选已保留'));
  if(kind==='lighting-layers')planRelightMemory(target.width,target.height,target.bitsPerChannel===ps.constants.BitsPerChannelType.SIXTEEN?16:8,undefined,retainedImageBytes());
  if(previous!==expectedDocumentId)await ps.core.executeAsModal(async()=>{ps.app.activeDocument=target;},{commandName:'PS-AI relight source'});
  try {
    const start=Date.now(),captured=await adapter.capture(Number(el('margin').value)/100,captureProtection,expectedDocumentId,outputDepth(),{selection:scope==='document'?'document':'edit',preserveNativeDepth:true,analysisResolution:Number(el('resolution').value),retainedBytes:retainedImageBytes(kind!=='lighting-layers'),...(kind==='lighting-layers'?{purpose:'relight-analysis' as const}:{})},beforeCommit);
    if(captureProtection&&captured.workingCopyOf===captureProtection.documentId)captureProtection={...captureProtection,documentId:captured.snapshot.documentId};
    protection=captureProtection;
    await store.trace('relight.capture.complete',undefined,{documentId:captured.snapshot.documentId,width:captured.snapshot.width,height:captured.snapshot.height,analysisWidth:captured.image.width,analysisHeight:captured.image.height,depth:rasterDepth(captured.image),durationMs:Date.now()-start});
    return captured;
  }finally{const prior=Array.from(ps.app.documents as any[]).find(d=>d.id===previous);if(prior&&previous!==expectedDocumentId)await ps.core.executeAsModal(async()=>{ps.app.activeDocument=prior;},{commandName:'PS-AI restore document'});}
  }));
}
function relightResults():RelightResult[]{
  return candidates.flatMap(c=>{const metadata=c.job.relight as RelightTaskMetadata|undefined;if(!metadata||metadata.schemaVersion!==1||!relightSession?.ownsSnapshot(metadata.scene?.source?.snapshotId))return [];return [{jobId:c.job.id,fingerprint:metadata.fingerprint,sourceSnapshotId:metadata.scene.source.snapshotId,image:c.image,warning:c.warning,outputKind:c.outputKind,lightingState:c.lightingState,lightingFailure:c.lightingFailure,localExtraction:metadata.localExtraction}];});
}
/** Only a successful, still-owned local extraction may replace this candidate. */
async function reextractLightingCandidate(jobId:string,value:RelightExtractionSettings,owns:()=>boolean):Promise<void>{
  if(busy||historyRecords.some(blocksGeneration)||!owns())return;
  const extraction=validateRelightExtractionSettings(value),prior=candidateById(jobId);
  if(prior.outputKind!=='lighting-layers')return;
  lock(true);
  try{await withImagePixels(async()=>{
    const current=()=>owns()&&candidates.includes(prior);
    if(!current())return;
    const record:JobRecord={...prior.job,relight:{...(prior.job.relight as RelightTaskMetadata),localExtraction:extraction}};
    const raw=await store.readBinary(historyOutputName(record));if(!current())return;
    const prepared=await prepareCandidate(record,raw,name=>store.readBinary(name),retainedImageBytes(true));if(!current())return;
    if(prepared.lightingState!=='composite')throw prepared.lightingFailure??new DiagnosticError('relight-extraction','lighting-extraction',prepared.warning??t('本地光影提取未完成；原始 AI 参考图已保留，请检查参考图和来源的作用范围。'));
    const bytes=encodePng(prepared.image),url=await preview(prepared.image);if(!current())return;
    // Persist only metadata after a complete preview exists. Raw output/source,
    // masks and the frozen source/fingerprint remain owned by the original UUID.
    await store.save(record);
    // The save is the commit point: close/selection changes while it is in
    // progress cannot undo persisted metadata. Keep the cache consistent, but
    // publish no stale status or selection into the current workbench.
    const stillOwned=current(),mainSelection=candidates[Number(el('candidate-select').value)]?.job.id;
    const next:Candidate={...prepared,job:record,bytes,preview:url,snapshot:prepared.snapshot?.captureGeometry?{...prepared.snapshot,mask:new Uint8Array()}:prepared.snapshot};
    const index=candidates.indexOf(prior);if(index<0)return;candidates[index]=next;
    historyPreview.invalidate();const historyIndex=historyRecords.findIndex(item=>item.id===jobId);if(historyIndex>=0)historyRecords[historyIndex]=record;
    historyTable.setRecords(historyRecords);historyUi();
    await renderCandidates(mainSelection);
    if(stillOwned)relightWorkbench?.refreshAvailability();
  });}finally{lock(false);}
}
const reportedRelightErrors=new WeakSet<object>();
async function relightOperation(feature:string,stage:Stage,action:()=>Promise<void>):Promise<void>{
  let failed=false,failure:unknown;
  await guarded(async()=>{try{await action();}catch(error){failed=true;failure=error;if(error&&typeof error==='object')reportedRelightErrors.add(error);throw error;}},{page:'create',feature,stage});
  if(failed)throw failure;
}
function relightSourceState(session:RelightSession):'current'|'changed'|'closed'|'rebind-required'{
  const s=session.sourceCapture.snapshot,doc=Array.from(ps.app.documents as any[]).find(d=>d.id===s.documentId);
  if(!doc)return 'closed';
  if(activeDocumentId()!==s.documentId||doc.width!==s.width||doc.height!==s.height||doc.mode!==s.mode||doc.bitsPerChannel!==s.depth||doc.colorProfileName!==s.profile||relightScope()!==session.scope||Number(el('margin').value)/100!==relightMargin)return 'rebind-required';
  return adapter.sourceAvailability(s,true)==='current'?'current':'changed';
}
function colorRecoveryAction(documentId:number,session?:RelightSession):'create'|'retry'|undefined {
  const retry=pendingColorCapture;
  if(retry&&retry.workspace===workspace&&retry.mode===el('mode').value&&(!session?retry.documentId===documentId:retry.session===session&&(retry.sourceDocumentId===documentId||retry.documentId===documentId)))return adapter.colorRecoveryAvailability(retry.documentId)==='not-needed'?'retry':undefined;
  return adapter.colorRecoveryAvailability(documentId)==='available'?'create':undefined;
}
async function recoverSourceColor(documentId:number,session?:RelightSession):Promise<void> {
  const operation=activeOperation;
  if(operation)operation.documentId=documentId;
  await configure(async()=>{
    const action=colorRecoveryAction(documentId,session);
    if(!action)throw new DiagnosticError('source-profile','capture',t('当前来源没有可验证的会话色彩恢复记录；请在副本中指定正确配置文件'));
    if(action==='create'){
      const old=Array.from(ps.app.documents as any[]).find(doc=>doc.id===documentId),savedProtection=protection;
      if(savedProtection&&(!old||savedProtection.sessionId!==adapter.sessionId||savedProtection.documentId!==documentId||savedProtection.width!==old.width||savedProtection.height!==old.height))throw new DiagnosticError('source-changed','capture',t('保护区来源文档已改变，请重新指定'));
      const recovered=await adapter.createRecoveredColorCopy(documentId);
      pendingColorCapture={sourceDocumentId:documentId,documentId:recovered.documentId,colorReason:recovered.colorReason,workspace,mode:el('mode').value,geometry:{width:old.width,height:old.height,mode:old.mode,depth:old.bitsPerChannel},session,...(session||el('mode').value==='relight'?{scope:relightScope()}:{})};
    }
    const retry=pendingColorCapture!;
    // The diagnostic follows the actual read target after creation, while old
    // candidates and the old workbench source keep their original identities.
    if(operation)operation.documentId=retry.documentId;
    const priorProtection=protection;
    try {
      const target=Array.from(ps.app.documents as any[]).find(doc=>doc.id===retry.documentId);
      if(!target)throw new DiagnosticError('source-unavailable','capture',t('来源文档已关闭，候选已保留'));
      if(adapter.colorRecoveryAvailability(target.id)!=='not-needed')throw new DiagnosticError('source-profile','capture',t('当前来源没有可验证的会话色彩恢复记录；请在副本中指定正确配置文件'));
      const geometry=retry.geometry;
      if(target.width!==geometry.width||target.height!==geometry.height||target.mode!==geometry.mode||target.bitsPerChannel!==geometry.depth)throw new DiagnosticError('source-changed','capture',t('已恢复副本的尺寸、模式或位深已改变；请检查副本后明确重新读取来源。'));
      if(retry.scope!==undefined&&relightScope()!==retry.scope)throw new DiagnosticError('source-changed','capture',t('布光范围已改变，请重新读取原图；原有布光配置已保留'));
      // Protection is a current user choice, not part of the retained read
      // intent. A later clear/replacement must survive this exact-copy retry.
      if(protection&&(protection.sessionId!==adapter.sessionId||![retry.sourceDocumentId,retry.documentId].includes(protection.documentId)||protection.width!==geometry.width||protection.height!==geometry.height))throw new DiagnosticError('source-changed','capture',t('保护区来源文档已改变，请重新指定'));
      const captureProtection=protection?.documentId===retry.sourceDocumentId?{...protection,documentId:retry.documentId}:protection;
      if(activeDocumentId()!==target.id)await ps.core.executeAsModal(async()=>{ps.app.activeDocument=target;},{commandName:'PS-AI color recovered source'});
      const identifyCopy=(captured:Capture)=>{
        // A retry may follow a deliberate profile conversion in Photoshop.
        // Its current ICC remains authoritative, including in source labels.
        if(/^sRGB(?: IEC61966-2\.1)?$/i.test(captured.snapshot.profile.trim())){captured.workingCopyOf=retry.sourceDocumentId;captured.snapshot.colorReason=retry.colorReason;}
      };
      if(retry.mode==='relight'){
        let commit:((historyId?:number)=>void)|undefined,staged:ReturnType<typeof RelightSession.stageCreation>|undefined;
        const scope=retry.scope!,fresh=await captureRelight(retry.documentId,scope,session?.outputKind??'lighting-layers',captured=>{
          identifyCopy(captured);
          if(session)commit=session.stageRebind(captured,uuid(),scope);
          else staged=RelightSession.stageCreation(captured,uuid(),uuid(),scope);
        },captureProtection);
        if(session){commit!(fresh.snapshot.historyId);relightMargin=Number(el('margin').value)/100;}
        else publishRelightSession(staged!.commit(fresh.snapshot.historyId));
      }else await captureArea(retry.documentId,true,captureProtection,identifyCopy);
    }catch(error){
      protection=priorProtection;
      throw new DiagnosticError(diagnostic(error,'capture').code,'capture',t('已恢复的色彩副本（文档 {0}）已保留，但读取未完成；请重试读取。原因：{1}',retry.documentId,errorText(error instanceof Error?error.message:String(error))));
    }
    pendingColorCapture=undefined;
    if(operation)feedback.resolveCapture(operation);
    status(t('已创建并读取恢复色彩的副本；请检查新来源后明确生成。旧候选仍绑定原来源，可继续导出。'));
  });
}
async function rereadRelight(session:RelightSession,explicit=true):Promise<void>{
  const operation=activeOperation;
  await configure(async()=>{
    const bound=session.sourceCapture.snapshot,targetId=explicit?activeDocumentId():bound.documentId;
    if(!explicit&&relightSourceState(session)!=='changed')return;
    const scope=explicit?relightScope():session.scope;let commit:((historyId?:number)=>void)|undefined;
    const fresh=await captureRelight(targetId,scope,session.outputKind,captured=>{
      // A fresh native read is still required on every explicit open. Reuse an
      // identical binding so ordinary reopening cannot exhaust snapshot IDs.
      let unchanged=scope===session.scope;
      if(unchanged)try{session.assertCaptureMatches(captured);}catch{unchanged=false;}
      commit=unchanged?()=>{}:session.stageRebind(captured,uuid(),scope);
    });
    if(!explicit&&(JSON.stringify(fresh.snapshot.bounds)!==JSON.stringify(bound.bounds)||fresh.selectionMask.length!==session.sourceCapture.selectionMask.length||fresh.selectionMask.some((v,i)=>v!==session.sourceCapture.selectionMask[i])||fresh.protectionMask.some((v,i)=>v!==session.sourceCapture.protectionMask[i])))throw new DiagnosticError('source-changed','capture',t('来源范围已改变，请明确重新读取当前文档；布光配置已保留'));
    commit!(fresh.snapshot.historyId);relightMargin=Number(el('margin').value)/100;
    if(operation){operation.documentId=fresh.snapshot.documentId;feedback.resolveCapture(operation);}
  });
}
function candidateById(id:string):Candidate {const candidate=candidates.find(c=>c.job.id===id);if(!candidate)throw new Error(t('此 AI 结果已离开内存，请从历史重新读取后应用'));return candidate;}
async function exportCandidate(id:string):Promise<void>{if(busy)throw new Error(t('已有任务正在进行，请等待完成后再生成或应用；可以继续编辑布光'));await configure(async()=>{const c=candidateById(id),file=await uxp.storage.localFileSystem.getFileForSaving(`ps-ai-${c.job.id.slice(0,8)}.png`,{types:['png']});if(file)await file.write(new Uint8Array(c.bytes).buffer,{format:uxp.storage.formats.binary});});}
export async function openRelightWorkbench(reuse?:RelightScene,description?:string):Promise<void>{
  if(typeof el('relight-dialog')?.uxpShowModal!=='function')throw new Error(t('当前宿主无法打开布光对话框，请使用 Photoshop 27+ 并重新加载开发插件'));
  // Reopening during a running operation preserves its frozen request. Native
  // callbacks reopen the dialog themselves without calling this explicit read.
  if(relightWorkbench&&relightSession&&!reuse&&description===undefined&&busy&&!relightOpenBlocked()){relightWorkbench.show();return;}
  if(busy||relightOpenBlocked())throw new Error(t('请等待当前任务结束后重新读取原图'));
  const targetId=activeDocumentId(),operation=activeOperation;
  if(relightWorkbench&&relightSession&&!reuse&&description===undefined){
    try{await rereadRelight(relightSession);relightWorkbench.sourceRefreshed();relightWorkbench.show();}
    catch(error){relightWorkbench.sourceCaptureFailed(error instanceof DiagnosticError&&error.code==='selection-required'?diagnostic(error,'capture').action:error instanceof Error?error.message:String(error));throw error;}
    return;
  }
  lock(true);
  try {
    if(activeOperation)activeOperation.stage='capture';const scope=relightScope();let staged:ReturnType<typeof RelightSession.stageCreation>|undefined;
    const fresh=await captureRelight(targetId,scope,'lighting-layers',captured=>{
      staged=RelightSession.stageCreation(captured,uuid(),uuid(),scope);
      if(reuse)staged.session.restore(reuse,true);
      if(description!==undefined)staged.session.editor.updateScene({supplement:description});
    });
    publishRelightSession(staged!.commit(fresh.snapshot.historyId));
    if(operation){operation.documentId=fresh.snapshot.documentId;feedback.resolveCapture(operation);}
  }finally{lock(false);}
}
function publishRelightSession(session:RelightSession):void {
    if(pendingColorCapture?.session&&pendingColorCapture.session!==session)pendingColorCapture=undefined;
    relightSession=session;relightMargin=Number(el('margin').value)/100;
    relightWorkbench=new RelightWorkbench(el('relight-dialog'),session,{
      uuid,save:scene=>relightDrafts.save(scene),loadDraft:()=>relightDrafts.load(),busy:()=>busy,reportError:error=>{if(!reportedRelightErrors.has(error))void guarded(async()=>{throw error;},{page:'create',feature:'relight',stage:'capture'});},
      sourceState:()=>relightSourceState(session),observeSource:invalidate=>observeRelightSource(ps.action,()=>{if(relightSourceState(session)!=='current')invalidate();},()=>void store.trace('relight.source-notifications.unavailable')),
      prepare:frozen=>relightOperation('relight-prepare','capture',()=>configure(async()=>{if(relightScope()!==frozen.scope)throw new Error(t('布光范围已改变，请重新读取原图；原有布光配置已保留'));if(Number(el('margin').value)/100!==relightMargin)throw new Error(t('范围参数已改变，请重新读取原图'));adapter.assertSourceCurrent(frozen.capture.snapshot);const fresh=await captureRelight(frozen.capture.snapshot.documentId,frozen.scope,frozen.outputKind);session.assertCaptureMatches(fresh);if(frozen.outputKind==='lighting-layers')preflightLightingSource(fresh);})),
      generate:(frozen,onJob)=>relightOperation('generate','inference',()=>generate(frozen,onJob)),cancel:async()=>{stopBatch=true;},pendingTasks:()=>historyRecords.filter(blocksGeneration).length,openPendingTasks:()=>showPending(),
      reread:options=>relightOperation('relight-reread','capture',()=>rereadRelight(session,options?.explicit!==false)),
      colorRecovery:()=>colorRecoveryAction(session.sourceCapture.snapshot.documentId,session),recoverColor:()=>relightOperation('recover-color','capture',()=>recoverSourceColor(session.sourceCapture.snapshot.documentId,session)),
      resultSourceState:id=>candidateApplicationMode(candidates.find(c=>c.job.id===id))==='unavailable'?'changed':'current',
      apply:id=>relightOperation('apply','apply',()=>apply(id)),inspectResult:id=>relightOperation('apply','apply',()=>apply(id,true)),export:exportCandidate,results:relightResults,
      reextract:reextractLightingCandidate,
    });
    relightWorkbench.show();
}
function historyUi(){
  historyTable.refresh();
  const pending=historyRecords.filter(blocksGeneration),record=historyRecords.find(r=>r.id===historyTable.selectedId);
  const narrow=(el('panel-shell').clientWidth||window.innerWidth||1000)<=700;
  if(!record)historyDetail=false;
  el('history-layout').setAttribute('data-history-view',historyDetail?'detail':'list');
  el('history-detail-pane').style.display=record?'':'none';
  el('pending-notice').style.display=pending.length?'block':'none';el('pending-summary').textContent=t('{0} 个未确认任务；请按原 ID 处理后再生成',pending.length);el('open-pending').disabled=busy;
  el('history-id').value=record?.id??'';
  const source=record?.snapshot as Snapshot|undefined;
  el('history-details').textContent=record?[t('任务类型：{0}',historyTaskType(record)),t('状态：{0}',`${historyState(record)} (${record.state})`),t('后端：{0} · {1}',record.backend==='gateway'?t('平台适配服务'):'ComfyUI',String(record.baseUrl??'http://localhost:8188')),t('时间：{0}',historyDate(record).join(' ')),t('来源文档：{0}{1}',source?.documentId??t('未保存'),` · ${historySource(record)}`),...(record.tracking==='detached'?[t('本地已停止跟踪；远端状态仍未知，可按原 ID 恢复')]:[])].join('\n'):t('请选择历史记录');
  if(record&&source){const sizes=captureSizes(source,(record.params as any)?.modelSize);if(sizes)el('history-details').textContent+='\n'+captureSizeSummary(sizes);}
  if(source?.colorReason==='assumed-srgb')el('history-details').textContent+='\n'+t('来源色彩：假定 sRGB；颜色可能有偏差。');
  el('history-prompt').value=record?historyPrompt(record):'';
  if(lastHistoryFocus!==record?.id){el('history-detail-pane').scrollTop=0;lastHistoryFocus=record?.id;}
  if(el('view-history').style.display!=='none'&&(!narrow||historyDetail))historyPreview.show(record);
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
  el('clear-history').textContent=t('清除勾选历史（{0}）',count);el('clear-history').disabled=busy||!count;el('clear-history').style.display=count?'block':'none';
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
  workflowUi();
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
    historyDetail=true;views.show('history');pendingDetailReveal=true;el('history-detail-pane').scrollTop=0;historyUi();
  }finally{lock(false);}
}
function selectionSignature(ids:readonly string[],records:readonly JobRecord[]):string {return JSON.stringify(ids.map(id=>records.find(record=>record.id===id)??null));}
function clearPendingDiagnostic():void {
  if(historyRecords.some(blocksGeneration))return;
  feedback.clearCodes(['pending-task','pending-backend']);renderDiagnostic();
}
async function reconcileClearedHistory(ids:readonly string[]):Promise<void> {
  const removed=new Set(ids),previous=candidates[Number(el('candidate-select').value)]?.job.id;
  // Durable tombstones are authoritative even if a later repaint or reread fails.
  clearConfirmation=undefined;detachAcknowledgedId=undefined;
  historyRecords=historyRecords.filter(record=>!removed.has(record.id));
  historyTable.setRecords(historyRecords);clearPendingDiagnostic();
  candidates=candidates.filter(candidate=>!removed.has(candidate.job.id));
  if(current&&removed.has(current.id))current=undefined;
  if(applied&&removed.has(applied.jobId))applied=undefined;
  candidatePreview.retain(candidates.map(candidate=>candidate.image));
  historyPreview.invalidate();el('detail-preview').removeAttribute('src');
  historyUi();candidateUi();relightWorkbench?.invalidateResults(ids);
  await renderCandidates(previous);
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
    await reconcileClearedHistory(result.removedIds);
    await refreshHistory();clearPendingDiagnostic();
  }finally{clearConfirmation=undefined;lock(false);}
}
async function retryHistoryCleanup():Promise<void> {
  if(busy||!cleanupStatus||!cleanupStatus.pendingFiles&&!cleanupStatus.metadataPending)return;
  lock(true);clearConfirmation=undefined;detachAcknowledgedId=undefined;historyPreview.invalidate();
  try{cleanupStatus=await store.retryHistoryCleanup();await reconcileClearedHistory(cleanupStatus.removedIds);await refreshHistory();clearPendingDiagnostic();}
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
  return withImagePixels(async()=>{
  await store.trace('candidate.preview',record.id);
  const prepared=await prepareCandidate(record,bytes,name=>store.readBinary(name),retainedImageBytes(true)),{image,snapshot}=prepared;
  // All exported candidates, including standalone assets, declare sRGB explicitly.
  bytes=encodePng(image);
  const c:Candidate={...prepared,job:record,bytes,preview:await preview(image),snapshot:snapshot?.captureGeometry?{...snapshot,mask:new Uint8Array()}:snapshot};
  const previous=candidates.findIndex(candidate=>candidate.job.id===record.id);if(previous>=0)candidates.splice(previous,1);
  if(candidates.length===4)candidates.shift();candidates.push(c);
  await renderCandidates(record.id);
  if(c.lightingState==='reference-only'){const reason=diagnostic(c.lightingFailure,'lighting-extraction').reason;await store.trace(`${record.blend?'blend':'relight'}.extraction.failed.${reason??'local-validation'}`,record.id);}
  await store.trace(c.lightingState==='reference-only'?'candidate.reference':'candidate.ready',record.id);
  relightWorkbench?.notifyResult(record.id);
  return c;
  });
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
  if(blendSelectedId!==c.job.id){invalidateBlendProcessing();blendSelectedId=c.job.id;blendView='composite';blendStatus();}
  const request=++blendViewRevision,view=blendView;
  candidateUi();renderDiagnostic();frame.setAttribute('aria-busy','true');img.style.visibility='hidden';
  let image=c.image;
  if(c.job.blend&&view!=='composite'){
    image=await withImagePixels(async()=>view==='source'?loadCandidateSource(c.job,name=>store.readBinary(name)):decodeModelPng(await store.readBinary(historyOutputName(c.job)),String(c.job.template??'')));
    if(request!==blendViewRevision||candidates[Number(el('candidate-select').value)]!==c||blendView!==view)return;
    if(image.width!==c.image.width||image.height!==c.image.height)image=resize(image,c.image.width,c.image.height);
  }
  const display=(url:string)=>{
    if(request!==blendViewRevision)return;
    if(img.getAttribute('src')!==url)img.src=url;
    img.style.width=actualSize?`${image.width}px`:'100%';img.style.height=actualSize?`${image.height}px`:'100%';
    img.alt=el('candidate-caption').textContent;img.style.visibility='visible';frame.setAttribute('aria-busy','false');
  };
  // Source/reference rasters are short-lived display copies. Caching them by
  // object identity would retain additional full raster buffers between views.
  if(c.job.blend&&view!=='composite')display(await preview(image,actualSize?Math.max(image.width,image.height):1280));
  else await candidatePreview.show(image,actualSize,display);
}
function invalidateBlendProcessing():void {
  const pending=blendPending;
  // Saved candidate display ownership changes in showSelected. Changing current
  // capture parameters only cancels candidate processing, not its saved preview.
  blendRevision++;if(blendTimer)clearTimeout(blendTimer);blendTimer=undefined;blendPending=false;blendDraft=undefined;
  if(pending)blendStatus();
  candidateUi();
}
function requestBlendProcessing():void {
  if(busy||blendCommitting)return;
  const prior=candidates[Number(el('candidate-select').value)];if(!prior?.job.blend)return;
  try{
    const outputKind=el('blend-result-output').value as RelightOutputKind;
    const fidelity=Number(el('blend-fidelity').value),detailProtection=Number(el('blend-detail-protection').value);
    const extraction=validateRelightExtractionSettings({fidelity:fidelity/100,detailProtection:detailProtection/100});
    withBlendProcessing(validateBlendTaskMetadata(prior.job.blend,prior.job.id),outputKind,extraction);
    blendDraft={outputKind,extraction};blendPending=true;const revision=++blendRevision;
    if(blendTimer)clearTimeout(blendTimer);candidateUi();blendStatus('正在本地更新光影层…');
    blendTimer=setTimeout(()=>{blendTimer=undefined;void processBlendCandidate(prior,revision,outputKind,extraction);},120);
  }catch(error){blendStatus(error instanceof Error?error.message:String(error));candidateUi();}
}
async function processBlendCandidate(prior:Candidate,revision:number,outputKind:RelightOutputKind,extraction:RelightExtractionSettings):Promise<void>{
  const owns=()=>revision===blendRevision&&candidates[Number(el('candidate-select').value)]===prior&&!busy;
  try{await withImagePixels(async()=>{
    if(!owns())return;
    const record:JobRecord={...prior.job,blend:withBlendProcessing(validateBlendTaskMetadata(prior.job.blend,prior.job.id),outputKind,extraction)};
    const raw=await store.readBinary(historyOutputName(record));if(!owns())return;
    const prepared=await prepareCandidate(record,raw,name=>store.readBinary(name),retainedImageBytes(true));if(!owns())return;
    if(outputKind==='lighting-layers'&&prepared.lightingState!=='composite')throw prepared.lightingFailure??new Error(prepared.warning??t('本地光影提取未完成；原始 AI 参考图已保留，请检查参考图和来源的作用范围。'));
    if(record.state==='output-error'){record.state='ready';delete record.detail;}
    const bytes=encodePng(prepared.image),url=await preview(prepared.image);if(!owns())return;
    // The narrow commit lock makes the last ownership check and persisted choice
    // one user action. Navigation and new gestures remain available while deriving.
    blendCommitting=true;lock(true);
    try{
      await store.save(record);
      const index=candidates.indexOf(prior);if(index<0)return;
      candidates[index]={...prepared,job:record,bytes,preview:url,snapshot:prepared.snapshot?.captureGeometry?{...prepared.snapshot,mask:new Uint8Array()}:prepared.snapshot};
      blendDraft=undefined;blendPending=false;blendView='composite';
      historyPreview.invalidate();const historyIndex=historyRecords.findIndex(item=>item.id===record.id);if(historyIndex>=0)historyRecords[historyIndex]=record;
      historyTable.setRecords(historyRecords);historyUi();await renderCandidates(record.id);
      blendStatus('已更新此候选；未重新生成。');
    }finally{blendCommitting=false;lock(false);}
  });}catch(error){if(revision===blendRevision)blendStatus('本地调整失败，已保留原候选和参数：{0}',error instanceof Error?error.message:String(error));}
  finally{if(revision===blendRevision){blendPending=false;blendDraft=undefined;candidateUi();}}
}
function queueResultNavigation():void {
  if(navigationTimer)return;
  navigationTimer=setTimeout(()=>{navigationTimer=undefined;void navigateCompletedResult();},0);
}
async function navigateCompletedResult():Promise<void> {
  const focus=document.activeElement as HTMLElement|null,editing=!!focus&&['INPUT','TEXTAREA','SP-TEXTAREA'].includes(focus.tagName);
  const id=resultNavigation.take(candidates.map(candidate=>candidate.job.id),panelVisible&&settingsReady&&!busy&&!pointerActive&&!editing&&!document.querySelector('dialog[open]'),settings.autoViewResults!==false);
  if(!id)return;
  const index=candidates.findIndex(candidate=>candidate.job.id===id);if(index<0)return;
  el('candidate-select').value=String(index);candidateUi();views.show('results');
  await guarded(showSelected,{page:'results',feature:'result-preview',stage:'output'});
}
async function saveReady(record:JobRecord,images:OutputFile[],operation=activeOperation) {
  if(operation){operation.stage='output';operation.taskId=record.id;}
  record.state='downloading';record.outputs=images;
  try{
    await store.trace('candidate.download',record.id);const bytes=await client.output(images[0]);await store.binary(`${record.id}-output.png`,bytes);record.outputFile=`${record.id}-output.png`;decodeModelPng(bytes,String(record.template??""));record.state='ready';if(record.relight)(record.relight as RelightTaskMetadata).result={jobId:record.id,outputFile:record.outputFile as string};await store.save(record);
    if(((record.blend??record.relight) as BlendTaskMetadata|RelightTaskMetadata|undefined)?.outputKind==='lighting-layers'){if(operation)operation.stage='lighting-extraction';taskPhase(t('正在提取光影影响场…'));}
    const candidate=await addCandidate(record,bytes);assertLightingComposite(candidate);
  }
  catch(error){record.state='output-error';record.detail=error instanceof Error?error.message:String(error);await store.save(record);throw error;}
}
async function waitRecord(record:JobRecord,operation=activeOperation):Promise<boolean> {
  let steps:{value:number;max:number}|undefined;
  function showSteps(){if(!steps)return;const percent=Math.round(steps.value/steps.max*100);taskPhase(t("推理 {0} / {1} 步 · {2}%",steps.value,steps.max,percent),percent);status(t("候选推理：{0} / {1} 步\n任务 {2}",steps.value,steps.max,record.id.slice(0,8)));}
  const closeSocket=client.watch(record.clientId,record.id,(step,max)=>{if(stopBatch||!Number.isFinite(step)||!Number.isFinite(max)||max<=0||step<0||step>max)return;steps={value:step,max};showSteps();});
  const start=Date.now();let unknownReads=0;
  try {
    while(Date.now()-start<3600000) {
      if(stopBatch){
        taskPhase(t(client instanceof GatewayClient?'后续候选已停止；当前平台任务继续，完成后保留结果':"正在确认取消…"));
        const result=await coordinator.cancel(record);
        if(result.state==='ready'){await saveReady(record,result.images!,operation);status(t("任务已完成，候选已保留；后续候选停止"));return false;}
        if(result.state==='cancelled'){status(t("本任务取消已确认；已有候选保留"));return false;}
        if(result.state==='unknown')throw new DiagnosticError('pending-task','inference',t("取消未确认，原任务 ID 已保留；请继续恢复或取消，不要重复生成"));
        if(result.state==='failed')throw new Error(result.detail||t("任务失败"));
        status(t(client instanceof GatewayClient?'后续候选已停止；当前平台任务继续，完成后保留结果':"已发送指定任务取消，等待后端终态…"));await new Promise(r=>setTimeout(r,2000));continue;
      }
      try {
        const result=await client.status(record.id);
        if(result.state==='ready') {
          taskPhase(t("推理完成，下载与保存候选…"),100);await saveReady(record,result.images!,operation);taskPhase(t("候选已保存"),100);status(t("候选已就绪，请预览后应用"));return true;
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
  const operation=activeOperation,navigationIntent=resultNavigation.begin(),completedIds:string[]=[],batchIds:string[]=[];
  stopBatch=false;
  el('diagnostic-box').style.display='none';
  startTask();
  lock(true);
  try {
  await store.trace('generate.start');
  const pending=(await store.history()).find(blocksGeneration);
  if(pending){await refreshHistory(pending.id);historyDetail=true;views.show('history');pendingDetailReveal=true;throw new DiagnosticError('pending-task','inference',t('任务 {0} 尚未确认，请在历史中按原 ID 恢复或取消',pending.id));}
  const mode=frozenRelight?'relight':el('mode').value,userPrompt=frozenRelight?frozenRelight.scene.supplement:mode==='remove'?'':el('prompt').value,destination=frozenRelight?'selection':el('destination').value,usage=el('usage').value;
  const context=frozenRelight?undefined:assetContext(),asset=assetMode(mode),behavior=asset?{guide:!!context,preserveAlpha:false,alignSubject:false,matchColor:false}:editBehavior(mode,{guide:!!el('guide').checked,preserveAlpha:!!el('preserve-alpha').checked,alignSubject:frozenRelight?false:!!el('align-subject').checked,matchColor:frozenRelight?false:!!el('match-color').checked},settings.backend??'comfyui'),guide=behavior.guide;
  let request=intent(frozenRelight?'cosplay':workspace,mode,frozenRelight?'Structured relighting':userPrompt,!asset&&!!reference,guide,usage,client instanceof GatewayClient?'semantic':'images',false,context);
  const depth=outputDepth(),blendKind=mode==='blend'?el('blend-output-kind').value as RelightOutputKind:undefined;const count=Number(el('count').value),steps=Number(el('steps').value),resolution=Number(el('resolution').value),margin=Number(el('margin').value)/100;
  let baseSeed=el('lock-seed').checked?Number(el('seed').value):Math.floor(Math.random()*2**31),seedSupported=true;
  if(!Number.isInteger(count)||count<1||count>4)throw new Error(t("候选数量须为 1–4"));
  if(!(client instanceof GatewayClient))buildGraph({requestId:uuid(),prompt:request.prompt,seed:baseSeed+count-1,steps,resolution,models:settings.models,outputDepth:outputDepth()});
  if(request.kind==='edit'&&destination!=='selection')throw new Error(t("编辑补丁需要捕获来源选区"));
  const captureTarget=request.kind==='edit'||!!context||request.kind==='t2i'&&destination==='selection';
  if(captureTarget&&expectedDocumentId===undefined)throw new Error(t("请先打开 Photoshop 文档并建立选区"));
    if(operation)operation.stage='environment';const checking=t(client instanceof GatewayClient?'检查平台服务与模型能力…':"检查节点与本机模型…");taskPhase(checking);status(checking);await checkBackend(client,{...settings,outputDepth:depth});
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
    if(stopBatch){clearCapturePreview();return;}
    if(operation)operation.stage='capture';if(!frozenRelight){if(captureTarget)await captureArea(expectedDocumentId);else clearCapturePreview();}
    const captured=frozenRelight?.capture??capture,ref=asset?undefined:reference,hasInputs=request.kind==='edit'||!!context;
    if(blendKind==='lighting-layers')assertBlendLightingCapture(captured!);
    for(let index=0;index<count&&!stopBatch;index++) {
      batchPosition=t("候选 {0} / {1} · ",index+1,count);taskPhase(t("准备与上传输入…"));status(t("上传候选 {0} / {1} 的输入…",index+1,count));const id=uuid(),clientId=uuid();
      const seed=seedSupported?baseSeed+index:0;
      const snapshot=captured?.snapshot;
      let source:string|undefined,guideName:string|undefined,referenceName:string|undefined,modelSize:{width:number;height:number}|undefined,generationRequest:GenerationRequest|undefined;
      if(client instanceof GatewayClient){
        const size=hasInputs?makeMapping(snapshot!.bounds,resolution):{width:resolution,height:resolution};
        try{generationRequest=validateGeneration({model:client.model,kind:request.kind,mode,prompt:request.prompt,seed,width:size.width,height:size.height,outputDepth:depth,...(context?{assetContext:context}:{}),...(hasInputs?{source:`${id}-source.png`,...(guide?{guide:`${id}-guide.png`}:{}),...(ref?{reference:`${id}-reference.png`}:{})}:{})},client.capabilities!);}
        catch(error){if(context&&!client.capabilities!.models.find(model=>model.id===(client as GatewayClient).model)?.assetContexts?.includes(context))throw new DiagnosticError('unsupported','environment',t('此平台模型不支持参考当前图片与选区生成透明素材；请明确选择仅文字素材或更换模型'));throw error;}
      }
      const blendMetadata=blendKind?blendTaskMetadata(captured!,id,blendKind):undefined;
      if(snapshot&&(context||snapshot.captureGeometry?.kind==='edit-analysis'||snapshot.captureGeometry?.kind==='blend-analysis')){
        const mapping=makeMapping(snapshot.bounds,resolution);
        (context?preflightSelectionAssetCandidate:preflightEditAnalysisCandidate)({id,clientId,state:'created',createdAt:new Date().toISOString(),graph:{},snapshot,...(blendMetadata?{blend:blendMetadata}:{}),template:generationRequest?GATEWAY_TEMPLATE:templateForDepth(depth),params:{mode,outputKind:request.kind,...(context?{assetContext:context}:{}),modelSize:{width:mapping.width,height:mapping.height}}},retainedImageBytes(true));
      }
      if(snapshot){
        await store.binary(`${id}-mask.bin`,snapshot.mask);await store.binary(`${id}-source.png`,encodePng(captured!.image));
        if(context||blendMetadata||snapshot.backgroundComposite==='subject-background-v1'){
          const raw=context||blendMetadata?captured!.selectionMask:captured!.subjectMask;
          if(!raw)throw new Error(t('背景历史的蒙版数据缺失或损坏，无法安全重建候选；原始输出已保留'));
          await store.binary(`${id}-subject-mask.bin`,raw);await store.binary(`${id}-protection-mask.bin`,captured!.protectionMask);
        }
      }
      if(hasInputs) {
        if(frozenRelight||context||blendMetadata)adapter.assertSourceCurrent(snapshot!);
        const mapping=makeMapping(snapshot!.bounds,resolution);
        modelSize={width:mapping.width,height:mapping.height};
        const image=resize(captured!.image,mapping.width,mapping.height);
        source=await client.upload(encodePng(editModelInput(mode,image)),`${id}-source.png`);
        if(guide){const gray=context?resampleGray(snapshot!.mask,snapshot!.bounds.right-snapshot!.bounds.left,snapshot!.bounds.bottom-snapshot!.bounds.top,mapping.width,mapping.height):snapshot!.captureGeometry?downsampleSnapshotMask(snapshot!,captured!.image.width,captured!.image.height):snapshot!.mask;const mask=context?maskRaster(gray,mapping.width,mapping.height):resize(maskRaster(gray,captured!.image.width,captured!.image.height),mapping.width,mapping.height);guideName=await client.upload(encodePng(mask),`${id}-guide.png`);}
        if(ref){const refMap=makeMapping({left:0,top:0,right:ref.width,bottom:ref.height},resolution);referenceName=await client.upload(encodePng(resize(ref,refMap.width,refMap.height)),`${id}-reference.png`);}
      }
      if(stopBatch)break;
      if(context||blendMetadata)adapter.assertSourceCurrent(snapshot!);
      const graph=client instanceof GatewayClient?{}:buildGraph({requestId:id,prompt:request.prompt,seed,steps,resolution,source,guide:guideName,reference:referenceName,models:settings.models,outputDepth:outputDepth()});
      const {mask:ignored,...metadata}=snapshot??{mask:undefined};
      current={id,clientId,baseUrl:settings.baseUrl,state:'created',createdAt:new Date().toISOString(),graph,...(generationRequest?{backend:'gateway' as const,request:generationRequest}:{}),userPrompt,params:{workspace,mode,steps,resolution,seed,outputDepth:depth,guide,margin,usage,destination,outputKind:request.kind,...(context?{assetContext:context}:{}),modelSize,preserveAlpha:behavior.preserveAlpha,alignSubject:behavior.alignSubject,matchColor:behavior.matchColor},snapshot:snapshot?metadata:undefined,template:generationRequest?GATEWAY_TEMPLATE:templateForDepth(depth),...(generationRequest?{providerModel:generationRequest.model}:{models:{...settings.models}})};
      if(captured?.documentName)current.sourceName=captured.documentName;
      if(blendMetadata)current.blend=blendMetadata;
      if(frozenRelight&&relightCaps){current.relight={...relightTaskMetadata(frozenRelight,id,relightCaps,modelSize!,depth,seed),...(relightConflictResolution?{conflictResolution:relightConflictResolution}:{})};onRelightJob?.(id);}
      batchIds.push(id);if(operation){operation.stage='inference';operation.taskId=id;}await store.trace('task.submit',id);await coordinator.submit(current);await refreshHistory(id);await store.trace('task.wait',id);
      if(current.state==='failed')throw new Error(current.detail);
      if(!await waitRecord(current,operation))break;
      completedIds.push(id);
      if(index===count-1)taskSucceeded=true;
    }
    // A normal return also covers cancellation before POST or after a saved
    // late result. Only a completed, uncancelled batch supersedes task feedback.
    if(operation&&completedIds.length===count&&!stopBatch)operation.successfulTaskId=completedIds[completedIds.length-1];
  }catch(error){status(error instanceof Error?error.message:String(error));throw error;}finally{endTask();try{await refreshHistory();}finally{lock(false);const valid=completedIds.filter(id=>!candidates.find(c=>c.job.id===id)?.warning),saved=batchIds.filter(id=>candidates.some(c=>c.job.id===id));if(taskSucceeded&&valid.length)resultNavigation.complete(navigationIntent,valid);el('view-ready-results').style.display=(!taskSucceeded||!valid.length)&&saved.length?'block':'none';queueResultNavigation();}}
}
async function recover(){
  if(busy)return;const id=historyTable.selectedId;detachAcknowledgedId=undefined;stopBatch=false;startTask();lock(true);
  const operation=activeOperation,navigationIntent=resultNavigation.begin();
  try {const records=await store.history();current=records.find(r=>r.id===id);
  if(!current)throw new Error(t("没有可恢复的任务"));
  assertBackend(current);if(operation)operation.taskId=current.id;if(current.tracking==='detached'){delete current.tracking;await store.save(current);await refreshHistory(id);}if(settings.platform&&client instanceof GatewayClient){const ready=await connectDraft(settings) as GatewayClient;client.token=ready.token;}const completed=await waitRecord(current,operation);taskSucceeded=completed;if(operation&&completed)operation.successfulTaskId=current.id;}catch(error){status(error instanceof Error?error.message:String(error));throw error;}finally{endTask();try{await refreshHistory(id);}finally{lock(false);if(taskSucceeded&&id)resultNavigation.complete(navigationIntent,[id]);queueResultNavigation();}}
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
async function apply(jobId?:string,checkOnly=false){
  if(busy){if(jobId)throw new Error(t('已有任务正在进行，请等待完成后再生成或应用；可以继续编辑布光'));return;}
  lock(true);const started=Date.now();
  try{
    const c=jobId?candidateById(jobId):selected(),operation=activeOperation;
    if(operation){operation.taskId=c.job.id;operation.documentId=c.snapshot?.documentId;operation.mode=(c.job.params as any)?.mode;}
    assertLightingComposite(c);if(c.warning)throw new DiagnosticError('invalid-output','output',c.warning);
    if(!c.snapshot)throw new Error(t('此候选没有来源选区，请使用新文档查看'));
    if(jobId&&relightSession&&(c.job.relight as RelightTaskMetadata|undefined)?.scene.source.snapshotId!==relightSession.editor.snapshot().source.snapshotId)throw new DiagnosticError('source-changed','apply',t('此结果属于旧来源快照，仅可查看或导出；请对当前来源重新生成'));
    assertCandidateSource(c);
    if(checkOnly){status(t('来源检查通过；请再次明确应用候选。'));return;}
    let layerId:number;
    if(c.outputKind==='lighting-layers'){
      const bounds=c.snapshot.bounds;planRelightMemory(bounds.right-bounds.left,bounds.bottom-bounds.top,c.snapshot.nativeDepth??8,undefined,retainedImageBytes());
      taskPhase(t('正在提取光影影响场…'));
      const prepared=await prepareLightingLayerApplication(c.job,await store.readBinary(historyOutputName(c.job)),name=>store.readBinary(name));
      layerId=await adapter.applyRelightLayers(prepared.snapshot,prepared.fields,t('PS-AI 光影层 {0}',c.job.id.slice(0,8)),{onProgress:(done,total)=>taskPhase(t('写入光影层 {0} / {1}',done,total),Math.round(done/total*100))});
    }else if((c.job.params as any)?.assetContext==='selection-v1'){
      layerId=await withImagePixels(async()=>{
        capture=undefined;
        const prepared=await prepareSelectionAssetApplication(c.job,await store.readBinary(historyOutputName(c.job)),name=>store.readBinary(name),retainedImageBytes(true)),name=`PS-AI ${c.job.id.slice(0,8)}`;
        return prepared.snapshot.captureGeometry?.kind==='edit-analysis'
          ?adapter.applyEditAnalysis(prepared.snapshot,prepared.image,name,{preserveAlpha:false,assetContext:prepared.assetContext,retainedBytes:retainedImageBytes(true),onProgress:(done,total)=>taskPhase(t('写入原尺寸结果 {0} / {1}',done,total),Math.round(done/total*100))})
          :adapter.apply(prepared.snapshot,prepared.image,name);
      });
    }else if(c.snapshot.captureGeometry?.kind==='edit-analysis'||c.snapshot.captureGeometry?.kind==='blend-analysis'){
      layerId=await withImagePixels(async()=>{
        // Every new task recaptures. Release this ordinary capture before loading
        // exact historical planes; range recovery and saved protection survive.
        capture=undefined;
        const prepared=await prepareEditAnalysisApplication(c.job,await store.readBinary(historyOutputName(c.job)),name=>store.readBinary(name),retainedImageBytes(true));
        const name=c.job.relight?t('PS-AI 光影重塑 · 完整结果 {0}',c.job.id.slice(0,8)):`PS-AI ${c.job.id.slice(0,8)}`;
        return adapter.applyEditAnalysis(prepared.snapshot,prepared.image,name,{preserveAlpha:prepared.preserveAlpha,subjectMask:prepared.subjectMask,protectionMask:prepared.protectionMask,retainedBytes:retainedImageBytes(true),onProgress:(done,total)=>taskPhase(t('写入原尺寸结果 {0} / {1}',done,total),Math.round(done/total*100))});
      });
    }else{
      const params=c.job.params as any,behavior=editBehavior(params.mode,params,c.job.backend??'comfyui'),source=params.outputKind==='edit'&&behavior.preserveAlpha?decodePng(await store.readBinary(`${c.job.id}-source.png`)):undefined;
      const name=c.job.relight?t('PS-AI 光影重塑 · 完整结果 {0}',c.job.id.slice(0,8)):`PS-AI ${c.job.id.slice(0,8)}`;layerId=await adapter.apply(c.snapshot,c.image,name,source);
    }
    applied={documentId:c.snapshot.documentId,layerId,jobId:c.job.id};el('opacity').value=100;
    status(t(c.outputKind==='lighting-layers'?'已应用独立光影层组；可编辑各通道、蒙版与不透明度，Ctrl+Z 一次撤销':'已应用为独立图层，蒙版可编辑；同次捕获切换候选替换此图层，Ctrl+Z 一次撤销'));
    await store.trace('candidate.apply.complete',c.job.id,{documentId:c.snapshot.documentId,durationMs:Date.now()-started,width:c.snapshot.width,height:c.snapshot.height});
  }finally{if(!taskActive)el('task-progress').style.display='none';lock(false);}
}
function on(id:string,action:()=>Promise<void>){el(id).addEventListener('click',()=>{
  // Ignore already queued clicks after a control is locked. A skipped action
  // must not create a feedback owner or clear an earlier diagnostic.
  if(el(id).disabled)return;
  const stage:Stage=['apply','new-document','opacity'].includes(id)?'apply':['capture','restore-selection','protect','reference','open-relight','relight-reuse-history','diagnostic-primary'].includes(id)?'capture':['scan-models','setup-check'].includes(id)?'environment':['recover','generate','setup-example','cancel','history-cancel'].includes(id)?'inference':['load-history','export','export-ai-reference','zoom'].includes(id)?'output':'connection';
  const page:PanelPage=['connect','scan-models','save-settings','import-settings','export-settings','setup-connect','setup-check','setup-example','save-key','clear-key','stop-relay'].includes(id)?'settings':['recover','load-history','repeat-history','history-cancel','clear-history','confirm-clear-history','retry-history-cleanup'].includes(id)?'history':['generate','capture','restore-selection','protect','reference','open-relight','relight-reuse-history'].includes(id)?'create':views.current;
  if(id==='connect')views.show('settings');
  void guarded(()=>action(),{feature:id==='diagnostic-primary'&&el(id).getAttribute('data-color-recovery')?'recover-color':id,page,stage});
});}
const foldLabels:Record<string,string>={settings:'模型与连接',reference:'参考图（可选）',advanced:'进阶参数',diagnostics:'宿主诊断',privacy:'文件授权与隐私'};
function fold(name:string,open:boolean){el(`${name}-body`).style.display=open?'block':'none';el(`toggle-${name}`).textContent=t(foldLabels[name])+(open?' ▾':' ▸');el(`toggle-${name}`).setAttribute('aria-expanded',String(open));}
for(const name of Object.keys(foldLabels)){fold(name,false);on(`toggle-${name}`,async()=>fold(name,el(`${name}-body`).style.display==='none'));}
const legacyAccess=el('legacy-source-access'),legacyHelp=el('forget-source-access').nextElementSibling;
for(const node of [el('remember-source-access'),el('forget-source-access'),legacyHelp,el('source-access-status')])legacyAccess.appendChild(node);
legacyHelp.style.display='none';
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
  }else{
    const draft=draftSettings(),found=await new ComfyClient(draft.baseUrl,fetch,30000,draft.models).inspect(),suggested=suggestModelMappings(found.models,draft.models);
    showSettings(found.models,{...draft,models:suggested.models});
    modelScanUnresolved=[...suggested.unresolved];renderModelScanReport();
    status(t('扫描到文件不代表架构兼容；请保存并连接检查。'));
  }
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
on('workflow-next',async()=>{
  const step=el('workflow-guide').getAttribute('data-step');if(busy)return;
  if(step==='pending'){await showPending();return;}
  if(step==='connection'){showSetup();fold('settings',true);return;}
  if(step==='source'){await guarded(()=>configure(()=>captureArea()),{page:'create',feature:'capture',stage:'capture'});return;}
  if(step==='relight'){await guarded(()=>openRelightWorkbench(),{page:'create',feature:'open-relight',stage:'capture'});return;}
  if(step==='reference'){fold('reference',true);el('reference').focus();return;}
  if(step==='prompt'){el('prompt').focus();return;}
  blendGenerationOpen=true;inputUi();el('toggle-generation').focus();
});
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
el('toggle-error-details').addEventListener('click',()=>void copyDiagnostic());
el('export-error-report').addEventListener('click',()=>void(async()=>{const report=currentDiagnostic();if(!report)return;try{const file=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-diagnostic.json',{types:['json']});if(file)await file.write(JSON.stringify(report.diagnostic,null,2));}catch{el('diagnostic-copy-status').textContent=t('诊断报告导出失败，请检查保存位置后重试。');}})());
on('diagnostic-primary',async()=>{
  if(busy)return;
  const button=el('diagnostic-primary'),colorOperation=button.getAttribute('data-color-recovery'),report=currentDiagnostic();
  if(colorOperation&&(!report||report.operation.id!==colorOperation||report.operation.documentId!==activeDocumentId()||report.operation.mode!==el('mode').value)){
    status(t('来源文档或模式已切换；请返回报错的来源重新检查，色彩恢复不会作用于新活动文档。'));renderDiagnostic();return;
  }
  if(!report)return;
  if(report.operation.mode!==el('mode').value||report.operation.documentId!==activeDocumentId()){if(report.diagnostic.stage==='apply'){views.show('create');status(t('请在 Photoshop 选择正确的来源文档和编辑模式，再预览当前选区；旧候选不会重新绑定。'));}return;}
  const documentId=report.operation.documentId!;
  if(colorOperation){
    // A profile can become valid after the button was painted. Its current ICC
    // takes priority; never create a recovery copy in that case.
    const session=el('mode').value==='relight'?pendingColorCapture?.session??(relightSession?.sourceCapture.snapshot.documentId===documentId?relightSession:undefined):undefined;
    if(colorRecoveryAction(documentId,session)){await recoverSourceColor(documentId,session);return;}
    if(adapter.colorRecoveryAvailability(documentId)!=='not-needed')throw new DiagnosticError('source-profile','capture',t('当前来源没有可验证的会话色彩恢复记录；请在副本中指定正确配置文件'));
  }
  if(el('mode').value==='relight'){await openRelightWorkbench();return;}
  if(canRestoreSelection()&&!colorOperation)await restoreSelectionArea();else await configure(()=>captureArea(documentId));
});
el('history-back').addEventListener('click',()=>{if(busy)return;historyDetail=false;historyUi();el('history-rows').scrollTop=historyScrollTop;});
el('view-ready-results').addEventListener('click',()=>{views.show('results');el('view-ready-results').style.display='none';});
el('auto-view-results').addEventListener('change',()=>void guarded(()=>configure(async()=>{const enabled=el('auto-view-results').checked!==false;settings=validateSettings({...settings,autoViewResults:enabled});await store.json('settings.json',settings);queueResultNavigation();}),{page:'settings',feature:'auto-view-results'}));
on('capture',()=>configure(()=>captureArea()));
on('restore-selection',restoreSelectionArea);
on('protect',()=>configure(async()=>{protection=await adapter.protection();capture=undefined;el('selection-previews').style.display='none';sourceCaption.show('保护区已保存；请重新圈选编辑区，再捕获或生成');status(t("保护区保留原始像素，不依赖自动人脸识别"));}));
on('clear-protection',()=>configure(async()=>{protection=undefined;capture=undefined;el('selection-previews').style.display='none';sourceCaption.show('保护区已清除，请重新捕获');}));
on('reference',()=>configure(async()=>{const file=await uxp.storage.localFileSystem.getFileForOpening({types:['png','jpg','jpeg','webp']});if(!file)return;reference=await adapter.importReference(file,retainedImageBytes(true));el('reference-info').textContent=`${file.name} · ${reference.width}×${reference.height} · sRGB 8-bit`;}));
on('clear-reference',async()=>{reference=undefined;el('reference-info').setAttribute('data-i18n','未选择参考图');el('reference-info').textContent=t("未选择参考图");});
on('toggle-protection',async()=>{blendProtectionOpen=!blendProtectionOpen;inputUi();});
on('toggle-generation',async()=>{blendGenerationOpen=!blendGenerationOpen;inputUi();});
el('blend-output-kind').addEventListener('change',()=>{if(capture&&el('blend-output-kind').value==='lighting-layers')void guarded(async()=>{assertBlendLightingCapture(capture!);},{page:'create',feature:'blend-output-kind',stage:'capture'});});
el('blend-result-output').addEventListener('change',requestBlendProcessing);
for(const id of ['blend-fidelity','blend-detail-protection']){
  el(id).addEventListener('input',requestBlendProcessing);el(id).addEventListener('change',requestBlendProcessing);
  for(const event of ['input','change'])el(`${id}-slider`).addEventListener(event,()=>{if(el(`${id}-slider`).disabled)return;el(id).value=String(el(`${id}-slider`).value);requestBlendProcessing();});
}
for(const view of ['source','composite','ai'] as const)on(`blend-view-${view}`,async()=>{blendView=view;await showSelected();});
on('open-relight',()=>openRelightWorkbench());
on('relight-reuse-history',()=>openRelightWorkbench(relightReuse,relightReuseDescription));
el('relight-scope').addEventListener('change',()=>{if(relightSession)relightWorkbench?.setScopePending(relightScope()!==relightSession.scope);});
el('remember-source-access').addEventListener('change',()=>void guarded(async()=>{const operation=++sourceAccessOperation,notice=sourceAccessNotice;await sourceColorReader.setRemember(!!el('remember-source-access').checked);if(operation!==sourceAccessOperation)return;el('remember-source-access').checked=sourceColorReader.remember;if(notice===sourceAccessNotice)sourceAccessStatus(sourceColorReader.remember?'已开启记住原图文件授权；仍会重新检查文件内容和颜色声明':'已关闭记住原图文件授权；已移除保存的授权，本次会话访问仍可使用');}));
on('forget-source-access',async()=>{const operation=++sourceAccessOperation;await sourceColorReader.forget();if(operation===sourceAccessOperation)sourceAccessStatus('已清除原图文件授权；读取文档时无需重新选图，未知色彩将在独立副本中处理。');});
on('generate',generate);on('apply',()=>apply(undefined,el('apply').getAttribute('data-candidate-action')==='inspect'));on('recover',recover);
on('cancel',cancelSelected);on('open-pending',()=>showPending());on('next-pending',()=>showPending(true));
on('history-cancel',async()=>{if(!busy)await cancelSelected();});
on('clear-history',()=>clearHistory());on('confirm-clear-history',()=>clearHistory(true));on('keep-history',async()=>{if(!busy){clearConfirmation=undefined;historyUi();}});on('retry-history-cleanup',retryHistoryCleanup);
on('stop-tracking',()=>stopTracking());on('confirm-stop-tracking',()=>stopTracking(true));on('keep-tracking',async()=>{detachAcknowledgedId=undefined;historyUi();});
el('mode').addEventListener('change',()=>{invalidateCapture();inputUi();if(workspace==='cosplay'&&el('mode').value==='reference'){fold('reference',true);el('guide').checked=false;status(t("角色参考默认使用原图 + 参考图；范围辅助可能影响颜色，请按需试验"));}});
el('destination').addEventListener('change',inputUi);
for(const id of ['prompt','count','resolution','destination','backend-url','model-unet','model-clip','model-vae','gateway-model'])for(const event of ['input','change'])el(id).addEventListener(event,workflowUi);
el('asset-input').addEventListener('change',()=>{invalidateCapture();inputUi();});
el('resolution').addEventListener('change',invalidateCapture);
el('margin').addEventListener('change',()=>{capture=undefined;el('selection-previews').style.display='none';sourceCaption.show('范围参数已改变，请重新预览选区');workflowUi();});
el('candidate-select').addEventListener('change',()=>void guarded(showSelected));
on('zoom',async()=>{zoomed=!zoomed;el('zoom').textContent=zoomed?t("适应预览"):t("100% 查看");await showSelected();});
on('export',()=>configure(async()=>{const c=selected(),file=await uxp.storage.localFileSystem.getFileForSaving(`ps-ai-${c.job.id.slice(0,8)}.png`,{types:['png']});if(file)await file.write(new Uint8Array(c.bytes).buffer,{format:uxp.storage.formats.binary});}));
on('export-ai-reference',()=>configure(async()=>{
  const candidate=selected(),id=candidate.job.id;
  const unavailable=()=>new DiagnosticError('invalid-output','output',t('此光影候选没有可安全导出的原始 AI 参考图，请从历史重新读取'));
  if(candidate.outputKind!=='lighting-layers'&&!candidate.job.blend)throw unavailable();
  const record=(await store.history()).find(value=>value.id===id);if(!record||!record.blend&&(record.relight as RelightTaskMetadata|undefined)?.outputKind!=='lighting-layers')throw unavailable();
  if(record.blend)validateBlendTaskMetadata(record.blend,id);
  const name=historyOutputName(record);if(name!==`${id}-output.png`)throw unavailable();
  const bytes=await store.readBinary(name),file=await uxp.storage.localFileSystem.getFileForSaving(`ps-ai-${id.slice(0,8)}-ai-reference.png`,{types:['png']});
  if(file){await file.write(new Uint8Array(bytes).buffer,{format:uxp.storage.formats.binary});status(t('已另存模型原始 AI 参考图；候选预览保持不变。'));}
}));
on('new-document',()=>configure(async()=>{const c=selected();await adapter.newDocument(c.image,`ps-ai ${c.job.id.slice(0,8)}`);}));
el('opacity').addEventListener('change',()=>void guarded(()=>configure(async()=>{if(!applied)throw new Error(t("请先应用一个候选"));await adapter.opacity(applied.documentId,applied.layerId,Number(el('opacity').value));})));
on('load-history',async()=>{if(busy)return;const id=historyTable.selectedId,operation=activeOperation;lock(true);try{const record=(await store.history()).find(r=>r.id===id);if(!record?.outputFile)throw new Error(t("此记录尚未保存候选，请恢复任务"));if(operation)operation.taskId=record.id;const candidate=await addCandidate(record,await store.readBinary(historyOutputName(record)));views.show('results');if(candidate.lightingState==='reference-only')await guarded(async local=>{local.taskId=record.id;assertLightingComposite(candidate);},{page:'results',feature:'load-history',stage:'lighting-extraction'});}finally{lock(false);}});
on('repeat-history',async()=>{
  if(busy)return;const id=historyTable.selectedId;lock(true);
  try{const r=(await store.history()).find(r=>r.id===id);if(!r)throw new Error(t("请选择历史记录"));const p=r.params as any;
    if(settings.backend==='gateway'&&p.outputDepth===16)throw new Error(t('此历史为 16 位输出，请切回 ComfyUI 后恢复参数；当前平台配置保留 8 位'));views.show('create');
    if(p.mode==='relight'){const metadata=r.relight as RelightTaskMetadata|undefined;relightReuse=metadata?validateRelightScene(metadata.scene):undefined;relightReuseDescription=metadata?undefined:String(r.userPrompt??'');setWorkspace('cosplay','relight');el('relight-reuse-history').style.display='block';status(t('历史光影参数已准备，请明确点击复用到当前原图；旧候选仍可读取、应用或导出'));return;}
    if(['effect','atmosphere'].includes(p.mode)&&p.assetContext!==undefined&&p.assetContext!=='selection-v1')throw new Error(t('素材输入方式无效，请重新选择'));
    setWorkspace(p.workspace,p.mode);if(p.mode==='blend')el('blend-output-kind').value=r.blend?validateBlendTaskMetadata(r.blend,r.id).outputKind:'full-result';if(assetMode()){el('asset-input').value=p.assetContext==='selection-v1'?'selection-v1':'text';invalidateCapture();}if(p.mode!=='remove')el('prompt').value=r.userPrompt;for(const name of ['steps','resolution','seed','destination'])el(name).value=p[name];el('output-depth').value=String(p.outputDepth??8);el('usage').value=['服装','道具','材质','场景'].includes(p.usage)?p.usage:'服装';el('guide').checked=p.guide;el('preserve-alpha').checked=p.preserveAlpha!==false;el('align-subject').checked=p.alignSubject!==false;el('match-color').checked=p.matchColor===true;el('margin').value=p.margin*100;el('lock-seed').checked=true;inputUi();status(t("参数已恢复；参考图和保护区请重新指定，提交时重新捕获"));
  }finally{lock(false);}
});
on('p0',async()=>{if(busy)return;lock(true);const trace:string[]=[];try{const report=await runHostProbe(ps,adapter,trace);await store.json('p0-host-report.json',report);status(t("P0 宿主往返通过：选区外/保护区像素、原图层、蒙版、异文档与一次撤销"));}catch(error){await store.json('p0-host-report.json',{passed:false,date:new Date().toISOString(),trace,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined});throw error;}finally{lock(false);}});
on('report',async()=>{const r=await store.readJson('p0-host-report.json',null);if(!r)throw new Error(t("请先运行 P0 图像往返验证"));const f=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-p0-host-report.json',{types:['json']});if(f)await f.write(JSON.stringify(r,null,2));});
on('export-log',async()=>{const r=await store.readJson('runtime-trace.json',null);if(!r)throw new Error(t("尚无操作阶段日志"));const f=await uxp.storage.localFileSystem.getFileForSaving('ps-ai-runtime-trace.json',{types:['json']});if(f)await f.write(JSON.stringify(r,null,2));});
function initializePanel():Promise<void> {
  if(initialization)return initialization;
  initialization=guarded(async()=>{
    lock(true);el('cancel').disabled=true;const start=Date.now();
    try{
      sourceColorReader=createSourceColorReader(uxp,{storage:store,onPicker:()=>status(t('请选择当前文档的原文件，以读取保存的色彩信息')),onStatus:sourceAccessStatus});
      await sourceColorReader.ready();el('remember-source-access').checked=sourceColorReader.remember;
      const savedSettings=await store.readJson<unknown>('settings.json',null);settings=validateSettings(savedSettings??defaultSettings());client=backendClient(settings);coordinator=new JobCoordinator(client,store);settingsReady=true;
      el('backend-url').value=settings.baseUrl;restoreSettingsLanguage();showSettings();await refreshHistory(undefined,true);connection('待检查');
      if(!savedSettings)showSetup();
      await store.trace('panel.local-ready',undefined,{durationMs:Date.now()-start});
    }catch(error){showSetup();fold('settings',true);throw error;}finally{lock(false);}
  },{page:'settings',feature:'panel-initialize',stage:'connection'});
  return initialization;
}
function interactionEnded():void {pointerActive=false;queueResultNavigation();}
document.addEventListener('pointerdown',()=>{pointerActive=true;});
document.addEventListener('pointerup',interactionEnded);document.addEventListener('pointercancel',interactionEnded);
document.addEventListener('focusout',queueResultNavigation);document.addEventListener('close',queueResultNavigation);document.addEventListener('psai-interaction-idle',queueResultNavigation);
window.addEventListener('blur',interactionEnded);window.addEventListener('focus',()=>{renderDiagnostic();workflowUi();});document.addEventListener('focusin',()=>{renderDiagnostic();workflowUi();});window.addEventListener('resize',()=>historyUi());
uxp.entrypoints.setup({panels:{psai:{show(){panelVisible=true;void initializePanel();renderDiagnostic();workflowUi();queueResultNavigation();},hide(){panelVisible=false;pointerActive=false;if(historyRevealTimer){clearTimeout(historyRevealTimer);historyRevealTimer=undefined;}},destroy(){panelVisible=false;pointerActive=false;historyPreview.invalidate();candidatePreview.retain([]);if(navigationTimer)clearTimeout(navigationTimer);if(copyTimer)clearTimeout(copyTimer);}}}});
