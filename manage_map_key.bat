@echo off
setlocal

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Python not found in PATH.
    exit /b 1
  )
)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" manage_map_key.py %*
  exit /b %errorlevel%
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3.11 -V >nul 2>nul
  if not errorlevel 1 (
    py -3.11 manage_map_key.py %*
    exit /b %errorlevel%
  )
  py -3 manage_map_key.py %*
  exit /b %errorlevel%
)

python manage_map_key.py %*
exit /b %errorlevel%
