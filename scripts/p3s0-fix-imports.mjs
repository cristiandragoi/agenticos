// Fix verbatimModuleSyntax violations in the copied package:
// type-only named imports must use `import type`.
import fs from 'node:fs';

const D = 'B:/AgenticOS/src/components/jarvis/visualization';

function fix(file, subs) {
  const p = `${D}/${file}`;
  let s = fs.readFileSync(p, 'utf8');
  for (const [from, to] of subs) {
    if (!s.includes(from)) { console.log(`SKIP ${file}: pattern missing: ${from.slice(0, 60)}`); continue; }
    s = s.replace(from, to);
  }
  fs.writeFileSync(p, s);
  console.log(`FIXED ${file}`);
}

fix('HumanoidCore.tsx', [
  [
    "import { AnimatorState, getChannelColor } from './useJarvisAnimator';\nimport { VisualChannel, LayerId } from './JarvisState';",
    "import { getChannelColor } from './useJarvisAnimator';\nimport type { AnimatorState } from './useJarvisAnimator';\nimport type { VisualChannel, LayerId } from './JarvisState';",
  ],
]);

fix('NeuralNetwork.tsx', [
  [
    "import { AnimatorState, getChannelColor } from './useJarvisAnimator';\nimport { SYSTEM_NODE_CONFIG, SystemNode } from './JarvisState';",
    "import { getChannelColor } from './useJarvisAnimator';\nimport type { AnimatorState } from './useJarvisAnimator';\nimport { SYSTEM_NODE_CONFIG } from './JarvisState';\nimport type { SystemNode } from './JarvisState';",
  ],
]);

fix('SystemNodes.tsx', [
  [
    "import { AnimatorState, getChannelColor } from './useJarvisAnimator';\nimport { SYSTEM_NODE_CONFIG, SystemNode, VisualChannel } from './JarvisState';",
    "import { getChannelColor } from './useJarvisAnimator';\nimport type { AnimatorState } from './useJarvisAnimator';\nimport { SYSTEM_NODE_CONFIG } from './JarvisState';\nimport type { SystemNode, VisualChannel } from './JarvisState';",
  ],
]);

fix('useJarvisAnimator.ts', [
  [
    "import {\n  JarvisState,\n  VisualChannel,\n  LayerId,\n  SystemNode,\n  Severity,\n  STATE_CHANNEL_MAP,\n  STATE_LAYER_PRESETS,\n  CHANNEL_COLORS,\n  ANIMATION_CONFIG,\n} from './JarvisState';",
    "import type { JarvisState, VisualChannel, LayerId, SystemNode, Severity } from './JarvisState';\nimport { STATE_CHANNEL_MAP, STATE_LAYER_PRESETS, CHANNEL_COLORS, ANIMATION_CONFIG } from './JarvisState';",
  ],
]);

fix('JarvisVisualization.tsx', [
  [
    "import {\n  JarvisVisualizationProps,\n  JarvisState,\n  SystemNode,\n  VisualChannel,\n} from './JarvisState';",
    "import type { JarvisVisualizationProps, JarvisState, SystemNode, VisualChannel } from './JarvisState';",
  ],
]);
