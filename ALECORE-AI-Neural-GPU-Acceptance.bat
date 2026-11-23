@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  AleCore AI R7 Release Candidate - Physical Acceptance
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\alecore-ai-neural-gpu-acceptance.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [FAIL] R7 physical GPU / visual / voice / UI-audio acceptance belum lolos.
) else (
  echo [PASS] R7 physical GPU / visual / voice / UI-audio acceptance selesai dan lolos.
)
echo.
pause
exit /b %EXIT_CODE%
