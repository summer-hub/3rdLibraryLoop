<#
.SYNOPSIS
    One-line installer for 3rdloop (Windows).

.DESCRIPTION
    This project ships TWO npm packages: @ohos-cpf/3rdloop_core (the core tree) and
    @ohos-cpf/3rdloop (the CLI). The CLI declares a version dependency on the core package,
    and the core package is NOT published on the public npm registry. Installing only the
    CLI tarball therefore makes npm look for @ohos-cpf/3rdloop_core on the registry and fail
    with E404. Both tarballs must be installed together.

    This script downloads both tarballs from the project Release, verifies them against
    SHA256SUMS, installs them in one npm call, and finally runs "3rdloop version" to prove
    the result works.

    The file is intentionally ASCII-only: Windows PowerShell 5.1 reads a BOM-less UTF-8
    script as ANSI, which mangles non-ASCII text and can break parsing.

.PARAMETER Tag
    Release tag, e.g. v0.0.14. Defaults to the latest release.

.PARAMETER Prefix
    Install into this prefix (npm i -g --prefix <dir>). The bin shim then lives under that
    prefix and is not on PATH; useful for side-by-side versions or tests.

.PARAMETER FromDir
    Offline / local mode: use tarballs and SHA256SUMS already present in this directory
    instead of downloading (e.g. -FromDir .\dist after npm run release:pack).

.PARAMETER Repo
    owner/repo, default summor/3rdLibraryLoop.

.PARAMETER Api
    Release API base, default https://api.gitcode.com/api/v5. For GitHub use
    https://api.github.com (download base is derived from it).

.PARAMETER DownloadBase
    Explicit download base URL, overrides the value derived from -Api and -Repo.

.EXAMPLE
    irm https://raw.githubusercontent.com/summor/3rdLibraryLoop/master/scripts/install.ps1 | iex

.EXAMPLE
    .\scripts\install.ps1 -Tag v0.0.14 -Prefix C:\tools\3rdloop

.EXAMPLE
    .\scripts\install.ps1 -FromDir .\dist -Prefix $env:TEMP\3l-probe
#>
[CmdletBinding()]
param(
    [string]$Tag = '',
    [string]$Prefix = '',
    [string]$FromDir = '',
    [string]$Repo = 'summor/3rdLibraryLoop',
    [string]$Api = 'https://api.gitcode.com/api/v5',
    [string]$DownloadBase = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Info($m) { Write-Host "[3l-install] $m" }
function Fail($m) { Write-Host "[3l-install] FAILED: $m" -ForegroundColor Red; exit 1 }

function Invoke-Download($url, $out) {
    try {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 180
    } catch {
        $why = $_.Exception.Message.Split([char]10)[0]
        Fail "download failed: $url`n        $why"
    }
}

# Parse "sha256  name" lines into a hashtable. Shared by offline and online modes:
# an earlier version only filled it on the download path and crashed on -FromDir.
function Read-Sums($file) {
    $map = @{}
    if (-not (Test-Path $file)) { Fail "missing SHA256SUMS: $file" }
    foreach ($line in Get-Content $file) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
            $map[($Matches[2].Trim())] = $Matches[1].ToLower()
        }
    }
    if ($map.Count -eq 0) { Fail "unsupported SHA256SUMS format: $file" }
    return $map
}

# --- 0. preconditions -------------------------------------------------------
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeExe) { Fail 'node not found. Install Node.js >= 22 from https://nodejs.org/ first.' }
$npmExe = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmExe) { Fail 'npm not found. Install Node.js >= 22 from https://nodejs.org/ first.' }
Info ("Node.js " + (& node --version).Trim())

