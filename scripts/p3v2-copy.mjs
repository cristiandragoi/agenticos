// Replace src/components/jarvis-visualization with v2's exact files.
import fs from 'node:fs';

const SRC = 'B:/AgenticOS/Humanoid-JARVIS/v2-staging/Humanoid-JARVIS-v2';
const DST = 'B:/AgenticOS/src/components/jarvis-visualization';

// v1-only files to remove (v2 has no demo, no separate humanoid/network/particles).
for (const f of ['HumanoidCore.tsx', 'NeuralNetwork.tsx', 'ParticleField.tsx', 'useJarvisAnimator.ts', 'JarvisDemo.tsx', 'JarvisDemo.css']) {
  const p = `${DST}/${f}`;
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('REMOVED ' + f); }
}

// Copy v2 files (overwrites v1 JarvisState/Visualization/CSS/index).
for (const f of ['JarvisTypes.ts', 'JarvisState.ts', 'useJarvisAnimation.ts', 'JarvisHumanoid.tsx', 'JarvisSystemNodes.tsx', 'JarvisVisualization.tsx', 'JarvisVisualization.css', 'index.ts']) {
  fs.copyFileSync(`${SRC}/${f}`, `${DST}/${f}`);
  console.log('COPIED ' + f);
}
console.log('NOW IN FOLDER: ' + fs.readdirSync(DST).sort().join(', '));
