import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// @ts-expect-error Release control scripts intentionally use dependency-free JavaScript.
const githubModule = await import('../scripts/release/github.mjs').catch(() => ({}));
// @ts-expect-error Release control scripts intentionally use dependency-free JavaScript.
const resolver = await import('../scripts/release/resolve.mjs').catch(() => ({}));
// @ts-expect-error Release control scripts intentionally use dependency-free JavaScript.
const publisher = await import('../scripts/release/publish.mjs').catch(() => ({}));
const sourceSha='1'.repeat(40), controlSha='2'.repeat(40), mainSha='3'.repeat(40), tagSha='4'.repeat(40);
const context={repository:'ImMappyJ/ps-ai',workflow:'.github/workflows/release.yml',tag:'v0.4.0',tagObjectSha:sourceSha,sourceSha,automationSha:controlSha,runId:'123',runAttempt:'1'};
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
async function temporary(run:(directory:string)=>Promise<void>) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-publish-'));
  try {await run(directory);} finally {
    assert.equal(path.resolve(path.dirname(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ps-ai-publish-'));
    await fs.rm(path.resolve(directory),{recursive:true,force:true});
  }
}
function response(status:number,data:unknown,headers:Record<string,string>={}) {
  const body=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data));
  return {code:status<400?0:1,stdout:Buffer.concat([Buffer.from(`HTTP/2.0 ${status} status\r\n${Object.entries(headers).map(([name,value])=>`${name}: ${value}\r\n`).join('')}\r\n`),body]),stderr:Buffer.from('sensitive diagnostic must remain captured')};
}

test('GitHub adapter requires HTTP evidence and distinguishes missing, denied, rate, server and transport failures',async()=>{
  // Treating generic gh exit 1 as absence could create a release after an auth failure.
  assert.equal(typeof githubModule.createGitHub,'function');
  for(const [status,headers,kind] of [[404,{},'not-found'],[403,{},'permission'],[403,{'x-ratelimit-remaining':'0'},'rate-limit'],[429,{'retry-after':'20'},'rate-limit'],[500,{},'server']] as const) {
    const github=githubModule.createGitHub({repository:context.repository,run:async()=>response(status,{message:'secret upstream text'},headers)});
    await assert.rejects(github.request('GET','/releases',{stage:'release lookup'}),(error:any)=>error.kind===kind&&error.status===status&&!error.message.includes('secret'));
  }
  for(const raw of [{code:1,stdout:Buffer.alloc(0),stderr:Buffer.from('token secret')},{code:0,stdout:Buffer.from('not HTTP'),stderr:Buffer.alloc(0)}]) {
    const github=githubModule.createGitHub({repository:context.repository,run:async()=>raw});
    await assert.rejects(github.request('GET','/releases',{stage:'release lookup'}),(error:any)=>error.kind==='transport'&&!error.message.includes('token'));
  }
  const absent=githubModule.createGitHub({repository:context.repository,run:async()=>response(404,{message:'Not Found'})});
  assert.equal(await absent.request('GET','/releases/latest',{stage:'latest lookup',allow404:true}),null);
});

test('GitHub adapter explicitly GETs and paginates every page, aborting failed or malformed pages',async()=>{
  // Default POST or a partial release list can miss an existing draft.
  assert.equal(typeof githubModule.createGitHub,'function');
  const calls:string[][]=[];
  const github=githubModule.createGitHub({repository:context.repository,run:async(args:string[])=>{
    calls.push(args);
    return response(200,args.some(arg=>arg.endsWith('page=1'))?Array.from({length:100},(_,id)=>({id:id+1})): [{id:101}]);
  }});
  assert.equal((await github.paginate('/releases',{stage:'release listing'})).length,101);
  assert.equal(calls.length,2);assert.ok(calls.every(args=>args.includes('--method')&&args[args.indexOf('--method')+1]==='GET'));
  assert.ok(calls[1].includes('repos/ImMappyJ/ps-ai/releases?per_page=100&page=2'));
  for(const bad of [response(403,{message:'denied'}),response(200,{not:'array'})]) {
    let page=0;
    const broken=githubModule.createGitHub({repository:context.repository,run:async()=>++page===1?response(200,Array.from({length:100},(_,id)=>({id:id+1}))):bad});
    await assert.rejects(broken.paginate('/releases',{stage:'release listing'}),/release listing/);
  }
});

