@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  NARA R5 Release Candidate - Physical Acceptance
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\nara-neural-gpu-acceptance.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [FAIL] R5 physical GPU / visual / audio acceptance belum lolos.
) else (
  echo [PASS] R5 physical GPU / visual / audio acceptance selesai dan lolos.
)
echo.
pause
exit /b %EXIT_CODE%
