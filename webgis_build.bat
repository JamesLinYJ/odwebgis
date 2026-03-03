@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"
python webgisctl.py build %*
exit /b %errorlevel%

