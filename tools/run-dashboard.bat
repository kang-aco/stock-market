@echo off
REM ------------------------------------------------------------
REM  Global Market Dashboard - launcher
REM
REM  This file is intentionally ASCII-only. cmd.exe parses batch
REM  files using the console codepage, so Korean text here would
REM  be corrupted. All logic and messages live in run-dashboard.ps1.
REM ------------------------------------------------------------
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-dashboard.ps1"
if errorlevel 1 pause
exit /b %errorlevel%
