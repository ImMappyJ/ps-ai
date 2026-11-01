import type {JobRecord} from '../generation/jobs';
import type {Snapshot,SelectionRange,Protection} from '../infrastructure/photoshop/photoshop';
import {checkDocumentSize,planEditApplyMemory} from '../imaging/budget';
import {supportsEdgeBlend,validateEdgeBlend} from '../features/editing/edge-blend';
import {validateBlendTaskMetadata} from '../features/blend/blend-session';
import {t} from '../localization/i18n';

type Scope='selection'|'document';
const invalid=()=>new Error(t('此历史没有完整、可验证的原始选区，请重新圈选；已有候选仍可导出。'));
function scope(record:JobRecord):Scope|undefined {
  const p=record.params as any,s=record.snapshot as Snapshot|undefined;
  if(!s)return undefined;
  if(record.selectionRange!==undefined){
    const value=record.selectionRange as any;
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||value.version!=='native-v1'||value.scope!=='selection'&&value.scope!=='document'||value.scope==='document'&&p?.mode!=='relight')throw invalid();
    return value.scope;
  }
  if(s.edgeBlend){
    const edge=validateEdgeBlend(s.edgeBlend);
    if(p?.outputKind!=='edit'||p.edgeBlend!==edge.radius||(edge.version==='outward-v1'?p.mode!=='edit':!supportsEdgeBlend(p.mode)))throw invalid();
    return 'selection';
  }
  if(s.backgroundComposite==='subject-background-v1'&&['background','scene'].includes(p?.mode)&&p.outputKind==='edit')return 'selection';
  if(record.blend&&p?.mode==='blend'&&p.outputKind==='edit'&&s.captureGeometry?.kind==='blend-analysis'){validateBlendTaskMetadata(record.blend,record.id);return 'selection';}
  if(['selection-v1','subject-v1'].includes(p?.assetContext)&&['effect','atmosphere'].includes(p.mode)&&p.outputKind==='asset')return 'selection';
  return undefined;
}
/** Metadata only: browsing history does not read pixels or touch Photoshop. */
export function historySelectionScope(record:JobRecord):Scope|undefined {try{return scope(record);}catch{return undefined;}}
/** Range recovery is independent of old candidate application permission. */
export async function readHistorySelection(record:JobRecord,read:(name:string)=>Promise<Uint8Array>,retainedBytes=0):Promise<{range:SelectionRange;protection:Protection;scope:Scope}> {
  const selectedScope=scope(record),s=record.snapshot as Snapshot|undefined,b=s?.bounds;
  if(!selectedScope||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.id)||!s||!b||![s.documentId,s.width,s.height,b.left,b.top,b.right,b.bottom].every(Number.isSafeInteger)||s.documentId<=0||typeof s.sessionId!=='string'||!s.sessionId||typeof s.mode!=='string'||s.depth===undefined||![8,16].includes(s.nativeDepth!)||b.left<0||b.top<0||b.right>s.width||b.bottom>s.height)throw invalid();
  checkDocumentSize(s.width,s.height);const width=b.right-b.left,height=b.bottom-b.top;checkDocumentSize(width,height);
  if(selectedScope==='document'&&(b.left!==0||b.top!==0||b.right!==s.width||b.bottom!==s.height))throw invalid();
  // Two saved planes and restoreSelection's immutable copy; no native RGBA plane.
  planEditApplyMemory(width,height,s.nativeDepth!,0,width*height*3,retainedBytes);
  let raw:Uint8Array,protectedMask:Uint8Array;
  try{raw=await read(`${record.id}-subject-mask.bin`);protectedMask=await read(`${record.id}-protection-mask.bin`);}catch{throw invalid();}
  if(!(raw instanceof Uint8Array)||!(protectedMask instanceof Uint8Array)||raw.length!==width*height||protectedMask.length!==raw.length||!raw.some(v=>v>0)||selectedScope==='document'&&!raw.every(v=>v===255))throw invalid();
  const geometry={documentId:s.documentId,sessionId:s.sessionId,width:s.width,height:s.height,bounds:{...b}};
  return {scope:selectedScope,range:{...geometry,mode:s.mode,depth:s.depth,mask:raw},protection:{...geometry,mask:protectedMask}};
}
