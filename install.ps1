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
if ($status.config.gitRemote) { Write-Host "==> GitHub 저장소 유지: $($status.config.gitRemote)" }
else {
  Write-Host "==> GitHub 저장소가 아직 연결되지 않았습니다. 설치 후 아래 중 하나로 연결하세요:"
  Write-Host "    - 확장 설정 > GitHub 저장소 주소 입력 > 연결"
  Write-Host "    - & '$Node' '$HostJs' connect https://github.com/<아이디>/aside-sync-data"
}

Write-Host "==> 자동 동기화 등록 (크롬이 꺼져 있어도 백그라운드에서 실행)"
$sched = & $Node --no-warnings $HostJs schedule | Out-String | ConvertFrom-Json
if ($sched.installed) { Write-Host "    작업 스케줄러에 등록 완료" } else { Write-Host "    등록 실패: 확장 팝업의 '다시 등록' 버튼으로 재시도하세요" }

Write-Host ""
Write-Host "설치 완료. 동기화는 이제 자동으로 돌아갑니다."
Write-Host ""
Write-Host "상태 확인용 크롬 확장 (선택, 한 번만):"
Write-Host "   1) 주소창에 chrome://extensions 입력 -> 오른쪽 위 '개발자 모드' 켜기"
Write-Host "   2) '압축해제된 확장 프로그램 로드' -> 아래 폴더 선택"
Write-Host "      $App\extension"
Write-Host "   (업데이트 시에는 이 명령을 다시 실행한 뒤 확장의 새로고침 버튼만 누르면 됩니다)"
Start-Process explorer.exe (Join-Path $App "extension")
