/**
 * Jarvis visualization adapter — maps AgenticOS runtime state into the
 * programmatic package (Humanoid-JARVIS) contract, and owns the node→route
 * mapping for clickable neural nodes. Pure functions; no rendering.
 */
import type { JarvisState as PackageState, Severity, SystemNode } from './visualization/JarvisState';

export interface AgenticVisualState {
  state: PackageState;
  severity: Severity;
  isConnected: boolean;
  thinkingIntensity: number;
}

/** AgenticOS orb state → package state/severity/connectivity. */
export function mapAgenticState(orbState: string, opts?: { thinkingIntensity?: number }): AgenticVisualState {
  const ti = opts?.thinkingIntensity ?? 0;
  switch (orbState) {
    case 'listening':
      return { state: 'listening', severity: 'none', isConnected: true, thinkingIntensity: ti };
    case 'transcribing':
      return { state: 'transcribing', severity: 'none', isConnected: true, thinkingIntensity: ti };
    case 'reasoning':
    case 'repairing':
      return { state: 'thinking', severity: 'none', isConnected: true, thinkingIntensity: Math.max(ti, 0.8) };
    case 'executing':
      return { state: 'executing', severity: 'none', isConnected: true, thinkingIntensity: Math.max(ti, 0.6) };
    case 'delegated':
      return { state: 'delegating', severity: 'none', isConnected: true, thinkingIntensity: ti };
    case 'warning':
      return { state: 'warning', severity: 'medium', isConnected: true, thinkingIntensity: ti };
    case 'error':
      return { state: 'error', severity: 'high', isConnected: true, thinkingIntensity: ti };
    case 'completed':
      return { state: 'completed', severity: 'none', isConnected: true, thinkingIntensity: 0 };
    case 'speaking':
      return { state: 'speaking', severity: 'none', isConnected: true, thinkingIntensity: ti };
    case 'offline':
      return { state: 'error', severity: 'critical', isConnected: false, thinkingIntensity: 0 };
    case 'idle':
    default:
      return { state: 'idle', severity: 'none', isConnected: true, thinkingIntensity: 0 };
  }
}

/** Real destinations for the neural nodes (existing routes only — no fake pages). */
export const NODE_ROUTES: Partial<Record<SystemNode, string>> = {
  Memory: '#/memory',
  Projects: '#/mission-control',
  Knowledge: '#/research',
  Hermes: '#/hermes-studio',
  CodeX: '#/codex',
  Runs: '#/runs',
  Artifacts: '#/builds',
  Vision: '#/video',
};

/**
 * Nodes rendered around the humanoid. Oracle is NOT included: no real
 * destination exists yet, so it stays out of the visible set (per the rule
 * "do not create a fake page for a missing destination"). Add it here once
 * a real Oracle destination exists.
 */
export const VISIBLE_NODES: SystemNode[] = [
  'Memory', 'Projects', 'Knowledge', 'Hermes', 'CodeX', 'Runs', 'Artifacts', 'Vision',
];

/** The node with the strongest activity (>0.5) — drives the active-node highlight. */
export function pickActiveNode(nodeActivity: Partial<Record<SystemNode, number>> | undefined): SystemNode | null {
  if (!nodeActivity) return null;
  let best: SystemNode | null = null;
  let bestV = 0;
  for (const [node, v] of Object.entries(nodeActivity) as [SystemNode, number][]) {
    if (v > bestV) { bestV = v; best = node; }
  }
  return bestV > 0.5 ? best : null;
}
