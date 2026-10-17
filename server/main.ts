import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';import {parseArgs} from 'node:util';
import {BailianProvider} from './providers/bailian';import {GeminiProvider} from './providers/gemini';import {OpenAIImagesProvider} from './providers/openai';import {createGateway} from './http/gateway';
import type {ImageProvider} from './providers/contract';
import {startManagedRelay} from './runtime/managed-relay';
export async function startGateway(options:{port?:number;dataDir?:string;env?:NodeJS.ProcessEnv}={}){
  if(Number(process.versions.node.split('.')[0])<24)throw new Error('PS-AI gateway requires Node.js 24 or later');
  const env=options.env??process.env,port=options.port??Number(env.PSAI_GATEWAY_PORT??8190);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PSAI_GATEWAY_PORT must be 1–65535 (0 selects a temporary test port)');
  const kind=env.PSAI_PROVIDER??'bailian';
  const factory=new Map<string,()=>ImageProvider>([
    ['bailian',()=>new BailianProvider({apiKey:env.DASHSCOPE_API_KEY,baseUrl:env.DASHSCOPE_BASE_URL})],
    ['gemini',()=>new GeminiProvider({apiKey:env.GEMINI_API_KEY})],
    ['openai',()=>new OpenAIImagesProvider({apiKey:env.OPENAI_API_KEY})]
  ]).get(kind);
  if(!factory)throw new Error('PSAI_PROVIDER must be bailian, gemini or openai');
  const provider=factory();
  const gateway=await createGateway({dataDir:options.dataDir??env.PSAI_GATEWAY_DATA_DIR??path.join(os.homedir(),'.ps-ai',kind),provider,assumeSrgb:env[`PSAI_${kind.toUpperCase()}_ASSUME_SRGB`]==='1'});
  try{await new Promise<void>((resolve,reject)=>{gateway.server.once('error',reject);gateway.server.listen(port,'127.0.0.1',()=>{gateway.server.off('error',reject);resolve();});});}
  catch(error){await gateway.close();throw error;}
  return {...gateway,capabilities:()=>provider.capabilities()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=parseArgs({options:{help:{type:'boolean'},port:{type:'string'},'data-dir':{type:'string'},managed:{type:'boolean'}}});
  if(args.values.help)console.log('PS-AI platform gateway (Node.js 24+)\nnode ps-ai-gateway.mjs [--port 8190] [--data-dir DIRECTORY]\nEnvironment: PSAI_PROVIDER=bailian|gemini|openai, DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL (official /api/v1 endpoint), GEMINI_API_KEY, OPENAI_API_KEY, PSAI_GATEWAY_PORT, PSAI_GATEWAY_DATA_DIR, PSAI_BAILIAN_ASSUME_SRGB=1 / PSAI_GEMINI_ASSUME_SRGB=1 / PSAI_OPENAI_ASSUME_SRGB=1 (explicit untagged-sRGB policy)\nListens on 127.0.0.1 only. Without an API key, capability checks work but generation is blocked.');
  else if(args.values.managed){
    if(!args.values['data-dir'])throw new Error('--managed requires --data-dir');
    void startManagedRelay({dataDir:args.values['data-dir']}).then(relay=>{console.log('PS-AI local relay ready');const stop=()=>void relay.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);}).catch(()=>{console.error('PS-AI relay could not start. Check Node 24, local ports and data locks.');process.exitCode=1;});
  }
  else void startGateway({port:args.values.port===undefined?undefined:Number(args.values.port),dataDir:args.values['data-dir']}).then(gateway=>{
    const info=gateway.capabilities();console.log(`PS-AI gateway listening at http://localhost:${(gateway.server.address() as any).port}; protocol=ps-ai/1; provider=${info.provider}; key configured=${info.configured}`);
    const stop=()=>{void gateway.close().then(()=>process.exit(0)).catch(()=>process.exit(1));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }).catch(error=>{console.error(error instanceof Error?error.message:'Gateway startup failed');process.exitCode=1;});
}
