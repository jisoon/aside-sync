# Aside Sync - Windows installer (native messaging host)
# 실행: PowerShell 에서  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
param([string]$ExtId = "dmncckmmjbfdafmjnleocmfogddimkah")
$ErrorActionPreference = "Stop"
$HostName = "com.aside.sync"
$Src = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $env:USERPROFILE ".aside-sync\host"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item (Join-Path $Src "host\aside-sync-host.mjs") $Dest -Force

# Node >= 22.5 (built-in node:sqlite). Prefer Aside's bundled runtime, then the system Node, then a runtime this
# installer downloaded earlier. ASIDE_SYNC_FORCE_RUNTIME=1 skips the first two (testing).
$Rt = Join-Path $env:USERPROFILE ".aside-sync\runtime"
$cands = @("$Rt\node\node.exe")
if ($env:ASIDE_SYNC_FORCE_RUNTIME -ne "1") {
  $cands = @(
    "$env:USERPROFILE\.aside\runtime\bin\node.exe",
    "$env:USERPROFILE\.aside\runtime\node\node.exe",
    (Get-Command node -ErrorAction SilentlyContinue).Source,
    "$env:ProgramFiles\nodejs\node.exe",
    "$Rt\node\node.exe"
  )
}
$cands = $cands | Where-Object { $_ -and (Test-Path $_) }
function Test-NodeOk($exe) {
  & $exe -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" 2>$null
  return ($LASTEXITCODE -eq 0)
}
$Node = $null
foreach ($c in $cands) { if (Test-NodeOk $c) { $Node = $c; break } }

# No usable Node: fetch the official build into ~/.aside-sync/runtime (no admin rights, nothing system-wide).
# The archive is checked against nodejs.org's published SHASUMS256.txt before it is unpacked.
function Get-NodeRuntime {
  $ProgressPreference = "SilentlyContinue" # the progress bar makes Invoke-WebRequest very slow on Windows PowerShell 5.1
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $base = "https://nodejs.org/dist/latest-v22.x"
  Write-Host "Node.js 런타임을 내려받는 중입니다 (처음 한 번, 약 30MB)..."
  $tmp = Join-Path $env:TEMP ("aside-node-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    try { $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content }
    catch { throw "Node.js 체크섬 목록을 받지 못했습니다. 인터넷 연결을 확인하세요. ($($_.Exception.Message))" }
    $line = ($sums -split "`n" | Where-Object { $_ -match "\snode-v[\d.]+-win-$arch\.zip\s*$" } | Select-Object -First 1)
    if (-not $line) { throw "이 PC(win-$arch)용 Node.js 배포본을 찾지 못했습니다." }
    $parts = $line.Trim() -split "\s+"
    $sum = $parts[0].ToLower(); $file = $parts[1]
    $zip = Join-Path $tmp $file
    try { Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $zip }
    catch { throw "Node.js를 내려받지 못했습니다. 인터넷 연결과 디스크 여유 공간을 확인하세요. ($($_.Exception.Message))" }
    $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $sum) { throw "내려받은 Node.js의 체크섬이 공식 값과 다릅니다. 설치를 중단합니다. (받은 값 $got / 공식 값 $sum)" }
    try { Expand-Archive $zip -DestinationPath $tmp -Force }
    catch { throw "Node.js 압축을 풀지 못했습니다. 디스크 여유 공간을 확인하세요. ($($_.Exception.Message))" }
    New-Item -ItemType Directory -Force -Path $Rt | Out-Null
    $dest = Join-Path $Rt "node"
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item (Join-Path $tmp ($file -replace "\.zip$", "")) $dest
    return (Join-Path $dest "node.exe")
  } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not $Node) {
  Write-Host "이 PC에서 Node.js 22.5 이상을 찾지 못해 설치용 Node.js를 준비합니다. (시스템 Node와 PATH는 건드리지 않습니다)"
  try { $Node = Get-NodeRuntime }
  catch { Write-Host "설치에 실패했습니다: $($_.Exception.Message)"; exit 1 }
  if (-not (Test-NodeOk $Node)) { Write-Host "내려받은 Node.js가 실행되지 않습니다."; exit 1 }
}

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
