// No npm install, provider SDK, or execution of bundle contents in the write job.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createGitHub,assertRepository,assertSha,assertId} from './github.mjs';
import {MANIFEST_NAME,parseTag,compareVersions,validateManifest,verifyBundle,assetRecipe} from './policy.mjs';
import {WORKFLOW,recheckTag,requiredEnv,writeOutputs} from './resolve.mjs';

const identityFields=['repository','workflow','tag','tagObjectSha','sourceSha','automationSha','runId','runAttempt'];
const markerFields=['schemaVersion',...identityFields,'version','channel','manifestSha256','notesSha256'];
const digestPattern=/^[a-f0-9]{64}$/;
const manifestLimit=1024*1024,assetLimit=256*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(stage,detail){throw new Error(`${stage}: ${detail}`);}
function requireHash(value,field){if(typeof value!=='string'||!digestPattern.test(value))fail(field,'expected lowercase SHA256');return value;}
function trustedContext(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('trusted context','expected explicit build identity');
  for(const key of identityFields)if(typeof value[key]!=='string'||!value[key])fail('trusted context',`missing ${key}`);
  assertRepository(value.repository);parseTag(value.tag);
  if(value.workflow!==WORKFLOW)fail('trusted context','unexpected workflow');
  for(const field of ['tagObjectSha','sourceSha','automationSha'])assertSha(value[field],`trusted context ${field}`);
  for(const field of ['runId','runAttempt'])assertId(value[field],`trusted context ${field}`);
}
function markerFrom(manifest,manifestSha256,notes) {
  return Object.fromEntries(markerFields.map(field=>[field,field==='schemaVersion'?1:field==='manifestSha256'?manifestSha256:field==='notesSha256'?hash(notes):manifest[field]]));
}
function parseOwnership(release) {
  const match=typeof release.body==='string'&&/^<!-- ps-ai-release:v1 ([^\r\n]+) -->\n([\s\S]*)$/.exec(release.body);
  if(!match)fail('release ownership','not a controlled draft/release; preserve it and use a new version');
  let marker;
  try{marker=JSON.parse(match[1]);}catch{fail('release ownership','invalid ownership marker');}
  if(!marker||typeof marker!=='object'||Array.isArray(marker)||Object.keys(marker).length!==markerFields.length||markerFields.some(field=>!Object.hasOwn(marker,field))||Object.keys(marker).some(field=>!markerFields.includes(field)))fail('release ownership','invalid ownership schema');
  trustedContext(marker);
  if(marker.schemaVersion!==1||marker.version!==parseTag(marker.tag)||!['prerelease','stable'].includes(marker.channel))fail('release ownership','invalid ownership identity');
  requireHash(marker.manifestSha256,'release ownership manifest hash');requireHash(marker.notesSha256,'release ownership notes hash');
  if(match[2].includes('<!-- ps-ai-release:')||hash(match[2])!==marker.notesSha256)fail('release ownership','prepared notes changed');
  return {marker,notes:match[2]};
}
function checkMarkerManifest(marker,manifest,manifestSha256,notes) {
  for(const field of [...identityFields,'version','channel'])if(marker[field]!==manifest[field])fail('release ownership',`${field} disagrees with the original manifest; use a new version`);
  if(marker.manifestSha256!==manifestSha256)fail('release ownership','original manifest hash disagrees; use a new version');
  if(!notes.startsWith(manifest.notes.trimEnd()+'\n\n'))fail('release ownership','notes do not retain the target template');
}
function checkDraftBatch(marker,manifest,manifestSha256) {
  for(const field of [...identityFields,'version','channel'])if(marker[field]!==manifest[field])fail('draft batch',`different ${field}; re-run only the failed publish job of original run ${marker.runId}, build attempt ${marker.runAttempt}, using its original artifact; do not rebuild or replace the draft`);
  if(marker.manifestSha256!==manifestSha256)fail('draft batch',`different manifest bytes; recover the original artifact from run ${marker.runId}, build attempt ${marker.runAttempt}; otherwise preserve the draft and use a new version`);
}
function releaseRecord(value,stage) {
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.tag_name!=='string'||!value.tag_name||value.tag_name.length>300||/[\0\r\n]/.test(value.tag_name)||typeof value.draft!=='boolean'||typeof value.prerelease!=='boolean'||(value.body!==null&&typeof value.body!=='string'))fail(stage,'malformed release response');
  assertId(value.id,stage+' release ID');return value;
}
async function listReleases(github) {
  const values=await github.paginate('/releases',{stage:'release listing'}),seen=new Set();
  for(const value of values){releaseRecord(value,'release listing');const id=String(value.id);if(seen.has(id))fail('release listing','duplicate release identity across pages');seen.add(id);}
  return values;
}
function matchingRelease(releases,tag) {
  const matching=releases.filter(release=>release.tag_name===tag);
  if(matching.length>1)fail('release lookup','multiple same-tag releases are ambiguous; preserve them');
  return matching[0]??null;
}
async function latestPlan(github,releases,manifest) {
  const response=await github.request('GET','/releases/latest',{stage:'Latest lookup',allow404:true});
  const latest=response?releaseRecord(response.data,'Latest lookup'):null;
  if(latest&&(latest.draft||latest.prerelease||!releases.some(release=>String(release.id)===String(latest.id)&&release.tag_name===latest.tag_name)))fail('Latest lookup','current Latest is not a known published stable release');
  let makeLatest=false;
  if(manifest.channel==='stable'){
    const versions=[];
    for(const release of releases.filter(item=>!item.draft&&!item.prerelease)){
      try{versions.push(parseTag(release.tag_name));}catch{fail('Latest decision','existing stable tag is not strict vX.Y.Z; preserve Latest and resolve repository policy explicitly');}
    }
    makeLatest=versions.every(version=>compareVersions(manifest.version,version)>0);
  }
  return {makeLatest,previousLatestId:latest?String(latest.id):null};
}
function assetRecord(value,stage) {
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.name!=='string'||!value.name||/[\/\\\0\r\n]/.test(value.name)||!Number.isSafeInteger(value.size)||value.size<=0||value.size>assetLimit||value.state!=='uploaded')fail(stage,'asset is malformed, empty, excessive or not uploaded');
  assertId(value.id,stage+' asset ID');return value;
}
async function listAssets(github,release) {
  const values=await github.paginate(`/releases/${assertId(release.id)}/assets`,{stage:'asset listing'}),names=new Set(),ids=new Set();
  for(const asset of values){assetRecord(asset,'asset verification');if(names.has(asset.name)||ids.has(String(asset.id)))fail('asset verification','duplicate asset name or ID');names.add(asset.name);ids.add(String(asset.id));}
  return values;
}
async function downloadAsset(github,asset,limit=assetLimit) {
  if(asset.size>limit)fail('asset download','asset exceeds the expected budget');
  const response=await github.request('GET',`/releases/assets/${assertId(asset.id)}`,{stage:'asset download',binary:true,maxBytes:limit});
  if(!Buffer.isBuffer(response.data)||response.data.length!==asset.size)fail('asset download','downloaded size differs from remote asset');
  return response.data;
}
async function verifyRemoteAssets(github,release,files,{allowMissing=false,assets}={}) {
  assets??=await listAssets(github,release);
  const expected=new Map(files.map(file=>[file.name,file]));
  for(const asset of assets){
    const file=expected.get(asset.name);
    if(!file)fail('asset verification','unexpected asset name; preserve the draft');
    if(asset.size!==file.size)fail('asset verification',`size mismatch for ${file.name}`);
    const usable=typeof asset.digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(asset.digest);
    if(usable){if(asset.digest!=='sha256:'+file.sha256)fail('asset verification',`digest mismatch for ${file.name}`);}
    else if(hash(await downloadAsset(github,asset,file.name===MANIFEST_NAME?manifestLimit:assetLimit))!==file.sha256)fail('asset verification',`download hash mismatch for ${file.name}`);
  }
  const missing=files.filter(file=>!assets.some(asset=>asset.name===file.name));
  if(!allowMissing&&missing.length)fail('asset verification','missing expected assets; release is incomplete');
  return {missing,assets};
}
async function verifyPublished(github,release,current) {
  const {marker,notes}=parseOwnership(release);
  for(const field of ['repository','workflow','tag','tagObjectSha','sourceSha','version','channel'])if(marker[field]!==current.manifest[field])fail('published release',`${field} conflicts; preserve the published release and use a new version`);
  if(release.prerelease!==(marker.channel==='prerelease'))fail('published release','channel conflicts; use a new version');
  const assets=await listAssets(github,release),manifestAsset=assets.find(asset=>asset.name===MANIFEST_NAME);
  if(!manifestAsset)fail('published release','original manifest asset is missing; use a new version');
  const bytes=await downloadAsset(github,manifestAsset,manifestLimit);
  if(hash(bytes)!==marker.manifestSha256)fail('published release','original manifest hash differs; use a new version');
  let manifest;
  try{manifest=validateManifest(JSON.parse(bytes.toString('utf8')));}catch{fail('published release','original manifest is invalid; use a new version');}
  checkMarkerManifest(marker,manifest,hash(bytes),notes);
  const files=[...manifest.files,{name:MANIFEST_NAME,size:bytes.length,sha256:hash(bytes)}];
  await verifyRemoteAssets(github,release,files,{assets});
  for(const checksum of assetRecipe(manifest.version).filter(file=>file.kind==='checksum')){
    const asset=assets.find(item=>item.name===checksum.name),archive=manifest.files.find(file=>file.name===checksum.archive);
    if((await downloadAsset(github,asset,1024)).toString('utf8')!==`${archive.sha256}  ${archive.name}\n`)fail('published release','original checksum content disagrees; use a new version');
  }
  const latest=await latestPlan(github,await listReleases(github),manifest);
  if(release.prerelease&&latest.previousLatestId===String(release.id))fail('published release','a prerelease cannot be Latest');
  return {status:'already-complete',releaseId:String(release.id),latest:latest.previousLatestId===String(release.id)};
}
function previousRelease(releases,manifest) {
  return releases.filter(release=>!release.draft&&release.tag_name!==manifest.tag).flatMap(release=>{
    try{const version=parseTag(release.tag_name);return compareVersions(version,manifest.version)<0?[{...release,version}]:[];}catch{return [];}
  }).sort((a,b)=>compareVersions(b.version,a.version))[0];
}
async function prepareNotes(github,releases,manifest) {
  const previous=previousRelease(releases,manifest),request={tag_name:manifest.tag,target_commitish:manifest.sourceSha};
  if(previous)request.previous_tag_name=previous.tag_name;
  const {data}=await github.request('POST','/releases/generate-notes',{stage:'generated notes',body:request});
  if(!data||typeof data.body!=='string'||Buffer.byteLength(data.body)>100000)fail('generated notes','malformed or excessive generated notes');
  const link=previous?`https://github.com/${manifest.repository}/compare/${previous.tag_name}...${manifest.tag}`:`https://github.com/${manifest.repository}/commits/${manifest.sourceSha}`;
  const notes=manifest.notes.trimEnd()+`\n\n---\n\n## Changes / 变更\n\n${data.body.trim()||'GitHub returned no generated entries. See the actual history below. / GitHub 未返回自动条目，请查看实际历史。'}\n\n[${previous?'Compare changes / 比较变更':'Commit history / 提交历史'}](${link})\n`;
  if(notes.includes('<!-- ps-ai-release:')||notes.includes('\0')||Buffer.byteLength(notes)>120000)fail('generated notes','prepared notes exceed limits or contain a reserved marker');
  return notes;
}
async function withNotes(body,run) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-release-notes-'));
  const file=path.join(directory,'notes.md');
  try{await fs.writeFile(file,body,{flag:'wx',mode:0o600});return await run(file);}
  finally{await fs.rm(file,{force:true});await fs.rmdir(directory);}
}
export async function publishRelease({github,directory,expectedContext,expectedManifestSha256,dryRun=true}) {
  trustedContext(expectedContext);requireHash(expectedManifestSha256,'trusted manifest hash');
  if(typeof dryRun!=='boolean')fail('dry run','expected explicit boolean');
  const bundle=await verifyBundle(directory,{expectedContext,expectedManifestSha256}),{manifest,manifestSha256,files}=bundle;
  await recheckTag({github,...manifest});
  let releases=await listReleases(github),release=matchingRelease(releases,manifest.tag);
  if(release&&!release.draft)return verifyPublished(github,release,bundle);
  let body;
  if(release){
    const {marker,notes}=parseOwnership(release);checkDraftBatch(marker,manifest,manifestSha256);checkMarkerManifest(marker,manifest,manifestSha256,notes);body=release.body;
    await verifyRemoteAssets(github,release,files,{allowMissing:true});
  }
  await latestPlan(github,releases,manifest);
  if(dryRun)return {status:'dry-run',releaseId:release?String(release.id):'',latest:false};
  if(!release){
    const notes=await prepareNotes(github,releases,manifest);body=`<!-- ps-ai-release:v1 ${JSON.stringify(markerFrom(manifest,manifestSha256,notes))} -->\n${notes}`;
    await recheckTag({github,...manifest});
    await withNotes(body,notesFile=>github.createDraft({tag:manifest.tag,title:`PS-AI ${manifest.version}`,notesFile,prerelease:manifest.channel==='prerelease'}));
    release=matchingRelease(await listReleases(github),manifest.tag);
    if(!release||!release.draft)fail('draft creation','created draft cannot be confirmed; do not automatically recreate it');
  }else await recheckTag({github,...manifest});
  const ownership=parseOwnership(release);checkDraftBatch(ownership.marker,manifest,manifestSha256);checkMarkerManifest(ownership.marker,manifest,manifestSha256,ownership.notes);
  const initial=await verifyRemoteAssets(github,release,files,{allowMissing:true});
  for(const file of initial.missing)await github.upload(manifest.tag,file.path);
  await verifyRemoteAssets(github,release,files);
  await withNotes(body,notesFile=>github.prepareDraft({tag:manifest.tag,title:`PS-AI ${manifest.version}`,notesFile,prerelease:manifest.channel==='prerelease'}));
  releases=await listReleases(github);const prepared=matchingRelease(releases,manifest.tag);
  if(!prepared||String(prepared.id)!==String(release.id)||!prepared.draft||prepared.name!==`PS-AI ${manifest.version}`||prepared.prerelease!==(manifest.channel==='prerelease')||prepared.body!==body)fail('draft preparation','draft identity, title, notes or channel changed; preserve it');
  const finalOwnership=parseOwnership(prepared);checkDraftBatch(finalOwnership.marker,manifest,manifestSha256);
  await verifyRemoteAssets(github,prepared,files);
  const latest=await latestPlan(github,releases,manifest);
  // The workflow serializes all publication tags; this is the last remote read before publication.
  await recheckTag({github,...manifest});
  await github.publishDraft({tag:manifest.tag,prerelease:manifest.channel==='prerelease',latest:latest.makeLatest});
  const published=matchingRelease(await listReleases(github),manifest.tag);
  if(!published||String(published.id)!==String(release.id)||published.draft||published.name!==`PS-AI ${manifest.version}`||published.prerelease!==(manifest.channel==='prerelease')||published.body!==body)fail('publication verification','final release metadata differs; do not write to a published release');
  await verifyRemoteAssets(github,published,files);
  const finalLatest=await latestPlan(github,await listReleases(github),manifest),expectedLatest=latest.makeLatest?String(published.id):latest.previousLatestId;
  if(finalLatest.previousLatestId!==expectedLatest)fail('publication verification','Latest identity differs from the explicit decision; do not mutate the published release');
  return {status:'published',releaseId:String(published.id),latest:latest.makeLatest};
}
async function main() {
  const expectedContext={repository:requiredEnv('PSAI_REPOSITORY'),workflow:requiredEnv('PSAI_WORKFLOW'),tag:requiredEnv('PSAI_TAG'),tagObjectSha:requiredEnv('PSAI_TAG_OBJECT_SHA'),sourceSha:requiredEnv('PSAI_SOURCE_SHA'),automationSha:requiredEnv('PSAI_AUTOMATION_SHA'),runId:requiredEnv('PSAI_RUN_ID'),runAttempt:requiredEnv('PSAI_RUN_ATTEMPT')};
  const dryRun=process.env.PSAI_DRY_RUN??'true';
  if(!['true','false'].includes(dryRun))fail('environment','PSAI_DRY_RUN must be true or false');
  await writeOutputs(await publishRelease({github:createGitHub({repository:expectedContext.repository}),directory:requiredEnv('PSAI_BUNDLE_DIR'),expectedContext,expectedManifestSha256:requiredEnv('PSAI_MANIFEST_SHA256'),dryRun:dryRun==='true'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(`release publication failed: ${error.message}\n`);process.exitCode=1;});
