/**
 * Jarvis Humanoid Visualization — State Engine
 * Production-grade TypeScript definitions for the AgenticOS runtime.
 */

// ── Visual Color Channels ──────────────────────────────────
export type VisualChannel =
  | 'cyan'      // normal / healthy / idle / connected
  | 'purple'    // resolving / deep processing / researching
  | 'yellow'    // attention / warning / listening / transcribing
  | 'pink'      // delegation / external agent / Hermes / CodeX
  | 'red';      // failure / error / interrupted

// ── Runtime States ─────────────────────────────────────────
export type JarvisState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'researching'
  | 'executing'
  | 'delegating'
  | 'speaking'
  | 'completed'
  | 'warning'
  | 'error'
  | 'interrupted';

// ── Neural Regions / System Nodes ──────────────────────────
export type SystemNode =
  | 'Memory'
  | 'Projects'
  | 'Knowledge'
  | 'Hermes'
  | 'CodeX'
  | 'Runs'
  | 'Artifacts'
  | 'Vision'
  | 'Oracle';

// ── Layer Identifiers ──────────────────────────────────────
export type LayerId =
  | 'face'
  | 'head'
  | 'eyes'
  | 'brain'
  | 'neuralPathways'
  | 'chest'
  | 'halo'
  | 'systemNodes';

// ── Severity Levels ────────────────────────────────────────
export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

// ── Public Component API ───────────────────────────────────
export interface JarvisVisualizationProps {
  /** Current runtime state of Jarvis */
  state: JarvisState;

  /** Which neural region / system node is currently active */
  activeNode?: SystemNode | null;

  /** Which external agent is delegated to (e.g. 'Hermes', 'CodeX') */
  activeAgent?: string | null;

  /** Severity of current condition */
  severity?: Severity;

  /** 0.0–1.0 intensity of speech activity (drives mouth/face pulse) */
  speakingLevel?: number;

  /** 0.0–1.0 intensity of cognitive load (drives brain glow / neural traffic) */
  thinkingIntensity?: number;

  /** Whether the system is connected to backend / SSE alive */
  isConnected?: boolean;

  /** Per-node activity levels (0.0–1.0) for independent region activation */
  nodeActivity?: Partial<Record<SystemNode, number>>;

  /** Per-layer overrides (optional — advanced use) */
  layerOverrides?: Partial<Record<LayerId, { color?: VisualChannel; intensity?: number }>>;

  /** Callback when a system node is clicked */
  onNodeClick?: (node: SystemNode) => void;

  /** Callback when the core is clicked */
  onCoreClick?: () => void;

  /** CSS class for the container */
  className?: string;

  /** Render size */
  width?: number;
  height?: number;
}

// ── Color Channel Hex Map (customizable via CSS vars) ──────
export const CHANNEL_COLORS: Record<VisualChannel, string> = {
  cyan:   '#00e5ff',
  purple: '#a855f7',
  yellow: '#fbbf24',
  pink:   '#f472b6',
  red:    '#ef4444',
};

// ── State → Default Visual Channel Mapping ─────────────────
export const STATE_CHANNEL_MAP: Record<JarvisState, VisualChannel> = {
  idle:         'cyan',
  listening:    'yellow',
  transcribing: 'yellow',
  thinking:     'purple',
  researching:  'purple',
  executing:    'cyan',
  delegating:   'pink',
  speaking:     'cyan',
  completed:    'cyan',
  warning:      'yellow',
  error:        'red',
  interrupted:  'red',
};

// ── State → Layer Intensity Presets ────────────────────────
export const STATE_LAYER_PRESETS: Record<JarvisState, Partial<Record<LayerId, number>>> = {
  idle:         { face: 0.3, brain: 0.2, neuralPathways: 0.1, chest: 0.2, halo: 0.15, systemNodes: 0.1 },
  listening:    { face: 0.6, brain: 0.4, neuralPathways: 0.3, chest: 0.3, halo: 0.4, systemNodes: 0.2 },
  transcribing: { face: 0.7, brain: 0.5, neuralPathways: 0.4, chest: 0.4, halo: 0.5, systemNodes: 0.2 },
  thinking:     { face: 0.5, brain: 0.9, neuralPathways: 0.7, chest: 0.5, halo: 0.6, systemNodes: 0.3 },
  researching:  { face: 0.5, brain: 0.95, neuralPathways: 0.85, chest: 0.5, halo: 0.7, systemNodes: 0.4 },
  executing:    { face: 0.6, brain: 0.7, neuralPathways: 0.6, chest: 0.8, halo: 0.5, systemNodes: 0.3 },
  delegating:   { face: 0.5, brain: 0.6, neuralPathways: 0.5, chest: 0.5, halo: 0.6, systemNodes: 0.7 },
  speaking:     { face: 0.9, brain: 0.5, neuralPathways: 0.4, chest: 0.6, halo: 0.5, systemNodes: 0.2 },
  completed:    { face: 0.5, brain: 0.3, neuralPathways: 0.2, chest: 0.4, halo: 0.3, systemNodes: 0.15 },
  warning:      { face: 0.7, brain: 0.5, neuralPathways: 0.4, chest: 0.5, halo: 0.6, systemNodes: 0.3 },
  error:        { face: 0.8, brain: 0.4, neuralPathways: 0.5, chest: 0.6, halo: 0.8, systemNodes: 0.2 },
  interrupted:  { face: 0.6, brain: 0.3, neuralPathways: 0.3, chest: 0.5, halo: 0.5, systemNodes: 0.2 },
};

// ── Node → Position & Visual Config ────────────────────────
export interface NodeConfig {
  angle: number;        // degrees around the humanoid
  distance: number;     // px from center
  label: string;
  icon: string;         // single unicode or SVG path
  side: 'left' | 'right';
}

export const SYSTEM_NODE_CONFIG: Record<SystemNode, NodeConfig> = {
  Memory:    { angle: -60,  distance: 180, label: 'Memory',    icon: 'M', side: 'left' },
  Projects:  { angle: -30,  distance: 190, label: 'Projects',  icon: 'P', side: 'left' },
  Knowledge: { angle: 0,    distance: 200, label: 'Knowledge', icon: 'K', side: 'left' },
  Hermes:    { angle: 30,   distance: 190, label: 'Hermes',    icon: 'H', side: 'right' },
  CodeX:     { angle: 60,   distance: 180, label: 'CodeX',     icon: 'C', side: 'right' },
  Runs:      { angle: 120,  distance: 180, label: 'Runs',      icon: 'R', side: 'right' },
  Artifacts: { angle: 150,  distance: 190, label: 'Artifacts', icon: 'A', side: 'right' },
  Vision:    { angle: 180,  distance: 200, label: 'Vision',    icon: 'V', side: 'left' },
  Oracle:    { angle: 210,  distance: 190, label: 'Oracle',    icon: 'O', side: 'left' },
};

// ── Animation Timing ───────────────────────────────────────
export const ANIMATION_CONFIG = {
  particleCount: 60,
  particleSpeedBase: 0.5,
  particleSpeedVar: 1.5,
  glowPulsePeriod: 3000,   // ms
  neuralTrafficPeriod: 2000,
  eyeBlinkInterval: 4000,
  eyeBlinkDuration: 150,
  severityFlashPeriod: 800,
} as const;
