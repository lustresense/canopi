@echo off
setlocal
cd /d "%~dp0"
REM Extra arguments are forwarded to scripts\build-windows.ps1, e.g.:
REM   BUILD-WINDOWS.cmd -EngineExe C:\path\cnp-engine.exe -EngineProvenance C:\path\ENGINE-PROVENANCE.json
REM   BUILD-WINDOWS.cmd -SkipInstallTest
where pwsh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  pwsh -NoProfile -File "%~dp0scripts\build-windows.ps1" %*
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1" %*
)
set "STATUS=%ERRORLEVEL%"
echo.
if not "%STATUS%"=="0" echo Build did not finish. Read the error above and release\_logs\. No installer should be trusted.
if "%STATUS%"=="0" echo Release artifacts are in release\: installer, source ZIP, SHA256SUMS.txt, BUILD-MANIFEST.json, RELEASE_TEST_REPORT.md.
pause
exit /b %STATUS%
