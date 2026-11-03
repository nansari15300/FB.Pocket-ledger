<#
.SYNOPSIS
  Pocket Ledger - signed Android release build (APK / AAB) - Build Master.

.DESCRIPTION
  Flow:
    Step 1  Key-security pre-check (git-tracked + staged files). Abort on any hit (file names only).
    Step 2  Decrypt the encrypted keystore into %TEMP%\pl-sign-<random> (ACL: current user only).
    Step 3  Hand keystore path + passwords to Gradle ONLY through process environment variables.
    Step 4  gradlew assembleRelease / bundleRelease inside try/finally (finally: secure delete + clear env).
    Step 5  Verify signature, print ONLY signer SHA-256 fingerprint, output paths, versionName/versionCode.
    Step 6  Scan the APK/AAB entry list for .env / keystore / cert files.

  SECURITY: this script never prints, logs or writes any password / keystore content.
  Secrets are read from files outside the repo and live only in this process' environment
  for the duration of the Gradle run (Gradle is run with --no-daemon so no daemon keeps them).

  HOW SIGNING REACHES GRADLE (android\app\build.gradle is NOT edited by this script):
    The current android\app\build.gradle only reads android\keystore.properties (storeFile,
    storePassword, keyAlias, keyPassword) and falls back to the DEBUG key when that file is missing.
    This script does NOT create keystore.properties. Instead it uses the Android Gradle Plugin
    "injected signing" project properties, delivered via ORG_GRADLE_PROJECT_* environment variables:
        ORG_GRADLE_PROJECT_android.injected.signing.store.file
        ORG_GRADLE_PROJECT_android.injected.signing.store.password
        ORG_GRADLE_PROJECT_android.injected.signing.key.alias
        ORG_GRADLE_PROJECT_android.injected.signing.key.password
    AGP applies these to the release variant (this is what Android Studio's "Generate Signed
    Bundle/APK" uses). Step 5 then REFUSES a result signed with the Android Debug certificate.
    It also exports ANDROID_KEYSTORE_PATH / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS /
    ANDROID_KEY_PASSWORD so that a future build.gradle that reads env vars works unchanged.

.PARAMETER EncryptedKeystorePath
  REQUIRED, no default. Encrypted keystore file (Key Manager; not created yet as of 2026-11-03).
.PARAMETER PasswordFilePath
  File holding ONLY the password that DECRYPTS the encrypted keystore file (outside repo).
  Default: C:\PocketLedger-Secrets\keystore-password.txt. It is NOT the keystore store/key password.
.PARAMETER Cipher
  REQUIRED, no default: 'openssl-aes256-pbkdf2' | 'gpg-aes256'. Decided by Key Manager (TBD).
.PARAMETER KeystoreCredsFile
  REQUIRED, no default. Properties file OUTSIDE the repo with the keystore's own credentials:
      storePassword=...
      keyPassword=...
      keyAlias=...        (optional if -KeyAlias is given)
  Source TBD (Key Manager / Password Manager). Values are never printed.
.PARAMETER KeyAlias
  No default. Key alias; required unless keyAlias is present in -KeystoreCredsFile.
.PARAMETER BuildType
  apk | aab | both
.PARAMETER ExpectedCertSha256
  Optional. If given, the signer SHA-256 must match (both PCs must produce the same signature).
.PARAMETER DryRun
  Runs Step 1, checks all signing params, validates the creds file and test-decrypts the keystore; skips Gradle.
  Temp files are always wiped. Without the required params the script stops with a clear message.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-android-signed.ps1 -BuildType both -DryRun `
    -EncryptedKeystorePath <path> -Cipher <cipher> -KeystoreCredsFile <outside-repo file> -KeyAlias <alias>
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-android-signed.ps1 -BuildType apk `
    -EncryptedKeystorePath <path> -Cipher <cipher> -KeystoreCredsFile <file> -ExpectedCertSha256 "AB:CD:..."
#>
[CmdletBinding()]
param(
    [string]$EncryptedKeystorePath = '',
    [string]$PasswordFilePath = 'C:\PocketLedger-Secrets\keystore-password.txt',
    [string]$Cipher = '',
    [string]$KeystoreCredsFile = '',
    [string]$KeyAlias = '',
    [ValidateSet('apk', 'aab', 'both')]
    [string]$BuildType = 'apk',
    [string]$ExpectedCertSha256 = '',
    [string]$OpenSslPath = '',
    [string]$GpgPath = '',
    [int]$Pbkdf2Iterations = 600000,
    # Repo-relative git pathspecs Key Manager has reviewed and allows (e.g. 'google-services.json'). Empty by default.
    [string[]]$AllowPaths = @(),
    [switch]$DryRun
)

Set-StrictMode -Version 2
$script:PrevKeyAlias = $env:ANDROID_KEY_ALIAS
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- paths
$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AndroidDir = Join-Path $RepoRoot 'android'

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn2([string]$m){ Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Write-Bad([string]$m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red }

function Get-RepoRelative([string]$full) {
    $f = [IO.Path]::GetFullPath($full)
    if ($f.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $f.Substring($RepoRoot.Length).TrimStart('\', '/').Replace('\', '/')
    }
    return $null
}

function Read-KeystoreCreds([string]$path) {
    # Parses storePassword / keyPassword / keyAlias from a properties file OUTSIDE the repo. Never prints values.
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "KeystoreCredsFile not found: $path" }
    if (Get-RepoRelative $path) { throw "KeystoreCredsFile must be OUTSIDE the repo: $path" }
    if ([IO.Path]::GetFullPath($path) -ieq [IO.Path]::GetFullPath($PasswordFilePath)) {
        throw 'KeystoreCredsFile must not be the keystore-decryption password file.'
    }
    $h = @{}
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        if ($line -match '^\s*(#|!|$)') { continue }
        $kv = $line -split '=', 2
        if ($kv.Count -eq 2) { $h[$kv[0].Trim()] = $kv[1].TrimEnd("`r", "`n") }
    }
    foreach ($k in 'storePassword', 'keyPassword') {
        if (-not $h.ContainsKey($k) -or [string]::IsNullOrEmpty($h[$k])) { throw "KeystoreCredsFile is missing '$k' (value not shown)." }
    }
    return $h
}

function Assert-SigningConfig {
    $missing = @()
    if (-not $EncryptedKeystorePath) { $missing += '-EncryptedKeystorePath (encrypted keystore not created yet - ask Key Manager)' }
    if (-not $Cipher)                { $missing += '-Cipher (cipher not configured, ask Key Manager)' }
    if (-not $KeystoreCredsFile)     { $missing += '-KeystoreCredsFile (keystore store/key password source TBD - ask Key Manager / Password Manager)' }
    if (-not $PasswordFilePath)      { $missing += '-PasswordFilePath' }
    if ($missing.Count -gt 0) {
        Write-Bad 'Signing is not configured. Missing:'
        $missing | ForEach-Object { Write-Host "         $_" }
        throw 'Stopping: required signing parameters not supplied.'
    }
}

# ---------------------------------------------------------------- Step 1
function Invoke-KeySecurityPreCheck([string]$excludeRel) {
    Write-Step 'Step 1: key-security pre-check (tracked + staged files)'
    Push-Location $RepoRoot
    try {
        $hits = New-Object System.Collections.Generic.List[string]

        # 1a. File-name patterns (index = tracked + staged adds; plus staged names explicitly)
        $names = @(git ls-files) + @(git diff --cached --name-only --diff-filter=ACMR)
        $namePattern = '(?i)(^|/)(\.env[^/]*|keystore\.properties|[^/]+\.(jks|keystore|p12|pfx|pem|key|p8|der|crt|cer))$'
        $allow = '(?i)(\.env\.example|keystore\.properties\.example)$'
        foreach ($n in ($names | Sort-Object -Unique)) {
            if (-not $n) { continue }
            if ($excludeRel -and $n -ieq $excludeRel) { continue }
            if ($AllowPaths -contains $n) { continue }
            if ($n -match $allow) { continue }
            if ($n -match $namePattern) { $hits.Add("name: $n") }
        }

        # 1b. Content patterns in the index (tracked + staged). -l => file names only, never content.
        $contentPatterns = @(
            '^[[:space:]]*(storePassword|keyPassword)[[:space:]]*=',
            '^[[:space:]]*-----BEGIN ([A-Z]+ )?PRIVATE KEY-----[[:space:]]*$',
            'PRIVATE KEY-----(\\r)?(\\n)?[A-Za-z0-9+/]{40,}',
            'gh[pousr]_[A-Za-z0-9]{30,}',
            'github_pat_[A-Za-z0-9_]{30,}',
            '(^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}([^A-Za-z0-9]|$)',
            'xox[abprs]-[A-Za-z0-9-]{10,}',
            'sk-[A-Za-z0-9_-]{32,}',
            'AIza[0-9A-Za-z_-]{35}',
            'glpat-[A-Za-z0-9_-]{20,}',
            '"private_key"[[:space:]]*:'
        )
        # Vendored minified OCR wasm glue (false positives) is excluded from CONTENT scan only.
        $exclude = @(':(exclude)node_modules/**', ':(exclude)package-lock.json', ':(exclude)public/ocr/**')
        foreach ($a in $AllowPaths) { if ($a) { $exclude += ":(exclude)$a" } }
        if ($excludeRel) { $exclude += ":(exclude)$excludeRel" }
        foreach ($p in $contentPatterns) {
            $files = @(git grep --cached -I -l -E -e $p -- . @exclude 2>$null)
            foreach ($f in $files) { if ($f) { $hits.Add("content: $f") } }
        }

        $hits = @($hits | Sort-Object -Unique)
        if ($hits.Count -gt 0) {
            Write-Bad 'Possible secrets in git (file names only):'
            $hits | ForEach-Object { Write-Host "         $_" }
            throw 'Key-security pre-check FAILED. Ask Key Manager to clean these before any build.'
        }
        Write-Ok 'No keystore / .env / cert / token patterns in tracked or staged files.'
    }
    finally { Pop-Location }
}

# ---------------------------------------------------------------- Step 2
function New-PrivateTempDir {
    $rand = [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $dir  = Join-Path $env:TEMP "pl-sign-$rand"
    if (Get-RepoRelative $dir) { throw 'Temp dir resolved inside repo - aborting.' }
    New-Item -ItemType Directory -Path $dir | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $dir /inheritance:r /grant:r "*${sid}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'icacls failed to restrict temp dir ACL.' }
    return $dir
}

function Find-Tool([string]$explicit, [string]$name, [string[]]$fallbacks) {
    if ($explicit -and (Test-Path -LiteralPath $explicit)) { return $explicit }
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in $fallbacks) { if (Test-Path -LiteralPath $p) { return $p } }
    throw "$name not found."
}

# ############################################################################
# DECRYPTION - cipher NOT decided yet (Key Manager). No default; nothing is hardcoded.
# -Cipher values:
#   'openssl-aes256-pbkdf2' : openssl enc -d -aes-256-cbc -pbkdf2 -iter <Pbkdf2Iterations> -pass file:<PasswordFilePath>
#   'gpg-aes256'            : gpg --batch --pinentry-mode loopback --passphrase-file <PasswordFilePath> --decrypt
# Both read the password from the file, so it never appears on a command line or in output.
# If Key Manager picks something else, add a new case here only.
# ############################################################################
function Invoke-DecryptKeystore([string]$encPath, [string]$passFile, [string]$outPath) {
    switch ($Cipher) {
        '' { throw 'cipher not configured, ask Key Manager' }
        'openssl-aes256-pbkdf2' {
            $tool = Find-Tool $OpenSslPath 'openssl' @("$env:ProgramFiles\Git\usr\bin\openssl.exe", "$env:ProgramFiles\Git\mingw64\bin\openssl.exe")
            $a = @('enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', "$Pbkdf2Iterations",
                   '-in', $encPath, '-out', $outPath, '-pass', "file:$passFile")
            & $tool @a 2>$null | Out-Null
        }
        'gpg-aes256' {
            $tool = Find-Tool $GpgPath 'gpg' @("$env:ProgramFiles\Git\usr\bin\gpg.exe", "${env:ProgramFiles(x86)}\GnuPG\bin\gpg.exe", "$env:ProgramFiles\GnuPG\bin\gpg.exe")
            $a = @('--batch', '--yes', '--quiet', '--no-tty', '--pinentry-mode', 'loopback',
                   '--passphrase-file', $passFile, '--output', $outPath, '--decrypt', $encPath)
            & $tool @a 2>$null | Out-Null
        }
        default { throw "Unsupported -Cipher '$Cipher'. Allowed: openssl-aes256-pbkdf2, gpg-aes256 (ask Key Manager)." }
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outPath) -or (Get-Item -LiteralPath $outPath).Length -eq 0) {
        throw "Keystore decryption failed with cipher '$Cipher' (wrong password file, cipher or parameters)."
    }
}

