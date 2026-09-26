$ErrorActionPreference = "Stop"

Write-Host "=== HumanALE local CI fallback ==="
Write-Host "Node:"
node --version
Write-Host "npm:"
npm --version

Write-Host ""
Write-Host "[1/5] Clean install"
npm ci

Write-Host "[2/5] Tests"
npm test

Write-Host "[3/5] Build"
npm run build

Write-Host "[4/5] Windows terminal smoke"
npm run smoke:terminal

Write-Host "[5/5] Dependency audit"
npm audit --audit-level=high

Write-Host "ALL LOCAL CI CHECKS PASSED"
