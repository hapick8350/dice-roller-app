@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================================
echo   BOM 포털 초기 설정
echo ==========================================================
echo.
if not exist ".env" goto ask
echo 이미 설정 파일(.env)이 있습니다. 다시 설정하면 기존 설정을 덮어씁니다.
set "AGAIN="
set /p AGAIN="다시 설정하시겠습니까? (Y/N): "
if /i not "%AGAIN%"=="Y" goto end

:ask
echo SAP Business ByDesign 로그인을 연동합니다.
echo ByD에 접속할 때 쓰는 주소를 입력하세요. 예) my123456.sapbydesign.com
echo (SAP 연동 없이 체험만 하려면 그냥 Enter)
echo.
set "TENANT="
set /p TENANT="ByD 주소: "
set "PORTNO="
set /p PORTNO="포트 (기본 3000, Enter): "
if "%PORTNO%"=="" set "PORTNO=3000"

copy /y ".env.example" ".env" >nul
if "%TENANT%"=="" goto local

powershell -NoProfile -Command "$t='%TENANT%'.Trim() -replace '^https?://','' -replace '/.*$',''; $f='.env'; (Get-Content $f -Encoding UTF8) -replace '^AUTH_MODE=.*','AUTH_MODE=byd' -replace '^BYD_BASE_URL=.*',('BYD_BASE_URL=https://'+$t) -replace '^PORT=.*','PORT=%PORTNO%' | Set-Content $f -Encoding UTF8"
echo.
echo SAP 로그인 연동으로 설정했습니다. SAP ByD 사용자 ID/비밀번호로 로그인하세요.
goto done

:local
powershell -NoProfile -Command "$f='.env'; (Get-Content $f -Encoding UTF8) -replace '^AUTH_MODE=.*','AUTH_MODE=local' -replace '^PORT=.*','PORT=%PORTNO%' | Set-Content $f -Encoding UTF8"
echo.
echo SAP 연동 없이 설정했습니다. 로그인: admin / change-me

:done
echo BOM 데이터는 샘플(MOCK) 데이터로 시작합니다. 실제 SAP BOM 연동은 INSTALL.txt 를 참고하세요.
echo 설정 파일: %~dp0.env  (메모장으로 수정 가능)
echo.

:end
if /i not "%~1"=="nopause" pause
