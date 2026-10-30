import {relayProof} from '../src/infrastructure/backends/relay-auth';
import fs from 'node:fs/promises';import vm from 'node:vm';import {parseHTML} from 'linkedom';import {build} from 'esbuild';
import {encodePng,decodePng,Raster,Bounds,expandPixels,maskRaster} from '../src/imaging/image';import type {JobRecord} from '../src/generation/jobs';
export async function panelHarness(options:{showPanel?:boolean;panelWidth?:number;clipboardError?:string;uxpSelect?:boolean;delayHistory?:boolean;delayCheck?:boolean;settings?:unknown;history?:JobRecord[];files?:Record<string,Uint8Array|string>;pollDelayMs?:number;buildId?:string;models?:{unet:string;clip:string;vae:string};modelInventory?:Record<'unet'|'clip'|'vae',string[]>;noDocuments?:boolean;delaySettings?:boolean;nativePreviewUnavailable?:boolean;dialogUnsupported?:boolean;source?:Raster;selection?:{bounds:Bounds;mask:Uint8Array};output?:Raster;save16Node?:boolean;untaggedSource?:{bytes:Uint8Array;wrongPath?:boolean;unsaved?:boolean;tokenUnavailable?:boolean};gateway?:{configured?:boolean;provider?:'bailian'|'gemini'|'openai';assetContexts?:('selection-v1')[]}}={}) {
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
  let focused:HTMLElement|null=null,panelWidth=options.panelWidth??1000,lifecycle:any;
  Object.defineProperty(document,'activeElement',{get:()=>focused,configurable:true});
  Object.defineProperty(window,'innerWidth',{get:()=>panelWidth,configurable:true});
  const clipboardWrites:string[]=[];
  const navigator={clipboard:{setContent:async(content:Record<string,string>)=>{if(options.clipboardError)throw new Error(options.clipboardError);clipboardWrites.push(content['text/plain']);}}};
  const nativeEvents:string[]=[],appliedLayers:any[]=[],dialogOptions:any[]=[];let dialogOpen=false,closeDialog:(reason?:string)=>void=()=>{};
  const dialog=el('relight-dialog');
  if(dialog&&!options.dialogUnsupported){dialog.uxpShowModal=(value:any)=>{assertDialogClosed();dialogOpen=true;nativeEvents.push('dialog-open');dialogOptions.push(value);dialog.setAttribute('open','');return new Promise(resolve=>{closeDialog=(reason?:string)=>{dialogOpen=false;dialog.removeAttribute('open');nativeEvents.push('dialog-close');resolve(reason);};});};dialog.close=(reason?:string)=>closeDialog(reason);}
  function assertDialogClosed(){if(dialogOpen)throw Error('Native Photoshop commands are unavailable while dialog is open');}
  const viewport=el('relight-viewport');if(viewport)viewport.getBoundingClientRect=()=>({left:20,top:100,width:680,height:450,right:700,bottom:550});
  (window.HTMLElement.prototype as any).setPointerCapture=function(id:number){this.capturedPointer=id;};
  (window.HTMLElement.prototype as any).releasePointerCapture=function(){this.capturedPointer=undefined;};
  const scrolled:string[]=[];
  (window.HTMLElement.prototype as any).scrollIntoView=function(top:boolean){if(typeof top!=='boolean')throw Error('UXP scrollIntoView requires a boolean');scrolled.push(this.getAttribute('data-history-id')??this.id);};
  el('prompt').value='blue lightning';el('guide').checked=true;el('lock-seed').checked=true;for(const id of ['preserve-alpha','align-subject'])if(el(id))el(id).checked=true;
  const files:Record<string,Uint8Array|string>={...options.files};let holdHistory=false;let releaseHistory:()=>void=()=>{};
  if(options.settings!==undefined)files['settings.json']=JSON.stringify(options.settings);
  if(options.history)files['history.json']=JSON.stringify(options.history);
  let historyBarrier:Promise<void>=Promise.resolve();
  let holdStartup=!!options.delaySettings,releaseStartup:()=>void=()=>{};const startupBarrier=new Promise<void>(r=>{releaseStartup=r;});
  const directories=new Set(['']);
  const failDeletes=new Set<string>(),failMoves=new Set<string>(),fileReads:string[]=[],fileWrites:string[]=[],readBarriers=new Map<string,{promise:Promise<void>;release():void}>(),writeBarriers=new Map<string,{promise:Promise<void>;release():void}>();
  function fileEntry(key:string):any{return {name:key.split('/').pop(),isFile:true,read:async()=>{fileReads.push(key);const value=files[key];await readBarriers.get(key)?.promise;return value;},delete:async()=>{if(failDeletes.has(key))throw Error('Delete failed');delete files[key];}};}
  function makeFolder(prefix=''):any{return {
    nativePath:'C:\\Mock\\'+prefix.replace(/\//g,'\\'),
    createFolder:async(name:string)=>{directories.add(prefix+name+'/');return makeFolder(prefix+name+'/');},
    createFile:async(name:string,_opts:unknown)=>({...fileEntry(prefix+name),write:async(data:any)=>{const key=prefix+name;fileWrites.push(key);await writeBarriers.get(key)?.promise;files[key]=typeof data==='string'?data:new Uint8Array(data);},moveTo:async(_folder:unknown,o:any)=>{if(failMoves.has(prefix+o.newName))throw Error('Move failed');files[prefix+o.newName]=files[prefix+name];delete files[prefix+name];}}),
    getEntries:async()=>{if(holdStartup)await startupBarrier;if(holdHistory)await historyBarrier;return Object.keys(files).filter(k=>k.startsWith(prefix)&&!k.slice(prefix.length).includes('/')).map(fileEntry);},
    getEntry:async(name:string)=>{if(directories.has(prefix+name+'/'))return makeFolder(prefix+name+'/');if(!(prefix+name in files))throw new Error('Missing '+name);return fileEntry(prefix+name);}
  };}
  const folder=makeFolder();const secrets=new Map<string,Uint8Array>(),relayLaunches:string[]=[],configuredKeys=new Map<string,string>();let relayRunning=false;
  let holdCheck=false;let releaseCheck:()=>void=()=>{};let checkBarrier:Promise<void>=Promise.resolve();
  type TestState='queued'|'running'|'ready'|'unknown'|'failed'|'cancelled';
  const posts:any[]=[],gatewayPosts:any[]=[],captured:number[]=[],uploads:{name:string;image:Raster}[]=[],requests:{url:string;method:string}[]=[];let documentId=11;let ownStatus:TestState='ready';const sockets:any[]=[],jobStates=new Map<string,TestState|Error>(),statusSequences=new Map<string,(TestState|Error)[]>(),cancelResults=new Map<string,boolean|Error>();
  const stateFor=(id:string,read=false)=>{const sequence=statusSequences.get(id);if(read&&sequence?.length)jobStates.set(id,sequence.shift()!);const state=jobStates.get(id)??ownStatus;if(state instanceof Error)throw state;return state;};
  class TestSocket {onmessage?: (event:{data:string})=>void;onerror?:()=>void;closed=false;constructor(public url:string){sockets.push(this);}close(){this.closed=true;}}
  const png=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)});
  const modelInfo:any={UnetLoaderGGUF:{input:{required:{unet_name:[['qwen-image-2.1-Q4_K_M.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_int8_convrot.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{input:{required:{images:['COMFY_AUTOGROW_V3',{template:{names:['image_1','image_2','image_3']}}]}}}};
  Object.assign(modelInfo,JSON.parse(await fs.readFile('tests/fixtures/comfy-nodes.json','utf8')));
  if(options.save16Node)modelInfo.PS_AISavePNG16={input:{required:{images:['IMAGE',{}],filename_prefix:['STRING',{}]}},output:[]};
  if(options.models)for(const [cls,field,key] of [['UnetLoaderGGUF','unet_name','unet'],['CLIPLoader','clip_name','clip'],['VAELoader','vae_name','vae']] as const)modelInfo[cls].input.required[field][0].push(options.models[key]);
  if(options.modelInventory)for(const [cls,field,key] of [['UnetLoaderGGUF','unet_name','unet'],['CLIPLoader','clip_name','clip'],['VAELoader','vae_name','vae']] as const)modelInfo[cls].input.required[field][0]=options.modelInventory[key];
  const fetcher=async(url:string,init:any)=>{
    requests.push({url,method:init?.method??'GET'});
    if(url.startsWith('http://offline.invalid:9999'))throw new TypeError('fetch failed');
    if(url.includes('/psai/v1/')){
      const managed=url.match(/(?:localhost|127\.0\.0\.1):(819[123])/);const provider=managed?({'8191':'bailian','8192':'gemini','8193':'openai'} as any)[managed[1]]:options.gateway?.provider??'bailian';
      if(managed&&!relayRunning)throw TypeError('Relay offline');
      if(managed&&url.endsWith('/handshake'))return Response.json({provider,proof:relayProof('a'.repeat(64),provider,init.headers['X-PSAI-Challenge'])});
      if(managed&&init.headers?.Authorization!=='Bearer '+'a'.repeat(64))return Response.json({message:'unauthorized'},{status:401});
      if(url.endsWith('/configure')){configuredKeys.set(provider,JSON.parse(init.body).apiKey);return Response.json({configured:!!configuredKeys.get(provider)});}
      if(url.endsWith('/shutdown')){relayRunning=false;return Response.json({stopping:true});}

      if(url.endsWith('/capabilities'))return Response.json({protocol:'ps-ai/1',provider,configured:managed?!!configuredKeys.get(provider):options.gateway?.configured!==false,cancellation:'none',progress:'stages',models:(provider==='gemini'?['gemini-2.5-flash-image']:provider==='openai'?['gpt-image-1.5','gpt-image-2.5-sunburst']:['qwen-image-2.1-pro','qwen-image-3.0-pro']).map(id=>({id,label:id,operations:id.startsWith('qwen-image-2.1')||id.startsWith('gpt-')?['t2i','edit','asset']:['t2i','edit'],maxInputImages:3,...(options.gateway?.assetContexts!==undefined&&(id.startsWith('qwen-image-2.1')||id.startsWith('gpt-'))?{assetContexts:options.gateway.assetContexts}:{}),outputDepths:[8],seedMax:id.startsWith('gemini-')||id.startsWith('gpt-')?0:2147483647,minPixels:262144,maxPixels:4194304,maxAspectRatio:id.startsWith('gpt-')?3:8}))});
      if(url.includes('/uploads/')){const name=url.split('/').pop()!;uploads.push({name,image:decodePng(new Uint8Array(init.body))});return Response.json({name});}
      if(url.endsWith('/jobs')){const post=JSON.parse(init.body);gatewayPosts.push(post);return Response.json({id:post.id});}
      if(url.includes('/outputs/')){const r=gatewayPosts[gatewayPosts.length-1]?.request;return new Response(new Uint8Array(encodePng(options.output??{width:r?.width??512,height:r?.height??512,rgba:new Uint8Array((r?.width??512)*(r?.height??512)*4).fill(255)})).buffer);}
      if(url.endsWith('/cancel')){const result=cancelResults.get(url.split('/').slice(-2)[0])??false;if(result instanceof Error)throw result;return Response.json({cancelled:result});}
      const id=url.split('/').pop()!,state=stateFor(id,true);return Response.json(state==='ready'?{state:'ready',images:[{filename:id+'.png',subfolder:'',type:'output'}]}:{state});
    }
    if(url.endsWith('/system_stats')){if(holdCheck)await checkBarrier;return Response.json({system:{comfyui_version:'0.37.4'}});}
    if(url.includes('/object_info/')){const c=url.split('/').pop()!;return Response.json({[c]:modelInfo[c]??{}});}
    if(url.endsWith('/prompt')){const post=JSON.parse(init.body);posts.push(post);return Response.json({prompt_id:post.prompt_id});}
    if(url.includes('/history/')){const id=url.split('/').pop()!,state=stateFor(id,true);return Response.json(state==='ready'?{[id]:{status:{completed:true,status_str:'success'},outputs:{'8':{images:[{filename:'own.png',subfolder:'ps-ai',type:'output'}]}}}}:state==='failed'?{[id]:{status:{status_str:'error'}}}:state==='cancelled'?{[id]:{status:{messages:[['execution_interrupted',{}]]}}}:{});}
    if(url.endsWith('/queue')){const ids=[...new Set([...posts.map(p=>p.prompt_id),...JSON.parse(String(files['history.json']??'[]')).map((r:JobRecord)=>r.id)])],inState=(id:string,state:TestState)=>{try{return stateFor(id)===state;}catch{return false;}};return Response.json({queue_running:ids.filter(id=>inState(id,'running')).map(id=>[0,id]),queue_pending:ids.filter(id=>inState(id,'queued')).map(id=>[0,id])});}
    if(url.includes('/view?')){const source=uploads.find(u=>u.name.endsWith('-source.png'));return new Response(new Uint8Array(options.output?encodePng(options.output):posts[posts.length-1]?.prompt['9']&&source?encodePng({...source.image,rgba:new Uint8Array(source.image.rgba.length).fill(255)}):png).buffer);}
    if(url.endsWith('/upload/image')){const bytes=Buffer.from(init.body),start=bytes.indexOf(Buffer.from([137,80,78,71,13,10,26,10])),end=bytes.indexOf('\r\n--',start);const name=bytes.subarray(0,start).toString().match(/filename="([^"]+)"/)![1];uploads.push({name,image:decodePng(new Uint8Array(bytes.subarray(start,end)))});return Response.json({name,subfolder:'ps-ai'});}
    if(url.includes('/cancel')){const result=cancelResults.get(url.split('/').slice(-2)[0])??false;if(result instanceof Error)throw result;return Response.json({cancelled:result});}
    throw new Error('Unexpected URL '+url);
  };
  const source=options.source??{width:2,height:2,rgba:new Uint8Array(16).fill(255)},fullBounds={left:0,top:0,right:source.width,bottom:source.height};
  let selection=options.selection??{bounds:fullBounds,mask:new Uint8Array(source.width*source.height).fill(255)};
  const pixelRequests:any[]=[],selectionWrites:any[]=[],selectionTransactions:any[]=[];
  const selectionBaselines=new Map<number,{bounds:Bounds;mask:Uint8Array}>();
  let layerSerial=50;const documents=new Map<number,any>();
  const makeDoc=(id:number):any=>{if(documents.has(id))return documents.get(id);const doc:any={id,width:source.width,height:source.height,mode:'rgb',bitsPerChannel:source.rgba instanceof Uint16Array?16:8,colorProfileName:'sRGB IEC61966-2.1',activeHistoryState:{id:1},layers:[{id:2,kind:'normal',blendMode:'normal',visible:true,opacity:100,fillOpacity:100,isClippingMask:false}],get selection(){return {bounds:selection.bounds};},createLayer:async(_kind:any,value:any)=>{assertDialogClosed();const layer:any={...value,id:layerSerial++,isClippingMask:false,move:async()=>{},delete:async()=>{doc.layers=doc.layers.filter((l:any)=>l.id!==layer.id);}};doc.layers.unshift(layer);appliedLayers.push({documentId:id,layer});return layer;}};documents.set(id,doc);return doc;};
  makeDoc(11);
  const colorDocuments:any[]=options.untaggedSource?[{...makeDoc(11),get selection(){return {bounds:selection.bounds};},colorProfileName:'',path:'C:\\Mock\\source.webp',saved:!options.untaggedSource.unsaved}]:[];
  if(colorDocuments.length)colorDocuments[0].duplicate=async()=>{const copy={...makeDoc(22),get selection(){return {bounds:selection.bounds};},colorProfileName:'',saved:false};colorDocuments.push(copy);documentId=22;return copy;};
  const data=(components:number)=>({width:source.width,height:source.height,components,componentSize:8,dispose(){},getData:async()=>new Uint8Array(components*source.width*source.height).fill(255)});
  const ps:any={app:{get activeDocument(){if(options.noDocuments)throw new Error('No active document');return colorDocuments.length?colorDocuments.find(d=>d.id===documentId):makeDoc(documentId);},set activeDocument(doc:any){documentId=doc.id;},get documents(){return options.noDocuments?[]:colorDocuments.length?colorDocuments:[...documents.values()];}},constants:{DocumentMode:{RGB:'rgb'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'},ElementPlacement:{PLACEBEFORE:'before'}},action:{batchPlay:async(cmd:any[])=>{assertDialogClosed();return cmd.map(()=>({}));}},core:{executeAsModal:async(fn:any)=>{assertDialogClosed();nativeEvents.push('native');return fn({hostControl:{registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{},suspendHistory:async(o:any)=>{selectionBaselines.set(o.documentID,{bounds:selection.bounds&&{...selection.bounds},mask:selection.mask.slice()});selectionTransactions.push(['suspend',o.documentID]);return o.documentID;},resumeHistory:async(id:number,commit:boolean)=>{selectionTransactions.push(['resume',id,commit]);const doc=colorDocuments.find(d=>d.id===id)??documents.get(id);if(commit&&doc)doc.activeHistoryState={id:doc.activeHistoryState.id+1};else if(!commit&&selectionBaselines.has(id))selection=selectionBaselines.get(id)!;selectionBaselines.delete(id);}}});}},imaging:{
    createImageDataFromBuffer:async(values:any,metadata:any)=>{if(options.nativePreviewUnavailable)throw new Error('Native preview codec unavailable');return {values:values.slice(),...metadata,dispose(){}};},encodeImageData:async()=>{if(options.nativePreviewUnavailable)throw new Error('Native preview codec unavailable');return '';},
    putSelection:async(o:any)=>{assertDialogClosed();selectionWrites.push(o);const data=o.imageData,max=data.values instanceof Uint16Array?65535:255,mask=new Uint8Array(source.width*source.height),left=o.targetBounds?.left??0,top=o.targetBounds?.top??0;let minX=source.width,minY=source.height,maxX=0,maxY=0;for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){const value=Math.round(data.values[y*data.width+x]*255/max),px=left+x,py=top+y;if(px<0||py<0||px>=source.width||py>=source.height)continue;mask[py*source.width+px]=value;if(value){minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px+1);maxY=Math.max(maxY,py+1);}}selection={bounds:maxX>minX?{left:minX,top:minY,right:maxX,bottom:maxY}:null as any,mask};},
    getSelection:async(o:any)=>{captured.push(o.documentID);const image=expandPixels(maskRaster(selection.mask,source.width,source.height),fullBounds,o.sourceBounds),gray=Uint8Array.from({length:image.width*image.height},(_,i)=>image.rgba[i*4]);return {imageData:{...data(1),width:image.width,height:image.height,getData:async()=>gray},sourceBounds:o.sourceBounds};},
    getPixels:async(o:any)=>{pixelRequests.push(o);const image=expandPixels(source,fullBounds,o.sourceBounds);return {imageData:{...data(4),width:image.width,height:image.height,componentSize:image.rgba instanceof Uint16Array?16:8,getData:async()=>image.rgba},sourceBounds:o.sourceBounds,level:0};},putPixels:async()=>{assertDialogClosed();},putLayerMask:async()=>{assertDialogClosed();}
  }};
  const uxp={shell:{openPath:async(p:string)=>{relayLaunches.push(p);relayRunning=true;files['relay/relay-session.json']=JSON.stringify({protocol:'ps-ai-relay/1',token:'a'.repeat(64),ports:{bailian:8191,gemini:8192,openai:8193}});return '';}},host:{version:'27.0.0'},entrypoints:{setup(value:any){lifecycle=value;}},storage:{formats:{binary:'binary'},secureStorage:{getItem:async(k:string)=>{if(!secrets.has(k))throw Error('missing');return secrets.get(k);},setItem:async(k:string,v:string)=>secrets.set(k,new TextEncoder().encode(v)),removeItem:async(k:string)=>secrets.delete(k)},localFileSystem:{getDataFolder:async()=>folder,getPluginFolder:async()=>({getEntry:async()=>({read:async()=>new ArrayBuffer(1)})}),getFileForSaving:async(name:string)=>folder.createFile(name,{})}}};
  const sourceAccessEvents:string[]=[],sourceEntries=new Map<string,any>();
  if(options.untaggedSource)Object.assign(uxp.storage.localFileSystem,{
    getFileForOpening:async()=>{sourceAccessEvents.push('picker');return {isFile:true,nativePath:options.untaggedSource!.wrongPath?'C:\\Mock\\other.webp':'C:\\Mock\\source.webp',getMetadata:async()=>({size:options.untaggedSource!.bytes.length}),read:async()=>{sourceAccessEvents.push('read');return options.untaggedSource!.bytes.slice().buffer;}};},
    createPersistentToken:async(entry:any)=>{const token=`source-token-${sourceEntries.size}`;sourceAccessEvents.push('token');sourceEntries.set(token,entry);return token;},
    getEntryForPersistentToken:async(token:string)=>sourceEntries.get(token)
  });
  if(options.untaggedSource?.tokenUnavailable)delete (uxp.storage.localFileSystem as any).createPersistentToken;
  const bundled=await build({entryPoints:['src/app/panel.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',external:['photoshop','uxp'],define:{'process.env.NODE_ENV':'"production"',...(options.buildId?{__PSAI_BUILD_ID__:JSON.stringify(options.buildId)}:{})}});
  const errors:any[]=[];
  vm.runInNewContext(bundled.outputFiles[0].text,{document,window,navigator,require:(name:string)=>name==='photoshop'?ps:uxp,fetch:fetcher,Response,AbortController,WebSocket:TestSocket,setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms===2000?options.pollDelayMs??ms:ms),clearTimeout,console:{log(){},warn(){},error:(e:any)=>errors.push(e)}});
  if(options.showPanel!==false)lifecycle?.panels?.psai?.show();
  await new Promise(r=>setTimeout(r,25));
  const click=(id:string)=>el(id).dispatchEvent(new window.Event('click',{bubbles:true}));
  const wait=async()=>{for(let n=0;n<300;n++){await new Promise(r=>setTimeout(r,10));if(!el('generate').disabled&&(!dialogOpen||el('relight-cancel').disabled))return;}throw new Error('Panel did not settle');};
  const historyRows=()=>Array.from(el('history-rows').querySelectorAll('[data-history-id]')) as HTMLElement[];
  const historySelectedId=()=>el('history-rows').querySelector('[aria-selected="true"]')?.getAttribute('data-history-id') as string|undefined;
  const selectHistory=(id:string)=>{
    click('nav-history');let row=historyRows().find(node=>node.getAttribute('data-history-id')===id);
    if(!row){click('history-all');for(let n=0;n<1000&&!el('history-prev').disabled;n++)click('history-prev');
      for(let n=0;n<1000;n++){row=historyRows().find(node=>node.getAttribute('data-history-id')===id);if(row||el('history-next').disabled)break;click('history-next');}
    }
    if(!row)throw new Error('History row not visible: '+id);
    row.querySelector('button')!.dispatchEvent(new window.Event('click',{bubbles:true}));
  };
  const refreshHistory=async()=>{click('nav-history');click('history-refresh');await wait();};
  return {el,click,clipboardWrites,showPanel:()=>lifecycle?.panels?.psai?.show(),hidePanel:()=>lifecycle?.panels?.psai?.hide(),focus:(id:string)=>{focused=el(id);focused?.dispatchEvent(new window.Event('focusin',{bubbles:true}));},blur:()=>{focused=null;document.dispatchEvent(new window.Event('focusout',{bubbles:true}));},setPanelWidth:(width:number)=>{panelWidth=width;window.dispatchEvent(new window.Event('resize'));},change:(id:string)=>el(id).dispatchEvent(new window.Event('change')),event:(id:string,type:string,values:Record<string,unknown>={})=>{const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,values);el(id).dispatchEvent(event);return event;},wait,posts,gatewayPosts,captured,uploads,requests,errors,files,secrets,relayLaunches,configuredKeys,pixelRequests,nativeEvents,appliedLayers,dialogOptions,ps,setSelection:(value:{bounds:Bounds;mask:Uint8Array})=>{selection=value;},setDocument:(id:number)=>{documentId=id;documents.clear();makeDoc(id);},switchDocument:(id:number)=>{documentId=id;makeDoc(id);},
    selectionWrites,selectionTransactions,selectionState:()=>({bounds:selection.bounds&&{...selection.bounds},mask:selection.mask.slice()}),sourceAccessEvents,setJobStatus(value:TestState|Error,id?:string){if(id){statusSequences.delete(id);jobStates.set(id,value);}else if(!(value instanceof Error))ownStatus=value;},setJobStatusSequence(id:string,values:(TestState|Error)[]){statusSequences.set(id,[...values]);},setCancelResult(id:string,value:boolean|Error){cancelResults.set(id,value);},progress(id:string,value:number,max:number){for(const s of sockets)if(!s.closed)s.onmessage?.({data:JSON.stringify({type:'progress',data:{prompt_id:id,value,max}})});},
    historyRows,historySelectedId,selectHistory,refreshHistory,scrolled,fileReads,fileWrites,failDeletes,failMoves,
    holdFileRead(name:string){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve;});readBarriers.set(name,{promise,release});},releaseFileRead(name:string){readBarriers.get(name)?.release();readBarriers.delete(name);},
    holdFileWrite(name:string){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve;});writeBarriers.set(name,{promise,release});},releaseFileWrite(name:string){writeBarriers.get(name)?.release();writeBarriers.delete(name);},
    releaseSettings(){holdStartup=false;releaseStartup();},
    holdHistory(){holdHistory=true;historyBarrier=new Promise(r=>{releaseHistory=r;});},releaseHistory(){holdHistory=false;releaseHistory();},
    holdCheck(){holdCheck=true;checkBarrier=new Promise(r=>{releaseCheck=r;});},releaseCheck(){holdCheck=false;releaseCheck();},
    records:()=>JSON.parse(String(files['history.json']??'[]')) as JobRecord[],close:async()=>{if(dialogOpen)closeDialog('user-close');await new Promise(r=>setTimeout(r,10));}};
}
