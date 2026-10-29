<#
  Pocket Ledger - production deploy for this PC (Windows PowerShell 5.1).

  Flow: fetch origin/main into D:\PocketLedger-Prod\app -> copy into a new
  release folder -> npm ci -> npm run build -> (only if build OK) stop service,
  point D:\PocketLedger-Prod\current at the new release, start service,
  health-check http://127.0.0.1:3002/app/ -> roll back automatically if unhealthy.

  A failed build never touches the running release (old build keeps serving).
  PocketBase (:8090) and the dev servers (:3000/:3001) are never touched.

  Normally run by the GitHub Actions self-hosted runner (as LocalSystem).
  Manual run: elevated PowerShell ->  D:\PocketLedger-Prod\deploy.ps1
  Copy of this file in the repo: scripts/deploy/deploy-pc.ps1 (the D:\ copy is the one executed).
#>
param(
    [string]$Sha = $env:GITHUB_SHA,   # commit to deploy (must be on origin/main); empty = origin/main tip
    [switch]$BuildOnly,               # build a release but do not switch/restart
    [switch]$AllowNoEnv,              # allow build without app\.env.local (smoke test only)
    [int]$KeepReleases = 3
)

$ErrorActionPreference = 'Stop'
$Root      = 'D:\PocketLedger-Prod'
$Src       = Join-Path $Root 'app'
$Releases  = Join-Path $Root 'releases'
$Current   = Join-Path $Root 'current'
$Logs      = Join-Path $Root 'logs'
$Service   = 'PocketLedgerWeb'
$HealthUrl = 'http://127.0.0.1:3002/app/'

# Tools (absolute, so it also works for LocalSystem whose PATH/profile differ)
$env:Path = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;' + $env:Path
$env:npm_config_cache = Join-Path $Root 'npm-cache'
$env:NEXT_TELEMETRY_DISABLED = '1'
if (Test-Path Env:NODE_ENV) { Remove-Item Env:NODE_ENV }   # npm ci must install devDependencies

New-Item -ItemType Directory -Force $Logs, $Releases | Out-Null
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogFile = Join-Path $Logs "deploy-$stamp.log"

function Log([string]$m) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}
function Run([string]$exe, [string[]]$argv, [string]$cwd = $null) {
    Log ("> $exe " + ($argv -join ' '))
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if ($cwd) { Push-Location $cwd }
    try {
        & $exe @argv 2>&1 | ForEach-Object { $s = "$_"; Write-Host "  $s"; Add-Content -Path $LogFile -Value "  $s" }
        $code = $LASTEXITCODE
    } finally {
        if ($cwd) { Pop-Location }
        $ErrorActionPreference = $old
    }
    if ($code -ne 0) { throw "$exe exited with code $code" }
}
function Invoke-Git([string[]]$argv) { Run 'git' (@('-c', 'safe.directory=*', '-C', $Src) + $argv) }
function Remove-Dir([string]$p) { if (Test-Path $p) { cmd /c rmdir /s /q "`"$p`"" | Out-Null } }
function Get-JunctionTarget([string]$p) {
    if (-not (Test-Path $p)) { return $null }
    $t = (Get-Item $p -Force).Target
    if ($t -is [array]) { $t = $t[0] }
    return $t
}
function Set-Junction([string]$target) {
    if (Test-Path $Current) { cmd /c rmdir "`"$Current`"" | Out-Null }   # removes the link only
    cmd /c mklink /J "`"$Current`"" "`"$target`"" | Out-Null
    if ((Get-JunctionTarget $Current) -ne $target) { throw "junction switch to $target failed" }
    Log "current -> $target"
}
function Test-Healthy([int]$seconds = 120) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 15 -MaximumRedirection 0
            Log "health: HTTP $($r.StatusCode)"; return $true
        } catch {
            $resp = $_.Exception.Response
            if ($resp -and [int]$resp.StatusCode -lt 500) { Log "health: HTTP $([int]$resp.StatusCode)"; return $true }
        }
        Start-Sleep -Seconds 3
    }
    return $false
}

# --- single deploy at a time (in addition to the workflow concurrency group)
$lockPath = Join-Path $Root 'deploy.lock'
try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Write-Host 'Another deploy is running (deploy.lock busy). Exiting.'; exit 1 }

