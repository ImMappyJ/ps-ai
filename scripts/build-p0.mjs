import fs from 'node:fs/promises';import {build} from 'esbuild';
await fs.mkdir('dist/p0',{recursive:true});
const manifest={manifestVersion:5,id:'local.ps-ai.p0',name:'ps-ai P0 验证',version:'0.1.0',main:'index.html',host:[{app:'PS',minVersion:'27.0.0',data:{apiVersion:2}}],entrypoints:[{type:'panel',id:'p0',label:{default:'ps-ai P0 验证'},minimumSize:{width:300,height:240},preferredDockedSize:{width:360,height:450}}],requiredPermissions:{localFileSystem:'plugin',network:{domains:['http://127.0.0.1:8188','ws://127.0.0.1:8188']}}};
await fs.writeFile('dist/p0/manifest.json',JSON.stringify(manifest,null,2));
await fs.writeFile('dist/p0/index.html','<!doctype html><html><body><h3>ps-ai P0 宿主往返验证</h3><pre id="report">正在验证临时测试文档…</pre><script src="main.js"></script></body></html>');
await build({entryPoints:['src/p0-entry.ts'],bundle:true,outfile:'dist/p0/main.js',platform:'browser',format:'iife',target:'es2020',external:['photoshop','uxp'],define:{'process.env.NODE_ENV':'"production"'}});
