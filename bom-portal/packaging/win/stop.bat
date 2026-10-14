@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -Command "$exe = (Resolve-Path 'runtime\node.exe').Path; $p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -eq $exe }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host '포털을 종료했습니다.' } else { Write-Host '실행 중인 포털이 없습니다.' }"
if "%~1"=="" pause
