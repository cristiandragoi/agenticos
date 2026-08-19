# Jarvis Visual Handoff

## User Target

The desired Jarvis front is **not** a planet inside a circle, bubble, card, or pasted photo.

The target is:

- The whole Jarvis center/stage area is the universe.
- The planet and rings are part of that universe, not a separate image box.
- Capability satellites/nodes must be real UI overlays, not baked into the image.
- The visual should pulse slightly from real voice input/output while the user talks.
- The UI must remain readable and operational: repository/status controls cannot overlap.

## Important Current Problem

The current attempted implementation is still wrong because it uses `src/assets/jarvis-blob1-reference.png`, which has labels/satellites baked into the bitmap. That makes the satellites appear "inside the picture" instead of as real app UI.

Do not keep building on that asset as the main center visual.

## Better Asset To Use

A clean no-label universe/planet background was generated here:

`C:\Users\Cris\.codex\generated_images\01a01475-7334-7753-8cbc-779f91fe6be5\call_fyBLVfmxwZyLDWIScSqhnmFY.png`

That asset has:

- no labels
- no UI text
- no satellites
- no node markers
- no circular bubble
- no rectangular frame

Recommended next step: copy that asset into `src/assets/`, for example:

`src/assets/jarvis-universe-clean.png`

Then use it as the full Jarvis stage background.

## Files Currently Involved

- `src/components/jarvis/JarvisNeuralBlob.tsx`
- `src/pages/JarvisStudio.tsx`
- `src/pages/JarvisCommandCenter.module.css`
- `src/assets/jarvis-blob1-reference.png`
- `package.json`
- `package-lock.json`

The current patch is saved at:

`handoff/jarvis-current-visual-work.patch`

## Current Attempt Summary

The current attempt added:

- `three` and `@types/three`
- a Three.js canvas overlay in `JarvisNeuralBlob`
- a bitmap Blob1 reference image under `src/assets/jarvis-blob1-reference.png`
- stage background CSS in `JarvisCommandCenter.module.css`
- a dev-only guard for the `GoldenPathPanel`
- real voice pulse values using `inputLevel` and `outputLevel`

## Recommended Implementation Direction

1. Remove the baked-label `jarvis-blob1-reference.png` from the central visual path.
2. Use the clean no-label universe image as the full `.jarvisStage` background.
3. Keep `JarvisNeuralBlob` as a transparent overlay for real live elements only:
   - capability nodes
   - project nodes
   - active connection lines
   - state/voice pulse glow
4. Do not render another bitmap planet inside `JarvisNeuralBlob`.
5. Bind slight pulse to:
   - `inputLevel` during listening
   - `outputLevel` during speaking
6. Keep the lower status lane wrapping so repository/approval/dock/activity controls do not overlap.
7. Keep `GoldenPathPanel` hidden from normal packaged UI.

## Verification Commands Used

```powershell
npx.cmd vitest run src/__tests__/JarvisNeuralBlob.test.tsx src/__tests__/JarvisVisualUniverse.test.tsx src/__tests__/JarvisStudioLayout.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
npx.cmd vite build
```

These passed during the last attempt, but visual acceptance did **not** pass.

## Visual Acceptance Criteria

A screenshot should look like one continuous scene:

- no picture boundary around the planet
- no circular mask
- no baked satellite labels
- no duplicated planet image on top of a different universe background
- real capability labels/nodes placed by React/Canvas/Three.js, outside the bitmap
- lower controls do not cover the planet/rings

