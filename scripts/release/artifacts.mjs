// Build-only archive inspection. The publication job imports policy.mjs alone.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {crc32,inflateRawSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {assetRecipe,inspectBundleFiles,readReleaseConfig,validateProjectVersions,validateManifest,verifyBundle,MANIFEST_NAME} from './policy.mjs';
import {environmentSourceNames,ENVIRONMENT_GENERATED_FILES,PLUGIN_RUNTIME_FILES,rewriteSourceGuideLinks,sourceGuideReference} from '../package.mjs';

function reject(message) {throw new Error(`Release archive: ${message}`);}
function exactNames(entries,expected,label) {
  const actual=Object.keys(entries);
  const missing=expected.filter(name=>!Object.hasOwn(entries,name)),extra=actual.filter(name=>!expected.includes(name));
  if(missing.length||extra.length) reject(`${label} allowlist mismatch; missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`);
  for(const [name,bytes] of Object.entries(entries)) if(!bytes.length) reject(`${label}/${name} is empty`);
}

// Read metadata before allocating expanded buffers. The current packager
// emits ordinary single-disk ZIPs without ZIP64, descriptors or directory entries.
function decodeArchive(bytes,label) {
  const size=bytes.length,end=size-22;
  const invalid=(detail)=>reject(`${label}: invalid ZIP ${detail}`);
  if(size<22||size>128*1024*1024||bytes.readUInt32LE(end)!==0x06054b50) invalid('end/size');
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+20)) invalid('disk/comment');
  const count=bytes.readUInt16LE(end+10),centralSize=bytes.readUInt32LE(end+12),centralStart=bytes.readUInt32LE(end+16);
  if(!count||count>512||count!==bytes.readUInt16LE(end+8)||centralStart+centralSize!==end) invalid('directory');
  const metadata=[],names=new Set();let cursor=centralStart,total=0;
  for(let index=0;index<count;index++) {
    if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50) invalid('central record');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),compressed=bytes.readUInt32LE(cursor+20),expanded=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),offset=bytes.readUInt32LE(cursor+42);
    const next=cursor+46+nameLength+extraLength+commentLength;
    if(next>end||!nameLength||nameLength>512||flags&~0x0800||![0,8].includes(method)||bytes.readUInt16LE(cursor+34)) invalid('unsupported record');
    const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    if(!/^[A-Za-z0-9_@./-]+$/.test(name)||name.startsWith('/')||name.endsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')||names.has(name)) invalid('unsafe or duplicate name');
    names.add(name);
    if((bytes.readUInt32LE(cursor+38)>>>16&0xf000)===0xa000) invalid('symbolic link');
    if(!expanded||expanded>64*1024*1024||compressed===0xffffffff||offset===0xffffffff||(total+=expanded)>256*1024*1024) invalid('inflation budget/size');
    if(offset+30>centralStart||bytes.readUInt32LE(offset)!==0x04034b50) invalid('local header');
    const localNameLength=bytes.readUInt16LE(offset+26),localExtraLength=bytes.readUInt16LE(offset+28),dataStart=offset+30+localNameLength+localExtraLength;
    if(dataStart+compressed>centralStart||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method||bytes.readUInt32LE(offset+14)!==bytes.readUInt32LE(cursor+16)||bytes.readUInt32LE(offset+18)!==compressed||bytes.readUInt32LE(offset+22)!==expanded||bytes.subarray(offset+30,offset+30+localNameLength).toString('utf8')!==name) invalid('local/central mismatch');
    metadata.push({name,size:expanded,crc:bytes.readUInt32LE(cursor+16),method,offset,start:dataStart,end:dataStart+compressed});cursor=next;
  }
  if(cursor!==end) invalid('central length');
  let previous=0;
  for(const item of [...metadata].sort((a,b)=>a.offset-b.offset)) {if(item.offset!==previous) invalid('overlapping or unlisted local data');previous=item.end;}
  if(previous!==centralStart) invalid('unlisted data');
  const entries={};
  for(const item of metadata) {
    const compressed=bytes.subarray(item.start,item.end);let output;
    if(item.method===0) output=compressed;
    else {
      let decoded;
      try {decoded=inflateRawSync(compressed,{maxOutputLength:item.size,info:true});}
      catch {invalid(`compressed data or inflation size for ${item.name}`);}
      if(decoded.engine.bytesWritten!==compressed.length) invalid(`compressed input consumption for ${item.name}`);
      output=decoded.buffer;
    }
    if(output.length!==item.size||crc32(output)!==item.crc) invalid(`CRC/size for ${item.name}`);
    entries[item.name]=output;
  }
  return entries;
}

