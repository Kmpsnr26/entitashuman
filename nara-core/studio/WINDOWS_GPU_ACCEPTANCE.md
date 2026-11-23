# AleCore AI Neural Space 3D — Windows Physical GPU Acceptance

This acceptance step complements the automated GitHub Actions browser smoke.

## What it proves

The local Windows acceptance opens the real AleCore AI Live Studio in Electron/Chromium and requires:

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
- Creator Custom Settings panel is present and interactive
- R4 Brain/Binary defaults are active
- Guardian Ring realtime controls work
- R5 voice/audio controls are present
- R5 bounded audio profile mutations persist locally
- node voice narration still uses sanitized operational metadata

The report also records Electron GPU feature status and a bounded summary of detected GPU devices.

## One-click Windows run

From a checked-out copy of this branch/repository, double-click:

`NARA-Neural-GPU-Acceptance.bat`

The wrapper checks Node/npm, records the current Git HEAD when available, installs locked dependencies only when needed, ensures the Electron binary exists, forces `NARA_GPU_MODE=hardware`, runs the acceptance, and prints a GPU + R4/R5/R7 release-candidate summary.

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

A passing local hardware run requires `passed=true`, `gpu.modeMatched=true`, and all required R4/R5/R7 revision checks to be true.

## CI behavior

GitHub Actions intentionally sets `NARA_GPU_MODE=software` and uses ANGLE/SwiftShader so the automated acceptance is reproducible on hosted runners without a physical GPU. The same harness is therefore used for both environments, but the expected renderer is explicit and opposite:

- CI: software renderer is expected.
- Physical Windows acceptance: software renderer is rejected.


## R4/R5/R7 release-candidate checks

The Windows wrapper now explicitly requires these browser-smoke checks:

- `customSettingsPanel`
- `r4VisualDefaults`
- `customSettingsRuntime`
- `customSettingsPersistence`
- `r5AudioControls`
- `r5AudioProfileRuntime`
- `r7VoiceIdentityControls`
- `r7VoiceProfileRuntime`
- `r7VoicePreviewSafe`
- `nodeVoiceNarration`
- `mechanicalCoreRings`
- `galacticEnvironment`

The acceptance report still does not store the Creator password used by the browser smoke.

Audio automation verifies that the controls and bounded profile are wired and persisted correctly. The final perceived voice timbre and speaker loudness must still be reviewed on the target Windows machine because Speech Synthesis voices differ between Windows/browser installations.


R7 additionally validates that the Creator panel exposes system voice selection, AleCore AI voice character profiles, Preview Voice, UI SFX and Core FX controls. The automated gate verifies wiring and persisted bounded preferences; the final perceived timbre is still reviewed on the actual Windows voice installed on the target machine.