test('GitHub adapter confines endpoints and sends notes and paths as individual gh arguments',async()=>temporary(async(directory)=>{
  // Shell interpolation or accepting asset-provided URLs would escape the intended repository.
  assert.equal(typeof githubModule.createGitHub,'function');
  const calls:string[][]=[];
  const github=githubModule.createGitHub({repository:context.repository,run:async(args:string[])=>{calls.push(args);return {code:0,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};}});
  for(const route of ['https://evil.test/file','//evil.test','/../secrets','/releases\nother']) await assert.rejects(github.request('GET',route,{stage:'asset lookup'}),/endpoint/);
  const notes=path.join(directory,'notes with spaces.md'),asset=path.join(directory,'package with spaces.ccx');
  await fs.writeFile(notes,'notes');await fs.writeFile(asset,'bytes');
  await github.createDraft({tag:'v0.4.0',title:'PS-AI 0.4.0',notesFile:notes,prerelease:true});
  await github.upload('v0.4.0',asset);
  assert.ok(calls[0].includes('--verify-tag'));assert.ok(calls[0].includes('--draft'));assert.ok(calls[0].includes('--latest=false'));
  assert.equal(calls[0][calls[0].indexOf('--notes-file')+1],notes);assert.ok(calls[1].includes(asset));assert.equal(calls.flat().includes('--clobber'),false);
}));

