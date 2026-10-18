import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {zipSync, unzipSync, strToU8, strFromU8} from 'fflate';

// @ts-expect-error Release tooling is deliberately dependency-free JavaScript.
const policy = await import('../scripts/release/policy.mjs');
const sourceRoot = process.cwd();
const sha = '1'.repeat(40), otherSha = '2'.repeat(40);
const context = {repository:'ImMappyJ/ps-ai', workflow:'.github/workflows/release.yml', tag:'v0.4.0', tagObjectSha:sha, sourceSha:sha, automationSha:otherSha, runId:'123', runAttempt:'1'};
const digest = (bytes: Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-ai-release-'));
  try {await run(directory);} finally {await fs.rm(directory, {recursive:true,force:true});}
}

test('release tags reject ambiguous numeric spellings and shell/ref suffixes', () => {
  // A permissive semver parser would accept versions that are not release tags.
  assert.equal(policy.parseTag?.('v0.4.0'), '0.4.0');
  assert.equal(policy.parseTag?.('v999999999999999999999.0.1'), '999999999999999999999.0.1');
  for (const value of ['0.4.0','v01.2.3','v1.02.3','v1.2.03','v1.2.3-rc.1','v1.2.3\n','refs/tags/v1.2.3','v1.2.3;echo x','v1.2.3/other','']) {
    assert.throws(() => policy.parseTag?.(value), /tag/i, value);
  }
});

test('semantic ordering preserves integers larger than Number precision', () => {
  // Number conversion would equate these different versions and regress Latest.
  assert.equal(policy.compareVersions?.('9007199254740993.0.0','9007199254740992.9.9'), 1);
  assert.equal(policy.compareVersions?.('1.10.0','1.9.999'), 1);
  assert.equal(policy.compareVersions?.('1.0.0','1.0.0'), 0);
  assert.equal(policy.compareVersions?.('0.9.0','1.0.0'), -1);
});

test('release channel defaults conservatively and malformed config fails closed', async () => temporary(async (root) => {
  assert.deepEqual(await policy.readReleaseConfig?.(root), {schemaVersion:1,channel:'prerelease'});
  await fs.mkdir(path.join(root,'config'));
  for (const [config,channel] of [[{schemaVersion:1},'prerelease'],[{schemaVersion:1,channel:'stable'},'stable']] as const) {
    await fs.writeFile(path.join(root,'config/release.json'),JSON.stringify(config));
    assert.equal((await policy.readReleaseConfig(root)).channel,channel);
  }
  for (const config of [{},null,[],{schemaVersion:2},{schemaVersion:1,channel:'Stable'},{schemaVersion:1,channel:null},{schemaVersion:1,extra:true}]) {
    await fs.writeFile(path.join(root,'config/release.json'),JSON.stringify(config));
    await assert.rejects(policy.readReleaseConfig(root), /release\.json/);
  }
  await fs.writeFile(path.join(root,'config/release.json'),'{broken');
  await assert.rejects(policy.readReleaseConfig(root), /release\.json/);
}));

