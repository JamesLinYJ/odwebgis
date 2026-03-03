REM 【中文注释】
REM 文件说明：manage_accounts.bat 为 Windows 启动/管理脚本。
REM 维护约定：命令行参数变更后请同步提示文案。

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

