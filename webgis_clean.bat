@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

set MODE=%~1
if "%MODE%"=="" set MODE=runtime

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" webgisctl.py clean %MODE%
  exit /b %errorlevel%
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3.11 -V >nul 2>nul
  if not errorlevel 1 (
    py -3.11 webgisctl.py clean %MODE%
    exit /b %errorlevel%
  )
  py -3 webgisctl.py clean %MODE%
  exit /b %errorlevel%
)

python webgisctl.py clean %MODE%
exit /b %errorlevel%
