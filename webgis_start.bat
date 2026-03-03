@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

if "%~1"=="--stop" (
  python webgisctl.py stop
  exit /b %errorlevel%
)

if "%~1"=="--restart" (
  python webgisctl.py restart --open
  exit /b %errorlevel%
)

python webgisctl.py start --open %*
exit /b %errorlevel%