async function project(root: string) {
  await fs.mkdir(path.join(root,'plugin'),{recursive:true});
  await fs.mkdir(path.join(root,'dist/plugin'),{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'ps-ai',version:'0.4.0',dependencies:{external:'99.0.0'}}));
  await fs.writeFile(path.join(root,'package-lock.json'),JSON.stringify({version:'0.4.0',packages:{'':{name:'ps-ai',version:'0.4.0'},'node_modules/external':{version:'99.0.0'}}}));
  const manifest = {id:'local.ps-ai',version:'0.4.0',host:[{app:'PS',minVersion:'27.0.0'}]};
  await fs.writeFile(path.join(root,'plugin/manifest.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(root,'dist/plugin/manifest.json'),JSON.stringify(manifest));
}

test('version checks inspect every project field without treating dependencies as release versions', async () => temporary(async (root) => {
  await project(root);
  assert.deepEqual(await policy.validateProjectVersions?.(root,'v0.4.0'),{version:'0.4.0',hostMinimum:'27.0.0'});
  for (const [file,field] of [['package.json','version'],['package-lock.json','version'],['package-lock.json',"packages[''].version"],['plugin/manifest.json','version'],['dist/plugin/manifest.json','version']]) {
    await project(root);
    const value=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
    if (field.startsWith('packages')) value.packages[''].version='0.3.0'; else value.version='0.3.0';
    await fs.writeFile(path.join(root,file),JSON.stringify(value));
    await assert.rejects(policy.validateProjectVersions(root,'v0.4.0'),(error: Error) => error.message.includes(file+':'+field));
  }
}));

test('asset recipe fixes the actual experimental archive names independently of channel', () => {
  assert.deepEqual(policy.assetRecipe?.('0.4.0'),[
    {name:'ps-ai-0.4.0-experimental.ccx',kind:'ccx'},
    {name:'ps-ai-0.4.0-experimental.ccx.sha256',kind:'checksum',archive:'ps-ai-0.4.0-experimental.ccx'},
    {name:'ps-ai-0.4.0-portable-experimental.zip',kind:'portable'},
    {name:'ps-ai-0.4.0-portable-experimental.zip.sha256',kind:'checksum',archive:'ps-ai-0.4.0-portable-experimental.zip'},
    {name:'ps-ai-0.4.0-environment-experimental.zip',kind:'environment'},
    {name:'ps-ai-0.4.0-environment-experimental.zip.sha256',kind:'checksum',archive:'ps-ai-0.4.0-environment-experimental.zip'}
  ]);
});

function manifestFixture() {
  return {...context,schemaVersion:1,version:'0.4.0',channel:'prerelease',hostMinimum:'27.0.0',notes:'中文 / English\nTarget release notes.', files:[
    {name:'ps-ai-0.4.0-experimental.ccx',size:3,sha256:digest('ccx')},
    {name:'ps-ai-0.4.0-experimental.ccx.sha256',size:95,sha256:'a'.repeat(64)},
    {name:'ps-ai-0.4.0-portable-experimental.zip',size:3,sha256:digest('zip')},
    {name:'ps-ai-0.4.0-portable-experimental.zip.sha256',size:104,sha256:'b'.repeat(64)},
    {name:'ps-ai-0.4.0-environment-experimental.zip',size:3,sha256:digest('env')},
    {name:'ps-ai-0.4.0-environment-experimental.zip.sha256',size:107,sha256:'c'.repeat(64)}
  ]};
}

test('manifest rejects extra paths, missing assets, invalid identities and self hashing', () => {
  const valid = manifestFixture();
  assert.deepEqual(policy.validateManifest?.(valid),valid);
  const bad = [
    {...valid,repository:'../ps-ai'}, {...valid,tag:'v0.3.0'}, {...valid,automationSha:'main'},
    {...valid,runAttempt:1}, {...valid,runId:'01'}, {...valid,channel:'beta'}, {...valid,secret:'extra'},
    {...valid,workflow:'../release.yml'}, {...valid,sourceSha:'A'.repeat(40)}, {...valid,sourceSha:[sha]},
    {...valid,files:valid.files.slice(1)},
    {...valid,files:[...valid.files,{name:'release-manifest.json',size:1,sha256:'a'.repeat(64)}]},
    {...valid,files:valid.files.map((file,index)=>index===0?{...file,name:'../private.ccx'}:file)},
    {...valid,files:valid.files.map((file,index)=>index===0?{...file,size:0}:file)},
    {...valid,files:valid.files.map((file,index)=>index===0?{...file,sha256:'BAD'}:file)}
  ];
  for(const value of bad) assert.throws(()=>policy.validateManifest(value),/manifest/i);
});

test('built-in bundle check verifies exact file set, checksum contents and trusted context', async () => temporary(async (root) => {
  const manifest=manifestFixture();
  for(let index=0;index<manifest.files.length;index+=2) {
    const archive=manifest.files[index],checksum=manifest.files[index+1];
    const bytes=Buffer.from(['ccx','zip','env'][index/2]);
    const checksumBytes=Buffer.from(`${digest(bytes)}  ${archive.name}\n`);
    archive.size=bytes.length; archive.sha256=digest(bytes);
    checksum.size=checksumBytes.length; checksum.sha256=digest(checksumBytes);
    await fs.writeFile(path.join(root,archive.name),bytes);await fs.writeFile(path.join(root,checksum.name),checksumBytes);
  }
  const manifestBytes=JSON.stringify(manifest,null,2)+'\n', expectedHash=digest(manifestBytes);
  await fs.writeFile(path.join(root,'release-manifest.json'),manifestBytes);
  const verified=await policy.verifyBundle?.(root,{expectedContext:context,expectedManifestSha256:expectedHash});
  assert.equal(verified?.manifestSha256,expectedHash);
  assert.equal(verified?.files[0].path,path.join(root,'ps-ai-0.4.0-experimental.ccx'));
  await assert.rejects(policy.verifyBundle(root,{expectedContext:{...context,runId:'124'}}),/runId/);
  await assert.rejects(policy.verifyBundle(root,{expectedManifestSha256:'f'.repeat(64)}),/manifest.*hash/i);
  await fs.writeFile(path.join(root,'old.zip'),'old');
  await assert.rejects(policy.verifyBundle(root),/file set/i);await fs.unlink(path.join(root,'old.zip'));
  await fs.writeFile(path.join(root,manifest.files[0].name),'BAD');
  await assert.rejects(policy.verifyBundle(root),/hash/i);
  await fs.writeFile(path.join(root,manifest.files[0].name),'ccx');
  await fs.writeFile(path.join(root,manifest.files[0].name),'');
  await assert.rejects(policy.verifyBundle(root),/empty/i);
  await fs.writeFile(path.join(root,manifest.files[0].name),'ccx');
  await fs.unlink(path.join(root,manifest.files[2].name));
  await assert.rejects(policy.verifyBundle(root),/file set/i);
}));

test('bundle verification works without npm dependencies or executing bundled scripts', async () => temporary(async (root) => {
  // Importing a dependency from policy.mjs would break the write job isolation.
  await fs.copyFile(path.join(sourceRoot,'scripts/release/policy.mjs'),path.join(root,'policy.mjs'));
  const result=spawnSync(process.execPath,['--input-type=module','-e',"const p=await import('./policy.mjs'); console.log(p.parseTag('v0.4.0'));"],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'0.4.0');
}));

test('explicit package output refuses existing content without changing it or default release files', async () => temporary(async (root) => {
  // Ignoring the opt-in destination could overwrite the user's existing release/.
  const output=path.join(root,'new-batch');await fs.mkdir(output);await fs.writeFile(path.join(output,'keep.txt'),'keep');
  await fs.mkdir(path.join(root,'release'));await fs.writeFile(path.join(root,'release','keep.txt'),'old release');
  const result=spawnSync(process.execPath,[path.join(sourceRoot,'scripts/package.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,PSAI_RELEASE_DIR:output}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/output.*nonempty/i);
  assert.equal(await fs.readFile(path.join(output,'keep.txt'),'utf8'),'keep');
  assert.deepEqual(await fs.readdir(path.join(root,'release')),['keep.txt']);
}));

test('packager source links use an explicit immutable source SHA and reject arbitrary refs', async () => temporary(async (root) => {
  // @ts-expect-error Packaging is plain JavaScript.
  const {createEnvironmentPackage}=await import('../scripts/package.mjs');
  const target=path.join(root,'environment.zip');
  await createEnvironmentPackage(sourceRoot,target,{sourceRef:sha});
  const entries=unzipSync(await fs.readFile(target));
  assert.match(strFromU8(entries['README.md']),new RegExp(`/blob/${sha}/AGENTS\\.md`));
  assert.match(strFromU8(entries['README.md']),new RegExp(`/blob/${sha}/docs/development/BACKEND\\.md`));
  assert.doesNotMatch(strFromU8(entries['README.md']),/\/blob\/main\/docs\/development\//);
  await assert.rejects(createEnvironmentPackage(sourceRoot,target,{sourceRef:'main; echo unsafe'}),/sourceRef/);
}));

test('trusted packaging allowlists load without control-checkout npm dependencies', async () => temporary(async (root) => {
  // A static fflate/esbuild import would make the separate control checkout unusable.
  await fs.copyFile(path.join(sourceRoot,'scripts/package.mjs'),path.join(root,'package.mjs'));
  const script="const p=await import('./package.mjs'); const files=p.environmentSourceNames(); if(!files.includes('src/generation/workflow.ts')||!files.includes('src/infrastructure/config/profile.ts')||files.includes('src/workflow.ts')) process.exit(3); console.log('source paths present');";
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'source paths present');
}));

// @ts-expect-error Build release tooling is plain JavaScript.
const artifacts = await import('../scripts/release/artifacts.mjs');
async function archiveFixture(directory: string) {
  // Keep real source/docs/launchers, tiny image fixtures and inert runtime bytes.
  // @ts-expect-error Packaging is plain JavaScript.
  const packager=await import('../scripts/package.mjs');
  const root=path.join(directory,'source'),output=path.join(directory,'bundle');
  await project(root);await fs.mkdir(output);
  await fs.symlink(path.join(sourceRoot,'node_modules'),path.join(root,'node_modules'),'junction');
  let notices='Third-party runtime notices\n';
  for(const [name,folder] of [['UPNG.js','upng-js'],['pako','pako'],['@noble/hashes','@noble/hashes']]) notices+=name+'\n'+await fs.readFile(path.join(sourceRoot,'node_modules',folder,'LICENSE'),'utf8')+'\n';
  for(const name of packager.environmentSourceNames()) {
    const target=path.join(root,name);await fs.mkdir(path.dirname(target),{recursive:true});
    const bytes=/\.(png|jpg|ico)$/.test(name)?Buffer.from([137,80,78,71,13,10,26,10]):await fs.readFile(path.join(sourceRoot,name));
    await fs.writeFile(target,bytes);
  }
  await fs.mkdir(path.join(root,'config'),{recursive:true});
  await fs.writeFile(path.join(root,'config/release.json'),'{"schemaVersion":1,"channel":"prerelease"}\n');
  await fs.copyFile(path.join(sourceRoot,'config/release-notes.md'),path.join(root,'config/release-notes.md'));
  const manifest=JSON.parse(await fs.readFile(path.join(sourceRoot,'plugin/manifest.json'),'utf8'));manifest.version='0.4.0';
  await fs.writeFile(path.join(root,'plugin/manifest.json'),JSON.stringify(manifest));
  const entries:Record<string,Uint8Array>={};
  for(const name of packager.PLUGIN_RUNTIME_FILES) {
    let bytes:Uint8Array;
    if(name==='manifest.json') bytes=strToU8(JSON.stringify({...manifest,host:manifest.host[0]}));
    else if(name==='index.html'||name==='style.css') bytes=await fs.readFile(path.join(sourceRoot,'plugin',name));
    else if(name==='LICENSE') bytes=await fs.readFile(path.join(sourceRoot,'LICENSE'));
    else if(name==='INSTALL.md') bytes=strToU8(packager.INSTALL_GUIDE);
    else if(name==='THIRD_PARTY_NOTICES.txt') bytes=strToU8(notices);
    else if(name.startsWith('icons/')) bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
    else if(name.startsWith('relay/start-')) bytes=await fs.readFile(path.join(sourceRoot,'scripts',name));
    else bytes=strToU8('throw new Error("Archive data must never execute");');
    entries[name]=bytes;
    const file=path.join(root,'dist/plugin',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
  }
  await fs.writeFile(path.join(root,'dist/plugin/manifest.json'),JSON.stringify(manifest));
  await fs.copyFile(path.join(sourceRoot,'plugin/index.html'),path.join(root,'plugin/index.html'));
  await fs.copyFile(path.join(sourceRoot,'plugin/style.css'),path.join(root,'plugin/style.css'));
  for(const name of ['start-ps-ai-relay.cmd','start-ps-ai-relay.ps1']) {
    await fs.mkdir(path.join(root,'scripts/relay'),{recursive:true});await fs.copyFile(path.join(sourceRoot,'scripts/relay',name),path.join(root,'scripts/relay',name));
  }
  const archiveNames=['ps-ai-0.4.0-experimental.ccx','ps-ai-0.4.0-portable-experimental.zip','ps-ai-0.4.0-environment-experimental.zip'];
  await fs.writeFile(path.join(output,archiveNames[0]),zipSync(entries));
  const portableManifest=structuredClone(JSON.parse(strFromU8(entries['manifest.json'])));portableManifest.id='local.ps-ai.portable';portableManifest.name='PS-AI (Portable)';portableManifest.entrypoints[0].label.default='PS-AI (Portable)';
  const portable:Record<string,Uint8Array>=Object.fromEntries(Object.entries(entries).map(([name,bytes])=>['PS-AI-FOR-ME/'+name,bytes]));portable['PS-AI-FOR-ME/manifest.json']=strToU8(JSON.stringify(portableManifest));portable['INSTALL_PORTABLE.md']=strToU8(packager.INSTALL_GUIDE);
  await fs.writeFile(path.join(output,archiveNames[1]),zipSync(portable));
  const environment:Record<string,Uint8Array>={};
  for(const name of packager.environmentSourceNames()) {
    const bytes=await fs.readFile(path.join(root,name));
    environment[name]=name.endsWith('.md')?strToU8(packager.rewriteSourceGuideLinks(name,bytes.toString('utf8'),sha)):bytes;
  }
  environment['backend/ps-ai-gateway.mjs']=entries['relay/ps-ai-gateway.mjs'];environment['backend/LICENSE']=entries.LICENSE;environment['backend/THIRD_PARTY_NOTICES.txt']=entries['THIRD_PARTY_NOTICES.txt'];
  await fs.writeFile(path.join(output,archiveNames[2]),zipSync(environment));
  for(const name of archiveNames) await checksum(output,name);
  return {root,directory:output,version:'0.4.0',hostMinimum:'27.0.0',sourceRef:sha,archiveNames};
}
async function checksum(directory:string,name:string) {
  await fs.writeFile(path.join(directory,name+'.sha256'),`${digest(await fs.readFile(path.join(directory,name)))}  ${name}\n`);
}
async function mutateArchive(directory:string,name:string,change:(entries:Record<string,Uint8Array>)=>void) {
  const file=path.join(directory,name), entries=unzipSync(await fs.readFile(file));change(entries);
  await fs.writeFile(file,zipSync(entries));await checksum(directory,name);
}
function mutateDeflateStream(bytes:Buffer,name:string,change:(compressed:Buffer,declaredSize:number)=>Buffer) {
  const centralStart=bytes.readUInt32LE(bytes.length-6),records=[];let cursor=centralStart;
  while(bytes.readUInt32LE(cursor)===0x02014b50) {
    const nameLength=bytes.readUInt16LE(cursor+28),entryName=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    records.push({cursor,name:entryName,local:bytes.readUInt32LE(cursor+42)});
    cursor+=46+nameLength+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32);
  }
  const record=records.find(record=>record.name===name);assert.ok(record);assert.equal(bytes.readUInt16LE(record.cursor+10),8);
  const start=record.local+30+bytes.readUInt16LE(record.local+26)+bytes.readUInt16LE(record.local+28),end=start+bytes.readUInt32LE(record.cursor+20);
  const compressed=change(bytes.subarray(start,end),bytes.readUInt32LE(record.cursor+24)),delta=compressed.length-(end-start);
  const changed=Buffer.concat([bytes.subarray(0,start),compressed,bytes.subarray(end)]);
  changed.writeUInt32LE(compressed.length,record.local+18);
  for(const item of records) {
    if(item.name===name) changed.writeUInt32LE(compressed.length,item.cursor+delta+20);
    if(item.local>record.local) changed.writeUInt32LE(item.local+delta,item.cursor+delta+42);
  }
  changed.writeUInt32LE(centralStart+delta,changed.length-6);
  return changed;
}

test('archive acceptance verifies complete current packages and writes a target-owned non-self-referential manifest', async () => temporary(async (directory) => {
  assert.equal(typeof artifacts.prepareBundle,'function');
  const fixture=await archiveFixture(directory);
  const result=await artifacts.prepareBundle({...context,root:fixture.root,directory:fixture.directory});
  assert.equal(result.manifest.version,'0.4.0');assert.equal(result.manifest.channel,'prerelease');
  assert.equal(result.files.length,7);assert.equal(result.manifest.files.some((file:{name:string})=>file.name==='release-manifest.json'),false);
  assert.match(result.manifest.notes,/中文/);assert.match(result.manifest.notes,/English/);
  assert.ok(result.manifest.notes.includes(`/tree/${sha}`));assert.ok(result.manifest.notes.includes(`/commits/${sha}`));
  assert.doesNotMatch(result.manifest.notes,/\{\{[A-Z_]+\}\}/);
}));

test('portable acceptance keeps the target installation guide when control documentation is newer', async () => temporary(async(directory)=>{
  const fixture=await archiveFixture(directory),guide='中文 / English\nInstructions maintained at this target tag.\n';
  await fs.writeFile(path.join(fixture.root,'dist/plugin/INSTALL.md'),guide);
  await mutateArchive(fixture.directory,fixture.archiveNames[0],entries=>{entries['INSTALL.md']=strToU8(guide);});
  await mutateArchive(fixture.directory,fixture.archiveNames[1],entries=>{entries['PS-AI-FOR-ME/INSTALL.md']=strToU8(guide);entries['INSTALL_PORTABLE.md']=strToU8(guide);});
  await assert.doesNotReject(artifacts.verifyArchives(fixture));
}));

test('archive verifier rejects missing runtime resources and malformed plugin identities or versions', async () => {
  assert.equal(typeof artifacts.verifyArchives,'function');
  for(const [entry,replace,expected] of [
    ['main.js',undefined,/main\.js/],['icons/plugin@2x.png',undefined,/plugin@2x/],['relay/start-ps-ai-relay.cmd',undefined,/start-ps-ai-relay/],
    ['manifest.json',JSON.stringify({id:'other',version:'0.4.0',host:{app:'PS',minVersion:'27.0.0'}}),/manifest/],
    ['manifest.json',JSON.stringify({id:'local.ps-ai',version:'0.3.0',host:{app:'PS',minVersion:'27.0.0'}}),/version/]
  ] as const) await temporary(async(directory)=>{
    const fixture=await archiveFixture(directory);
    await mutateArchive(fixture.directory,fixture.archiveNames[0],entries=>{if(replace===undefined)delete entries[entry];else entries[entry]=strToU8(replace);});
    await assert.rejects(artifacts.verifyArchives(fixture),expected);
  });
});

test('archive verifier rejects private extras, old source paths and broken local resource links', async () => {
  assert.equal(typeof artifacts.verifyArchives,'function');
  for(const mutation of ['private','old-path','broken-html','broken-css','broken-doc','broken-script'] as const) await temporary(async(directory)=>{
    const fixture=await archiveFixture(directory),index=mutation==='broken-html'||mutation==='broken-css'?0:2;
    const badHtml='<script src="missing.js"></script>',badCss='body {background:url("icons/missing.png")}',badDoc='[missing](docs/missing.md)',badScript="Get-Content 'config/missing.json'";
    // Keep source/build bytes aligned so these cases exercise reference checks,
    // rather than being rejected by the earlier byte-for-byte source check.
    if(mutation==='broken-html'||mutation==='broken-css') {
      const name=mutation==='broken-html'?'index.html':'style.css',text=mutation==='broken-html'?badHtml:badCss;
      await fs.writeFile(path.join(fixture.root,'plugin',name),text);await fs.writeFile(path.join(fixture.root,'dist/plugin',name),text);
    } else if(mutation==='broken-doc') await fs.writeFile(path.join(fixture.root,'README.md'),badDoc);
    else if(mutation==='broken-script') await fs.writeFile(path.join(fixture.root,'scripts/check-environment.ps1'),badScript);
    await mutateArchive(fixture.directory,fixture.archiveNames[index],entries=>{
      if(mutation==='private') entries['docs/local/private.md']=strToU8('private');
      else if(mutation==='old-path') {entries['src/workflow.ts']=entries['src/generation/workflow.ts'];delete entries['src/generation/workflow.ts'];}
      else if(mutation==='broken-html') entries['index.html']=strToU8(badHtml);
      else if(mutation==='broken-css') entries['style.css']=strToU8(badCss);
      else if(mutation==='broken-doc') entries['README.md']=strToU8(badDoc);
      else entries['scripts/check-environment.ps1']=strToU8(badScript);
    });
    await assert.rejects(artifacts.verifyArchives(fixture),/archive|resource|source|allowlist|link/i);
  });
});

test('archive decoder rejects oversized entries, duplicate names and damaged CRC before acceptance', async () => {
  assert.equal(typeof artifacts.verifyArchives,'function');
  for(const mutation of ['oversized','duplicate','crc'] as const) await temporary(async(directory)=>{
    const fixture=await archiveFixture(directory),name=fixture.archiveNames[0],file=path.join(fixture.directory,name),bytes=Buffer.from(await fs.readFile(file));
    const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>0);
    if(mutation==='oversized') bytes.writeUInt32LE(0xffffffff,central+24);
    else if(mutation==='crc') {
      const wrong=(bytes.readUInt32LE(central+16)^1)>>>0,local=bytes.readUInt32LE(central+42);
      bytes.writeUInt32LE(wrong,central+16);bytes.writeUInt32LE(wrong,local+14);
    }
    else {
      const length=46+bytes.readUInt16LE(central+28)+bytes.readUInt16LE(central+30)+bytes.readUInt16LE(central+32),record=bytes.subarray(central,central+length),end=Buffer.from(bytes.subarray(bytes.length-22));
      end.writeUInt16LE(end.readUInt16LE(8)+1,8);end.writeUInt16LE(end.readUInt16LE(10)+1,10);end.writeUInt32LE(end.readUInt32LE(12)+length,12);
      await fs.writeFile(file,Buffer.concat([bytes.subarray(0,bytes.length-22),record,end]));await checksum(fixture.directory,name);
      await assert.rejects(artifacts.verifyArchives(fixture),/duplicate|ZIP/i);return;
    }
    await fs.writeFile(file,bytes);await checksum(fixture.directory,name);
    await assert.rejects(artifacts.verifyArchives(fixture),/budget|ZIP|CRC|size/i);
  });
});

for(const mutation of ['expanded-suffix','trailing-compressed-bytes'] as const) test(`archive decoder rejects malformed actual DEFLATE data: ${mutation}`, async () => temporary(async(directory)=>{
  // fflate allocates the declared size and silently drops an expanded suffix.
  // Recompute the outer checksum so only strict ZIP decoding can catch this.
    const fixture=await archiveFixture(directory),name=fixture.archiveNames[0],file=path.join(fixture.directory,name);
    const changed=mutateDeflateStream(await fs.readFile(file),'main.js',(compressed,declaredSize)=>{
      if(mutation==='trailing-compressed-bytes') return Buffer.concat([compressed,Buffer.from('trailing bytes after the DEFLATE end')]);
      const original=inflateRawSync(compressed);assert.equal(original.length,declaredSize);
      const expanded=Buffer.concat([original,Buffer.from('\n// Hidden suffix beyond declared size.\n')]);
      const replacement=deflateRawSync(expanded);assert.ok(inflateRawSync(replacement).length>declaredSize);
      return replacement;
    });
    await fs.writeFile(file,changed);await checksum(fixture.directory,name);
    await assert.rejects(artifacts.verifyArchives(fixture),/ZIP.*(?:size|compressed|consumption|inflation)/i,mutation);
}));

test('prepare CLI uses target dependencies from a separate source checkout and no dependencies in control', async () => temporary(async(directory)=>{
  assert.equal(typeof artifacts.prepareBundle,'function');
  const fixture=await archiveFixture(directory),control=path.join(directory,'automation/scripts/release');await fs.mkdir(control,{recursive:true});
  await fs.copyFile(path.join(sourceRoot,'scripts/release/policy.mjs'),path.join(control,'policy.mjs'));await fs.copyFile(path.join(sourceRoot,'scripts/release/artifacts.mjs'),path.join(control,'artifacts.mjs'));
  await fs.copyFile(path.join(sourceRoot,'scripts/package.mjs'),path.join(control,'../package.mjs'));
  const result=spawnSync(process.execPath,[path.join(control,'artifacts.mjs')],{cwd:path.dirname(directory),encoding:'utf8',env:{...process.env,PSAI_SOURCE_DIR:fixture.root,PSAI_BUNDLE_DIR:fixture.directory,PSAI_REPOSITORY:context.repository,PSAI_WORKFLOW:context.workflow,PSAI_TAG:context.tag,PSAI_TAG_OBJECT_SHA:context.tagObjectSha,PSAI_SOURCE_SHA:context.sourceSha,PSAI_AUTOMATION_SHA:context.automationSha,PSAI_RUN_ID:context.runId,PSAI_RUN_ATTEMPT:context.runAttempt}});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/manifestSha256/);
  assert.equal((await policy.verifyBundle(fixture.directory)).manifest.runId,'123');
}));
