param(
    [string]$ModelRoot,
    [string]$ComfyRoot,
    [string]$SettingsPath,
    [string]$ReportPath,
    [switch]$Offline,
    [switch]$SkipHash
)
$ErrorActionPreference = 'Stop'
$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [string]$Status, [string]$Detail) {
    $checks.Add([PSCustomObject]@{name=$Name;status=$Status;detail=$Detail})
    Write-Host "[$Status] $Name - $Detail"
}
function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Get-LocalSha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path); $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$preset = Read-Json (Join-Path $repoRoot 'config/compatibility.json')
try {
    if ($SettingsPath) { $settings = Read-Json $SettingsPath } else { $settings = Read-Json (Join-Path $repoRoot 'config/settings.example.json') }
    if ($settings.schemaVersion -ne 1 -or $settings.baseUrl -isnot [string]) { throw 'Unsupported settings version or missing service address.' }
    $address=$settings.baseUrl.Trim()
    $serviceUri=$null
    if ($address -notmatch '^https?://(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?/?$' -or -not [Uri]::TryCreate($address,[UriKind]::Absolute,[ref]$serviceUri) -or $serviceUri.Port -lt 1 -or $serviceUri.Port -gt 65535) { throw 'Use an HTTP(S) origin without credentials, path, query or fragment, e.g. http://localhost:8188.' }
    $builder=[UriBuilder]::new($serviceUri)
    if ($builder.Host -eq '127.0.0.1') { $builder.Host='localhost' }
    $settings.baseUrl=$builder.Uri.GetLeftPart([UriPartial]::Authority)
    foreach ($model in $preset.models) {
        $name = $settings.models.($model.key)
        $extension = if ($model.key -eq 'unet') { '.gguf' } else { '.safetensors' }
        if ($name -isnot [string] -or $name -ne $name.Trim() -or $name -match '^[\\/]|^[A-Za-z]:|[\x00-\x1f]' -or @($name -split '[\\/]' | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0 -or -not $name.ToLowerInvariant().EndsWith($extension)) { throw "Invalid relative model name: $($model.key)" }
    }
    Add-Check 'settings' 'pass' 'Relative model names and HTTP(S) origin are valid.'
} catch { Add-Check 'settings' 'fail' $_.Exception.Message; $settings=$null }
if ($settings) {
    if ($ModelRoot) {
        foreach ($model in $preset.models) {
            $name = $settings.models.($model.key)
            $file = Join-Path (Join-Path $ModelRoot $model.directory) $name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Add-Check "model:$($model.key)" 'fail' "Missing $($model.directory)/$name"; continue }
            if ($name -ne $model.filename) {
                $detail='Custom model: architecture and license require your own validation.'
                if (-not $SkipHash) { $detail += ' SHA256=' + (Get-LocalSha256 $file) }
                Add-Check "model:$($model.key)" 'warn' $detail
                continue
            }
            if ((Get-Item -LiteralPath $file).Length -ne $model.bytes) { Add-Check "model:$($model.key)" 'fail' 'Size differs from tested preset.'; continue }
            if ($SkipHash) { Add-Check "model:$($model.key)" 'warn' 'Size matches; SHA256 deliberately skipped.'; continue }
            $hash = Get-LocalSha256 $file
            if ($hash -ne $model.sha256) { Add-Check "model:$($model.key)" 'fail' 'SHA256 differs from tested preset.' } else { Add-Check "model:$($model.key)" 'pass' 'Size and SHA256 match tested preset.' }
        }
    } else { Add-Check 'model-files' 'warn' 'No ModelRoot supplied; local size and SHA256 not checked.' }
    if ($Offline) { Add-Check 'service' 'warn' 'Offline mode: runtime nodes and model visibility not checked.' }
    else {
        try {
            $stats = Invoke-RestMethod -Uri ($settings.baseUrl + '/system_stats') -TimeoutSec 15
            if ($stats.system.comfyui_version -eq $preset.backend.version) { Add-Check 'backend-version' 'pass' $stats.system.comfyui_version } else { Add-Check 'backend-version' 'warn' "Reported $($stats.system.comfyui_version); tested $($preset.backend.version)." }
            foreach ($node in $preset.nodes) {
                $info = Invoke-RestMethod -Uri ($settings.baseUrl + '/object_info/' + $node) -TimeoutSec 15
                if (-not $info.$node) { Add-Check "node:$node" 'fail' 'Missing required node.'; continue }
                Add-Check "node:$node" 'pass' 'Present.'
                $mapping = switch ($node) { 'UnetLoaderGGUF' { @('unet','unet_name') } 'CLIPLoader' { @('clip','clip_name') } 'VAELoader' { @('vae','vae_name') } }
                if ($mapping) {
                    $files = $info.$node.input.required.($mapping[1])[0]
                    if ($files -contains $settings.models.($mapping[0])) { Add-Check "visible:$($mapping[0])" 'pass' 'Configured filename is visible to loader.' } else { Add-Check "visible:$($mapping[0])" 'fail' 'Configured filename not visible; inspect search paths and restart using your normal procedure.' }
                }
                if ($node -eq 'TextEncodeQwenImage21') {
                    $names = $info.$node.input.required.images[1].template.names
                    if ($names -contains 'image_1' -and $names -contains 'image_3') { Add-Check 'multi-reference' 'pass' 'Required image_1/image_3 fields present.' } else { Add-Check 'multi-reference' 'fail' 'Node schema differs from preset.' }
                }
            }
        } catch { Add-Check 'service' 'fail' $_.Exception.Message }
    }
}
if ($ComfyRoot) {
    try {
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git unavailable; backend source revision not checked.' }
        $revision = & git -C $ComfyRoot rev-parse HEAD 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Not a Git checkout.' }
        if ($revision -eq $preset.backend.commit) { Add-Check 'backend-commit' 'pass' $revision } else { Add-Check 'backend-commit' 'warn' "Different commit: $revision" }
        $server = Get-Content -LiteralPath (Join-Path $ComfyRoot 'server.py') -Raw
        if ($server.Contains('/api/jobs/{job_id}/cancel')) { Add-Check 'cancel-route-source' 'pass' 'ID-specific route present; no requests submitted or cancelled.' } else { Add-Check 'cancel-route-source' 'fail' 'Required ID-specific cancel route absent.' }
        $extensions = @(Get-ChildItem -LiteralPath (Join-Path $ComfyRoot 'custom_nodes') -Directory | Where-Object { $_.Name -match 'GGUF' })
        $found=$false
        foreach ($extension in $extensions) {
            $revision = & git -C $extension.FullName rev-parse HEAD 2>$null
            if ($LASTEXITCODE -eq 0 -and $revision -eq $preset.gguf.commit) { $found=$true }
        }
        if ($found) { Add-Check 'gguf-commit' 'pass' $preset.gguf.commit } else { Add-Check 'gguf-commit' 'warn' 'Tested leejet GGUF commit not identified; do not replace an existing extension automatically.' }
    } catch { Add-Check 'backend-source' 'warn' $_.Exception.Message }
} else { Add-Check 'backend-source' 'warn' 'No ComfyRoot supplied; caller-assigned UUID/cancel contract requires tested source version.' }
$passed = @($checks | Where-Object status -eq 'fail').Count -eq 0
$complete = $passed -and @($checks | Where-Object status -eq 'warn').Count -eq 0
$report = [PSCustomObject]@{schemaVersion=1;preset=$preset.preset;date=[DateTime]::UtcNow.ToString('o');passed=$passed;complete=$complete;checks=@($checks.ToArray());scope='Backend preflight only; not Photoshop/plugin installation acceptance.'}
if ($ReportPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($ReportPath), ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false)) }
if (-not $passed) { exit 1 }
if (-not $complete) { exit 2 }
exit 0
