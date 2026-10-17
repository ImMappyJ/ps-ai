import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('Windows launcher chooses the first Node on PATH and passes quoted paths to a hidden process',{skip:process.platform!=='win32'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai launch '));
  try{
    const launcher=path.join(root,'start-ps-ai-relay.ps1');await fs.copyFile('scripts/relay/start-ps-ai-relay.ps1',launcher);const report=path.join(root,'report.json'),probe=path.join(root,'probe.ps1');
    await fs.writeFile(probe,`function Get-Command { [CmdletBinding()]param($Name,$CommandType) @([PSCustomObject]@{Source=$env:PSAI_TEST_NODE},[PSCustomObject]@{Source='C:\\invalid-node.exe'}) }
function Start-Process { param($FilePath,$ArgumentList,$WindowStyle) @{file=$FilePath;args=$ArgumentList;style=$WindowStyle} | ConvertTo-Json | Set-Content -LiteralPath $env:PSAI_TEST_REPORT -Encoding UTF8 }
& $env:PSAI_TEST_LAUNCHER
`);
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',probe],{windowsHide:true,encoding:'utf8',timeout:6000,env:{...process.env,PSAI_TEST_NODE:process.execPath,PSAI_TEST_REPORT:report,PSAI_TEST_LAUNCHER:launcher}});
    assert.equal(result.status,0,result.stderr||result.error?.message||'Launcher failed with multiple Node paths');const data=JSON.parse((await fs.readFile(report,'utf8')).replace(/^\uFEFF/,''));assert.equal(data.file,process.execPath);assert.equal(data.style,'Hidden');const resolved=await fs.realpath(root);assert.deepEqual(data.args,[`"${path.join(resolved,'ps-ai-gateway.mjs')}"`,'--managed','--data-dir',`"${resolved}"`]);
  }finally{assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});