$exitCode = 0
$relDir = $null
try {
    Log "deploy start (user $([Environment]::UserName), requested sha '$Sha')"

    # 1) sync production checkout (user's working copy in C:\Balgram is never used)
    Invoke-Git @('fetch', '--prune', 'origin', 'main')
    $target = 'origin/main'
    if ($Sha) {
        Invoke-Git @('cat-file', '-e', "$Sha^{commit}")
        Invoke-Git @('merge-base', '--is-ancestor', $Sha, 'origin/main')   # refuse commits not on main
        $target = $Sha
    }
    Invoke-Git @('reset', '--hard', $target)
    $rev = (& git -c safe.directory=* -C $Src rev-parse HEAD).Trim()
    $short = $rev.Substring(0, 7)
    Log "source at $rev"

    $envFile = Join-Path $Src '.env.local'
    if (-not (Test-Path $envFile)) {
        if ($AllowNoEnv) { Log 'WARNING: app\.env.local missing - NEXT_PUBLIC_* values will be empty in this build.' }
        else { throw "Missing $envFile (production env). Place it there, then re-run." }
    }

    # 2) new release folder (copy of source incl. .env.local, without .git/node_modules/.next)
    $relDir = Join-Path $Releases "$stamp-$short"
    Log "release dir $relDir"
    & robocopy $Src $relDir /E /XD .git node_modules .next /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
    Set-Content -Path (Join-Path $relDir 'REVISION') -Value $rev -Encoding ASCII

    # 3) install + build (normal server build: next build --webpack, NOT build:static)
    Run 'npm.cmd' @('ci', '--no-audit', '--no-fund') $relDir
    Run 'npm.cmd' @('run', 'build') $relDir
    if (-not (Test-Path (Join-Path $relDir '.next\BUILD_ID'))) { throw 'build finished but .next\BUILD_ID is missing' }
    Log 'build OK'

    if ($BuildOnly) { Log 'BuildOnly: not switching release.'; return }

    # 4) switch + restart (built-in service cmdlets; nssm.exe CLI needs a console, the runner has none)
    $prev = Get-JunctionTarget $Current
    $svc = Get-Service -Name $Service -ErrorAction SilentlyContinue
    if (-not $svc) {
        Set-Junction $relDir
        Log "Service $Service not installed yet - switched 'current' only (run install-service-admin.ps1)."
    } else {
        if ($svc.Status -ne 'Stopped') { Log "stopping $Service"; Stop-Service -Name $Service -Force; (Get-Service $Service).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60)) }
        Set-Junction $relDir
        Log "starting $Service"; Start-Service -Name $Service
        if (Test-Healthy) { Log "deployed $short OK" }
        else {
            Log "HEALTH CHECK FAILED for $short"
            if ($prev -and (Test-Path $prev)) {
                Log "rolling back to $prev"
                Stop-Service -Name $Service -Force -ErrorAction SilentlyContinue
                Set-Junction $prev
                Start-Service -Name $Service
                if (Test-Healthy 90) { Log 'rollback healthy' } else { Log 'rollback ALSO unhealthy - check logs\service-*.log' }
            }
            throw 'deploy failed health check (rolled back if possible)'
        }
    }

    # 5) prune old releases (keep newest N + whatever is current)
    $keep = @(Get-JunctionTarget $Current)
    Get-ChildItem $Releases -Directory | Sort-Object Name -Descending | Select-Object -Skip $KeepReleases |
        Where-Object { $keep -notcontains $_.FullName } | ForEach-Object { Log "prune $($_.Name)"; Remove-Dir $_.FullName }
    Get-ChildItem $Logs -Filter 'deploy-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
}
catch {
    Log "DEPLOY FAILED: $($_.Exception.Message)"
    if ($relDir -and (Test-Path $relDir) -and ((Get-JunctionTarget $Current) -ne $relDir)) {
        Log "removing failed release $relDir (running release untouched)"
        Remove-Dir $relDir
    }
    $exitCode = 1
}
finally {
    $lock.Close()
    Log "deploy end (exit $exitCode). Log: $LogFile"
}
exit $exitCode
