import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('独立网关构建无需源码或 node_modules 即可显示启动帮助，不嵌入密钥',async()=>{
  // @ts-expect-error Build tools are JavaScript.
  const {gatewayBundle}=await import('../scripts/build-gateway.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-gateway-bundle-'));
  try{const bytes=await gatewayBundle(process.cwd()),file=path.join(root,'ps-ai-gateway.mjs');await fs.writeFile(file,bytes);const result=spawnSync(process.execPath,[file,'--help'],{encoding:'utf8',timeout:5000,env:{...process.env,DASHSCOPE_API_KEY:'not-embedded',OPENAI_API_KEY:'not-embedded'}});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/8190/);assert.match(result.stdout,/DASHSCOPE_API_KEY/);assert.match(result.stdout,/OPENAI_API_KEY/);assert.doesNotMatch(Buffer.from(bytes).toString(),/not-embedded/);}finally{await fs.rm(root,{recursive:true,force:true});}
});
