import fs from 'node:fs/promises';import {ComfyClient,uuid} from '../src/infrastructure/backends/client';import {buildGraph} from '../src/generation/workflow';import {encodePng,decodeModelPng,decodePng} from '../src/imaging/image';import {JobCoordinator,JobRecord} from '../src/generation/jobs';
const client=new ComfyClient(),id=uuid(),clientId=uuid();await client.check();
const image={width:32,height:320,rgba:new Uint8Array(32*320*4)};for(let i=0;i<image.rgba.length;i+=4)image.rgba.set([80,110,180,255],i);
const source=await client.upload(encodePng(image),`${id}-geometry.png`);
const graph=buildGraph({requestId:id,prompt:'In <image1>, change the blue rectangle to red. Preserve the image dimensions.',seed:42,steps:8,resolution:992,source});
const record:JobRecord={id,clientId,graph,state:'created',createdAt:new Date().toISOString(),note:'Geometry compatibility probe: 8 steps, not a quality baseline.'};
const save=async(r:JobRecord)=>{await fs.writeFile('artifacts/p0-geometry-job.json',JSON.stringify(r,null,2));};
await new JobCoordinator(client,{save}).submit(record);console.log('presized geometry',record.state,id);
const start=Date.now();
while(Date.now()-start<600000){const s=await client.status(id);if(s.state==='ready'){const bytes=await client.output(s.images![0]);const result=decodeModelPng(bytes,"qwen21-local-v2-rgba");record.state='ready';record.outputs=s.images;record.actual={width:result.width,height:result.height};record.expected={width:32,height:320};await save(record);await fs.writeFile('artifacts/p0-geometry.png',bytes);if(result.width!==32||result.height!==320)throw new Error('Presized dimensions shifted');console.log('resolution=0 returns exact 32×320; elapsed',Math.round((Date.now()-start)/1000),'s');process.exit(0);}if(s.state==='failed'){record.state='failed';record.detail=s.detail;await save(record);throw new Error(s.detail);}await new Promise(r=>setTimeout(r,2000));}
throw new Error(`Timed out; recover ${id} without resubmission`);
