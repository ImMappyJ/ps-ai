export const PLATFORM_IDS=['bailian','gemini','openai'] as const;
export type PlatformId=typeof PLATFORM_IDS[number];
export const PLATFORMS={
  bailian:{label:'BaiLian',port:8191,model:'qwen-image-2.1-pro'},
  gemini:{label:'Nano Banana',port:8192,model:'gemini-2.5-flash-image'},
  openai:{label:'GPT Image',port:8193,model:'gpt-image-1.5'}
};
export function isPlatform(value:unknown):value is PlatformId{return PLATFORM_IDS.includes(value as PlatformId);}
export function platformUrl(id:PlatformId):string{return `http://127.0.0.1:${PLATFORMS[id].port}`;}
export function validateApiKey(value:string):string{const key=value.trim();if(!key||key.length>512||/[^\x21-\x7e]/.test(key))throw new Error('API Key 无效，请重新输入');return key;}
