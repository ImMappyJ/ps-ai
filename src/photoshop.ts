import {Bounds,Raster,checkSize,expandPixels,maskRaster,effectiveMask,resize} from './image';
import {retainSourceAlpha} from './composite';
export interface Snapshot {documentId:number;width:number;height:number;profile:string;mode:string;depth:unknown;historyId:number;sessionId:string;bounds:Bounds;mask:Uint8Array;sourceHash:string;clipBaseLayerId?:number}
export interface Capture {snapshot:Snapshot;image:Raster}
export interface Protection {documentId:number;width:number;height:number;bounds:Bounds;mask:Uint8Array;sessionId:string}
export class PhotoshopAdapter {
  private applications=new Map<string,{documentId:number;historyId:number;layerId:number}>();
  constructor(public ps:any,public sessionId:string,private checkpoint:(stage:string)=>Promise<void>=async()=>{}){}
  private activeDocument():any {return this.ps.app.documents.length?this.ps.app.activeDocument:undefined;}
  private async rgbData(data:any):Promise<Raster> {
    if(!data||![8,16].includes(data.componentSize)||(data.components!==3&&data.components!==4))throw new Error('没有返回 RGB / RGBA 8/16-bit 数据');
    const values=await data.getData({chunky:true,fullRange:true}),max=data.componentSize===16?65535:255;
    const bytes=data.componentSize===8?new Uint8Array(values):Uint8Array.from(values as ArrayLike<number>,v=>Math.round(Math.min(1,Math.max(0,v/max))*255));
    const rgba=new Uint8Array(data.width*data.height*4);
    for(let i=0;i<data.width*data.height;i++){rgba.set(bytes.subarray(i*data.components,i*data.components+3),i*4);rgba[i*4+3]=data.components===4?bytes[i*4+3]:255;}
    return {width:data.width,height:data.height,rgba};
  }
  async importReference(file:any):Promise<Raster> {
    return this.ps.core.executeAsModal(async(context:any)=>{
      const previous=this.activeDocument(),existing=new Set(Array.from(this.ps.app.documents as any[]).map((d:any)=>d.id));
      const doc=await this.ps.app.open(file),owned=!existing.has(doc.id);let data:any;
      if(owned)await context.hostControl.registerAutoCloseDocument(doc.id);
      try {
        checkSize(doc.width,doc.height);
        const bounds={left:0,top:0,right:doc.width,bottom:doc.height};
        const result=await this.ps.imaging.getPixels({documentID:doc.id,sourceBounds:bounds,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false});
        data=result.imageData;return expandPixels(await this.rgbData(data),result.sourceBounds,bounds,result.level??0);
      } finally {
        data?.dispose();
        if(owned){await doc.closeWithoutSaving();await context.hostControl.unregisterAutoCloseDocument(doc.id);}
        if(previous&&Array.from(this.ps.app.documents as any[]).some((d:any)=>d.id===previous.id))this.ps.app.activeDocument=previous;
      }
    },{commandName:'ps-ai 读取并转换参考图'});
  }
  private document():any {
    const doc=this.activeDocument();if(!doc)throw new Error('请先打开 Photoshop 文档');
    const modes=[this.ps.constants.DocumentMode.RGB,this.ps.constants.DocumentMode.GRAYSCALE].filter(v=>v!==undefined);
    const depths=[this.ps.constants.BitsPerChannelType.EIGHT,this.ps.constants.BitsPerChannelType.SIXTEEN].filter(v=>v!==undefined);
    if(!modes.includes(doc.mode)||!depths.includes(doc.bitsPerChannel))throw new Error('支持 RGB / 灰度 8/16-bit；其他模式请先在副本中转换为 RGB，原文档不会自动转换');
    if(doc.quickMaskMode)throw new Error('请先退出快速蒙版模式');
    return doc;
  }
  private bounds(doc:any):Bounds {
    const b=doc.selection.bounds;if(!b)throw new Error('请先建立编辑选区');
    const bounds={left:Math.max(0,Math.floor(b.left)),top:Math.max(0,Math.floor(b.top)),right:Math.min(doc.width,Math.ceil(b.right)),bottom:Math.min(doc.height,Math.ceil(b.bottom))};
    checkSize(bounds.right-bounds.left,bounds.bottom-bounds.top);return bounds;
  }
  private async mask(documentId:number,bounds:Bounds):Promise<Uint8Array> {
    await this.checkpoint('capture.selection.read');
    const result=await this.ps.imaging.getSelection({documentID:documentId,sourceBounds:bounds});
    if(!result.imageData)throw new Error('选区为空');
    const data=result.imageData;
    try {
      if(![8,16,32].includes(data.componentSize)||data.components!==1)throw new Error('选区没有返回可用的灰度数据');
      const values=await data.getData({chunky:true,fullRange:true});
      const max=data.componentSize===16?65535:data.componentSize===32?1:255;
      const gray=Uint8Array.from(values as ArrayLike<number>,v=>Math.round(Math.max(0,Math.min(1,v/max))*255));
      const mapped=expandPixels(maskRaster(gray,data.width,data.height),result.sourceBounds,bounds,result.level??0);
      const out=new Uint8Array(mapped.width*mapped.height);for(let i=0;i<out.length;i++)out[i]=mapped.rgba[i*4];return out;
    } finally {data.dispose();await this.checkpoint('capture.selection.disposed');}
  }
  private needsClipping(image:Raster,mask:Uint8Array):boolean {
    return mask.some((v,i)=>v>0&&image.rgba[i*4+3]>0&&image.rgba[i*4+3]<255);
  }
  private clippingBase(doc:any,excludeLayerId?:number):any {
    // A top clipping stack may share one base. A separate hidden layer still breaks
    // that stack, so do not skip it or change the user's layer arrangement.
    const layer=Array.from(doc.layers as any[]).find((l:any)=>l.id!==excludeLayerId&&!l.isClippingMask);
    return layer&&layer.visible&&layer.kind===this.ps.constants.LayerKind.NORMAL&&layer.blendMode===this.ps.constants.BlendMode.NORMAL&&layer.opacity===100&&layer.fillOpacity===100?layer:undefined;
  }
  private async captureClippingBase(doc:any,bounds:Bounds,image:Raster,mask:Uint8Array):Promise<number|undefined> {
    if(!this.needsClipping(image,mask))return;
    const base=this.clippingBase(doc);if(!base)return;
    const result=await this.ps.imaging.getPixels({documentID:doc.id,layerID:base.id,sourceBounds:bounds,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false});
    const data=result.imageData;if(!data)return;
    try {
      const pixels=expandPixels(await this.rgbData(data),result.sourceBounds,bounds,result.level??0);
      if(mask.every((v,i)=>!v||pixels.rgba[i*4+3]===image.rgba[i*4+3]))return base.id;
    } finally {data.dispose();}
  }
  async capture(margin=.15,protection?:Protection,expectedDocumentId=this.activeDocument()?.id):Promise<Capture> {
    if(!Number.isFinite(margin)||margin<0||margin>1)throw new Error('上下文边距无效');
    await this.checkpoint('capture.start');
    return this.ps.core.executeAsModal(async()=>{
      const doc=this.document(),selection=this.bounds(doc);
      if(doc.id!==expectedDocumentId)throw new Error('活动文档已切换，请在来源文档重新生成');
      const pad=Math.max(32,Math.round(Math.min(selection.right-selection.left,selection.bottom-selection.top)*margin));
      const bounds={left:Math.max(0,selection.left-pad),top:Math.max(0,selection.top-pad),right:Math.min(doc.width,selection.right+pad),bottom:Math.min(doc.height,selection.bottom+pad)};
      checkSize(bounds.right-bounds.left,bounds.bottom-bounds.top);
      let mask=await this.mask(doc.id,bounds);
      if(protection) {
        if(protection.sessionId!==this.sessionId||protection.documentId!==doc.id||protection.width!==doc.width||protection.height!==doc.height)throw new Error('保护区来源文档已改变，请重新指定');
        const p=expandPixels(maskRaster(protection.mask,protection.bounds.right-protection.bounds.left,protection.bounds.bottom-protection.bounds.top),protection.bounds,bounds);
        const gray=new Uint8Array(mask.length);for(let i=0;i<gray.length;i++)gray[i]=p.rgba[i*4];mask=effectiveMask(mask,gray);
      }
      if(!mask.some(v=>v>0))throw new Error('编辑范围完全被保护区覆盖');
      await this.checkpoint('capture.pixels.read');
      const result=await this.ps.imaging.getPixels({documentID:doc.id,sourceBounds:bounds,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false});
      const data=result.imageData;
      if(!data)throw new Error('选区上下文没有可读取的像素');
      let image:Raster;
      try {
        await this.checkpoint('capture.pixels.getData');
        image=expandPixels(await this.rgbData(data),result.sourceBounds,bounds,result.level??0);
      } finally {data.dispose();await this.checkpoint('capture.pixels.disposed');}
      let hash=2166136261;for(const v of image.rgba)hash=Math.imul(hash^v,16777619);
      const clipBaseLayerId=await this.captureClippingBase(doc,bounds,image,mask);
      const snapshot:Snapshot={documentId:doc.id,width:doc.width,height:doc.height,profile:doc.colorProfileName,mode:doc.mode,depth:doc.bitsPerChannel,historyId:doc.activeHistoryState.id,sessionId:this.sessionId,bounds,mask,sourceHash:(hash>>>0).toString(16),...(clipBaseLayerId===undefined?{}:{clipBaseLayerId})};
      return {snapshot,image};
    },{commandName:'ps-ai 捕获选区'});
  }
  async protection():Promise<Protection> {
    const expectedDocumentId=this.activeDocument()?.id;
    return this.ps.core.executeAsModal(async()=>{
      const doc=this.document();if(doc.id!==expectedDocumentId)throw new Error('保护区来源文档已切换');const bounds=this.bounds(doc);const mask=await this.mask(doc.id,bounds);
      return {documentId:doc.id,width:doc.width,height:doc.height,bounds,mask,sessionId:this.sessionId};
    },{commandName:'ps-ai 读取人物保护区'});
  }
  private key(s:Snapshot):string {
    let hash=2166136261;for(const v of s.mask)hash=Math.imul(hash^v,16777619);
    return JSON.stringify([s.documentId,s.historyId,s.sourceHash,s.bounds,hash>>>0]);
  }
  private validate(s:Snapshot):any {
    if(s.sessionId!==this.sessionId)throw new Error('来源会话已结束，请重新捕获；候选仍可另存或新建文档');
    const doc=Array.from(this.ps.app.documents as any[]).find((d:any)=>d.id===s.documentId);
    if(!doc)throw new Error('来源文档已关闭，候选已保留');
    const own=this.applications.get(this.key(s));
    const historyMatches=doc.activeHistoryState.id===s.historyId||(own&&own.historyId===doc.activeHistoryState.id&&Array.from(doc.layers as any[]).some((l:any)=>l.id===own.layerId));
    if(doc.width!==s.width||doc.height!==s.height||doc.colorProfileName!==s.profile||doc.mode!==s.mode||doc.bitsPerChannel!==s.depth||!historyMatches)throw new Error('来源文档尺寸、颜色或内容状态已改变，请重新捕获');
    return doc;
  }
  private async batch(commands:unknown[]):Promise<void> {
    const results=await this.ps.action.batchPlay(commands,{});
    for(const r of results)if(r?._obj==='error')throw new Error(r.message||'Photoshop 命令失败');
  }
  async apply(snapshot:Snapshot,image:Raster,name:string,sourceAlpha?:Raster):Promise<number> {
    const width=snapshot.bounds.right-snapshot.bounds.left,height=snapshot.bounds.bottom-snapshot.bounds.top;
    checkSize(width,height);if(snapshot.mask.length!==width*height||!snapshot.mask.some(v=>v>0))throw new Error('候选回填蒙版无效');
    let restored=resize(image,width,height);if(sourceAlpha)restored=retainSourceAlpha(restored,sourceAlpha);
    const clip=!!sourceAlpha&&this.needsClipping(sourceAlpha,snapshot.mask);
    await this.checkpoint('apply.start');
    return this.ps.core.executeAsModal(async(context:any)=>{
      const doc=this.validate(snapshot);const previous=this.ps.app.activeDocument;
      const owned=this.applications.get(this.key(snapshot));
      if(clip&&(!snapshot.clipBaseLayerId||this.clippingBase(doc,owned&&owned.historyId===doc.activeHistoryState.id?owned.layerId:undefined)?.id!==snapshot.clipBaseLayerId))throw new Error('半透明来源没有安全的剪贴底层；请在副本中合并可见层后重新生成，候选仍可另存 PNG');
      // Photoshop's clipping stack supplies the base alpha exactly once. Writing
      // the same semi-transparent alpha into a NORMAL overlay would make it opaque.
      if(clip)for(let i=3;i<restored.rgba.length;i+=4)if(restored.rgba[i]>0)restored.rgba[i]=255;
      this.ps.app.activeDocument=doc;
      const suspension=await context.hostControl.suspendHistory({documentID:doc.id,name:'ps-ai 应用候选'});
      let pixels:any,mask:any;
      try {
        const own=this.applications.get(this.key(snapshot));
        if(own&&own.historyId===doc.activeHistoryState.id){const prior=Array.from(doc.layers as any[]).find((l:any)=>l.id===own.layerId);if(prior)await prior.delete();}
        const layer=await doc.createLayer(this.ps.constants.LayerKind.NORMAL,{name,opacity:100,blendMode:this.ps.constants.BlendMode.NORMAL});
        if(doc.layers[0]?.id!==layer.id)await layer.move(doc.layers[0],this.ps.constants.ElementPlacement.PLACEBEFORE);
        const sixteen=doc.bitsPerChannel===this.ps.constants.BitsPerChannelType.SIXTEEN;
        pixels=await this.ps.imaging.createImageDataFromBuffer(sixteen?Uint16Array.from(restored.rgba,v=>v*257):restored.rgba,{width,height,components:4,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',...(sixteen?{fullRange:true}:{})});
        await this.checkpoint('apply.putPixels');
        await this.ps.imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:pixels,replace:true,targetBounds:{left:snapshot.bounds.left,top:snapshot.bounds.top}});
        // A hide-all mask establishes black everywhere, including outside the written patch.
        await this.checkpoint('apply.mask.create');
        await this.batch([{_obj:'select',_target:[{_ref:'layer',_id:layer.id}],makeVisible:false},{_obj:'make',new:{_class:'channel'},at:{_ref:'channel',_enum:'channel',_value:'mask'},using:{_enum:'userMaskEnabled',_value:'hideAll'}}]);
        mask=await this.ps.imaging.createImageDataFromBuffer(sixteen?Uint16Array.from(snapshot.mask,v=>v*257):snapshot.mask,{width,height,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2',...(sixteen?{fullRange:true}:{})});
        await this.checkpoint('apply.mask.put');
        await this.ps.imaging.putLayerMask({documentID:doc.id,layerID:layer.id,imageData:mask,replace:false,targetBounds:{left:snapshot.bounds.left,top:snapshot.bounds.top}});
        if(clip){await this.checkpoint('apply.clip.create');layer.isClippingMask=true;}
        await context.hostControl.resumeHistory(suspension,true);
        this.applications.set(this.key(snapshot),{documentId:doc.id,historyId:doc.activeHistoryState.id,layerId:layer.id});
        return layer.id;
      } catch(error){await context.hostControl.resumeHistory(suspension,false);throw error;}
      finally {
        pixels?.dispose();mask?.dispose();await this.checkpoint('apply.disposed');
        if(previous&&previous.id!==doc.id&&Array.from(this.ps.app.documents as any[]).some((d:any)=>d.id===previous.id))this.ps.app.activeDocument=previous;
      }
    },{commandName:'ps-ai 应用为新图层'});
  }
  async opacity(documentId:number,layerId:number,value:number):Promise<void> {
    if(!Number.isFinite(value)||value<0||value>100)throw new Error('不透明度须为 0–100');
    await this.ps.core.executeAsModal(async()=>{
      const doc=Array.from(this.ps.app.documents as any[]).find((d:any)=>d.id===documentId);
      const layer=doc&&Array.from(doc.layers as any[]).find((l:any)=>l.id===layerId);
      if(!layer)throw new Error('应用图层已关闭或移动，请使用 PS 图层面板');
      const authorized=[...this.applications.entries()].filter(([,a])=>a.documentId===documentId&&a.layerId===layerId&&a.historyId===doc.activeHistoryState.id);
      layer.opacity=value;
      for(const [key,a] of authorized)this.applications.set(key,{...a,historyId:doc.activeHistoryState.id});
    },{commandName:'PS-AI FOR ME 调整图层不透明度'});
  }
  async newDocument(image:Raster,name:string):Promise<number> {
    checkSize(image.width,image.height);
    return this.ps.core.executeAsModal(async(context:any)=>{
      const doc=await this.ps.app.createDocument({width:image.width,height:image.height,resolution:72,mode:this.ps.constants.NewDocumentMode.RGB,fill:this.ps.constants.DocumentFill.TRANSPARENT,depth:8,name,profile:'sRGB IEC61966-2.1'});
      await context.hostControl.registerAutoCloseDocument(doc.id);
      let data:any;
      try {
        const layer=await doc.createLayer(this.ps.constants.LayerKind.NORMAL,{name:'ps-ai 生成'});
        data=await this.ps.imaging.createImageDataFromBuffer(image.rgba,{width:image.width,height:image.height,components:4,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1'});
        await this.ps.imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:data,replace:true});
        await context.hostControl.unregisterAutoCloseDocument(doc.id);return doc.id;
      }finally{data?.dispose();}
    },{commandName:'ps-ai 生图到新文档'});
  }
}
