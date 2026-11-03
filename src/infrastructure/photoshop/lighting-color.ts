import {createIccSeed,extractPsdRgbProfile,MAX_ICC_PSD_BYTES,validateRgbProfile} from '../../imaging/icc-profile';
import {colorHash,type NativeLightingSource,type LightingColorService} from '../../imaging/native-lighting';
import {IMAGE_BUDGETS,ImageBudgetError,checkDocumentSize} from '../../imaging/budget';
import type {Raster} from '../../imaging/image';
import {DiagnosticError} from '../../diagnostics/diagnostics';

let serial=0;
const cancelled=(signal?:AbortSignal,context?:any)=>{if(signal?.aborted||context?.isCancelled)throw new DiagnosticError('cancelled','capture','原 ICC 色彩转换已取消');};
const unsupported=(message:string)=>new DiagnosticError('unsupported','capture',`原 ICC 光影转换不可用：${message}`);
const equal=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

/** All temporary files and documents belong to one short, bounded modal batch. */
export class PhotoshopLightingColor implements LightingColorService {
  private profileCache?:{documentId:number;baseline:string;written?:string;bytes:Uint8Array};
  constructor(private ps:any,private uxp:any){}
  private profileState(doc:any):string{return JSON.stringify([doc.id,doc.width,doc.height,doc.mode,doc.bitsPerChannel,doc.colorProfileName,doc.colorProfileType,doc.activeHistoryState.id]);}
  get retainedBytes():number{return this.profileCache?.bytes.byteLength??0;}
  /** The writer calls this only after its own ICC-preserving transaction commits. */
  rememberWrittenProfile(documentId:number,bytes:Uint8Array):void {
    const doc=Array.from(this.ps.app.documents as any[]).find(d=>d.id===documentId);if(!doc)return;
    validateRgbProfile(bytes);const state=this.profileState(doc),cache=this.profileCache;
    // Preserve the original verified history as well as the latest owned write.
    // Undo to that exact baseline needs no second full-size profile extraction.
    if(cache?.documentId===documentId&&equal(cache.bytes,bytes))cache.written=state;
    else this.profileCache={documentId,baseline:state,bytes:bytes.slice()};
  }
  private async batch<T>(signal:AbortSignal|undefined,fn:(ops:{context:any;file:()=>Promise<any>;own:(doc:any)=>Promise<any>;check:()=>void})=>Promise<T>):Promise<T>{
    cancelled(signal);
    let failure:{error:unknown}|undefined;
    try{return await this.ps.core.executeAsModal(async(context:any)=>{
      const previous=this.ps.app.documents.length?this.ps.app.activeDocument:undefined,existing=new Set(Array.from(this.ps.app.documents as any[]).map(d=>d.id)),owned:any[]=[],files:any[]=[];let result:T|undefined,error:unknown;
      const check=()=>cancelled(signal,context);
      try{check();const folder=await this.uxp.storage.localFileSystem.getTemporaryFolder();
        result=await fn({context,check,file:async()=>{check();const file=await folder.createFile(`ps-ai-icc-${Date.now()}-${++serial}.psd`,{overwrite:false});files.push(file);return file;},own:async(doc:any)=>{owned.push(doc);await context.hostControl.registerAutoCloseDocument(doc.id);check();return doc;}});check();
      }catch(e){error=e;}finally{
        // Open/duplicate may create a document and then reject. The modal owns
        // all documents added during this batch, even without a return value.
        for(const doc of Array.from(this.ps.app.documents as any[]))if(!existing.has(doc.id)&&!owned.some(d=>d.id===doc.id)){
          owned.push(doc);try{await context.hostControl.registerAutoCloseDocument(doc.id);}catch(e){error??=e;}
        }
        for(const doc of owned.reverse())try{if(Array.from(this.ps.app.documents as any[]).some(d=>d.id===doc.id))await doc.closeWithoutSaving();}catch(e){error??=e;}
        if(previous&&Array.from(this.ps.app.documents as any[]).some(d=>d.id===previous.id))try{this.ps.app.activeDocument=previous;}catch(e){error??=e;}
        for(const file of files)try{await file.delete();}catch(e){error??=e;}
      }
      try{cancelled(signal,context);}catch(e){error=e;}
      if(error){failure={error};throw error;}return result as T;
    },{commandName:'PS-AI 原 ICC 色彩转换'});}catch(error){throw failure?.error??error;}
  }
  private async profileFrom(doc:any,file:any):Promise<Uint8Array>{
    await doc.saveAs.psd(file,{embedColorProfile:true,layers:false,alphaChannels:false,maximizeCompatibility:true},true);
    const size=(await file.getMetadata()).size;if(!Number.isSafeInteger(size)||size<34||size>MAX_ICC_PSD_BYTES)throw unsupported('临时 ICC 文件超过预算');
    return extractPsdRgbProfile(new Uint8Array(await file.read({format:this.uxp.storage.formats.binary})));
  }
  /** Must run before full native mask allocation. No original pixels enter JS. */
  async captureProfile(documentId:number,retainedBytes=0,signal?:AbortSignal):Promise<Uint8Array>{
    return this.batch(signal,async o=>{
      const doc=Array.from(this.ps.app.documents as any[]).find(d=>d.id===documentId);if(!doc)throw unsupported('来源文档已关闭');
      const depth=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.EIGHT?8:0;
      if(doc.mode!==this.ps.constants.DocumentMode.RGB||!depth||doc.colorProfileType===this.ps.constants.ColorProfileType?.NONE)throw unsupported('需要已标记 RGB 8/16 位来源');
      const cache=this.profileCache,state=this.profileState(doc);
      if(cache?.documentId===documentId&&(cache.baseline===state||cache.written===state))return cache.bytes.slice();
      checkDocumentSize(doc.width,doc.height);const peak=doc.width*doc.height*(depth/8)*4+96_000_000+retainedBytes;
      if(!Number.isSafeInteger(retainedBytes)||retainedBytes<0||peak>IMAGE_BUDGETS.workingBytes)throw new ImageBudgetError(`提取原 ICC 预计需要 ${Math.ceil(peak/1_000_000)} MB，超过图像内存预算`);
      const before=JSON.stringify([doc.id,doc.width,doc.height,doc.mode,doc.bitsPerChannel,doc.colorProfileName,doc.colorProfileType,doc.activeHistoryState.id]);
      const copy=await o.own(await doc.duplicate('PS-AI ICC 临时副本',true));o.check();await copy.resizeImage(1,1);o.check();const profile=await this.profileFrom(copy,await o.file());o.check();
      if(before!==JSON.stringify([doc.id,doc.width,doc.height,doc.mode,doc.bitsPerChannel,doc.colorProfileName,doc.colorProfileType,doc.activeHistoryState.id]))throw unsupported('来源在读取时改变');this.profileCache={documentId,baseline:this.profileState(doc),bytes:profile.slice()};return profile;
    });
  }
  private async convert(source:NativeLightingSource,kind:'linear'|'encoded'|'srgb',input:Raster|Float32Array|undefined,signal?:AbortSignal):Promise<any>{
    cancelled(signal);validateRgbProfile(source.profileBytes);
    const {width,height,depth}=source,n=width*height;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||n>IMAGE_BUDGETS.analysisPixels||Math.max(width,height)>IMAGE_BUDGETS.analysisSide||![8,16].includes(depth))throw unsupported('分析尺寸或位深无效');
    if(kind==='encoded'&&(!(input instanceof Float32Array)||input.length!==n*4||input.some(v=>!Number.isFinite(v))))throw unsupported('线性数据无效');
    if(input&&!(input instanceof Float32Array)&&(input.width!==width||input.height!==height||input.rgba.length!==n*4))throw unsupported('模型分析数据尺寸不符');
    if(!input&&(source.nativePixels.length!==n*4||!(depth===16?source.nativePixels instanceof Uint16Array:source.nativePixels instanceof Uint8Array)))throw unsupported('原生数据尺寸或位深不符');
    return this.batch(signal,async o=>{
      const entry=await o.file();await entry.write(createIccSeed(source.profileBytes),{format:this.uxp.storage.formats.binary});o.check();
      const ids=new Set(Array.from(this.ps.app.documents as any[]).map(d=>d.id));
      const response=await this.ps.action.batchPlay([{_obj:'open',null:{_path:this.uxp.storage.localFileSystem.createSessionToken(entry),_kind:'local'},_options:{dialogOptions:'dontDisplay'}}],{});
      // Register every new document even when an open command returns an error.
      const added=Array.from(this.ps.app.documents as any[]).filter(d=>!ids.has(d.id));for(const d of added)await o.own(d);
      if(response[0]?._obj==='error'||added.length!==1)throw unsupported('无法打开实际 ICC 容器');const encoded=added[0];
      const actual=await this.profileFrom(encoded,await o.file());if(!equal(actual,source.profileBytes))throw unsupported('打开策略改变了实际 ICC；请保留嵌入配置文件后重试');o.check();
      if(depth===16)encoded.bitsPerChannel=this.ps.constants.BitsPerChannelType.SIXTEEN;
      if(!equal(await this.profileFrom(encoded,await o.file()),source.profileBytes))throw unsupported('位深转换改变了实际 ICC');
      await encoded.resizeCanvas(width,height);o.check();
      const put=async(doc:any,pixels:any,profile:string)=>{let data:any;try{data=await this.ps.imaging.createImageDataFromBuffer(pixels,{width,height,components:4,colorSpace:'RGB',colorProfile:profile,fullRange:true});await this.ps.imaging.putPixels({documentID:doc.id,layerID:doc.layers[0].id,imageData:data,replace:true});o.check();}finally{data?.dispose();}};
      const transfer=async(from:any,to:any)=>{let data:any;try{data=(await this.ps.imaging.getPixels({documentID:from.id,applyAlpha:false})).imageData;await this.ps.imaging.putPixels({documentID:to.id,layerID:to.layers[0].id,imageData:data,replace:true});o.check();}finally{data?.dispose();}};
      const read=async(doc:any,size:8|16|32,profile?:string)=>{let data:any;try{
        const r=await this.ps.imaging.getPixels({documentID:doc.id,sourceBounds:{left:0,top:0,right:width,bottom:height},componentSize:size,...(profile?{colorProfile:profile}:{}),applyAlpha:false});data=r.imageData;
        if(data.width!==width||data.height!==height||data.componentSize!==size||data.colorSpace!=='RGB'||![3,4].includes(data.components)||r.level&&r.level!==0||r.sourceBounds&&(r.sourceBounds.left!==0||r.sourceBounds.top!==0||r.sourceBounds.right!==width||r.sourceBounds.bottom!==height))throw unsupported('宿主返回的色彩网格无效');
        const values=await data.getData({chunky:true,fullRange:true}),Type=size===32?Float32Array:size===16?Uint16Array:Uint8Array,max=size===32?1:size===16?65535:255;
        if(!(values instanceof Type)||values.length!==n*data.components)throw unsupported('宿主返回的色彩缓冲区无效');const pixels=new Type(n*4);
        for(let p=0;p<n;p++){for(let c=0;c<3;c++){const v=values[p*data.components+c];if(!Number.isFinite(v))throw unsupported('宿主返回非有限颜色');pixels[p*4+c]=v;}const alpha=data.components===4?values[p*4+3]:max;if(!Number.isFinite(alpha)||alpha<0||alpha>max)throw unsupported('宿主返回无效透明度');pixels[p*4+3]=alpha;}o.check();return pixels;
      }finally{data?.dispose();}};
      if(kind==='srgb'){await put(encoded,source.nativePixels,'');return read(encoded,depth,'sRGB IEC61966-2.1');}
      const linear=await o.own(await encoded.duplicate('PS-AI 线性 ICC 临时副本',true));linear.bitsPerChannel=this.ps.constants.BitsPerChannelType.THIRTYTWO;o.check();
      if(kind==='encoded'){await put(linear,input,'');await transfer(linear,encoded);return read(encoded,depth);}
      if(input){await put(linear,(input as Raster).rgba,'sRGB IEC61966-2.1');}else{await put(encoded,source.nativePixels,'');await transfer(encoded,linear);}
      return read(linear,32);
    });
  }
  toLinear(source:NativeLightingSource,srgb?:Raster,signal?:AbortSignal):Promise<Float32Array>{return this.convert(source,'linear',srgb,signal);}
  fromLinear(source:NativeLightingSource,linear:Float32Array,signal?:AbortSignal):Promise<Uint8Array|Uint16Array>{return this.convert(source,'encoded',linear,signal);}
  async toSrgb(source:NativeLightingSource,signal?:AbortSignal):Promise<Raster>{return {width:source.width,height:source.height,rgba:await this.convert(source,'srgb',undefined,signal)};}
  async calibrate(profileBytes:Uint8Array,profileName:string,depth:8|16,signal?:AbortSignal):Promise<string>{
    cancelled(signal);const max=depth===16?65535:255,colors=[0,0,0,1,1,1,.5,.5,.5,1,0,0,0,1,0,0,0,1,.8,.2,.4,.2,.6,.9],pixels=depth===16?new Uint16Array(32):new Uint8Array(32);
    for(let p=0;p<8;p++){for(let c=0;c<3;c++)pixels[p*4+c]=Math.round(colors[p*3+c]*max);pixels[p*4+3]=max;}
    const source:NativeLightingSource={width:8,height:1,depth,profileName,profileBytes,nativePixels:pixels,calibration:''},linear=await this.toLinear(source,undefined,signal),back=await this.fromLinear(source,linear,signal);
    if(back.some((v,i)=>Math.abs(v-pixels[i])>(depth===16?2:1)))throw unsupported('色彩往返校验失败');
    // Fixed little-endian float serialization, independent of CPU endianness.
    const bytes=new Uint8Array(linear.length*4+1),v=new DataView(bytes.buffer);bytes[0]=1;linear.forEach((n,i)=>v.setFloat32(1+i*4,n,true));return colorHash(bytes);
  }
}
