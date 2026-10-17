import {build} from 'esbuild';import path from 'node:path';import fs from 'node:fs/promises';
export async function gatewayBundle(root){
  const result=await build({absWorkingDir:root,entryPoints:[path.join(root,'server/main.ts')],platform:'node',target:'node24',format:'esm',bundle:true,write:false,define:{'process.env.NODE_ENV':'"production"'}});
  return result.outputFiles[0].contents;
}
export async function gatewayNotices(root){
  let notices='PS-AI platform gateway — third-party runtime notices\n\n';
  for(const [name,file] of [['UPNG.js','node_modules/upng-js/LICENSE'],['pako','node_modules/pako/LICENSE']])notices+=name+'\n'+await fs.readFile(path.join(root,file),'utf8')+'\n\n';
  return notices;
}
