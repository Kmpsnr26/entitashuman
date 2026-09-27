# NARA Neural Space 3D — Windows Physical GPU Acceptance

This acceptance step complements the automated GitHub Actions browser smoke.

## What it proves

The local Windows acceptance opens the real NARA Core Live Studio in Electron/Chromium and requires:

- Studio SSE reaches `LIVE`
- the 3D canvas is created
- WebGL is available
- Electron reports hardware acceleration enabled
- the WebGL renderer is not SwiftShader, llvmpipe, WARP, Microsoft Basic Render, or another software renderer
- semantic realtime routes execute
- Core and Focus modes work
- Low Power quality mode works
- keyboard focus/navigation works
- FPS telemetry is measured
- no renderer crash occurs
- no fatal browser error is detected

The report also records Electron GPU feature status and a bounded summary of detected GPU devices.

## One-click Windows run

From a checked-out copy of this branch/repository, double-click:

`NARA-Neural-GPU-Acceptance.bat`

The wrapper checks Node/npm, installs locked dependencies only when needed, ensures the Electron binary exists, forces `NARA_GPU_MODE=hardware`, runs the acceptance, and prints a summary.

## Command-line run

PowerShell:

```powershell
.\scripts\nara-neural-gpu-acceptance.ps1
```

Or directly:

```powershell
$env:NARA_GPU_MODE='hardware'
npm run smoke:neural-gpu
```

## Evidence

On every run:

- `artifacts/nara-neural-live-report.json`
- `artifacts/nara-neural-live.png`

A passing local hardware run requires `passed=true` and `gpu.modeMatched=true`.

## CI behavior

GitHub Actions intentionally sets `NARA_GPU_MODE=software` and uses ANGLE/SwiftShader so the automated acceptance is reproducible on hosted runners without a physical GPU. The same harness is therefore used for both environments, but the expected renderer is explicit and opposite:

- CI: software renderer is expected.
- Physical Windows acceptance: software renderer is rejected.
