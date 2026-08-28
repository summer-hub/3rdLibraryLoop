<#
.SYNOPSIS
    Run devecocli build with timeout and daemon cleanup.
.DESCRIPTION
    Use .NET Process class to avoid PS 5.1 Start-Process limitations.
    Redirect via cmd.exe built-in redirection (> file 2>&1), daemon inherits
    FILE handles from cmd.exe (not pipe handles), WaitForExit only waits cmd.exe.
    On timeout or build failure, force-kills the process tree and sweeps
    residual hvigor node/java daemons so pipes are released.
#>
param([string]$Cmd, [switch]$JavaHome)

$DevEco = "D:\software\ide\DevEco Studio"  # fallback
try {
    $hdcPath = (cmd /c "where.exe hdc 2>nul" 2>&1) -split "`r`n" | Select-Object -First 1
    if ($hdcPath) {
        $hdcPath = $hdcPath.Trim()
        $idx = $hdcPath.IndexOf('\sdk')
        if ($idx -gt 0) { $DevEco = $hdcPath.Substring(0, $idx) }
    }
} catch {}

# Auto-set JAVA_HOME for test HAP builds
if ($JavaHome) {
    $Cmd = "set JAVA_HOME=$DevEco\jbr && set PATH=%JAVA_HOME%\bin;%PATH% && $Cmd"
}

$TimeoutMs = 300000
$ErrorActionPreference = "Continue"

Write-Host "[build.ps1] DevEco:  $DevEco"
Write-Host "[build.ps1] Cmd:     $Cmd"
Write-Host "[build.ps1] Timeout: $($TimeoutMs/1000)s"

# Write command to temp .cmd file
$guid = [System.Guid]::NewGuid().ToString("N")
$cmdFile = "$env:TEMP\devecocli_cmd_$guid.cmd"
$logFile = "$env:TEMP\devecocli_log_$guid.log"
Set-Content -Path $cmdFile -Value "@echo off`r`n$Cmd > `"$logFile`" 2>&1"

# Use .NET Process class (avoids PS 5.1 Start-Process -NoNewWindow + Redirect conflict)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c `"$cmdFile`""
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
# Don't set RedirectStandardOutput/RedirectStandardError - cmd.exe handles redirection internally
$proc = [System.Diagnostics.Process]::Start($psi)

# Wait for cmd.exe only (daemon stays alive with FILE handles, not pipe handles)
$finished = $proc.WaitForExit($TimeoutMs)

if (-not $finished) {
    Write-Host "[build.ps1] TIMEOUT after $($TimeoutMs/1000)s"
    $proc.Kill()
    taskkill /PID $proc.Id /T /F 2>$null | Out-Null
    $exitCode = 1
} else {
    $exitCode = $proc.ExitCode
}

# Output build results from file
if (Test-Path $logFile) {
    Get-Content $logFile
}
Write-Host ""

# Daemon cleanup (prevents session blocking via inherited handles)
Write-Host "[build.ps1] Stopping daemon..."
& "$DevEco\tools\node\node.exe" "$DevEco\tools\hvigor\bin\hvigorw.js" --stop-daemon *>$null

# Residual daemon force-kill fallback on failure (success path keeps graceful stop only)
if ($exitCode -ne 0) {
    Write-Host "[build.ps1] Build failed - sweeping residual hvigor daemons..."
    $residual = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.Name -eq 'node.exe' -or $_.Name -eq 'java.exe') -and
            $_.CommandLine -and
            $_.CommandLine -match 'hvigor' -and
            $_.CommandLine -match [regex]::Escape($DevEco) -and
            $_.CommandLine -notmatch '--stop-daemon'
        }
    foreach ($p in $residual) {
        Write-Host "[build.ps1] Force-kill residual daemon PID $($p.ProcessId)"
        taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
    }
}

# Cleanup temp files
Remove-Item $logFile, $cmdFile -Force -ErrorAction SilentlyContinue

Write-Host "[build.ps1] DONE exit=$exitCode"
[Environment]::Exit($exitCode)
