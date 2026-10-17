$ErrorActionPreference = 'Stop'
try {
    $relayNode = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $relayMajor = [int]((& $relayNode --version) -replace '^v(\d+).*$', '$1')
    if ($relayMajor -lt 24) { throw 'Node.js 24 or later is required.' }
    $relayEntry = Join-Path $PSScriptRoot 'ps-ai-gateway.mjs'
    Start-Process -FilePath $relayNode -ArgumentList @(('"' + $relayEntry + '"'), '--managed', '--data-dir', ('"' + $PSScriptRoot + '"')) -WindowStyle Hidden
} catch {
    # No credentials, provider response or private request data in startup logs.
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'relay-startup.txt') -Value 'PS-AI relay startup failed. Install Node.js 24+ and restart Photoshop, then check ports 8191-8193.'
    exit 1
}
