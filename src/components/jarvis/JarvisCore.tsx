import React, { useMemo } from 'react';
import { JarvisVisualization } from '../jarvis-visualization';
import type { SystemNode } from '../jarvis-visualization';
import { mapAgenticState, NODE_ROUTES, VISIBLE_NODES, pickActiveNode } from './jarvisVisualizationAdapter';

/* ── J.A.R.V.I.S — PROGRAMMATIC HUMANOID (Slice 0 correction) ───────────
 * The central humanoid is 100% programmatic (SVG regions + canvas
 * particles), adapted from the supplied Humanoid-JARVIS package:
 *   JarvisVisualization
 *     ├─ ParticleField  (canvas — ambient neural dust, programmatic)
 *     ├─ NeuralNetwork  (SVG neural pathways, animated)
 *     ├─ HumanoidCore   (SVG: head, face, eyes, brain/core, neural,
 *     │                  chest/core — each independently controllable)
 *     ├─ SystemNodes    (SVG clickable neural nodes → real routes)
 *     └─ HUD            (state/connection/agent)
 * NO raster humanoid: no <img>, no Image(), no drawImage(), no PNG.
 * The previous raster asset (src/assets/jarvis-humanoid.png) is removed.
 * ────────────────────────────────────────────────────────────────────── */

export type JarvisCoreState =
  | 'idle' | 'listening' | 'reasoning' | 'executing' | 'delegated'
  | 'repairing' | 'warning' | 'error' | 'completed' | 'speaking' | 'offline';

export interface JarvisCoreProps {
  state?: string;
  activeAgent?: string | null;
  outputLevel?: number; // REAL TTS playback amplitude (0..1) — drives speaking pulse
  inputLevel?: number;  // REAL mic amplitude (0..1)
  size?: number;
  reducedMotion?: boolean;
  testIdPrefix?: string;
  /** 0..1 per SystemNode — real runtime activity drives the node pulse. */
  nodeActivity?: Partial<Record<SystemNode, number>>;
}

/* AgenticOS color contract (spec §6) — the semantic colors the package's
 * channels map to (idle=turquoise identity, delegated=pink, error=red…). */
export const JARVIS_HEAD_COLORS: Record<string, { main: string; soft: string; rim: string }> = {
  idle:       { main: '#00e5ff', soft: '#7ff6ff', rim: '#00d9ff' },   // TURQUOISE — identity
  listening:  { main: '#3b82f6', soft: '#93c5fd', rim: '#60a5fa' },   // BLUE
  reasoning:  { main: '#e0f2fe', soft: '#ffffff', rim: '#7ff6ff' },   // CYAN-WHITE
  executing:  { main: '#00d4ff', soft: '#7ff6ff', rim: '#00ffff' },   // BRIGHT TURQUOISE
  delegated:  { main: '#ec4899', soft: '#f9a8d4', rim: '#f472b6' },   // PINK
  repairing:  { main: '#9333ea', soft: '#c084fc', rim: '#a855f7' },   // PURPLE
  warning:    { main: '#f59e0b', soft: '#fcd34d', rim: '#fbbf24' },   // YELLOW/AMBER
  error:      { main: '#ef4444', soft: '#fca5a5', rim: '#f87171' },   // RED
  completed:  { main: '#22c55e', soft: '#86efac', rim: '#4ade80' },   // GREEN (brief)
  transcribing: { main: '#22c55e', soft: '#86efac', rim: '#4ade80' }, // GREEN (STT)
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

  const handleNodeClick = useMemo(() => (node: SystemNode) => {
    const route = NODE_ROUTES[node];
    if (route) window.location.hash = route;
  }, []);

  return (
    <div
      data-testid={testIdPrefix}
      data-orb-state={state}
      data-active-agent={activeAgent || ''}
      style={{ width: size, height: size, position: 'relative' }}
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
        visibleNodes={VISIBLE_NODES}
        onNodeClick={handleNodeClick}
        width={size}
        height={size}
      />
    </div>
  );
}

export default JarvisCore;
