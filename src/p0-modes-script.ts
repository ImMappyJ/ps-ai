import {PhotoshopAdapter} from './photoshop';import {uuid} from './client';import {expandPixels,Raster} from './image';
declare const require:(name:string)=>any;
export async function main():Promise<void> {
  let injectFailure=false;const ps=require('photoshop'),uxp=require('uxp'),adapter=new PhotoshopAdapter(ps,uuid(),async(stage)=>{trace.push(stage);if(injectFailure&&stage==='apply.mask.put')throw new Error('intentional replacement rollback');});
  const previous=ps.app.documents.length?ps.app.activeDocument:undefined,initial=ps.app.documents.length;
  const created:number[]=[],cases:any[]=[],trace:string[]=[],observations:any[]=[];let error:string|undefined,stack:string|undefined;
  const width=96,height=64,full={left:0,top:0,right:width,bottom:height};
  async function read(doc:any,layerId?:number):Promise<Raster>{return ps.core.executeAsModal(async()=>{
    const r=await ps.imaging.getPixels({documentID:doc.id,...(layerId===undefined?{}:{layerID:layerId}),sourceBounds:full,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:doc.bitsPerChannel===ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false}),d=r.imageData;
    try{const values=await d.getData({chunky:true,fullRange:true}),b=d.componentSize===16?Uint8Array.from(values as ArrayLike<number>,v=>Math.round(v/65535*255)):new Uint8Array(values),rgba=new Uint8Array(d.width*d.height*4);for(let i=0;i<d.width*d.height;i++){rgba.set(b.subarray(i*d.components,i*d.components+3),i*4);rgba[i*4+3]=d.components===4?b[i*4+3]:255;}return expandPixels({width:d.width,height:d.height,rgba},r.sourceBounds,full,r.level??0);}finally{d.dispose();}
  },{commandName:'PS-AI FOR ME 模式验证读取'});}
  try{
    for(const [mode,profile] of [['RGB','sRGB IEC61966-2.1'],['RGB','Adobe RGB (1998)'],['GRAYSCALE','Gray Gamma 2.2']])for(const depth of [8,16]){
      trace.push(`${mode}/${depth}/${profile}: createDocument`);
      const doc=await ps.core.executeAsModal(async(ctx:any)=>{
        const d=await ps.app.createDocument({width,height,resolution:72,mode:ps.constants.NewDocumentMode[mode],depth,fill:ps.constants.DocumentFill.TRANSPARENT,profile,name:`PS-AI FOR ME test ${mode}${depth}`});created.push(d.id);
        trace.push('createLayer');const l=await d.createLayer(ps.constants.LayerKind.NORMAL,{name:'fixture'}),rgba=new Uint8Array(width*height*4),selection=new Uint8Array(width*height);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(x>=18&&x<78&&y>=12&&y<52)rgba.set([40+x,70+y,135,x===18?128:255],i*4);if(x>=8&&x<88&&y>=8&&y<56)selection[i]=x===8?128:255;}
        let data:any,mask:any;try{trace.push('fixture.putPixels');data=await ps.imaging.createImageDataFromBuffer(depth===16?Uint16Array.from(rgba,v=>v*257):rgba,{width,height,components:4,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',...(depth===16?{fullRange:true}:{})});await ps.imaging.putPixels({documentID:d.id,layerID:l.id,imageData:data,replace:true});trace.push('fixture.putSelection');mask=await ps.imaging.createImageDataFromBuffer(depth===16?Uint16Array.from(selection,v=>v*257):selection,{width,height,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2',...(depth===16?{fullRange:true}:{})});await ps.imaging.putSelection({documentID:d.id,imageData:mask,replace:true});}finally{data?.dispose();mask?.dispose();}
        return d;
      },{commandName:'PS-AI FOR ME 创建自己的模式验证文档'});
      trace.push('capture');const captured=await adapter.capture(0);trace.push('read.baseline');const before=await read(doc),beforeLayers=doc.layers.length,sourceMode=doc.mode,sourceDepth=doc.bitsPerChannel,sourceProfile=doc.colorProfileName;
      const patch={width,height,rgba:new Uint8Array(width*height*4)};for(let i=0;i<patch.rgba.length;i+=4)patch.rgba.set([210,60,100,255],i);
      trace.push('apply.first');const first=await adapter.apply(captured.snapshot,patch,'candidate 1',captured.image),firstPixels=await read(doc),after=await read(doc,first);
      let alphaDifference=0,outsideDifference=0;for(let i=0;i<width*height;i++){if(firstPixels.rgba[i*4+3]!==before.rgba[i*4+3])alphaDifference++;if(!captured.snapshot.mask[i])for(let c=0;c<4;c++)if(before.rgba[i*4+c]!==firstPixels.rgba[i*4+c])outsideDifference++;}
      const center=(32*width+48)*4;observations.push({mode,depth,sourceCenter:Array.from(captured.image.rgba.slice(center,center+4)),appliedCenter:Array.from(after.rgba.slice(center,center+4)),compositeCenter:Array.from(firstPixels.rgba.slice(center,center+4)),sourceAlphaPixels:captured.image.rgba.filter((v,i)=>i%4===3&&v>0).length,appliedAlphaPixels:after.rgba.filter((v,i)=>i%4===3&&v>0).length,appliedBounds:await ps.core.executeAsModal(async()=>Array.from(doc.layers as any[]).find((l:any)=>l.id===first)?.bounds,{commandName:'PS-AI FOR ME 检查自己的验证图层边界'})});
      trace.push('apply.second');const second=await adapter.apply({...captured.snapshot,mask:new Uint8Array(captured.snapshot.mask)},patch,'candidate 2',captured.image);
      if(first===second||doc.layers.length!==beforeLayers+1||Array.from(doc.layers as any[]).some((l:any)=>l.id===first))throw new Error('候选替换层数/ID 不符合预期');
      const secondPixels=await read(doc);injectFailure=true;let rollbackCaught=false;
      try{await adapter.apply(captured.snapshot,patch,'rollback candidate',captured.image);}catch(e){if(String(e).includes('intentional replacement rollback'))rollbackCaught=true;else throw e;}finally{injectFailure=false;}
      const rolledBack=await read(doc);if(!rollbackCaught||doc.layers.length!==beforeLayers+1||!Array.from(doc.layers as any[]).some((l:any)=>l.id===second)||rolledBack.rgba.some((v,i)=>v!==secondPixels.rgba[i]))throw new Error('失败替换没有恢复上一插件图层和像素');
      await ps.core.executeAsModal(async()=>{const r=await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'historyState',_enum:'ordinal',_value:'previous'}]}],{});if(r[0]?._obj==='error')throw new Error(r[0].message);},{commandName:'PS-AI FOR ME 模式验证撤销'});
      const restored=await read(doc),undoDifference=Array.from(restored.rgba).reduce((n,v,i)=>n+(v!==firstPixels.rgba[i]?1:0),0);
      if(alphaDifference||outsideDifference||undoDifference||doc.mode!==sourceMode||doc.bitsPerChannel!==sourceDepth||doc.colorProfileName!==sourceProfile)throw new Error(`模式 ${mode}${depth} 不一致：alpha=${alphaDifference}, outside=${outsideDifference}, undo=${undoDifference}`);
      cases.push({mode,depth,profile:sourceProfile,compositeAlphaDifference:alphaDifference,outsideDifference,undoDifference,clippingBase:captured.snapshot.clipBaseLayerId,candidateReplacement:true,failedReplacementRestored:true,sourceFormatPreserved:true,capturedSize:[captured.image.width,captured.image.height]});
    }
  }catch(e){error=e instanceof Error?e.message:String(e);stack=e instanceof Error?e.stack:undefined;}
  finally{await ps.core.executeAsModal(async()=>{for(const id of created){const doc=Array.from(ps.app.documents as any[]).find((d:any)=>d.id===id);if(doc)await doc.closeWithoutSaving();}if(previous&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===previous.id))ps.app.activeDocument=previous;},{commandName:'PS-AI FOR ME 清理自己的模式验证文档'});}
  const report={passed:!error&&cases.length===6,date:new Date().toISOString(),host:ps.app.version,cases,error,stack,trace,observations,initialDocumentCount:initial,finalDocumentCount:ps.app.documents.length};
  const folder=await uxp.storage.localFileSystem.getTemporaryFolder(),file=await folder.createFile('ps-ai-modes-report.json',{overwrite:true});await file.write(JSON.stringify(report,null,2));console.log('PS-AI FOR ME modes',JSON.stringify(report));await ps.core.showAlert(`${report.passed?'通过':'未通过'} · ${cases.length}/6 模式\n${error??''}\n报告：${file.nativePath}`);
}
