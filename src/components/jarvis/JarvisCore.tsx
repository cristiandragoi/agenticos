import React, { useMemo } from 'react';
import { JarvisVisualization } from '../jarvis-visualization';
import type { JarvisNodeId } from '../jarvis-visualization';
import { mapAgenticState, pickActiveNode } from './jarvisVisualizationAdapter';

/* ── J.A.R.V.I.S — PROGRAMMATIC HUMANOID (Humanoid-JARVIS v2) ───────────
 * The ONE central humanoid is 100% programmatic SVG (JarvisHumanoid):
 * bust/face/eyes/brain-mesh/neural-traces/chest/mouth — each region
 * independently driven by the real runtime state via the animation frame.
 * NO raster: no <img>, no Image(), no drawImage, no PNG.
 * The clickable orbital nodes (JarvisSystemNodes) carry REAL routes.
 * ────────────────────────────────────────────────────────────────────── */

export type JarvisCoreState =
  | 'idle' | 'listening' | 'reasoning' | 'executing' | 'delegated'
  | 'repairing' | 'warning' | 'error' | 'completed' | 'speaking' | 'offline';

export interface JarvisCoreProps {
  state?: string;
  activeAgent?: string | null;
  outputLevel?: number; // REAL TTS playback amplitude (0..1) — drives mouth/face
  inputLevel?: number;  // REAL mic amplitude (0..1)
  size?: number;
  reducedMotion?: boolean;
  testIdPrefix?: string;
  /** 0..1 per JarvisNodeId — real runtime activity drives the node pulse. */
  nodeActivity?: Partial<Record<JarvisNodeId, number>>;
}

/* AgenticOS color contract (spec §6) — semantic colors per state. */
export const JARVIS_HEAD_COLORS: Record<string, { main: string; soft: string; rim: string }> = {
  idle:       { main: '#00eaff', soft: '#7df7ff', rim: '#00eaff' },   // TURQUOISE — identity
  listening:  { main: '#3b82f6', soft: '#93c5fd', rim: '#60a5fa' },   // BLUE
  reasoning:  { main: '#b86cff', soft: '#d8b4fe', rim: '#a855f7' },   // PURPLE
  executing:  { main: '#00eaff', soft: '#7df7ff', rim: '#00ffff' },   // BRIGHT TURQUOISE
  delegated:  { main: '#ff66d9', soft: '#f9a8d4', rim: '#f472b6' },   // PINK
  repairing:  { main: '#b86cff', soft: '#c084fc', rim: '#a855f7' },   // PURPLE
  warning:    { main: '#ffd84d', soft: '#fcd34d', rim: '#fbbf24' },   // YELLOW/AMBER
  error:      { main: '#ff4d5f', soft: '#fca5a5', rim: '#f87171' },   // RED
  completed:  { main: '#55f59a', soft: '#86efac', rim: '#4ade80' },   // GREEN (brief)
  transcribing: { main: '#55f59a', soft: '#86efac', rim: '#4ade80' }, // GREEN (STT)
  speaking:   { main: '#a855f7', soft: '#d8b4fe', rim: '#c084fc' },   // PURPLE (voice)
  offline:    { main: '#7f1d1d', soft: '#dc2626', rim: '#991b1b' },   // RED (off)
};

export function JarvisCore({
  state = 'idle',
  activeAgent = null,
  outputLevel = 0,
  inputLevel = 0,
  size = 220,
  reducedMotion = false,
  testIdPrefix = 'jarvis-orb',
  nodeActivity = {},
}: JarvisCoreProps) {
  void inputLevel;
  void reducedMotion;

  const mapped = useMemo(() => mapAgenticState(state), [state]);
  const activeNode = useMemo(() => pickActiveNode(nodeActivity), [nodeActivity]);

  const handleNodeClick = useMemo(() => (_node: JarvisNodeId, route?: string) => {
    if (route) window.location.hash = route;
  }, []);

  return (
    <div
      data-testid={testIdPrefix}
      data-orb-state={state}
      data-active-agent={activeAgent || ''}
      style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <JarvisVisualization
        state={mapped.state}
        severity={mapped.severity}
        isConnected={mapped.isConnected}
        thinkingIntensity={mapped.thinkingIntensity}
        speakingLevel={state === 'speaking' ? outputLevel : 0}
        activeNode={activeNode}
        activeAgent={activeAgent}
        nodeActivity={nodeActivity}
        onNodeClick={handleNodeClick}
      />
    </div>
  );
}

export default JarvisCore;