function Remove-SecureDir([string]$dir) {
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return }
    Get-ChildItem -LiteralPath $dir -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $len = $_.Length
            if ($len -gt 0) {
                $buf = New-Object byte[] $len
                [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
                [IO.File]::WriteAllBytes($_.FullName, $buf)
            }
        } catch { }
    }
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $dir) { Write-Warn2 "Could not fully remove temp dir: $dir (delete it manually)" }
    else { Write-Ok 'Temp keystore dir securely wiped.' }
}

# ---------------------------------------------------------------- Step 3 helpers
$SigningEnvNames = @(
    'ORG_GRADLE_PROJECT_android.injected.signing.store.file',
    'ORG_GRADLE_PROJECT_android.injected.signing.store.password',
    'ORG_GRADLE_PROJECT_android.injected.signing.key.alias',
    'ORG_GRADLE_PROJECT_android.injected.signing.key.password',
    'ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS_BUILD', 'ANDROID_KEY_PASSWORD'
)
function Set-SigningEnv([string]$ksPath, [string]$storePw, [string]$alias, [string]$keyPw) {
    $vals = @($ksPath, $storePw, $alias, $keyPw, $ksPath, $storePw, $alias, $keyPw)
    for ($i = 0; $i -lt $SigningEnvNames.Count; $i++) {
        [Environment]::SetEnvironmentVariable($SigningEnvNames[$i], $vals[$i], 'Process')
    }
    # Gradle code may read ANDROID_KEY_ALIAS; keep it consistent for this process only.
    $script:PrevKeyAlias = $env:ANDROID_KEY_ALIAS
    [Environment]::SetEnvironmentVariable('ANDROID_KEY_ALIAS', $alias, 'Process')
}
function Clear-SigningEnv {
    foreach ($n in $SigningEnvNames) { [Environment]::SetEnvironmentVariable($n, $null, 'Process') }
    [Environment]::SetEnvironmentVariable('ANDROID_KEY_ALIAS', $script:PrevKeyAlias, 'Process')
}

