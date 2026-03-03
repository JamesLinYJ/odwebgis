@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

if "%~1"=="--stop" (
  call :runctl stop
  exit /b %errorlevel%
)

if "%~1"=="--restart" (
  call :runctl restart --open
  exit /b %errorlevel%
)

call :runctl start --open %*
exit /b %errorlevel%

:runctl
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" webgisctl.py %*
  exit /b %errorlevel%
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3.11 -V >nul 2>nul
  if not errorlevel 1 (
    py -3.11 webgisctl.py %*
    exit /b %errorlevel%
  )
  py -3 webgisctl.py %*
  exit /b %errorlevel%
)

python webgisctl.py %*
exit /b %errorlevel%
