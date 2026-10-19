import {GATEWAY_PROTOCOL,validateGeneration} from '../../src/infrastructure/backends/gateway-protocol';
import type {GatewayCapabilities,GenerationRequest} from '../../src/infrastructure/backends/gateway-protocol';
import {checkSize,decodePng,encodePng,rasterDepth,resize} from '../../src/imaging/image';
import type {Raster} from '../../src/imaging/image';
import type {ImageProvider} from './contract';
import {ServiceError} from '../shared/errors';
import {readBounded} from '../shared/io';
import {validateInput,MAX_INPUT_BYTES} from '../shared/images';

const MODELS=['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-1.5'];
const RESPONSE_BYTES=32*1024*1024;
const MIN_PLATFORM_PIXELS=655360;

// Deterministic geometry is recomputed from the durable request after restart.
export function openAIFrame(request:GenerationRequest){
  const {width,height,model}=request;checkSize(width,height);
  let canvasWidth:number,canvasHeight:number;
  if(model==='gpt-image-1.5'){
    [canvasWidth,canvasHeight]=width/height>1.25?[1536,1024]:height/width>1.25?[1024,1536]:[1024,1024];
  }else{
    if(!MODELS.includes(model)||Math.max(width/height,height/width)>3)throw new ServiceError(400,'invalid-input','OpenAI model requires an aspect ratio between 1:3 and 3:1');
    const scale=Math.max(1,Math.sqrt(MIN_PLATFORM_PIXELS/(width*height)));
    canvasWidth=Math.ceil(width*scale/16)*16;canvasHeight=Math.ceil(height*scale/16)*16;
    if(Math.max(canvasWidth,canvasHeight)>3840||canvasWidth*canvasHeight>8294400)throw new ServiceError(400,'invalid-input','OpenAI model canvas exceeds its pixel or edge limit');
  }
  const scale=Math.min(canvasWidth/width,canvasHeight/height);
  const contentWidth=Math.min(canvasWidth,Math.max(1,Math.round(width*scale)));
  const contentHeight=Math.min(canvasHeight,Math.max(1,Math.round(height*scale)));
  return {canvasWidth,canvasHeight,width:contentWidth,height:contentHeight,left:Math.floor((canvasWidth-contentWidth)/2),top:Math.floor((canvasHeight-contentHeight)/2)};
}

function padded(image:Raster,box:ReturnType<typeof openAIFrame>,guide:boolean):Raster {
  if(guide)for(let i=0;i<image.rgba.length;i+=4){
    if(image.rgba[i]!==image.rgba[i+1]||image.rgba[i]!==image.rgba[i+2]||image.rgba[i+3]!==255)throw new ServiceError(400,'invalid-input','OpenAI edit guide must be opaque grayscale');
  }
  const small=resize(image,box.width,box.height),rgba=new Uint8Array(box.canvasWidth*box.canvasHeight*4);
  for(let i=0;i<rgba.length;i+=4){rgba[i]=rgba[i+1]=rgba[i+2]=guide?0:128;rgba[i+3]=255;}
  for(let y=0;y<box.height;y++)rgba.set(small.rgba.subarray(y*box.width*4,(y+1)*box.width*4),((y+box.top)*box.canvasWidth+box.left)*4);
  if(guide)for(let i=0;i<rgba.length;i+=4){const gray=rgba[i];rgba[i]=rgba[i+1]=rgba[i+2]=0;rgba[i+3]=255-gray;}
  return {width:box.canvasWidth,height:box.canvasHeight,rgba};
}

function dataUrl(bytes:Uint8Array):string {
  if(bytes.length>MAX_INPUT_BYTES)throw new ServiceError(413,'invalid-input','Prepared OpenAI PNG exceeds 10 MiB');
  return 'data:image/png;base64,'+Buffer.from(bytes).toString('base64');
}