# ---------------------------------------------------------------- Step 5 helpers
function Get-AndroidSdkDir {
    foreach ($v in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) { if ($v -and (Test-Path -LiteralPath $v)) { return $v } }
    $lp = Join-Path $AndroidDir 'local.properties'
    if (Test-Path -LiteralPath $lp) {
        $line = Select-String -LiteralPath $lp -Pattern '^\s*sdk\.dir\s*=' | Select-Object -First 1
        if ($line) {
            $d = ($line.Line -split '=', 2)[1].Trim() -replace '\\:', ':' -replace '\\\\', '\'
            if (Test-Path -LiteralPath $d) { return $d }
        }
    }
    $d = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (Test-Path -LiteralPath $d) { return $d }
    return $null
}
function Find-ApkSigner {
    $sdk = Get-AndroidSdkDir
    if (-not $sdk) { return $null }
    $bt = Join-Path $sdk 'build-tools'
    if (-not (Test-Path -LiteralPath $bt)) { return $null }
    $dir = Get-ChildItem -LiteralPath $bt -Directory | Sort-Object { try { [version]($_.Name -replace '[^0-9.].*$', '') } catch { [version]'0.0' } } -Descending | Select-Object -First 1
    if (-not $dir) { return $null }
    $p = Join-Path $dir.FullName 'apksigner.bat'
    if (Test-Path -LiteralPath $p) { return $p } else { return $null }
}
function Find-Keytool {
    if ($env:JAVA_HOME) { $p = Join-Path $env:JAVA_HOME 'bin\keytool.exe'; if (Test-Path -LiteralPath $p) { return $p } }
    $c = Get-Command keytool -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $p = "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe"
    if (Test-Path -LiteralPath $p) { return $p }
    return $null
}
function Get-SignerInfo([string]$file) {
    # Returns @{ Sha256 = 'AA:BB:..'; IsDebug = bool } - only public certificate data.
    $out = $null
    if ($file -like '*.apk') {
        $as = Find-ApkSigner
        if ($as) { $out = & $as verify --print-certs $file 2>&1 | Out-String }
    }
    if (-not $out) {
        $kt = Find-Keytool
        if (-not $kt) { throw 'Neither apksigner nor keytool found (set ANDROID_HOME / JAVA_HOME).' }
        $out = & $kt -printcert -jarfile $file 2>&1 | Out-String
    }
    $sha = $null
    $m = [regex]::Match($out, '(?im)SHA-?256[^:]*:\s*([0-9A-F:]{64,95})')
    if ($m.Success) { $sha = $m.Groups[1].Value.ToUpperInvariant() }
    if ($sha -and $sha -notmatch ':') { $sha = ($sha -split '(..)' | Where-Object { $_ }) -join ':' }
    $isDebug = $out -match 'CN=Android Debug'
    return @{ Sha256 = $sha; IsDebug = $isDebug }
}
function Get-VersionInfo([string]$file) {
    $meta = Join-Path (Split-Path $file -Parent) 'output-metadata.json'
    if (Test-Path -LiteralPath $meta) {
        try {
            $j = Get-Content -LiteralPath $meta -Raw | ConvertFrom-Json
            $e = $j.elements | Select-Object -First 1
            return "versionName=$($e.versionName) versionCode=$($e.versionCode)"
        } catch { }
    }
    $g = Get-Content -LiteralPath (Join-Path $AndroidDir 'app\build.gradle') -Raw
    $vn = [regex]::Match($g, 'versionName\s+"([^"]+)"').Groups[1].Value
    $vc = [regex]::Match($g, 'versionCode\s+(\d+)').Groups[1].Value
    return "versionName=$vn versionCode=$vc (from build.gradle)"
}

