param(
    [Parameter(Mandatory=$true)][string]$PackagePath,
    [string]$InstallerPath,
    [string]$InstalledPluginDirectory,
    [switch]$CheckOnly,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$report = [ordered]@{schemaVersion=1;packageValid=$false;installerFound=$false;installed=$false;checkOnly=[bool]$CheckOnly;association=$null;payloadMatches=$null;detail=''}
function Get-LocalSha256([string]$File) {
    $hash=[System.Security.Cryptography.SHA256]::Create();$fileStream=[System.IO.File]::OpenRead($File)
    try { return ([System.BitConverter]::ToString($hash.ComputeHash($fileStream))).Replace('-','').ToLowerInvariant() } finally { $fileStream.Dispose();$hash.Dispose() }
}
function Finish([int]$Code,[string]$Detail) {
    $report.detail=$Detail
    $json=$report | ConvertTo-Json -Depth 5
    if ($ReportPath) { [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($ReportPath),$json,(New-Object System.Text.UTF8Encoding($false))) }
    Write-Output $json
    exit $Code
}
try {
    $package=(Resolve-Path -LiteralPath $PackagePath).ProviderPath
    if ([System.IO.Path]::GetExtension($package) -ne '.ccx' -or -not (Test-Path -LiteralPath $package -PathType Leaf)) { throw 'Select an existing .ccx file.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[System.IO.Compression.ZipFile]::OpenRead($package)
    try {
        $entry=$archive.GetEntry('manifest.json')
        if (-not $entry -or $entry.Length -gt 131072) { throw 'Missing or oversized manifest.json at archive root.' }
        $reader=New-Object System.IO.StreamReader($entry.Open())
        try { $manifest=$reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        $hosts=@($manifest.host)
        if ($manifest.manifestVersion -ne 5 -or -not $manifest.id -or -not $manifest.version -or $hosts.Count -ne 1 -or $hosts[0].app -ne 'PS' -or -not $manifest.main -or -not $archive.GetEntry($manifest.main) -or -not $archive.GetEntry('main.js')) { throw 'Invalid Photoshop package or missing runtime resources.' }
        $report.pluginId=$manifest.id
        $report.version=$manifest.version
        if ($manifest.id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$' -or $manifest.version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') { throw 'Invalid plugin identity or version.' }
        $runtimeEntry=$archive.GetEntry('main.js')
        if ($runtimeEntry.Length -gt 8388608) { throw 'Runtime main.js exceeds the supported package size.' }
        $runtimeHash=[System.Security.Cryptography.SHA256]::Create();$runtimeStream=$runtimeEntry.Open()
        try { $report.expectedRuntimeSha256=([System.BitConverter]::ToString($runtimeHash.ComputeHash($runtimeStream))).Replace('-','').ToLowerInvariant() } finally { $runtimeStream.Dispose();$runtimeHash.Dispose() }
        $sha=[System.Security.Cryptography.SHA256]::Create()
        $stream=[System.IO.File]::OpenRead($package)
        try { $report.sha256=([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose();$sha.Dispose() }
        $report.packageValid=$true
    } finally { $archive.Dispose() }
} catch { Finish 1 ('Invalid CCX: '+$_.Exception.Message) }
try {
    $progId=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.ccx\UserChoice' -ErrorAction SilentlyContinue).ProgId
    if (-not $progId) { $progId=(Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\.ccx' -ErrorAction SilentlyContinue).'(default)' }
    if ($progId) { $report.association=(Get-ItemProperty -LiteralPath ('Registry::HKEY_CLASSES_ROOT\'+$progId+'\shell\open\command') -ErrorAction SilentlyContinue).'(default)' }
} catch { $report.association=$null }
if ($InstallerPath) { $paths=@($InstallerPath) } else {
    $paths=@($env:CommonProgramFiles,${env:CommonProgramFiles(x86)}) | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe' }
}
$installer=$paths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $installer) { Finish 2 'Adobe UPIA is missing. Install or repair Adobe Creative Cloud Desktop, then run this script again. A CCX must not be opened with Photoshop. https://developer.adobe.com/uxp/guides/how-to/distribution/install/' }
$report.installerFound=$true
if ($CheckOnly) { Finish 0 'Package and Adobe installer found. No installation performed; archive validity alone does not prove Adobe installation acceptance.' }
try {
    $installer=(Resolve-Path -LiteralPath $installer).ProviderPath
    Push-Location -LiteralPath (Split-Path -Parent $installer)
    try { $output=& $installer /install $package 2>&1;$installerExit=$LASTEXITCODE } finally { Pop-Location }
    $report.installerExitCode=$installerExit
    $report.installerOutput=($output | Out-String).Trim()
    $statusMatch=[regex]::Match($report.installerOutput,'(?i)status\s*=\s*(-?\d+)')
    if ($statusMatch.Success) { $report.installerStatus=[int]$statusMatch.Groups[1].Value }
    if ($installerExit -ne 0 -or ($statusMatch.Success -and $report.installerStatus -ne 0) -or $report.installerOutput -match '(?i)\bfailed\b|\berror\b') { Finish 3 'Adobe installer reported failure. Inspect installerOutput and Adobe installation logs; the plugin was not confirmed installed.' }
    if ($report.installerOutput -notmatch '(?i)\bInstallation\s+Successful\b') { Finish 3 'Adobe installer did not confirm installation. Exit code 0 alone does not prove success; inspect installerOutput and the installed plugins list.' }
    if (-not $InstalledPluginDirectory -and $env:CommonProgramFiles) {
        $candidate=Join-Path $env:CommonProgramFiles ('Adobe\UXP\Plugins\External\'+$manifest.id+'_'+$manifest.version)
        $InstalledPluginDirectory=$candidate
    }
    if ($InstalledPluginDirectory) {
        $runtimePath=Join-Path $InstalledPluginDirectory 'main.js'
        if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) { $report.payloadMatches=$false;Finish 3 'Adobe reported success but the installed runtime is missing. Photoshop reinstallation may leave a stale Adobe installation record. Back up plugin settings/history before removing the stale entry with UPIA, then install again. For a custom location, supply InstalledPluginDirectory.' }
        $report.installedRuntimeSha256=Get-LocalSha256 $runtimePath
        $report.payloadMatches=$report.installedRuntimeSha256 -eq $report.expectedRuntimeSha256
        if (-not $report.payloadMatches) { Finish 3 'Adobe reported success but installed main.js differs from the package. Same-version reinstallation may keep the old runtime. Use a higher plugin version; export history/configuration before any manual uninstall.' }
    }
    $report.installed=$true
    Finish 0 'Adobe installer returned success. Check payloadMatches for local runtime verification, then open Photoshop and verify the panel. Generation, updates and removal still require validation.'
} catch { Finish 3 ('Unable to run Adobe installer: '+$_.Exception.Message) }
