import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {unzipSync,strFromU8,zipSync} from 'fflate';import {spawnSync} from 'node:child_process';
test('文件夹 ZIP 可直接复制到 Plug-ins，独立标识且保留原运行代码与许可证',async()=>{
  // @ts-expect-error Packaging is plain JS.
  const {createPortablePackage}=await import('../scripts/package.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-portable-'));
  try{
    const input=path.join(root,'input');await fs.mkdir(input);
    const manifest={manifestVersion:5,id:'local.ps-ai',name:'PS-AI FOR ME',version:'0.2.2',host:{app:'PS'},main:'index.html',entrypoints:[{type:'panel',id:'psai',label:{default:'PS-AI FOR ME'}}]};
    await fs.writeFile(path.join(input,'manifest.json'),JSON.stringify(manifest));await fs.writeFile(path.join(input,'index.html'),'panel');await fs.writeFile(path.join(input,'main.js'),'original runtime');await fs.writeFile(path.join(input,'LICENSE'),'GPL fixture');
    const target=path.join(root,'portable.zip');await createPortablePackage(input,target);const entries=unzipSync(await fs.readFile(target));
    const packed=JSON.parse(strFromU8(entries['PS-AI-FOR-ME/manifest.json']));assert.equal(packed.id,'local.ps-ai.portable');assert.equal(packed.entrypoints[0].id,'psai');assert.match(packed.name,/Portable/);assert.match(packed.entrypoints[0].label.default,/Portable/);
    assert.equal(strFromU8(entries['PS-AI-FOR-ME/main.js']),'original runtime');assert.equal(strFromU8(entries['PS-AI-FOR-ME/LICENSE']),'GPL fixture');assert.ok(entries['INSTALL_PORTABLE.md']);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(input,'manifest.json'),'utf8')),manifest);
    await fs.writeFile(path.join(input,'private.log'),'private');await assert.rejects(createPortablePackage(input,target),/文件/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('发行归档保留完整 GPLv3 许可证',async()=>{
  // @ts-expect-error Packaging is plain JS.
  const {createPackage,createEnvironmentPackage}=await import('../scripts/package.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-license-'));
  try{
    const license=await fs.readFile('LICENSE','utf8');
    const input=path.join(root,'input');await fs.mkdir(input);
    await fs.writeFile(path.join(input,'manifest.json'),JSON.stringify({host:{app:'PS'}}));
    await fs.writeFile(path.join(input,'index.html'),'');await fs.writeFile(path.join(input,'main.js'),'');
    await fs.writeFile(path.join(input,'LICENSE'),license);
    const ccx=path.join(root,'plugin.ccx');await createPackage(input,ccx);
    assert.equal(strFromU8(unzipSync(await fs.readFile(ccx)).LICENSE),license);
    const env=path.join(root,'environment.zip');await createEnvironmentPackage(process.cwd(),env);
    assert.equal(strFromU8(unzipSync(await fs.readFile(env)).LICENSE),license);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('打包校验拒绝缺失 ZIP64 字段的畸形归档且不会无限循环',()=>{
  const plain=Buffer.from(zipSync({'fixture.txt':new Uint8Array([1,2,3])}));const central=plain.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);plain.writeUInt32LE(0xffffffff,central+20);
  const end=plain.length-22,zip64=Buffer.alloc(56),locator=Buffer.alloc(20),eocd=Buffer.from(plain.subarray(end));zip64.writeUInt32LE(0x06064b50,0);zip64.writeUInt32LE(44,4);zip64.writeUInt32LE(1,32);zip64.writeUInt32LE(central,48);locator.writeUInt32LE(0x07064b50,0);locator.writeUInt32LE(end,8);eocd.writeUInt16LE(65535,8);const bytes=Buffer.concat([plain.subarray(0,end),zip64,locator,eocd]);
  const result=spawnSync(process.execPath,['--input-type=module','-e',"import {unzipSync} from 'fflate'; try {unzipSync(Buffer.from(process.argv[1],'hex')); process.exit(2);} catch(e) {console.log(e.message);}",bytes.toString('hex')],{encoding:'utf8',timeout:1500});
  assert.equal(result.status,0,result.error?.message||result.stderr);assert.match(result.stdout,/invalid zip data/i);
});
test('独立环境工具归档可直接解压运行，包含配置与指南且无 Node/个人路径/模型',async()=>{
  // @ts-expect-error Packaging is plain JS.
  const {createEnvironmentPackage}=await import('../scripts/package.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-env-package-'));
  try{const target=path.join(root,'environment.zip');await createEnvironmentPackage(process.cwd(),target);const entries=unzipSync(await fs.readFile(target));for(const name of ['scripts/check-environment.ps1','scripts/prepare-environment.ps1','scripts/install-ccx.ps1','config/settings.example.json','config/compatibility.json','COMFYUI.md','COMFYUI.en.md'])assert.ok(entries[name],name);assert.equal(Object.keys(entries).some(name=>/node_modules|\.gguf$|\.safetensors$|HANDOFF|docs\/|network-isolation/.test(name)),false);for(const bytes of Object.values(entries))assert.doesNotMatch(strFromU8(bytes),/D:\\AI|D:\\Dev\\Repos|C:\\Users\\Administrator/);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('CCX 根目录包含单宿主清单和有效资源，不携带模型/源码/测试',async()=>{
  // @ts-expect-error Build script is deliberately plain JS.
  const {createPackage}=await import('../scripts/package.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-package-'));
  try{const input=path.join(root,'input');await fs.mkdir(path.join(input,'icons'),{recursive:true});
    await fs.writeFile(path.join(input,'manifest.json'),JSON.stringify({manifestVersion:5,id:'local.ps-ai',version:'0.1.0',main:'index.html',host:[{app:'PS',minVersion:'27.0.0'}]}));
    await fs.writeFile(path.join(input,'index.html'),'<script src="main.js"></script>');await fs.writeFile(path.join(input,'main.js'),'console.log("plugin");');await fs.writeFile(path.join(input,'icons','plugin.png'),new Uint8Array([137,80,78,71]));
    const archive=path.join(root,'plugin.ccx');await createPackage(input,archive);
    const entries=unzipSync(await fs.readFile(archive));assert.deepEqual(Object.keys(entries).sort(),['icons/plugin.png','index.html','main.js','manifest.json']);
    const manifest=JSON.parse(strFromU8(entries['manifest.json']));assert.deepEqual(manifest.host,{app:'PS',minVersion:'27.0.0'});assert.equal(entries['icons/plugin.png'].length,4);
    await fs.writeFile(path.join(input,'icons','plugin@1x.png'),new Uint8Array([137,80,78,71]));await createPackage(input,archive);assert.ok(unzipSync(await fs.readFile(archive))['icons/plugin@1x.png']);
    await fs.writeFile(path.join(input,'.uxprc'),'development-session-only');await createPackage(input,archive);assert.equal(unzipSync(await fs.readFile(archive))['.uxprc'],undefined);
    await fs.writeFile(path.join(input,'model.gguf'),'model');await assert.rejects(createPackage(input,archive),/文件/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
