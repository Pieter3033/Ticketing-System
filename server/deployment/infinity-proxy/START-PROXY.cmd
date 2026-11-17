@echo off
rem Run only after reviewing the readiness check and completing the HTTPS cutover.
pushd "%~dp0"
powershell.exe -NoLogo -NoProfile -Command "$listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners(); if ($listeners | Where-Object { $_.Port -in 80,443 }) { Write-Host 'Port 80 or 443 is occupied. Review the existing Caddy/SQLPage listeners before starting another proxy.'; exit 1 }"
if errorlevel 1 goto blocked
"%~dp0caddy.exe" run --config "%~dp0Caddyfile" --adapter caddyfile
goto finished
:blocked
echo Public HTTPS routing was not started.
:finished
echo.
pause
popd
