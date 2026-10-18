// Shared with the write-permission job: keep every import in Node's standard library.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const MANIFEST_NAME = 'release-manifest.json';
const numericVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const shaPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const manifestLimit = 1024 * 1024;
const assetLimit = 256 * 1024 * 1024;
const contextKeys = ['repository','workflow','tag','tagObjectSha','sourceSha','automationSha','runId','runAttempt'];

function fail(field, detail) {throw new Error(`${field}: ${detail}`);}
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field,'expected an object');
}
function keys(value, allowed, field, required = allowed) {
  object(value,field);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(field,`unknown field ${key}`);
  for (const key of required) if (!Object.hasOwn(value,key)) fail(field,`missing field ${key}`);
}
export function assertVersion(value, field = 'version') {
  if (typeof value !== 'string' || value.length > 256 || !numericVersion.test(value)) fail(field,'expected numeric X.Y.Z without leading zeros');
  return value;
}
export function parseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) fail('tag','expected vX.Y.Z');
  return assertVersion(tag.slice(1),'tag');
}
export function compareVersions(left, right) {
  const a=assertVersion(left).split('.').map(BigInt), b=assertVersion(right).split('.').map(BigInt);
  for (let index=0;index<3;index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

async function readJson(file, field = file) {
  try {return JSON.parse(await fs.readFile(file,'utf8'));}
  catch (error) {if (error.code === 'ENOENT') throw error; fail(field,'cannot read valid JSON');}
}
export async function readReleaseConfig(root) {
  let value;
  try {value=await readJson(path.join(root,'config/release.json'),'config/release.json');}
  catch(error) {if(error.code === 'ENOENT') return {schemaVersion:1,channel:'prerelease'}; throw error;}
  keys(value,['schemaVersion','channel'],'config/release.json',['schemaVersion']);
  if(value.schemaVersion !== 1) fail('config/release.json:schemaVersion','expected 1');
  const channel=Object.hasOwn(value,'channel') ? value.channel : 'prerelease';
  if(!['prerelease','stable'].includes(channel)) fail('config/release.json:channel','expected prerelease or stable');
  return {schemaVersion:1,channel};
}
function photoshopHost(manifest, field) {
  const hosts=Array.isArray(manifest?.host) ? manifest.host : [manifest?.host];
  if(hosts.length !== 1 || hosts[0]?.app !== 'PS') fail(field+':host','expected exactly one Photoshop host');
  return assertVersion(hosts[0].minVersion,field+':host.minVersion');
}
export async function validateProjectVersions(root, tag, {includeBuild = true} = {}) {
  const version=parseTag(tag);
  const sources=[['package.json','version'],['package-lock.json','version'],['package-lock.json',"packages[''].version"],['plugin/manifest.json','version']];
  if(includeBuild) sources.push(['dist/plugin/manifest.json','version']);
  let hostMinimum;
  for(const [name,field] of sources) {
    const value=await readJson(path.join(root,name));
    const actual=field === 'version' ? value?.version : value?.packages?.['']?.version;
    assertVersion(actual,`${name}:${field}`);
    if(actual !== version) fail(`${name}:${field}`,`expected ${version}, found ${actual}`);
    if(name.endsWith('manifest.json')) {
      if(value.id !== 'local.ps-ai') fail(name+':id','expected local.ps-ai');
      const minimum=photoshopHost(value,name);
      if(hostMinimum && minimum !== hostMinimum) fail(name+':host.minVersion',`expected ${hostMinimum}, found ${minimum}`);
      hostMinimum=minimum;
    }
  }
  return {version,hostMinimum};
}
export function assetRecipe(version) {
  assertVersion(version);
  return [
    ['ccx',`ps-ai-${version}-experimental.ccx`],
    ['portable',`ps-ai-${version}-portable-experimental.zip`],
    ['environment',`ps-ai-${version}-environment-experimental.zip`]
  ].flatMap(([kind,name])=>[{name,kind},{name:name+'.sha256',kind:'checksum',archive:name}]);
}
function validateContext(value, field) {
  if(typeof value.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.repository) || value.repository.length > 200) fail(field+':repository','expected owner/repository');
  if(value.workflow !== '.github/workflows/release.yml') fail(field+':workflow','unexpected workflow path');
  parseTag(value.tag);
  for(const name of ['tagObjectSha','sourceSha','automationSha']) if(typeof value[name] !== 'string' || !shaPattern.test(value[name])) fail(field+':'+name,'expected lowercase full commit/object SHA');
  for(const name of ['runId','runAttempt']) if(typeof value[name] !== 'string' || !/^[1-9][0-9]{0,29}$/.test(value[name])) fail(field+':'+name,'expected a positive decimal string');
}
export function validateManifest(value) {
  const field='release manifest';
  keys(value,['schemaVersion',...contextKeys,'version','channel','hostMinimum','notes','files'],field);
  if(value.schemaVersion !== 1) fail(field+':schemaVersion','expected 1');
  validateContext(value,field);
  if(assertVersion(value.version,field+':version') !== parseTag(value.tag)) fail(field+':version','does not match tag');
  if(!['prerelease','stable'].includes(value.channel)) fail(field+':channel','expected prerelease or stable');
  assertVersion(value.hostMinimum,field+':hostMinimum');
  if(typeof value.notes !== 'string' || !value.notes.trim() || Buffer.byteLength(value.notes) > manifestLimit/2 || value.notes.includes('\0')) fail(field+':notes','expected nonempty bounded text');
  const expected=assetRecipe(value.version).map(file=>file.name);
  if(!Array.isArray(value.files) || value.files.length !== expected.length) fail(field+':files','incorrect asset set');
  const names=new Set();
  for(const file of value.files) {
    keys(file,['name','size','sha256'],field+':files');
    if(!expected.includes(file.name) || names.has(file.name)) fail(field+':files','incorrect or duplicate asset name');
    names.add(file.name);
    if(!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > assetLimit) fail(field+':files:'+file.name,'invalid size');
    if(typeof file.sha256 !== 'string' || !hashPattern.test(file.sha256)) fail(field+':files:'+file.name,'invalid SHA256');
  }
  return value;
}
export async function sha256File(file) {
  const hash=createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export async function inspectBundleFiles(directory, version, {manifest = false} = {}) {
  const resolved=path.resolve(directory), stat=await fs.lstat(resolved);
  if(!stat.isDirectory() || stat.isSymbolicLink()) fail('bundle directory','expected a real directory');
  const expected=[...assetRecipe(version).map(file=>file.name),...(manifest?[MANIFEST_NAME]:[])];
  const entries=await fs.readdir(resolved,{withFileTypes:true});
  if(entries.length !== expected.length || entries.some(entry=>!expected.includes(entry.name) || !entry.isFile() || entry.isSymbolicLink())) fail('bundle file set','unexpected, missing or nonregular file');
  const files=[];
  for(const name of expected) {
    const absolute=path.join(resolved,name), info=await fs.lstat(absolute);
    const limit=name===MANIFEST_NAME?manifestLimit:assetLimit;
    if(!info.isFile() || info.isSymbolicLink() || info.size<=0 || info.size>limit) fail(name,'empty, excessive or nonregular file');
    files.push({name,size:info.size,sha256:await sha256File(absolute),path:absolute});
  }
  for(const file of assetRecipe(version).filter(file=>file.kind==='checksum')) {
    const archive=files.find(item=>item.name===file.archive);
    const checksum=files.find(item=>item.name===file.name);
    if(checksum.size>1024 || await fs.readFile(checksum.path,'utf8') !== `${archive.sha256}  ${archive.name}\n`) fail(file.name,'checksum content does not match archive hash/name');
  }
  return files;
}
export async function verifyBundle(directory, {expectedContext = {}, expectedManifestSha256} = {}) {
  keys(expectedContext,[...contextKeys,'version','channel','hostMinimum'],'expected context',[]);
  if(expectedManifestSha256 !== undefined && !hashPattern.test(expectedManifestSha256)) fail('expected manifest hash','invalid SHA256');
  const manifestPath=path.join(path.resolve(directory),MANIFEST_NAME), info=await fs.lstat(manifestPath);
  if(!info.isFile() || info.isSymbolicLink() || info.size<=0 || info.size>manifestLimit) fail('release manifest','invalid file or size');
  let manifest;
  try {manifest=validateManifest(await readJson(manifestPath,'release manifest'));}
  catch(error) {if(error.message.startsWith('release manifest')) throw error; fail('release manifest',error.message);}
  for(const [field,value] of Object.entries(expectedContext)) if(manifest[field] !== value) fail('release manifest:'+field,'does not match trusted context');
  const files=await inspectBundleFiles(directory,manifest.version,{manifest:true});
  const manifestSha256=files.find(file=>file.name===MANIFEST_NAME).sha256;
  if(expectedManifestSha256 !== undefined && manifestSha256 !== expectedManifestSha256) fail('release manifest hash','does not match trusted build output');
  for(const record of manifest.files) {
    const file=files.find(item=>item.name===record.name);
    if(file.size !== record.size || file.sha256 !== record.sha256) fail(record.name,'size/hash does not match release manifest');
  }
  return {manifest,manifestSha256,directory:path.resolve(directory),files};
}
