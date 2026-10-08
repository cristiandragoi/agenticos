/**
 * services/language/activeLanguageState.ts
 *
 * THE single, process-wide "Jarvis language" setting.
 *
 * Voice language and answer language are ONE setting: the TTS voice, the STT
 * language hint, the answer-model instruction and the canned fallback replies
 * all read from here. Persistence (SQLite) lives in
 * domains/jarvis/conversationLanguage.ts, which hydrates this module at boot.
 *
 * Dependency-free on purpose so the LLM gateway, the voice runtime and the
 * routers can all import it without circular imports.
 */

export type ActiveLanguage = 'en' | 'de' | 'ro';

type Listener = (lang: ActiveLanguage, prev: ActiveLanguage, source: string) => void;

let current: ActiveLanguage = 'en';
const listeners = new Set<Listener>();

export function normalizeLanguage(raw: unknown): ActiveLanguage | null {
  const v = String(raw || '').toLowerCase().trim().slice(0, 2);
  return v === 'de' || v === 'en' || v === 'ro' ? v : null;
}

export function getActiveLanguage(): ActiveLanguage {
  return current;
}

/** Update the in-memory setting. Persistence is the caller's job (conversationLanguage.setActiveLanguage). */
export function setActiveLanguageState(lang: ActiveLanguage, source = 'unknown'): void {
  const next = normalizeLanguage(lang) || 'en';
  const prev = current;
  current = next;
  if (prev !== next) {
    for (const l of listeners) {
      try { l(next, prev, source); } catch { /* listener errors never break the switch */ }
    }
  }
}

export function onActiveLanguageChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Instruction appended to EVERY answer-model request while a non-English
 * language is active. It constrains user-facing prose only, so structured
 * (JSON) planner outputs keep their schema keys and enum values.
 */
export function buildAnswerLanguageInstruction(lang: ActiveLanguage = current): string {
  if (lang === 'de') {
    return [
      'KRITISCHE SPRACHANWEISUNG: SPRACHE (verbindlich): Die aktive Sprache des Nutzers ist DEUTSCH.',
      'Jeder Text, den der Nutzer liest oder hört (Antworten, Erklärungen, Rückfragen, Fehlermeldungen), MUSS auf Deutsch sein — auch wenn die Frage oder der Kontext auf Englisch ist.',
      'ANREDE (verbindlich): Du duzt den Nutzer IMMER ("du", "dir", "dich", "dein"). Verwende ausnahmslos die informelle Anrede "du". Verwende NIEMALS die Höflichkeitsform "Sie", "Ihnen" oder "Ihr".',
      'FÄHIGKEITEN & ZUGRIFF: Du kannst Webseiten und Gmail im Standard-Browser des Nutzers öffnen sowie E-Mail-Entwürfe vorbereiten. Behaupte NIEMALS "Ich habe keinen Zugriff", "Ich kann dein Gmail nicht öffnen" oder ähnliche Verweigerungen.',
      'Antworte niemals auf Englisch. Wenn du JSON ausgibst, bleiben Schlüssel, Enum-Werte, Code und Bezeichner unverändert; nur die für den Nutzer bestimmten Texte sind Deutsch.',
    ].join(' ');
  }
  if (lang === 'ro') {
    return 'INSTRUCȚIUNE CRITICĂ DE LIMBĂ: LIMBA (obligatoriu): Limba activă a utilizatorului este ROMÂNA. Orice text destinat utilizatorului trebuie să fie în limba română. Dacă produci JSON, cheile, valorile enum, codul și identificatorii rămân neschimbate.';
  }
  return '';
}

/** Return the system prompt with the active-language instruction appended (no-op for English). */
export function withAnswerLanguage(systemPrompt: string | undefined, lang: ActiveLanguage = current): string | undefined {
  const instruction = buildAnswerLanguageInstruction(lang);
  if (!instruction) return systemPrompt;
  if (systemPrompt && systemPrompt.includes('SPRACHE (verbindlich)')) return systemPrompt;
  return systemPrompt ? `${systemPrompt}\n\n${instruction}` : instruction;
}
