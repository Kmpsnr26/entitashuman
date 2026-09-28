@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  NARA + HumanALE V3 - Unified Physical Acceptance
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\humanale-unified-acceptance.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [FAIL] Unified NARA Core + HumanALE acceptance belum lolos.
) else (
  echo [PASS] Unified NARA Core + HumanALE acceptance selesai dan lolos.
)
echo.
pause
exit /b %EXIT_CODE%
