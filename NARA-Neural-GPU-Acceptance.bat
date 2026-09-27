@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  NARA Neural Space 3D - Physical GPU Acceptance
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\nara-neural-gpu-acceptance.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [FAIL] Physical GPU acceptance belum lolos.
) else (
  echo [PASS] Physical GPU acceptance selesai dan lolos.
)
echo.
pause
exit /b %EXIT_CODE%
