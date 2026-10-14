@echo off
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo [오류] 관리자 권한이 필요합니다. "관리자 권한으로 실행"을 선택하세요.
  pause
  exit /b 1
)
schtasks /end /tn "BOM Portal" >nul 2>&1
schtasks /delete /tn "BOM Portal" /f
call "%~dp0stop.bat" nopause
echo 자동 시작을 해제했습니다.
pause
