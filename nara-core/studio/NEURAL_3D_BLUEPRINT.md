# NARA Core Live Studio — Neural Space 3D Blueprint

## Goal

Add an experimental Three.js Neural Space without removing the existing 2D Brain Map. NARA Core remains headless-capable and the Studio remains an observer/safe-event surface.

## View modes

- **2D Brain Map** — stable fallback and default in Stage 1.
- **3D Neural Explorer** — experimental renderer loaded lazily.
- A 3D load/WebGL failure must not break the 2D Studio.

## Stage 1 architecture

```
NARA Core / EventBus / BrainState
            |
            | snapshot + SSE
            v
       app.js bridge
        /         \
  2D Brain Map   Neural3DScene
                  |- Scene / Camera
                  |- custom orbit-style controls
                  |- NARA core renderer
                  |- neural node renderer
                  |- static link scaffold
                  |- raycast interaction
                  |- status/event pulse
```

### Files

- `public/app.js` — view switch, lazy loader, state/event bridge.
- `public/neural-space.js` — isolated Three.js scene and interaction controller.
- `public/index.html` — 2D/3D switch and 3D host/HUD.
- `public/styles.css` — Neural Space canvas/HUD styling.
- `studio/server.mjs` — same-origin local Three.js module route.
- `tests/nara-studio.test.mjs` — fallback/security/integration coverage.

## Security boundary

The 3D renderer is presentation-only. It does not add shell execution, arbitrary network access, or replay execution. Region selection uses the existing allowlisted `brain.region.select` event.

Three.js is served from the installed local package through a fixed route. CSP remains `script-src 'self'`.

## Stage 2

Replace static link scaffold with organic Catmull-Rom/tube roots, link activity state, animated energy flow, and selected-neighborhood highlighting.

## Stage 3

Map live SSE events to source/target routes and spawn bounded data packets. Keep packet count capped and visual-only.

## Stage 4

Add cinematic focus/core modes, smooth camera transitions, detail overlay, keyboard accessibility, and low-power quality presets.

## Stage 5

Add bloom/post-processing only after performance budgets are measured on representative desktop hardware.
