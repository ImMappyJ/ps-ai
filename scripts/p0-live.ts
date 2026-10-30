import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {ComfyClient,uuid} from '../src/infrastructure/backends/client';import {JobCoordinator,JobRecord} from '../src/generation/jobs';
import {buildGraph,templateForDepth} from '../src/generation/workflow';import {decodeModelPng,encodePng,Raster,maskRaster,rasterMax} from '../src/imaging/image';
import {diffusionLoader} from '../src/infrastructure/config/profile';import {loadP0Settings,parseP0Options,type P0Options} from './p0-config';
import {checkEnvironment} from '../src/diagnostics/environment';

function fixture():Raster {
  const width=992,height=992,rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    let c=y<690?[183,226,247]:[111,186,103];
    if(x>280&&x<720&&y>430&&y<770)c=[246,226,183];
    if(y>230&&y<440&&Math.abs(x-500)<(y-230)*1.24)c=[50,111,196];
    if(x>460&&x<560&&y>590&&y<770)c=[139,90,52];
    if((x-805)**2+(y-220)**2<70**2)c=[255,240,160];
    rgba.set([...c,255],(y*width+x)*4);
  }return {width,height,rgba};
}
function costume(red:boolean):Raster {
  const image={width:992,height:992,rgba:new Uint8Array(992*992*4)};
  for(let y=0;y<992;y++)for(let x=0;x<992;x++) {
    let c=[205,205,205];
    if((x-496)**2+(y-210)**2<80**2)c=[238,201,160];
    if(y>=300&&y<730&&Math.abs(x-496)<170+(y-300)*.12)c=red?[175,28,35]:[35,72,180];
    if(y>730&&y<955&&((x>330&&x<460)||(x>530&&x<660)))c=[38,38,45];
    if(y>590&&y<620&&x>310&&x<680)c=[215,173,57];
    if(red&&y>335&&y<695&&((Math.abs(x-340)<8)||(Math.abs(x-650)<8)||(Math.abs(y-365)<8&&x>340&&x<650)))c=[230,188,64];
    image.rgba.set([...c,255],(y*992+x)*4);
  }return image;
}
function inputFixtures():Record<string,Raster> {
  const original=fixture(),guide=new Uint8Array(992*992),marked={...original,rgba:new Uint8Array(original.rgba)};
  for(let y=200;y<450;y++)for(let x=230;x<770;x++){guide[y*992+x]=255;const offset=(y*992+x)*4;marked.rgba[offset]=Math.round(marked.rgba[offset]*.5+127);marked.rgba[offset+1]=Math.round(marked.rgba[offset+1]*.5);marked.rgba[offset+2]=Math.round(marked.rgba[offset+2]*.5);}
  const bodyMask=new Uint8Array(992*992);for(let y=300;y<730;y++)for(let x=275;x<715;x++)bodyMask[y*992+x]=255;
  return {original,mask:maskRaster(guide,992,992),marked,character:costume(false),characterMask:maskRaster(bodyMask,992,992),reference:costume(true)};
}
function examples(names:Record<string,string>) {
const edit='In <image1>, change only the blue roof of the house to bright red. Keep the house walls, door, grass, sun, and perspective unchanged.';
return [
  {name:'edit-clean-992',prompt:edit,source:names.original},
  {name:'edit-mask-992',prompt:edit+' <image2> is the aligned editing mask: white permits editing; black stays unchanged. Do not show the mask in the result.',source:names.original,guide:names.mask},
  {name:'edit-marked-992',prompt:edit+' <image2> highlights the allowed editing area in red. Use clean <image1> for the output. Do not show any red annotation.',source:names.original,guide:names.marked},
  {name:'role-three-refs-992',prompt:'Edit <image1>. <image2> marks the editable tunic in white. <image3> is a costume reference. Replace only the blue tunic with a red tunic with gold trim matching image3. Preserve the head, skin, trousers and gray background. Do not show the mask.',source:names.character,guide:names.characterMask,reference:names.reference},
  {name:'rgba-lightning-992',prompt:'A single branching blue magical lightning arc, glowing electric plasma, fine luminous tendrils, isolated visual effects asset, transparent background, RGBA image. No scenery, no text, no solid black or white background.'},
  {name:'rgba-mist-992',prompt:'Wispy drifting pale mist and delicate translucent smoke, soft semi-transparent edges, isolated compositing atmosphere asset, transparent background, RGBA image. No scenery, no text, no solid black or white background.'}
];
}
interface P0Runtime {transport?:typeof fetch;log?:(value:string)=>void;sampleVram?:()=>number|undefined;timeoutMs?:number;pollMs?:number}
function sampleVram():number|undefined {
  try{
    const value=Number(execFileSync('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true,timeout:3000,stdio:['ignore','pipe','ignore']}).trim().split('\n')[0]);
    return Number.isFinite(value)&&value>=0?value:undefined;
  }catch{return undefined;}
}
export async function runP0(options:P0Options,runtime:P0Runtime={}) {
  const settings=await loadP0Settings(options.settingsPath),root=path.resolve(options.outputDir),outputDepth=settings.outputDepth??8;
  const manifest=JSON.parse(await fs.readFile(new URL('../plugin/manifest.json',import.meta.url),'utf8'));
  const declaredMinimumHostVersion=manifest.host?.find((host:{app:string})=>host.app==='PS')?.minVersion;
  if(typeof declaredMinimumHostVersion!=='string')throw new Error('P0 requires the declared Photoshop minimum host contract');
  const log=runtime.log??console.log,loader=diffusionLoader(settings.models.unet),template=templateForDepth(outputDepth),parameters={seed:42,steps:25,resolution:992};
  const plan={run:options.run,backend:'comfyui' as const,baseUrl:settings.baseUrl,models:settings.models,outputDepth,loader,template,parameters,outputDir:root,hostContract:{declaredMinimumHostVersion,observedPhotoshop:false},fixtureType:'synthetic, not real-photo or Photoshop acceptance',examples:examples({original:'original',mask:'mask',marked:'marked',character:'character',characterMask:'characterMask',reference:'reference'}).map(probe=>({name:probe.name,kind:probe.source?'image-edit':'text-to-image'}))};
  try{await fs.lstat(root);throw new Error('P0 output directory already exists; choose a new directory');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  log(JSON.stringify(plan,null,2));
  if(!options.run)return plan;
  await fs.mkdir(path.dirname(root),{recursive:true});await fs.mkdir(root);
  await fs.writeFile(path.join(root,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});
  const client=new ComfyClient(settings.baseUrl,runtime.transport??fetch,30000,settings.models);
  const environment=await client.check(outputDepth);checkEnvironment(declaredMinimumHostVersion,environment.nodeInfo,settings.models,outputDepth);
  await fs.writeFile(path.join(root,'environment.json'),JSON.stringify(environment,null,2),{flag:'wx'});
  const names:Record<string,string>={};
  for(const [key,image] of Object.entries(inputFixtures())){
    const bytes=encodePng(image);await fs.writeFile(path.join(root,`${key}.png`),bytes,{flag:'wx'});names[key]=await client.upload(bytes,`${uuid()}-${key}.png`);
  }
  const report:Record<string,unknown>[]=[];
  const writeReport=()=>fs.writeFile(path.join(root,'report.json'),JSON.stringify({...plan,date:new Date().toISOString(),cases:report},null,2));
  await writeReport();
  for(const probe of examples(names)){
    const id=uuid(),clientId=uuid(),graph=buildGraph({...probe,...parameters,models:settings.models,outputDepth,requestId:id});
    const record:JobRecord={id,clientId,graph,state:'created',createdAt:new Date().toISOString(),probe:probe.name,backend:'comfyui',baseUrl:settings.baseUrl,models:settings.models,outputDepth,loader,template,parameters};
    const jobFile=path.join(root,`${probe.name}-job.json`),save=(value:JobRecord)=>fs.writeFile(jobFile,JSON.stringify(value,null,2));
    const begin=Date.now();let peakVramMiB:number|undefined,lastLog=0;
    const stop=async(reason:string):Promise<never>=>{
      record.state='unknown';record.recoveryReason=reason;await save(record);
      report.push({name:probe.name,id,state:'unknown',reason,baseUrl:settings.baseUrl,outputDepth,peakVramMiB});await writeReport();
      throw new Error(`P0 ${reason}; recover ${id} at ${settings.baseUrl}; do not resubmit`);
    };
    await new JobCoordinator(client,{save}).submit(record);log(`${probe.name} ${record.state} ${id}`);
    if(record.state==='failed'){report.push({name:probe.name,id,state:record.state,outputDepth});await writeReport();continue;}
    let finished=false;
    while(Date.now()-begin<(runtime.timeoutMs??1800000)){
      const memory=(runtime.sampleVram??sampleVram)();if(memory!==undefined&&Number.isFinite(memory)&&memory>=0)peakVramMiB=Math.max(memory,peakVramMiB??0);
      let status;
      try{status=await client.status(id);}catch{await stop('status-read-failed');}
      if(!status)throw new Error('P0 missing status');
      if(Date.now()-lastLog>30000){log(`${probe.name} ${status.state} ${id}`);lastLog=Date.now();}
      if(status.state==='unknown')await stop('ambiguous-pending');
      record.state=status.state;record.outputs=status.images;record.detail=status.detail;await save(record);
      if(status.state==='ready'){
        try{
          const imageBytes=await client.output(status.images![0]);await fs.writeFile(path.join(root,`${probe.name}.png`),imageBytes,{flag:'wx'});
          const image=decodeModelPng(imageBytes,template),maximum=rasterMax(image);let transparent=0,partial=0,opaque=0;
          for(let offset=3;offset<image.rgba.length;offset+=4){if(image.rgba[offset]===0)transparent++;else if(image.rgba[offset]===maximum)opaque++;else partial++;}
          report.push({name:probe.name,id,state:'ready',seconds:Math.round((Date.now()-begin)/100)/10,peakVramMiB,vramSampling:peakVramMiB===undefined?'unavailable':'nvidia-smi',width:image.width,height:image.height,outputDepth,alpha:{transparent,partial,opaque},outputs:status.images});
        }catch{
          report.push({name:probe.name,id,state:'output-validation-failed',outputDepth,outputs:status.images});await writeReport();
          throw new Error(`P0 output validation failed; saved task ${id}; do not resubmit`);
        }
        finished=true;break;
      }
      if(status.state==='failed'||status.state==='cancelled'){report.push({name:probe.name,id,state:status.state,code:status.code,outputDepth,seconds:(Date.now()-begin)/1000,peakVramMiB});finished=true;break;}
      await new Promise(resolve=>setTimeout(resolve,runtime.pollMs??2000));
    }
    if(!finished)await stop('pending-timeout');
    await writeReport();
  }
  log(`P0 reports saved: ${root}`);
  if(report.some(result=>result.state!=='ready'))throw new Error('P0 contains failed or cancelled examples; inspect report.json');
  return plan;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{await runP0(parseP0Options(process.argv.slice(2)));}catch{console.error('P0 stopped. Check arguments/settings and saved records; recover any saved UUID at its recorded endpoint before considering another run.');process.exitCode=1;}
}
