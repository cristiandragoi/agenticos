import type { JarvisNodeConfig, JarvisNodeId, JarvisState, Severity } from './JarvisTypes';

export const CHANNELS = {
  cyan: '#00eaff',
  cyanSoft: '#7df7ff',
  purple: '#b86cff',
  yellow: '#ffd84d',
  pink: '#ff66d9',
  red: '#ff4d5f',
  green: '#55f59a',
  dim: '#193247',
} as const;

export function stateColor(state: JarvisState, severity: Severity = 'none'): string {
  if (severity === 'critical' || severity === 'high' || state === 'error' || state === 'interrupted') {
    return CHANNELS.red;
  }
  if (state === 'warning' || state === 'listening' || state === 'transcribing') {
    return CHANNELS.yellow;
  }
  if (state === 'delegating') return CHANNELS.pink;
  if (state === 'thinking' || state === 'researching') return CHANNELS.purple;
  return CHANNELS.cyan;
}

export const DEFAULT_NODES: JarvisNodeConfig[] = [
  { id: 'Memory',    label: 'MEMORY',    route: '#/memory',          x: 16, y: 28, side: 'left'  },
  { id: 'Projects',  label: 'PROJECTS',  route: '#/mission-control', x: 11, y: 43, side: 'left'  },
  { id: 'Knowledge', label: 'KNOWLEDGE', route: '#/research',        x: 13, y: 60, side: 'left'  },
  { id: 'Artifacts', label: 'ARTIFACTS', route: '#/builds',          x: 20, y: 76, side: 'left'  },
  { id: 'Hermes',    label: 'HERMES',    route: '#/hermes-studio',   x: 84, y: 28, side: 'right' },
  { id: 'CodeX',     label: 'CODEX',     route: '#/codex',           x: 89, y: 43, side: 'right' },
  { id: 'Runs',      label: 'RUNS',      route: '#/runs',            x: 87, y: 60, side: 'right' },
  { id: 'Vision',    label: 'VISION',    route: '#/video',           x: 80, y: 76, side: 'right' },
];

export const ALL_NODE_IDS: JarvisNodeId[] = [
  'Memory', 'Projects', 'Knowledge', 'Hermes', 'CodeX', 'Runs', 'Artifacts', 'Vision', 'Oracle'
];
