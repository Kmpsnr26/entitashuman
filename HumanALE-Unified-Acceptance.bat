@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  AleCore AI + HumanALE V3 - Unified Physical Acceptance
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\humanale-unified-acceptance.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [FAIL] Unified AleCore AI + HumanALE acceptance belum lolos.
) else (
  echo [PASS] Unified AleCore AI + HumanALE acceptance selesai dan lolos.
)
echo.
pause
exit /b %EXIT_CODE%