function localReference(name,target,entries,{runtime=false}={}) {
  const reference=target.trim();
  if(!reference||reference.startsWith('#')||/^(?:https?:|mailto:|data:)/i.test(reference)) {
    if(runtime&&/^(?:https?:|data:)/i.test(reference)) reject(`${name}: external runtime resource ${reference}`);
    return;
  }
  let file;
  try {file=decodeURIComponent(reference.split(/[?#]/)[0]);} catch {reject(`${name}: invalid resource link`);}
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),file));
  if(!file||file.startsWith('/')||file.includes('\\')||resolved.startsWith('../')||!Object.hasOwn(entries,resolved)) reject(`${name}: missing local resource/link ${reference}`);
}
function verifyLinks(entries,runtime=false) {
  for(const [name,bytes] of Object.entries(entries)) {
    if(!/\.(?:md|html|css)$/.test(name)) continue;
    const text=Buffer.from(bytes).toString('utf8');
    const expression=name.endsWith('.css')?/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g:/\]\(([^\s)]+)\)|\b(?:src|href)=["']([^"']+)["']/g;
    for(const match of text.matchAll(expression)) localReference(name,match[1]??match[2],entries,{runtime:runtime&&!name.endsWith('.md')});
  }
}
function readManifest(bytes,label) {
  try {return JSON.parse(Buffer.from(bytes).toString('utf8'));} catch {reject(`${label}: invalid manifest JSON`);}
}
async function verifyNotices(bytes,root,label) {
  const text=Buffer.from(bytes).toString('utf8');
  for(const [name,file] of [['UPNG.js','upng-js'],['pako','pako'],['@noble/hashes','@noble/hashes']]) {
    const license=await fs.readFile(path.join(root,'node_modules',file,'LICENSE'),'utf8');
    if(!text.includes(name)||!text.includes(license)) reject(`${label}: incomplete runtime notices for ${name}`);
  }
}
async function verifyPlugin(entries,{root,version,hostMinimum},portable) {
  const prefix=portable?'PS-AI-FOR-ME/':'',label=portable?'Portable':'CCX';
  exactNames(entries,[...PLUGIN_RUNTIME_FILES.map(name=>prefix+name),...(portable?['INSTALL_PORTABLE.md']:[])],label);
  const runtime=Object.fromEntries(PLUGIN_RUNTIME_FILES.map(name=>[name,entries[prefix+name]]));
  const manifest=readManifest(runtime['manifest.json'],label),source=JSON.parse(await fs.readFile(path.join(root,'dist/plugin/manifest.json'),'utf8'));
  if(manifest.version!==version) reject(`${label} manifest version: expected ${version}`);
  if(manifest.id!==(portable?'local.ps-ai.portable':'local.ps-ai')) reject(`${label} manifest id`);
  if(Array.isArray(manifest.host)||manifest.host?.app!=='PS'||manifest.host?.minVersion!==hostMinimum) reject(`${label} manifest host`);
  source.host=Array.isArray(source.host)?source.host[0]:source.host;
  if(portable) {source.id='local.ps-ai.portable';source.name='PS-AI (Portable)';for(const entry of source.entrypoints??[]) if(entry.type==='panel') entry.label={...entry.label,default:'PS-AI (Portable)'};}
  if(!isDeepStrictEqual(manifest,source)) reject(`${label} manifest differs from the actual build`);
  if(manifest.main!=='index.html'||!manifest.entrypoints?.some(entry=>entry.type==='panel'&&entry.id==='psai')) reject(`${label} manifest runtime entry`);
  const iconGroups=[...(manifest.icons??[]),...(manifest.entrypoints??[]).flatMap(entry=>entry.icons??[])];
  for(const icon of iconGroups) {
    localReference('manifest.json',icon.path,runtime,{runtime:true});
    for(const scale of icon.scale??[]) localReference('manifest.json',icon.path.replace(/\.png$/,`@${scale}x.png`),runtime,{runtime:true});
  }
  for(const name of PLUGIN_RUNTIME_FILES.filter(name=>name!=='manifest.json')) {
    const expected=await fs.readFile(path.join(root,'dist/plugin',name));
    if(!Buffer.from(runtime[name]).equals(expected)) reject(`${label}/${name}: differs from build source/resource`);
  }
  if(!Buffer.from(runtime.LICENSE).equals(await fs.readFile(path.join(root,'LICENSE')))) reject(`${label}: LICENSE differs from source`);
  for(const name of ['index.html','style.css']) if(!Buffer.from(runtime[name]).equals(await fs.readFile(path.join(root,'plugin',name)))) reject(`${label}/${name}: differs from source`);
  for(const name of ['start-ps-ai-relay.cmd','start-ps-ai-relay.ps1']) if(!Buffer.from(runtime['relay/'+name]).equals(await fs.readFile(path.join(root,'scripts/relay',name)))) reject(`${label}: relay launcher differs from source`);
  if(portable&&!Buffer.from(entries['INSTALL_PORTABLE.md']).equals(Buffer.from(runtime['INSTALL.md']))) reject('Portable install guide differs from target build');
  await verifyNotices(runtime['THIRD_PARTY_NOTICES.txt'],root,label);
  verifyLinks(runtime,true);
}
async function verifyEnvironment(entries,{root,sourceRef},pluginEntries) {
  exactNames(entries,[...environmentSourceNames(),...ENVIRONMENT_GENERATED_FILES],'environment');
  for(const name of environmentSourceNames()) {
    let expected=await fs.readFile(path.join(root,name));
    if(name.endsWith('.md')) expected=Buffer.from(rewriteSourceGuideLinks(name,expected.toString('utf8'),sourceRef));
    if(!Buffer.from(entries[name]).equals(expected)) reject(`environment/${name}: differs from target source`);
  }
  for(const name of ['LICENSE','backend/LICENSE']) if(!Buffer.from(entries[name]).equals(await fs.readFile(path.join(root,'LICENSE')))) reject(`environment/${name}: missing source license`);
  if(!Buffer.from(entries['backend/ps-ai-gateway.mjs']).equals(Buffer.from(pluginEntries['relay/ps-ai-gateway.mjs']))) reject('environment gateway differs from plugin relay');
  await verifyNotices(entries['backend/THIRD_PARTY_NOTICES.txt'],root,'environment');
  verifyLinks(entries);
  for(const [name,bytes] of Object.entries(entries).filter(([name])=>name.startsWith('scripts/'))) {
    for(const match of Buffer.from(bytes).toString('utf8').matchAll(/['"]((?:config|scripts)\/[^'"\r\n]+\.(?:json|ps1))['"]/g)) if(!entries[match[1]]) reject(`environment/${name}: missing script reference ${match[1]}`);
  }
}
export async function verifyArchives({root,directory,version,hostMinimum,sourceRef='main'}) {
  sourceGuideReference(sourceRef);
  const files=await inspectBundleFiles(directory,version);
  const archives=[];let pluginEntries;
  for(const recipe of assetRecipe(version).filter(file=>file.kind!=='checksum')) {
    const file=files.find(file=>file.name===recipe.name),entries=decodeArchive(await fs.readFile(file.path),recipe.name);
    if(recipe.kind==='ccx') {await verifyPlugin(entries,{root,version,hostMinimum},false);pluginEntries=entries;}
    else if(recipe.kind==='portable') await verifyPlugin(entries,{root,version,hostMinimum},true);
    else await verifyEnvironment(entries,{root,sourceRef},pluginEntries);
    archives.push({name:recipe.name,entries:Object.keys(entries).length});
  }
  return {files,archives};
}
function renderNotes(template,manifest) {
  const base=`https://github.com/${manifest.repository}`,source=`${base}/tree/${manifest.sourceSha}`;
  const recipes=assetRecipe(manifest.version),download=kind=>`${base}/releases/download/${manifest.tag}/${recipes.find(file=>file.kind===kind).name}`;
  const values={TAG:manifest.tag,VERSION:manifest.version,CHANNEL:manifest.channel,SOURCE_SHA:manifest.sourceSha,HOST_MINIMUM:manifest.hostMinimum,SOURCE_URL:source,COMMITS_URL:`${base}/commits/${manifest.sourceSha}`,DOCS_ZH_URL:`${base}/blob/${manifest.sourceSha}/README.md`,DOCS_EN_URL:`${base}/blob/${manifest.sourceSha}/docs/README.en.md`,CCX_URL:download('ccx'),PORTABLE_URL:download('portable'),ENVIRONMENT_URL:download('environment')};
  if(!template.trim()||Buffer.byteLength(template)>512*1024) throw new Error('config/release-notes.md: empty or excessive template');
  return template.replace(/\{\{([^{}]+)\}\}/g,(_,key)=>{
    if(!Object.hasOwn(values,key)) throw new Error(`config/release-notes.md: unknown token ${key}`);
    return values[key];
  });
}
export async function prepareBundle({root,directory,...context}) {
  const {version,hostMinimum}=await validateProjectVersions(root,context.tag);
  const {channel}=await readReleaseConfig(root);
  const {files}=await verifyArchives({root,directory,version,hostMinimum,sourceRef:context.sourceSha});
  const manifest={schemaVersion:1,...context,version,channel,hostMinimum,notes:'pending',files:files.map(({name,size,sha256})=>({name,size,sha256}))};
  validateManifest(manifest);
  manifest.notes=renderNotes(await fs.readFile(path.join(root,'config/release-notes.md'),'utf8'),manifest);
  validateManifest(manifest);
  await fs.writeFile(path.join(path.resolve(directory),MANIFEST_NAME),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return verifyBundle(directory);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const required=['PSAI_SOURCE_DIR','PSAI_BUNDLE_DIR','PSAI_REPOSITORY','PSAI_WORKFLOW','PSAI_TAG','PSAI_TAG_OBJECT_SHA','PSAI_SOURCE_SHA','PSAI_AUTOMATION_SHA','PSAI_RUN_ID','PSAI_RUN_ATTEMPT'];
    for(const name of required) if(!process.env[name]) throw new Error(`${name} is required`);
    const result=await prepareBundle({root:process.env.PSAI_SOURCE_DIR,directory:process.env.PSAI_BUNDLE_DIR,repository:process.env.PSAI_REPOSITORY,workflow:process.env.PSAI_WORKFLOW,tag:process.env.PSAI_TAG,tagObjectSha:process.env.PSAI_TAG_OBJECT_SHA,sourceSha:process.env.PSAI_SOURCE_SHA,automationSha:process.env.PSAI_AUTOMATION_SHA,runId:process.env.PSAI_RUN_ID,runAttempt:process.env.PSAI_RUN_ATTEMPT});
    const output={manifestSha256:result.manifestSha256,version:result.manifest.version,channel:result.manifest.channel,hostMinimum:result.manifest.hostMinimum};
    console.log(JSON.stringify(output));
    if(process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,Object.entries(output).map(([key,value])=>`${key}=${value}\n`).join(''));
  } catch(error) {console.error(`Release prepare failed: ${error.message}`);process.exitCode=1;}
}
