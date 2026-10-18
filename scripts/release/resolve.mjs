import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createGitHub,assertRepository,assertSha} from './github.mjs';
import {parseTag,validateProjectVersions,readReleaseConfig} from './policy.mjs';

export const WORKFLOW='.github/workflows/release.yml';
function fail(stage,detail){throw new Error(`${stage}: ${detail}`);}
function branchName(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value)||value.includes('..')||value.includes('//')||value.endsWith('/'))fail('default branch','unsafe branch name');
  return value;
}
async function repositoryInfo(github,repository) {
  assertRepository(repository);
  if(github.repository!==repository)fail('repository lookup','adapter repository mismatch');
  const {data}=await github.request('GET','',{stage:'repository lookup'});
  if(!data||typeof data.full_name!=='string'||data.full_name.toLowerCase()!==repository.toLowerCase())fail('repository lookup','unexpected repository response');
  return {defaultBranch:branchName(data.default_branch)};
}
async function branchHead(github,name) {
  const {data}=await github.request('GET',`/git/ref/heads/${encodeURIComponent(name)}`,{stage:'branch lookup'});
  if(data?.ref!==`refs/heads/${name}`||data?.object?.type!=='commit')fail('branch lookup','expected exact commit reference');
  return assertSha(data.object.sha,'branch commit');
}
async function ancestor(github,base,head,label) {
  if(base===head)return;
  const {data}=await github.request('GET',`/compare/${base}...${head}`,{stage:'ancestry check'});
  if(!['ahead','identical'].includes(data?.status)||data?.merge_base_commit?.sha!==base)fail('ancestry check',`${label} must be an ancestor of the allowed branch`);
}
async function peelTag(github,tag) {
  const response=await github.request('GET',`/git/ref/tags/${encodeURIComponent(tag)}`,{stage:'tag lookup',allow404:true});
  if(!response)fail('tag lookup','requested remote tag does not exist');
  const reference=response.data;
  if(reference?.ref!==`refs/tags/${tag}`)fail('tag lookup','unexpected remote reference');
  let object=reference.object;
  const tagObjectSha=assertSha(object?.sha,'tag object SHA'),seen=new Set();
  while(object?.type==='tag'){
    const sha=assertSha(object.sha,'annotated tag SHA');
    if(seen.has(sha)||seen.size>=8)fail('tag lookup','cyclic or excessive annotated tag chain');
    seen.add(sha);
    const {data}=await github.request('GET',`/git/tags/${sha}`,{stage:'annotated tag lookup'});
    if(data?.sha!==sha)fail('annotated tag lookup','object identity mismatch');
    object=data.object;
  }
  if(object?.type!=='commit')fail('tag lookup','tag must resolve to a commit');
  const sourceSha=assertSha(object.sha,'source commit SHA');
  const {data}=await github.request('GET',`/git/commits/${sourceSha}`,{stage:'source commit lookup'});
  if(data?.sha!==sourceSha)fail('source commit lookup','unexpected commit identity');
  return {tagObjectSha,sourceSha};
}
export async function resolveRemoteTag({github,repository,tag}) {
  parseTag(tag);
  const info=await repositoryInfo(github,repository),resolved=await peelTag(github,tag);
  const main=await branchHead(github,'main');
  await ancestor(github,resolved.sourceSha,main,'release source/main');
  return {...info,...resolved,mainSha:main};
}
export async function resolveReleaseContext({github,repository,tag,eventName,eventRef,workflowRef,workflowSha,automationSha}) {
  parseTag(tag);assertSha(workflowSha,'workflow SHA');assertSha(automationSha,'automation SHA');
  const remote=await resolveRemoteTag({github,repository,tag});
  if(automationSha!==workflowSha)fail('automation/workflow commit','control checkout must equal the immutable event workflow commit');
  if(eventName==='workflow_dispatch'){
    const expectedRef=`refs/heads/${remote.defaultBranch}`;
    if(eventRef!==expectedRef||workflowRef!==`${repository}/${WORKFLOW}@${expectedRef}`||workflowSha!==automationSha)fail('manual workflow','definition must be the exact captured workflow commit on the actual default branch');
  }else if(eventName==='push'){
    if(eventRef!==`refs/tags/${tag}`||workflowRef!==`${repository}/${WORKFLOW}@refs/tags/${tag}`||workflowSha!==remote.sourceSha)fail('push workflow/tag source','expected the requested tag event and its exact workflow/source commit');
  }else fail('workflow event','only tag push and workflow_dispatch are supported');
  const controlHead=remote.defaultBranch==='main'?remote.mainSha:await branchHead(github,remote.defaultBranch);
  await ancestor(github,automationSha,controlHead,'trusted automation/default branch');
  return {repository,workflow:WORKFLOW,tag,tagObjectSha:remote.tagObjectSha,sourceSha:remote.sourceSha,automationSha,defaultBranch:remote.defaultBranch,version:parseTag(tag)};
}
export async function recheckTag({github,repository,tag,tagObjectSha,sourceSha}) {
  assertSha(tagObjectSha,'expected tag object SHA');assertSha(sourceSha,'expected source SHA');
  const remote=await resolveRemoteTag({github,repository,tag});
  if(remote.tagObjectSha!==tagObjectSha||remote.sourceSha!==sourceSha)fail('tag recheck','remote tag object or source commit changed; preserve the current draft and use a new version if already public');
  return remote;
}
const execFileAsync=promisify(execFile);
export async function verifySourceCheckout({directory,sourceSha,tag}) {
  assertSha(sourceSha,'source SHA');parseTag(tag);
  if(typeof directory!=='string'||!directory||/[\0\r\n]/.test(directory))fail('checkout','invalid source directory');
  const root=await fs.realpath(path.resolve(directory));
  async function git(args){
    try{return (await execFileAsync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024,timeout:30000})).stdout.trim();}
    catch{fail('checkout','cannot prove Git checkout state');}
  }
  const actualRoot=await fs.realpath(await git(['rev-parse','--show-toplevel']));
  if(actualRoot!==root)fail('checkout','source directory must be the Git checkout root');
  if(await git(['rev-parse','--verify','HEAD'])!==sourceSha)fail('checkout HEAD','does not match resolved source SHA');
  if(await git(['status','--porcelain','--untracked-files=no']))fail('checkout','tracked source must be clean before build');
  return {sourceSha,...await validateProjectVersions(root,tag,{includeBuild:false}),...await readReleaseConfig(root)};
}
export async function writeOutputs(value) {
  process.stdout.write(JSON.stringify(value)+'\n');
  if(process.env.GITHUB_OUTPUT){
    for(const [name,entry] of Object.entries(value))if(typeof entry!=='object'){
      if(/[\r\n]/.test(String(entry)))fail('workflow output','unexpected multiline value');
      await fs.appendFile(process.env.GITHUB_OUTPUT,`${name}=${entry}\n`);
    }
  }
}
export function requiredEnv(name){const value=process.env[name];if(typeof value!=='string'||!value||/[\0\r\n]/.test(value))fail('environment',`${name} is required and must be a single line`);return value;}
async function main(){
  const mode=process.argv[2]??'resolve';
  if(mode==='checkout')return writeOutputs(await verifySourceCheckout({directory:requiredEnv('PSAI_SOURCE_DIR'),sourceSha:requiredEnv('PSAI_SOURCE_SHA'),tag:requiredEnv('PSAI_TAG')}));
  if(mode!=='resolve')fail('resolve command','expected resolve or checkout');
  const repository=requiredEnv('PSAI_REPOSITORY');
  await writeOutputs(await resolveReleaseContext({github:createGitHub({repository}),repository,tag:requiredEnv('PSAI_TAG'),eventName:requiredEnv('PSAI_EVENT_NAME'),eventRef:requiredEnv('PSAI_EVENT_REF'),workflowRef:requiredEnv('PSAI_WORKFLOW_REF'),workflowSha:requiredEnv('PSAI_WORKFLOW_SHA'),automationSha:requiredEnv('PSAI_AUTOMATION_SHA')}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(`release resolution failed: ${error.message}\n`);process.exitCode=1;});
