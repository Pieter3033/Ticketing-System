@echo off
pushd "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSPECT-EXISTING-PROXY.ps1"
echo.
pause
popd
