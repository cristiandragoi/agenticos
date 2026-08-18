# AGENTICOS JARVIS HUMANOID INTEGRATION V4 — PHASE 1-3 GATE

Status: AWAITING HUMAN VISUAL APPROVAL (do not treat as pass).

## What changed
- `src/assets/jarvis-humanoid.png` — the SUPPLIED reference humanoid (388x469
  RGBA, transparent background) shipped as the Layer-A base asset.
- `src/components/jarvis/JarvisCore.tsx` — rewritten: draws the reference
  asset directly (NO procedural anatomy). Scale/placement: ~74% of the hero
  stage height, shoulders ~61% of the width, centered, breathing ±0.45%.
  State colorization: canvas hue-rotate/saturate/brightness filters lerped
  per runtime state + a soft state-colored edge glow. Idle = turquoise
  (#00E5FF family per spec §5).
- Tests updated to the V4 color contract (idle #00e5ff) + ctx stubs gain
  filter/drawImage.

## Layered architecture (implemented so far)
- Layer A: humanoid base = the reference asset (done — this gate)
- Layer B: state colorization = filters + edge glow (mapping wired, lerped)
- Layer C: neural effects — NOT YET (phase 6, after approval)
- Layer D: mouth animation — NOT YET (phase 5, after approval; real TTS
  outputLevel plumbing retained in the component)
- Layer E: agent activity — NOT YET (phase 7, after approval)

## Verification
- tsc 0 · JarvisCore tests 3/3 · vite build OK (asset bundled)
- Live Electron: 1920x1080 orb 266px fully inside 451px stage; 1366x768 orb
  190px fully inside 400px stage; no clipping.
- Crop palette: turquoise family (210°/180°), eye/nose/mouth bands at the
  reference asset's own positions.

## Screenshots
- cache/jarvis-v4/v4-1920-full.png
- cache/jarvis-v4/v4-1920-humanoid-crop.png
- cache/jarvis-v4/v4-1366-full.png
