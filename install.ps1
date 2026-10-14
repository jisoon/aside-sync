# Aside Sync one-line installer (Windows PowerShell)
#   irm https://raw.githubusercontent.com/jisoon/aside-sync/main/install.ps1 | iex
# Re-run the same command to update.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Repo = if ($env:ASIDE_SYNC_REPO) { $env:ASIDE_SYNC_REPO } else { "jisoon/aside-sync" }
$Branch = if ($env:ASIDE_SYNC_BRANCH) { $env:ASIDE_SYNC_BRANCH } else { "main" }
$App = Join-Path $env:USERPROFILE ".aside-sync\app"
$Tmp = Join-Path $env:TEMP ("aside-sync-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

Write-Host "==> Aside Sync 다운로드 ($Repo@$Branch)"
$Zip = Join-Path $Tmp "src.zip"
Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $Zip
Expand-Archive $Zip -DestinationPath $Tmp -Force
$Src = Get-ChildItem $Tmp -Directory | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $App | Out-Null
foreach ($d in "extension", "host", "install") { Remove-Item (Join-Path $App $d) -Recurse -Force -ErrorAction SilentlyContinue }
foreach ($d in "extension", "host", "install", "README.md") { Copy-Item (Join-Path $Src.FullName $d) $App -Recurse -Force }
Remove-Item $Tmp -Recurse -Force

Write-Host "==> 네이티브 호스트 등록"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $App "install\install-windows.ps1")
if ($LASTEXITCODE -ne 0) { throw "네이티브 호스트 등록 실패" }

$Bat = Join-Path $env:USERPROFILE ".aside-sync\host\aside-sync-host.bat"
$Node = ((Get-Content $Bat | Select-String '"([^"]+node[^"]*)"').Matches[0].Groups[1].Value)
$HostJs = Join-Path $env:USERPROFILE ".aside-sync\host\aside-sync-host.mjs"

$status = & $Node --no-warnings $HostJs status | Out-String | ConvertFrom-Json
if (-not $status.config.syncDir) {
  $det = & $Node --no-warnings $HostJs detect | Out-String | ConvertFrom-Json
  $cands = @($det.cloudFolders)
  if ($cands.Count -gt 0) {
    Write-Host ""
    Write-Host "동기화 폴더를 선택하세요 (모든 PC에서 같은 클라우드를 골라야 합니다):"
    for ($i = 0; $i -lt $cands.Count; $i++) { Write-Host ("  {0}) {1}  -> {2}" -f ($i + 1), $cands[$i].label, $cands[$i].path) }
    Write-Host "  0) 나중에 확장 옵션에서 직접 지정"
    $n = Read-Host "번호 [1]"
    if (-not $n) { $n = "1" }
    if ($n -ne "0" -and [int]$n -ge 1 -and [int]$n -le $cands.Count) {
      $chosen = $cands[[int]$n - 1].path
      & $Node --no-warnings $HostJs config ("syncDir=" + (ConvertTo-Json $chosen)) | Out-Null
      Write-Host "==> 동기화 폴더: $chosen"
    }
  }
} else { Write-Host "==> 기존 동기화 폴더 유지: $($status.config.syncDir)" }

Write-Host ""
Write-Host "설치 완료. 마지막으로 크롬에 확장을 한 번만 등록하세요:"
Write-Host "   1) 주소창에 chrome://extensions 입력 -> 오른쪽 위 '개발자 모드' 켜기"
Write-Host "   2) '압축해제된 확장 프로그램 로드' -> 아래 폴더 선택"
Write-Host "      $App\extension"
Write-Host "   (업데이트 시에는 이 명령을 다시 실행한 뒤 확장의 새로고침 버튼만 누르면 됩니다)"
Start-Process explorer.exe (Join-Path $App "extension")
