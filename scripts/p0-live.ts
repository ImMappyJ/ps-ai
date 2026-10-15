import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {ComfyClient,uuid} from '../src/client';import {JobCoordinator,JobRecord} from '../src/jobs';
import {buildGraph} from '../src/workflow';import {decodePng,encodePng,Raster,maskRaster} from '../src/image';

const client=new ComfyClient();
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const root=path.resolve('artifacts/p0',stamp);await fs.mkdir(root,{recursive:true});
await fs.writeFile('artifacts/p0/latest.txt',root,'utf8');
const environment=await client.check();await fs.writeFile(path.join(root,'environment.json'),JSON.stringify(environment,null,2));
console.log('P0 environment OK. Report directory:',root);
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
const original=fixture();const guide=new Uint8Array(992*992);const marked={...original,rgba:new Uint8Array(original.rgba)};
for(let y=200;y<450;y++)for(let x=230;x<770;x++){guide[y*992+x]=255;const i=(y*992+x)*4;marked.rgba[i]=Math.round(marked.rgba[i]*.5+127);marked.rgba[i+1]=Math.round(marked.rgba[i+1]*.5);marked.rgba[i+2]=Math.round(marked.rgba[i+2]*.5);}
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
const bodyMask=new Uint8Array(992*992);for(let y=300;y<730;y++)for(let x=275;x<715;x++)bodyMask[y*992+x]=255;
const inputs:{[key:string]:Raster}={original,mask:maskRaster(guide,992,992),marked,character:costume(false),characterMask:maskRaster(bodyMask,992,992),reference:costume(true)};
const names:Record<string,string>={};
for(const [key,image] of Object.entries(inputs)) {const bytes=encodePng(image);await fs.writeFile(path.join(root,`${key}.png`),bytes);names[key]=await client.upload(bytes,`${uuid()}-${key}.png`);}
const edit='In <image1>, change only the blue roof of the house to bright red. Keep the house walls, door, grass, sun, and perspective unchanged.';
const cases=[
  {name:'edit-clean-992',prompt:edit,source:names.original},
  {name:'edit-mask-992',prompt:edit+' <image2> is the aligned editing mask: white permits editing; black stays unchanged. Do not show the mask in the result.',source:names.original,guide:names.mask},
  {name:'edit-marked-992',prompt:edit+' <image2> highlights the allowed editing area in red. Use clean <image1> for the output. Do not show any red annotation.',source:names.original,guide:names.marked},
  {name:'role-three-refs-992',prompt:'Edit <image1>. <image2> marks the editable tunic in white. <image3> is a costume reference. Replace only the blue tunic with a red tunic with gold trim matching image3. Preserve the head, skin, trousers and gray background. Do not show the mask.',source:names.character,guide:names.characterMask,reference:names.reference},
  {name:'rgba-lightning-992',prompt:'A single branching blue magical lightning arc, glowing electric plasma, fine luminous tendrils, isolated visual effects asset, transparent background, RGBA image. No scenery, no text, no solid black or white background.'},
  {name:'rgba-mist-992',prompt:'Wispy drifting pale mist and delicate translucent smoke, soft semi-transparent edges, isolated compositing atmosphere asset, transparent background, RGBA image. No scenery, no text, no solid black or white background.'}
];
const report:any[]=[];
const writeReport=()=>fs.writeFile(path.join(root,'report.json'),JSON.stringify({date:new Date().toISOString(),fixtureType:'synthetic, not a real COSPLAY photo acceptance set',cases:report},null,2));
for(const probe of cases) {
  const id=uuid(),clientId=uuid();const graph=buildGraph({...probe,requestId:id,seed:42,steps:25,resolution:992});
  const record:JobRecord={id,clientId,graph,state:'created',createdAt:new Date().toISOString(),probe:probe.name};
  const jobFile=path.join(root,`${probe.name}-job.json`);
  const save=async(r:JobRecord)=>{await fs.writeFile(jobFile,JSON.stringify(r,null,2));};
  const begin=Date.now();let peakVramMiB=0,lastLog=0;
  await new JobCoordinator(client,{save}).submit(record);console.log(probe.name,record.state,id);
  if(record.state==='failed') {report.push({...probe,id,state:record.state,detail:record.detail});await writeReport();continue;}
  let finished=false;
  while(Date.now()-begin<1800000) {
    try {
      const memory=Number(execFileSync('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true}).trim().split('\n')[0]);peakVramMiB=Math.max(memory,peakVramMiB);
      const status=await client.status(id);
      if(Date.now()-lastLog>30000){console.log(probe.name,status.state,Math.round((Date.now()-begin)/1000)+'s','VRAM',memory+'MiB');lastLog=Date.now();}
      if(status.state==='ready') {
        const imageBytes=await client.output(status.images![0]);const image=decodePng(imageBytes);
        await fs.writeFile(path.join(root,`${probe.name}.png`),imageBytes);
        let transparent=0,partial=0,opaque=0;for(let i=3;i<image.rgba.length;i+=4){if(image.rgba[i]===0)transparent++;else if(image.rgba[i]===255)opaque++;else partial++;}
        const result={name:probe.name,id,state:'ready',seconds:Math.round((Date.now()-begin)/100)/10,peakVramMiB,width:image.width,height:image.height,alpha:{transparent,partial,opaque},outputs:status.images};
        report.push(result);console.log(JSON.stringify(result));record.state='ready';record.outputs=status.images;await save(record);finished=true;break;
      }
      if(status.state==='failed'||status.state==='cancelled'){report.push({name:probe.name,id,...status,seconds:(Date.now()-begin)/1000,peakVramMiB});record.state=status.state;record.detail=status.detail;await save(record);finished=true;break;}
    }catch(error){console.log('Read failed; keeping prompt ID:',id,String(error));}
    await new Promise(r=>setTimeout(r,2000));
  }
  if(!finished){report.push({name:probe.name,id,state:'pending-timeout',peakVramMiB});await writeReport();throw new Error(`P0 timed out; recover ${id}, do not resubmit`);}
  await writeReport();
}
if(report.some(r=>r.state!=='ready'))process.exitCode=1;
console.log('P0 reports saved:',root);
