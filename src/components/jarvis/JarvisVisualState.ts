/**
 * JarvisVisualState.ts — Central Visual State & Color Token Contract
 *
 * Implements Section 22:
 * Formalizes the Jarvis orb state colors and semantic mappings:
 * - STANDBY / READY / LISTENING          → TURQUOISE / BLUE-GREEN (#00e5ff / #14b8a6)
 * - THINKING / PROCESSING                → PURPLE (#a855f7 / #8b5cf6)
 * - SPEAKING                             → RED-PURPLE (#d946ef)
 * - WAITING_FOR_USER / ATTENTION_REQUIRED → YELLOW / AMBER (#f59e0b)
 * - DEGRADED                             → AMBER/YELLOW with pulse (#d97706)
 * - BLOCKED / ERROR                      → RED (#ef4444)
 * - VERIFIED_SUCCESS                     → GREEN briefly (#10b981), then returns to TURQUOISE
 *
 * Contract:
 * - Standby/idle NEVER uses yellow.
 * - Single authoritative visual token contract across all UI components.
 */

export type JarvisSemanticState =
  | 'STANDBY'
  | 'READY'
  | 'LISTENING'
  | 'THINKING'
  | 'PROCESSING'
  | 'SPEAKING'
  | 'WAITING_FOR_USER'
  | 'ATTENTION_REQUIRED'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'ERROR'
  | 'VERIFIED_SUCCESS';

export const JARVIS_VISUAL_COLORS = {
  TURQUOISE: '#00e5ff',
  BLUE_GREEN: '#14b8a6',
  PURPLE: '#a855f7',
  PURPLE_DEEP: '#8b5cf6',
  RED_PURPLE: '#d946ef',
  AMBER: '#f59e0b',
  DEGRADED_AMBER: '#d97706',
  RED: '#ef4444',
  GREEN: '#10b981',
  OFFLINE_RED: '#7f1d1d',
} as const;

export type JarvisVisualState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'offline'
  | 'reasoning'
  | 'executing'
  | 'delegated'
  | 'repairing'
  | 'warning'
  | 'completed';

export const JARVIS_ORB_COLORS: Record<JarvisVisualState, string> = {
  // STANDBY / READY / LISTENING → TURQUOISE / BLUE-GREEN
  idle: JARVIS_VISUAL_COLORS.TURQUOISE,
  listening: JARVIS_VISUAL_COLORS.TURQUOISE,
  transcribing: JARVIS_VISUAL_COLORS.BLUE_GREEN,
  executing: JARVIS_VISUAL_COLORS.TURQUOISE,

  // THINKING / PROCESSING → PURPLE
  thinking: JARVIS_VISUAL_COLORS.PURPLE,
  reasoning: JARVIS_VISUAL_COLORS.PURPLE_DEEP,
  delegated: JARVIS_VISUAL_COLORS.PURPLE,
  repairing: JARVIS_VISUAL_COLORS.PURPLE_DEEP,

  // SPEAKING → RED-PURPLE
  speaking: JARVIS_VISUAL_COLORS.RED_PURPLE,

  // WAITING_FOR_USER / ATTENTION_REQUIRED / DEGRADED → YELLOW / AMBER
  warning: JARVIS_VISUAL_COLORS.AMBER,

  // BLOCKED / ERROR → RED
  error: JARVIS_VISUAL_COLORS.RED,
  offline: JARVIS_VISUAL_COLORS.OFFLINE_RED,

  // VERIFIED_SUCCESS → GREEN
  completed: JARVIS_VISUAL_COLORS.GREEN,
};
