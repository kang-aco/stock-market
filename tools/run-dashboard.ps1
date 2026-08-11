# 글로벌 마켓 대시보드 - 로컬 실행
#
# 1) Node 로 로컬 서버를 띄우고
# 2) 브라우저를 앱 모드(주소창 없는 창)로 열고
# 3) 창을 닫으면 서버도 함께 종료합니다.
#
# run-dashboard.bat 이 이 스크립트를 호출합니다.

$ErrorActionPreference = 'Stop'

$AppDir = Split-Path -Parent $PSScriptRoot
Set-Location $AppDir

$Port       = 8899
$Url        = "http://localhost:$Port"
# $Profile 은 PowerShell 예약 변수이므로 다른 이름을 씁니다
$ProfileDir = Join-Path $env:LOCALAPPDATA 'MarketDashboard\browser-profile'

function Test-Port([int]$p) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $p)
    $c.Close()
    return $true
  } catch { return $false }
}

Write-Host ''
Write-Host '  글로벌 마켓 대시보드를 시작합니다...'
Write-Host ''

# ---- Node.js 확인 ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '  [오류] Node.js 를 찾을 수 없습니다.' -ForegroundColor Red
  Write-Host ''
  Write-Host '  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.'
  Write-Host ''
  Read-Host '  Enter 키를 누르면 종료합니다'
  exit 1
}

# ---- 서버 기동 (이미 떠 있으면 재사용) ----
$serverProc = $null
if (Test-Port $Port) {
  Write-Host '  이미 실행 중인 서버를 재사용합니다.'
} else {
  $serverProc = Start-Process node -ArgumentList 'tools\local-server.mjs' `
                  -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru

  $ready = $false
  foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 300
    if (Test-Port $Port) { $ready = $true; break }
    if ($serverProc.HasExited) { break }
  }

  if (-not $ready) {
    Write-Host '  [오류] 서버를 시작하지 못했습니다.' -ForegroundColor Red
    Write-Host "  포트 $Port 가 이미 사용 중인지 확인해 주세요."
    if ($serverProc -and -not $serverProc.HasExited) {
      Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host ''
    Read-Host '  Enter 키를 누르면 종료합니다'
    exit 1
  }
}

# ---- 브라우저 찾기 (Chrome 우선, 없으면 Edge) ----
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host "  대시보드를 여는 중...  $Url"
Write-Host ''
Write-Host '  이 창은 최소화해 두세요. 대시보드 창을 닫으면 자동으로 정리됩니다.'

try {
  if ($browser) {
    # 전용 프로필을 써야 기존 브라우저 창과 무관하게 종료를 기다릴 수 있습니다
    Start-Process $browser -ArgumentList @(
      "--app=$Url",
      "--user-data-dir=$ProfileDir",
      '--window-size=1500,1000',
      '--no-first-run',
      '--no-default-browser-check'
    ) -Wait
  } else {
    Write-Host '  [알림] Chrome/Edge 를 찾지 못해 기본 브라우저로 엽니다.'
    Start-Process $Url
    Read-Host '  사용이 끝나면 Enter 키를 누르세요'
  }
} finally {
  if ($serverProc -and -not $serverProc.HasExited) {
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  }
}
