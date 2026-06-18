# Trek Wanderer — build release APK + install on device
#
# Usage:
#   cd C:\003Trek\trek-main\mobile
#   .\build-android.ps1

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$ADB  = "C:\Users\ortiz\AppData\Local\Android\Sdk\platform-tools\adb.exe"

Write-Host ""
Write-Host "=== Trek Wanderer Android Build ===" -ForegroundColor Cyan

# --- 0. Pull latest code ---
Write-Host "[0/6] Pulling latest code..." -ForegroundColor Cyan
git -C $ROOT pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "  git pull failed - continuing anyway" -ForegroundColor Yellow
}

# --- 1. Install JS dependencies ---
Write-Host "[1/6] Installing JS dependencies..." -ForegroundColor Cyan
Push-Location $ROOT
npm install --prefer-offline
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "npm install failed" -ForegroundColor Red; exit 1 }
Pop-Location

# --- 2. Expo prebuild — links native modules (expo-speech, expo-location, etc.) ---
Write-Host "[2/6] Running expo prebuild..." -ForegroundColor Cyan
Push-Location $ROOT
npx expo prebuild --platform android --clean --no-install
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "expo prebuild failed" -ForegroundColor Red; exit 1 }
Pop-Location
Write-Host "  Native modules linked" -ForegroundColor Green

# --- 3. local.properties (prebuild wipes it) ---
Write-Host "[3/6] Creating local.properties..." -ForegroundColor Cyan
[System.IO.File]::WriteAllText(
    "$ROOT\android\local.properties",
    "sdk.dir=C\:\\Users\\ortiz\\AppData\\Local\\Android\\Sdk`n"
)

# --- 4. Pin Kotlin to 2.0.21 (prebuild may reset it) ---
Write-Host "[4/6] Pinning Kotlin to 2.0.21..." -ForegroundColor Cyan
$buildGradle = "$ROOT\android\build.gradle"
$content = [System.IO.File]::ReadAllText($buildGradle)
$patched = $content -replace 'id "org\.jetbrains\.kotlin\.android" version "[^"]+" apply false',
                              'id "org.jetbrains.kotlin.android" version "2.0.21" apply false'
if ($content -eq $patched) {
    Write-Host "  Already 2.0.21 or pattern not found" -ForegroundColor Yellow
} else {
    [System.IO.File]::WriteAllText($buildGradle, $patched)
    Write-Host "  Kotlin pinned to 2.0.21" -ForegroundColor Green
}

# --- 5. Build release APK ---
Write-Host "[5/6] Building release APK..." -ForegroundColor Cyan
Push-Location "$ROOT\android"
.\gradlew app:assembleRelease --no-daemon --no-build-cache
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "BUILD FAILED" -ForegroundColor Red
    exit 1
}
Pop-Location

# --- 6. Install on device ---
Write-Host "[6/6] Installing on device..." -ForegroundColor Cyan
$apk = "$ROOT\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) {
    Write-Host "APK not found at: $apk" -ForegroundColor Red
    exit 1
}
& $ADB install -r $apk
if ($LASTEXITCODE -ne 0) {
    Write-Host "Install failed. Device connected with USB debugging?" -ForegroundColor Red
    Write-Host "APK saved at: $apk" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Trek Wanderer installed on device." -ForegroundColor Green
