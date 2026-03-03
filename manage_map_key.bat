REM 【中文注释】
REM 文件说明：manage_map_key.bat 为 Windows 启动/管理脚本。
REM 维护约定：命令行参数变更后请同步提示文案。

@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found in PATH.
  exit /b 1
)

python manage_map_key.py %*

