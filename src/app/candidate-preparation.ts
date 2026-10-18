import type {JobRecord} from '../generation/jobs';
import {decodeModelPng,decodePng,resize,maskRaster,type Raster} from '../imaging/image';
import {prepareEditCandidate,prepareBackgroundCandidate,backgroundEditMask} from '../imaging/composite';
import {editBehavior,backgroundCoverage} from '../features/editing/edit-behavior';
import {isBackgroundMode} from '../generation/intent';
import type {Snapshot} from '../infrastructure/photoshop/photoshop';
import {DiagnosticError} from '../diagnostics/diagnostics';
import {t} from '../localization/i18n';

type ReadBinary=(name:string)=>Promise<Uint8Array>;
export interface PreparedCandidate {image:Raster;snapshot?:Snapshot;warning?:string}
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
/** One read-only restoration/composition path for Results and the independent history preview. */
export async function prepareCandidate(record:JobRecord,bytes:Uint8Array,read:ReadBinary):Promise<PreparedCandidate> {
  const snapshot=await restoreSnapshot(record,read),params=record.params as any;
  if(snapshot&&(!params||typeof params.mode!=='string'||!['edit','asset','t2i'].includes(params.outputKind)))throw new DiagnosticError('invalid-output','output',t('历史编辑参数缺失或损坏，无法安全重建候选'));
  let image=decodeModelPng(bytes,String(record.template??'')),warning:string|undefined;
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
  return {image,snapshot,warning};
}
