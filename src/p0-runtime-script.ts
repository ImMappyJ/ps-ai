import {ComfyClient,uuid} from './client';import {Storage} from './storage';import {PhotoshopAdapter} from './photoshop';import {encodePng,decodeModelPng,decodePng} from './image';
declare const require:(name:string)=>any;
declare const __P0_CANDIDATE__:string|null;
declare const __P0_NETWORK__:boolean;
export async function main():Promise<void> {
  const ps=require('photoshop'),uxp=require('uxp'),client=new ComfyClient(),adapter=new PhotoshopAdapter(ps,uuid());
  // Scripts have no plugin data folder. Exercise real Entry IO in their permitted temp folder.
  const store=new Storage({storage:{formats:uxp.storage.formats,localFileSystem:{getDataFolder:()=>uxp.storage.localFileSystem.getTemporaryFolder()}}});
  const trace:string[]=[];const initialDocumentCount=ps.app.documents.length;const result:Record<string,unknown>={passed:false,date:new Date().toISOString(),initialDocumentCount,storageLocation:'script temporary folder; plugin persistent data location is not tested'};
  try {
    const id=uuid();const raster={width:2,height:2,rgba:new Uint8Array([25,50,100,255,80,30,150,128,120,70,25,64,200,100,50,255])};
    const bytes=encodePng(raster);
    trace.push('uxp-binary-storage');await store.binary('runtime-source.png',bytes);const stored=decodePng(await store.readBinary('runtime-source.png'));if(stored.rgba.some((v,i)=>v!==raster.rgba[i]))throw new Error('binary storage round trip changed RGBA');
    trace.push('uxp-atomic-json');await store.json('runtime-record.json',{id,marker:'ps-ai'});const record=await store.readJson<{id:string}>('runtime-record.json',{id:''});if(record.id!==id)throw new Error('atomic metadata round trip failed');
    trace.push('uxp-job-history');await store.save({id,clientId:uuid(),graph:{},state:'probe',createdAt:new Date().toISOString()});if(!(await store.history()).some(r=>r.id===id))throw new Error('job history missing');
    trace.push('ps-reference-import');const root=await store.root();const entry=await root.getEntry('runtime-source.png');const reference=await adapter.importReference(entry);if(reference.width!==2||reference.height!==2)throw new Error('reference canvas changed');
    result.reference={width:reference.width,height:reference.height,alpha:[reference.rgba[3],reference.rgba[7],reference.rgba[11],reference.rgba[15]]};
    trace.push('adobe-rgb-jpeg-reference');
    const previous=ps.app.documents.length?ps.app.activeDocument:undefined,jpeg=await root.createFile('runtime-adobe-rgb.jpg',{overwrite:true});let fixture:any,opened:any;
    try {
      await ps.core.executeAsModal(async()=>{
        fixture=await ps.app.createDocument({width:32,height:32,resolution:72,mode:ps.constants.NewDocumentMode.RGB,fill:ps.constants.DocumentFill.WHITE,depth:8,name:'ps-ai ICC fixture',profile:'Adobe RGB (1998)'});
        const layer=await fixture.createLayer(ps.constants.LayerKind.NORMAL,{name:'ps-ai ICC color'}),rgba=new Uint8Array(32*32*4);for(let i=0;i<rgba.length;i+=4)rgba.set([200,30,90,255],i);
        const data=await ps.imaging.createImageDataFromBuffer(rgba,{width:32,height:32,components:4,colorSpace:'RGB',colorProfile:'Adobe RGB (1998)'});
        try{await ps.imaging.putPixels({documentID:fixture.id,layerID:layer.id,imageData:data,replace:true});}finally{data.dispose();}
        await fixture.saveAs.jpg(jpeg,{quality:12,embedColorProfile:true},true);await fixture.closeWithoutSaving();fixture=undefined;
        opened=await ps.app.open(jpeg);
      },{commandName:'ps-ai ICC 临时样例'});
      if(opened.colorProfileName!=='Adobe RGB (1998)')throw new Error('JPEG did not retain Adobe RGB profile');
      const expected=await ps.imaging.getPixels({documentID:opened.id,sourceBounds:{left:0,top:0,right:32,bottom:32},colorSpace:'RGB',colorProfile:'sRGB IEC61966-2.1',componentSize:8,applyAlpha:false});let expectedBytes:Uint8Array;
      try{expectedBytes=new Uint8Array(await expected.imageData.getData({chunky:true}));}finally{expected.imageData.dispose();}
      const historyId=opened.activeHistoryState.id,layers=opened.layers.length,converted=await adapter.importReference(jpeg);
      if(!Array.from(ps.app.documents as any[]).some((d:any)=>d.id===opened.id)||opened.activeHistoryState.id!==historyId||opened.layers.length!==layers)throw new Error('Import modified or closed existing reference document');
      const expectedRgb=Array.from(expectedBytes.slice(0,3)),actualRgb=Array.from(converted.rgba.slice(0,3));
      if(actualRgb.some((v,i)=>v!==expectedRgb[i])||actualRgb.every((v,i)=>Math.abs(v-[200,30,90][i])<3))throw new Error('Adobe RGB to sRGB conversion not observed');
      result.icc={format:'JPEG',embeddedProfile:opened.colorProfileName,width:converted.width,height:converted.height,sourceRgb:[200,30,90],expectedRgb,actualRgb,existingDocumentUnchanged:true};
    } finally {
      await ps.core.executeAsModal(async()=>{for(const doc of [opened,fixture])if(doc&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===doc.id))await doc.closeWithoutSaving();if(previous&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===previous.id))ps.app.activeDocument=previous;},{commandName:'ps-ai ICC 清理样例'});
    }
    result.scope=__P0_NETWORK__?'storage-reference-network':'storage-reference';
    if(__P0_NETWORK__) {
      trace.push('uxp-http-environment');const environment=await client.check();result.environment=environment.stats;
      trace.push('uxp-binary-upload');result.upload=await client.upload(bytes,`${id}-runtime.png`);
    }
    if(__P0_NETWORK__&&__P0_CANDIDATE__) {
      trace.push('uxp-own-history');const status=await client.status(__P0_CANDIDATE__);if(status.state!=='ready')throw new Error(`Candidate is ${status.state}`);
      trace.push('uxp-binary-output');const output=decodeModelPng(await client.output(status.images![0]),"qwen21-local-v2-rgba");result.candidate={id:__P0_CANDIDATE__,width:output.width,height:output.height};
    }
    if(!__P0_NETWORK__)result.network='not tested: standalone script network needs explicit UXP permission; plugin manifest declares loopback access';
    result.passed=true;
  }catch(error){result.error=error instanceof Error?error.message:String(error);}
  result.finalDocumentCount=ps.app.documents.length;if(ps.app.documents.length!==initialDocumentCount){result.passed=false;result.error='Reference probe leaked or closed a pre-existing document';}
  result.trace=trace;
  const folder=await uxp.storage.localFileSystem.getTemporaryFolder(),file=await folder.createFile('ps-ai-runtime-report.json',{overwrite:true});await file.write(JSON.stringify(result,null,2));
  await ps.core.showAlert(JSON.stringify(result,null,2)+'\n报告：'+file.nativePath);
}
