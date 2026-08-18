/**
 * JarvisNeuralSystems — the seven semantic neural modules around the humanoid.
 *
 * Reference-style circular holographic modules (icon + uppercase label + small
 * status + halo + neural connector into the figure), replacing the old pill
 * presentation. Seven real AgenticOS capabilities only:
 *   MEMORY → brain / upper head          VISION → eyes / visual cortex
 *   KNOWLEDGE → temple region            PROJECTS → right operational branch
 *   HERMES → lower agent-communication   RUNS → lower execution systems
 *   ARTIFACTS → output / creation branch
 *
 * Every anchor is taken from the measured reference geometry (REF.*) or from
 * the humanoid's own silhouette — never invented. Activation comes ONLY from
 * real runtime signals (nodeActivity), state colors follow the same localized
 * language as the humanoid (regionColor). Traveling pulses are declarative
 * SMIL (<animateMotion>) and the dashed inner ring is a CSS rotation — no
 * per-frame React state, GPU-light, safe for jsdom tests.
 */
import React from 'react';
import { Database, Eye, BookOpen, FolderKanban, Bot, Play, FileText, type LucideIcon } from 'lucide-react';
import type { NeuralNodeId } from '../jarvis/neuralBlobState';
import { NODE_DIRECTION } from '../jarvis/neuralBlobState';
import type { JarvisStateV2 } from './JarvisStateV2';

export interface NeuralModuleDef {
  id: NeuralNodeId;
  label: string;
  icon: LucideIcon;
  /** Module circle center (viewBox 0 0 1000 1250). */
  x: number;
  y: number;
  /** Connection target anchor (figure region). */
  tx: number;
  ty: number;
  /** Small status line under the label — semantic, derived from real state. */
  status: (state: JarvisStateV2, active: boolean) => string;
}

/** Module circle radius (viewBox units). */
export const MODULE_R = 32;

/** Anchored to the measured figure: head spans x≈165–835, y 100–672;
 *  neck y≈684, shoulders y≈903, chest core (445, 976), brain core (483, 144),
 *  eyes y≈363, nose (500, 500), mouth (500, 580). Modules live in the margins
 *  and connect inward, clear of the silhouette. */
export const NEURAL_MODULES: NeuralModuleDef[] = [
  {
    id: 'MEMORY', label: 'MEMORY', icon: Database, x: 104, y: 200, tx: 470, ty: 172,
    status: (s, a) => !a ? 'STANDBY' : (s === 'thinking' || s === 'researching' ? 'RETRIEVING' : 'ACCESSED'),
  },
  {
    id: 'VISION', label: 'VISION', icon: Eye, x: 896, y: 268, tx: 648, ty: 340,
    status: (s, a) => !a ? 'STANDBY' : (s === 'listening' || s === 'transcribing' ? 'FOCUSED' : 'SCANNING'),
  },
  {
    id: 'KNOWLEDGE', label: 'KNOWLEDGE', icon: BookOpen, x: 102, y: 486, tx: 236, ty: 470,
    status: (s, a) => !a ? 'STANDBY' : (s === 'researching' ? 'SEARCHING' : 'CONSULTING'),
  },
  {
    id: 'PROJECTS', label: 'PROJECTS', icon: FolderKanban, x: 896, y: 540, tx: 772, ty: 540,
    status: (s, a) => !a ? 'STANDBY' : (s === 'executing' ? 'LOADED' : 'SYNCED'),
  },
  {
    id: 'HERMES', label: 'HERMES', icon: Bot, x: 138, y: 806, tx: 300, ty: 706,
    status: (s, a) => !a ? 'STANDBY' : (s === 'delegating' ? 'LINKED' : 'SENDING'),
  },
  {
    id: 'ARTIFACTS', label: 'ARTIFACTS', icon: FileText, x: 884, y: 830, tx: 716, ty: 858,
    status: (s, a) => !a ? 'STANDBY' : (s === 'completed' ? 'WRITING' : 'OUTPUT'),
  },
  {
    id: 'RUNS', label: 'RUNS', icon: Play, x: 500, y: 1090, tx: 452, ty: 1020,
    status: (s, a) => !a ? 'STANDBY' : (s === 'executing' ? 'EXECUTING' : 'RUNNING'),
  },
];

const DIM = 'rgba(103,232,249,0.5)';
const DIM_LINE = 'rgba(103,232,249,0.14)';

/** Module accent: state-driven localized color, activity brightens it. */
function moduleColor(id: NeuralNodeId, state: JarvisStateV2, active: boolean): string {
  if (state === 'error' || state === 'interrupted') return '#ff4d5f';
  if (state === 'warning') return '#ffd84d';
  if (!active) return DIM;
  switch (id) {
    case 'MEMORY':
    case 'KNOWLEDGE':
      return state === 'thinking' || state === 'researching' ? '#b86cff' : '#7df7ff';
    case 'VISION':
      return state === 'listening' || state === 'transcribing' ? '#ffd84d' : '#7df7ff';
    case 'HERMES':
      return state === 'delegating' ? '#ff66d9' : '#7df7ff';
    case 'RUNS':
      return state === 'executing' ? '#7df7ff' : '#67e8f9';
    case 'ARTIFACTS':
      return state === 'completed' ? '#55f59a' : '#67e8f9';
    case 'PROJECTS':
      return state === 'executing' ? '#a5b4fc' : '#67e8f9';
    default:
      return '#67e8f9';
  }
}

