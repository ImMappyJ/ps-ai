// Release control code must run without installing project dependencies.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {parseTag} from './policy.mjs';

const responseLimit=16*1024*1024;
export function assertRepository(repository) {
  if(typeof repository!=='string'||repository.length>200||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)) throw new Error('repository: expected owner/repository');
  return repository;
}
export function assertSha(value,field='SHA') {
  if(typeof value!=='string'||!/^[a-f0-9]{40}$/.test(value))throw new Error(`${field}: expected lowercase full SHA`);
  return value;
}
export function assertId(value,field='ID') {
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return String(value);
  if(typeof value==='string'&&/^[1-9][0-9]{0,29}$/.test(value))return value;
  throw new Error(`${field}: expected positive decimal ID`);
}
export class GitHubError extends Error {
  constructor(stage,kind,status) {
    super(`${stage}: GitHub ${kind}${status?` (HTTP ${status})`:''}; no remote action was assumed successful`);
    this.name='GitHubError';this.stage=stage;this.kind=kind;this.status=status;
  }
}

// Capture stderr, never echo CLI/API bodies, tokens, or signed download URLs.
export function runGh(args,{input,maxBytes=responseLimit,timeout=120000}={}) {
  return new Promise((resolve,reject)=>{
    const env={...process.env,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_PAGER:'cat'};
    delete env.GH_DEBUG;
    let child;
    try {child=spawn('gh',args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env});}
    catch {reject(new GitHubError('CLI startup','transport'));return;}
    const chunks=[];let size=0,failed=false;
    const stop=()=>{if(!failed){failed=true;child.kill();reject(new GitHubError('CLI execution','transport'));}};
    const timer=setTimeout(stop,timeout);
    child.on('error',stop);
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>maxBytes)stop();else chunks.push(bytes);});
    child.stderr.on('data',()=>{});
    child.stdin.on('error',()=>{});
    child.on('close',(code)=>{clearTimeout(timer);if(!failed)resolve({code,stdout:Buffer.concat(chunks),stderr:Buffer.alloc(0)});});
    child.stdin.end(input);
  });
}
function parseHttp(raw,stage) {
  const bytes=Buffer.isBuffer(raw.stdout)?raw.stdout:Buffer.from(raw.stdout??'');
  const boundary=bytes.indexOf('\r\n\r\n')>=0?bytes.indexOf('\r\n\r\n'):bytes.indexOf('\n\n');
  if(boundary<0||boundary>65536)throw new GitHubError(stage,'transport');
  const lines=bytes.subarray(0,boundary).toString('utf8').split(/\r?\n/);
  const statusMatch=/^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5][0-9]{2})(?: .*)?$/.exec(lines.shift());
  if(!statusMatch)throw new GitHubError(stage,'transport');
  const status=Number(statusMatch[1]),headers={};
  for(const line of lines){const colon=line.indexOf(':');if(colon<1)throw new GitHubError(stage,'malformed-response',status);headers[line.slice(0,colon).toLowerCase()]=line.slice(colon+1).trim();}
  const width=bytes.subarray(boundary,boundary+4).equals(Buffer.from('\r\n\r\n'))?4:2;
  return {status,headers,bytes:bytes.subarray(boundary+width)};
}
function safeFile(file,field) {
  if(typeof file!=='string'||!path.isAbsolute(file)||/[\0\r\n]/.test(file))throw new Error(`${field}: expected absolute file path`);
  return file;
}
export function createGitHub({repository,run=runGh}) {
  assertRepository(repository);
  async function invoke(args,options,stage) {
    let result;
    try {result=await run(args,options);}catch{throw new GitHubError(stage,'transport');}
    return result;
  }
  async function release(args,stage) {
    const result=await invoke(['release',...args,'--repo',repository],{},stage);
    if(result.code!==0)throw new GitHubError(stage,'cli-failure');
  }
  async function request(method,route,{stage='API request',body,binary=false,allow404=false,maxBytes=responseLimit}={}) {
    if(!['GET','POST'].includes(method))throw new Error('API method: unsupported method');
    if(typeof route!=='string'||(route!==''&&!route.startsWith('/'))||route.startsWith('//')||/[\s\\#]/.test(route)||/(?:^|\/)\.\.(?:\/|$)/.test(route)||/%(?:2e|5c)/i.test(route)||route.includes('://')||!/^[/A-Za-z0-9_.%?=&-]*$/.test(route))throw new Error('API endpoint: unsafe repository-relative endpoint');
    const args=['api',`repos/${repository}${route}`,'--hostname','github.com','--include','--method',method,'-H',`Accept: ${binary?'application/octet-stream':'application/vnd.github+json'}`,'-H','X-GitHub-Api-Version: 2022-11-28'];
    if(body!==undefined){if(method!=='POST')throw new Error('API body: only POST accepts a body');args.push('--input','-');}
    const raw=await invoke(args,{input:body===undefined?undefined:JSON.stringify(body),maxBytes:maxBytes+65536},stage);
    const parsed=parseHttp(raw,stage),{status,headers}=parsed;
    if(status===404&&allow404)return null;
    if(status<200||status>=300){
      const kind=(status===429||(status===403&&(headers['x-ratelimit-remaining']==='0'||headers['retry-after'])))?'rate-limit':status===404?'not-found':[401,403].includes(status)?'permission':status>=500?'server':'http-failure';
      throw new GitHubError(stage,kind,status);
    }
    if(raw.code!==0)throw new GitHubError(stage,'cli-failure',status);
    if(parsed.bytes.length>maxBytes)throw new GitHubError(stage,'response-budget',status);
    let data=parsed.bytes;
    if(!binary){try{data=JSON.parse(data.toString('utf8'));}catch{throw new GitHubError(stage,'malformed-response',status);}}
    return {status,headers,data};
  }
  async function paginate(route,{stage='API listing'}={}) {
    const result=[];
    if(route.includes('?'))throw new Error('API pagination: unexpected query');
    for(let page=1;page<=1000;page++){
      const response=await request('GET',`${route}?per_page=100&page=${page}`,{stage});
      if(!Array.isArray(response.data)||response.data.length>100)throw new GitHubError(stage,'malformed-response',response.status);
      result.push(...response.data);
      if(response.data.length<100)return result;
    }
    throw new GitHubError(stage,'pagination-budget');
  }
  return {repository,request,paginate,
    async createDraft({tag,title,notesFile,prerelease}) {
      parseTag(tag);safeFile(notesFile,'notes file');
      if(typeof title!=='string'||/[\0\r\n]/.test(title)||typeof prerelease!=='boolean')throw new Error('draft metadata: invalid fields');
      await release(['create',tag,'--verify-tag','--draft','--latest=false',`--prerelease=${prerelease}`,'--title',title,'--notes-file',notesFile],'draft creation');
    },
    async upload(tag,file) {parseTag(tag);safeFile(file,'asset file');await release(['upload',tag,file],'asset upload');},
    async prepareDraft({tag,title,notesFile,prerelease}) {
      parseTag(tag);safeFile(notesFile,'notes file');
      if(typeof title!=='string'||/[\0\r\n]/.test(title)||typeof prerelease!=='boolean')throw new Error('draft metadata: invalid fields');
      await release(['edit',tag,'--draft=true','--latest=false',`--prerelease=${prerelease}`,'--title',title,'--notes-file',notesFile],'draft preparation');
    },
    async publishDraft({tag,prerelease,latest}) {
      parseTag(tag);if(typeof prerelease!=='boolean'||typeof latest!=='boolean'||(prerelease&&latest))throw new Error('publication flags: invalid channel/Latest');
      await release(['edit',tag,'--draft=false',`--prerelease=${prerelease}`,`--latest=${latest}`],'draft publication');
    }
  };
}
