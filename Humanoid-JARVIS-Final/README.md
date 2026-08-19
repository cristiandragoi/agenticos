# JARVIS Humanoid Asset — Final

## Overview

A high-fidelity, programmable humanoid holographic asset representing JARVIS. This is a **professional vector-based neural human bust** designed for integration into React/Electron applications.

---

## Chosen Approach: VECTOR (SVG)

### Reason for Choice

1. **Perfect scalability** — Renders crisply at any resolution without quality loss
2. **Native React integration** — SVG elements can be directly manipulated via refs
3. **No 3D dependencies** — No Three.js or WebGL required, reducing bundle size
4. **Precise region control** — Each anatomical region has a unique ID for independent manipulation
5. **Built-in animations** — SMIL animations for particles and glow effects work natively in browsers
6. **Performance optimized** — Minimal CPU/GPU overhead compared to 3D rendering on laptops
7. **Easy theming** — Colors, opacity, and effects can be changed via CSS or JavaScript

---

## Asset Files

| File | Description |
|------|-------------|
| `jarvis-final.svg` | Main SVG asset with all regions and animations |
| `JarvisVector.tsx` | React component wrapper with programmatic API |
| `JarvisRegions.ts` | TypeScript definitions for all regions and coordinates |
| `preview/index.html` | Standalone preview page for visual testing |

---

## Anatomy & Regions

The asset contains the following **independently controllable regions**:

| Region ID | Element ID | Description |
|-----------|------------|-------------|
| `head` | `#head` | Main head silhouette including skull outline |
| `face` | `#faceContour` | Facial structure defining jaw, cheeks, chin |
| `leftEye` | `#leftEye` | Left eye with iris, pupil, glow |
| `rightEye` | `#rightEye` | Right eye with iris, pupil, glow |
| `brain` | `#brain` | Internal brain neural network |
| `foreheadCore` | `#foreheadCore` | **PRIMARY COGNITIVE CENTER** — Central neural light with orbiting particles |
| `faceNeurons` | `#faceNeurons` | Neural network overlay on face and temples |
| `neck` | `#neck` | Neck structure with vertical neural lines |
| `torso` | `#torso` | Upper chest and shoulders base |
| `chestNeurons` | `#chestNeurons` | Chest neural network with rings and connections |
| `chestCore` | `#chestCore` | Secondary energy core with orbiting particles |
| `nose` | `#nose` | Nasal bridge and base |
| `mouth` | `#mouth` | Lip structure |
| `chin` | `#chin` | Chin/jaw detail |
| `ears` | `#ears` | Both left and right ears |
| `particleField` | `#particleField` | Ambient luminous particles |

---

## Core Positions (CRITICAL)

### Forehead Core Position

The forehead core is the **primary cognitive visualization origin point**.

**SVG Coordinates:** `[0, -155]`
- X: 0 (horizontally centered)
- Y: -155 (in the forehead area, above eyes)

**Bounding Box:** `[-25, -180, 50, 50]` (x, y, width, height)

**Visual Structure:**
- Bright central neural light with concentric energy rings
- Radial energy beams extending outward
- Three orbiting particles with different rotation speeds
- Multi-layer glow effect

### Chest Core Position

Secondary energy center in the upper chest.

**SVG Coordinates:** `[0, 35]`
- X: 0 (horizontally centered)
- Y: 35 (below neck, upper chest area)

**Bounding Box:** `[-18, 17, 36, 36]`

---

## Coordinate System

The SVG uses a viewBox of `-300 -350 600 700`:
- Origin (0, 0) is at the center of the torso/chest
- X increases rightward (-300 to 300)
- Y increases downward (-350 to 350)

To convert SVG coordinates to screen pixels:

```typescript
import { svgToScreen } from './JarvisRegions';

const [pixelX, pixelY] = svgToScreen(0, -155, 400, 467);
// Returns forehead core position in pixels for a 400x467 display
```

---

## How to Load in React

### Basic Usage

```tsx
import JarvisVector from './JarvisVector';

function App() {
  return (
    <JarvisVector
      width={400}
      height={467}
      baseColor="#00ffff"
      opacity={1}
      enableGlow={true}
    />
  );
}
```

### Advanced Programmatic Control

