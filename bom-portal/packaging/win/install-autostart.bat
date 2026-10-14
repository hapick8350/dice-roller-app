@echo off
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo [오류] 관리자 권한이 필요합니다.
  echo        이 파일을 마우스 오른쪽 버튼으로 눌러 "관리자 권한으로 실행"을 선택하세요.
  pause
  exit /b 1
)
if not exist ".env" call "%~dp0setup.bat" nopause
schtasks /create /tn "BOM Portal" /tr "\"%~dp0run-background.bat\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 (
  echo [오류] 작업 스케줄러 등록에 실패했습니다.
  pause
  exit /b 1
)
schtasks /run /tn "BOM Portal" >nul
echo.
echo 등록되었습니다. 이제 PC가 켜지면 BOM 포털이 자동으로 실행됩니다.
echo 접속 주소: http://localhost:3000  (다른 PC에서는 http://이PC의IP:3000)
echo 로그: %~dp0logs\server.log
pause
