import {PhotoshopAdapter} from './photoshop';import {Raster,expandPixels} from './image';import {uuid} from './client';
declare const require:(name:string)=>any;
export async function main():Promise<void> {
  const ps=require('photoshop'),uxp=require('uxp'),adapter=new PhotoshopAdapter(ps,uuid());
  const countBefore=ps.app.documents.length,previous=countBefore?ps.app.activeDocument:undefined;
  const report:Record<string,unknown>={passed:false,date:new Date().toISOString(),initialDocumentCount:countBefore,scope:'native transparent trimming and forced thumbnail cache; no plugin loading/network claim'};
  let documentId:number|undefined;
  const width=2048,height=1536,full={left:0,top:0,right:width,bottom:height},ink={left:700,top:420,right:956,bottom:548};
  async function read(options:Record<string,unknown>={}) {
    const result=await ps.imaging.getPixels({documentID:documentId,sourceBounds:full,colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:8,applyAlpha:false,...options});const data=result.imageData;
      try{const bytes=new Uint8Array(await data.getData({chunky:true})),rgba=new Uint8Array(data.width*data.height*4);for(let i=0;i<data.width*data.height;i++){rgba.set(bytes.subarray(i*data.components,i*data.components+3),i*4);rgba[i*4+3]=data.components===4?bytes[i*4+3]:255;}return {image:{width:data.width,height:data.height,rgba} as Raster,bounds:result.sourceBounds,level:result.level??0,components:data.components};}finally{data.dispose();}
  }
  try {
    const rgba=new Uint8Array(width*height*4);for(let y=ink.top;y<ink.bottom;y++)for(let x=ink.left;x<ink.right;x++)rgba.set([80,120,180,255],(y*width+x)*4);
    documentId=await adapter.newDocument({width,height,rgba},'ps-ai P0 透明裁边与缓存');const doc=Array.from(ps.app.documents as any[]).find((d:any)=>d.id===documentId),originalLayers=doc.layers.length;
    const sourceLayer=doc.activeLayers[0].id,raw=await read({layerID:sourceLayer}),composite=await read(),before=expandPixels(composite.image,composite.bounds,full,composite.level);
    report.observedRead={returned:raw.bounds,returnedSize:[raw.image.width,raw.image.height],level:raw.level,layerBounds:doc.activeLayers[0].boundsNoEffects};
    report.compositeRead={returned:composite.bounds,returnedSize:[composite.image.width,composite.image.height],level:composite.level};
    if(['left','top','right','bottom'].some(key=>raw.bounds[key]!==ink[key as keyof typeof ink])||raw.level!==0)throw new Error('Native trim or full-resolution bounds differ from fixture');
    const expandedLayer=expandPixels(raw.image,raw.bounds,full,raw.level);let originalDifference=0,hiddenCompositeRgbDifferences=0;
    for(let i=0;i<rgba.length;i+=4)for(let ch=0;ch<4;ch++){
      if(expandedLayer.rgba[i+ch]!==rgba[i+ch])originalDifference++;
      if(before.rgba[i+ch]!==rgba[i+ch]){if(ch<3&&rgba[i+3]===0)hiddenCompositeRgbDifferences++;else originalDifference++;}
    }
    const sampleAt=(image:Raster,x:number,y:number)=>Array.from(image.rgba.slice((y*width+x)*4,(y*width+x)*4+4));
    report.pixelObservation={layerComponents:raw.components,compositeComponents:composite.components,layerRestoredCenter:sampleAt(expandedLayer,828,484),compositeCenter:sampleAt(before,828,484),compositeTransparent:sampleAt(before,0,0),originalDifference,hiddenCompositeRgbDifferences};
    if(originalDifference)throw new Error('Transparent trimmed pixels were not restored at original coordinates');
    report.trim={requested:full,returned:raw.bounds,returnedSize:[raw.image.width,raw.image.height],level:raw.level,restoredDifference:originalDifference};
    const cache=[];for(const targetWidth of [256,64]){
      const sample=await read({targetSize:{width:targetWidth}}),restored=expandPixels(sample.image,sample.bounds,full,sample.level),scale=2**sample.level;
      const samplingTolerance=Math.ceil(Math.max((sample.bounds.right-sample.bounds.left)*scale/sample.image.width,(sample.bounds.bottom-sample.bounds.top)*scale/sample.image.height));
      const center=(484*width+828)*4,far=(384*width+640)*4;
      if(restored.rgba[center+3]<245||restored.rgba[far+3]!==0||[80,120,180].some((v,i)=>Math.abs(restored.rgba[center+i]-v)>2))throw new Error('Cached image coordinate reconstruction differs at interior/exterior witnesses');
      let minX=width,minY=height,maxX=-1,maxY=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(restored.rgba[(y*width+x)*4+3]>=128){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
      const deviation=Math.max(Math.abs(minX-ink.left),Math.abs(minY-ink.top),Math.abs(maxX+1-ink.right),Math.abs(maxY+1-ink.bottom));
      if(deviation>samplingTolerance)throw new Error(`Cached alpha edge moved beyond one returned sample pixel: ${deviation} > ${samplingTolerance}`);
      cache.push({targetWidth,returned:sample.bounds,returnedSize:[sample.image.width,sample.image.height],level:sample.level,edgeDeviation:deviation,tolerance:samplingTolerance});
    }
    report.cache=cache;report.nonzeroCacheExercised=cache.some(c=>c.level>0);
    const selection={left:760,top:440,right:888,bottom:520};
    await ps.core.executeAsModal(async()=>{const data=await ps.imaging.createImageDataFromBuffer(new Uint8Array(128*80).fill(255),{width:128,height:80,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2'});try{await ps.imaging.putSelection({documentID:documentId,imageData:data,replace:true,targetBounds:{left:selection.left,top:selection.top}});}finally{data.dispose();}},{commandName:'ps-ai P0 透明上下文选区'});
    const captured=await adapter.capture(0),patch={...captured.image,rgba:new Uint8Array(captured.image.rgba.length)};for(let i=0;i<patch.rgba.length;i+=4)patch.rgba.set([240,20,40,128],i);
    const layerId=await adapter.apply(captured.snapshot,patch,'ps-ai P0 半透明回填');const afterRaw=await read(),after=expandPixels(afterRaw.image,afterRaw.bounds,full,afterRaw.level);let outsideDifference=0,changedPixels=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,inside=x>=selection.left&&x<selection.right&&y>=selection.top&&y<selection.bottom;if(inside){if(after.rgba[i]!==before.rgba[i])changedPixels++;}else for(let ch=0;ch<4;ch++)if(after.rgba[i+ch]!==before.rgba[i+ch])outsideDifference++;}
    const center=(480*width+824)*4,expected=[160,70,110,255],actual=Array.from(after.rgba.slice(center,center+4));
    report.applyObserved={captureBounds:captured.snapshot.bounds,outsideDifference,changedPixels,expectedCenter:expected,actualCenter:actual};
    if(outsideDifference||changedPixels!==128*80||actual.some((v,i)=>Math.abs(v-expected[i])>1))throw new Error('Trimmed patch placement, protection or straight-alpha blend failed');
    await ps.core.executeAsModal(async()=>{const layer=Array.from(doc.layers as any[]).find((l:any)=>l.id===layerId);layer.visible=false;},{commandName:'ps-ai P0 关闭生成图层'});
    const hiddenRaw=await read(),hidden=expandPixels(hiddenRaw.image,hiddenRaw.bounds,full,hiddenRaw.level);if(hidden.rgba.some((v,i)=>v!==before.rgba[i]))throw new Error('Hiding generated layer did not restore source');
    // Undo visibility, then the single apply transaction.
    await ps.core.executeAsModal(async()=>{for(let i=0;i<2;i++){const result=await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'historyState',_enum:'ordinal',_value:'previous'}]}],{});if(result[0]?._obj==='error')throw new Error(result[0].message);}},{commandName:'ps-ai P0 恢复原图'});
    const undoRaw=await read(),undone=expandPixels(undoRaw.image,undoRaw.bounds,full,undoRaw.level);if(doc.layers.length!==originalLayers||undone.rgba.some((v,i)=>v!==before.rgba[i]))throw new Error('Trimmed application undo failed');
    report.apply={captureBounds:captured.snapshot.bounds,outsideDifference,changedPixels,expectedCenter:expected,actualCenter:actual,hideLayerRestored:true,undoRestored:true};report.passed=true;
  } catch(error) {report.error=error instanceof Error?error.message:String(error);}
  finally {await ps.core.executeAsModal(async()=>{const own=Array.from(ps.app.documents as any[]).find((d:any)=>d.id===documentId);if(own)await own.closeWithoutSaving();if(previous&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===previous.id))ps.app.activeDocument=previous;},{commandName:'ps-ai P0 清理几何测试'});}
  report.finalDocumentCount=ps.app.documents.length;if(countBefore!==ps.app.documents.length){report.passed=false;report.error='Geometry probe changed pre-existing document count';}
  const root=await uxp.storage.localFileSystem.getTemporaryFolder(),file=await root.createFile('ps-ai-geometry-report.json',{overwrite:true});await file.write(JSON.stringify(report,null,2));await ps.core.showAlert(JSON.stringify(report,null,2)+'\n报告：'+file.nativePath);
}
