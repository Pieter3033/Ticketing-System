@echo off
pushd "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0CHECK-READY.ps1"
echo.
pause
popd
