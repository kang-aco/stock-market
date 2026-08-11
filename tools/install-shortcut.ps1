# 바탕화면에 "글로벌 마켓 대시보드" 바로가기를 만듭니다. 한 번만 실행하면 됩니다.
# install-desktop-shortcut.bat 이 이 스크립트를 호출합니다.

$ErrorActionPreference = 'Stop'

$AppDir  = Split-Path -Parent $PSScriptRoot
$BatPath = Join-Path $AppDir 'tools\run-dashboard.bat'
$LnkName = '글로벌 마켓 대시보드'

if (-not (Test-Path $BatPath)) {
  Write-Host "  [오류] run-dashboard.bat 를 찾을 수 없습니다: $BatPath" -ForegroundColor Red
  exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$link    = Join-Path $desktop "$LnkName.lnk"

# 바로가기 아이콘으로 쓸 브라우저 (없으면 기본 아이콘)
$icon = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host ''
Write-Host '  바탕화면에 바로가기를 만드는 중...'
Write-Host "    앱 폴더 : $AppDir"

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($link)
$sc.TargetPath       = $BatPath
$sc.WorkingDirectory = $AppDir
$sc.Description      = '글로벌 마켓 대시보드 - 실시간 지수/환율/원자재'
$sc.WindowStyle      = 7          # 콘솔 창은 최소화 상태로 시작
if ($icon) { $sc.IconLocation = "$icon,0" }
$sc.Save()

if (Test-Path $link) {
  Write-Host "    생성 완료 : $link" -ForegroundColor Green
  Write-Host ''
  Write-Host "  바탕화면의 `"$LnkName`" 아이콘을 더블클릭하세요."
} else {
  Write-Host '  [오류] 바로가기 생성에 실패했습니다.' -ForegroundColor Red
  exit 1
}
Write-Host ''
