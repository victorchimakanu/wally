param([Parameter(Mandatory=$true)][string]$DeviceId, [int]$Seconds = 300)
$ErrorActionPreference = 'Stop'
if ($Seconds -lt 1 -or $Seconds -gt 3600) { throw 'Choose a duration between 1 and 3600 seconds.' }
$taskSdkPath = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$taskAdbPath = Join-Path $taskSdkPath 'platform-tools\adb.exe'
$taskApi = [int](& $taskAdbPath -s $DeviceId shell getprop ro.build.version.sdk)
$taskEmulator = (& $taskAdbPath -s $DeviceId shell getprop ro.kernel.qemu).Trim()
if ($taskApi -lt 31 -or $taskEmulator -eq '1') { throw 'Use a physical Android 12+ device for a QVAC phone benchmark.' }
$taskEvidencePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\internal\evidence'))
New-Item -ItemType Directory -Force -Path $taskEvidencePath | Out-Null
$taskOutputPath = Join-Path $taskEvidencePath ('phone-monitor-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
$taskDeadline = (Get-Date).AddSeconds($Seconds)
Write-Output 'Monitoring the Wally process, battery temperature, charging state, and Android thermal service. Stop with Ctrl+C.'
while ((Get-Date) -lt $taskDeadline) {
  $taskMemory = (& $taskAdbPath -s $DeviceId shell dumpsys meminfo com.wally.frontendpreview) -join "`n"
  $taskBattery = (& $taskAdbPath -s $DeviceId shell dumpsys battery) -join "`n"
  $taskThermal = (& $taskAdbPath -s $DeviceId shell dumpsys thermalservice) -join "`n"
  $taskPssMatch = [regex]::Match($taskMemory, 'TOTAL PSS:\s*(\d+)')
  $taskTempMatch = [regex]::Match($taskBattery, '(?m)^\s*temperature:\s*(\d+)')
  $taskLevelMatch = [regex]::Match($taskBattery, '(?m)^\s*level:\s*(\d+)')
  $taskRow = [ordered]@{
    recordedAt = (Get-Date).ToUniversalTime().ToString('o')
    processPssBytes = if ($taskPssMatch.Success) { [long]$taskPssMatch.Groups[1].Value * 1024 } else { $null }
    batteryTemperatureCelsius = if ($taskTempMatch.Success) { [double]$taskTempMatch.Groups[1].Value / 10 } else { $null }
    batteryPercent = if ($taskLevelMatch.Success) { [int]$taskLevelMatch.Groups[1].Value } else { $null }
    charging = [bool]($taskBattery -match '(?m)^\s*(AC|USB|Wireless) powered: true')
    thermalService = $taskThermal
  }
  $taskRow | ConvertTo-Json -Compress | Add-Content -LiteralPath $taskOutputPath -Encoding UTF8
  Start-Sleep -Seconds 2
}
Write-Output ('Measurements saved: ' + $taskOutputPath)
