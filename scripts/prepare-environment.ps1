param(
    [Parameter(Mandatory=$true)][string]$ComfyRoot,
    [Parameter(Mandatory=$true)][string]$ModelRoot,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$PythonPath,
    [ValidateRange(1,65535)][int]$Port=8188
)
$ErrorActionPreference='Stop'
function Write-Utf8([string]$Path,[string]$Text,[bool]$Bom=$false) { [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($Bom)) }
try {
    $backendPath=(Resolve-Path -LiteralPath $ComfyRoot).ProviderPath
    $modelPath=(Resolve-Path -LiteralPath $ModelRoot).ProviderPath
    if (-not (Test-Path -LiteralPath (Join-Path $backendPath 'main.py') -PathType Leaf)) { throw 'ComfyRoot must contain an existing ComfyUI main.py.' }
    if (-not $PythonPath) { $PythonPath=Join-Path $backendPath '.venv/Scripts/python.exe' }
    $pythonExecutable=(Resolve-Path -LiteralPath $PythonPath).ProviderPath
    if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) { throw 'Select the existing backend Python executable.' }
    $outputPath=[IO.Path]::GetFullPath($OutputDirectory)
    if (Test-Path -LiteralPath $outputPath) { throw 'OutputDirectory already exists. Choose a new directory; existing files are never overwritten.' }
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
    $settings=Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'config/settings.example.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $settings.baseUrl="http://localhost:$Port"
    Write-Utf8 (Join-Path $outputPath 'ps-ai-settings.json') ($settings | ConvertTo-Json -Depth 5)
    Write-Host 'Prepared a separate launcher, model search configuration and plugin settings JSON.'
    Write-Host 'No packages installed, weights downloaded, backend files modified or service restarted.'
    Write-Host 'Run check-environment.ps1 before launch. These paths are local; regenerate on another machine.'
    exit 0
} catch { Write-Error $_.Exception.Message -ErrorAction Continue; exit 1 }
