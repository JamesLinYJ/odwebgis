@echo off
chcp 65001 >nul 2>nul
setlocal

cd /d "%~dp0"

echo ============================================
echo    WebGIS  -  Local Development Launcher
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not in PATH.
  echo [TIP]   Install Python 3.10+ from https://python.org
  echo.
  pause
  exit /b 1
)

if "%~1"=="--stop" (
  echo [INFO] Stopping WebGIS ...
  for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
  )
  for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
  )
  echo [OK] Stopped.
  exit /b 0
)

if "%~1"=="--restart" (
  echo [INFO] Restarting WebGIS ...
  call "%~f0" --stop
  timeout /t 2 /nobreak >nul
)

echo [INFO] Starting WebGIS (auto open and debug) ...
echo.
python run_local.py

if errorlevel 1 (
  echo.
  echo [ERROR] Startup failed!
  echo [TIP]   Check run_stderr.log for details
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] WebGIS is running.
echo      Press any key to exit this window (server continues in background).
echo.
pause >nul
exit /b 0
