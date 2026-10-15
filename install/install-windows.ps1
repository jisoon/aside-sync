# Aside Sync - Windows installer (native messaging host)
# 실행: PowerShell 에서  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
param([string]$ExtId = "dmncckmmjbfdafmjnleocmfogddimkah")
$ErrorActionPreference = "Stop"
$HostName = "com.aside.sync"
$Src = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $env:USERPROFILE ".aside-sync\host"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item (Join-Path $Src "host\aside-sync-host.mjs") $Dest -Force

# Node >= 22.5 (built-in node:sqlite). Prefer Aside bundled runtime.
$cands = @(
  "$env:USERPROFILE\.aside\runtime\bin\node.exe",
  "$env:USERPROFILE\.aside\runtime\node\node.exe",
  (Get-Command node -ErrorAction SilentlyContinue).Source,
  "$env:ProgramFiles\nodejs\node.exe"
) | Where-Object { $_ -and (Test-Path $_) }
$Node = $null
foreach ($c in $cands) {
  & $c -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" 2>$null
  if ($LASTEXITCODE -eq 0) { $Node = $c; break }
}
if (-not $Node) { Write-Error "Node.js 22.5 이상을 찾지 못했습니다. https://nodejs.org 에서 설치 후 다시 실행하세요."; exit 1 }

$Bat = Join-Path $Dest "aside-sync-host.bat"
$batText = "@chcp 65001 >nul`r`n" + "@echo off`r`n`"$Node`" --no-warnings `"%~dp0aside-sync-host.mjs`" %*"
[IO.File]::WriteAllText($Bat, $batText, (New-Object System.Text.UTF8Encoding($false)))

$Manifest = Join-Path $Dest "$HostName.json"
@{ name = $HostName; description = "Aside Sync native host"; path = $Bat; type = "stdio"; allowed_origins = @("chrome-extension://$ExtId/") } |
  ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText($Manifest, $_, (New-Object System.Text.UTF8Encoding($false))) }

foreach ($k in @("HKCU:\Software\Aside\NativeMessagingHosts", "HKCU:\Software\Google\Chrome\NativeMessagingHosts", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts", "HKCU:\Software\Chromium\NativeMessagingHosts", "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts")) {
  $p = Join-Path $k $HostName
  New-Item -Path $p -Force | Out-Null
  Set-ItemProperty -Path $p -Name "(default)" -Value $Manifest
}
Write-Host "완료! node: $Node"
Write-Host "1) chrome://extensions 에서 '개발자 모드' 켜기"
Write-Host "2) '압축해제된 확장 프로그램 로드' -> $Src\extension 선택"
Write-Host "3) 확장 ID가 $ExtId 인지 확인 후, 옵션에서 GitHub 저장소 연결"
