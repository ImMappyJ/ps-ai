import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const quote=(value:string)=>"'"+value.split("'").join("''")+"'";
test('preparation detects existing venv and Portable Python and defaults to backend models',async()=>{
  for(const layout of ['venv/Scripts/python.exe','../python_embeded/python.exe','../external Python/python.exe']){
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),"ps-ai-layout-' "));
    try{
      const backend=path.join(directory,'ComfyUI'),python=path.resolve(backend,layout),output=path.join(directory,'prepared');
      await fs.mkdir(path.dirname(python),{recursive:true});await fs.mkdir(path.join(backend,'models'),{recursive:true});await fs.writeFile(python,'fixture');await fs.writeFile(path.join(backend,'main.py'),'unchanged');
      const result=spawnSync('powershell.exe',['-NoProfile','-File','scripts/prepare-environment.ps1','-ComfyRoot',backend,'-OutputDirectory',output,...(layout.includes('external')?['-PythonPath',python]:[])],{encoding:'utf8'});
      assert.equal(result.status,0,result.stdout+result.stderr);assert.ok((await fs.readFile(path.join(output,'start-comfyui.ps1'),'utf8')).includes(python.split("'").join("''")));
      assert.match(await fs.readFile(path.join(output,'README.txt'),'utf8'),/Import JSON/);assert.equal(await fs.readFile(path.join(backend,'main.py'),'utf8'),'unchanged');
    }finally{await fs.rm(directory,{recursive:true,force:true});}
  }
});

