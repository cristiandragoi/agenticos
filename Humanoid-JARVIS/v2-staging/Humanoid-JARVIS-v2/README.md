# Humanoid-JARVIS-v2

A **single central programmable Jarvis humanoid** for AgenticOS.

This package intentionally does **not** contain:
- a raster humanoid image
- an `<img>`-based Jarvis
- duplicate state-preview humanoids
- a right-side state gallery
- fake production runtime state

The same central Jarvis changes appearance while the runtime state changes.

## Visual structure

- human-shaped head / jaw / ears / face
- eyes
- forehead/brain neural core
- facial neural traces
- neck / shoulders / upper torso
- chest energy core
- hologram base
- functional system nodes surrounding the humanoid

## State color semantics

- `idle` / `speaking` / `completed` → cyan
- `listening` / `transcribing` / `warning` → yellow
- `thinking` / `researching` → purple
- `delegating` → pink
- `error` / `interrupted` → red

The color applies to the **same humanoid**. There are no duplicate Jarvis previews.

## Usage

```tsx
import {
  JarvisVisualization,
  type JarvisState,
} from './components/humanoid-jarvis-v2';

<JarvisVisualization
  state={runtimeState}
  activeNode={activeNode}
  activeAgent={activeAgent}
  severity={severity}
  speakingLevel={ttsAmplitude}
  thinkingIntensity={thinkingIntensity}
  isConnected={sseConnected}
  nodeActivity={nodeActivity}
  onNodeClick={(node, route) => {
    if (route) window.location.hash = route.replace(/^#/, '');
  }}
/>
```

## Integration rule

Kimi/Claude/example store names are not authoritative.
Hermes must map these props onto the **real AgenticOS runtime signals**.

Production state must come from real:
- STT / mic state
- LLM / SSE state
- TTS state
- delegation state
- provider/model state
- subsystem activity
- errors/fallbacks

## Important

The reference JPEG was used only as a visual guide.
The humanoid itself is SVG/programmatic geometry.
