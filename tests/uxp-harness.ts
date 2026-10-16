import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {parseHTML} from 'linkedom';import {build} from 'esbuild';
import {encodePng,decodePng,Raster} from '../src/image';import type {JobRecord} from '../src/jobs';
export async function panelHarness(options:{uxpSelect?:boolean;delayHistory?:boolean;delayCheck?:boolean;settings?:unknown;models?:{unet:string;clip:string;vae:string};noDocuments?:boolean;delaySettings?:boolean;nativePreviewUnavailable?:boolean;source?:Raster;output?:Raster}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-panel-'));
  const html=await fs.readFile('plugin/index.html','utf8');const {document,window}=parseHTML(html);
  for(const select of Array.from(document.querySelectorAll('select'))) {
    const hasInitialSelection=!!select.querySelector('option[selected]');
    let chosen:string|undefined,caption=(select.querySelector('option[selected]')??select.querySelector('option'))?.textContent;
    // Native UXP caches the collapsed caption; editing option.textContent alone
    // does not refresh it. Rebuilding/reselecting options must update the caption.
    Object.defineProperty(select,'displayedCaption',{get(){return caption;},configurable:true});
    Object.defineProperty(select,'value',{get(){if(chosen!==undefined)return chosen;if(options.uxpSelect&&!hasInitialSelection)return undefined;const node=select.querySelector('option[selected]')??select.querySelector('option');return node?(options.uxpSelect?node.getAttribute('value')??undefined:node.getAttribute('value')??node.textContent):undefined;},set(v){chosen=String(v);caption=Array.from(select.querySelectorAll('option')).find(node=>node.getAttribute('value')===chosen)?.textContent;},configurable:true});
  }
  const el=(id:string)=>document.getElementById(id) as any;
  el('prompt').value='blue lightning';el('guide').checked=true;el('lock-seed').checked=true;for(const id of ['preserve-alpha','align-subject'])if(el(id))el(id).checked=true;
  const files:Record<string,Uint8Array|string>={};let holdHistory=false;let releaseHistory:()=>void=()=>{};
  if(options.settings!==undefined)files['settings.json']=JSON.stringify(options.settings);
  let historyBarrier:Promise<void>=Promise.resolve();
  let holdStartup=!!options.delaySettings,releaseStartup:()=>void=()=>{};const startupBarrier=new Promise<void>(r=>{releaseStartup=r;});
  const folder={
    createFile:async(name:string,_opts:unknown)=>{return {name,write:async(data:any)=>{files[name]=typeof data==='string'?data:new Uint8Array(data);await fs.writeFile(path.join(root,name),files[name]);},moveTo:async(_folder:unknown,o:any)=>{files[o.newName]=files[name];delete files[name];await fs.rename(path.join(root,name),path.join(root,o.newName));}};},
    getEntries:async()=>{if(holdStartup)await startupBarrier;if(holdHistory)await historyBarrier;return Object.keys(files).map(name=>({name}));},
    getEntry:async(name:string)=>({read:async()=>{if(!(name in files))throw new Error('Missing '+name);return files[name];}})
  };
  let holdCheck=false;let releaseCheck:()=>void=()=>{};let checkBarrier:Promise<void>=Promise.resolve();
  const posts:any[]=[],captured:number[]=[],uploads:{name:string;image:Raster}[]=[];let documentId=11;let ownStatus:'queued'|'running'|'ready'='ready';const sockets:any[]=[];
  class TestSocket {onmessage?: (event:{data:string})=>void;onerror?:()=>void;closed=false;constructor(public url:string){sockets.push(this);}close(){this.closed=true;}}
  const png=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)});
  const modelInfo:any={UnetLoaderGGUF:{input:{required:{unet_name:[['qwen-image-2.1-Q4_K_M.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_int8_convrot.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{input:{required:{images:['COMFY_AUTOGROW_V3',{template:{names:['image_1','image_2','image_3']}}]}}}};
  Object.assign(modelInfo,JSON.parse(await fs.readFile('tests/fixtures/comfy-nodes.json','utf8')));
  if(options.models)for(const [cls,field,key] of [['UnetLoaderGGUF','unet_name','unet'],['CLIPLoader','clip_name','clip'],['VAELoader','vae_name','vae']] as const)modelInfo[cls].input.required[field][0].push(options.models[key]);
  const fetcher=async(url:string,init:any)=>{
    if(url.startsWith('http://offline.invalid:9999'))throw new TypeError('fetch failed');
    if(url.endsWith('/system_stats')){if(holdCheck)await checkBarrier;return Response.json({system:{comfyui_version:'0.37.4'}});}
    if(url.includes('/object_info/')){const c=url.split('/').pop()!;return Response.json({[c]:modelInfo[c]??{}});}
    if(url.endsWith('/prompt')){const post=JSON.parse(init.body);posts.push(post);return Response.json({prompt_id:post.prompt_id});}
    if(url.includes('/history/')){const id=url.split('/').pop()!;return Response.json(ownStatus==='ready'?{[id]:{status:{completed:true,status_str:'success'},outputs:{'8':{images:[{filename:'own.png',subfolder:'ps-ai',type:'output'}]}}}}:{});}
    if(url.endsWith('/queue'))return Response.json({queue_running:ownStatus==='running'?posts.map(p=>[0,p.prompt_id]):[],queue_pending:ownStatus==='queued'?posts.map(p=>[0,p.prompt_id]):[]});
    if(url.includes('/view?')){const source=uploads.find(u=>u.name.endsWith('-source.png'));return new Response(new Uint8Array(options.output?encodePng(options.output):posts[posts.length-1]?.prompt['9']&&source?encodePng({...source.image,rgba:new Uint8Array(source.image.rgba.length).fill(255)}):png).buffer);}
    if(url.endsWith('/upload/image')){const bytes=Buffer.from(init.body),start=bytes.indexOf(Buffer.from([137,80,78,71,13,10,26,10])),end=bytes.indexOf('\r\n--',start);const name=bytes.subarray(0,start).toString().match(/filename="([^"]+)"/)![1];uploads.push({name,image:decodePng(new Uint8Array(bytes.subarray(start,end)))});return Response.json({name,subfolder:'ps-ai'});}
    if(url.includes('/cancel'))return Response.json({cancelled:false});
    throw new Error('Unexpected URL '+url);
  };
  const makeDoc=(id:number)=>({id,width:2,height:2,mode:'rgb',bitsPerChannel:8,colorProfileName:'sRGB IEC61966-2.1',activeHistoryState:{id:1},layers:[{id:2,kind:'normal',blendMode:'normal',visible:true,opacity:100,fillOpacity:100,isClippingMask:false}],selection:{bounds:{left:0,top:0,right:2,bottom:2}}});
  const data=(components:number)=>({width:2,height:2,components,componentSize:8,dispose(){},getData:async()=>new Uint8Array(components*4).fill(255)});
  const ps:any={app:{get activeDocument(){if(options.noDocuments)throw new Error('No active document');return makeDoc(documentId);},get documents(){return options.noDocuments?[]:[makeDoc(documentId)];}},constants:{DocumentMode:{RGB:'rgb'},BitsPerChannelType:{EIGHT:8},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'}},core:{executeAsModal:async(fn:any)=>fn({})},imaging:{
    createImageDataFromBuffer:async()=>{if(options.nativePreviewUnavailable)throw new Error('Native preview codec unavailable');return {dispose(){}};},encodeImageData:async()=>{if(options.nativePreviewUnavailable)throw new Error('Native preview codec unavailable');return '';},
    getSelection:async(o:any)=>{captured.push(o.documentID);return {imageData:data(1),sourceBounds:{left:0,top:0,right:2,bottom:2}};},
    getPixels:async()=>({imageData:options.source?{...data(4),getData:async()=>options.source!.rgba}:data(4),sourceBounds:{left:0,top:0,right:2,bottom:2},level:0})
  }};
  const uxp={host:{version:'27.0.0'},entrypoints:{setup(){}},storage:{formats:{binary:'binary'},localFileSystem:{getDataFolder:async()=>folder,getFileForSaving:async(name:string)=>folder.createFile(name,{})}}};
  const bundled=await build({entryPoints:['src/panel.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',external:['photoshop','uxp'],define:{'process.env.NODE_ENV':'"production"'}});
  const errors:any[]=[];
  vm.runInNewContext(bundled.outputFiles[0].text,{document,window,require:(name:string)=>name==='photoshop'?ps:uxp,fetch:fetcher,Response,AbortController,WebSocket:TestSocket,setTimeout,clearTimeout,console:{log(){},error:(e:any)=>errors.push(e)}});
  await new Promise(r=>setTimeout(r,25));
  const click=(id:string)=>el(id).dispatchEvent(new window.Event('click'));
  const wait=async()=>{for(let n=0;n<300;n++){await new Promise(r=>setTimeout(r,10));if(!el('generate').disabled)return;}throw new Error('Panel did not settle');};
  return {el,click,change:(id:string)=>el(id).dispatchEvent(new window.Event('change')),wait,posts,captured,uploads,errors,files,setDocument:(id:number)=>{documentId=id;},
    setJobStatus(value:'queued'|'running'|'ready'){ownStatus=value;},progress(id:string,value:number,max:number){for(const s of sockets)if(!s.closed)s.onmessage?.({data:JSON.stringify({type:'progress',data:{prompt_id:id,value,max}})});},
    releaseSettings(){holdStartup=false;releaseStartup();},
    holdHistory(){holdHistory=true;historyBarrier=new Promise(r=>{releaseHistory=r;});},releaseHistory(){holdHistory=false;releaseHistory();},
    holdCheck(){holdCheck=true;checkBarrier=new Promise(r=>{releaseCheck=r;});},releaseCheck(){holdCheck=false;releaseCheck();},
    records:()=>JSON.parse(String(files['history.json']??'[]')) as JobRecord[],close:()=>fs.rm(root,{recursive:true,force:true})};
}
