@echo off
setlocal

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not in PATH.
  pause
  exit /b 1
)

echo [INFO] Starting WebGIS (auto open and debug)...
python run_local.py

if errorlevel 1 (
  echo [ERROR] Startup failed, check run_stderr.log
  pause
  exit /b 1
)

exit /b 0
