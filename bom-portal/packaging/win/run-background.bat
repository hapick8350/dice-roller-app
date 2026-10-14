@echo off
rem 자동 시작(작업 스케줄러)용. 창 없이 실행하고 로그는 logs\server.log 에 남긴다.
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
if not exist ".env" copy ".env.example" ".env" >nul
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0src\server.js" >> "%~dp0logs\server.log" 2>&1
