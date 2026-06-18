# Trek Android - build release APK + install on device
#
# ALWAYS run these two commands, in this order:
#   git pull
#   .\build-android.ps1
#
# (git pull updates this script itself before it runs)

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$ADB  = "C:\Users\ortiz\AppData\Local\Android\Sdk\platform-tools\adb.exe"

Write-Host ""
Write-Host "=== Trek Android Build ===" -ForegroundColor Cyan

# --- 0. Pull latest code ---
Write-Host "[0/6] Pulling latest code..." -ForegroundColor Cyan
git -C $ROOT pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "  git pull failed - continuing anyway" -ForegroundColor Yellow
}

# --- 1. local.properties ---
Write-Host "[1/6] Creating local.properties..." -ForegroundColor Cyan
[System.IO.File]::WriteAllText(
    "$ROOT\android\local.properties",
    "sdk.dir=C\:\\Users\\ortiz\\AppData\\Local\\Android\\Sdk`n"
)

# --- 2. Pin Kotlin to 2.0.21 ---
Write-Host "[2/6] Pinning Kotlin to 2.0.21..." -ForegroundColor Cyan
$buildGradle = "$ROOT\android\build.gradle"
$content = [System.IO.File]::ReadAllText($buildGradle)
$patched = $content -replace 'id "org\.jetbrains\.kotlin\.android" version "[^"]+" apply false',
                              'id "org.jetbrains.kotlin.android" version "2.0.21" apply false'
if ($content -eq $patched) {
    Write-Host "  Already 2.0.21 or pattern not found - check android\build.gradle" -ForegroundColor Yellow
} else {
    [System.IO.File]::WriteAllText($buildGradle, $patched)
    Write-Host "  Kotlin pinned to 2.0.21" -ForegroundColor Green
}

# --- 3. Build web frontend + sync to Android ---
Write-Host "[3/6] Building web frontend and syncing to Android..." -ForegroundColor Cyan
Push-Location $ROOT
npm ci --prefer-offline
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "npm ci failed" -ForegroundColor Red
    exit 1
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "vite build failed" -ForegroundColor Red
    exit 1
}
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "cap sync failed" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host "  Web assets synced to android/" -ForegroundColor Green

# --- 4. Wipe app build output to force full rebuild ---
Write-Host "[4/6] Clearing app build output..." -ForegroundColor Cyan
$appBuild = "$ROOT\android\app\build"
if (Test-Path $appBuild) {
    Remove-Item -Recurse -Force $appBuild
    Write-Host "  app\build wiped" -ForegroundColor Green
} else {
    Write-Host "  Nothing to clear" -ForegroundColor Yellow
}

# --- 5. Build ---
Write-Host "[5/6] Building release APK..." -ForegroundColor Cyan
Push-Location "$ROOT\android"
.\gradlew app:assembleRelease --no-daemon --no-build-cache
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "BUILD FAILED" -ForegroundColor Red
    exit 1
}
Pop-Location

# --- 6. Install ---
Write-Host "[6/6] Installing on device..." -ForegroundColor Cyan
$apk = "$ROOT\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) {
    Write-Host "APK not found at: $apk" -ForegroundColor Red
    exit 1
}
& $ADB install -r $apk
if ($LASTEXITCODE -ne 0) {
    Write-Host "Install failed. Is the device connected with USB debugging on?" -ForegroundColor Red
    Write-Host "APK saved at: $apk" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Trek installed on device." -ForegroundColor Green
