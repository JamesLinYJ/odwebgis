@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" webgisctl.py deploy %*
  exit /b %errorlevel%
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3.11 -V >nul 2>nul
  if not errorlevel 1 (
    py -3.11 webgisctl.py deploy %*
    exit /b %errorlevel%
  )
  py -3 webgisctl.py deploy %*
  exit /b %errorlevel%
)

python webgisctl.py deploy %*
exit /b %errorlevel%