/** Curved connector from the module's rim toward its figure anchor. */
function modulePath(m: NeuralModuleDef): { d: string; sx: number; sy: number } {
  const dx = m.tx - m.x;
  const dy = m.ty - m.y;
  const len = Math.hypot(dx, dy) || 1;
  const sx = m.x + (dx / len) * MODULE_R;
  const sy = m.y + (dy / len) * MODULE_R;
  const midX = (sx + m.tx) / 2;
  const midY = (sy + m.ty) / 2;
  // gentle arc: perpendicular offset, clamped so short paths stay short
  const off = Math.min(34, len * 0.12);
  const px = -(dy / len);
  const py = dx / len;
  return {
    d: `M ${sx} ${sy} Q ${midX + px * off} ${midY + py * off} ${m.tx} ${m.ty}`,
    sx,
    sy,
  };
}

export interface JarvisNeuralSystemsProps {
  state: JarvisStateV2;
  /** Real subsystem activity 0..1 (keys Memory/Knowledge/... — see nodePulse). */
  pulses?: Partial<Record<string, number>>;
  onNodeClick?: (node: NeuralNodeId) => void;
}

export const JarvisNeuralSystems: React.FC<JarvisNeuralSystemsProps> = React.memo(
  function JarvisNeuralSystemsInner({
    state,
    pulses,
    onNodeClick,
  }: JarvisNeuralSystemsProps) {
  return (
    <svg
      viewBox="0 0 1000 1250"
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="jv2-module-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00eaff" stopOpacity="0.4" />
          <stop offset="55%" stopColor="#00eaff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#00eaff" stopOpacity="0" />
        </radialGradient>
        <filter id="jv2-module-glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {NEURAL_MODULES.map((m) => {
        const act = Math.min(1, Math.max(0, pulses?.[m.id] ?? pulses?.[m.label] ?? 0));
        const active = act > 0.05;
        const color = moduleColor(m.id, state, active);
        const { d } = modulePath(m);
        const dir = NODE_DIRECTION[m.id] === 'in' ? 1 : 0; // pulse travel direction
        const statusText = m.status(state, active);
        const Icon = m.icon;
        const labelY = m.y + MODULE_R + 15;
        const statusY = m.y + MODULE_R + 31;
        return (
          <g
            key={m.id}
            pointerEvents={onNodeClick ? 'all' : 'none'}
            style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
            onClick={() => onNodeClick?.(m.id)}
          >
            {/* Connection pathway into the figure */}
            <path
              d={d}
              fill="none"
              stroke={active ? color : DIM_LINE}
              strokeWidth={active ? 1.8 : 1.1}
              strokeDasharray={active ? undefined : '3 7'}
              strokeLinecap="round"
              opacity={active ? 0.9 : 0.8}
            />
            {/* Traveling pulse on active pathways (declarative SMIL — no React frames) */}
            {active && (
              <circle r="4" fill={color} opacity="0.95" filter="url(#jv2-module-glow)">
                <animateMotion dur="1.8s" repeatCount="indefinite" path={d} keyPoints={dir ? '0;1' : '1;0'} keyTimes="0;1" calcMode="linear" />
              </circle>
            )}

            {/* Halo — soft radial glow behind the module */}
            <circle cx={m.x} cy={m.y} r={54} fill="url(#jv2-module-halo)" opacity={active ? 0.95 : 0.4} className="jv2-module-halo" />
            <circle cx={m.x} cy={m.y} r={44} fill={color} opacity={active ? 0.07 : 0.03} />

            {/* Circular holographic frame */}
            <circle cx={m.x} cy={m.y} r={MODULE_R} fill="rgba(2,9,20,0.55)" stroke={active ? color : 'rgba(103,232,249,0.35)'} strokeWidth={active ? 1.6 : 1} />
            <circle cx={m.x} cy={m.y} r={MODULE_R + 4} fill="none" stroke={active ? color : 'rgba(103,232,249,0.2)'} strokeWidth={0.6} opacity={0.55} />
            {/* rotating dashed inner ring (CSS — zero React churn) */}
            <circle cx={m.x} cy={m.y} r={MODULE_R - 5} fill="none" stroke={active ? color : 'rgba(103,232,249,0.28)'} strokeWidth={0.7} opacity={0.8} strokeDasharray="3 8" className="jv2-module-spin" />

            {/* Icon */}
            <g transform={`translate(${m.x - 11}, ${m.y - 11})`} opacity={active ? 1 : 0.72}>
              <Icon size={22} strokeWidth={1.8} color={active ? '#eaffff' : color} />
            </g>

            {/* Label + status below the ring */}
            <text
              x={m.x}
              y={labelY}
              textAnchor="middle"
              fontSize={16}
              fontWeight={600}
              letterSpacing={2.2}
              fill={active ? '#eaffff' : 'rgba(186,230,253,0.85)'}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >
              {m.label}
            </text>
            <text
              x={m.x}
              y={statusY}
              textAnchor="middle"
              fontSize={10.5}
              letterSpacing={1.6}
              fill={active ? color : 'rgba(148,197,233,0.55)'}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >
              {statusText}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

export default JarvisNeuralSystems;
