@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NODE_PATH=%CD%\runtime\node.exe"
if exist "%NODE_PATH%" goto node_ready

set "NODE_PATH="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_PATH set "NODE_PATH=%%I"

if not defined NODE_PATH (
  echo 没有找到 Node.js。
  echo 请从 GitHub Releases 下载 Windows 开箱即用版本。
  echo 开发者也可以安装 Node.js 22 或更高版本后运行本项目。
  pause
  exit /b 1
)

:node_ready
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\start-windows.ps1" -NodePath "%NODE_PATH%" -ProjectRoot "%CD%"
if errorlevel 1 pause
