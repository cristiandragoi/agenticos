/**
 * JarvisV2 — state/color core (standalone, NOT wired to AgenticOS runtime).
 * Localized state visual language: the identity stays cyan; only affected
 * regions shift (thinking→purple brain, listening→yellow eyes, delegating→
 * pink chest path, error→red, completed→green…). NEVER a flat whole-body
 * recolor. ONE humanoid.
 */
export type JarvisStateV2 =
  | 'idle' | 'listening' | 'transcribing' | 'thinking' | 'researching'
  | 'executing' | 'delegating' | 'speaking' | 'completed' | 'warning'
  | 'error' | 'interrupted';

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type RegionId =
  | 'headSilhouette' | 'leftEye' | 'rightEye' | 'face' | 'brain'
  | 'foreheadCore' | 'faceNeurons' | 'brainNeurons' | 'neck' | 'torso'
  | 'chestNeurons' | 'chestCore' | 'lowerEnergyCore';

export const CHANNELS_V2 = {
  cyan: '#00eaff',
  cyanSoft: '#7df7ff',
  cyanDeep: '#00a8cc',
  purple: '#b86cff',
  yellow: '#ffd84d',
  pink: '#ff66d9',
  red: '#ff4d5f',
  green: '#55f59a',
  white: '#eaffff',
  dim: '#0b2740',
  bg: '#020914',
} as const;

/** Localized color per region for a given state (identity stays cyan). */
export function regionColor(state: JarvisStateV2, region: RegionId): string {
  const c = CHANNELS_V2;
  switch (region) {
    case 'brain':
    case 'foreheadCore':
    case 'brainNeurons':
      if (state === 'thinking' || state === 'researching') return c.purple;
      if (state === 'executing') return c.cyan;
      if (state === 'warning') return c.yellow;
      if (state === 'error' || state === 'interrupted') return c.red;
      return c.cyan;
    case 'leftEye':
    case 'rightEye':
      if (state === 'listening' || state === 'transcribing') return c.yellow;
      if (state === 'error' || state === 'interrupted') return c.red;
      if (state === 'speaking') return c.cyanSoft;
      return c.cyan;
    case 'chestCore':
    case 'chestNeurons':
      if (state === 'delegating') return c.pink;
      if (state === 'warning') return c.yellow;
      if (state === 'error' || state === 'interrupted') return c.red;
      if (state === 'completed') return c.green;
      return c.cyan;
    case 'face':
    case 'faceNeurons':
      if (state === 'speaking') return c.cyanSoft;
      if (state === 'warning') return c.yellow;
      if (state === 'error' || state === 'interrupted') return c.red;
      return c.cyan;
    case 'lowerEnergyCore':
      if (state === 'error' || state === 'interrupted') return c.red;
      if (state === 'completed') return c.green;
      return c.cyan;
    default:
      return c.cyan;
  }
}

export const STATE_LABELS: Record<JarvisStateV2, string> = {
  idle: 'IDLE', listening: 'LISTENING', transcribing: 'TRANSCRIBING',
  thinking: 'THINKING', researching: 'RESEARCHING', executing: 'EXECUTING',
  delegating: 'DELEGATING', speaking: 'SPEAKING', completed: 'COMPLETED',
  warning: 'WARNING', error: 'ERROR', interrupted: 'INTERRUPTED',
};

export const ALL_STATES_V2: JarvisStateV2[] = [
  'idle', 'listening', 'transcribing', 'thinking', 'researching', 'executing',
  'delegating', 'speaking', 'completed', 'warning', 'error', 'interrupted',
];

/** Deterministic PRNG so the neural mesh is stable between renders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