function resolvingGithub(options:{annotated?:boolean;missing?:boolean;compare?:string;defaultBranch?:string;drift?:boolean}={}) {
  const defaultBranch=options.defaultBranch??'main';
  return {repository:context.repository,request:async(_method:string,route:string)=>{
    if(route==='')return {data:{id:42,full_name:context.repository,default_branch:defaultBranch}};
    if(route===`/git/ref/tags/v0.4.0`)return options.missing?null:{data:{ref:'refs/tags/v0.4.0',object:{type:options.annotated?'tag':'commit',sha:options.annotated?tagSha:(options.drift?mainSha:sourceSha)}}};
    if(route===`/git/tags/${tagSha}`)return {data:{sha:tagSha,tag:'v0.4.0',object:{type:'tag',sha:'5'.repeat(40)}}};
    if(route===`/git/tags/${'5'.repeat(40)}`)return {data:{sha:'5'.repeat(40),tag:'inner',object:{type:'commit',sha:sourceSha}}};
    if(route.startsWith('/git/commits/'))return {data:{sha:route.split('/').pop()}};
    if(route===`/git/ref/heads/${encodeURIComponent(defaultBranch)}`||route==='/git/ref/heads/main')return {data:{ref:decodeURIComponent(route.replace('/git/ref/','refs/')),object:{type:'commit',sha:mainSha}}};
    if(route.startsWith('/compare/'))return {data:{status:options.compare??'ahead',merge_base_commit:{sha:route.slice('/compare/'.length).split('...')[0]}}};
    throw new Error('Unexpected fixture route '+route);
  }};
}
const dispatch={repository:context.repository,tag:'v0.4.0',eventName:'workflow_dispatch',eventRef:'refs/heads/main',workflowRef:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/heads/main',workflowSha:controlSha,automationSha:controlSha};

test('resolver peels lightweight and nested annotated remote tags to the exact source commit',async()=>{
  // Building an annotation object or current main would package the wrong source.
  assert.equal(typeof resolver.resolveReleaseContext,'function');
  for(const annotated of [false,true]) {
    const result=await resolver.resolveReleaseContext({...dispatch,github:resolvingGithub({annotated})});
    assert.equal(result.sourceSha,sourceSha);assert.equal(result.tagObjectSha,annotated?tagSha:sourceSha);assert.equal(result.automationSha,controlSha);
  }
});

test('resolver ancestry queries pass through the confined gh adapter',async()=>{
  // The compare endpoint needs its literal triple-dot separator without allowing parent paths.
  const fixture=resolvingGithub();
  const github=githubModule.createGitHub({repository:context.repository,run:async(args:string[])=>{
    const route=args[1].slice('repos/ImMappyJ/ps-ai'.length);
    const result=await fixture.request('GET',route);assert.ok(result);return response(200,result.data);
  }});
  assert.equal((await resolver.resolveReleaseContext({...dispatch,github})).sourceSha,sourceSha);
});

test('tag pushes bind trusted control to the immutable event workflow commit',async()=>{
  // A build-output-selected control SHA must not choose publisher code.
  const push={...dispatch,eventName:'push',eventRef:'refs/tags/v0.4.0',workflowRef:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/tags/v0.4.0',workflowSha:sourceSha,automationSha:sourceSha};
  assert.equal((await resolver.resolveReleaseContext({...push,github:resolvingGithub()})).automationSha,sourceSha);
  await assert.rejects(resolver.resolveReleaseContext({...push,automationSha:controlSha,github:resolvingGithub()}),/workflow.*commit|automation.*workflow/i);
  await assert.rejects(resolver.resolveReleaseContext({...push,automationSha:controlSha,workflowSha:controlSha,github:resolvingGithub()}),/push.*source|tag.*workflow|workflow.*tag/i);
});

test('manual default branches with slashes remain valid through the confined API adapter',async()=>{
  const fixture=resolvingGithub({defaultBranch:'release/main'});
  const github=githubModule.createGitHub({repository:context.repository,run:async(args:string[])=>{
    const result=await fixture.request('GET',args[1].slice('repos/ImMappyJ/ps-ai'.length));assert.ok(result);return response(200,result.data);
  }});
  const result=await resolver.resolveReleaseContext({...dispatch,eventRef:'refs/heads/release/main',workflowRef:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/heads/release/main',github});
  assert.equal(result.defaultBranch,'release/main');
});

test('resolver rejects missing tags, wrong manual definition refs and commits outside main',async()=>{
  // workflow_dispatch ref describes the definition, never the supplied source tag.
  assert.equal(typeof resolver.resolveReleaseContext,'function');
  await assert.rejects(resolver.resolveReleaseContext({...dispatch,github:resolvingGithub({missing:true})}),/tag.*exist|tag.*missing/i);
  for(const change of [{eventRef:'refs/tags/v0.4.0'},{workflowRef:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/heads/other'},{workflowSha:mainSha}]) {
    await assert.rejects(resolver.resolveReleaseContext({...dispatch,...change,github:resolvingGithub()}),/manual|workflow|default/i);
  }
  await assert.rejects(resolver.resolveReleaseContext({...dispatch,github:resolvingGithub({compare:'diverged'})}),/ancestry|ancestor|main/i);
  const onOtherDefault={...dispatch,eventRef:'refs/heads/trunk',workflowRef:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/heads/trunk'};
  assert.equal((await resolver.resolveReleaseContext({...onOtherDefault,github:resolvingGithub({defaultBranch:'trunk'})})).defaultBranch,'trunk');
});

test('tag recheck rejects both changed tag objects and changed peeled commits',async()=>{
  // Replacing an annotated tag with another object must fail even at the same commit.
  assert.equal(typeof resolver.recheckTag,'function');
  await assert.rejects(resolver.recheckTag({github:resolvingGithub({annotated:true}),...context}),/tag.*changed|tag.*drift/i);
  await assert.rejects(resolver.recheckTag({github:resolvingGithub({drift:true}),...context}),/tag.*changed|tag.*drift/i);
});

test('checkout proof requires the resolved clean git root and validates target versions before build',async()=>temporary(async(directory)=>{
  // Merely printing the requested SHA would not prove what npm is about to build.
  assert.equal(typeof resolver.verifySourceCheckout,'function');
  const git=(args:string[])=>{const result=spawnSync('git',args,{cwd:directory,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git(['init','--quiet']);await fs.mkdir(path.join(directory,'plugin'));await fs.mkdir(path.join(directory,'config'));
  await fs.writeFile(path.join(directory,'package.json'),JSON.stringify({version:'0.4.0'}));
  await fs.writeFile(path.join(directory,'package-lock.json'),JSON.stringify({version:'0.4.0',packages:{'':{version:'0.4.0'}}}));
  await fs.writeFile(path.join(directory,'plugin/manifest.json'),JSON.stringify({id:'local.ps-ai',version:'0.4.0',host:{app:'PS',minVersion:'27.0.0'}}));
  git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Fixture']);
  const sha=git(['rev-parse','HEAD']);
  const result=await resolver.verifySourceCheckout({directory,sourceSha:sha,tag:'v0.4.0'});
  assert.equal(result.sourceSha,sha);assert.equal(result.channel,'prerelease');assert.equal(result.hostMinimum,'27.0.0');
  await assert.rejects(resolver.verifySourceCheckout({directory,sourceSha,tag:'v0.4.0'}),/HEAD|checkout/);
  await assert.rejects(resolver.verifySourceCheckout({directory,sourceSha:sha,tag:'v0.5.0'}),/package.json:version/);
  await fs.writeFile(path.join(directory,'package.json'),'modified');
  await assert.rejects(resolver.verifySourceCheckout({directory,sourceSha:sha,tag:'v0.4.0'}),/clean|modified/i);
}));

async function bundle(directory:string,overrides:Record<string,unknown>={}) {
  const manifest:any={...context,schemaVersion:1,version:'0.4.0',channel:'prerelease',hostMinimum:'27.0.0',notes:'中文 / English\nPhotoshop 27.0.0; offline checks only.\nhttps://github.com/ImMappyJ/ps-ai/commits/'+sourceSha,...overrides,files:[]};
  const names=[`ps-ai-${manifest.version}-experimental.ccx`,`ps-ai-${manifest.version}-portable-experimental.zip`,`ps-ai-${manifest.version}-environment-experimental.zip`];
  await fs.mkdir(directory,{recursive:true});
  for(const [index,name] of names.entries()){
    const bytes=Buffer.from(`inert archive fixture ${index} ${String(overrides.bytes??'')}`),checksum=Buffer.from(`${hash(bytes)}  ${name}\n`);
    for(const [file,data] of [[name,bytes],[name+'.sha256',checksum]] as const){await fs.writeFile(path.join(directory,file),data);manifest.files.push({name:file,size:data.length,sha256:hash(data)});}
  }
  delete manifest.bytes;
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await fs.writeFile(path.join(directory,'release-manifest.json'),manifestBytes);
  const expectedContext=Object.fromEntries(Object.keys(context).map(key=>[key,manifest[key]]));
  return {directory,manifest,expectedContext,expectedManifestSha256:hash(manifestBytes)};
}
function remote() {
  const state:any={releases:[],assets:new Map(),nextRelease:1,nextAsset:101,latestId:null,events:[],uploads:0,failUpload:0,missingDigest:false,tagObject:sourceSha,tagCommit:sourceSha,driftAfterUploads:false,notesBody:'## What changed\n* Actual merged change by @contributor',errorRoute:null};
  const visibleAsset=(asset:any)=>({id:asset.id,name:asset.name,size:asset.bytes.length,state:asset.state??'uploaded',digest:asset.digest===undefined?(state.missingDigest?null:'sha256:'+hash(asset.bytes)):asset.digest,url:`https://api.github.com/repos/ImMappyJ/ps-ai/releases/assets/${asset.id}`,browser_download_url:`https://github.com/ImMappyJ/ps-ai/releases/download/v0.4.0/${asset.name}`,content_type:'application/octet-stream'});
  const allAssets=(id:number)=>[...state.assets.values()].filter((asset:any)=>asset.releaseId===id);
  function seedRelease(fields:Record<string,unknown>={}){const release={id:state.nextRelease++,tag_name:'v0.4.0',name:'PS-AI 0.4.0',draft:true,prerelease:true,body:'manual draft',target_commitish:sourceSha,...fields};state.releases.push(release);return release;}
  function addAsset(release:any,name:string,bytes:Buffer,extra:Record<string,unknown>={}){const asset={id:state.nextAsset++,releaseId:release.id,name,bytes,...extra};state.assets.set(asset.id,asset);return asset;}
  const run=async(args:string[],options:any={})=>{
    if(args[0]==='api'){
      assert.equal(args[args.indexOf('--method')+1],options.input===undefined?'GET':'POST');
      const url=new URL('https://fixture.invalid/'+args[1]),route=url.pathname.slice('/repos/ImMappyJ/ps-ai'.length);
      if(state.errorRoute===route)return response(state.errorStatus??403,{message:'private raw error'});
      if(route==='')return response(200,{id:42,full_name:context.repository,default_branch:'main'});
      if(route==='/git/ref/tags/v0.4.0')return response(200,{ref:'refs/tags/v0.4.0',object:{type:state.tagObject===state.tagCommit?'commit':'tag',sha:state.tagObject}});
      if(route===`/git/tags/${state.tagObject}`)return response(200,{sha:state.tagObject,object:{type:'commit',sha:state.tagCommit}});
      if(route.startsWith('/git/commits/'))return response(200,{sha:route.split('/').pop()});
      if(route==='/git/ref/heads/main')return response(200,{ref:'refs/heads/main',object:{type:'commit',sha:mainSha}});
      if(route.startsWith('/compare/'))return response(200,{status:'ahead',merge_base_commit:{sha:route.slice('/compare/'.length).split('...')[0]}});
      if(route==='/releases/generate-notes'){state.events.push({kind:'generate-notes',body:JSON.parse(options.input)});if(state.driftAfterNotes)state.tagObject=mainSha;return response(200,{name:'v0.4.0',body:state.notesBody});}
      if(route==='/releases/latest')return state.latestId===null?response(404,{message:'Not Found'}):response(200,state.releases.find((release:any)=>release.id===state.latestId));
      if(route==='/releases'){const page=Number(url.searchParams.get('page'));return response(200,state.releases.slice((page-1)*100,page*100));}
      const assetList=/^\/releases\/([1-9][0-9]*)\/assets$/.exec(route);
      if(assetList){const page=Number(url.searchParams.get('page'));return response(200,allAssets(Number(assetList[1])).slice((page-1)*100,page*100).map(visibleAsset));}
      const assetGet=/^\/releases\/assets\/([1-9][0-9]*)$/.exec(route);
      if(assetGet){state.events.push({kind:'download',id:Number(assetGet[1])});const asset=state.assets.get(Number(assetGet[1]));return asset?response(200,asset.bytes):response(404,{message:'Not Found'});}
      throw new Error('Unexpected fixture API route '+route);
    }
    assert.equal(args[0],'release');assert.equal(args[args.indexOf('--repo')+1],context.repository);
    const [operation,tag]=args.slice(1);
    if(operation==='create'){
      assert.ok(args.includes('--verify-tag'));assert.ok(args.includes('--draft'));assert.ok(args.includes('--latest=false'));
      state.events.push({kind:'create'});seedRelease({tag_name:tag,body:await fs.readFile(args[args.indexOf('--notes-file')+1],'utf8'),prerelease:args.includes('--prerelease=true')});
    }else if(operation==='upload'){
      const release=state.releases.find((item:any)=>item.tag_name===tag);assert.equal(release.draft,true);assert.equal(args.includes('--clobber'),false);
      state.uploads++;if(state.failUpload===state.uploads)return {code:1,stdout:Buffer.alloc(0),stderr:Buffer.from('upstream error')};
      const name=path.basename(args[3]);assert.equal(allAssets(release.id).some((asset:any)=>asset.name===name),false);
      state.events.push({kind:'upload',name});addAsset(release,name,await fs.readFile(args[3]));
      if(state.driftAfterUploads&&state.uploads===7)state.tagObject=mainSha;
    }else if(operation==='edit'){
      const release=state.releases.find((item:any)=>item.tag_name===tag);assert.equal(release.draft,true);
      if(args.includes('--draft=true')){
        assert.ok(args.includes('--latest=false'));release.body=await fs.readFile(args[args.indexOf('--notes-file')+1],'utf8');release.prerelease=args.includes('--prerelease=true');release.name=state.corruptPreparedName?'unexpected title':args[args.indexOf('--title')+1];state.events.push({kind:'prepare'});
      }else{
        assert.ok(args.includes('--draft=false'));release.draft=false;release.prerelease=args.includes('--prerelease=true');if(args.includes('--latest=true'))state.latestId=release.id;state.events.push({kind:'publish',latest:args.includes('--latest=true')});
      }
    }else throw new Error('Unexpected fixture release operation '+operation);
    return {code:0,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
  };
  assert.equal(typeof githubModule.createGitHub,'function');
  return {state,github:githubModule.createGitHub({repository:context.repository,run}),seedRelease,addAsset,allAssets};
}
async function publish(input:any,fixture:ReturnType<typeof remote>,extra:Record<string,unknown>={}) {
  assert.equal(typeof publisher.publishRelease,'function');
  return publisher.publishRelease({...input,github:fixture.github,dryRun:false,...extra});
}

test('dry run verifies local and remote identities without creating notes, drafts, uploads or Latest writes',async()=>temporary(async(directory)=>{
  // Generate-notes also requires write permission and must stay out of dry run.
  const fixture=remote(),input=await bundle(directory);
  const result=await publish(input,fixture,{dryRun:true});
  assert.equal(result.status,'dry-run');assert.deepEqual(fixture.state.events,[]);assert.equal(fixture.state.releases.length,0);
}));

test('publisher creates a controlled complete draft and prepares notes/channel before final publication',async()=>temporary(async(directory)=>{
  // Publishing before exact asset verification exposes a half-finished release.
  const fixture=remote(),input=await bundle(directory),result=await publish(input,fixture);
  assert.equal(result.status,'published');assert.equal(fixture.state.releases[0].draft,false);assert.equal(fixture.state.releases[0].prerelease,true);assert.equal(fixture.state.latestId,null);
  assert.equal(fixture.allAssets(1).length,7);
  assert.deepEqual(fixture.state.events.filter((event:any)=>event.kind!=='download').map((event:any)=>event.kind),['generate-notes','create','upload','upload','upload','upload','upload','upload','upload','prepare','publish']);
  assert.match(fixture.state.releases[0].body,/Actual merged change/);assert.match(fixture.state.releases[0].body,/ps-ai-release:v1/);
  assert.equal(fixture.state.events.find((event:any)=>event.kind==='generate-notes').body.target_commitish,sourceSha);
}));

test('interrupted owned draft resumes only missing files from the original build attempt',async()=>temporary(async(directory)=>{
  // Reuploading or taking the publisher rerun attempt as a new build would break recovery.
  const fixture=remote(),input=await bundle(directory);fixture.state.failUpload=3;
  await assert.rejects(publish(input,fixture),/asset upload/);assert.equal(fixture.allAssets(1).length,2);assert.equal(fixture.state.releases[0].draft,true);
  fixture.state.failUpload=0;const before=fixture.state.events.length;
  const result=await publish(input,fixture);
  assert.equal(result.status,'published');assert.equal(fixture.state.releases.length,1);assert.equal(fixture.allAssets(1).length,7);
  assert.equal(fixture.state.events.slice(before).filter((event:any)=>event.kind==='upload').length,5);assert.equal(fixture.state.events.filter((event:any)=>event.kind==='generate-notes').length,1);
}));

test('publisher refuses manual drafts, ambiguous same-tag records and rebuilt batch bytes',async()=>temporary(async(directory)=>{
  // Matching tag/source alone must never permit taking over another draft or build.
  const input=await bundle(path.join(directory,'first'));
  const unknown=remote();unknown.seedRelease();await assert.rejects(publish(input,unknown),/ownership|controlled draft/i);assert.deepEqual(unknown.state.events,[]);
  const duplicate=remote();duplicate.seedRelease();duplicate.seedRelease();await assert.rejects(publish(input,duplicate),/ambiguous|multiple/i);assert.deepEqual(duplicate.state.events,[]);
  const fixture=remote();fixture.state.failUpload=2;await assert.rejects(publish(input,fixture),/asset upload/);
  const rebuilt=await bundle(path.join(directory,'rebuilt'),{runAttempt:'2',bytes:'rebuilt'}),before=fixture.state.events.length;
  await assert.rejects(publish(rebuilt,fixture),/original.*artifact|batch|build attempt/i);assert.equal(fixture.state.events.length,before);assert.equal(fixture.state.releases[0].draft,true);
}));

test('publisher verifies a previously published original batch without writing when a later rebuild differs',async()=>temporary(async(directory)=>{
  // Published retries may prove the original batch but must never replace it with rebuilt bytes.
  const fixture=remote(),input=await bundle(path.join(directory,'first'));await publish(input,fixture);
  const rebuilt=await bundle(path.join(directory,'rebuilt'),{runId:'456',runAttempt:'2',bytes:'different ZIP timestamps'}),before=fixture.state.events.length;
  const result=await publish(rebuilt,fixture);
  assert.equal(result.status,'already-complete');assert.equal(fixture.state.releases.length,1);
  assert.ok(fixture.state.events.slice(before).every((event:any)=>event.kind==='download'));
  fixture.state.releases[0].body='user-authored published release';
  await assert.rejects(publish(rebuilt,fixture),/ownership|new version/i);
}));

test('publisher rejects missing, extra, unuploaded, wrong-size and bad-digest assets before publication',async()=>temporary(async(directory)=>{
  // An upload exit code alone does not establish remotely recoverable content.
  for(const mutation of ['extra','starter','size','digest','missing'] as const){
    const fixture=remote(),input=await bundle(path.join(directory,mutation));fixture.state.failUpload=7;await assert.rejects(publish(input,fixture),/asset upload/);fixture.state.failUpload=0;
    const asset=fixture.allAssets(1)[0];
    if(mutation==='extra')fixture.addAsset(fixture.state.releases[0],'unknown.txt',Buffer.from('extra'));
    if(mutation==='starter')asset.state='starter';
    if(mutation==='size')asset.bytes=Buffer.from('wrong size');
    if(mutation==='digest')asset.digest='sha256:'+'f'.repeat(64);
    if(mutation==='missing'){
      // A published record must be complete; missing draft assets remain recoverable.
      fixture.state.releases[0].draft=false;
    }
    await assert.rejects(publish(input,fixture),/asset|digest|size|complete/i);assert.equal(fixture.state.events.some((event:any)=>event.kind==='publish'),false);
  }
}));

test('remote verification downloads the exact asset IDs when digests are unavailable',async()=>temporary(async(directory)=>{
  // Missing digest is not proof of matching bytes, and asset-provided URLs are not fetched.
  const fixture=remote(),input=await bundle(directory);fixture.state.missingDigest=true;
  await publish(input,fixture);assert.ok(fixture.state.events.filter((event:any)=>event.kind==='download').length>=7);
  const asset=fixture.allAssets(1)[0];asset.bytes=Buffer.from('tampered archive with different contents');
  await assert.rejects(publish(input,fixture),/asset|size|hash/i);
}));

test('publication rechecks the exact remote tag immediately before the final write',async()=>temporary(async(directory)=>{
  // A tag moved while uploads run must leave the fully prepared release unpublished.
  const fixture=remote(),input=await bundle(directory);fixture.state.driftAfterUploads=true;
  await assert.rejects(publish(input,fixture),/tag.*changed|tag.*drift/i);assert.equal(fixture.state.releases[0].draft,true);assert.equal(fixture.state.events.some((event:any)=>event.kind==='publish'),false);
}));

test('stable Latest selection compares every stable version and cannot move a newer Latest backward',async()=>temporary(async(directory)=>{
  // Comparing creation dates or lexical version text could regress Latest.
  for(const [existingTag,expectedLatest] of [['v0.3.9',true],['v0.10.0',false]] as const){
    const fixture=remote(),prior=fixture.seedRelease({tag_name:existingTag,draft:false,prerelease:false,body:'historical stable'});fixture.state.latestId=prior.id;
    const input=await bundle(path.join(directory,existingTag),{channel:'stable'}),result=await publish(input,fixture);
    const created=fixture.state.releases.find((release:any)=>release.tag_name==='v0.4.0');
    assert.equal(created.prerelease,false);assert.equal(result.latest,expectedLatest);assert.equal(fixture.state.latestId,expectedLatest?created.id:prior.id);
    if(expectedLatest)assert.match(created.body,/\/compare\/v0\.3\.9\.\.\.v0\.4\.0/);
    else assert.ok(created.body.includes(`/commits/${sourceSha}`));
  }
}));

test('a malformed current Latest and failed API reads stop stable publication without guessing absence',async()=>temporary(async(directory)=>{
  // Latest identity and permissions must be established before the first draft write.
  const input=await bundle(directory,{channel:'stable'}),fixture=remote();const prior=fixture.seedRelease({tag_name:'legacy',draft:false,prerelease:false});fixture.state.latestId=prior.id;
  await assert.rejects(publish(input,fixture),/Latest|stable.*tag/i);assert.equal(fixture.state.events.some((event:any)=>event.kind==='create'),false);
  for(const status of [403,429,503]){const failed=remote();failed.state.errorRoute='/releases';failed.state.errorStatus=status;await assert.rejects(publish(input,failed),/HTTP (403|429|503)/);assert.equal(failed.state.releases.length,0);}
}));

test('publisher requires all trusted context fields and detects local byte changes before network writes',async()=>temporary(async(directory)=>{
  // Optional expected fields would let downloaded metadata choose its own provenance.
  const input=await bundle(directory),fixture=remote();
  for(const field of Object.keys(context)){
    const expectedContext={...input.expectedContext};delete expectedContext[field];
    await assert.rejects(publish({...input,expectedContext},fixture),/trusted context/);
  }
  await fs.writeFile(path.join(directory,'ps-ai-0.4.0-experimental.ccx'),'changed');
  await assert.rejects(publish(input,fixture),/checksum|hash/);assert.equal(fixture.state.events.length,0);
}));

test('tag drift while generating notes prevents even the first draft creation',async()=>temporary(async(directory)=>{
  const fixture=remote(),input=await bundle(directory);fixture.state.driftAfterNotes=true;
  await assert.rejects(publish(input,fixture),/tag.*changed|tag.*drift/i);
  assert.equal(fixture.state.releases.length,0);assert.deepEqual(fixture.state.events.map((event:any)=>event.kind),['generate-notes']);
}));

test('prepared draft title is confirmed before making the release public',async()=>temporary(async(directory)=>{
  // A metadata-write failure must not silently publish an unexpected title.
  const fixture=remote(),input=await bundle(directory);fixture.state.corruptPreparedName=true;
  await assert.rejects(publish(input,fixture),/draft preparation|title|metadata/i);assert.equal(fixture.state.releases[0].draft,true);
}));

test('draft discovery paginates authenticated releases and rejects changed frozen notes',async()=>temporary(async(directory)=>{
  // A page-one-only lookup can recreate a draft, while regenerated notes lose original batch state.
  const fixture=remote(),input=await bundle(directory);fixture.state.failUpload=1;await assert.rejects(publish(input,fixture),/asset upload/);
  const owned=fixture.state.releases[0];
  for(let index=0;index<100;index++)fixture.seedRelease({tag_name:`old-${index}`,draft:false,prerelease:true,body:'Historical'});
  fixture.state.releases.reverse();fixture.state.failUpload=0;
  assert.equal((await publish(input,fixture)).status,'published');assert.equal(fixture.state.events.filter((event:any)=>event.kind==='create').length,1);
  owned.body+='changed';const before=fixture.state.events.length;await assert.rejects(publish(input,fixture),/notes changed/);
  assert.equal(fixture.state.events.length,before);
}));

test('stable publication considers higher stable releases even when current Latest is older',async()=>temporary(async(directory)=>{
  const fixture=remote(),input=await bundle(directory,{channel:'stable'}),latest=fixture.seedRelease({tag_name:'v0.3.0',draft:false,prerelease:false});fixture.state.latestId=latest.id;
  fixture.seedRelease({tag_name:'v0.10.0',draft:false,prerelease:false});
  const result=await publish(input,fixture);assert.equal(result.latest,false);assert.equal(fixture.state.latestId,latest.id);
}));

test('control modules import and publisher validation executes without npm dependencies',async()=>temporary(async(directory)=>{
  // Accidentally importing build-only code would require npm ci in the write job.
  for(const name of ['github.mjs','resolve.mjs','publish.mjs','policy.mjs'])await fs.copyFile(path.join(process.cwd(),'scripts/release',name),path.join(directory,name));
  const script="const p=await import('./publish.mjs'); try {await p.publishRelease({expectedContext:{}})} catch(e){console.log(e.message)}";
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:directory,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/trusted context: missing repository/);
}));