export class OpenAIImagesProvider implements ImageProvider {
  readonly id='openai';readonly execution='inline' as const;
  readonly baseUrl='https://api.openai.com/v1';readonly configured:boolean;
  private apiKey:string;private transport:typeof fetch;private timeoutMs:number;
  constructor(options:{apiKey?:string;transport?:typeof fetch;timeoutMs?:number}={}){
    this.apiKey=options.apiKey?.trim()??'';
    if(/[\r\n]/.test(this.apiKey)||this.apiKey.length>512)throw new Error('Invalid server API key format');
    this.configured=!!this.apiKey;this.transport=options.transport??fetch;this.timeoutMs=options.timeoutMs??180000;
  }
  capabilities():GatewayCapabilities {
    return {protocol:GATEWAY_PROTOCOL,provider:this.id,configured:this.configured,cancellation:'none',progress:'stages',models:MODELS.map(id=>({id,label:id,operations:['t2i','edit','asset'],assetContexts:['selection-v1'],maxInputImages:3,outputDepths:[8],seedMax:0,minPixels:512*512,maxPixels:2048*2048,maxAspectRatio:id==='gpt-image-1.5'?8:3}))};
  }
  async submit(request:GenerationRequest,images:Uint8Array[]):Promise<{image:Uint8Array}>{
    if(!this.configured)throw new ServiceError(401,'authentication','Server OPENAI_API_KEY is not configured');
    const imageInput=request.kind==='edit'||request.assetContext==='selection-v1';
    let body:Record<string,unknown>;
    try{
      validateGeneration(request,this.capabilities());
      const roles=(['source','guide','reference'] as const).filter(role=>request[role]);
      if(images.length!==roles.length)throw new ServiceError(400,'invalid-input','Input image count differs from request');
      const box=openAIFrame(request),inputs:{image_url:string}[]=[];let mask:{image_url:string}|undefined;
      for(let i=0;i<images.length;i++){
        const role=roles[i],image=validateInput(images[i]);
        if(role!=='reference'&&(image.width!==request.width||image.height!==request.height))throw new ServiceError(400,'invalid-input','Input canvas dimensions differ');
        if(role==='guide')mask={image_url:dataUrl(encodePng(padded(image,box,true)))};
        else inputs.push({image_url:dataUrl(role==='source'?encodePng(padded(image,box,false)):images[i])});
      }
      const context=request.assetContext==='selection-v1'?'Use the first image only as a reference for placement, scale, perspective, color and lighting. Use the supplied mask to place a standalone transparent effect or atmosphere asset. Return only the independent asset, excluding people and scenery from the source.\n':request.kind==='edit'?`Edit the first image and preserve its framing and subject scale.${request.reference?' The next image is a reference, not another edit target.':''}${mask?' Use the supplied mask as editing guidance.':''}\n`:'';
      body={model:request.model,prompt:context+request.prompt,n:1,size:`${box.canvasWidth}x${box.canvasHeight}`,quality:'medium',output_format:'png',background:request.kind==='asset'?'transparent':'opaque',...(imageInput?{images:inputs,...(mask?{mask}:{})}:{})};
    }catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError(400,'invalid-input','Invalid OpenAI image request; check model, canvas, seed and PNG inputs');}
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      return await Promise.race([(async()=>{
        const response=await this.transport(this.baseUrl+(imageInput?'/images/edits':'/images/generations'),{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
        if(!response.ok){
          const status=response.status;await response.body?.cancel();
          const uncertain=status===408||status>=500;
          throw new ServiceError(status===401||status===403?status:status===429?429:uncertain?502:400,status===401||status===403?'authentication':status===429?'rate-limit':status===408?'timeout':'provider-error',`OpenAI HTTP ${status}; ${uncertain?'outcome is unknown; do not automatically resubmit':'check server key, model access, quota and request policy'}`,uncertain);
        }
        const bytes=await readBounded(response,RESPONSE_BYTES,true);let result:any;
        try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ServiceError(502,'incompatible-api','Invalid OpenAI JSON response; outcome is unknown',true);}
        if(!result||!Array.isArray(result.data)||result.data.length!==1||(result.output_format!==undefined&&result.output_format!=='png'))throw new ServiceError(502,'invalid-output','OpenAI did not return one PNG image');
        const data=result.data[0]?.b64_json;
        if(typeof data!=='string'||!data.length||data.length>RESPONSE_BYTES||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new ServiceError(502,'invalid-output','OpenAI did not return valid inline PNG data');
        return {image:new Uint8Array(Buffer.from(data,'base64'))};
      })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ServiceError(504,'timeout','OpenAI outcome is unknown; do not automatically resubmit',true));},this.timeoutMs);})]);
    }catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError(502,'connection','OpenAI connection interrupted; outcome is unknown',true);}
    finally{if(timer)clearTimeout(timer);}
  }
  normalizeOutput(bytes:Uint8Array,request:GenerationRequest,assumeSrgb=false):Uint8Array {
    const image=decodePng(bytes,{allowUntagged:assumeSrgb}),box=openAIFrame(request);
    if(rasterDepth(image)!==8)throw new ServiceError(502,'invalid-output','OpenAI output must be genuine 8-bit PNG');
    if(image.width!==box.canvasWidth||image.height!==box.canvasHeight)throw new ServiceError(502,'invalid-output','OpenAI output dimensions differ from the planned canvas');
    const rgba=new Uint8Array(box.width*box.height*4);
    for(let y=0;y<box.height;y++)rgba.set(image.rgba.subarray(((y+box.top)*box.canvasWidth+box.left)*4,((y+box.top)*box.canvasWidth+box.left+box.width)*4),y*box.width*4);
    const output=resize({width:box.width,height:box.height,rgba},request.width,request.height);
    if(request.kind==='asset'&&!output.rgba.some((v,i)=>i%4===3&&v<255))throw new ServiceError(502,'invalid-output','OpenAI did not return a transparent asset');
    return encodePng(output);
  }
}
