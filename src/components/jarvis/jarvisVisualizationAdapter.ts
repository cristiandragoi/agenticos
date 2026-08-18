/**
 * Jarvis visualization adapter (v2) — maps AgenticOS runtime state into the
 * programmatic package (Humanoid-JARVIS v2) contract. v2's DEFAULT_NODES
 * owns the node→route mapping (real destinations, no Oracle). Pure functions.
 */
import type { JarvisState as PackageState, Severity, JarvisNodeId } from '../jarvis-visualization';

export interface AgenticVisualState {
  state: PackageState;
  severity: Severity;
  isConnected: boolean;
  thinkingIntensity: number;
}

/** AgenticOS orb state → v2 package state/severity/connectivity. */
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

/** The node with the strongest activity (>0.5) — drives the active-node highlight. */
export function pickActiveNode(nodeActivity: Partial<Record<JarvisNodeId, number>> | undefined): JarvisNodeId | null {
  if (!nodeActivity) return null;
  let best: JarvisNodeId | null = null;
  let bestV = 0;
  for (const [node, v] of Object.entries(nodeActivity) as [JarvisNodeId, number][]) {
    if (v > bestV) { bestV = v; best = node; }
  }
  return bestV > 0.5 ? best : null;
}
