[CmdletBinding(DefaultParameterSetName='Launcher')]
param(
    [Parameter(Mandatory=$true,ParameterSetName='Launcher')][string]$ComfyRoot,
    [Parameter(Mandatory=$true,ParameterSetName='Running')][string]$BaseUrl,
    [string]$ModelRoot,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$SettingsPath,
    [string]$PythonPath,
    [ValidateRange(1,65535)][int]$Port=8188
)
$ErrorActionPreference='Stop'
function Write-Utf8([string]$Path,[string]$Text,[bool]$Bom=$false) { [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($Bom)) }
function Test-ModelName([string]$Name,[string]$Key) {
    $extension=if ($Key -eq 'unet') { '.gguf' } else { '.safetensors' }
    return $Name -and $Name -eq $Name.Trim() -and $Name -notmatch '^[\\/]|^[A-Za-z]:|[\x00-\x1f]' -and @($Name -split '[\\/]' | Where-Object { $_ -in @('', '.', '..') }).Count -eq 0 -and $Name.ToLowerInvariant().EndsWith($extension)
}
try {
    $outputPath=[IO.Path]::GetFullPath($OutputDirectory)
    if (Test-Path -LiteralPath $outputPath) { throw 'OutputDirectory already exists. Choose a new directory; existing files are never overwritten.' }
    $repoRoot=Split-Path -Parent $PSScriptRoot
    $defaults=Get-Content -LiteralPath (Join-Path $repoRoot 'config/settings.example.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $settings=if ($SettingsPath) { Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $defaults | ConvertTo-Json -Depth 8 | ConvertFrom-Json }
    if ($settings.schemaVersion -ne 1 -or ($settings.backend -and $settings.backend -ne 'comfyui') -or $settings.platform) { throw 'Use a schemaVersion 1 ComfyUI settings export.' }
    foreach ($key in @('unet','clip','vae')) { if (-not (Test-ModelName $settings.models.$key $key)) { throw "Invalid relative model name: $key" } }
    if ($PSCmdlet.ParameterSetName -eq 'Running') {
        $serviceUri=$null
        if ($BaseUrl.Trim() -notmatch '^https?://(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?/?$' -or -not [Uri]::TryCreate($BaseUrl.Trim(),[UriKind]::Absolute,[ref]$serviceUri) -or $serviceUri.Port -lt 1 -or $serviceUri.Port -gt 65535) { throw 'Use an HTTP(S) origin without credentials, path, query or fragment.' }
        $builder=[UriBuilder]::new($serviceUri)
        if ($builder.Host -eq '127.0.0.1') { $builder.Host='localhost' }
        $settings.baseUrl=$builder.Uri.GetLeftPart([UriPartial]::Authority)
        $inventory=[ordered]@{};$changed=[System.Collections.Generic.List[string]]::new();$unresolved=[System.Collections.Generic.List[string]]::new()
        foreach ($mapping in @(@('unet','UnetLoaderGGUF','unet_name'),@('clip','CLIPLoader','clip_name'),@('vae','VAELoader','vae_name'))) {
            $key=$mapping[0];$class=$mapping[1];$field=$mapping[2]
            $info=Invoke-RestMethod -Uri ($settings.baseUrl+'/object_info/'+$class) -TimeoutSec 15
            $files=$info.$class.input.required.$field[0]
            if ($files -isnot [array] -or @($files | Where-Object { $_ -isnot [string] }).Count) { throw "Missing model inventory: $class.$field" }
            $files=@($files | Where-Object { Test-ModelName $_ $key } | Select-Object -Unique);$inventory[$key]=$files
            if ($files -ccontains $settings.models.$key) { continue }
            $preset=$defaults.models.$key;$nested=@($files | Where-Object { ($_ -split '[\\/]')[-1] -ceq $preset })
            $match=if ($files -ccontains $preset) { $preset } elseif ($nested.Count -eq 1) { $nested[0] } else { $null }
            if ($match) { $settings.models.$key=$match;$changed.Add($key) } else { $unresolved.Add($key) }
        }
        $null=New-Item -ItemType Directory -Path $outputPath
        $preparedSettings=Join-Path $outputPath 'ps-ai-settings.json';$reportPath=Join-Path $outputPath 'environment-report.json'
        Write-Utf8 $preparedSettings ($settings | ConvertTo-Json -Depth 12)
        Write-Utf8 (Join-Path $outputPath 'model-discovery.json') ([ordered]@{models=$settings.models;changed=@($changed.ToArray());unresolved=@($unresolved.ToArray());inventory=$inventory;scope='Filename visibility only; not model architecture or inference acceptance.'} | ConvertTo-Json -Depth 8)
        if ($unresolved.Count) {
            Write-Utf8 $reportPath ([ordered]@{schemaVersion=1;passed=$false;complete=$false;checks=@(@{name='model-mapping';status='fail';detail=('Choose loader-relative filenames for: '+($unresolved -join ', '))});scope='Incomplete draft only; no inference submitted.'} | ConvertTo-Json -Depth 8)
            $exitCode=2
        } else {
            $checkArguments=@{SettingsPath=$preparedSettings;ReportPath=$reportPath}
            if ($ModelRoot) { $checkArguments.ModelRoot=$ModelRoot }
            & (Join-Path $PSScriptRoot 'check-environment.ps1') @checkArguments
            $exitCode=$LASTEXITCODE
        }
        $instructions=@"
Reuse the existing service at $($settings.baseUrl). No launcher or backend files were changed.
Import JSON in PS-AI Settings and choose ps-ai-settings.json, then Connect for the complete node-template check.
Read model-discovery.json and environment-report.json first. Unresolved roles: $($unresolved -join ', ').
Unresolved settings are a draft: choose exact visible filenames in the panel; alternate architectures require separate validation.
No model was downloaded, inference submitted, task cancelled or service restarted.
Read-only status checks do not establish caller-assigned UUID or atomic cancellation semantics.
"@
        Write-Utf8 (Join-Path $outputPath 'README.txt') $instructions
        Write-Host $instructions
        exit $exitCode
    }
    $backendPath=(Resolve-Path -LiteralPath $ComfyRoot).ProviderPath
    if (-not $ModelRoot) { $ModelRoot=Join-Path $backendPath 'models' }
    $modelPath=(Resolve-Path -LiteralPath $ModelRoot).ProviderPath
    if (-not (Test-Path -LiteralPath (Join-Path $backendPath 'main.py') -PathType Leaf)) { throw 'ComfyRoot must contain an existing ComfyUI main.py.' }
    if (-not $PythonPath) {
        $candidates=@((Join-Path $backendPath '.venv/Scripts/python.exe'),(Join-Path $backendPath 'venv/Scripts/python.exe'),(Join-Path (Split-Path -Parent $backendPath) 'python_embeded/python.exe'),(Join-Path (Split-Path -Parent $backendPath) 'python_embedded/python.exe'))
        $PythonPath=$candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if (-not $PythonPath) { throw 'Existing backend Python not found. Pass -PythonPath with its full executable path; nothing is installed automatically.' }
    }
    $pythonExecutable=(Resolve-Path -LiteralPath $PythonPath).ProviderPath
    if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) { throw 'Select the existing backend Python executable.' }
    $backendQuoted=$backendPath.Replace("'","''");$modelQuoted=$modelPath.Replace("'","''");$pythonQuoted=$pythonExecutable.Replace("'","''")
    $yaml=@"
ps_ai:
  base_path: '$modelQuoted'
  diffusion_models: diffusion_models
  text_encoders: text_encoders
  vae: vae
"@
    $launcher=@'
$ErrorActionPreference='Stop'
try { $null=Invoke-WebRequest -Uri 'http://127.0.0.1:__PORT__/system_stats' -TimeoutSec 2 -UseBasicParsing; Write-Host 'A service already uses port __PORT__. Reuse it and run check-environment.ps1; no second service started.'; exit 0 } catch {}
Set-Location -LiteralPath '__BACKEND__'
& '__PYTHON__' -s main.py --listen 127.0.0.1 --port __PORT__ --extra-model-paths-config (Join-Path $PSScriptRoot 'extra_model_paths.yaml')
exit $LASTEXITCODE
'@
    $launcher=$launcher.Replace('__BACKEND__',$backendQuoted).Replace('__PYTHON__',$pythonQuoted).Replace('__PORT__',[string]$Port)
    $null=New-Item -ItemType Directory -Path $outputPath
    Write-Utf8 (Join-Path $outputPath 'extra_model_paths.yaml') $yaml
    Write-Utf8 (Join-Path $outputPath 'start-comfyui.ps1') $launcher $true
    $settings.baseUrl="http://localhost:$Port"
    Write-Utf8 (Join-Path $outputPath 'ps-ai-settings.json') ($settings | ConvertTo-Json -Depth 12)
    Write-Utf8 (Join-Path $outputPath 'README.txt') 'When the backend is stopped, run start-comfyui.ps1 yourself. Import JSON in PS-AI Settings using ps-ai-settings.json, Scan models and Connect. The generated settings are an unchecked draft; existing custom model names are preserved. Run scripts/check-environment.ps1 with -SettingsPath pointing at this JSON and -ComfyRoot / -ModelRoot for optional source and hash checks. No packages, models or backend files were changed.'
    Write-Host 'Prepared a separate launcher, model search configuration and plugin settings JSON.'
    Write-Host 'No packages installed, weights downloaded, backend files modified or service restarted.'
    Write-Host 'Run check-environment.ps1 before launch. These paths are local; regenerate on another machine.'
    exit 0
} catch { Write-Error $_.Exception.Message -ErrorAction Continue; exit 1 }
