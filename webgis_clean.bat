@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

set MODE=%~1
if "%MODE%"=="" set MODE=runtime

python webgisctl.py clean %MODE%
exit /b %errorlevel%

