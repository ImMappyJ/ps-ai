import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';

test('CCX 检查在安装器缺失时解释原因并保留包，不把检查冒充安装成功',async()=>{
  // @ts-expect-error Packaging is plain JS.
  const {createPackage}=await import('../scripts/package.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-install-'));
  try{
    const input=path.join(dir,'plugin');await fs.mkdir(input);
    await fs.writeFile(path.join(input,'manifest.json'),JSON.stringify({manifestVersion:5,id:'local.ps-ai',version:'0.1.0',main:'index.html',host:{app:'PS',minVersion:'27.0.0'}}));
    await fs.writeFile(path.join(input,'index.html'),'<script src="main.js"></script>');await fs.writeFile(path.join(input,'main.js'),'');
    const archive=path.join(dir,'plugin with spaces.ccx'),report=path.join(dir,'report.json');await createPackage(input,archive);
    const result=spawnSync('powershell.exe',['-NoProfile','-File','scripts/install-ccx.ps1','-PackagePath',archive,'-InstallerPath',path.join(dir,'missing.exe'),'-CheckOnly','-ReportPath',report],{encoding:'utf8'});
    assert.equal(result.status,2,result.stderr+result.stdout);const body=JSON.parse(await fs.readFile(report,'utf8'));
    assert.equal(body.packageValid,true);assert.equal(body.installerFound,false);assert.equal(body.installed,false);assert.match(body.detail,/Creative Cloud/);
    assert.ok((await fs.stat(archive)).size>0);
    await fs.writeFile(archive,'not a zip');const bad=spawnSync('powershell.exe',['-NoProfile','-File','scripts/install-ccx.ps1','-PackagePath',archive,'-CheckOnly','-ReportPath',report]);
    assert.equal(bad.status,1);assert.equal(JSON.parse(await fs.readFile(report,'utf8')).packageValid,false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('CCX 安装入口保留带空格的完整包路径，并传播安装器失败',async()=>{
  // @ts-expect-error Packaging is plain JS.
  const {createPackage}=await import('../scripts/package.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-upia-'));
  try{
    const input=path.join(dir,'plugin');await fs.mkdir(input);
    await fs.writeFile(path.join(input,'manifest.json'),JSON.stringify({manifestVersion:5,id:'local.ps-ai',version:'0.1.0',main:'index.html',host:{app:'PS',minVersion:'27.0.0'}}));
    await fs.writeFile(path.join(input,'index.html'),'plugin');await fs.writeFile(path.join(input,'main.js'),'plugin');
    const archive=path.join(dir,'plugin with spaces.ccx'),report=path.join(dir,'report.json'),installer=path.join(dir,'installer.exe');await createPackage(input,archive);
    const source=path.join(dir,'fixture.cs'),compile=path.join(dir,'compile.ps1');
    await fs.writeFile(source,'using System; public class Fixture { public static int Main(string[] args) { Console.WriteLine(args.Length+"|"+String.Join("|",args)); Console.WriteLine(Environment.CurrentDirectory); string mode=Environment.GetEnvironmentVariable("PS_AI_FIXTURE_MODE"); Console.WriteLine(mode=="failed" ? "Failed to install, status = -198!" : mode=="unknown" ? "" : "Installation Successful for extension"); return Int32.Parse(Environment.GetEnvironmentVariable("PS_AI_FIXTURE_EXIT")); } }');
    await fs.writeFile(compile,'param([string]$Source,[string]$Target)\n$ErrorActionPreference="Stop"\nAdd-Type -Path $Source -OutputAssembly $Target -OutputType ConsoleApplication\n');
    const compiled=spawnSync('powershell.exe',['-NoProfile','-File',compile,source,installer],{encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);
    const installedDirectory=path.join(dir,'installed');await fs.mkdir(installedDirectory);await fs.writeFile(path.join(installedDirectory,'main.js'),'plugin');
    for(const [exitCode,mode,status,installed] of [[41,'success',3,false],[0,'failed',3,false],[0,'unknown',3,false],[0,'success',0,true]] as const){
      const result=spawnSync('powershell.exe',['-NoProfile','-File','scripts/install-ccx.ps1','-PackagePath',archive,'-InstallerPath',installer,'-InstalledPluginDirectory',installedDirectory,'-ReportPath',report],{encoding:'utf8',env:{...process.env,PS_AI_FIXTURE_EXIT:String(exitCode),PS_AI_FIXTURE_MODE:mode}});
      assert.equal(result.status,status,result.stdout+result.stderr);const body=JSON.parse(await fs.readFile(report,'utf8'));
      assert.equal(body.installed,installed);assert.equal(body.installerExitCode,exitCode);assert.equal(body.installerOutput.split(/\r?\n/)[0],`2|/install|${archive}`);assert.equal((await fs.realpath(body.installerOutput.split(/\r?\n/)[1])).toLowerCase(),(await fs.realpath(dir)).toLowerCase());
      if(mode==='failed')assert.equal(body.installerStatus,-198);
    }
    for(const [runtime,status] of [['old package',3],['plugin',0]] as const){
      await fs.writeFile(path.join(installedDirectory,'main.js'),runtime);
      const result=spawnSync('powershell.exe',['-NoProfile','-File','scripts/install-ccx.ps1','-PackagePath',archive,'-InstallerPath',installer,'-InstalledPluginDirectory',installedDirectory,'-ReportPath',report],{encoding:'utf8',env:{...process.env,PS_AI_FIXTURE_EXIT:'0',PS_AI_FIXTURE_MODE:'success'}});
      assert.equal(result.status,status,result.stdout+result.stderr);const body=JSON.parse(await fs.readFile(report,'utf8'));assert.equal(body.payloadMatches,status===0,JSON.stringify(body));assert.equal(body.installed,status===0);
    }
    // A Photoshop reinstall can remove the payload while UPIA retains its installed record.
    const missing=spawnSync('powershell.exe',['-NoProfile','-File','scripts/install-ccx.ps1','-PackagePath',archive,'-InstallerPath',installer,'-ReportPath',report],{encoding:'utf8',env:{...process.env,CommonProgramFiles:path.join(dir,'empty common files'),PS_AI_FIXTURE_EXIT:'0',PS_AI_FIXTURE_MODE:'success'}});
    assert.equal(missing.status,3,missing.stdout+missing.stderr);const absent=JSON.parse(await fs.readFile(report,'utf8'));
    assert.equal(absent.installed,false);assert.equal(absent.payloadMatches,false);assert.match(absent.detail,/missing|stale/i);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('PowerShell 5.1 环境检查在 Get-FileHash 不可用时仍核验权重 SHA256',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-hash-'));try{
    await fs.mkdir(path.join(dir,'scripts'));await fs.mkdir(path.join(dir,'config'));
    await fs.copyFile('scripts/check-environment.ps1',path.join(dir,'scripts/check-environment.ps1'));
    const fixture=Buffer.from('small model fixture'),hash=createHash('sha256').update(fixture).digest('hex');
    const preset=JSON.parse(await fs.readFile('config/compatibility.json','utf8'));
    for(const m of preset.models){m.bytes=fixture.length;m.sha256=hash;await fs.mkdir(path.join(dir,m.directory),{recursive:true});await fs.writeFile(path.join(dir,m.directory,m.filename),fixture);}
    const settings=JSON.parse(await fs.readFile('config/settings.example.json','utf8'));
    for(const m of preset.models)await fs.writeFile(path.join(dir,m.directory,settings.models[m.key]),fixture);
    await fs.writeFile(path.join(dir,'config/compatibility.json'),JSON.stringify(preset));await fs.writeFile(path.join(dir,'config/settings.example.json'),JSON.stringify(settings));
    const q=(s:string)=>"'"+s.split("'").join("''")+"'";const report=path.join(dir,'report.json'),wrapper=path.join(dir,'wrapper.ps1');
    await fs.writeFile(wrapper,`function Get-FileHash { throw 'Get-FileHash unavailable' }\n& ${q(path.join(dir,'scripts/check-environment.ps1'))} -Offline -ModelRoot ${q(dir)} -ReportPath ${q(report)}\n`);
    const r=spawnSync('powershell.exe',['-NoProfile','-File',wrapper],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);
    const checks=JSON.parse(await fs.readFile(report,'utf8')).checks;assert.equal(checks.filter((c:any)=>c.name.startsWith('model:')&&c.status==='pass').length,3);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('环境检查将 localhost 尾斜杠和旧 IP 配置规范为同一请求地址',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-url-'));try{
    for(const baseUrl of [' http://localhost:8188/ ','http://127.0.0.1:8188/','http://localhost:8199','https://comfy.example.com:9443']){
      const settings=path.join(dir,'settings.json'),captured=path.join(dir,'uri.txt'),wrapper=path.join(dir,'wrapper.ps1');
      await fs.writeFile(settings,JSON.stringify({schemaVersion:1,baseUrl,models:{unet:'a.gguf',clip:'b.safetensors',vae:'c.safetensors'}}));
      const quote=(s:string)=>"'"+s.split("'").join("''")+"'";
      await fs.writeFile(wrapper,`function Invoke-RestMethod { param($Uri,$TimeoutSec) [System.IO.File]::WriteAllText(${quote(captured)},$Uri); throw 'fixture stops before network' }\n& ${quote(path.resolve('scripts/check-environment.ps1'))} -SettingsPath ${quote(settings)}\n`);
      const result=spawnSync('powershell.exe',['-NoProfile','-File',wrapper],{encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);assert.equal(await fs.readFile(captured,'utf8'),(baseUrl.includes('8188')?'http://localhost:8188':baseUrl)+'/system_stats');
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('无 Node 的 PowerShell 检查报告缺失模型，不安装或创建后端文件',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-doctor-'));try{
    const report=path.join(dir,'report.json');const result=spawnSync('powershell.exe',['-NoProfile','-File','scripts/check-environment.ps1','-Offline','-ModelRoot',dir,'-ReportPath',report],{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr+result.stdout);const body=JSON.parse(await fs.readFile(report,'utf8'));assert.equal(body.passed,false);assert.equal(body.checks.filter((c:any)=>c.name.startsWith('model:')&&c.status==='fail').length,3);assert.deepEqual(await fs.readdir(dir),['report.json']);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('已有环境准备只写新输出目录，拒绝覆盖并正确引用带空格/引号的路径',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"ps-ai-prep-' "));try{
    const comfy=path.join(dir,'模型backend'),models=path.join(dir,'models'),out=path.join(dir,'prepared'),python=path.join(comfy,'.venv','Scripts','python.exe');await fs.mkdir(path.dirname(python),{recursive:true});await fs.mkdir(models);await fs.writeFile(python,'fixture');await fs.writeFile(path.join(comfy,'main.py'),'fixture');
    const args=['-NoProfile','-File','scripts/prepare-environment.ps1','-ComfyRoot',comfy,'-ModelRoot',models,'-OutputDirectory',out,'-Port','8199'];const result=spawnSync('powershell.exe',args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);
    const launch=await fs.readFile(path.join(out,'start-comfyui.ps1'),'utf8');assert.ok(launch.includes(comfy.split("'").join("''")));assert.ok(launch.includes('--listen 127.0.0.1 --port 8199'));assert.equal(JSON.parse(await fs.readFile(path.join(out,'ps-ai-settings.json'),'utf8')).baseUrl,'http://localhost:8199');const before=await fs.readFile(path.join(out,'extra_model_paths.yaml'),'utf8');assert.match(before,/text_encoders/);
    const again=spawnSync('powershell.exe',args,{encoding:'utf8'});assert.equal(again.status,1);assert.equal(await fs.readFile(path.join(out,'extra_model_paths.yaml'),'utf8'),before);assert.equal(await fs.readFile(path.join(comfy,'main.py'),'utf8'),'fixture');
    const file=path.join(out,'start-comfyui.ps1').split("'").join("''");const parsed=spawnSync('powershell.exe',['-NoProfile','-Command',`$tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$tokens,[ref]$errors); if($errors.Count){exit 1}`]);assert.equal(parsed.status,0,'Generated launcher must parse in Windows PowerShell 5.1 with Unicode paths');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('环境检查按 UTF8 读取面板导出的中文模型映射',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-utf8-'));try{const settings=path.join(dir,'settings.json'),report=path.join(dir,'report.json');await fs.writeFile(settings,JSON.stringify({schemaVersion:1,baseUrl:'http://127.0.0.1:8188',models:{unet:'模型.gguf',clip:'编码器.safetensors',vae:'解码器.safetensors'}}));const result=spawnSync('powershell.exe',['-NoProfile','-File','scripts/check-environment.ps1','-Offline','-ModelRoot',dir,'-SettingsPath',settings,'-ReportPath',report]);assert.equal(result.status,1);const body=JSON.parse(await fs.readFile(report,'utf8'));assert.equal(body.checks.find((c:any)=>c.name==='model:unet').detail,'Missing diffusion_models/模型.gguf');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
