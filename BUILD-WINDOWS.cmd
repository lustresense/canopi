@echo off
setlocal
cd /d "%~dp0"
where pwsh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  pwsh -NoProfile -File "%~dp0scripts\build-windows.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
)
set "STATUS=%ERRORLEVEL%"
echo.
if not "%STATUS%"=="0" echo Build did not finish. Read the error above. No installer should be trusted.
if "%STATUS%"=="0" echo Installer and installer ZIP are in the release directory.
pause
exit /b %STATUS%
