@echo off
pushd "%~dp0"
"%~dp0caddy.exe" validate --config "%~dp0Caddyfile" --adapter caddyfile
echo.
pause
popd
