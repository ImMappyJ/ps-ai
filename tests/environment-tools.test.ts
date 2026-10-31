import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const quote=(value:string)=>"'"+value.split("'").join("''")+"'";
const exists=(filename:string)=>fs.stat(filename).then(()=>true,()=>false);
async function environmentFixture(run:(fixture:any)=>Promise<void>){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-model-routes-'));
  try{
    const nodes=JSON.parse(await fs.readFile('tests/fixtures/comfy-nodes.json','utf8'));
    const settings=JSON.parse(await fs.readFile('config/settings.example.json','utf8'));
    nodes.UNETLoader={input:{required:{unet_name:[['owned/native.SAFETENSORS']],weight_dtype:[['default','fp8_e4m3fn']]}},output:['MODEL']};
    const selected=path.join(directory,'settings.json'),nodeFile=path.join(directory,'nodes.json'),calls=path.join(directory,'calls.txt');
    const invoke=async(script:string,args:string[],fault='')=>{
      await fs.writeFile(selected,JSON.stringify(settings));await fs.writeFile(nodeFile,JSON.stringify(nodes));
      const wrapper=path.join(directory,'run.ps1');
      await fs.writeFile(wrapper,`function Invoke-RestMethod { param($Uri,$TimeoutSec) [IO.File]::AppendAllText(${quote(calls)},$Uri+"\n"); $class=($Uri -split '/')[-1]; ${fault}; if($Uri -like '*/system_stats'){return @{system=@{comfyui_version='0.37.4'}}}; if($Uri -like '*/queue'){return @{queue_running=@();queue_pending=@()}}; if($Uri -like '*/history/*'){return @{}}; $all=Get-Content -LiteralPath ${quote(nodeFile)} -Raw | ConvertFrom-Json; if($all.PSObject.Properties.Name -contains $class){return @{$class=$all.$class}}; return @{} }\n& ${quote(path.resolve(script))} ${args.map(argument=>argument.startsWith('-')?argument:quote(argument)).join(' ')}\nexit $LASTEXITCODE\n`);
      return spawnSync('powershell.exe',['-NoProfile','-File',wrapper],{encoding:'utf8'});
    };
    await run({directory,nodes,settings,selected,calls,invoke});
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}

test('native-only running preparation preserves nested uppercase choices and performs read-only route checks',async()=>{
  await environmentFixture(async({directory,nodes,settings,selected,calls,invoke})=>{
    settings.models.unet='owned/native.SAFETENSORS';delete nodes.UnetLoaderGGUF;
    const output=path.join(directory,'prepared');
    const result=await invoke('scripts/prepare-environment.ps1',['-BaseUrl','http://localhost:8188','-SettingsPath',selected,'-OutputDirectory',output]);
    assert.equal(result.status,2,result.stdout+result.stderr);
    const prepared=JSON.parse(await fs.readFile(path.join(output,'ps-ai-settings.json'),'utf8'));
    assert.equal(prepared.models.unet,'owned/native.SAFETENSORS');
    const report=JSON.parse(await fs.readFile(path.join(output,'environment-report.json'),'utf8'));
    assert.equal(report.passed,true);assert.ok(report.checks.some((check:any)=>check.name==='node:UNETLoader'&&check.status==='pass'));
    assert.ok(!report.checks.some((check:any)=>check.name==='node:UnetLoaderGGUF'));
    assert.doesNotMatch(await fs.readFile(calls,'utf8'),/\/prompt|\/upload|\/cancel|\/interrupt/);
    assert.deepEqual(JSON.parse(await fs.readFile(selected,'utf8')),settings);
  });
});

test('native-only discovery with old defaults leaves an unresolved draft instead of selecting arbitrary native weights',async()=>{
  await environmentFixture(async({directory,nodes,settings,selected,invoke})=>{
    delete nodes.UnetLoaderGGUF;
    const output=path.join(directory,'prepared');
    const result=await invoke('scripts/prepare-environment.ps1',['-BaseUrl','http://localhost:8188','-SettingsPath',selected,'-OutputDirectory',output]);
    assert.equal(result.status,2,result.stdout+result.stderr);
    const discovery=JSON.parse(await fs.readFile(path.join(output,'model-discovery.json'),'utf8'));
    assert.deepEqual(discovery.unresolved,['unet']);assert.deepEqual(discovery.inventory.unet,['owned/native.SAFETENSORS']);
    assert.equal(discovery.models.unet,settings.models.unet);
  });
});

test('GGUF preparation ignores unsupported dtype options on an unused native loader',async()=>{
  await environmentFixture(async({directory,nodes,settings,selected,invoke})=>{
    nodes.UNETLoader.input.required.weight_dtype=[['fp8_e4m3fn']];
    const output=path.join(directory,'prepared');
    const result=await invoke('scripts/prepare-environment.ps1',['-BaseUrl','http://localhost:8188','-SettingsPath',selected,'-OutputDirectory',output]);
    assert.equal(result.status,2,result.stdout+result.stderr);
    const discovery=JSON.parse(await fs.readFile(path.join(output,'model-discovery.json'),'utf8'));
    assert.equal(discovery.models.unet,settings.models.unet);
    assert.deepEqual(discovery.unresolved,[]);
    const report=JSON.parse(await fs.readFile(path.join(output,'environment-report.json'),'utf8'));
    assert.equal(report.passed,true);
    assert.ok(!report.checks.some((check:any)=>check.name==='unet-weight-dtype'));
  });
});

test('discovery preserves empty inventories and only exposes each diffusion loader format',async()=>{
  await environmentFixture(async({directory,nodes,selected,invoke})=>{
    nodes.UnetLoaderGGUF.input.required.unet_name[0]=['wrong/native.safetensors'];
    nodes.UNETLoader.input.required.unet_name[0]=['wrong/quant.gguf'];
    nodes.CLIPLoader.input.required.clip_name[0]=[];
    const output=path.join(directory,'prepared');
    const result=await invoke('scripts/prepare-environment.ps1',['-BaseUrl','http://localhost:8188','-SettingsPath',selected,'-OutputDirectory',output]);
    assert.equal(result.status,2,result.stdout+result.stderr);
    const discovery=JSON.parse(await fs.readFile(path.join(output,'model-discovery.json'),'utf8'));
    assert.deepEqual(discovery.inventory.unet,[]);assert.deepEqual(discovery.inventory.clip,[]);
    assert.deepEqual(discovery.unresolved,['unet','clip']);
  });
});

test('missing native choices never switch to visible GGUF presets or accept the wrong loader inventory',async()=>{
  await environmentFixture(async({directory,nodes,settings,selected,invoke})=>{
    settings.models.unet='owned/missing.safetensors';
    nodes.UnetLoaderGGUF.input.required.unet_name[0].push(settings.models.unet);
    const output=path.join(directory,'prepared');
    const result=await invoke('scripts/prepare-environment.ps1',['-BaseUrl','http://localhost:8188','-SettingsPath',selected,'-OutputDirectory',output]);
    assert.equal(result.status,2,result.stdout+result.stderr);
    const discovery=JSON.parse(await fs.readFile(path.join(output,'model-discovery.json'),'utf8'));
    assert.equal(discovery.models.unet,settings.models.unet);assert.deepEqual(discovery.unresolved,['unet']);
    const reportPath=path.join(directory,'checked.json');
    const checked=await invoke('scripts/check-environment.ps1',['-SettingsPath',selected,'-ReportPath',reportPath]);
    assert.equal(checked.status,1,checked.stdout+checked.stderr);
    assert.ok(JSON.parse(await fs.readFile(reportPath,'utf8')).checks.some((check:any)=>check.name==='visible:unet'&&check.status==='fail'));
  });
});

test('optional-loader absence is tolerated but malformed schemas and request failures stop preparation before output',async()=>{
  for(const optional of ['UNETLoader','UnetLoaderGGUF'])for(const behavior of ["throw 'fixture transport failure'","return 'invalid schema'",`return @{${optional}=@{input=@{required=@{unet_name=@('STRING')}}}}`]){
    await environmentFixture(async({directory,settings,selected,invoke})=>{
      if(optional==='UnetLoaderGGUF')settings.models.unet='owned/native.SAFETENSORS';
      const output=path.join(directory,'prepared');
      const result=await invoke('scripts/prepare-environment.ps1',['-BaseUrl','http://localhost:8188','-SettingsPath',selected,'-OutputDirectory',output],`if($class -eq '${optional}'){${behavior}}`);
      assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(await exists(output),false);
    });
  }
});

test('source checks skip GGUF pins for native routes and warn for alternative GGUF revisions',async()=>{
  await environmentFixture(async({directory,settings,selected})=>{
    const backend=path.join(directory,'ComfyUI'),wrapper=path.join(directory,'source.ps1'),calls=path.join(directory,'git-calls.txt');
    await fs.mkdir(backend);await fs.writeFile(path.join(backend,'server.py'),"route = '/api/jobs/{job_id}/cancel'");
    for(const extension of ['safetensors','gguf']){
      settings.models.unet=`owned/custom.${extension}`;
      await fs.writeFile(selected,JSON.stringify(settings));
      if(extension==='gguf')await fs.mkdir(path.join(backend,'custom_nodes/alternative-GGUF'),{recursive:true});
      const reportPath=path.join(directory,`${extension}.json`);
      await fs.writeFile(wrapper,`function git { [IO.File]::AppendAllText(${quote(calls)},($args -join ' ')+"\n"); $global:LASTEXITCODE=0; return 'alternative-compatible-revision' }\n& ${quote(path.resolve('scripts/check-environment.ps1'))} -SettingsPath ${quote(selected)} -ComfyRoot ${quote(backend)} -ReportPath ${quote(reportPath)} -Offline\nexit $LASTEXITCODE\n`);
      const result=spawnSync('powershell.exe',['-NoProfile','-File',wrapper],{encoding:'utf8'});
      assert.equal(result.status,2,result.stdout+result.stderr);
      const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
      assert.equal(report.passed,true);assert.ok(!report.checks.some((check:any)=>check.name==='backend-source'));
      const pin=report.checks.find((check:any)=>check.name==='gguf-commit');
      if(extension==='safetensors'){assert.equal(pin,undefined);assert.doesNotMatch(await fs.readFile(calls,'utf8'),/custom_nodes/);}
      else assert.equal(pin.status,'warn');
      assert.equal(await fs.readFile(path.join(backend,'server.py'),'utf8'),"route = '/api/jobs/{job_id}/cancel'");
    }
  });
});

test('native checks require selected loader visibility and default dtype support without GGUF nodes',async()=>{
  for(const failure of ['missing','dtype','inventory']){
    await environmentFixture(async({directory,nodes,settings,selected,invoke})=>{
      settings.models.unet='owned/native.SAFETENSORS';delete nodes.UnetLoaderGGUF;
      if(failure==='missing')delete nodes.UNETLoader;
      if(failure==='dtype')nodes.UNETLoader.input.required.weight_dtype=[['fp8_e4m3fn']];
      if(failure==='inventory')nodes.UNETLoader.input.required.unet_name=['STRING'];
      const reportPath=path.join(directory,'checked.json');
      const result=await invoke('scripts/check-environment.ps1',['-SettingsPath',selected,'-ReportPath',reportPath]);
      assert.equal(result.status,1,result.stdout+result.stderr);
      const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
      assert.ok(report.checks.some((check:any)=>check.status==='fail'&&check.name!=='settings'));
    });
  }
});

test('model names reject traversal, absolute paths, alternate streams and non-safetensors encoders before requests or output',async()=>{
  for(const [key,name] of [['unet','../native.safetensors'],['unet','C:/native.safetensors'],['unet','owned//native.gguf'],['unet','owned/native:stream.gguf'],['unet','owned/native?.gguf'],['clip','encoder.gguf'],['vae','decoder.gguf']]){
    await environmentFixture(async({directory,settings,selected,calls,invoke})=>{
      settings.models[key]=name;const output=path.join(directory,'prepared');
      const result=await invoke('scripts/prepare-environment.ps1',['-BaseUrl','http://localhost:8188','-SettingsPath',selected,'-OutputDirectory',output]);
      assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(await exists(calls),false);assert.equal(await exists(output),false);
      const checked=await invoke('scripts/check-environment.ps1',['-SettingsPath',selected,'-Offline']);
      assert.equal(checked.status,1,checked.stdout+checked.stderr);
    });
  }
});

test('launcher preparation preserves native custom names and backend files',async()=>{
  await environmentFixture(async({directory,settings,selected,invoke})=>{
    settings.models.unet='custom\\native.SAFETENSORS';
    const backend=path.join(directory,'ComfyUI'),python=path.join(backend,'venv/Scripts/python.exe'),output=path.join(directory,'prepared');
    await fs.mkdir(path.dirname(python),{recursive:true});await fs.mkdir(path.join(backend,'models'));await fs.writeFile(python,'fixture');await fs.writeFile(path.join(backend,'main.py'),'unchanged');
    const result=await invoke('scripts/prepare-environment.ps1',['-ComfyRoot',backend,'-SettingsPath',selected,'-OutputDirectory',output]);
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(JSON.parse(await fs.readFile(path.join(output,'ps-ai-settings.json'),'utf8')).models.unet,settings.models.unet);
    assert.equal(await fs.readFile(path.join(backend,'main.py'),'utf8'),'unchanged');
  });
});
