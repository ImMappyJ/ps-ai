import {relayProof} from '../src/relay-auth';
import fs from 'node:fs/promises';import vm from 'node:vm';import {parseHTML} from 'linkedom';import {build} from 'esbuild';
import {encodePng,decodePng,Raster} from '../src/image';import type {JobRecord} from '../src/jobs';
export async function panelHarness(options:{uxpSelect?:boolean;delayHistory?:boolean;delayCheck?:boolean;settings?:unknown;models?:{unet:string;clip:string;vae:string};noDocuments?:boolean;delaySettings?:boolean;nativePreviewUnavailable?:boolean;source?:Raster;output?:Raster;save16Node?:boolean;gateway?:{configured?:boolean;provider?:'bailian'|'gemini'|'openai'}}={}) {
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
  const directories=new Set(['']);
  function makeFolder(prefix=''):any{return {
    nativePath:'C:\\Mock\\'+prefix.replace(/\//g,'\\'),
    createFolder:async(name:string)=>{directories.add(prefix+name+'/');return makeFolder(prefix+name+'/');},
    createFile:async(name:string,_opts:unknown)=>({name,write:async(data:any)=>{const key=prefix+name;files[key]=typeof data==='string'?data:new Uint8Array(data);},moveTo:async(_folder:unknown,o:any)=>{files[prefix+o.newName]=files[prefix+name];delete files[prefix+name];}}),
    getEntries:async()=>{if(holdStartup)await startupBarrier;if(holdHistory)await historyBarrier;return Object.keys(files).filter(k=>k.startsWith(prefix)).map(k=>({name:k.slice(prefix.length)}));},
    getEntry:async(name:string)=>{if(directories.has(prefix+name+'/'))return makeFolder(prefix+name+'/');if(!(prefix+name in files))throw new Error('Missing '+name);return {read:async()=>files[prefix+name]};}
  };}
  const folder=makeFolder();const secrets=new Map<string,Uint8Array>(),relayLaunches:string[]=[],configuredKeys=new Map<string,string>();let relayRunning=false;
  let holdCheck=false;let releaseCheck:()=>void=()=>{};let checkBarrier:Promise<void>=Promise.resolve();
  const posts:any[]=[],gatewayPosts:any[]=[],captured:number[]=[],uploads:{name:string;image:Raster}[]=[];let documentId=11;let ownStatus:'queued'|'running'|'ready'='ready';const sockets:any[]=[];
  class TestSocket {onmessage?: (event:{data:string})=>void;onerror?:()=>void;closed=false;constructor(public url:string){sockets.push(this);}close(){this.closed=true;}}
  const png=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)});
  const modelInfo:any={UnetLoaderGGUF:{input:{required:{unet_name:[['qwen-image-2.1-Q4_K_M.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_int8_convrot.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{input:{required:{images:['COMFY_AUTOGROW_V3',{template:{names:['image_1','image_2','image_3']}}]}}}};
  Object.assign(modelInfo,JSON.parse(await fs.readFile('tests/fixtures/comfy-nodes.json','utf8')));
  if(options.save16Node)modelInfo.PS_AISavePNG16={input:{required:{images:['IMAGE',{}],filename_prefix:['STRING',{}]}},output:[]};
  if(options.models)for(const [cls,field,key] of [['UnetLoaderGGUF','unet_name','unet'],['CLIPLoader','clip_name','clip'],['VAELoader','vae_name','vae']] as const)modelInfo[cls].input.required[field][0].push(options.models[key]);
  const fetcher=async(url:string,init:any)=>{
    if(url.startsWith('http://offline.invalid:9999'))throw new TypeError('fetch failed');
    if(url.includes('/psai/v1/')){
      const managed=url.match(/(?:localhost|127\.0\.0\.1):(819[123])/);const provider=managed?({'8191':'bailian','8192':'gemini','8193':'openai'} as any)[managed[1]]:options.gateway?.provider??'bailian';
      if(managed&&!relayRunning)throw TypeError('Relay offline');
      if(managed&&url.endsWith('/handshake'))return Response.json({provider,proof:relayProof('a'.repeat(64),provider,init.headers['X-PSAI-Challenge'])});
      if(managed&&init.headers?.Authorization!=='Bearer '+'a'.repeat(64))return Response.json({message:'unauthorized'},{status:401});
      if(url.endsWith('/configure')){configuredKeys.set(provider,JSON.parse(init.body).apiKey);return Response.json({configured:!!configuredKeys.get(provider)});}
      if(url.endsWith('/shutdown')){relayRunning=false;return Response.json({stopping:true});}

      if(url.endsWith('/capabilities'))return Response.json({protocol:'ps-ai/1',provider,configured:managed?!!configuredKeys.get(provider):options.gateway?.configured!==false,cancellation:'none',progress:'stages',models:(provider==='gemini'?['gemini-2.5-flash-image']:provider==='openai'?['gpt-image-1.5','gpt-image-2.5-sunburst']:['qwen-image-2.1-pro','qwen-image-3.0-pro']).map(id=>({id,label:id,operations:id.startsWith('qwen-image-2.1')||id.startsWith('gpt-')?['t2i','edit','asset']:['t2i','edit'],maxInputImages:3,outputDepths:[8],seedMax:id.startsWith('gemini-')||id.startsWith('gpt-')?0:2147483647,minPixels:262144,maxPixels:4194304,maxAspectRatio:id.startsWith('gpt-')?3:8}))});
      if(url.includes('/uploads/')){const name=url.split('/').pop()!;uploads.push({name,image:decodePng(new Uint8Array(init.body))});return Response.json({name});}
      if(url.endsWith('/jobs')){const post=JSON.parse(init.body);gatewayPosts.push(post);return Response.json({id:post.id});}
      if(url.includes('/outputs/')){const r=gatewayPosts[gatewayPosts.length-1]?.request;return new Response(new Uint8Array(encodePng(options.output??{width:r?.width??512,height:r?.height??512,rgba:new Uint8Array((r?.width??512)*(r?.height??512)*4).fill(255)})).buffer);}
      if(url.endsWith('/cancel'))return Response.json({cancelled:false});
      const id=url.split('/').pop()!;return Response.json(ownStatus==='ready'?{state:'ready',images:[{filename:id+'.png',subfolder:'',type:'output'}]}:{state:ownStatus});
    }
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
  const uxp={shell:{openPath:async(p:string)=>{relayLaunches.push(p);relayRunning=true;files['relay/relay-session.json']=JSON.stringify({protocol:'ps-ai-relay/1',token:'a'.repeat(64),ports:{bailian:8191,gemini:8192,openai:8193}});return '';}},host:{version:'27.0.0'},entrypoints:{setup(){}},storage:{formats:{binary:'binary'},secureStorage:{getItem:async(k:string)=>{if(!secrets.has(k))throw Error('missing');return secrets.get(k);},setItem:async(k:string,v:string)=>secrets.set(k,new TextEncoder().encode(v)),removeItem:async(k:string)=>secrets.delete(k)},localFileSystem:{getDataFolder:async()=>folder,getPluginFolder:async()=>({getEntry:async()=>({read:async()=>new ArrayBuffer(1)})}),getFileForSaving:async(name:string)=>folder.createFile(name,{})}}};
  const bundled=await build({entryPoints:['src/panel.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',external:['photoshop','uxp'],define:{'process.env.NODE_ENV':'"production"'}});
  const errors:any[]=[];
  vm.runInNewContext(bundled.outputFiles[0].text,{document,window,require:(name:string)=>name==='photoshop'?ps:uxp,fetch:fetcher,Response,AbortController,WebSocket:TestSocket,setTimeout,clearTimeout,console:{log(){},error:(e:any)=>errors.push(e)}});
  await new Promise(r=>setTimeout(r,25));
  const click=(id:string)=>el(id).dispatchEvent(new window.Event('click'));
  const wait=async()=>{for(let n=0;n<300;n++){await new Promise(r=>setTimeout(r,10));if(!el('generate').disabled)return;}throw new Error('Panel did not settle');};
  return {el,click,change:(id:string)=>el(id).dispatchEvent(new window.Event('change')),wait,posts,gatewayPosts,captured,uploads,errors,files,secrets,relayLaunches,configuredKeys,setDocument:(id:number)=>{documentId=id;},
    setJobStatus(value:'queued'|'running'|'ready'){ownStatus=value;},progress(id:string,value:number,max:number){for(const s of sockets)if(!s.closed)s.onmessage?.({data:JSON.stringify({type:'progress',data:{prompt_id:id,value,max}})});},
    releaseSettings(){holdStartup=false;releaseStartup();},
    holdHistory(){holdHistory=true;historyBarrier=new Promise(r=>{releaseHistory=r;});},releaseHistory(){holdHistory=false;releaseHistory();},
    holdCheck(){holdCheck=true;checkBarrier=new Promise(r=>{releaseCheck=r;});},releaseCheck(){holdCheck=false;releaseCheck();},
    records:()=>JSON.parse(String(files['history.json']??'[]')) as JobRecord[],close:async()=>{}};
}
