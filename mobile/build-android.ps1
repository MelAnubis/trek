# Trek Android - build release APK + install on device
# Run from the mobile\ directory after: git pull && npm install && npx expo prebuild --clean
#
# Usage:  .\build-android.ps1

$ErrorActionPreference = "Stop"
$ROOT  = $PSScriptRoot
$ADB   = "C:\Users\ortiz\AppData\Local\Android\Sdk\platform-tools\adb.exe"

Write-Host ""
Write-Host "=== Trek Android Build ===" -ForegroundColor Cyan

# --- 1. local.properties ---
Write-Host "[1/4] Creating local.properties..." -ForegroundColor Cyan
[System.IO.File]::WriteAllText(
    "$ROOT\android\local.properties",
    "sdk.dir=C\:\\Users\\ortiz\\AppData\\Local\\Android\\Sdk`n"
)

# --- 2. Pin Kotlin to 2.0.21 ---
Write-Host "[2/4] Pinning Kotlin to 2.0.21..." -ForegroundColor Cyan
$buildGradle = "$ROOT\android\build.gradle"
$content = [System.IO.File]::ReadAllText($buildGradle)
$patched = $content -replace 'id "org\.jetbrains\.kotlin\.android" version "[^"]+" apply false',
                              'id "org.jetbrains.kotlin.android" version "2.0.21" apply false'
if ($content -eq $patched) {
    Write-Host "  (Kotlin already 2.0.21 or pattern not found — check android\build.gradle)" -ForegroundColor Yellow
} else {
    [System.IO.File]::WriteAllText($buildGradle, $patched)
    Write-Host "  Kotlin pinned to 2.0.21" -ForegroundColor Green
}

# --- 3. Build ---
Write-Host "[3/4] Building release APK (this takes ~40 min on first run)..." -ForegroundColor Cyan
Push-Location "$ROOT\android"
.\gradlew app:assembleRelease --no-daemon --no-build-cache
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "`nBUILD FAILED" -ForegroundColor Red
    exit 1
}
Pop-Location

# --- 4. Install ---
Write-Host "[4/4] Installing on device..." -ForegroundColor Cyan
$apk = "$ROOT\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) {
    Write-Host "APK not found at: $apk" -ForegroundColor Red
    exit 1
}
& $ADB install -r $apk
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nInstall failed. Is the device connected with USB debugging on?" -ForegroundColor Red
    Write-Host "APK saved at: $apk" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Trek installed successfully on device." -ForegroundColor Green
