$ErrorActionPreference = 'Stop'
$taskMobile = Split-Path -Parent $PSScriptRoot
$taskSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$taskAdb = Join-Path $taskSdk 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $taskAdb)) { throw 'Install Android SDK platform-tools or set ANDROID_HOME first.' }
$taskDevices = (& $taskAdb devices) -join "`n"
if ($taskDevices -notmatch 'emulator-\d+\s+device') { throw 'Start the Android emulator in Android Studio first.' }
Write-Host 'Waiting for Android to finish booting...'
$taskBootDeadline = (Get-Date).AddMinutes(2)
while ((& $taskAdb -e shell getprop sys.boot_completed) -notmatch '^1$') {
  if ((Get-Date) -gt $taskBootDeadline) { throw 'Android did not finish booting. Wait for its home screen, then retry.' }
  Start-Sleep -Seconds 2
}
# Keep the phone keyboard available when the emulator reports a hardware keyboard.
& $taskAdb -e shell settings put secure show_ime_with_hard_keyboard 1
& $taskAdb -e reverse tcp:11434 tcp:11434
if ($LASTEXITCODE) { throw 'QVAC port forwarding failed.' }
& $taskAdb -e reverse tcp:8082 tcp:8082
if ($LASTEXITCODE) { throw 'Metro port forwarding failed.' }
& $taskAdb -e reverse tcp:3003 tcp:3003
if ($LASTEXITCODE) { throw 'Wallet API port forwarding failed.' }
$env:ANDROID_HOME = $taskSdk
$env:NODE_OPTIONS = ($env:NODE_OPTIONS + ' --dns-result-order=ipv4first').Trim()
$env:EXPO_PUBLIC_QVAC_URL = 'http://127.0.0.1:11434'
$env:EXPO_PUBLIC_QVAC_MODEL = 'wally-llm'
$env:EXPO_PUBLIC_WALLY_API_URL = 'http://127.0.0.1:3003'
Push-Location $taskMobile
try {
  $taskManifest = $null
  try { $taskManifest = Invoke-RestMethod 'http://127.0.0.1:8082' -Headers @{ 'expo-platform'='android'; 'expo-protocol-version'='1' } -TimeoutSec 3 } catch { }
  if ($taskManifest.extra.expoClient._internal.projectRoot -eq $taskMobile) {
    Write-Host 'Reusing the existing Wally development server.'
    & $taskAdb -e shell am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082' -p host.exp.exponent
  } else {
    & npm.cmd start -- --go --localhost --port 8082 --android
  }
} finally { Pop-Location }