# ---------------------------------------------------------------- Step 6
function Test-PackageContents([string]$file) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($file)
    try {
        $bad = @($zip.Entries | Where-Object {
            $_.FullName -match '(?i)(^|/)(\.env[^/]*|keystore\.properties|google-services\.json|[^/]+\.(jks|keystore|p12|pfx|pem|key|enc))$'
        } | ForEach-Object { $_.FullName })
        if ($bad.Count -gt 0) {
            Write-Warn2 "$([IO.Path]::GetFileName($file)) contains sensitive-looking entries:"
            $bad | ForEach-Object { Write-Host "         $_" }
        } else { Write-Ok "$([IO.Path]::GetFileName($file)): no .env / keystore / cert entries." }
    } finally { $zip.Dispose() }
}

# ================================================================ main
$tempDir = $null
$exitCode = 0
try {
    Write-Host "Pocket Ledger signed Android build | repo: $RepoRoot | BuildType=$BuildType | DryRun=$($DryRun.IsPresent)"

    $encRel = $null
    if ($EncryptedKeystorePath) { $encRel = Get-RepoRelative $EncryptedKeystorePath }
    Invoke-KeySecurityPreCheck $encRel
    Assert-SigningConfig

    if (Test-Path -LiteralPath (Join-Path $AndroidDir 'keystore.properties')) {
        Write-Warn2 'android\keystore.properties exists locally. Injected signing overrides it, but Key Manager should remove it.'
    }

    Write-Step 'Step 2: decrypt keystore to private temp dir'
    if (-not (Test-Path -LiteralPath $EncryptedKeystorePath -PathType Leaf)) { throw "Encrypted keystore not found: $EncryptedKeystorePath" }
    if (-not (Test-Path -LiteralPath $PasswordFilePath -PathType Leaf)) { throw "Decryption password file not found: $PasswordFilePath" }
    if (Get-RepoRelative $PasswordFilePath) { throw 'Decryption password file must be OUTSIDE the repo.' }
    # Validate the keystore credentials source up front (values never printed).
    $creds = Read-KeystoreCreds $KeystoreCredsFile
    $alias = $KeyAlias
    if (-not $alias -and $creds.ContainsKey('keyAlias')) { $alias = $creds['keyAlias'] }
    if (-not $alias) { throw 'Key alias not supplied: pass -KeyAlias or put keyAlias in -KeystoreCredsFile (ask Key Manager).' }
    $tempDir = New-PrivateTempDir
    $ksPath  = Join-Path $tempDir 'release.keystore'
    Invoke-DecryptKeystore $EncryptedKeystorePath $PasswordFilePath $ksPath
    Write-Ok "Keystore decrypted to private temp dir: $tempDir"

    if ($DryRun) {
        Write-Step 'DryRun: skipping Steps 3-6 (no Gradle run)'
    }
    else {
        Write-Step 'Step 3: signing values -> process environment only'
        Set-SigningEnv $ksPath $creds['storePassword'] $alias $creds['keyPassword']
        Write-Ok "Env set (names only): $($SigningEnvNames -join ', ')"

        Write-Step 'Step 4: Gradle release build'
        $tasks = switch ($BuildType) { 'apk' { @('assembleRelease') } 'aab' { @('bundleRelease') } 'both' { @('assembleRelease', 'bundleRelease') } }
        $buildStart = Get-Date
        Push-Location $AndroidDir
        try {
            & .\gradlew.bat --no-daemon @tasks
            if ($LASTEXITCODE -ne 0) { throw "Gradle failed (exit $LASTEXITCODE)." }
        } finally { Pop-Location }
        Clear-SigningEnv

        Write-Step 'Step 5: verify signature'
        $outputs = @()
        if ($BuildType -in 'apk', 'both') { $outputs += @(Get-ChildItem (Join-Path $AndroidDir 'app\build\outputs\apk\release') -Filter *.apk -ErrorAction SilentlyContinue) }
        if ($BuildType -in 'aab', 'both') { $outputs += @(Get-ChildItem (Join-Path $AndroidDir 'app\build\outputs\bundle\release') -Filter *.aab -ErrorAction SilentlyContinue) }
        $outputs = @($outputs | Where-Object { $_.LastWriteTime -ge $buildStart.AddMinutes(-1) })
        if ($outputs.Count -eq 0) { throw 'No fresh release output found.' }
        foreach ($o in $outputs) {
            $info = Get-SignerInfo $o.FullName
            Write-Host "  Output : $($o.FullName)"
            Write-Host "  Version: $(Get-VersionInfo $o.FullName)"
            Write-Host "  Signer SHA-256: $($info.Sha256)"
            if ($info.IsDebug) { $exitCode = 2; Write-Bad 'Signed with the ANDROID DEBUG key - injected signing did not apply!' }
            if ($ExpectedCertSha256 -and $info.Sha256 -ne $ExpectedCertSha256.ToUpperInvariant()) {
                $exitCode = 3; Write-Bad 'Signer fingerprint does NOT match -ExpectedCertSha256.'
            }
        }

        Write-Step 'Step 6: scan package contents'
        foreach ($o in $outputs) { Test-PackageContents $o.FullName }
    }
}
catch {
    $exitCode = 1
    $creds = $null
    Write-Bad $_.Exception.Message
}
finally {
    $creds = $null
    Clear-SigningEnv
    Remove-SecureDir $tempDir
}
exit $exitCode
