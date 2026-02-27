@echo off
setlocal

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not in PATH.
  exit /b 1
)

python manage_accounts.py %*
exit /b %errorlevel%
