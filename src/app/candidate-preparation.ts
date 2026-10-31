import type {JobRecord} from '../generation/jobs';
import {decodeModelPng,decodePng,resize,maskRaster,rasterDepth,rasterMax,type Raster} from '../imaging/image';
import {prepareEditCandidate,prepareEditModel,prepareBackgroundCandidate,backgroundEditMask,retainSourceAlpha} from '../imaging/composite';
import {editBehavior,backgroundCoverage} from '../features/editing/edit-behavior';
import {isBackgroundMode} from '../generation/intent';
import {validateAssetPlacement,assetPlacementValue} from '../features/assets/asset-placement';
import type {AssetContext} from '../infrastructure/backends/gateway-protocol';
import type {Snapshot} from '../infrastructure/photoshop/photoshop';
import {diagnostic,DiagnosticError} from '../diagnostics/diagnostics';
import {t} from '../localization/i18n';
import {checkDocumentSize,downsampleSnapshotMask,resampleGray,IMAGE_BUDGETS,planEditApplyMemory,imageStrips} from '../imaging/budget';
import {sampleEditStrip} from '../imaging/native-edit';
import {validateRelightScene} from '../features/relight/relight-scene';
import type {RelightOutputKind} from '../features/relight/relight-session';
import {validateRelightExtractionSettings,type RelightLayerFields} from '../features/relight/relight-layers';
import {sha256} from '@noble/hashes/sha2.js';
import {validateBlendTaskMetadata,assertBlendSnapshot,assertBlendLightingCapture} from '../features/blend/blend-session';

