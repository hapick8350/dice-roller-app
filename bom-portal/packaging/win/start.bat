@echo off
chcp 65001 >nul
title BOM 포털
cd /d "%~dp0"
if not exist ".env" call "%~dp0setup.bat" nopause
set OPEN_BROWSER=1
echo BOM 포털을 시작합니다. 이 창을 닫으면 포털이 종료됩니다.
echo.
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0src\server.js"
echo.
echo 포털이 종료되었습니다.
pause
