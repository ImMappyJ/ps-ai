import {PhotoshopAdapter} from './photoshop';import {Raster,expandPixels,encodePng,decodePng} from './image';

export async function runHostProbe(ps:any,adapter:PhotoshopAdapter,trace:string[]=[]):Promise<Record<string,unknown>> {
  trace.push('png-round-trip');
  const width=128,height=96,rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([40+x,60+y,100,255],(y*width+x)*4);
  const original:Raster={width,height,rgba};
  // This also tests the bundled PNG encoder/decoder inside UXP, without Canvas or Node.
  const decoded=decodePng(encodePng(original));
  if(decoded.rgba.some((v,i)=>v!==rgba[i]))throw new Error('UXP PNG 往返不一致');
  const previous=ps.app.documents.length?ps.app.activeDocument:undefined;
  trace.push('create-source-document');
  const documentId=await adapter.newDocument(original,'ps-ai P0 临时测试');
  const doc=Array.from(ps.app.documents as any[]).find((d:any)=>d.id===documentId);
  const sourceLayer=doc.activeLayers[0].id;
  const full={left:0,top:0,right:width,bottom:height};
  async function setSelection(mask:Uint8Array) {
    await ps.core.executeAsModal(async()=>{let data:any;try {data=await ps.imaging.createImageDataFromBuffer(mask,{width,height,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2'});await ps.imaging.putSelection({documentID:documentId,imageData:data,replace:true});}finally{data?.dispose();}},{commandName:'ps-ai P0 建立灰度选区'});
  }
  async function read(layerID?:number):Promise<Raster> {
    return ps.core.executeAsModal(async()=>{
    const result=await ps.imaging.getPixels({documentID:documentId,...(layerID===undefined?{}:{layerID}),sourceBounds:full,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:8});const data=result.imageData;
    try{const bytes=new Uint8Array(await data.getData({chunky:true}));const out=new Uint8Array(data.width*data.height*4);for(let i=0;i<data.width*data.height;i++){out.set(bytes.subarray(i*data.components,i*data.components+3),i*4);out[i*4+3]=data.components===4?bytes[i*4+3]:255;}return expandPixels({width:data.width,height:data.height,rgba:out},result.sourceBounds,full,result.level??0);}finally{data.dispose();}
    },{commandName:'ps-ai P0 读取对照像素'});
  }
  let otherId:number|undefined;
  try {
    const protection=new Uint8Array(width*height);for(let y=35;y<47;y++)for(let x=50;x<65;x++)protection[y*width+x]=255;
    trace.push('capture-protection');await setSelection(protection);const p=await adapter.protection();
    const selection=new Uint8Array(width*height);
    for(let y=24;y<70;y++)for(let x=32;x<92;x++) {if((x-57)**2+(y-47)**2<19**2)selection[y*width+x]=255;}
    for(let y=60;y<65;y++)for(let x=84;x<91;x++)selection[y*width+x]=128;
    trace.push('capture-edit-selection');await setSelection(selection);const capture=await adapter.capture(.15,p);
    trace.push('read-original-pixels');
    const before=await read(),originalLayerBefore=await read(sourceLayer),layersBefore=doc.layers.length;
    const image={...capture.image,rgba:new Uint8Array(capture.image.rgba.length)};
    for(let i=0;i<image.rgba.length;i+=4)image.rgba.set([230,20,40,128],i);
    trace.push('create-other-document');otherId=await adapter.newDocument({width:2,height:2,rgba:new Uint8Array(16).fill(255)},'ps-ai P0 异文档');
    const other=ps.app.activeDocument,otherLayers=other.layers.length;
    trace.push('apply-masked-rgba');const layerId=await adapter.apply(capture.snapshot,image,'ps-ai P0 透明补丁');
    if(other.layers.length!==otherLayers)throw new Error('跨文档写入');
    trace.push('compare-original-and-protected-pixels');const after=await read(),originalLayerAfter=await read(sourceLayer);
    let protectedDifference=0,originalLayerDifference=0,editedPixels=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const b=capture.snapshot.bounds;
      const m=x>=b.left&&x<b.right&&y>=b.top&&y<b.bottom?capture.snapshot.mask[(y-b.top)*(b.right-b.left)+x-b.left]:0;
      const i=(y*width+x)*4;
      for(let c=0;c<4;c++){if(m===0&&before.rgba[i+c]!==after.rgba[i+c])protectedDifference++;if(originalLayerBefore.rgba[i+c]!==originalLayerAfter.rgba[i+c])originalLayerDifference++;}
      if(m>0&&before.rgba[i]!==after.rgba[i])editedPixels++;
    }
    if(protectedDifference||originalLayerDifference||!editedPixels)throw new Error(`像素保护失败：outside=${protectedDifference}, original=${originalLayerDifference}, edited=${editedPixels}`);
    trace.push('verify-full-canvas-mask');
    let maskDifference=0;
    await ps.core.executeAsModal(async()=>{
    const maskResult=await ps.imaging.getLayerMask({documentID:documentId,layerID:layerId,sourceBounds:full});
    try {
      const md=maskResult.imageData,bytes=new Uint8Array(await md.getData({chunky:true}));
      const mb=maskResult.sourceBounds;
      // Require a full canvas read for this probe, so a default-white exterior cannot hide.
      if(mb.left!==0||mb.top!==0||md.width!==width||md.height!==height)throw new Error('蒙版读取未覆盖整幅测试画布');
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const b=capture.snapshot.bounds;const expected=x>=b.left&&x<b.right&&y>=b.top&&y<b.bottom?capture.snapshot.mask[(y-b.top)*(b.right-b.left)+x-b.left]:0;if(bytes[y*width+x]!==expected)maskDifference++;}
    }finally{maskResult.imageData.dispose();}
    },{commandName:'ps-ai P0 读取对照蒙版'});
    if(maskDifference)throw new Error(`蒙版灰度或选区外黑色不一致：${maskDifference}`);
    trace.push('undo-one-history-state');await ps.core.executeAsModal(async()=>{ps.app.activeDocument=doc;const result=await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'historyState',_enum:'ordinal',_value:'previous'}]}],{});if(result[0]?._obj==='error')throw new Error(result[0].message);},{commandName:'ps-ai P0 一次撤销'});
    const undone=await read();
    if(doc.layers.length!==layersBefore||undone.rgba.some((v,i)=>v!==before.rgba[i]))throw new Error('一次撤销未恢复原始图层/像素');
    trace.push('rollback-injected-write-failure');
    const failingAdapter=new PhotoshopAdapter({app:ps.app,constants:ps.constants,core:ps.core,action:ps.action,imaging:{createImageDataFromBuffer:(...args:any[])=>ps.imaging.createImageDataFromBuffer(...args),putPixels:(...args:any[])=>ps.imaging.putPixels(...args),putLayerMask:async()=>{throw new Error('ps-ai P0 injected mask failure');}}},adapter.sessionId);
    let injected=false;
    try{await failingAdapter.apply(capture.snapshot,image,'ps-ai P0 回滚测试');}catch(error){if(String(error).includes('ps-ai P0 injected mask failure'))injected=true;else throw error;}
    const rolledBack=await read();
    if(!injected||doc.layers.length!==layersBefore||rolledBack.rgba.some((v,i)=>v!==before.rgba[i]))throw new Error('真实宿主事务回滚未恢复图层或像素');
    const geometry:Record<string,unknown>[]=[];
    for(const region of [{name:'top-left',x:0,y:0,w:3,h:3},{name:'top-right',x:125,y:0,w:3,h:3},{name:'bottom-left',x:0,y:93,w:3,h:3},{name:'bottom-right',x:125,y:93,w:3,h:3},{name:'narrow',x:63,y:1,w:1,h:90}]){
      trace.push('geometry-'+region.name);
      const m=new Uint8Array(width*height);for(let y=region.y;y<region.y+region.h;y++)for(let x=region.x;x<region.x+region.w;x++)m[y*width+x]=255;
      await setSelection(m);const c=await adapter.capture(0);const prior=await read(),priorLayers=doc.layers.length;
      const patch={...c.image,rgba:new Uint8Array(c.image.rgba.length)};for(let i=0;i<patch.rgba.length;i+=4)patch.rgba.set([230,20,40,255],i);
      await adapter.apply(c.snapshot,patch,'ps-ai P0 '+region.name);const afterCase=await read();let outside=0,inside=0;
      for(let i=0;i<m.length;i++){if(m[i]===0){for(let ch=0;ch<4;ch++)if(prior.rgba[i*4+ch]!==afterCase.rgba[i*4+ch])outside++;}else if(prior.rgba[i*4]!==afterCase.rgba[i*4])inside++;}
      if(outside||inside!==region.w*region.h)throw new Error(`几何 ${region.name} 失败：outside=${outside}, changed=${inside}`);
      await ps.core.executeAsModal(async()=>{const result=await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'historyState',_enum:'ordinal',_value:'previous'}]}],{});if(result[0]?._obj==='error')throw new Error(result[0].message);},{commandName:'ps-ai P0 几何撤销'});
      const restoredCase=await read();if(doc.layers.length!==priorLayers||restoredCase.rgba.some((v,i)=>v!==prior.rgba[i]))throw new Error('几何回填撤销失败：'+region.name);
      geometry.push({name:region.name,changedPixels:inside,outsideDifference:outside,undoRestored:true});
    }
    return {passed:true,host:ps.app.version??'27.0',date:new Date().toISOString(),pngRoundTrip:true,documentId,protectedDifference,originalLayerDifference,maskDifference,editedPixels,undoRestored:true,crossDocumentProtected:true,rollbackRestored:true,geometry,trace};
  } finally {
    await ps.core.executeAsModal(async()=>{
      for(const id of [otherId,documentId]){const target=Array.from(ps.app.documents as any[]).find((d:any)=>d.id===id);if(target)await target.closeWithoutSaving();}
      if(previous&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===previous.id))ps.app.activeDocument=previous;
    },{commandName:'ps-ai 清理临时验证文档'});
  }
}
