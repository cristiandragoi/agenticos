/**
 * jarvisEngineAuthority.ts — Single authoritative source of truth for active Jarvis engine.
 * 
 * Enforces mutual exclusion between Jarvis V1 (production) and Jarvis V2 (dev).
 * Strictly guarantees:
 * - Exactly ONE active engine ('v1' | 'v2')
 * - When switching: halts all audio, cancels speech synthesis, aborts in-flight turns
 * - Playback deduplication: drops duplicate turns within 3000ms window
 * - Audio registration: ensures only 1 audio element can play at a time
 */

export type JarvisEngineId = 'v1' | 'v2';

const ENGINE_STORAGE_KEY = 'jarvis-active-engine';
const FALLBACK_ENGINE_KEY = 'jarvis-conversation-engine';

let currentEngine: JarvisEngineId = (() => {
  try {
    const val = localStorage.getItem(ENGINE_STORAGE_KEY) || localStorage.getItem(FALLBACK_ENGINE_KEY);
    if (val === 'v2') return 'v2';
  } catch {}
  return 'v1';
})();

const activeAudioElements = new Set<HTMLAudioElement>();
const recentTurns = new Map<string, number>(); // key: `${conversationId}:${transcript.trim().toLowerCase()}` -> timestamp

export function getActiveJarvisEngine(): JarvisEngineId {
  return currentEngine;
}

export function setActiveJarvisEngine(engine: JarvisEngineId): void {
  if (currentEngine === engine) return;

  const previousEngine = currentEngine;
  currentEngine = engine;

  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, engine);
    localStorage.setItem(FALLBACK_ENGINE_KEY, engine);
  } catch {}

  console.log(`[JarvisEngineAuthority] Engine switched: ${previousEngine} -> ${engine}. Executing full lifecycle cleanup.`);

  // 1. Halt all audio playback immediately
  stopAllJarvisAudio();

  // 2. Clear recent turn dedupe map
  recentTurns.clear();

  // 3. Broadcast engine changed event to all listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('jarvis:engine-changed', {
      detail: { engine, previousEngine }
    }));
  }
}

/**
 * Halts ALL audio across the application immediately (HTMLAudioElement + Web Speech API).
 */
export function stopAllJarvisAudio(): void {
  // Pause and clear all registered audio elements
  for (const audio of activeAudioElements) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch (err) {
      console.warn('[JarvisEngineAuthority] Error stopping audio element:', err);
    }
  }
  activeAudioElements.clear();

  // Cancel any browser SpeechSynthesis utterance
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }

  // Broadcast kill-all-speech event for any hooks listening
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('jarvis:kill-all-speech'));
  }
}

/**
 * Register an active playing audio element to prevent concurrent audio playbacks.
 */
export function registerActiveAudio(audio: HTMLAudioElement): () => void {
  // Pause any existing playing audio elements before starting a new one
  for (const existing of activeAudioElements) {
    if (existing !== audio) {
      try {
        existing.pause();
        existing.currentTime = 0;
      } catch {}
    }
  }
  activeAudioElements.clear();
  activeAudioElements.add(audio);

  const cleanup = () => {
    activeAudioElements.delete(audio);
  };

  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  audio.addEventListener('pause', cleanup, { once: true });

  return cleanup;
}

/**
 * Check if a turn should be dropped due to duplicate submission within 3000ms.
 * Returns true if duplicate (should be dropped), false if allowed.
 */
export function isDuplicateTurnSubmission(conversationId: string | null, transcript: string, windowMs = 3000): boolean {
  if (!transcript || !transcript.trim()) return false;
  const now = Date.now();
  const key = `${conversationId || 'default'}:${transcript.trim().toLowerCase()}`;
  const lastAt = recentTurns.get(key);

  // Clean up old entries
  for (const [k, at] of recentTurns.entries()) {
    if (now - at > 10000) recentTurns.delete(k);
  }

  if (lastAt && (now - lastAt < windowMs)) {
    console.warn(`[JarvisEngineAuthority] Dropping duplicate turn within ${windowMs}ms: "${transcript.slice(0, 50)}"`);
    return true;
  }

  recentTurns.set(key, now);
  return false;
}