$work = Join-Path $env:TEMP ('3l-install-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null

try {
    # --- 1. collect the two tarballs plus SHA256SUMS ------------------------
    if ($FromDir) {
        $src = (Resolve-Path $FromDir).Path
        Info "offline mode: $src"
        $sumsFile = Join-Path $src 'SHA256SUMS'
        if (-not (Test-Path $sumsFile)) { Fail "missing $sumsFile (run: npm run release:pack)" }

        # dist/ accumulates versions; pick the one matching -Tag, else the highest version
        $want = ''
        if ($Tag) { $want = $Tag -replace '^v', '' }
        function Select-Tarball($pattern, $excludeCore) {
            $cand = @(Get-ChildItem -Path $src -Filter $pattern)
            if ($excludeCore) { $cand = @($cand | Where-Object { $_.Name -notmatch '_core' }) }
            if ($want) { $cand = @($cand | Where-Object { $_.Name -like "*$want.tgz" }) }
            return @($cand | Sort-Object Name -Descending | Select-Object -First 1)
        }
        $core = (Select-Tarball '*3rdloop_core-*.tgz' $false)[0]
        $cli = (Select-Tarball '*3rdloop-*.tgz' $true)[0]
        if (-not $core -or -not $cli) { Fail "no matching tarballs in $src (tag=$Tag)" }
        Info ("using " + $core.Name + " + " + $cli.Name)
        Copy-Item $core.FullName, $cli.FullName, $sumsFile -Destination $work -Force
        $sums = Read-Sums $sumsFile
        if (-not $Tag) { $Tag = 'local build' }
    } else {
        if (-not $Tag) {
            Info "resolving latest release ($Repo)"
            try {
                $rel = Invoke-RestMethod -Uri "$Api/repos/$Repo/releases/latest" `
                    -Headers @{ 'User-Agent' = '3rdloop-install' } -TimeoutSec 60
                $Tag = $rel.tag_name
            } catch {
                $why = $_.Exception.Message.Split([char]10)[0]
                Fail "cannot resolve latest release from $Api. Pass -Tag explicitly, e.g. -Tag v0.0.14`n        $why"
            }
            if (-not $Tag) { Fail 'latest release response has no tag_name' }
        }
        Info "target version: $Tag"

        if (-not $DownloadBase) {
            $hostName = ([uri]$Api).Host -replace '^api\.', ''
            $DownloadBase = "https://$hostName/$Repo/releases/download/$Tag"
        }
        Info "download base: $DownloadBase"

        $sumsFile = Join-Path $work 'SHA256SUMS'
        Invoke-Download "$DownloadBase/SHA256SUMS" $sumsFile

        $sums = Read-Sums $sumsFile

        foreach ($name in @($sums.Keys)) {
            if ($name -notlike '*.tgz') { continue }
            Info "downloading $name"
            Invoke-Download "$DownloadBase/$name" (Join-Path $work $name)
        }
        $core = @(Get-ChildItem -Path $work -Filter '*3rdloop_core-*.tgz')[0]
        $cli = @(Get-ChildItem -Path $work -Filter '*3rdloop-*.tgz' | Where-Object { $_.Name -notmatch '_core' })[0]
        if (-not $core -or -not $cli) { Fail 'release is incomplete: core or CLI tarball missing from its assets' }
    }

    # --- 2. verify SHA256 before installing ---------------------------------
    Info 'verifying SHA256'
    foreach ($f in @($core, $cli)) {
        $hash = (Get-FileHash -Algorithm SHA256 $f.FullName).Hash.ToLower()
        if (-not $sums.ContainsKey($f.Name)) { Fail "SHA256SUMS has no entry for $($f.Name)" }
        if ($hash -ne $sums[$f.Name]) {
            Fail "$($f.Name) checksum mismatch`n        expected $($sums[$f.Name])`n        actual   $hash"
        }
        Info ("  ok " + $f.Name)
    }

    # --- 3. install both tarballs in ONE npm call ---------------------------
    $npmArgs = @('install', '-g', $core.FullName, $cli.FullName, '--no-audit', '--no-fund')
    if ($Prefix) { $npmArgs += @('--prefix', $Prefix) }
    Info ("npm " + ($npmArgs -join ' '))
    & npm @npmArgs
    if ($LASTEXITCODE -ne 0) { Fail "npm install exited with $LASTEXITCODE" }

    # --- 4. prove it runs ---------------------------------------------------
    Info 'verifying: 3rdloop version'
    if ($Prefix) {
        $cands = @(
            (Join-Path $Prefix '3rdloop.cmd'),
            (Join-Path $Prefix 'bin\3rdloop'),
            (Join-Path $Prefix '3rdloop.ps1')
        )
        $bin = $null
        foreach ($c in $cands) { if ((Test-Path $c) -and -not $bin) { $bin = $c } }
        if (-not $bin) {
            $found = @(Get-ChildItem -Path $Prefix -Recurse -Depth 2 -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^3rdloop(\.cmd|\.ps1)?$' })
            if ($found.Count -gt 0) { $bin = $found[0].FullName }
        }
        if (-not $bin) { Fail "no 3rdloop entry point found under $Prefix" }
        & $bin version
        $code = $LASTEXITCODE
    } else {
        & 3rdloop version
        $code = $LASTEXITCODE
    }
    if ($code -ne 0) { Fail "3rdloop version exited with $code" }

    Info ''
    Info "installed $Tag"
    if ($Prefix) { Info "  $Prefix is not on PATH; call $Prefix\3rdloop.cmd directly or add it to PATH" }
    Info '  next: 3rdloop doctor    (environment check)'
    Info '        3rdloop serve     (backend + web frontend + extensions)'
    Info '  upgrade: 3rdloop update --from-release --yes'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
