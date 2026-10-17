import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {unzipSync,strFromU8} from 'fflate';import {decodePng} from '../src/image';

test('built brand header and native icon references resolve to correctly sized PNGs',async()=>{
  const built=spawnSync(process.execPath,['scripts/build.mjs'],{encoding:'utf8',timeout:10000});assert.equal(built.status,0,built.stderr);
  const html=await fs.readFile('dist/plugin/index.html','utf8'),logo=html.match(/<img[^>]+class="brand-symbol"[^>]+src="([^"]+)"/);
  assert.ok(logo,'brand header needs a native-compatible PNG symbol');
  assert.equal(decodePng(await fs.readFile(path.join('dist/plugin',logo[1]))).width,64,'32px header needs a 2x resource');
  const manifest=JSON.parse(await fs.readFile('dist/plugin/manifest.json','utf8'));
  assert.equal(manifest.id,'local.ps-ai');assert.equal(manifest.entrypoints[0].id,'psai');
  for(const icon of [...manifest.icons,...manifest.entrypoints[0].icons])for(const scale of icon.scale){
    const name=icon.path.replace(/\.png$/,`@${scale}x.png`),png=decodePng(await fs.readFile(path.join('dist/plugin',name)));
    assert.equal(png.width,icon.width*scale,name);assert.equal(png.height,icon.height*scale,name);
    assert.ok(png.rgba.some((v,i)=>i%4===3&&v>0),name);
  }
  const meta=JSON.parse(await fs.readFile('artifacts/build-metafile.json','utf8'));
  assert.ok(!Object.keys(meta.inputs).some(name=>/resvg/.test(name)),'build-time SVG rendering must not enter UXP runtime');
});

test('small symbols preserve the open frame and sidebar has light/dark theme artwork',async()=>{
  for(const size of [16,24,32,48]){
    const png=decodePng(await fs.readFile(`assets/brand/icons/mark-${size}.png`)),row=Math.ceil(size*20/128),opening=[];
    for(let x=Math.floor(size*64/128);x<Math.ceil(size*84/128);x++)opening.push(png.rgba[(row*size+x)*4+3]);
    assert.ok(opening.includes(0),`${size}px top opening must contain a transparent pixel`);
  }
  const manifest=JSON.parse(await fs.readFile('plugin/manifest.json','utf8')),icons=manifest.entrypoints[0].icons;
  assert.ok(icons.some((i:any)=>i.theme.includes('darkest')));assert.ok(icons.some((i:any)=>i.theme.includes('lightest')));
});

test('brand source and exports are reproducible and favicon embeds real small PNGs',async()=>{
  const check=spawnSync(process.execPath,['scripts/export-brand.mjs','--check'],{encoding:'utf8',timeout:10000});
  assert.equal(check.status,0,check.stderr||check.stdout);
  for(const size of [16,24,32,48,64,128,256,512]){
    const png=decodePng(await fs.readFile(`assets/brand/icons/mark-${size}.png`));assert.equal(png.width,size);assert.equal(png.height,size);
    assert.equal(png.rgba[3],0,'transparent clear space');
  }
  const ico=await fs.readFile('assets/brand/favicon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
  for(let i=0;i<3;i++){const at=6+i*16,size=ico[at],length=ico.readUInt32LE(at+8),offset=ico.readUInt32LE(at+12);assert.equal(decodePng(ico.subarray(offset,offset+length)).width,size);}
});

test('brand changes preserve Portable storage identity and include header PNG inside archives',async()=>{
  // @ts-expect-error Packaging is plain JS.
  const {createPortablePackage}=await import('../scripts/package.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-brand-'));
  try{const archive=path.join(root,'portable.zip');await createPortablePackage(path.resolve('dist/plugin'),archive);const entries=unzipSync(await fs.readFile(archive));
    const manifest=JSON.parse(strFromU8(entries['PS-AI-FOR-ME/manifest.json']));assert.equal(manifest.id,'local.ps-ai.portable');assert.equal(manifest.entrypoints[0].id,'psai');
    const header=strFromU8(entries['PS-AI-FOR-ME/index.html']).match(/<img[^>]+class="brand-symbol"[^>]+src="([^"]+)"/);
    assert.ok(header);assert.ok(entries['PS-AI-FOR-ME/'+header[1]]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

// Runs after the synchronous build above; no dependency on another test file.

test('插件归档包含固定自动启动资源和完整依赖许可，不收录私人中转数据',async()=>{
  // @ts-expect-error Packaging is plain JS.
  const {createPackage,createPortablePackage}=await import('../scripts/package.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-relay-package-'));
  try{for(const portable of [false,true]){const target=path.join(root,portable?'portable.zip':'plugin.ccx');await(portable?createPortablePackage:createPackage)(path.resolve('dist/plugin'),target);const entries=unzipSync(await fs.readFile(target)),prefix=portable?'PS-AI-FOR-ME/':'';
    for(const file of ['ps-ai-gateway.mjs','start-ps-ai-relay.cmd','start-ps-ai-relay.ps1'])assert.ok(entries[prefix+'relay/'+file],file);
    assert.match(strFromU8(entries[prefix+'THIRD_PARTY_NOTICES.txt']),/@noble\/hashes/);assert.equal(JSON.parse(strFromU8(entries[prefix+'manifest.json'])).requiredPermissions.launchProcess.extensions[0],'.cmd');
    assert.equal(Object.keys(entries).some(k=>/credential-id|relay-session|gateway.lock|api-key/.test(k)),false);
  }}finally{await fs.rm(root,{recursive:true,force:true});}
});
