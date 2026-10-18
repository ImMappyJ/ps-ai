import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow=await fs.readFile('.github/workflows/release.yml','utf8').catch(()=>'');
const sourceSha='1'.repeat(40),tagObjectSha='2'.repeat(40);
function job(name:string) {
  const match=workflow.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [A-Za-z][\\w-]*:|$(?![\\s\\S]))`,'m'));
  assert.ok(match,`Release workflow must define ${name}`);
  return match[1];
}
function step(block:string,name:string) {
  const chunks=block.split(/\r?\n      - /);
  const match=chunks.find(chunk=>chunk.startsWith(`name: ${name}\n`)||chunk.startsWith(`name: ${name}\r\n`));
  assert.ok(match,`Workflow must include ${name}`);
  return match;
}
function script(block:string,name:string) {
  const value=step(block,name).split(/\r?\n        run: \|\r?\n/)[1];
  assert.ok(value,`${name} must run its guard`);
  return value.split(/\r?\n/).map(line=>line.replace(/^          /,'')).join('\n');
}
function runPowerShell(command:string,env:Record<string,string>) {
  return spawnSync(process.platform==='win32'?'pwsh.exe':'pwsh',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,NO_COLOR:'1',...env}});
}
const manual={PSAI_REPOSITORY:'ImMappyJ/ps-ai',PSAI_WORKFLOW:'.github/workflows/release.yml',PSAI_TAG:'v0.5.0',PSAI_EVENT_NAME:'workflow_dispatch',PSAI_EVENT_REF:'refs/heads/main',PSAI_WORKFLOW_REF:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/heads/main',PSAI_WORKFLOW_SHA:sourceSha,PSAI_DEFAULT_BRANCH:'main'};

test('both pre-checkout guards accept only exact default-branch dispatch and matching tag events',()=>{
  // Moving/removing the gate or accepting a selected topic-branch definition would expose checkout to an untrusted manual request.
  for(const name of ['build','publish']) {
    const block=job(name),guard=script(block,'Guard event identity');
    assert.ok(block.indexOf('name: Guard event identity')<block.indexOf('uses:'),'guard must precede executable Actions');
    const valid=[manual,{...manual,PSAI_EVENT_NAME:'push',PSAI_EVENT_REF:'refs/tags/v0.5.0',PSAI_WORKFLOW_REF:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/tags/v0.5.0'}, {...manual,PSAI_DEFAULT_BRANCH:'release/default',PSAI_EVENT_REF:'refs/heads/release/default',PSAI_WORKFLOW_REF:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/heads/release/default'}];
    for(const env of valid) {const result=runPowerShell(guard,env);assert.equal(result.status,0,result.stderr||result.error?.message);}
    const invalid=[{PSAI_EVENT_REF:'refs/heads/topic'},{PSAI_WORKFLOW_REF:'ImMappyJ/ps-ai/.github/workflows/release.yml@refs/heads/topic'},{PSAI_WORKFLOW_REF:'Other/repo/.github/workflows/release.yml@refs/heads/main'},{PSAI_EVENT_NAME:'pull_request'},{PSAI_TAG:'v01.5.0'},{PSAI_TAG:"v0.5.0'; Write-Output INJECTED"},{PSAI_WORKFLOW_SHA:'main'}];
    for(const override of invalid) {const result=runPowerShell(guard,{...manual,...override});assert.notEqual(result.status,0,JSON.stringify(override));assert.doesNotMatch(result.stdout,/INJECTED/);}
  }
});

test('build batch freezes actual control checkout and original build attempt',async()=>{
  // Replacing the captured attempt with the later publisher execution attempt would break same-artifact draft recovery.
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-workflow-'));
  try {
    const output=path.join(directory,'output'),head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
    assert.equal(head.status,0,head.stderr);
    const command=script(job('build'),'Capture original build batch');
    const env={PSAI_CONTROL_DIR:process.cwd(),PSAI_WORKFLOW_SHA:head.stdout.trim(),PSAI_RUN_ID:'123',PSAI_BUILD_RUN_ATTEMPT:'2',GITHUB_RUN_ATTEMPT:'9',GITHUB_OUTPUT:output};
    const result=runPowerShell(command,env);assert.equal(result.status,0,result.stderr||result.error?.message);
    assert.deepEqual((await fs.readFile(output,'utf8')).trim().split(/\r?\n/),[`automationSha=${head.stdout.trim()}`,'runId=123','runAttempt=2']);
    const rejected=runPowerShell(command,{...env,PSAI_WORKFLOW_SHA:'f'.repeat(40),GITHUB_OUTPUT:path.join(directory,'rejected')});
    assert.notEqual(rejected.status,0);assert.equal(await fs.stat(path.join(directory,'rejected')).then(()=>true,()=>false),false);
  } finally {
    assert.equal(path.resolve(path.dirname(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('ps-ai-workflow-'));
    await fs.rm(path.resolve(directory),{recursive:true,force:true});
  }
});

test('publisher rejects missing or foreign artifact evidence before downloading and accepts the original build attempt',()=>{
  // Empty artifact IDs can broaden selection; a foreign run or invalid hash must fail before the download action.
  const block=job('publish'),command=script(block,'Validate original build evidence');
  assert.ok(block.indexOf('name: Validate original build evidence')<block.indexOf('actions/download-artifact@'));
  const valid={PSAI_RUN_ID:'123',PSAI_BUILD_RUN_ID:'123',PSAI_RUN_ATTEMPT:'2',GITHUB_RUN_ATTEMPT:'9',PSAI_ARTIFACT_ID:'456',PSAI_SOURCE_SHA:sourceSha,PSAI_TAG_OBJECT_SHA:tagObjectSha,PSAI_MANIFEST_SHA256:'a'.repeat(64)};
  const result=runPowerShell(command,valid);assert.equal(result.status,0,result.stderr||result.error?.message);
  for(const override of [{PSAI_ARTIFACT_ID:''},{PSAI_ARTIFACT_ID:'456,789'},{PSAI_BUILD_RUN_ID:'122'},{PSAI_RUN_ATTEMPT:'0'},{PSAI_MANIFEST_SHA256:'bad'},{PSAI_SOURCE_SHA:'main'},{PSAI_TAG_OBJECT_SHA:'v0.5.0'}]) {
    const rejected=runPowerShell(command,{...valid,...override});assert.notEqual(rejected.status,0,JSON.stringify(override));
  }
});

test('release wiring separates immutable executable control, tagged source and original artifact evidence',()=>{
  // Selecting executable checkout refs through build outputs or passing current publisher attempt crosses the write-token boundary.
  const build=job('build'),publish=job('publish');
  assert.match(workflow,/^permissions:\r?\n  contents: read$/m);
  assert.match(workflow,/^concurrency:\r?\n  group: .+\r?\n  cancel-in-progress: false$/m);
  assert.match(publish,/^    permissions:\r?\n      contents: write$/m);
  assert.match(publish,/^    concurrency:\r?\n      group: ps-ai-release-publisher\r?\n      cancel-in-progress: false$/m);
  for(const block of [build,publish]) {
    const checkout=block.split(/\r?\n      - /).filter(chunk=>chunk.includes('actions/checkout@'));
    assert.ok(checkout.some(chunk=>/^          ref: \$\{\{ github\.workflow_sha \}\}$/m.test(chunk)&&/^          path: automation$/m.test(chunk)));
    assert.ok(checkout.every(chunk=>/^          persist-credentials: false$/m.test(chunk)));
    for(const chunk of block.split(/\r?\n      - /))if(chunk.includes('        run: |'))assert.doesNotMatch(chunk.split('        run: |')[1],/\$\{\{/,'GitHub data must enter scripts through environment values');
  }
  assert.ok(build.indexOf('resolve.mjs checkout')<build.indexOf('run: npm ci'));
  assert.equal((build.match(/run: npm run package/g)??[]).length,1);
  assert.match(build,/ref: \$\{\{ steps\.resolve\.outputs\.sourceSha \}\}/);
  assert.match(build,/PSAI_SOURCE_REF: \$\{\{ steps\.resolve\.outputs\.sourceSha \}\}/);
  assert.match(build,/artifactId: \$\{\{ steps\.upload\.outputs\.artifact-id \}\}/);
  assert.match(build,/buildRunAttempt: \$\{\{ steps\.batch\.outputs\.runAttempt \}\}/);
  assert.match(publish,/artifact-ids: \$\{\{ needs\.build\.outputs\.artifactId \}\}/);
  assert.doesNotMatch(publish,/^          (?:name|pattern|run-id|github-token):/m);
  assert.match(publish,/PSAI_RUN_ATTEMPT: \$\{\{ needs\.build\.outputs\.buildRunAttempt \}\}/);
  assert.doesNotMatch(publish,/github\.run_attempt|npm (?:ci|run)|needs\.build\.outputs\.automationSha/);
  assert.match(publish,/PSAI_DRY_RUN: 'false'/);
  assert.match(publish,/if: github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.dry_run == false\)/);
});
