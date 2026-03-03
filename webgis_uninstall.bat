@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

set REMOVE_ALL=0
set ASSUME_YES=0

:parse
if "%~1"=="" goto run
if /I "%~1"=="--all" (
  set REMOVE_ALL=1
  shift
  goto parse
)
if /I "%~1"=="--yes" (
  set ASSUME_YES=1
  shift
  goto parse
)
if /I "%~1"=="-h" goto help
if /I "%~1"=="--help" goto help
echo [ERROR] Unknown option: %~1
exit /b 1

:help
echo Usage: webgis_uninstall.bat [--all] [--yes]
exit /b 0

:run
if "%ASSUME_YES%"=="0" (
  if "%REMOVE_ALL%"=="1" (
    set /p CONFIRM=Stop service and remove all local data? [y/N]:
  ) else (
    set /p CONFIRM=Stop service and clean runtime files? [y/N]:
  )
  if /I not "%CONFIRM%"=="y" if /I not "%CONFIRM%"=="yes" exit /b 1
)

if "%REMOVE_ALL%"=="1" (
  call :runctl clean all
) else (
  call :runctl clean runtime
)
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
