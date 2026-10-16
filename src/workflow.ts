import {DEFAULT_MODELS,validateModels} from './profile';import type {ModelFiles} from './profile';
export interface GraphOptions {requestId:string;prompt:string;seed:number;steps:number;resolution:number;source?:string;guide?:string;reference?:string;models?:ModelFiles;outputDepth?:8|16}
export type Graph = Record<string,{class_type:string;inputs:Record<string,unknown>}>;
export const MODELS=DEFAULT_MODELS;
export const TEMPLATE_VERSION='qwen21-local-v2-rgba';
export function templateForDepth(depth:8|16=8):string {return depth===16?'qwen21-local-v3-rgba16':TEMPLATE_VERSION;}
export function buildGraph(o:GraphOptions):Graph {
  if(o.outputDepth!==undefined&&o.outputDepth!==8&&o.outputDepth!==16)throw new Error('输出位深须为 8 或 16');
  if(!o.prompt.trim()||!Number.isSafeInteger(o.seed)||o.seed<0||!Number.isInteger(o.steps)||o.steps<1||o.steps>100||!Number.isInteger(o.resolution)||o.resolution<32||o.resolution>2048||o.resolution%32) throw new Error('提示词、种子、步数或分辨率无效');
  if(!/^[a-zA-Z0-9-]+$/.test(o.requestId)) throw new Error('任务 ID 无效');
  if((o.guide||o.reference)&&!o.source) throw new Error('参考输入需要 image_1 原图');
  const models=validateModels(o.models??MODELS);
  const graph:Graph={
    '1':{class_type:'UnetLoaderGGUF',inputs:{unet_name:models.unet}},
    '2':{class_type:'CLIPLoader',inputs:{clip_name:models.clip,type:'qwen_image',device:'default'}},
    '3':{class_type:'VAELoader',inputs:{vae_name:models.vae}},
    '4':{class_type:'TextEncodeQwenImage21',inputs:{clip:['2',0],prompt:o.prompt,negative_prompt:'',resolution:o.source?0:o.resolution}},
    '5':{class_type:'QwenImage21Cache',inputs:{model:['1',0],device:'auto',dtype:'default'}},
    '6':{class_type:'KSampler',inputs:{model:['5',0],seed:o.seed,steps:o.steps,cfg:1,sampler_name:'euler',scheduler:'simple',positive:['4',0],negative:['4',1],latent_image:['4',2],denoise:1}},
    '7':{class_type:'VAEDecode',inputs:{samples:['6',0],vae:['3',0]}},
    '8':{class_type:o.outputDepth===16?'PS_AISavePNG16':'SaveImage',inputs:{images:['7',0],filename_prefix:`ps-ai/${o.requestId}`}}
  };
  const images=[o.source,o.guide,o.reference].filter((s):s is string=>!!s);
  images.forEach((image,index)=>{
    const id=String(9+index);graph[id]={class_type:'LoadImage',inputs:{image}};
    let output=id;
    if(index===0||image===o.reference){output=String(12+index);graph[output]={class_type:'JoinImageWithAlpha',inputs:{image:[id,0],alpha:[id,1]}};}
    graph['4'].inputs[`images.image_${index+1}`]=[output,0];
  });
  if(o.source)graph['4'].inputs.vae=['3',0];
  return graph;
}
