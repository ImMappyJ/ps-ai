import {PhotoshopAdapter} from './photoshop';import {uuid} from './client';import {encodePng,decodePng} from './image';
import {zlibSync} from 'fflate';
declare const require:(name:string)=>any;
declare const __P0_DISPLAY_P3_ICC__:number[]|null;
function profiledFixture(width:number,height:number,depth:number,values:Uint8Array|Uint16Array,icc:Uint8Array):Uint8Array {
  function u32(n:number){return new Uint8Array([n>>>24,n>>>16&255,n>>>8&255,n&255]);}
  function join(parts:Uint8Array[]){const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let at=0;for(const b of parts){out.set(b,at);at+=b.length;}return out;}
  function chunk(type:string,data:Uint8Array){const body=join([Uint8Array.from(type,c=>c.charCodeAt(0)),data]);let crc=0xffffffff;for(const b of body){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return join([u32(data.length),body,u32((crc^0xffffffff)>>>0)]);}
  const stride=width*4*(depth/8),scan=new Uint8Array((stride+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width*4;x++){const value=values[y*width*4+x],at=y*(stride+1)+1+x*(depth/8);if(depth===16){scan[at]=value>>>8;scan[at+1]=value&255;}else scan[at]=value;}
  return join([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',join([u32(width),u32(height),new Uint8Array([depth,6,0,0,0])])),chunk('iCCP',join([new Uint8Array([68,105,115,112,108,97,121,32,80,51,0,0]),zlibSync(icc)])),chunk('IDAT',zlibSync(scan)),chunk('IEND',new Uint8Array())]);
}
// Native acceptance test, intentionally independent of model inference.
export async function main():Promise<void>{
  const ps=require('photoshop'),uxp=require('uxp'),previous=ps.app.documents.length?ps.app.activeDocument:undefined;
  const initialIds=Array.from(ps.app.documents as any[]).map((d:any)=>d.id),owned:number[]=[],cases:any[]=[],trace:string[]=[];
  const width=128,height=96,full={left:0,top:0,right:width,bottom:height},srgb='sRGB IEC61966-2.1';
  const modal=(fn:()=>Promise<any>)=>ps.core.executeAsModal(fn,{commandName:'PS-AI P0 color acceptance'});
  const profiles=await ps.app.getColorProfiles('RGB');
  async function create(profile:string,depth:number,values:Uint8Array|Uint16Array,embedded?:Uint8Array){return modal(async()=>{
    if(embedded){const temp=await uxp.storage.localFileSystem.getTemporaryFolder(),file=await temp.createFile(`ps-ai-p3-native-${depth}.png`,{overwrite:true});await file.write(profiledFixture(width,height,depth,values,embedded).buffer,{format:uxp.storage.formats.binary});const doc=await ps.app.open(file);owned.push(doc.id);if(doc.colorProfileName!==profile)throw new Error(`Embedded profile changed on open: ${doc.colorProfileName}`);return doc;}
    const doc=await ps.app.createDocument({width,height,resolution:72,mode:ps.constants.NewDocumentMode.RGB,depth,fill:ps.constants.DocumentFill.TRANSPARENT,profile,name:`PS-AI P0 ${profile} ${depth}`});owned.push(doc.id);
    const layer=await doc.createLayer(ps.constants.LayerKind.NORMAL,{name:'native fixture'});let data:any;
    try{data=await ps.imaging.createImageDataFromBuffer(values,{width,height,components:4,colorSpace:'RGB',colorProfile:profile,...(depth===16?{fullRange:true}:{})});await ps.imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:data,replace:true});}finally{data?.dispose();}return doc;
  });}
  async function read(doc:any,layerID?:number,profile?:string):Promise<Uint32Array>{return modal(async()=>{
    const result=await ps.imaging.getPixels({documentID:doc.id,...(layerID===undefined?{}:{layerID}),sourceBounds:full,...(profile?{colorSpace:'RGB',colorProfile:profile}:{}),componentSize:doc.bitsPerChannel===ps.constants.BitsPerChannelType.SIXTEEN?16:8,applyAlpha:false}),data=result.imageData;
    try{
      if(result.level)throw new Error('Unexpected cached native read');
      const values=await data.getData({chunky:true,fullRange:true}),out=new Uint32Array(width*height*4),max=data.componentSize===16?65535:255,b=result.sourceBounds;
      for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){const from=(y*data.width+x)*data.components,to=((y+b.top)*width+x+b.left)*4;for(let c=0;c<3;c++)out[to+c]=values[from+c];out[to+3]=data.components===4?values[from+3]:max;}
      return out;
    }finally{data.dispose();}
  });}
  async function select(doc:any,mask:Uint8Array){return modal(async()=>{ps.app.activeDocument=doc;let data:any;try{data=await ps.imaging.createImageDataFromBuffer(mask,{width,height,components:1,colorSpace:'Grayscale',colorProfile:'Gray Gamma 2.2'});await ps.imaging.putSelection({documentID:doc.id,imageData:data,replace:true});}finally{data?.dispose();}});}
  function difference(a:ArrayLike<number>,b:ArrayLike<number>){let count=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)count++;max=Math.max(max,d);}return {count,max};}
  let fatal:string|undefined;
  try{
    for(const wanted of [srgb,'Adobe RGB (1998)','Display P3','ProPhoto RGB'])for(const depth of [8,16]){
      const row:any={requestedProfile:wanted,depth,passed:false};cases.push(row);
      try{
        const embedded=wanted==='Display P3'&&__P0_DISPLAY_P3_ICC__?new Uint8Array(__P0_DISPLAY_P3_ICC__):undefined;
        const profile=profiles.find((p:string)=>p.toLowerCase()===wanted.toLowerCase())??(embedded?wanted:undefined);if(!profile)throw new Error(`Installed profile missing: ${wanted}`);
        row.profile=profile;trace.push(`${profile}/${depth}: create true native fixture`);
        const max=depth===16?65535:255,values=depth===16?new Uint16Array(width*height*4):new Uint8Array(width*height*4);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          const i=(y*width+x)*4,gradient=depth===16?((y*width+x)*7+101)%65536:(x+y)%256;
          const rgb=y<24?[0,max,0]:y<48?[Math.round(max*.76),Math.round(max*.49),Math.round(max*.38)]:y<64?[gradient,gradient,gradient]:[gradient,max-gradient,Math.round(max*.6)];
          values.set([...rgb,x===0?0:x===1?Math.round(max*7/255):x===2?Math.round(max*.5):max],i);
        }
        row.nativeSub8BitSamples=0;if(depth===16)for(let i=0;i<values.length;i++)if(i%4!==3&&values[i]%257!==0)row.nativeSub8BitSamples++;
        const doc=await create(profile,depth,values,embedded),base=doc.activeLayers[0].id,adapter=new PhotoshopAdapter(ps,uuid());
        if(embedded)row.fixtureProfileSource='ICC registry DisplayP3.zip (embedded source; matching installed destination required for the independent reference)';
        const protection=new Uint8Array(width*height);for(let y=35;y<45;y++)protection.fill(255,y*width+50,y*width+60);
        await select(doc,protection);const savedProtection=await adapter.protection();
        const edit=new Uint8Array(width*height);for(let y=16;y<80;y++)for(let x=0;x<96;x++)edit[y*width+x]=x===95?128:y===16?64:255;
        await select(doc,edit);const captured=await adapter.capture(0,savedProtection),before=await read(doc),sourceBefore=await read(doc,base),count=doc.layers.length;
        if(captured.image.width!==width||captured.image.height!==height)throw new Error('Fixture did not capture full intended context');
        const reference=await modal(async()=>{const d=await doc.duplicate('PS-AI independent convertProfile',false);owned.push(d.id);await d.convertProfile(srgb,ps.constants.Intent.RELATIVECOLORIMETRIC,true,false);return d;});
        const referenceNative=await read(reference),reference8=Uint8Array.from(referenceNative,v=>Math.round(v/max*255));
        row.captureVsIndependentSrgb=difference(captured.image.rgba,reference8);
        if(row.captureVsIndependentSrgb.max>2)throw new Error('Capture differs from independent PS Convert to Profile by >2 sRGB8 codes');
        const identity=decodePng(encodePng(captured.image));row.pngIdentity=difference(identity.rgba,captured.image.rgba);
        const targetReference=await create(srgb,depth,depth===16?Uint16Array.from(identity.rgba,v=>v*257):identity.rgba);
        await modal(async()=>targetReference.convertProfile(profile,ps.constants.Intent.RELATIVECOLORIMETRIC,true,false));
        row.independentTargetProfile=targetReference.colorProfileName;
        if(row.independentTargetProfile!==profile)throw new Error('Independent conversion did not use the requested destination profile; install the test ICC before rerunning');
        const expected=await read(targetReference);await modal(async()=>{ps.app.activeDocument=reference;});
        trace.push(`${profile}/${depth}: apply to frozen source with foreign active document`);
        const applied=await adapter.apply(captured.snapshot,identity,'PS-AI color identity',captured.image),after=await read(doc),sourceAfter=await read(doc,base),layer=await read(doc,applied);
        row.nativeAlphaValues=Array.from(new Set(Array.from(before).filter((_,i)=>i%4===3)));row.nativeCenter={before:Array.from(before.slice(6000,6004)),expected:Array.from(expected.slice(6000,6004)),applied:Array.from(layer.slice(6000,6004))};
        row.sourceLayerDifference=difference(sourceBefore,sourceAfter);row.sourceProfilePreserved=doc.colorProfileName===profile;row.sourceDepthPreserved=doc.bitsPerChannel===(depth===16?ps.constants.BitsPerChannelType.SIXTEEN:ps.constants.BitsPerChannelType.EIGHT);
        let outside=0,alpha=0,convertedMax=0,gamutLossMax=0,opaqueSamples=0;
        for(let i=0;i<width*height;i++){
          if(!captured.snapshot.mask[i])for(let c=0;c<4;c++)if(before[i*4+c]!==after[i*4+c])outside++;
          if(before[i*4+3]!==after[i*4+3])alpha++;
          // PS PNG16 import reads full alpha as 65533 on this host. Include these
          // near-opaque samples; alpha itself is still compared exactly above.
          if(captured.snapshot.mask[i]===255&&before[i*4+3]>=max-(depth===16?2:0)){opaqueSamples++;for(let c=0;c<3;c++){convertedMax=Math.max(convertedMax,Math.abs(layer[i*4+c]-expected[i*4+c]));gamutLossMax=Math.max(gamutLossMax,Math.abs(before[i*4+c]-expected[i*4+c]));}}
        }
        row.maskZeroNativeDifference=outside;row.compositeAlphaNativeDifference=alpha;row.applyVsIndependentNativeMax=convertedMax;row.expectedGamutQuantizationNativeMax=gamutLossMax;row.opaqueComparisonSamples=opaqueSamples;
        // Native 16-bit reference permits at most one sRGB8 quantization step.
        row.nativeTolerance=depth===16?257:1;
        if(row.sourceLayerDifference.count||outside||alpha||convertedMax>row.nativeTolerance||!row.sourceProfilePreserved||!row.sourceDepthPreserved||!opaqueSamples)throw new Error(`Native identity contract failed: ${JSON.stringify(row)}`);
        await modal(async()=>{ps.app.activeDocument=doc;const r=await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'historyState',_enum:'ordinal',_value:'previous'}]}],{});if(r[0]?._obj==='error')throw new Error(r[0].message);});
        row.oneUndoDifference=difference(before,await read(doc));if(row.oneUndoDifference.count||doc.layers.length!==count)throw new Error('One undo did not restore source');
        row.passed=true;
      }catch(error){row.error=error instanceof Error?error.message:String(error);row.stack=error instanceof Error?error.stack:undefined;}
    }
  }catch(error){fatal=String(error);}
  finally{await modal(async()=>{for(const id of owned){const doc=Array.from(ps.app.documents as any[]).find((d:any)=>d.id===id);if(doc)await doc.closeWithoutSaving();}if(previous&&Array.from(ps.app.documents as any[]).some((d:any)=>d.id===previous.id))ps.app.activeDocument=previous;});}
  const finalIds=Array.from(ps.app.documents as any[]).map((d:any)=>d.id),report={date:new Date().toISOString(),host:String(uxp.host?.version??''),passed:!fatal&&cases.length===8&&cases.every(c=>c.passed)&&JSON.stringify(initialIds)===JSON.stringify(finalIds),cases,trace,fatal,initialIds,finalIds,profiles};
  const folder=await uxp.storage.localFileSystem.getTemporaryFolder(),file=await folder.createFile('ps-ai-color-report.json',{overwrite:true});await file.write(JSON.stringify(report,null,2));
  await ps.core.showAlert(`${report.passed?'PASS':'FAIL'} · ${cases.filter(c=>c.passed).length}/8 native color cases\n${cases.filter(c=>!c.passed).map(c=>`${c.requestedProfile}/${c.depth}: ${c.error}`).join('\n').slice(0,1200)}\n${file.nativePath}`);
}