type ReadBinary=(name:string)=>Promise<Uint8Array>;
export interface PreparedCandidate {image:Raster;snapshot?:Snapshot;warning?:string;outputKind?:RelightOutputKind;lightingState?:'composite'|'reference-only';lightingFailure?:Error;lightingSummary?:RelightLayerFields['summary']}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertTaskNames(record:JobRecord):void {
  if(record.snapshot&&!UUID.test(record.id))throw new Error(t('历史本地文件名不安全，无法读取候选'));
}
/** Automatic and explicit history reads stay inside the plugin root's basename namespace. */
export function historyOutputName(record:JobRecord):string {
  assertTaskNames(record);
  const name=record.outputFile;
  if(typeof name!=='string'||name.length>255||name!==name.trim()||name.startsWith('.')||name.includes('..')||/[\\/:*?"<>|\u0000-\u001f]/.test(name)||!/\.png$/i.test(name))throw new Error(t('历史本地文件名不安全，无法读取候选'));
  return name;
}
function backgroundHistoryError(){return new DiagnosticError('invalid-output','output',t('背景历史的蒙版数据缺失或损坏，无法安全重建候选；原始输出已保留'));}
function lightingHistoryError(){return new DiagnosticError('invalid-output','output',t('光影层历史的来源、尺寸、蒙版或输出类型不一致；原始输出已保留'));}
function editAnalysisHistoryError(){return new DiagnosticError('invalid-output','output',t('大区域历史的来源尺寸、原生蒙版或位深不一致；原始输出已保留'));}
/** Only the saved version grants current-image asset semantics; old assets stay text-only. */
function selectionAssetContext(record:JobRecord):AssetContext|undefined {
  const params=record.params as any,context=params?.assetContext;
  if(params?.assetPlacement!==undefined&&context!=='subject-v1')throw editAnalysisHistoryError();
  if(context===undefined)return undefined;
  if(!['selection-v1','subject-v1'].includes(context)||params.outputKind!=='asset'||!['effect','atmosphere'].includes(params.mode)||!record.snapshot||record.relight||(record.snapshot as Snapshot).backgroundComposite)throw editAnalysisHistoryError();
  if(context==='subject-v1'){
    const placement=validateAssetPlacement(params.assetPlacement),snapshot=record.snapshot as Snapshot;
    if(placement.scope==='document'&&(snapshot.bounds.left!==0||snapshot.bounds.top!==0||snapshot.bounds.right!==snapshot.width||snapshot.bounds.bottom!==snapshot.height))throw editAnalysisHistoryError();
  }
  return context;
}
function assetTransparencyWarning(image:Raster):string|undefined {
  const max=rasterMax(image);
  for(let p=3;p<image.rgba.length;p+=4)if(image.rgba[p]<max)return undefined;
  return t('素材输出没有透明部分；原始输出可另存检查，暂不回填。');
}
/** In selection-v1, subject-mask is the raw selection, never a background subject matte. */
async function validateAssetMasks(record:JobRecord,snapshot:Snapshot,read:ReadBinary):Promise<void> {
  const b=snapshot.bounds,width=b.right-b.left,height=b.bottom-b.top,size=width*height;
  if(!(snapshot.mask instanceof Uint8Array)||snapshot.mask.length!==size||!snapshot.mask.some(value=>value>0))throw editAnalysisHistoryError();
  let selection:Uint8Array,protection:Uint8Array;
  try{selection=await read(`${record.id}-subject-mask.bin`);protection=await read(`${record.id}-protection-mask.bin`);}catch{throw editAnalysisHistoryError();}
  if(!(selection instanceof Uint8Array)||!(protection instanceof Uint8Array)||selection.length!==size||protection.length!==size)throw editAnalysisHistoryError();
  const placement=selectionAssetContext(record)==='subject-v1'?validateAssetPlacement((record.params as any).assetPlacement):undefined;
  if(placement&&!selection.some(value=>value>0))throw editAnalysisHistoryError();
  for(let p=0;p<size;p++)if(snapshot.mask[p]!== (placement?assetPlacementValue(selection[p],protection[p],placement.occlusion):Math.round(selection[p]*(255-protection[p])/255)))throw editAnalysisHistoryError();
}
function smallAssetGeometry(record:JobRecord,outputBytes:number,retainedBytes:number){
  const snapshot=record.snapshot as Snapshot,b=snapshot.bounds,model=(record.params as any).modelSize;
  checkDocumentSize(snapshot.width,snapshot.height);
  if(!b||!Object.values(b).every(Number.isSafeInteger)||b.left<0||b.top<0||b.right>snapshot.width||b.bottom>snapshot.height||![8,16].includes(snapshot.nativeDepth!)||!model||!Number.isSafeInteger(model.width)||!Number.isSafeInteger(model.height)||model.width<1||model.height<1||model.width*model.height>16_000_000)throw editAnalysisHistoryError();
  const width=b.right-b.left,height=b.bottom-b.top;checkDocumentSize(width,height);
  const sourceBytes=width*height*(snapshot.nativeDepth===16?8:4),modelBytes=model.width*model.height*(record.template==='qwen21-local-v3-rgba16'?8:4);
  planEditApplyMemory(width,height,snapshot.nativeDepth!,sourceBytes*2+modelBytes*3+outputBytes,width*height*3,retainedBytes);
  return {width,height};
}
export function candidateOutputKind(record:JobRecord):RelightOutputKind|undefined {
  if(record.blend!==undefined){
    if(record.relight!==undefined||(record.params as any)?.mode!=='blend')throw lightingHistoryError();
    return validateBlendTaskMetadata(record.blend,record.id).outputKind;
  }
  const relight=record.relight as any;
  if(!relight)return undefined;
  if(relight.outputKind===undefined)return 'full-result';
  if(relight.outputKind!=='lighting-layers'&&relight.outputKind!=='full-result')throw lightingHistoryError();
  return relight.outputKind;
}
async function restoreSnapshot(record:JobRecord,read:ReadBinary):Promise<Snapshot|undefined> {
  if(!record.snapshot)return undefined;assertTaskNames(record);const saved=record.snapshot as Omit<Snapshot,'mask'>;
  if(saved.backgroundComposite!==undefined&&saved.backgroundComposite!=='subject-background-v1')throw backgroundHistoryError();
  try{return {...saved,mask:await read(`${record.id}-mask.bin`)};}catch(error){if(saved.backgroundComposite)throw backgroundHistoryError();throw error;}
}
async function restoreBackgroundMasks(record:JobRecord,snapshot:Snapshot,source:Raster,read:ReadBinary){
  let subject:Uint8Array,protection:Uint8Array;
  try{subject=await read(`${record.id}-subject-mask.bin`);protection=await read(`${record.id}-protection-mask.bin`);}catch{throw backgroundHistoryError();}
  const size=source.width*source.height;
  if(subject.length!==size||protection.length!==size||snapshot.mask.length!==size||source.width!==snapshot.bounds.right-snapshot.bounds.left||source.height!==snapshot.bounds.bottom-snapshot.bounds.top)throw backgroundHistoryError();
  const expected=backgroundEditMask(source,subject,protection);
  if(expected.some((value,i)=>value!==snapshot.mask[i]))throw backgroundHistoryError();
  return {subject,protection};
}

/** New bounded records have a native geometry and a separate, native-depth PNG grid. */
function editAnalysisGeometry(record:JobRecord,retainedBytes:number,outputBytes:number,application:boolean){
  const snapshot=record.snapshot as Snapshot|undefined,geometry=snapshot?.captureGeometry,params=record.params as any,assetContext=selectionAssetContext(record);
  const edit=params?.outputKind==='edit'&&['edit','remove','background','costume','reference','scene','relight','blend'].includes(params.mode);
  if(!snapshot||geometry?.kind!=='edit-analysis'||!params||!edit&&!assetContext||typeof snapshot.requiresClipping!=='boolean'||![8,16].includes(snapshot.nativeDepth!))throw editAnalysisHistoryError();
  checkDocumentSize(snapshot.width,snapshot.height);
  const b=snapshot.bounds;if(!b||!Object.values(b).every(Number.isSafeInteger)||b.left<0||b.top<0||b.right>snapshot.width||b.bottom>snapshot.height)throw editAnalysisHistoryError();
  const width=b.right-b.left,height=b.bottom-b.top;checkDocumentSize(width,height);
  if(!Number.isSafeInteger(geometry.width)||!Number.isSafeInteger(geometry.height)||geometry.width<1||geometry.height<1||geometry.width>width||geometry.height>height||geometry.width*geometry.height>IMAGE_BUDGETS.editPixels||Math.max(geometry.width,geometry.height)>IMAGE_BUDGETS.editSide)throw editAnalysisHistoryError();
  const model=params.modelSize;
  if(!model||!Number.isSafeInteger(model.width)||!Number.isSafeInteger(model.height)||model.width<1||model.height<1||model.width*model.height>16_000_000)throw editAnalysisHistoryError();
  const background=snapshot.backgroundComposite==='subject-background-v1';
  if(snapshot.backgroundComposite!==undefined&&!background||background!==isBackgroundMode(params.mode)||background&&snapshot.requiresClipping)throw editAnalysisHistoryError();
  // Validate the peak before loading native BIN planes. Decoder/transform copies,
  // source PNG and exported candidate are transient, not retained per candidate.
  const sourceBytes=geometry.width*geometry.height*(snapshot.nativeDepth===16?8:4);
  const modelBytes=model.width*model.height*(record.template==='qwen21-local-v3-rgba16'?8:4);
  // The helper doubles raster bytes for its live/copy peak. Selection assets
  // temporarily verify all three native planes, then retain only the effective
  // application mask. Ordinary browsing reads and releases one plane at a time.
  planEditApplyMemory(width,height,snapshot.nativeDepth!,sourceBytes*2+modelBytes*3+outputBytes,width*height*(assetContext||application&&background?3:1),retainedBytes);
  return {snapshot,geometry,params,width,height,background,assetContext};
}
function estimatedCandidatePngBytes(record:JobRecord):number {
  const model=(record.params as any)?.modelSize;
  if(!model||!Number.isSafeInteger(model.width)||!Number.isSafeInteger(model.height)||model.width<1||model.height<1)throw editAnalysisHistoryError();
  return model.width*model.height*(record.template==='qwen21-local-v3-rgba16'?8:4)+model.height+65_536;
}
function candidateCapturePreflight(check:()=>unknown):void {
  try{check();}catch(error){
    if((error as any)?.code==='image-budget'){
      const estimate=/^原生回填预计需要 (\d+) MB，超过图像内存预算$/.exec(error instanceof Error?error.message:'');
      throw new DiagnosticError('image-budget','capture',estimate?t('当前分辨率的候选准备预计需要 {0} MB，超过图像内存预算；请降低分辨率后重新读取。',estimate[1]):t('当前分辨率的候选准备超出内存预算；请降低分辨率后重新读取。'));
    }
    throw error;
  }
}
/** Check the planned paid response before any upload or submission. */
export function preflightEditAnalysisCandidate(record:JobRecord,retainedBytes=0):void {
  candidateCapturePreflight(()=>record.blend!==undefined?blendGeometry(record,retainedBytes,estimatedCandidatePngBytes(record)):editAnalysisGeometry(record,retainedBytes,estimatedCandidatePngBytes(record),false));
}
/** Every contextual asset, including a native small capture, must fit the later candidate peak. */
export function preflightSelectionAssetCandidate(record:JobRecord,retainedBytes=0):void {
  if(!selectionAssetContext(record))throw editAnalysisHistoryError();
  assertTaskNames(record);
  const geometry=(record.snapshot as Snapshot).captureGeometry;
  if(geometry!==undefined&&geometry.kind!=='edit-analysis')throw editAnalysisHistoryError();
  candidateCapturePreflight(()=>{
    const bytes=estimatedCandidatePngBytes(record);
    return geometry?editAnalysisGeometry(record,retainedBytes,bytes,false):smallAssetGeometry(record,bytes,retainedBytes);
  });
}

async function editAnalysisInputs(record:JobRecord,bytes:Uint8Array,read:ReadBinary,retainedBytes:number,application:boolean){
  assertTaskNames(record);const expected=editAnalysisGeometry(record,retainedBytes,bytes.byteLength,application);
  if(bytes.length<33)throw editAnalysisHistoryError();
  const outputHeader=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(outputHeader.getUint32(16)!==expected.params.modelSize.width||outputHeader.getUint32(20)!==expected.params.modelSize.height||expected.assetContext&&bytes[24]!==(record.template==='qwen21-local-v3-rgba16'?16:8))throw editAnalysisHistoryError();
  const snapshot:Snapshot={...expected.snapshot,mask:new Uint8Array()};
  const sourceBytes=await read(`${record.id}-source.png`),geometry=expected.geometry;
  if(sourceBytes.length<33)throw editAnalysisHistoryError();
  const header=new DataView(sourceBytes.buffer,sourceBytes.byteOffset,sourceBytes.byteLength);
  if(header.getUint32(16)!==geometry.width||header.getUint32(20)!==geometry.height||sourceBytes[24]!==snapshot.nativeDepth)throw editAnalysisHistoryError();
  const source=decodePng(sourceBytes);let hash=2166136261;for(const value of source.rgba)hash=Math.imul(hash^value,16777619);
  if((hash>>>0).toString(16)!==snapshot.sourceHash||rasterDepth(source)!==snapshot.nativeDepth)throw editAnalysisHistoryError();
  const raw=decodeModelPng(bytes,String(record.template??''));
  if(raw.width!==expected.params.modelSize.width||raw.height!==expected.params.modelSize.height)throw editAnalysisHistoryError();
  const plane=async(name:string,width:number,height:number,effective=false):Promise<Uint8Array>=>{
    let native:Uint8Array;try{native=await read(name);}catch{throw expected.background?backgroundHistoryError():editAnalysisHistoryError();}
    if(!(native instanceof Uint8Array)||native.length!==expected.width*expected.height||effective&&!native.some(value=>value>0))throw editAnalysisHistoryError();
    if(effective&&expected.assetContext)await validateAssetMasks(record,{...snapshot,mask:native},read);
    if(application){if(effective)snapshot.mask=native;return native;}
    return resampleGray(native,expected.width,expected.height,width,height);
  };
  const effective=await plane(`${record.id}-mask.bin`,raw.width,raw.height,true);
  const mask=application?resampleGray(effective,expected.width,expected.height,raw.width,raw.height):effective;
  let subjectMask:Uint8Array|undefined,protectionMask:Uint8Array|undefined;
  if(expected.background){
    subjectMask=await plane(`${record.id}-subject-mask.bin`,source.width,source.height);
    protectionMask=await plane(`${record.id}-protection-mask.bin`,source.width,source.height);
  }
  const behavior=editBehavior(expected.params.mode,expected.params,record.backend??'comfyui');
  return {snapshot,source,raw,mask,behavior,subjectMask,protectionMask,assetContext:expected.assetContext};
}

/** Native strips receive a transformed target before any source-alpha baking. */
export async function prepareEditAnalysisApplication(record:JobRecord,bytes:Uint8Array,read:ReadBinary,retainedBytes=0):Promise<{snapshot:Snapshot;image:Raster;preserveAlpha:boolean;assetContext?:AssetContext;subjectMask?:Uint8Array;protectionMask?:Uint8Array}>{
  if(candidateOutputKind(record)==='lighting-layers')throw editAnalysisHistoryError();
  if(record.blend!==undefined){
    blendGeometry(record,retainedBytes,bytes.byteLength);const raw=decodeBlendOutput(record,bytes),input=await blendInputs(record,read,raw,bytes.byteLength,retainedBytes);
    const behavior=editBehavior('blend',input.params,record.backend??'comfyui');
    return {snapshot:input.snapshot,image:prepareEditModel(raw,input.source,{preserveAlpha:behavior.preserveAlpha,align:false,matchColor:false,mask:input.mask}),preserveAlpha:behavior.preserveAlpha};
  }
  const input=await editAnalysisInputs(record,bytes,read,retainedBytes,true),mode=(record.params as any).mode;
  if(input.assetContext){
    const warning=assetTransparencyWarning(input.raw);if(warning)throw new DiagnosticError('invalid-output','output',warning);
    return {snapshot:input.snapshot,image:input.raw,preserveAlpha:false,assetContext:input.assetContext};
  }
  if(isBackgroundMode(mode)){
    if(backgroundCoverage(input.raw,input.mask)<.9)throw new DiagnosticError('invalid-output','output',t('背景区域仍有明显透明部分，未生成完整场景。请重新生成；此候选可另存检查，暂不回填。'));
    return {snapshot:input.snapshot,image:input.raw,preserveAlpha:false,subjectMask:input.subjectMask,protectionMask:input.protectionMask};
  }
  const image=prepareEditModel(input.raw,input.source,{preserveAlpha:input.behavior.preserveAlpha,align:input.behavior.alignSubject,matchColor:input.behavior.matchColor,mask:input.mask});
  return {snapshot:input.snapshot,image,preserveAlpha:input.behavior.preserveAlpha};
}
function decodeBlendOutput(record:JobRecord,bytes:Uint8Array):Raster {
  const model=(record.params as any)?.modelSize;
  if(bytes.length<33||!model)throw lightingHistoryError();const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(header.getUint32(16)!==model.width||header.getUint32(20)!==model.height||bytes[24]!==(record.template==='qwen21-local-v3-rgba16'?16:8))throw lightingHistoryError();
  return decodeModelPng(bytes,String(record.template??''));
}

function blendGeometry(record:JobRecord,retainedBytes=0,outputBytes=0){
  assertTaskNames(record);const metadata=validateBlendTaskMetadata(record.blend,record.id),snapshot=record.snapshot as Snapshot|undefined,params=record.params as any;
  if(!snapshot||record.relight!==undefined||params?.mode!=='blend'||params.outputKind!=='edit')throw lightingHistoryError();
  assertBlendSnapshot(metadata,{...snapshot,mask:new Uint8Array()});checkDocumentSize(snapshot.width,snapshot.height);
  const geometry=snapshot.captureGeometry!,b=snapshot.bounds,width=b.right-b.left,height=b.bottom-b.top;checkDocumentSize(width,height);
  if(!Number.isSafeInteger(geometry.width)||!Number.isSafeInteger(geometry.height)||geometry.width<1||geometry.height<1||geometry.width>width||geometry.height>height||geometry.width*geometry.height>IMAGE_BUDGETS.analysisPixels||Math.max(geometry.width,geometry.height)>IMAGE_BUDGETS.analysisSide)throw lightingHistoryError();
  const model=params.modelSize;if(!model||!Number.isSafeInteger(model.width)||!Number.isSafeInteger(model.height)||model.width<1||model.height<1||model.width*model.height>16_000_000)throw lightingHistoryError();
  const sourceBytes=geometry.width*geometry.height*(snapshot.nativeDepth===16?8:4),modelBytes=model.width*model.height*(record.template==='qwen21-local-v3-rgba16'?8:4);
  planEditApplyMemory(width,height,snapshot.nativeDepth!,sourceBytes*2+modelBytes*3+outputBytes+geometry.width*geometry.height*64,width*height*3,retainedBytes);
  return {metadata,snapshot,params,geometry,width,height};
}
/** New blend records retain exact raw/effective/protection planes; never infer native geometry from PNG. */
async function blendInputs(record:JobRecord,read:ReadBinary,raw?:Raster,outputBytes=0,retainedBytes=0){
  const expected=blendGeometry(record,retainedBytes,outputBytes),{geometry,metadata,params,width,height}=expected;
  if(raw&&(raw.width!==params.modelSize.width||raw.height!==params.modelSize.height))throw lightingHistoryError();
  const snapshot=await restoreSnapshot(record,read);if(!snapshot)throw lightingHistoryError();assertBlendSnapshot(metadata,snapshot);
  if(snapshot.mask.length!==width*height||!snapshot.mask.some(v=>v>0))throw lightingHistoryError();
  let selection:Uint8Array,protection:Uint8Array;
  try{selection=await read(`${record.id}-subject-mask.bin`);protection=await read(`${record.id}-protection-mask.bin`);}catch{throw lightingHistoryError();}
  if(!(selection instanceof Uint8Array)||!(protection instanceof Uint8Array)||selection.length!==width*height||protection.length!==width*height)throw lightingHistoryError();
  for(let p=0;p<snapshot.mask.length;p++)if(snapshot.mask[p]!==Math.round(selection[p]*(255-protection[p])/255))throw lightingHistoryError();
  const bytes=await read(`${record.id}-source.png`);if(bytes.length<33)throw lightingHistoryError();
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(header.getUint32(16)!==geometry.width||header.getUint32(20)!==geometry.height||bytes[24]!==snapshot.nativeDepth)throw lightingHistoryError();
  const source=decodePng(bytes);let hash=2166136261;for(const v of source.rgba)hash=Math.imul(hash^v,16777619);
  if((hash>>>0).toString(16)!==snapshot.sourceHash||rasterDepth(source)!==snapshot.nativeDepth)throw lightingHistoryError();
  const mask=downsampleSnapshotMask(snapshot,source.width,source.height);
  return {snapshot,source,mask,metadata,params};
}
/** Display-only source loading verifies the saved task; it never renews Photoshop authority. */
export async function loadCandidateSource(record:JobRecord,read:ReadBinary,retainedBytes=0):Promise<Raster>{
  if(record.blend!==undefined)return (await blendInputs(record,read,undefined,0,retainedBytes)).source;
  assertTaskNames(record);return decodePng(await read(`${record.id}-source.png`));
}
export async function prepareAssetCompositePreview(record:JobRecord,bytes:Uint8Array,read:ReadBinary,retainedBytes=0):Promise<Raster>{
  if(!selectionAssetContext(record))throw editAnalysisHistoryError();
  const budget=retainedBytes+1280*1280*16;
  let source:Raster,raw:Raster,mask:Uint8Array,maskWidth:number,maskHeight:number;
  if((record.snapshot as Snapshot).captureGeometry?.kind==='edit-analysis'){
    const input=await editAnalysisInputs(record,bytes,read,budget,false);
    source=input.source;raw=input.raw;mask=input.mask;maskWidth=raw.width;maskHeight=raw.height;
  }else{
    let savedSource:Uint8Array|undefined;
    const prepared=await prepareCandidate(record,bytes,async name=>{const data=await read(name);if(name===`${record.id}-source.png`)savedSource=data;return data;},budget);
    if(!savedSource||!prepared.snapshot)throw editAnalysisHistoryError();
    source=decodePng(savedSource);raw=prepared.image;mask=prepared.snapshot.mask;maskWidth=source.width;maskHeight=source.height;
  }
  const scale=Math.min(1,1280/Math.max(source.width,source.height)),width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
  const base=resize(source,width,height),overlay=resize(raw,width,height),effective=resampleGray(mask,maskWidth,maskHeight,width,height);
  const baseMax=rasterMax(base),overlayMax=rasterMax(overlay),rgba=new Uint8Array(width*height*4);
  for(let pixel=0;pixel<effective.length;pixel++){
    const offset=pixel*4,overAlpha=overlay.rgba[offset+3]/overlayMax*effective[pixel]/255,baseAlpha=base.rgba[offset+3]/baseMax,alpha=overAlpha+baseAlpha*(1-overAlpha);
    for(let channel=0;channel<3;channel++)rgba[offset+channel]=alpha?Math.round((overlay.rgba[offset+channel]/overlayMax*overAlpha+base.rgba[offset+channel]/baseMax*baseAlpha*(1-overAlpha))/alpha*255):0;
    rgba[offset+3]=Math.round(alpha*255);
  }
  return {width,height,rgba};
}
async function deriveBlendApplication(input:Awaited<ReturnType<typeof blendInputs>>,raw:Raster,signal?:AbortSignal){
  assertBlendLightingCapture({snapshot:input.snapshot,image:input.source,selectionMask:new Uint8Array(),protectionMask:new Uint8Array()});
  const {deriveBlendLayers}=await import('../features/blend/blend-layers');
  return deriveBlendLayers(input.source,raw,input.metadata.source,{signal,editMask:input.mask,extraction:input.metadata.localExtraction});
}
async function prepareBlendCandidate(record:JobRecord,bytes:Uint8Array,read:ReadBinary,retainedBytes:number):Promise<PreparedCandidate>{
  blendGeometry(record,retainedBytes,bytes.byteLength);
  const raw=decodeBlendOutput(record,bytes),input=await blendInputs(record,read,raw,bytes.byteLength,retainedBytes),outputKind=input.metadata.outputKind;
  if(outputKind==='full-result'){
    const behavior=editBehavior('blend',input.params,record.backend??'comfyui'),image={...input.source,rgba:input.source.rgba.slice()},max=rasterMax(image),depth=rasterDepth(image),clip=behavior.preserveAlpha&&input.snapshot.requiresClipping;
    const bounds={left:0,top:0,right:image.width,bottom:image.height};
    // Mirror the native writer at the bounded preview grid: sample at native
    // depth, reconstruct missing AI coverage, then apply one effective mask.
    // A clipped opaque patch changes base RGB while retaining the base alpha.
    for(const strip of imageStrips(bounds)){
      const start=strip.top*image.width,pixels=(strip.bottom-strip.top)*image.width;
      let patch=sampleEditStrip(raw,bounds,strip,depth);
      if(behavior.preserveAlpha)patch=retainSourceAlpha(patch,{width:image.width,height:strip.bottom-strip.top,rgba:input.source.rgba.subarray(start*4,(start+pixels)*4)});
      for(let p=0;p<pixels;p++){
        const at=(start+p)*4,local=p*4,amount=input.mask[start+p]/255;
        if(clip){
          if(image.rgba[at+3])for(let c=0;c<3;c++)image.rgba[at+c]=Math.round(image.rgba[at+c]+(patch.rgba[local+c]-image.rgba[at+c])*amount);
          continue;
        }
        const a=patch.rgba[local+3]/max*amount;if(!a)continue;
        const b=image.rgba[at+3]/max,alpha=a+b*(1-a);
        for(let c=0;c<3;c++)image.rgba[at+c]=alpha?Math.round((patch.rgba[local+c]*a+image.rgba[at+c]*b*(1-a))/alpha):0;
        image.rgba[at+3]=Math.round(alpha*max);
      }
    }
    return {image,snapshot:input.snapshot,outputKind};
  }
  try{
    const fields=await deriveBlendApplication(input,raw),{previewRelightLayers}=await import('../features/relight/relight-layers'),image=previewRelightLayers(input.source,fields);
    for(let p=0;p<input.mask.length;p++){const amount=input.mask[p]/255;for(let c=0;c<3;c++){const i=p*4+c;image.rgba[i]=Math.round(input.source.rgba[i]+(image.rgba[i]-input.source.rgba[i])*amount);}image.rgba[p*4+3]=input.source.rgba[p*4+3];}
    return {image,snapshot:input.snapshot,outputKind,lightingState:'composite',lightingSummary:fields.summary};
  }catch(error){
    const lightingFailure=error instanceof Error?error:new Error(String(error)),warning=t('无法提取可靠的光影层，当前显示 AI 参考图；可另存检查，不能回填：{0}',lightingFailure.message);
    return {image:raw,snapshot:input.snapshot,outputKind,lightingState:'reference-only',lightingFailure,warning};
  }
}

async function prepareEditAnalysisCandidate(record:JobRecord,bytes:Uint8Array,read:ReadBinary,retainedBytes:number):Promise<PreparedCandidate>{
  if(candidateOutputKind(record)==='lighting-layers')throw lightingHistoryError();
  const input=await editAnalysisInputs(record,bytes,read,retainedBytes,false),mode=(record.params as any).mode;
  let image=input.raw,warning:string|undefined;
  // Independent assets keep provider alpha. Selection feathering/protection
  // belongs to one native layer mask, outside candidate/export pixels.
  if(input.assetContext)return {image,snapshot:input.snapshot,warning:assetTransparencyWarning(image)};
  if(isBackgroundMode(mode)){
    if(backgroundCoverage(image,input.mask)<.9)warning=t('背景区域仍有明显透明部分，未生成完整场景。请重新生成；此候选可另存检查，暂不回填。');
    else{
      image=prepareBackgroundCandidate(image,input.source,input.subjectMask!,input.protectionMask);
    }
  }else image=prepareEditCandidate(image,input.source,{preserveAlpha:input.behavior.preserveAlpha,align:input.behavior.alignSubject,matchColor:input.behavior.matchColor,mask:input.mask});
  return {image,snapshot:input.snapshot,warning,...(candidateOutputKind(record)?{outputKind:candidateOutputKind(record)}:{})};
}

/** Decode only a bounded saved analysis PNG; a native mask never becomes a native RGBA raster. */
async function lightingInputs(record:JobRecord,raw:Raster,snapshot:Snapshot,read:ReadBinary){
  const metadata=record.relight as any,geometry=snapshot.captureGeometry,params=record.params as any;
  const extraction=validateRelightExtractionSettings(metadata?.localExtraction);
  if(candidateOutputKind(record)!=='lighting-layers'||metadata?.schemaVersion!==1||metadata.requestId!==record.id||!geometry||geometry.kind!=='relight-analysis'||!params||params.mode!=='relight'||params.outputKind!=='edit'||snapshot.backgroundComposite)throw lightingHistoryError();
  checkDocumentSize(snapshot.width,snapshot.height);
  const b=snapshot.bounds,w=b.right-b.left,h=b.bottom-b.top;checkDocumentSize(w,h);
  if(!Object.values(b).every(Number.isSafeInteger)||b.left<0||b.top<0||b.right>snapshot.width||b.bottom>snapshot.height||snapshot.mask.length!==w*h||!snapshot.mask.some(value=>value>0))throw lightingHistoryError();
  const scene=validateRelightScene(metadata.scene),s=scene.source;
  if(s.documentDepth!==(snapshot.nativeDepth??snapshot.depth))throw lightingHistoryError();
  if(s.documentId!==snapshot.documentId||s.sessionId!==snapshot.sessionId||s.historyId!==snapshot.historyId||s.sourceHash!==snapshot.sourceHash||s.docWidth!==snapshot.width||s.docHeight!==snapshot.height||s.profile!==snapshot.profile||s.documentMode!==String(snapshot.mode)||JSON.stringify(s.bounds)!==JSON.stringify(b)||JSON.stringify(s.layerIds)!==JSON.stringify(snapshot.sourceLayerIds))throw lightingHistoryError();
  const maskRef=`relight-mask-v1:sha256:${Array.from(sha256(snapshot.mask),value=>value.toString(16).padStart(2,'0')).join('')}`;
  if(s.maskRef!==maskRef)throw lightingHistoryError();
  if(!Number.isSafeInteger(geometry.width)||!Number.isSafeInteger(geometry.height)||geometry.width<1||geometry.height<1||geometry.width*geometry.height>IMAGE_BUDGETS.analysisPixels||Math.max(geometry.width,geometry.height)>IMAGE_BUDGETS.analysisSide)throw lightingHistoryError();
  if(!params.modelSize||raw.width!==params.modelSize.width||raw.height!==params.modelSize.height)throw lightingHistoryError();
  const bytes=await read(`${record.id}-source.png`);
  if(bytes.length<33)throw lightingHistoryError();
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(header.getUint32(16)!==geometry.width||header.getUint32(20)!==geometry.height)throw lightingHistoryError();
  const source=decodePng(bytes),mask=downsampleSnapshotMask(snapshot,source.width,source.height);
  if(rasterDepth(source)!==s.documentDepth)throw lightingHistoryError();
  return {source,mask,scene,extraction};
}

/** Re-derive on demand rather than retain full channel buffers for every candidate. No network IO. */
export async function prepareLightingLayerApplication(record:JobRecord,bytes:Uint8Array,read:ReadBinary,signal?:AbortSignal){
  if(candidateOutputKind(record)!=='lighting-layers')throw lightingHistoryError();
  if(record.blend!==undefined){
    blendGeometry(record,0,bytes.byteLength);const raw=decodeBlendOutput(record,bytes),input=await blendInputs(record,read,raw,bytes.byteLength);
    const fields=await deriveBlendApplication(input,raw,signal);return {snapshot:input.snapshot,fields,source:input.source,mask:input.mask};
  }
  const snapshot=await restoreSnapshot(record,read);if(!snapshot)throw lightingHistoryError();
  const raw=decodeModelPng(bytes,String(record.template??'')),inputs=await lightingInputs(record,raw,snapshot,read);
  const {deriveRelightLayers}=await import('../features/relight/relight-layers');
  const fields=await deriveRelightLayers(inputs.source,raw,inputs.scene,{signal,editMask:inputs.mask,extraction:inputs.extraction});
  return {snapshot,fields,source:inputs.source,mask:inputs.mask};
}
/** Reload the original UUID for either native geometry; never reuse display pixels as apply authority. */
export async function prepareSelectionAssetApplication(record:JobRecord,bytes:Uint8Array,read:ReadBinary,retainedBytes=0):Promise<{snapshot:Snapshot;image:Raster;preserveAlpha:false;assetContext:AssetContext}>{
  const assetContext=selectionAssetContext(record);if(!assetContext)throw editAnalysisHistoryError();
  if((record.snapshot as Snapshot).captureGeometry?.kind==='edit-analysis'){
    const prepared=await prepareEditAnalysisApplication(record,bytes,read,retainedBytes);
    return {snapshot:prepared.snapshot,image:prepared.image,preserveAlpha:false,assetContext};
  }
  const prepared=await prepareCandidate(record,bytes,read,retainedBytes);
  if(prepared.warning)throw new DiagnosticError('invalid-output','output',prepared.warning);
  return {snapshot:prepared.snapshot!,image:prepared.image,preserveAlpha:false,assetContext};
}
/** One read-only restoration/composition path for Results and the independent history preview. */
export async function prepareCandidate(record:JobRecord,bytes:Uint8Array,read:ReadBinary,retainedBytes=0):Promise<PreparedCandidate> {
  if(record.blend!==undefined)return prepareBlendCandidate(record,bytes,read,retainedBytes);
  const assetContext=selectionAssetContext(record);
  const geometry=(record.snapshot as Snapshot|undefined)?.captureGeometry;
  if(geometry?.kind==='edit-analysis')return prepareEditAnalysisCandidate(record,bytes,read,retainedBytes);
  const assetGeometry=assetContext&&!geometry?smallAssetGeometry(record,bytes.byteLength,retainedBytes):undefined;
  if(assetGeometry){
    // The budget uses the saved model grid/depth. Reject a different compressed
    // raster before inflation/decoding or loading any UUID-owned gray plane.
    if(bytes.length<33)throw editAnalysisHistoryError();
    const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),model=(record.params as any).modelSize;
    if(header.getUint32(16)!==model.width||header.getUint32(20)!==model.height||bytes[24]!==(record.template==='qwen21-local-v3-rgba16'?16:8))throw editAnalysisHistoryError();
  }
  const outputKind=candidateOutputKind(record),snapshot=await restoreSnapshot(record,read),params=record.params as any;
  if(snapshot&&(!params||typeof params.mode!=='string'||!['edit','asset','t2i'].includes(params.outputKind)))throw new DiagnosticError('invalid-output','output',t('历史编辑参数缺失或损坏，无法安全重建候选'));
  if(snapshot?.captureGeometry&&outputKind!=='lighting-layers')throw lightingHistoryError();
  let image=decodeModelPng(bytes,String(record.template??'')),warning:string|undefined;
  if(assetContext){
    const s=snapshot!,{width,height}=assetGeometry!,model=params.modelSize;
    if(image.width!==model.width||image.height!==model.height)throw editAnalysisHistoryError();
    if(s.mask.length!==width*height)throw editAnalysisHistoryError();
    const sourceBytes=await read(`${record.id}-source.png`);
    if(sourceBytes.length<33)throw editAnalysisHistoryError();
    const header=new DataView(sourceBytes.buffer,sourceBytes.byteOffset,sourceBytes.byteLength);
    if(header.getUint32(16)!==width||header.getUint32(20)!==height||sourceBytes[24]!==s.nativeDepth)throw editAnalysisHistoryError();
    const source=decodePng(sourceBytes);let hash=2166136261;for(const value of source.rgba)hash=Math.imul(hash^value,16777619);
    if((hash>>>0).toString(16)!==s.sourceHash||rasterDepth(source)!==s.nativeDepth)throw editAnalysisHistoryError();
    await validateAssetMasks(record,s,read);
    return {image,snapshot:s,warning:assetTransparencyWarning(image)};
  }
  if(outputKind==='lighting-layers'){
    if(!snapshot)throw lightingHistoryError();
    const inputs=await lightingInputs(record,image,snapshot,read);
    try{
      const {deriveRelightLayers,previewRelightLayers}=await import('../features/relight/relight-layers');
      const fields=await deriveRelightLayers(inputs.source,image,inputs.scene,{editMask:inputs.mask,extraction:inputs.extraction}),composite=previewRelightLayers(inputs.source,fields);
      // The native group uses this effective mask once. Match that in the bounded preview.
      for(let p=0;p<inputs.mask.length;p++){const amount=inputs.mask[p]/255;for(let c=0;c<3;c++){const i=p*4+c;composite.rgba[i]=Math.round(inputs.source.rgba[i]+(composite.rgba[i]-inputs.source.rgba[i])*amount);}composite.rgba[p*4+3]=inputs.source.rgba[p*4+3];}
      return {image:composite,snapshot,outputKind,lightingState:'composite',lightingSummary:fields.summary};
    }catch(error){
      // A rejected reference stays inspectable/exportable, never an applyable redraw fallback.
      const {RelightExtractionError}=await import('../features/relight/relight-layers');
      const lightingFailure=error instanceof RelightExtractionError?error:new DiagnosticError('relight-extraction','lighting-extraction',t('本地光影提取未完成；原始 AI 参考图已保留，请检查参考图和来源的作用范围。'));
      warning=t('无法提取可靠的光影层，当前显示 AI 参考图；可另存检查，不能回填：{0}',diagnostic(lightingFailure,'lighting-extraction').summary);
      return {image,snapshot,outputKind,lightingState:'reference-only',lightingFailure,warning};
    }
  }
  if(params?.outputKind==='edit'&&snapshot){
    const expected=params.modelSize;if(!expected||image.width!==expected.width||image.height!==expected.height)throw new DiagnosticError('invalid-output','output',t('候选尺寸与输入工作流不符，已保留原始输出；请检查后端，避免拉伸错位'));
    const source=decodePng(await read(`${record.id}-source.png`));
    const backgroundMasks=snapshot.backgroundComposite==='subject-background-v1'?await restoreBackgroundMasks(record,snapshot,source,read):undefined;
    const maskImage=resize(maskRaster(snapshot.mask,source.width,source.height),image.width,image.height);
    const mask=new Uint8Array(image.width*image.height);for(let i=0;i<mask.length;i++)mask[i]=maskImage.rgba[i*4];
    const behavior=editBehavior(params.mode,params,record.backend??'comfyui');
    if(isBackgroundMode(params.mode)&&backgroundCoverage(image,mask)<.9)warning='背景区域仍有明显透明部分，未生成完整场景。请重新生成；此候选可另存检查，暂不回填。';
    if(backgroundMasks){if(!warning)image=prepareBackgroundCandidate(image,source,backgroundMasks.subject,backgroundMasks.protection);}
    else image=prepareEditCandidate(image,source,{preserveAlpha:behavior.preserveAlpha,align:behavior.alignSubject,matchColor:behavior.matchColor,mask});
  }
  return {image,snapshot,warning,...(outputKind?{outputKind}:{})};
}
