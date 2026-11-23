# AleCore AI Live Studio — Neural Space 3D Blueprint

## Goal

Add an experimental Three.js Neural Space without removing the existing 2D Brain Map. AleCore AI remains headless-capable and the Studio remains an observer/safe-event surface.

## View modes

- **2D Brain Map** — stable fallback and default in Stage 1.
- **3D Neural Explorer** — experimental renderer loaded lazily.
- A 3D load/WebGL failure must not break the 2D Studio.

## Stage 1 architecture

```
AleCore AI / EventBus / BrainState
            |
            | snapshot + SSE
            v
       app.js bridge
        /         \
  2D Brain Map   Neural3DScene
                  |- Scene / Camera
                  |- custom orbit-style controls
                  |- AleCore AI core renderer
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

## Stage 2 — implemented

Living-root rendering now uses deterministic Catmull-Rom curves with layered TubeGeometry:

- outer neural sheath
- additive glow envelope
- bright inner energy filament
- one reusable bounded packet + halo per link
- active/status-driven link intensity
- selected-region neighborhood highlighting
- event pulses routed across adjacent links
- flow direction bends toward the region receiving activity
- reduced-motion support
- renderer pauses when the 3D view is hidden
- no unbounded event-particle allocation

Stage 2 deliberately keeps the organic root geometry stable and animates energy through it. This avoids rebuilding dozens of TubeGeometry objects every frame.

## Stage 3 — implemented

Realtime events now map to semantic source/target pairs. The renderer computes the shortest route through the live AleCore AI graph and animates a packet over each root segment.

- explicit routes for work/reason/plan/memory/context/agent/program/verify/error/bug/sync/terminal events
- graph shortest-path routing for indirect connections
- fixed 24-slot route packet pool
- oldest-slot reuse under burst load
- event-specific route colors
- route pulse propagation across every traversed root
- visual-only: no event redispatch and no renderer-owned network connection

## Stage 4 — implemented

Navigation and inspection are now first-class Studio controls.

- Explorer, Focus and Core modes
- smooth target/radius camera transitions
- Reset view
- selected-region detail overlay and neighborhood list
- keyboard navigation: arrows, +/- zoom, F focus, C core, E explorer, Escape reset
- focusable accessible WebGL canvas
- Auto / High / Balanced / Low Power quality presets
- 3D rendering pauses while the 2D view is active

## Stage 5 — implemented with adaptive cinematic glow

Cinematic polish is implemented without adding an external post-processing dependency.

- additive radial glow sprites around nodes/core
- ambient neural dust and deep star field
- soft fog and CSS vignette/depth framing
- traffic-reactive tone-mapping exposure
- measured rolling FPS budget
- Auto quality degrades below ~38 FPS and can upgrade above ~57 FPS with cooldowns
- low-power mode disables ambient dust and reduces pixel ratio/glow intensity
- reduced-motion preference remains respected

A heavy EffectComposer/UnrealBloomPass was intentionally not introduced. The current additive glow system produces the soft-bloom character while keeping the dependency/CSP surface small and allowing the measured quality controller to protect interactive performance.
