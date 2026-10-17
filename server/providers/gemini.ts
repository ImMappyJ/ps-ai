import {GATEWAY_PROTOCOL,validateGeneration} from '../../src/gateway-protocol';
import type {GatewayCapabilities,GenerationRequest} from '../../src/gateway-protocol';
import {decodePng,encodePng,rasterDepth,resize} from '../../src/image';import type {Raster} from '../../src/image';
import type {ImageProvider} from './contract';import {ServiceError} from '../shared/errors';
import {readBounded} from '../shared/io';import {validateInput} from '../shared/images';

function frame(width:number,height:number){const scale=1024/Math.max(width,height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));return {width:w,height:h,left:Math.floor((1024-w)/2),top:Math.floor((1024-h)/2)};}
function pad(image:Raster,mask:boolean):Uint8Array {
  const box=frame(image.width,image.height),small=resize(image,box.width,box.height),rgba=new Uint8Array(1024*1024*4);
  for(let i=0;i<rgba.length;i+=4){rgba[i]=rgba[i+1]=rgba[i+2]=mask?0:128;rgba[i+3]=255;}
  for(let y=0;y<box.height;y++)rgba.set(small.rgba.subarray(y*box.width*4,(y+1)*box.width*4),((y+box.top)*1024+box.left)*4);
  return encodePng({width:1024,height:1024,rgba});
}
export class GeminiProvider implements ImageProvider {
  readonly id='gemini';readonly execution='inline' as const;
  readonly baseUrl='https://generativelanguage.googleapis.com/v1';readonly configured:boolean;
  private apiKey:string;private transport:typeof fetch;private timeoutMs:number;
  constructor(options:{apiKey?:string;transport?:typeof fetch;timeoutMs?:number}={}){
    this.apiKey=options.apiKey?.trim()??'';if(/[\r\n]/.test(this.apiKey)||this.apiKey.length>512)throw new Error('Invalid server API key format');
    this.configured=!!this.apiKey;this.transport=options.transport??fetch;this.timeoutMs=options.timeoutMs??120000;
  }
  capabilities():GatewayCapabilities {
    return {protocol:GATEWAY_PROTOCOL,provider:this.id,configured:this.configured,cancellation:'none',progress:'stages',models:['gemini-nano-banana-2.1','gemini-3.1-flash-lite-image','gemini-3.1-flash-image','gemini-3-pro-image','gemini-2.5-flash-image'].map(id=>({id,label:id,operations:['t2i','edit'],maxInputImages:3,outputDepths:[8],seedMax:0,minPixels:512*512,maxPixels:2048*2048,maxAspectRatio:8}))};
  }
  async submit(request:GenerationRequest,images:Uint8Array[]):Promise<{image:Uint8Array}>{
    if(!this.configured)throw new ServiceError(401,'authentication','Server GEMINI_API_KEY is not configured');
    validateGeneration(request,this.capabilities());const roles=(['source','guide','reference'] as const).filter(role=>request[role]);
    if(images.length!==roles.length)throw new ServiceError(400,'invalid-input','Input image count differs from request');
    const parts:any[]=images.map((bytes,i)=>{const image=validateInput(bytes);if(roles[i]!=='reference'&&(image.width!==request.width||image.height!==request.height))throw new ServiceError(400,'invalid-input','Input canvas dimensions differ');return {inlineData:{mimeType:'image/png',data:Buffer.from(roles[i]==='reference'?bytes:pad(image,roles[i]==='guide')).toString('base64')}};});
    const instructions=roles.length?`Input images in order: ${roles.join(', ')}. The source and guide share a centered, padded 1024x1024 canvas. Preserve framing and subject scale; keep changes within the source content. A guide is visual guidance, not an API inpainting mask; white permits edits and black protects content.\n`:'';
    parts.push({text:instructions+request.prompt});
    const imageFormat={aspectRatio:'1:1',...(request.model==='gemini-2.5-flash-image'?{}:{imageSize:'1K'})};
    const body={contents:[{role:'user',parts}],generationConfig:{responseFormat:{image:imageFormat}}};
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      return await Promise.race([(async()=>{
        const response=await this.transport(`${this.baseUrl}/models/${request.model}:generateContent`,{method:'POST',headers:{'x-goog-api-key':this.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
        if(!response.ok){await response.body?.cancel();const status=response.status;throw new ServiceError(status===401||status===403?status:status===429?429:status>=500?502:400,status===401||status===403?'authentication':status===429?'rate-limit':'provider-error',`Gemini HTTP ${status}; verify server key, model access and quota`,status>=500);}
        const bytes=await readBounded(response,16*1024*1024,true);let result:any;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ServiceError(502,'incompatible-api','Invalid Gemini JSON response',true);}
        if(result.promptFeedback?.blockReason)throw new ServiceError(400,'provider-error','Gemini blocked the image request');
        const images=result.candidates?.flatMap((c:any)=>c.content?.parts??[]).filter((p:any)=>p.inlineData);
        if(!images||images.length!==1||images[0].inlineData.mimeType!=='image/png')throw new ServiceError(502,'invalid-output','Gemini did not return one PNG image');
        const data=images[0].inlineData.data;
        if(typeof data!=='string'||!data.length||data.length>12*1024*1024||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new ServiceError(502,'invalid-output','Invalid inline PNG image data');
        return {image:new Uint8Array(Buffer.from(data,'base64'))};
      })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ServiceError(504,'timeout','Gemini outcome is unknown; do not automatically resubmit',true));},this.timeoutMs);})]);
    }catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError(502,'connection','Gemini connection interrupted; outcome is unknown',true);}
    finally{if(timer)clearTimeout(timer);}
  }
  normalizeOutput(bytes:Uint8Array,request:GenerationRequest,assumeSrgb=false):Uint8Array {
    const image=decodePng(bytes,{allowUntagged:assumeSrgb});
    if(rasterDepth(image)!==8||image.width!==1024||image.height!==1024)throw new ServiceError(502,'invalid-output','Gemini output must be an 8-bit 1024 square PNG');
    const box=frame(request.width,request.height),rgba=new Uint8Array(box.width*box.height*4);
    for(let y=0;y<box.height;y++)rgba.set(image.rgba.subarray(((y+box.top)*1024+box.left)*4,((y+box.top)*1024+box.left+box.width)*4),y*box.width*4);
    return encodePng(resize({width:box.width,height:box.height,rgba},request.width,request.height));
  }
}
