@echo off
pushd "%~dp0"
"%~dp0..\infinity-json-adapter\releases\infinity-cc-20261028-c7ae994b\node.exe" "%~dp0cutover.cjs" activate
echo.
pause
popd
