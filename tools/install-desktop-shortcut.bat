@echo off
REM ------------------------------------------------------------
REM  Create a desktop shortcut. Run this once.
REM
REM  ASCII-only on purpose - see run-dashboard.bat for why.
REM  Logic and messages live in install-shortcut.ps1.
REM ------------------------------------------------------------
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1"
pause
exit /b %errorlevel%
