# @atlas/canvas-runtime

Polymorphic canvas data contracts shared between the RitualEngine (server) and the atlas-web `<CanvasShell>` (client).

- `CanvasManifest` — what the architect emits, declares which modes the canvas can render for this artifact.
- `personaFilter` — narrows a manifest to modes whose audience includes the user's persona.
- `CanvasModeRegistry` — runtime registry mapping mode-id to renderer (atlas-web populates at boot).
- `events` — Zod schemas for canvas/researcher/designer events that extend the engine's RitualEventSchema discriminated union.

No React. No Next.js. Pure TS + Zod.
