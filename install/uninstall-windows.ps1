# Removes the scheduled task and native host registration (keeps config/state and your cloud folder)
schtasks /Delete /F /TN AsideSync 2>$null | Out-Null
foreach ($k in @("HKCU:\Software\Aside\NativeMessagingHosts", "HKCU:\Software\Google\Chrome\NativeMessagingHosts", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts", "HKCU:\Software\Chromium\NativeMessagingHosts", "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts")) {
  Remove-Item (Join-Path $k "com.aside.sync") -Force -ErrorAction SilentlyContinue
}
Remove-Item (Join-Path $env:USERPROFILE ".aside-sync\host") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "제거 완료. 확장은 chrome://extensions 에서 삭제하세요."
