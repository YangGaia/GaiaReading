@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/zh-cn
  echo 安装完成后重新双击本文件即可。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行：正在安装依赖（需要联网，请稍候）...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在启动 Gaia Reading...
call npm start
endlocal
