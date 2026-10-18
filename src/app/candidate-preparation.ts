import type {JobRecord} from '../generation/jobs';
import {decodeModelPng,decodePng,resize,maskRaster,rasterDepth,type Raster} from '../imaging/image';
import {prepareEditCandidate,prepareBackgroundCandidate,backgroundEditMask} from '../imaging/composite';
import {editBehavior,backgroundCoverage} from '../features/editing/edit-behavior';
import {isBackgroundMode} from '../generation/intent';
import type {Snapshot} from '../infrastructure/photoshop/photoshop';
import {DiagnosticError} from '../diagnostics/diagnostics';
import {t,errorText} from '../localization/i18n';
import {checkDocumentSize,downsampleSnapshotMask,IMAGE_BUDGETS} from '../imaging/budget';
import {validateRelightScene} from '../features/relight/relight-scene';
import type {RelightOutputKind} from '../features/relight/relight-session';
import type {RelightLayerFields} from '../features/relight/relight-layers';
import {sha256} from '@noble/hashes/sha2.js';

type ReadBinary=(name:string)=>Promise<Uint8Array>;
export interface PreparedCandidate {image:Raster;snapshot?:Snapshot;warning?:string;outputKind?:RelightOutputKind;lightingSummary?:RelightLayerFields['summary']}
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
export function candidateOutputKind(record:JobRecord):RelightOutputKind|undefined {
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

/** Decode only a bounded saved analysis PNG; a native mask never becomes a native RGBA raster. */
async function lightingInputs(record:JobRecord,raw:Raster,snapshot:Snapshot,read:ReadBinary){
  const metadata=record.relight as any,geometry=snapshot.captureGeometry,params=record.params as any;
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
  return {source,mask,scene};
}

/** Re-derive on demand rather than retain full channel buffers for every candidate. No network IO. */
export async function prepareLightingLayerApplication(record:JobRecord,bytes:Uint8Array,read:ReadBinary,signal?:AbortSignal){
  if(candidateOutputKind(record)!=='lighting-layers')throw lightingHistoryError();
  const snapshot=await restoreSnapshot(record,read);if(!snapshot)throw lightingHistoryError();
  const raw=decodeModelPng(bytes,String(record.template??'')),inputs=await lightingInputs(record,raw,snapshot,read);
  const {deriveRelightLayers}=await import('../features/relight/relight-layers');
  const fields=await deriveRelightLayers(inputs.source,raw,inputs.scene,{signal,editMask:inputs.mask});
  return {snapshot,fields,source:inputs.source,mask:inputs.mask};
}
/** One read-only restoration/composition path for Results and the independent history preview. */
export async function prepareCandidate(record:JobRecord,bytes:Uint8Array,read:ReadBinary):Promise<PreparedCandidate> {
  const outputKind=candidateOutputKind(record),snapshot=await restoreSnapshot(record,read),params=record.params as any;
  if(snapshot&&(!params||typeof params.mode!=='string'||!['edit','asset','t2i'].includes(params.outputKind)))throw new DiagnosticError('invalid-output','output',t('历史编辑参数缺失或损坏，无法安全重建候选'));
  if(snapshot?.captureGeometry&&outputKind!=='lighting-layers')throw lightingHistoryError();
  let image=decodeModelPng(bytes,String(record.template??'')),warning:string|undefined;
  if(outputKind==='lighting-layers'){
    if(!snapshot)throw lightingHistoryError();
    const inputs=await lightingInputs(record,image,snapshot,read);
    try{
      const {deriveRelightLayers,previewRelightLayers}=await import('../features/relight/relight-layers');
      const fields=await deriveRelightLayers(inputs.source,image,inputs.scene,{editMask:inputs.mask}),composite=previewRelightLayers(inputs.source,fields);
      // The native group uses this effective mask once. Match that in the bounded preview.
      for(let p=0;p<inputs.mask.length;p++){const amount=inputs.mask[p]/255;for(let c=0;c<3;c++){const i=p*4+c;composite.rgba[i]=Math.round(inputs.source.rgba[i]+(composite.rgba[i]-inputs.source.rgba[i])*amount);}composite.rgba[p*4+3]=inputs.source.rgba[p*4+3];}
      return {image:composite,snapshot,outputKind,lightingSummary:fields.summary};
    }catch(error){
      // A rejected reference stays inspectable/exportable, never an applyable redraw fallback.
      warning=t('无法提取可靠的光影层，当前显示 AI 参考图；可另存检查，不能回填：{0}',errorText(error instanceof Error?error.message:String(error)));
      return {image,snapshot,outputKind,warning};
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
