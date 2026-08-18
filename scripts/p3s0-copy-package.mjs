// Copy the supplied Humanoid-JARVIS package into AgenticOS src, adapting:
// - SystemNodes: add visibleNodes filter (hide unrouted nodes)
// - JarvisVisualization: passthrough visibleNodes
import fs from 'node:fs';

const SRC = 'B:/AgenticOS/Humanoid-JARVIS';
const DST = 'B:/AgenticOS/src/components/jarvis/visualization';
fs.mkdirSync(DST, { recursive: true });

for (const f of ['JarvisState.ts', 'useJarvisAnimator.ts', 'HumanoidCore.tsx', 'NeuralNetwork.tsx', 'ParticleField.tsx', 'JarvisVisualization.css']) {
  fs.copyFileSync(`${SRC}/${f}`, `${DST}/${f}`);
}

// ── SystemNodes.tsx: visibleNodes filter ──
let sn = fs.readFileSync(`${SRC}/SystemNodes.tsx`, 'utf8');
sn = sn.replace(
  '  activeNode: SystemNode | null;\n  onNodeClick?: (node: SystemNode) => void;\n}',
  '  activeNode: SystemNode | null;\n  visibleNodes?: SystemNode[];\n  onNodeClick?: (node: SystemNode) => void;\n}'
);
sn = sn.replace(
  '  activeNode,\n  onNodeClick,\n}) => {',
  '  activeNode,\n  visibleNodes,\n  onNodeClick,\n}) => {'
);
sn = sn.replace(
  '  useEffect(() => {\n    const svg = svgRef.current;\n    if (!svg) return;',
  '  const nodeList = (Object.keys(SYSTEM_NODE_CONFIG) as SystemNode[]).filter(\n    (n) => !visibleNodes || visibleNodes.includes(n)\n  );\n\n  useEffect(() => {\n    const svg = svgRef.current;\n    if (!svg) return;'
);
sn = sn.replace(
  '      (Object.keys(SYSTEM_NODE_CONFIG) as SystemNode[]).forEach((nodeName) => {',
  '      nodeList.forEach((nodeName) => {'
);
sn = sn.replace('  }, [animator, activeNode]);', '  }, [animator, activeNode, visibleNodes]);');
sn = sn.replace(
  '  const nodes = Object.entries(SYSTEM_NODE_CONFIG) as [SystemNode, typeof SYSTEM_NODE_CONFIG[SystemNode]][];',
  '  const nodes = nodeList.map((name) => [name, SYSTEM_NODE_CONFIG[name]] as [SystemNode, typeof SYSTEM_NODE_CONFIG[SystemNode]]);'
);
fs.writeFileSync(`${DST}/SystemNodes.tsx`, sn);

// ── JarvisVisualization.tsx: visibleNodes passthrough ──
let jv = fs.readFileSync(`${SRC}/JarvisVisualization.tsx`, 'utf8');
jv = jv.replace(
  '  onNodeClick?: (node: SystemNode) => void;\n  onCoreClick?: () => void;\n  className?: string;',
  '  onNodeClick?: (node: SystemNode) => void;\n  onCoreClick?: () => void;\n  /** Subset of SYSTEM_NODE_CONFIG to render (unrouted nodes hidden). */\n  visibleNodes?: SystemNode[];\n  className?: string;'
);
jv = jv.replace(
  '  nodeActivity = {},\n  layerOverrides,\n  onNodeClick,\n  onCoreClick,\n  className = \'\',',
  '  nodeActivity = {},\n  layerOverrides,\n  onNodeClick,\n  onCoreClick,\n  visibleNodes,\n  className = \'\','
);
jv = jv.replace(
  '        activeNode={activeNode}\n        onNodeClick={onNodeClick}',
  '        activeNode={activeNode}\n        visibleNodes={visibleNodes}\n        onNodeClick={onNodeClick}'
);
fs.writeFileSync(`${DST}/JarvisVisualization.tsx`, jv);

console.log('COPIED ' + fs.readdirSync(DST).length + ' files to ' + DST);