```tsx
import { useRef, useEffect } from 'react';
import JarvisVector, { type JarvisRegions } from './JarvisVector';

function AdvancedJarvis() {
  const jarvisRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (jarvisRef.current) {
      // Access regions directly
      const leftEye = jarvisRef.current.querySelector('#leftEye');
      if (leftEye) {
        leftEye.setAttribute('opacity', '0.3');
      }

      // Change forehead core color
      const foreheadCore = jarvisRef.current.querySelector('#foreheadCore');
      if (foreheadCore) {
        const circles = foreheadCore.querySelectorAll('circle');
        circles.forEach(c => c.setAttribute('fill', '#ff6600'));
      }
    }
  }, []);

  return <JarvisVector ref={jarvisRef} />;
}
```

### Using JarvisRegions Utilities

```typescript
import { 
  FOREHEAD_CORE_POSITION,
  CHEST_CORE_POSITION,
  getForeheadCoreScreenPosition,
  JARVIS_REGIONS 
} from './JarvisRegions';

// Get all region definitions
console.log(JARVIS_REGIONS.foreheadCore);
// { id: 'foreheadCore', name: 'Forehead Core', ... }

// Get screen position for overlay positioning
const [x, y] = getForeheadCoreScreenPosition(400, 467);
// Use this to position cognitive nodes around the head
```

---

## How to Independently Alter Regions

### Change Color

```javascript
const region = document.getElementById('leftEye');
const elements = region.querySelectorAll('*');
elements.forEach(el => {
  if (el.getAttribute('fill')?.startsWith('#')) {
    el.setAttribute('fill', '#ff6600'); // Orange
  }
});
```

### Change Opacity

```javascript
const region = document.getElementById('brain');
region.setAttribute('opacity', '0.3');
```

### Toggle Visibility

```javascript
const region = document.getElementById('particleField');
region.style.display = 'none'; // or 'block'
```

### Animate Programmatically

```javascript
const foreheadCore = document.getElementById('foreheadCore');
foreheadCore.animate([
  { transform: 'scale(1)' },
  { transform: 'scale(1.2)' },
  { transform: 'scale(1)' }
], {
  duration: 1000,
  iterations: Infinity
});
```

---

## Performance Considerations

1. **File Size:** The SVG is approximately 25KB uncompressed
2. **DOM Elements:** ~150 individual SVG elements for detailed neural networks
3. **Animations:** SMIL animations are GPU-accelerated in modern browsers
4. **Filters:** Glow filters use Gaussian blur — limit simultaneous filter usage
5. **Particles:** Particle count is optimized (~50 visible particles with varying opacity)
6. **React Rendering:** Use `React.memo()` if embedding in frequently-re-rendering components

### Optimization Tips

```tsx
// Memoize the component
const MemoizedJarvis = React.memo(JarvisVector);

// Disable animations when not visible
<JarvisVector animateParticles={isVisible} />

// Reduce glow for better performance
<JarvisVector enableGlow={false} />
```

---

## Visual Tests

Open `preview/index.html` in a browser to see:

1. **Front View** — Full head + shoulders + upper chest
2. **Head Close-Up** — Zoomed view showing eyes, nose, mouth, forehead core, neural density

### Comparison Checklist

Verify against reference:
- [ ] Head width/height ratio (realistic adult proportions)
- [ ] Forehead curvature and prominence
- [ ] Eye spacing and socket depth
- [ ] Nose bridge and base definition
- [ ] Mouth/lip structure
- [ ] Jaw angle and chin
- [ ] Ear placement
- [ ] Neck width and transition
- [ ] Shoulder slope
- [ ] Neural density throughout
- [ ] Cyan/turquoise/blue color palette
- [ ] Forehead core brightness and structure
- [ ] Chest core presence

---

## What's NOT Included

Per requirements, this asset does NOT contain:
- External neural branches/tentacles from chest
- Memory nodes or project connections
- Tree roots or vines
- Lower torso, waist, legs
- Pedestal or floor platform
- UI dashboard elements
- AgenticOS integration code

Cognitive nodes around the head will be added via a separate runtime system originating from the `foreheadCore` position.

---

## Browser Support

- Chrome/Edge 80+
- Firefox 75+
- Safari 13+
- Electron 8+

SMIL animations work in all modern browsers. For IE11 support, CSS animations would need to replace SMIL.

---

## License

This asset is proprietary and intended for use within the JARVIS/AgenticOS ecosystem only.

---

## Next Steps (Post-Approval)

Once visually approved, the following can be implemented separately:
1. Dynamic cognitive node system originating from foreheadCore
2. Voice visualization synced to audio input
3. State-based color changes (thinking, listening, speaking)
4. Integration with Hermes/CodeX/Memory systems
5. React context provider for global JARVIS state

**DO NOT proceed with integration until the standalone asset is visually approved.**
