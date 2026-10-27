import {rasterDepth} from '../../imaging/image';
import {downsampleSnapshotMask} from '../../imaging/budget';
import {sha256} from '@noble/hashes/sha2.js';
import type {Capture,Snapshot} from '../../infrastructure/photoshop/photoshop';
import {RelightEditor,createRelightScene,validateRelightScene,sceneFingerprint,compileRelightScene,type RelightScene,type RelightSource,type RelightCapabilities} from './relight-scene';
import type {RelightExtractionSettings} from './relight-layers';

export type RelightScope='selection'|'document';
export type RelightOutputKind='lighting-layers'|'full-result';
/** Missing output metadata is a legacy full-result task, never a lighting layer claim. */
export function relightOutputKind(metadata?:{outputKind?:unknown}|null):RelightOutputKind {
  const kind=metadata?.outputKind===undefined?'full-result':metadata.outputKind;
  if(kind!=='lighting-layers'&&kind!=='full-result')throw new Error('Unsupported relight output kind');return kind;
}
export interface FrozenRelightSubmission {scene:RelightScene;fingerprint:string;capture:Capture;scope:RelightScope;outputKind:RelightOutputKind}
export interface RelightTaskMetadata {
  schemaVersion:1;requestId:string;provider:string;model:string;
  capabilities:{control:'semantic';edit:boolean;maxInputImages:number;maskMode:RelightCapabilities['maskMode'];seedSupport:boolean};
  scene:RelightScene;fingerprint:string;outputKind?:RelightOutputKind;
  /** Candidate-local extraction controls; never change the submitted scene or source authority. */
  localExtraction?:RelightExtractionSettings;
  geometry:{bounds:Snapshot['bounds'];modelWidth:number;modelHeight:number;modelContentRect:Snapshot['bounds'];providerCanvas:'provider-owned-content-relative'|'same-as-input'};
  color:{documentProfile:string;documentMode:string;documentDepth:8|16;retainedSourceDepth:8|16;sourceRepresentation?:'native-rgba'|'host-native-analysis';modelInput:'sRGB8';outputDepth:8|16;tagPolicy:string};
  seed?:number;conflictResolution?:'structured-lighting';result?:{jobId:string;outputFile:string};
}
function cloneCapture(c:Capture):Capture {
  if(c.snapshot.captureGeometry){
    // Capture transfers ownership of native mask planes. They are immutable in
    // the editor; duplicating them would add three document-sized allocations.
    return {...c,image:{...c.image,rgba:c.image.rgba.slice()},snapshot:{...c.snapshot,bounds:{...c.snapshot.bounds},captureGeometry:{...c.snapshot.captureGeometry},...(c.snapshot.sourceLayerIds?{sourceLayerIds:[...c.snapshot.sourceLayerIds]}:{})}};
  }
  return {...c,image:{...c.image,rgba:c.image.rgba.slice()},snapshot:{...c.snapshot,bounds:{...c.snapshot.bounds},mask:c.snapshot.mask.slice(),...(c.snapshot.sourceLayerIds?{sourceLayerIds:[...c.snapshot.sourceLayerIds]}:{})},selectionMask:c.selectionMask.slice(),protectionMask:c.protectionMask.slice(),...(c.subjectMask?{subjectMask:c.subjectMask.slice()}:{})};
}
function sameArray(a:ArrayLike<number>,b:ArrayLike<number>):boolean {if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function binding(c:Capture,snapshotId:string):RelightSource {
  const s=c.snapshot,depth=s.nativeDepth??s.depth;
  if(depth!==8&&depth!==16)throw new Error('Source document depth must be 8 or 16');
  if(s.captureGeometry&&rasterDepth(c.image)!==depth)throw new Error('Relight analysis depth must match the validated source depth');
  if(!s.sourceLayerIds?.length)throw new Error('无法确认可见合成来源图层，请重新读取原图');
  const previewMask=downsampleSnapshotMask(s,c.image.width,c.image.height);
  if(!previewMask.some((v,p)=>v>0&&c.image.rgba[p*4+3]>0))throw new Error('作用区域没有可见像素，请选择可见内容后重新读取原图');
  return {documentId:s.documentId,layerIds:[...s.sourceLayerIds],sessionId:s.sessionId,historyId:s.historyId,sourceHash:s.sourceHash,snapshotId,
    docWidth:s.width,docHeight:s.height,bounds:{...s.bounds},profile:s.profile,documentMode:String(s.mode),documentDepth:depth,maskRef:`relight-mask-v1:sha256:${Array.from(sha256(s.mask),v=>v.toString(16).padStart(2,'0')).join('')}`};
}
function sameBinding(a:RelightSource,b:RelightSource):boolean {
  const {snapshotId:ai,...first}=a,{snapshotId:bi,...second}=b;
  return JSON.stringify(first)===JSON.stringify(second);
}

/** The native-depth clean capture never becomes an illustration or a mutable UI buffer. */
export class RelightSession {
  /** Stage a fresh session before a native exclusion commits, retaining one capture clone. */
  static stageCreation(capture:Capture,snapshotId:string,lightId:string,scope:RelightScope='selection'):{session:RelightSession;commit(historyId:number):RelightSession} {
    const session=new RelightSession(capture,snapshotId,lightId,scope);
    return {session,commit:historyId=>{
      const scene=session.editor.snapshot(),editor=new RelightEditor({...scene,source:{...scene.source,historyId}});
      session.captured.snapshot.historyId=historyId;session.editor=editor;return session;
    }};
  }
  editor:RelightEditor;
  private captured:Capture;
  private snapshots=new Set<string>();
  constructor(capture:Capture,snapshotId:string,lightId:string,private capturedScope:RelightScope='selection',private selectedOutputKind:RelightOutputKind='lighting-layers'){
    relightOutputKind({outputKind:selectedOutputKind});
    this.captured=cloneCapture(capture);this.editor=new RelightEditor(createRelightScene(binding(this.captured,snapshotId),lightId));this.snapshots.add(snapshotId);
  }
  get fingerprint():string{return sceneFingerprint(this.editor.snapshot());}
  get sourceCapture():Capture{return this.captured;}
  get scope():RelightScope{return this.capturedScope;}
  ownsSnapshot(snapshotId:string):boolean{return this.snapshots.has(snapshotId);}
  get outputKind():RelightOutputKind{return this.selectedOutputKind;}
  setOutputKind(kind:RelightOutputKind):void {this.selectedOutputKind=relightOutputKind({outputKind:kind});}
  freeze():FrozenRelightSubmission{return {scene:this.editor.snapshot(),fingerprint:this.fingerprint,capture:this.captured,scope:this.capturedScope,outputKind:this.outputKind};}
  assertCaptureMatches(current:Capture):void {
    const a=this.captured,b=current;
    const fields=['documentId','width','height','profile','mode','depth','nativeDepth','historyId','sessionId','sourceHash','clipBaseLayerId','requiresClipping','backgroundComposite'] as const;
    if(fields.some(k=>a.snapshot[k]!==b.snapshot[k])||JSON.stringify(a.snapshot.bounds)!==JSON.stringify(b.snapshot.bounds)||
      !sameArray(a.snapshot.mask,b.snapshot.mask)||!sameArray(a.selectionMask,b.selectionMask)||!sameArray(a.protectionMask,b.protectionMask)||!sameArray(a.image.rgba,b.image.rgba)||a.image.width!==b.image.width||a.image.height!==b.image.height||rasterDepth(a.image)!==rasterDepth(b.image)||
      !sameArray(a.snapshot.sourceLayerIds??[],b.snapshot.sourceLayerIds??[])||JSON.stringify(a.snapshot.captureGeometry)!==JSON.stringify(b.snapshot.captureGeometry))throw new Error('来源或选区已改变，请重新读取原图；原有布光配置已保留');
  }
  restore(value:unknown,reuseOnCurrentSource=false):void {
    const scene=validateRelightScene(value),source=this.editor.snapshot().source;
    if(!sameBinding(source,scene.source)&&!reuseOnCurrentSource)throw new Error('保存的布光与当前来源不一致，请明确复用到当前快照或重新读取原图');
    this.editor=new RelightEditor({...scene,source:reuseOnCurrentSource?source:scene.source});
  }
  rebind(capture:Capture,snapshotId:string,scope:RelightScope=this.capturedScope):void {
    this.stageRebind(capture,snapshotId,scope)();
  }
  /** Validate and allocate before native recovery commits; publish only its final history baseline. */
  stageRebind(capture:Capture,snapshotId:string,scope:RelightScope=this.capturedScope):(historyId?:number)=>void {
    if(!this.snapshots.has(snapshotId)&&this.snapshots.size>=100)throw new Error('本次布光的来源记录已达上限，请从历史明确复用布光到新会话；已有结果仍可导出');
    const old=this.editor.snapshot(),next=cloneCapture(capture),source=binding(next,snapshotId),editor=new RelightEditor({...old,source});
    return (historyId=next.snapshot.historyId)=>{
      const committed=historyId===source.historyId?editor:new RelightEditor({...old,source:{...source,historyId}});
      next.snapshot.historyId=historyId;this.captured=next;this.capturedScope=scope;this.editor=committed;this.snapshots.add(snapshotId);
    };
  }
}

export function relightTaskMetadata(frozen:FrozenRelightSubmission,requestId:string,caps:RelightCapabilities,size:{width:number;height:number},outputDepth:8|16,seed:number):RelightTaskMetadata {
  // The compiler validates capability primitives and the scene. Copy only public fields.
  compileRelightScene(frozen.scene,caps);
  const scene=validateRelightScene(frozen.scene),source=scene.source;
  return {schemaVersion:1,requestId,provider:caps.provider,model:caps.model,
    capabilities:{control:'semantic',edit:caps.edit,maxInputImages:caps.maxInputImages,maskMode:caps.maskMode,seedSupport:caps.seed},scene,fingerprint:sceneFingerprint(scene),outputKind:frozen.outputKind,
    geometry:{bounds:{...source.bounds},modelWidth:size.width,modelHeight:size.height,modelContentRect:{left:0,top:0,right:size.width,bottom:size.height},providerCanvas:caps.provider==='comfyui'?'same-as-input':'provider-owned-content-relative'},
    color:{documentProfile:source.profile,documentMode:source.documentMode,documentDepth:source.documentDepth,retainedSourceDepth:frozen.capture.snapshot.captureGeometry?source.documentDepth:rasterDepth(frozen.capture.image),sourceRepresentation:frozen.capture.snapshot.captureGeometry?'host-native-analysis':'native-rgba',modelInput:'sRGB8',outputDepth,tagPolicy:caps.provider==='comfyui'&&outputDepth===8?'qwen21-local-v2-rgba verified untagged exception':'tagged-sRGB-required'},
    ...(caps.seed?{seed}:{})};
}

interface DraftStorage {json(name:string,value:unknown):Promise<void>;readJson<T>(name:string,fallback:T):Promise<T>}
/** One bounded metadata draft; serialize writers sharing Storage.json's temporary name. */
export class RelightDraftStore {
  private chain:Promise<void>=Promise.resolve();
  constructor(private storage:DraftStorage){}
  save(scene:RelightScene):Promise<void>{
    const clean=validateRelightScene(scene),operation=this.chain.catch(()=>{}).then(()=>this.storage.json('relight-draft.json',{schemaVersion:1,scene:clean}));
    this.chain=operation;return operation;
  }
  async load():Promise<RelightScene|undefined>{
    await this.chain.catch(()=>{});
    const saved=await this.storage.readJson<{schemaVersion?:unknown;scene?:unknown}|null>('relight-draft.json',null);
    if(saved===null)return;
    if(saved.schemaVersion!==1||Object.keys(saved).some(k=>!['schemaVersion','scene'].includes(k)))throw new Error('保存的布光配置无效，请重新配置或读取有效历史');
    return validateRelightScene(saved.scene);
  }
}