test('preparation explains missing existing Python and leaves output absent',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-no-python-'));
  try{
    const output=path.join(directory,'prepared');await fs.mkdir(path.join(directory,'models'));await fs.writeFile(path.join(directory,'main.py'),'unchanged');
    const result=spawnSync('powershell.exe',['-NoProfile','-File','scripts/prepare-environment.ps1','-ComfyRoot',directory,'-OutputDirectory',output],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stdout+result.stderr,/-PythonPath/);assert.equal(await fs.stat(output).then(()=>true,()=>false),false);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('reuse-running preparation keeps current choices, resolves unique preset basenames and only reads APIs',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-running-'));
  try{
    const fixture=JSON.parse(await fs.readFile('tests/fixtures/comfy-nodes.json','utf8')),settings=JSON.parse(await fs.readFile('config/settings.example.json','utf8'));
    settings.models.unet='owned/Q5_K_M.gguf';fixture.UnetLoaderGGUF.input.required.unet_name[0]=[settings.models.unet];
    fixture.CLIPLoader.input.required.clip_name[0]=[`qwen/${settings.models.clip}`];fixture.VAELoader.input.required.vae_name[0]=[settings.models.vae];
    const nodes=path.join(directory,'nodes.json'),selected=path.join(directory,'settings.json'),output=path.join(directory,'prepared'),calls=path.join(directory,'calls.txt'),wrapper=path.join(directory,'run.ps1');
    await fs.writeFile(nodes,JSON.stringify(fixture));await fs.writeFile(selected,JSON.stringify(settings));
    await fs.writeFile(wrapper,`function Invoke-RestMethod { param($Uri,$TimeoutSec) [IO.File]::AppendAllText(${quote(calls)},$Uri+"\n"); if($Uri -like '*/system_stats'){return @{system=@{comfyui_version='0.37.4'}}}; if($Uri -like '*/queue'){return @{queue_running=@();queue_pending=@()}}; if($Uri -like '*/history/*'){return @{}}; $all=Get-Content -LiteralPath ${quote(nodes)} -Raw | ConvertFrom-Json; $class=($Uri -split '/')[-1]; return @{$class=$all.$class} }\n& ${quote(path.resolve('scripts/prepare-environment.ps1'))} -BaseUrl 'http://localhost:8188/' -SettingsPath ${quote(selected)} -OutputDirectory ${quote(output)}\nexit $LASTEXITCODE\n`);
    const result=spawnSync('powershell.exe',['-NoProfile','-File',wrapper],{encoding:'utf8'});
    assert.equal(result.status,2,result.stdout+result.stderr);
    const prepared=JSON.parse(await fs.readFile(path.join(output,'ps-ai-settings.json'),'utf8'));assert.equal(prepared.models.unet,settings.models.unet);assert.equal(prepared.models.clip,`qwen/${settings.models.clip}`);
    assert.deepEqual((await fs.readdir(output)).sort(),['README.txt','environment-report.json','model-discovery.json','ps-ai-settings.json']);
    const report=JSON.parse(await fs.readFile(path.join(output,'environment-report.json'),'utf8'));assert.equal(report.passed,true);assert.equal(report.complete,false);assert.ok(report.checks.some((check:any)=>check.name==='task-status-api'&&check.status==='pass'));
    assert.doesNotMatch(await fs.readFile(calls,'utf8'),/\/prompt|\/upload|\/cancel|\/interrupt/);
    const malformed=path.join(directory,'malformed.ps1'),badReport=path.join(directory,'bad-report.json');
    const source=await fs.readFile(wrapper,'utf8');
    await fs.writeFile(malformed,source.slice(0,source.indexOf('\n& ')).replace('queue_running=@()','queue_running=\'wrong\'')+`\n& ${quote(path.resolve('scripts/check-environment.ps1'))} -SettingsPath ${quote(path.join(output,'ps-ai-settings.json'))} -ReportPath ${quote(badReport)}\nexit $LASTEXITCODE\n`);
    const rejected=spawnSync('powershell.exe',['-NoProfile','-File',malformed],{encoding:'utf8'});assert.equal(rejected.status,1,rejected.stdout+rejected.stderr);
    assert.ok(JSON.parse(await fs.readFile(badReport,'utf8')).checks.some((check:any)=>check.name==='task-status-api'&&check.status==='fail'));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('reuse-running preparation reports ambiguous mappings and rejects invalid origins before network or writes',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-unresolved-'));
  try{
    const output=path.join(directory,'prepared'),wrapper=path.join(directory,'run.ps1'),calls=path.join(directory,'calls.txt');
    await fs.writeFile(wrapper,`function Invoke-RestMethod { throw 'must not contact network' }\n& ${quote(path.resolve('scripts/prepare-environment.ps1'))} -BaseUrl 'http://localhost:8188/path' -OutputDirectory ${quote(output)}\nexit $LASTEXITCODE\n`);
    const result=spawnSync('powershell.exe',['-NoProfile','-File',wrapper],{encoding:'utf8'});assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(await fs.stat(output).then(()=>true,()=>false),false);
    const preset=JSON.parse(await fs.readFile('config/settings.example.json','utf8')).models;
    await fs.writeFile(wrapper,`function Invoke-RestMethod { param($Uri,$TimeoutSec) [IO.File]::AppendAllText(${quote(calls)},$Uri+"\n"); $class=($Uri -split '/')[-1]; $field=switch($class){'UnetLoaderGGUF'{'unet_name'} 'CLIPLoader'{'clip_name'} 'VAELoader'{'vae_name'}}; $name=switch($class){'UnetLoaderGGUF'{${quote(preset.unet)}} 'CLIPLoader'{${quote(preset.clip)}} 'VAELoader'{${quote(preset.vae)}}}; return @{$class=@{input=@{required=@{$field=@(@(('a/'+$name),('b/'+$name)),@{})}}}} }\n& ${quote(path.resolve('scripts/prepare-environment.ps1'))} -BaseUrl 'http://localhost:8188' -OutputDirectory ${quote(output)}\nexit $LASTEXITCODE\n`);
    const ambiguous=spawnSync('powershell.exe',['-NoProfile','-File',wrapper],{encoding:'utf8'});assert.equal(ambiguous.status,2,ambiguous.stdout+ambiguous.stderr);
    const discovery=JSON.parse(await fs.readFile(path.join(output,'model-discovery.json'),'utf8'));assert.deepEqual(discovery.unresolved,['unet','clip','vae']);assert.match(await fs.readFile(path.join(output,'README.txt'),'utf8'),/draft/i);
    const before=await fs.readFile(calls,'utf8'),again=spawnSync('powershell.exe',['-NoProfile','-File',wrapper]);assert.equal(again.status,1);assert.equal(await fs.readFile(calls,'utf8'),before);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
