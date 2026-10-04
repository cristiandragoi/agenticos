/**
 * AuthoritativeIntentCompiler.ts — Authoritative Single-Pass Intent Compiler for AgenticOS
 *
 * PHASE 1 CONTROL-PLANE COMPONENT
 *
 * Guarantees:
 * 1. Deterministic semantic normalization stage before intent compilation:
 *    cleans STT artifacts (punctuation between words/ordinals, stutter, fillers, wake-word repetition).
 * 2. Compiles user utterances into immutable CompiledTurnIntent and ordered CompiledTurnPlan.
 * 3. Compound utterances ("Open Telegram and locate Agentic OS bot", "Open Chrome and open YouTube")
 *    produce an immutable, ordered intent plan without falling back to LLM planners.
 * 4. Strict, explicit distinction between DIRECT commands and AUTONOMOUS engineering delegations.
 * 5. Worker names alone NEVER trigger delegation.
 * 6. Application names NEVER invent web URLs unless explicit web intent exists.
 * 7. Returns frozen, read-only objects to guarantee downstream immutability.
 */

import { logger } from '../../utils/logger.js';
import type { TargetContentContext } from '../jarvis/perception/targetContentExtractor.js';
import { resolveDiscourse, type DiscourseCompilerView, type DiscourseResolution } from './DiscourseReferentResolver.js';
import type { StructuredIntent } from './StructuredIntent.js';

export type CompiledAction =
  | 'OPEN_APPLICATION'
  | 'OPEN_CHAT'
  | 'READ_CONTENT'
  | 'READ_MESSAGES'
  | 'CAMERA_OBSERVE'
  | 'NAVIGATE_WEB'
  | 'OPEN_URL'
  | 'DELEGATE'
  | 'TASK_STATUS'
  | 'CONVERSATIONAL'
  | 'OTHER';

export type CompiledTargetType =
  | 'APPLICATION_WINDOW'
  | 'CHAT_CONVERSATION'
  | 'CAMERA'
  | 'WORKER'
  | 'DOCUMENT_CONTENT'
  | 'SCREEN'
  | 'WEB_URL'
  | 'NONE';

export interface CompiledTurnIntent {
  readonly action: CompiledAction;
  readonly targetType: CompiledTargetType;
  readonly application: string | null;
  readonly target: string | null;
  readonly contentRequest: string | null;
  readonly ordinal: number | null;
  readonly count: number | null;
  readonly worker: 'antigravity' | 'hermes' | 'codex' | null;
  readonly delegationRequested: boolean;
  readonly delegationTask?: string;
  readonly confidence: number;
  readonly isDirectCommand: boolean;
  readonly rawPrompt: string;
  readonly normalizedPrompt: string;
  readonly reason: string;
  readonly interpretationPath?: 'SEMANTIC_LLM' | 'DETERMINISTIC_FALLBACK';
  readonly structuredIntent?: StructuredIntent;
}

export interface CompiledTurnPlan {
  readonly steps: readonly Readonly<CompiledTurnIntent>[];
  readonly rawPrompt: string;
  readonly normalizedPrompt: string;
  readonly isCompound: boolean;
}

export interface IntentCompilerContext {
  conversationId?: string;
  activeContext?: TargetContentContext;
  interactionContextId?: string;
  activeApplication?: string | null;
  activeTarget?: string | null;
  activeChat?: string | null;
  activeContentSnapshot?: string | null;
  verifiedSelectedChat?: boolean;
  lastCompletedAction?: string | null;
  activeCapability?: string | null;
  activeUrl?: string | null;
  activeDomain?: string | null;
  activePage?: string | null;
  activePageTitle?: string | null;
  /** Read-only working-interaction-memory projection (discourse state). */
  discourse?: DiscourseCompilerView | null;
  /** Working Interaction State */
  activeSurface?: string | null;
  currentSearchQuery?: string | null;
  focusedEntity?: string | null;
  openedVideoUrls?: readonly string[];
  activePlaybackTask?: any | null;
}

/**
 * Normalizes generic desktop application entity variants into canonical names:
 * e.g. "Word document", "Microsoft Word", "Word on my laptop" -> "Word"
 * e.g. "PDF document", "PDF viewer", "PDF reader" -> "PDF"
 * e.g. "Excel spreadsheet" -> "Excel"
 */
export function normalizeApplicationEntity(input: string): string {
  if (!input) return '';
  let name = input.trim();
  // Strip vendor prefixes: "Microsoft Word" -> "Word", "Adobe Acrobat" -> "Acrobat", "Google Chrome" -> "Chrome"
  name = name.replace(/^(?:microsoft|ms|google|apple|adobe)\s+/i, '');
  // Strip trailing generic artifact/application nouns:
  name = name.replace(/\s+(?:document|doc|docs|spreadsheet|sheet|sheets|presentation|slides|viewer|reader|app|application|program|software|window|file)$/i, '');
  // Strip location/platform: "Word on my laptop" -> "Word"
  name = name.replace(/\s+(?:inside|in|on|at)\s+(?:my\s+|the\s+)?(?:laptop|computer|desktop|pc|machine|desk|lab)$/i, '');
  if (/^(?:browser|web browser)$/i.test(name.trim())) return 'Chrome';
  return name.trim();
}

/**
 * Normalizes entity naming variations.
 */
export function normalizeEntityNames(input: string): string {
  if (!input) return '';
  return input
    .replace(/\banti[- ]gravity\b/gi, 'antigravity')
    .replace(/\bcode[- ]x\b/gi, 'codex')
    .replace(/\bagentic[- ]?os[,\s]+(?:bot|bought)\b/gi, 'Agentic OS bot')
    .replace(/\bagentic[- ]?os\s+bot\b/gi, 'Agentic OS bot')
    .replace(/\bagentic[- ]?os\b/gi, 'Agentic OS')
    .replace(/\bhermis\b/gi, 'hermes')
    .replace(/\bgoogle\s+chrome\b/gi, 'Chrome')
    .trim();
}

/**
 * Deterministic Semantic-Normalization Stage BEFORE Intent Compilation.
 *
 * Cleans Whisper / STT artifacts without altering user meaning:
 * - Punctuation inserted between command and ordinal ("read. 2." -> "read 2")
 * - Punctuation between command words ("read, two" -> "read two", "read point. two" -> "read point two")
 * - Duplicated fragments ("Okay, okay", "read.2 open. read.2 open")
 * - Filler words and conversational prefixes at start ("Yes, hello Jarvis", "Okay, okay", "I said")
 * - Wake-word repetition ("Jarvis Jarvis read point two" -> "read point two")
 */
export function normalizeSpokenUtterance(raw: string): string {
  if (!raw) return '';
  let text = raw.trim();

  // 1. Collapse duplicate wake words: "Jarvis Jarvis" -> "Jarvis"
  text = text.replace(/\b(jarvis|javis|jarves)(?:[\s,.:;!?-]+\1\b)+/gi, '$1');

  // 2. Collapse immediate repeated words or short phrases:
  // e.g. "Okay, okay" -> "Okay"
  // e.g. "read read" -> "read"
  text = text.replace(/\b([a-zA-Z0-9]+)(?:[,\s.:;!?-]+\1\b)+/gi, '$1');
  text = text.replace(/\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){1,2})(?:[,\s.:;!?-]+\1\b)+/gi, '$1');

  // 3. Remove conversational filler prefixes and stutter at start of utterance:
  // e.g. "Okay, okay, read. 2." -> "read. 2."
  // e.g. "Yes, hello Jarvis. Jarvis, read what is inside anti-gravity." -> "read what is inside anti-gravity"
  // e.g. "Agent Jarvis, open word document." -> "open word document"
  text = text.replace(/^(?:(?:yes|yeah|yep|no|nope|okay|ok|hey|hi|hello|so|well|listen|now|look|i said|i mean)[\s,.:;!?-]+)+/gi, '');
  // Strip wake words with optional leading agent/hey/ok
  text = text.replace(/^(?:(?:hey|ok(?:ay)?|hi|hello|agent)\s+)*(?:jarvis|javis|jarves)\b[,\s.:;!?-]*/gi, '');
  // Strip natural request frames: "can you please", "could you", "please", "would you", "i asked you to", "i said to"
  text = text.replace(/^(?:(?:can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|please\s+|would\s+you\s+(?:please\s+)?|i\s+asked\s+you\s+to\s+|i\s+told\s+you\s+to\s+|i\s+said\s+to\s+|i\s+want\s+you\s+to\s+|i\s+need\s+you\s+to\s+|will\s+you\s+(?:please\s+)?|just\s+)\s*)+/gi, '');

  // 3b. Strip spoken location suffixes and STT acoustic corruptions ("inside my laptop", "and sell my laptop", "on my desktop")
  text = text.replace(/\s+(?:inside|in\s+side|and\s+sell|and\s+set|in|on|at)\s+(?:my\s+|the\s+)?(?:laptop|computer|pc|machine|desktop|desk|lab)(?=[.,;:!?]|$)/gi, '');

  // 3c. Clean acoustic speech-to-text corruptions around conjunctions and commands ("bought and read" -> "and read")
  text = text.replace(/\b(?:bought|bot)\s+and\s+read\b/gi, 'and read');
  text = text.replace(/\bbought\s+read\b/gi, 'read');

  // 3d. Strip trailing conversational temporal modifiers ("read the browser now" -> "read the browser", "show me Telegram now" -> "show me Telegram")
  if (!/\b(?:say\s+that|repeat)\b/i.test(text)) {
    text = text.replace(/\s+\b(?:now|currently|right\s+now|at\s+the\s+moment|please|for\s+me)\b(?=[.,;:!?]|$)/gi, '');
  }

  // 4. Remove spurious intra-command punctuation between words and numbers:
  // e.g. "read. 2." -> "read 2"
  // e.g. "read, two" -> "read two"
  // e.g. "read point. two" -> "read point two"
  // e.g. "point. 2" -> "point 2"
  // Generic: command/descriptor word + punctuation + number/word
  text = text.replace(/\b([a-zA-Z]+)[.,;:!?-]+(\s*)(\d+\b)/gi, '$1 $3');
  text = text.replace(/\b(read|point|number|item|bullet|section|open|locate|find|check|tell|show|inside|cart|to)[.,;:!?-]+(\s*)([a-zA-Z0-9]+)\b/gi, '$1 $3');

  // 5. Clean punctuation after lone numbers: " 2. " -> " 2 "
  text = text.replace(/(\b\d+)[.,;:!?-]+(?=\s|$)/g, '$1');

  // 6. Normalize entity naming variants
  text = normalizeEntityNames(text);

  // 7. Strip trailing/leading punctuation
  text = text.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').trim();

  return text;
}

/**
 * Strips conversational discourse and temporal modifiers from extracted entity strings.
 */
export function stripConversationalModifiers(input: string): string {
  if (!input) return '';
  let text = input.trim();
  text = text.replace(/\b(?:now|currently|right\s+now|at\s+the\s+moment|please|for\s+me)\b/gi, '');
  if (!/^(?:say\s+that|repeat)/i.test(text)) {
    text = text.replace(/\b(?:again)\b/gi, '');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Maps spoken number words to integers (1-10).
 */
function parseSpokenNumber(word?: string): number | null {
  if (!word) return null;
  const w = word.toLowerCase().trim();
  const map: Record<string, number> = {
    '1': 1, 'one': 1, 'first': 1,
    '2': 2, 'two': 2, 'second': 2,
    '3': 3, 'three': 3, 'third': 3,
    '4': 4, 'four': 4, 'fourth': 4,
    '5': 5, 'five': 5, 'fifth': 5,
    '6': 6, 'six': 6, 'sixth': 6,
    '7': 7, 'seven': 7, 'seventh': 7,
    '8': 8, 'eight': 8, 'eighth': 8,
    '9': 9, 'nine': 9, 'ninth': 9,
    '10': 10, 'ten': 10, 'tenth': 10,
  };
  if (map[w] !== undefined) return map[w];
  const parsed = parseInt(w, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Generic detector for common web destinations and URLs.
 */
const KNOWN_WEB_SITES: Record<string, { name: string; url: string }> = {
  'youtube': { name: 'YouTube', url: 'https://www.youtube.com' },
  'google': { name: 'Google', url: 'https://www.google.com' },
  'github': { name: 'GitHub', url: 'https://www.github.com' },
  'reddit': { name: 'Reddit', url: 'https://www.reddit.com' },
  'twitter': { name: 'Twitter', url: 'https://www.x.com' },
  'x': { name: 'X', url: 'https://www.x.com' },
  'wikipedia': { name: 'Wikipedia', url: 'https://www.wikipedia.org' },
  'amazon': { name: 'Amazon', url: 'https://www.amazon.com' },
};

function matchWebSiteTarget(targetStr: string): { isWeb: boolean; siteName: string; url: string } | null {
  const clean = (targetStr || '').toLowerCase().trim();
  if (!clean) return null;

  if (KNOWN_WEB_SITES[clean]) {
    return { isWeb: true, siteName: KNOWN_WEB_SITES[clean].name, url: KNOWN_WEB_SITES[clean].url };
  }

  // URL matching
  if (/^https?:\/\//i.test(clean) || /\b(?:www\.)[a-z0-9-]+\.[a-z]{2,}/i.test(clean) || /\b[a-z0-9-]+\.(?:com|org|io|net|dev|ai|app)\b/i.test(clean)) {
    const url = clean.startsWith('http') ? clean : `https://${clean}`;
    return { isWeb: true, siteName: targetStr.trim(), url };
  }

  return null;
}

/**
 * Top-level application names that must NEVER be inherited as chat targets (Repair 3).
 * When Telegram (or another app) is active, opening these always launches/focuses the app.
 */
export const KNOWN_TOP_LEVEL_APPS = new Set([
  'chrome', 'google chrome', 'browser', 'web browser',
  'comet', 'perplexity',
  'word', 'microsoft word', 'winword', 'msword',
  'excel', 'microsoft excel',
  'powerpoint', 'microsoft powerpoint',
  'outlook', 'microsoft outlook',
  'pdf', 'pdf reader', 'pdf viewer', 'adobe acrobat', 'acrobat',
  'notepad', 'text editor',
  'terminal', 'cmd', 'powershell', 'command prompt', 'bash',
  'explorer', 'file explorer', 'windows explorer', 'files',
  'code', 'vs code', 'vscode', 'visual studio code',
  'antigravity', 'antigravity ide',
  'telegram', 'telegram desktop',
  'whatsapp', 'whatsapp desktop',
  'slack', 'discord', 'spotify', 'calculator', 'calc', 'paint',
  'settings', 'task manager', 'chatgpt'
]);

export function isKnownTopLevelApp(target: string): boolean {
  if (!target) return false;
  const clean = target.toLowerCase().trim();
  if (KNOWN_TOP_LEVEL_APPS.has(clean)) return true;
  for (const app of KNOWN_TOP_LEVEL_APPS) {
    if (clean === app || clean.startsWith(app + ' ') || clean.endsWith(' ' + app)) return true;
  }
  return false;
}

export function isKnownDesktopApplication(candidate: string): boolean {
  if (!candidate) return false;
  const clean = candidate.toLowerCase().trim();
  if (isKnownTopLevelApp(clean)) return true;
  if (clean.endsWith('.exe')) return true;
  return false;
}

// ── Instrument: AUTHORITATIVE_INTENT_COMPILE_COUNT ──────────────────────
let authoritativeIntentCompileCount = 0;

export function getAuthoritativeIntentCompileCount(): number {
  return authoritativeIntentCompileCount;
}

export function resetAuthoritativeIntentCompileCount(): void {
  authoritativeIntentCompileCount = 0;
}

export class AuthoritativeIntentCompiler {
  /**
   * Compiles the raw prompt exactly once into an immutable CompiledTurnIntent.
   * If the utterance is compound, this returns the primary (first) step.
   */
  public static compile(rawPrompt: string, ctx?: IntentCompilerContext): Readonly<CompiledTurnIntent> {
    const plan = AuthoritativeIntentCompiler.compilePlan(rawPrompt, ctx);
    return plan.steps[0];
  }

  /**
   * Compiles an utterance into an ordered immutable INTENT PLAN (CompiledTurnPlan).
   * Supports compound commands with ordered execution steps:
   * e.g. "Open Telegram and locate Agentic OS bot." -> [OPEN_APPLICATION Telegram, OPEN_CHAT Agentic OS bot]
   * e.g. "Open Chrome and open YouTube." -> [OPEN_APPLICATION Chrome, NAVIGATE_WEB YouTube]
   */
  public static compilePlan(rawPrompt: string, ctx?: IntentCompilerContext): Readonly<CompiledTurnPlan> {
    authoritativeIntentCompileCount++;
    const raw = String(rawPrompt || '').trim();
    const normalized = normalizeSpokenUtterance(raw);

    // 0. DISCOURSE RESOLUTION (before compound splitting and literal target extraction):
    // conversational references are resolved against verified working memory first.
    const discourse = resolveDiscourse(normalized || raw, ctx?.discourse ?? null);
    if (discourse) {
      const discourseIntent = AuthoritativeIntentCompiler.intentFromDiscourse(discourse, raw, normalized, ctx);
      logger.info('[AuthoritativeIntentCompiler] DISCOURSE_RESOLVED', {
        raw,
        kind: discourse.kind,
        referent: (discourse as any).referent,
        modality: (discourse as any).modality,
        action: discourseIntent.action,
        target: discourseIntent.target,
        activeModality: ctx?.discourse?.activeModality ?? 'NONE',
      });
      return Object.freeze({
        steps: Object.freeze([Object.freeze({ ...discourseIntent, interpretationPath: 'DETERMINISTIC_FALLBACK' as const })]),
        rawPrompt: raw,
        normalizedPrompt: normalized,
        isCompound: false,
      });
    }

    // 1. Attempt compound splitting on conjunctions
    const compoundParts = AuthoritativeIntentCompiler.splitCompoundClauses(normalized);

    if (compoundParts.length > 1) {
      const steps: CompiledTurnIntent[] = [];
      let currentApp = ctx?.activeApplication || null;
      let currentSurface = ctx?.activeSurface || (ctx?.activeDomain?.includes('youtube.com') ? 'YouTube' : null);
      let currentSearchQuery = ctx?.currentSearchQuery || null;
      let focusedEntity = ctx?.focusedEntity || null;

      for (let i = 0; i < compoundParts.length; i++) {
        const part = compoundParts[i];
        const stepContext: IntentCompilerContext = {
          ...ctx,
          activeApplication: currentApp,
          activeSurface: currentSurface,
          currentSearchQuery,
          focusedEntity,
        };

        const compiledStep = AuthoritativeIntentCompiler.compileSingleIntent(part, raw, normalized, stepContext);

        if (compiledStep.action !== 'OTHER') {
          // Never execute the same perception twice for one utterance (e.g. two camera clauses)
          const prev = steps[steps.length - 1];
          if (prev && prev.action === compiledStep.action && prev.target === compiledStep.target && compiledStep.action === 'CAMERA_OBSERVE') {
            continue;
          }
          steps.push({ ...compiledStep, interpretationPath: 'DETERMINISTIC_FALLBACK' as const });
          if (compiledStep.application) {
            currentApp = compiledStep.application;
          }
          if (compiledStep.action === 'NAVIGATE_WEB') {
            if (compiledStep.target?.toLowerCase().includes('youtube') || compiledStep.contentRequest?.includes('youtube.com')) {
              currentSurface = 'YouTube';
            }
            if (compiledStep.contentRequest?.includes('search_query=')) {
              currentSearchQuery = compiledStep.target;
              focusedEntity = compiledStep.target;
            }
          }
        }
      }

      // If at least two distinct valid steps were produced, return the compound plan!
      if (steps.length > 1) {
        return Object.freeze({
          steps: Object.freeze(steps.map((s) => Object.freeze(s))),
          rawPrompt: raw,
          normalizedPrompt: normalized,
          isCompound: true,
        });
      } else if (steps.length === 1) {
        return Object.freeze({
          steps: Object.freeze([Object.freeze(steps[0])]),
          rawPrompt: raw,
          normalizedPrompt: normalized,
          isCompound: false,
        });
      }
    }

    // 2. Otherwise compile as a single canonical intent
    const single = AuthoritativeIntentCompiler.compileSingleIntent(normalized, raw, normalized, ctx);
    return Object.freeze({
      steps: Object.freeze([Object.freeze({ ...single, interpretationPath: 'DETERMINISTIC_FALLBACK' as const })]),
      rawPrompt: raw,
      normalizedPrompt: normalized,
      isCompound: false,
    });
  }

  /**
   * Compiles a validated StructuredIntent into a deterministic executable CompiledTurnPlan.
   * Primary role: Validated StructuredIntent -> deterministic executable plan.
   */
  public static compileFromStructuredIntent(
    intent: StructuredIntent,
    rawPrompt: string,
    ctx?: IntentCompilerContext
  ): Readonly<CompiledTurnPlan> {
    const raw = String(rawPrompt || '').trim();
    const normalized = normalizeSpokenUtterance(raw);
    const steps: CompiledTurnIntent[] = [];
    const discourse = ctx?.discourse ?? null;
    const lastRead = discourse?.lastRead ?? null;

    // Check if this is an explicit causal query
    if (intent.turnType === 'CAUSAL_QUERY') {
      const step = AuthoritativeIntentCompiler.intentFromDiscourse(
        { kind: 'EXPLAIN_PREVIOUS_OUTCOME', reason: intent.userGoal || 'User asked why previous action failed' },
        raw,
        normalized,
        ctx
      );
      return Object.freeze({
        steps: Object.freeze([Object.freeze({ ...step, interpretationPath: 'SEMANTIC_LLM' as const, structuredIntent: intent })]),
        rawPrompt: raw,
        normalizedPrompt: normalized,
        isCompound: false,
      });
    }

    const intentSteps = intent.steps && intent.steps.length > 0 ? intent.steps : [{ action: 'CONVERSATIONAL' as const }];

    for (let i = 0; i < intentSteps.length; i++) {
      const s = intentSteps[i];
      let stepIntent: CompiledTurnIntent;

      switch (s.action) {
        case 'OPEN_APPLICATION': {
          const app = s.application ? normalizeApplicationEntity(s.application) : (s.target || 'Application');
          stepIntent = {
            action: 'OPEN_APPLICATION',
            targetType: 'APPLICATION_WINDOW',
            application: app,
            target: app,
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: `Semantic interpretation: OPEN_APPLICATION (${app})`,
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'OPEN_CHAT': {
          const app = s.application ? normalizeApplicationEntity(s.application) : 'Telegram';
          const target = s.target ? normalizeEntityNames(s.target) : 'Agentic OS bot';
          stepIntent = {
            action: 'OPEN_CHAT',
            targetType: 'CHAT_CONVERSATION',
            application: app,
            target,
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: `Semantic interpretation: OPEN_CHAT (${target})`,
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'READ_MESSAGES': {
          const app = s.application ? normalizeApplicationEntity(s.application) : (lastRead?.application || 'Telegram');
          const target = s.target ? normalizeEntityNames(s.target) : (lastRead?.target || 'Agentic OS bot');
          const count = s.entityCount ?? (lastRead?.entityCount || 4);
          const ordinalRef = intent.referents?.find(r => r.resolvedType === 'VERIFIED_ENTITY' && r.resolvedId);
          const ordinal = ordinalRef ? Number(ordinalRef.resolvedId) : null;
          stepIntent = {
            action: 'READ_MESSAGES',
            targetType: 'CHAT_CONVERSATION',
            application: app,
            target,
            contentRequest: null,
            ordinal: ordinal && !isNaN(ordinal) ? ordinal : null,
            count: count,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: `Semantic interpretation: READ_MESSAGES (${count} from ${target})`,
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'NAVIGATE_WEB': {
          const app = s.application ? normalizeApplicationEntity(s.application) : 'Chrome';
          let target = s.target || s.url || 'YouTube';
          let url = s.url;
          if (!url) {
            if (/^https?:\/\//i.test(target)) {
              url = target;
            } else if (/youtube/i.test(target)) {
              url = 'https://www.youtube.com';
            } else if (/google/i.test(target)) {
              url = 'https://www.google.com';
            } else if (/perplexity/i.test(target)) {
              url = 'https://www.perplexity.ai';
            } else if (/github/i.test(target)) {
              url = 'https://github.com';
            } else {
              url = `https://${target.toLowerCase().replace(/\s+/g, '')}.com`;
            }
          }
          stepIntent = {
            action: 'NAVIGATE_WEB',
            targetType: 'WEB_URL',
            application: app,
            target: target,
            contentRequest: url,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: `Semantic interpretation: NAVIGATE_WEB (${url} in ${app})`,
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'READ_WEB_CONTENT': {
          const app = s.application ? normalizeApplicationEntity(s.application) : 'Chrome';
          stepIntent = {
            action: 'READ_CONTENT',
            targetType: 'WEB_URL',
            application: app,
            target: s.target || 'Current page',
            contentRequest: s.url || null,
            ordinal: null,
            count: s.entityCount || null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: `Semantic interpretation: READ_WEB_CONTENT (${app})`,
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'CAMERA_OBSERVE': {
          stepIntent = {
            action: 'CAMERA_OBSERVE',
            targetType: 'CAMERA',
            application: null,
            target: 'Camera',
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: 'Semantic interpretation: CAMERA_OBSERVE',
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'READ_SCREEN': {
          stepIntent = {
            action: 'READ_CONTENT',
            targetType: 'SCREEN',
            application: null,
            target: 'Screen',
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: 'Semantic interpretation: READ_SCREEN',
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'READ_CONTENT': {
          const isCam = s.modality === 'CAMERA' || (!s.modality && discourse?.activeModality === 'CAMERA');
          const isScreen = s.modality === 'SCREEN';
          stepIntent = {
            action: isCam ? 'CAMERA_OBSERVE' : 'READ_CONTENT',
            targetType: isCam ? 'CAMERA' : (isScreen ? 'SCREEN' : 'DOCUMENT_CONTENT'),
            application: isCam || isScreen ? null : (s.application || null),
            target: isCam ? 'Camera' : (isScreen ? 'Screen' : (s.target || null)),
            contentRequest: null,
            ordinal: null,
            count: s.entityCount || null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: true,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: `Semantic interpretation: READ_CONTENT (modality=${s.modality || discourse?.activeModality || 'NONE'})`,
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }

        case 'CONVERSATIONAL':
        default: {
          stepIntent = {
            action: 'CONVERSATIONAL',
            targetType: 'NONE',
            application: null,
            target: null,
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: intent.confidence,
            isDirectCommand: false,
            rawPrompt: raw,
            normalizedPrompt: normalized,
            reason: `Semantic interpretation: ${intent.turnType}`,
            interpretationPath: 'SEMANTIC_LLM',
            structuredIntent: intent,
          };
          break;
        }
      }

      steps.push(Object.freeze(stepIntent));
    }

    return Object.freeze({
      steps: Object.freeze(steps),
      rawPrompt: raw,
      normalizedPrompt: normalized,
      isCompound: steps.length > 1,
    });
  }

  /**
   * Maps a discourse resolution to an immutable compiled intent.
   */
  private static intentFromDiscourse(
    res: DiscourseResolution,
    rawPrompt: string,
    normalizedPrompt: string,
    ctx?: IntentCompilerContext,
  ): CompiledTurnIntent {
    const base = {
      application: null as string | null,
      ordinal: null as number | null,
      count: null as number | null,
      worker: null,
      delegationRequested: false,
      confidence: 0.97,
      isDirectCommand: true,
      rawPrompt,
      normalizedPrompt,
    };
    const view = ctx?.discourse ?? null;

    switch (res.kind) {
      case 'CONTINUE_PLAYBACK':
        return {
          ...base,
          action: 'READ_MESSAGES',
          targetType: 'CHAT_CONVERSATION',
          application: 'Telegram',
          target: res.source || 'Agentic OS bot',
          contentRequest: 'continue_messages',
          ordinal: res.nextIndex + 1,
          count: res.remainingCount,
          reason: `Discourse resolution: Resuming message playback for ${res.source} from message index ${res.nextIndex}`,
        };

      case 'OPEN_ANOTHER_VIDEO':
        return {
          ...base,
          action: 'NAVIGATE_WEB',
          targetType: 'WEB_URL',
          application: 'Chrome',
          target: 'contextual_video',
          contentRequest: 'contextual_video',
          ordinal: 2,
          reason: `Discourse resolution: Open another relevant video from YouTube search results`,
          structuredIntent: {
            schemaVersion: '1',
            turnType: 'COMMAND',
            confidence: 1.0,
            userGoal: rawPrompt,
            steps: [{
              action: 'NAVIGATE_WEB',
              application: 'Chrome',
              target: 'contextual_video',
              url: 'contextual_video',
            }],
          },
        };

      case 'EXPLAIN_PREVIOUS_OUTCOME':
        return {
          ...base,
          action: 'CONVERSATIONAL',
          targetType: 'NONE',
          target: 'explain_previous_outcome',
          contentRequest: 'EXPLAIN_PREVIOUS_OUTCOME',
          reason: `Causal intent resolution: ${res.reason}`,
        };

      case 'REPLAY_READ_RESULT':
        return {
          ...base,
          action: 'CONVERSATIONAL',
          targetType: 'NONE',
          target: 'discourse_replay',
          contentRequest: `replay:${res.selection}`,
          ordinal: res.ordinal ?? null,
          count: res.count ?? null,
          reason: `Referent '${res.referent}' resolved to verified lastReadResult (${res.reason}); no re-acquisition`,
        };

      case 'UNRESOLVED_REFERENT':
        return {
          ...base,
          action: 'CONVERSATIONAL',
          targetType: 'NONE',
          target: 'clarify_referent',
          contentRequest: res.referent,
          reason: `Referent '${res.referent}' has no verified antecedent; clarification instead of literal target`,
        };

      case 'REACQUIRE_READ_SOURCE': {
        const lr = view?.lastRead;
        if (lr && lr.kind === 'MESSAGES') {
          return {
            ...base,
            action: 'READ_MESSAGES',
            targetType: 'CHAT_CONVERSATION',
            application: lr.application || ctx?.activeApplication || 'Telegram',
            target: lr.chat || lr.target || ctx?.activeChat || null,
            contentRequest: `last ${Math.max(1, lr.entityCount)} messages`,
            count: Math.max(1, lr.entityCount),
            reason: `Referent '${res.referent}' re-acquired from its verified source (${res.reason})`,
          };
        }
        return {
          ...base,
          action: 'READ_CONTENT',
          targetType: lr?.target === 'screen' ? 'SCREEN' : 'APPLICATION_WINDOW',
          application: lr?.application || ctx?.activeApplication || null,
          target: lr?.target || lr?.application || 'screen',
          contentRequest: 'window_content',
          reason: `Referent '${res.referent}' re-acquired from its verified source (${res.reason})`,
        };
      }

      case 'PERCEIVE':
      default: {
        const modality = (res as any).modality as 'CAMERA' | 'SCREEN' | 'BROWSER' | 'DESKTOP';
        const why = `${(res as any).explicit ? 'Explicit' : 'Contextual'} perception: ${res.reason}`;
        if (modality === 'CAMERA') {
          return {
            ...base,
            action: 'CAMERA_OBSERVE',
            targetType: 'CAMERA',
            target: 'camera',
            contentRequest: rawPrompt,
            reason: why,
          };
        }
        if (modality === 'BROWSER') {
          return {
            ...base,
            action: 'READ_WEB_CONTENT' as any,
            targetType: 'WEB_URL',
            application: 'Chrome',
            target: 'current_page',
            contentRequest: 'web_content',
            reason: why,
          };
        }
        if (modality === 'DESKTOP') {
          const activeChat = view?.activeChat ?? ctx?.activeChat ?? null;
          const verifiedChat = view?.verifiedSelectedChat ?? ctx?.verifiedSelectedChat ?? false;
          const activeApp = view?.activeApplication ?? ctx?.activeApplication ?? null;
          if (activeChat && verifiedChat) {
            return {
              ...base,
              action: 'READ_MESSAGES',
              targetType: 'CHAT_CONVERSATION',
              application: activeApp || 'Telegram',
              target: activeChat,
              contentRequest: 'last 2 messages',
              count: 2,
              reason: why,
            };
          }
          if (activeApp) {
            return {
              ...base,
              action: 'READ_CONTENT',
              targetType: 'APPLICATION_WINDOW',
              application: activeApp,
              target: activeApp,
              contentRequest: 'window_content',
              reason: why,
            };
          }
        }
        return {
          ...base,
          action: 'READ_CONTENT',
          targetType: 'SCREEN',
          application: null,
          target: 'screen',
          contentRequest: 'screen_perception',
          reason: why,
        };
      }
    }
  }

  private static readonly ACTION_VERB_REGEX =
    /\b(?:open|launch|bring\s+up|start|focus|close|terminate|kill|quit|locate|find|select|navigate|go\s+to|browse\s+to|read|inspect|what\s+is|tell\s+me|switch|delegate|look\s+at|search|look\s+for)\b/i;

  /**
   * Splits an utterance into candidate compound action clauses.
   */
  private static splitCompoundClauses(text: string): string[] {
    if (!text) return [];

    // Conjunction boundaries between actions or sentence/clause boundaries:
    // e.g. "Open Telegram. Locate AgenticOS inside Telegram."
    // e.g. "Open Telegram, locate AgenticOS and read the last two messages."
    // e.g. "Open Chrome and open YouTube."
    // e.g. "Open YouTube and search Julian Goldie SEO."
    const splitRegex = /\s*(?:(?<=[.!?])\s+|\s+(?:and\s+then|then|and\s+inside|and\s+also|followed\s+by|after\s+that|\band\b)\s+|,\s*(?=(?:open|locate|find|select|navigate|go\s+to|read|what\s+is|tell\s+me|switch|delegate|inspect|look|search)\b))\s*/i;
    const parts = text
      .split(splitRegex)
      .map((p) => p.replace(/^[,\s.:;!?-]+|[,\s.:;!?-]+$/g, '').trim())
      .filter(Boolean);

    if (parts.length <= 1) return parts;

    // If the first part lacks an action verb (e.g., vocative "Antigravity,"), merge it back with the next part
    if (!AuthoritativeIntentCompiler.ACTION_VERB_REGEX.test(parts[0])) {
      parts[1] = `${parts[0]} ${parts[1]}`;
      parts.shift();
    }

    if (parts.length <= 1) return parts;

    return parts;
  }

  /**
   * Compiles a single clause into a CompiledTurnIntent.
   */
  private static compileSingleIntent(
    clause: string,
    rawPrompt: string,
    normalizedPrompt: string,
    ctx?: IntentCompilerContext,
  ): CompiledTurnIntent {
    let stripped = clause.trim().toLowerCase();
    stripped = stripped.replace(/^(?:(?:hey|ok(?:ay)?|hi|hello|agent)\s+)*(?:jarvis|javis|jarves)\b[,\s.:;!?-]*/i, '').trim();
    stripped = stripped.replace(/^(?:(?:can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|please\s+|would\s+you\s+(?:please\s+)?|i\s+asked\s+you\s+to\s+|i\s+told\s+you\s+to\s+|i\s+said\s+to\s+|i\s+said|i\s+want\s+you\s+to\s+|i\s+need\s+you\s+to\s+|will\s+you\s+(?:please\s+)?|just\s+)\s*)+/i, '').trim();

    // Strip leading acoustic corruptions: "bot and read", "bought and read"
    stripped = stripped.replace(/^(?:(?:bot|bought)\s+and\s+)+/i, '');

    // ── 0. Immediate Causal-Follow-Up & Repetition Queries ───────────────────
    const isRepeatRequest =
      /\b(?:say\s+that\s+again|repeat\s+(?:that|what\s+you\s+(?:just\s+)?said)?|what\s+did\s+you\s+(?:just\s+)?say)\b/i.test(stripped);
    if (isRepeatRequest) {
      return {
        action: 'CONVERSATIONAL',
        targetType: 'NONE' as any,
        application: null,
        target: 'repeat_last_response',
        contentRequest: 'repeat',
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'User requested repetition of immediately preceding response',
      };
    }

    const isExplanatoryWhyRequest =
      /^(?:why\??|why\s+not\??|what\s+happened\??|why\s+did(?:n['’]t|\s+not)\s+that\s+work\??|why\s+(?:can['’]t|couldn['’]t)\s+you\s+(?:read|open|do|get|find)\s+(?:it|that|this)\??|why\s+(?:were|are)\s+you\s+able\s+to\s+read\s+(?:it|that|this)(?:\s+this\s+time)?\??)$/i.test(stripped) ||
      /\b(?:why\s+can['’]t\s+you\s+read\s+(?:it|that)|why\s+couldn['’]t\s+you\s+read\s+(?:it|that)|why\s+didn['’]t\s+that\s+work|what\s+went\s+wrong)\b/i.test(stripped) ||
      /\b(?:why\s+were\s+you\s+able\s+to\s+read\s+it(?:\s+this\s+time)?)\b/i.test(stripped);

    if (isExplanatoryWhyRequest) {
      return {
        action: 'CONVERSATIONAL',
        targetType: 'NONE' as any,
        application: null,
        target: 'explain_previous_outcome',
        contentRequest: 'explanation',
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Immediate causal-explanatory follow-up referencing preceding operation or failure',
      };
    }

    // ── 0b. Playback Continuation ("continue", "continue reading", "continue with the messages", "next", "read the rest") ──
    const isContinuationRequest =
      /^(?:continue|continue\s+reading|continue\s+with\s+(?:the\s+)?messages|next|read\s+the\s+rest|go\s+on|keep\s+reading|more\s+messages)$/i.test(stripped) ||
      /\b(?:continue\s+reading|continue\s+with\s+(?:the\s+)?messages|read\s+the\s+rest)\b/i.test(stripped);

    if (isContinuationRequest) {
      const activePlayback = ctx?.activePlaybackTask || ctx?.discourse?.activePlaybackTask;
      if (activePlayback && activePlayback.status !== 'COMPLETED') {
        const remainingCount = activePlayback.remainingMessages?.length || Math.max(0, (activePlayback.messageRecords?.length || 0) - activePlayback.currentMessageIndex);
        if (remainingCount > 0) {
          return {
            action: 'READ_MESSAGES',
            targetType: 'CHAT_CONVERSATION',
            application: 'Telegram',
            target: activePlayback.source || 'Agentic OS bot',
            contentRequest: 'continue_messages',
            ordinal: activePlayback.currentMessageIndex + 1,
            count: remainingCount,
            worker: null,
            delegationRequested: false,
            confidence: 1.0,
            isDirectCommand: true,
            rawPrompt,
            normalizedPrompt,
            reason: `Resuming active message playback task for ${activePlayback.source} from message index ${activePlayback.currentMessageIndex}`,
          };
        }
      }
    }

    // ── 1. Content Follow-ups / Deictic Referents against Messages ──────────
    if (
      /\b(?:what\s+does\s+(?:the\s+)?last\s+(?:one|message)\s+mean|explain\s+(?:the\s+)?last\s+(?:one|message)|what\s+did\s+(?:the\s+)?last\s+one\s+mean)\b/i.test(stripped)
    ) {
      return {
        action: 'READ_MESSAGES',
        targetType: 'CHAT_CONVERSATION',
        application: ctx?.activeApplication || 'Telegram',
        target: ctx?.activeChat || 'Agentic OS bot',
        contentRequest: 'explain_last',
        ordinal: null,
        count: 1,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Follow-up query on the last extracted chat message',
      };
    }

    if (
      /\b(?:read\s+(?:the\s+)?previous\s+(?:one|message)|read\s+one\s+before)\b/i.test(stripped)
    ) {
      return {
        action: 'READ_MESSAGES',
        targetType: 'CHAT_CONVERSATION',
        application: ctx?.activeApplication || 'Telegram',
        target: ctx?.activeChat || 'Agentic OS bot',
        contentRequest: 'previous_message',
        ordinal: -1,
        count: 1,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Follow-up deictic query to read the previous chat message from active context',
      };
    }

    if (
      /\b(?:what\s+did\s+(?:he|she|they|it)\s+say|what\s+did\s+(?:the\s+)?(?:last|previous)\s+message\s+say)\b/i.test(stripped)
    ) {
      return {
        action: 'READ_MESSAGES',
        targetType: 'CHAT_CONVERSATION',
        application: ctx?.activeApplication || 'Telegram',
        target: ctx?.activeChat || 'Agentic OS bot',
        contentRequest: 'what_did_he_say',
        ordinal: null,
        count: 1,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Follow-up deictic query on what was said in active chat context',
      };
    }

    if (
      /\b(?:reply\s+to\s+(?:the\s+)?last\s+message)\b/i.test(stripped)
    ) {
      return {
        action: 'CONVERSATIONAL',
        targetType: 'CHAT_CONVERSATION',
        application: ctx?.activeApplication || 'Telegram',
        target: ctx?.activeChat || 'Agentic OS bot',
        contentRequest: 'reply_to_last',
        ordinal: null,
        count: 1,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Follow-up request to reply to the last message in verified chat',
      };
    }

    // ── 2. Content Follow-ups / Ordinal Document Points ─────────────────────
    // "Read point two", "Read point 2", "read 2", "read two", "What's in number two?", "read. 2."
    const pointMatch = stripped.match(
      /\b(?:(?:read|what\s+does|can\s+you\s+read|explain|tell\s+me\s+about|especially)\s+(?:the\s+)?(?:visible\s+)?(?:point|number|item|bullet|section)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|(?:point|number|item|bullet|section)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|read\s+the\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:point|number|item)?|what(?:'s|\s+is)\s+in\s+number\s+(\d+|one|two|three|four|five)|read\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten))\b/i
    );

    if (pointMatch) {
      const rawNum = pointMatch[1] || pointMatch[2] || pointMatch[3] || pointMatch[4] || pointMatch[5];
      const ordinal = parseSpokenNumber(rawNum) ?? 2;

      return {
        action: 'READ_CONTENT',
        targetType: 'DOCUMENT_CONTENT',
        application: ctx?.activeApplication || 'Antigravity',
        target: `point ${ordinal}`,
        contentRequest: `point ${ordinal}`,
        ordinal,
        count: ordinal,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: `Deictic request to read document point ${ordinal} from active context`,
      };
    }

    // ── 3. Reading Chat Messages ("Read me the last messages", "read last two messages", etc.) ──
    const readMsgMatch = stripped.match(
      /\b(?:read|show|get|fetch|list|display|tell\s+me)\s+(?:(?:to\s+)?me\s+)?(?:the\s+|my\s+|our\s+)?(?:last|latest|recent)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:chat\s+)?messages?\b/i
    );
    const isMessageReading =
      readMsgMatch !== null ||
      /\bread\s+(?:(?:to\s+)?me\s+)?(?:the\s+|my\s+)?(?:last|latest|recent)?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:chat\s+)?messages?\b/i.test(stripped) ||
      (/\b(?:messages?|chat)\b/i.test(stripped) && /\b(?:read|show|fetch|get)\b/i.test(stripped) && !/\b(?:document|point|number)\b/i.test(stripped));

    if (isMessageReading) {
      const parsedCount = parseSpokenNumber(readMsgMatch?.[1]);
      const count = parsedCount ?? (/\b(?:last|latest)\s+(?:two|2)\b/i.test(stripped) ? 2 : (/\b(?:one|1)\b/i.test(stripped) ? 1 : 2));
      return {
        action: 'READ_MESSAGES',
        targetType: 'CHAT_CONVERSATION',
        application: ctx?.activeApplication || 'Telegram',
        target: ctx?.activeChat || 'Agentic OS bot',
        contentRequest: `last ${count} messages`,
        ordinal: null,
        count,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: `Direct request to read ${count} messages from verified chat`,
      };
    }

    // ── 4. Explicit Engineering Delegation (AUTONOMOUS WORK) ─────────────────
    // RULE: Delegation requires an explicit delegation directive verb!
    // Mentions of worker names alone NEVER mean delegation.
    const hasDelegateVerb =
      /\b(?:delegate|hand\s+off|assign|pass|forward)\s+(?:this\s+|the\s+)?(?:task\s+|problem\s+|issue\s+|investigation\s+|work\s+|bug\s+)?to\s+(?:antigravity|hermes|codex)\b/i.test(stripped) ||
      /\b(?:ask|have)\s+(?:antigravity|hermes|codex)\s+to\s+(?:implement|build|fix|create|code|develop|refactor|solve|address|investigate|inspect)\b/i.test(stripped) ||
      /^(?:antigravity|hermes|codex)[,:\s]+(?:implement|build|fix|create|code|develop|refactor|solve|address)[:\s,-]*(.+)$/i.test(stripped) ||
      /^(?:send\s+(?:this\s+)?(?:task\s+)?to\s+(?:antigravity|hermes|codex))\b/i.test(stripped);

    if (hasDelegateVerb) {
      let worker: 'antigravity' | 'hermes' | 'codex' = 'antigravity';
      if (/\bhermes\b/i.test(stripped)) worker = 'hermes';
      else if (/\bcodex\b/i.test(stripped)) worker = 'codex';
      else if (/\bantigravity\b/i.test(stripped)) worker = 'antigravity';

      let task = '';
      const delegateMatch = stripped.match(/(?:to\s+(?:antigravity|hermes|codex)|(?:antigravity|hermes|codex)\s+to\s+(?:implement|build|fix|create|code|develop|refactor|solve|address|investigate|inspect))[:\s,-]*(.*)$/i);
      if (delegateMatch && delegateMatch[1]?.trim()) {
        task = delegateMatch[1].trim();
      } else {
        task = rawPrompt;
      }

      return {
        action: 'DELEGATE',
        targetType: 'WORKER',
        application: null,
        target: worker,
        contentRequest: null,
        ordinal: null,
        count: null,
        worker,
        delegationRequested: true,
        delegationTask: task,
        confidence: 1.0,
        isDirectCommand: false,
        rawPrompt,
        normalizedPrompt,
        reason: `Explicit autonomous engineering delegation directive targeting ${worker}`,
      };
    }

    // ── 5. Read Content / Window Perception (DIRECT COMMAND) ─────────────────
    // Deictic / Contextual page and screen reading:
    // "Can you read this page?", "Can you read the desktop page that I have open now in browser?", "Can you read the browser now?", "what's on this page", "read this page", "read this"
    const isDeicticPageOrScreen =
      /\b(?:this\s+page|this\s+webpage|the\s+current\s+page|current\s+page|this\s+browser\s+page|the\s+page|what(?:'s|\s+is)\s+on\s+this\s+page|read\s+this\s+page|read\s+this\b|what\s+is\s+on\s+my\s+screen)\b/i.test(stripped) ||
      /\bread\s+(?:the\s+)?(?:desktop\s+)?page(?:\s+that\s+i\s+have\s+open)?(?:\s+(?:now\s+)?in\s+(?:the\s+)?browser)?/i.test(stripped) ||
      /\bread\s+(?:the\s+)?(?:google\s+)?browser(?:\s+now)?/i.test(stripped) ||
      /\bread\s+(?:the\s+)?(?:google\s+)?chrome(?:\s+now)?/i.test(stripped);

    if (isDeicticPageOrScreen) {
      const isBrowser =
        (ctx?.activeApplication && /chrome|edge|brave|comet|firefox/i.test(ctx.activeApplication)) ||
        ctx?.activeCapability === 'BROWSER' ||
        Boolean(ctx?.activeUrl || ctx?.activePage) ||
        /\b(?:browser|chrome|edge|webpage|page\b)/i.test(stripped);

      if (isBrowser) {
        return {
          action: 'READ_WEB_CONTENT' as any,
          targetType: 'WEB_URL',
          application: 'Chrome',
          target: 'current_page',
          contentRequest: 'web_content',
          ordinal: null,
          count: null,
          worker: null,
          delegationRequested: false,
          confidence: 1.0,
          isDirectCommand: true,
          rawPrompt,
          normalizedPrompt,
          reason: 'Contextual/deictic command to read active browser page',
        };
      }

      return {
        action: 'READ_CONTENT',
        targetType: 'SCREEN',
        application: ctx?.activeApplication || 'Screen',
        target: 'screen',
        contentRequest: 'screen_perception',
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Contextual/deictic command to read visible screen content',
      };
    }

    const isReadContentDirective =
      /\b(?:read|what\s+is\s+inside|what's\s+inside|see\s+inside|inspect\s+(?:window|page|content)|tell\s+me\s+what\s+is\s+inside|tell\s+me\s+what\s+[a-z0-9_-]+\s+is\s+showing|what\s+is\s+[a-z0-9_-]+\s+showing)\b/i.test(stripped) ||
      /\b(?:what\s+do\s+you\s+see\s+inside|what\s+can\s+you\s+see\s+inside|can\s+you\s+read\s+(?:the\s+)?[a-z0-9_-]+\s+window)\b/i.test(stripped) ||
      /\bread\s+(?:the\s+)?inside\b/i.test(stripped) ||
      /^(?:read|inspect)\s+(?:what\s+is\s+inside\s+)?(?:the\s+)?(antigravity|hermes\s*\d*|hermes\s+one|notepad|word|[a-zA-Z0-9_\-]+(?:\s+window)?)$/i.test(stripped);

    if (isReadContentDirective) {
      let targetName = 'screen';
      if (/\bhermes\b/i.test(stripped)) {
        targetName = /\bhermes\s*(?:1|one)\b/i.test(stripped) ? 'Hermes 1' : 'Hermes';
      } else if (/\bantigravity\b/i.test(stripped)) {
        targetName = 'Antigravity';
      } else {
        const readTargetMatch = stripped.match(/(?:read|inspect|what\s+is\s+inside|what's\s+inside|see\s+inside)\s+(?:what\s+is\s+inside\s+)?(?:the\s+)?([a-zA-Z0-9_\- ]+?)(?:\s+window|\s+app)?$/i);
        if (readTargetMatch && readTargetMatch[1]?.trim()) {
          targetName = stripConversationalModifiers(readTargetMatch[1].trim());
        }
      }

      // Pronoun referents must NEVER become literal application/window names.
      // Plural referents without a verified antecedent are reached only when no discourse
      // state exists (DiscourseReferentResolver handles them when it does).
      if (/^(?:them|these|those|they|both|all\s+of\s+them|there)$/i.test(targetName.trim())) {
        return {
          action: 'CONVERSATIONAL',
          targetType: 'NONE' as any,
          application: null,
          target: 'clarify_referent',
          contentRequest: targetName.trim(),
          ordinal: null,
          count: null,
          worker: null,
          delegationRequested: false,
          confidence: 0.9,
          isDirectCommand: true,
          rawPrompt,
          normalizedPrompt,
          reason: `Pronoun '${targetName.trim()}' has no resolvable referent; clarification instead of literal window target`,
        };
      }

      // If the target is a pronoun ("it", "that"), resolve to causal conversational follow-up
      if (['it', 'that'].includes(targetName.toLowerCase().trim())) {
        return {
          action: 'CONVERSATIONAL',
          targetType: 'NONE' as any,
          application: null,
          target: 'explain_previous_outcome',
          contentRequest: 'explanation',
          ordinal: null,
          count: null,
          worker: null,
          delegationRequested: false,
          confidence: 0.95,
          isDirectCommand: true,
          rawPrompt,
          normalizedPrompt,
          reason: 'Pronoun referent resolved to conversational follow-up instead of literal window target',
        };
      }

      // Check if targetName is a deictic page/browser entity
      if (/^(?:this\s+page|the\s+page|current\s+page|webpage|browser|the\s+browser|chrome|the\s+chrome)$/i.test(targetName)) {
        return {
          action: 'READ_WEB_CONTENT' as any,
          targetType: 'WEB_URL',
          application: 'Chrome',
          target: 'current_page',
          contentRequest: 'web_content',
          ordinal: null,
          count: null,
          worker: null,
          delegationRequested: false,
          confidence: 1.0,
          isDirectCommand: true,
          rawPrompt,
          normalizedPrompt,
          reason: 'Contextual/deictic command to read active browser page',
        };
      }

      // If the target mentions messages, route directly to READ_MESSAGES
      if (/\bmessages?\b/i.test(targetName)) {
        return {
          action: 'READ_MESSAGES',
          targetType: 'CHAT_CONVERSATION',
          application: ctx?.activeApplication || 'Telegram',
          target: ctx?.activeChat || 'Agentic OS bot',
          contentRequest: 'last 2 messages',
          ordinal: null,
          count: 2,
          worker: null,
          delegationRequested: false,
          confidence: 1.0,
          isDirectCommand: true,
          rawPrompt,
          normalizedPrompt,
          reason: 'Normalized intent to read chat messages in messaging context',
        };
      }

      // If the target mentions Agentic OS or bot, route directly to Telegram chat conversation
      if (/\bagentic[- ]?os\b/i.test(targetName) || /\bagentic\b/i.test(targetName) || /\bbot\b/i.test(targetName) || /\bagentic\b/i.test(stripped)) {
        return {
          action: 'READ_MESSAGES',
          targetType: 'CHAT_CONVERSATION',
          application: 'Telegram',
          target: 'Agentic OS bot',
          contentRequest: 'last 2 messages',
          ordinal: null,
          count: 2,
          worker: null,
          delegationRequested: false,
          confidence: 1.0,
          isDirectCommand: true,
          rawPrompt,
          normalizedPrompt,
          reason: 'Direct user intent to read content from Agentic OS bot in Telegram',
        };
      }

      // If no explicit target was named, resolve against active context rather than blindly defaulting to screen
      if (targetName === 'screen' && ctx?.activeChat) {
        return {
          action: 'READ_MESSAGES',
          targetType: 'CHAT_CONVERSATION',
          application: ctx.activeApplication || 'Telegram',
          target: ctx.activeChat,
          contentRequest: 'last 2 messages',
          ordinal: null,
          count: 2,
          worker: null,
          delegationRequested: false,
          confidence: 0.95,
          isDirectCommand: true,
          rawPrompt,
          normalizedPrompt,
          reason: `Contextual intent to read content from active chat ${ctx.activeChat}`,
        };
      }

      const isBrowser = /chrome|browser|tab\b|webpage/i.test(targetName) || /chrome|browser|tab\b|webpage/i.test(stripped);
      const effectiveApp = isBrowser ? 'Chrome' : targetName;
      const effectiveTargetType = isBrowser ? 'WEB_URL' : 'APPLICATION_WINDOW';
      const effectiveAction = isBrowser ? ('READ_WEB_CONTENT' as any) : 'READ_CONTENT';

      return {
        action: effectiveAction,
        targetType: effectiveTargetType,
        application: effectiveApp,
        target: targetName,
        contentRequest: isBrowser ? 'web_content' : 'window_content',
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: isBrowser
          ? `Direct user command to read content of ${targetName} browser tab`
          : `Direct user command to read content of ${targetName} window`,
      };
    }

    // ── 5b. Camera Observation ("Open camera", "What am I holding?", "What is in my hand?") ──
    if (
      /\b(?:open|activate|look\s+at|show\s+me|turn\s+on)\s+(?:the\s+)?camera\b/i.test(stripped) ||
      /\b(?:what\s+am\s+i\s+holding|what\s+do\s+you\s+see(?:\s+in\s+the\s+camera)?|what\s+is\s+in\s+my\s+hand)\b/i.test(stripped)
    ) {
      return {
        action: 'CAMERA_OBSERVE',
        targetType: 'CAMERA',
        application: null,
        target: 'camera',
        contentRequest: rawPrompt,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Direct camera perception and visual observation request',
      };
    }

    // ── 6. Open Chat Action & Application/Entity Disambiguation (Repair 3) ──
    const explicitChatMatch =
      stripped.match(/\b(?:open|launch|focus|navigate\s+to|bring\s+up|go\s+to|locate|find|select)\s+(?:the\s+)?([a-zA-Z0-9_\- ]+?\s+(?:bot|chat|conversation))\b/i) ||
      stripped.match(/\b(?:locate|find|select)\s+(?:the\s+)?([a-zA-Z0-9_\- ]+)\b/i);

    const telegramContextMatch = (ctx?.activeApplication === 'Telegram')
      ? stripped.match(/\b(?:open|locate|find|select|go\s+to)\s+(?:the\s+)?([a-zA-Z0-9_\- ]+)\b/i)
      : null;

    if (explicitChatMatch || telegramContextMatch) {
      const match = explicitChatMatch || telegramContextMatch!;
      let rawCandidate = match[1].replace(/\s+(?:inside|in|on)\s+telegram.*$/i, '').trim();
      const lowerCandidate = rawCandidate.toLowerCase();

      // DISAMBIGUATION CHECK 1: Top-Level Applications NEVER inherit OPEN_CHAT!
      // "open Chrome", "open Google Chrome", "open browser", "open Notepad", "open Terminal", "open Explorer"
      if (isKnownTopLevelApp(rawCandidate)) {
        logger.info('[AuthoritativeIntentCompiler] Top-level application disambiguated over active Telegram context:', {
          rawCandidate,
          activeApplication: ctx?.activeApplication,
        });
        // Do NOT compile as OPEN_CHAT. Fall through to application launch!
      } else if (matchWebSiteTarget(rawCandidate)?.isWeb || /^(?:youtube|google|github|reddit|twitter|wikipedia|amazon)\b/i.test(rawCandidate)) {
        // DISAMBIGUATION CHECK 2: Known websites / URLs NEVER inherit OPEN_CHAT!
        // "go to YouTube" while Telegram is active MUST NOT search for YouTube inside Telegram!
        logger.info('[AuthoritativeIntentCompiler] Web site target disambiguated over active Telegram context:', {
          rawCandidate,
          activeApplication: ctx?.activeApplication,
        });
        // Do NOT compile as OPEN_CHAT. Fall through to web navigation!
      } else {
        // DISAMBIGUATION CHECK 3: Check if target is a known chat/bot or explicit chat request
        const isExplicitBotOrChat = /\b(?:bot|chat|conversation)\b/i.test(match[0]) || /\b(?:locate|find|select)\b/i.test(match[0]);
        const isKnownChat = /^agentic\s*os(?:\s+bot)?$/i.test(rawCandidate) ||
                            Boolean(ctx?.activeChat && ctx.activeChat.toLowerCase() === lowerCandidate);

        if (isExplicitBotOrChat || isKnownChat) {
          let targetChat = rawCandidate;
          if (/^agentic\s*os(?:\s+bot)?$/i.test(targetChat)) {
            targetChat = 'Agentic OS bot';
          }
          return {
            action: 'OPEN_CHAT',
            targetType: 'CHAT_CONVERSATION',
            application: 'Telegram',
            target: targetChat,
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: 1.0,
            isDirectCommand: true,
            rawPrompt,
            normalizedPrompt,
            reason: `Direct intent to open and verify the ${targetChat} conversation in Telegram Desktop`,
          };
        } else if (telegramContextMatch && !explicitChatMatch) {
          // If Telegram is active and the user said "open X" where X is neither a known app nor a known chat:
          // FAIL CLOSED / ASK FOR CLARIFICATION! Do NOT guess and mutate active application!
          logger.warn('[AuthoritativeIntentCompiler] Ambiguous target while Telegram is active — failing closed to avoid state mutation:', {
            rawCandidate,
            activeApplication: ctx?.activeApplication,
          });
          return {
            action: 'CONVERSATIONAL',
            targetType: 'NONE' as any,
            application: null,
            target: rawCandidate,
            contentRequest: 'clarify_open_target',
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: 0.5,
            isDirectCommand: false,
            rawPrompt,
            normalizedPrompt,
            reason: `Ambiguous target '${rawCandidate}' while Telegram is active. Clarification requested to prevent context poisoning.`,
          };
        }
      }
    }

    // ── 6a. Web Search / YouTube Search ("search Julian Goldie SEO", "search for Julian Goldie on YouTube", "look for Julian Goldie SEO") ──
    const searchMatch =
      stripped.match(/^(?:search(?:\s+for)?|look\s+(?:up|for))\s+(.+?)(?:\s+(?:on|in)\s+youtube)?$/i);
    if (searchMatch && searchMatch[1]) {
      let query = searchMatch[1].trim();
      query = query.replace(/\b(?:on\s+youtube|in\s+youtube)\b/i, '').trim();
      const isExplicitYouTube = /\byoutube\b/i.test(stripped) || ctx?.activeSurface === 'YouTube' || (ctx?.activeDomain && /youtube\.com/i.test(ctx.activeDomain));
      const searchUrl = isExplicitYouTube
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      return {
        action: 'NAVIGATE_WEB',
        targetType: 'WEB_URL',
        application: ctx?.activeApplication || 'Chrome',
        target: query,
        contentRequest: searchUrl,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: isExplicitYouTube
          ? `Direct intent to search for '${query}' on YouTube`
          : `Direct intent to search for '${query}' on the web`,
      };
    }

    // ── 6b. Tab Switching ("Switch to tab X", "Switch to the X tab", "Switch tab to X") ──
    const switchTabMatch =
      stripped.match(/\b(?:switch|go|change|navigate)\s+(?:to\s+)?(?:the\s+)?(?:tab\s+(?:named\s+|called\s+)?|tab\s+to\s+)(.+)$/i) ||
      stripped.match(/\b(?:switch|change)\s+to\s+(?:the\s+)?([a-zA-Z0-9_\- ]+?)\s+tab\b/i) ||
      stripped.match(/\b(?:switch\s+tabs?|switch\s+to\s+tab)\s+to\s+(.+)$/i);

    if (switchTabMatch && switchTabMatch[1]?.trim()) {
      const targetTab = switchTabMatch[1].trim();
      return {
        action: 'SWITCH_TAB' as any,
        targetType: 'WEB_URL',
        application: 'Chrome',
        target: targetTab,
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: `Direct command to switch to browser tab '${targetTab}'`,
      };
    }

    // ── 7. Web Navigation / Sites ("Open YouTube", "Navigate to YouTube") ────
    // If the target is a known website (e.g. YouTube, GitHub) or explicit URL
    const openSiteMatch = stripped.match(/\b(?:open|navigate\s+to|go\s+to|browse\s+to)\s+(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+(?:\.com|\.org|\.net|\.io)?)\b/i);
    const candidateSite = openSiteMatch?.[1] || stripped;
    const webTarget = matchWebSiteTarget(candidateSite) || (stripped.includes('youtube') ? { isWeb: true, siteName: 'YouTube', url: 'https://www.youtube.com' } : null);

    if (webTarget && webTarget.isWeb) {
      const browserApp = ctx?.activeApplication && /chrome|edge|firefox|brave/i.test(ctx.activeApplication)
        ? ctx.activeApplication
        : 'Chrome';

      return {
        action: 'NAVIGATE_WEB',
        targetType: 'WEB_URL',
        application: browserApp,
        target: webTarget.siteName || webTarget.url,
        contentRequest: webTarget.url,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: `Direct web navigation to ${webTarget.siteName} (${webTarget.url})`,
      };
    }

    // ── 8. Application Launch vs Web Navigation (NO OPEN_URL INVENTION) ──────
    // Explicit web actions require EXPLICIT web/URL vocabulary.
    if (/\b(?:telegram\s+web|telegram\s+in\s+(?:the\s+)?browser|web\.telegram\.org)\b/i.test(stripped)) {
      return {
        action: 'OPEN_APPLICATION',
        targetType: 'APPLICATION_WINDOW',
        application: 'Browser',
        target: 'https://web.telegram.org',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Explicit request for Telegram Web in the browser',
      };
    }

    if (/\b(?:whatsapp\s+web|whatsapp\s+in\s+(?:the\s+)?browser|web\.whatsapp\.com)\b/i.test(stripped)) {
      return {
        action: 'OPEN_APPLICATION',
        targetType: 'APPLICATION_WINDOW',
        application: 'Browser',
        target: 'https://web.whatsapp.com',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Explicit request for WhatsApp Web in the browser',
      };
    }

    // "Open Telegram" -> Desktop Telegram (NEVER web.telegram.org)
    if (/\b(?:open|launch|bring\s+up|start|focus)\s+(?:the\s+)?(?:desktop\s+)?telegram\b/i.test(stripped) || /^open\s+telegram[.!?]?$/i.test(stripped)) {
      return {
        action: 'OPEN_APPLICATION',
        targetType: 'APPLICATION_WINDOW',
        application: 'Telegram',
        target: 'Telegram Desktop',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Direct intent to launch/focus Telegram Desktop application (no web URL invention)',
      };
    }

    // "Open WhatsApp" -> Desktop WhatsApp (NEVER web.whatsapp.com)
    if (/\b(?:open|launch|bring\s+up|start|focus)\s+(?:the\s+)?whatsapp\b/i.test(stripped)) {
      return {
        action: 'OPEN_APPLICATION',
        targetType: 'APPLICATION_WINDOW',
        application: 'WhatsApp',
        target: 'WhatsApp',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Direct intent to launch WhatsApp Desktop application (no web URL invention)',
      };
    }

    // "Open Chrome" / "Open Google Chrome"
    if (/\b(?:open|launch|bring\s+up|start|focus)\s+(?:the\s+)?(?:google\s+)?chrome\b/i.test(stripped)) {
      return {
        action: 'OPEN_APPLICATION',
        targetType: 'APPLICATION_WINDOW',
        application: 'Chrome',
        target: 'Google Chrome',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Direct intent to launch/focus Google Chrome browser',
      };
    }

    // "Open Comet" / "Open Perplexity"
    if (/\b(?:open|launch|bring\s+up|start|focus)\s+(?:comet|per\s*plexity)\b/i.test(stripped)) {
      return {
        action: 'OPEN_APPLICATION',
        targetType: 'APPLICATION_WINDOW',
        application: 'Comet',
        target: 'Comet Perplexity',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Direct intent to launch Comet Perplexity application',
      };
    }

    // Generic Desktop Application Launch vs Contextual Web/Entity Action
    const genericAppMatch =
      stripped.match(/^(?:open|launch|bring\s+up|start|focus|play|watch)\s+(?:the\s+)?([a-zA-Z0-9_\-\.\s]+?)(?:\s+(?:inside|in|on)\s+(?:my\s+)?(?:laptop|computer|desktop|pc|machine|lab))?[.!?]?$/i) ||
      stripped.match(/\b(?:open|launch|bring\s+up|start|focus|play|watch)\s+(?:the\s+)?([a-zA-Z0-9_\-\.]+?)\s+(?:inside|in|on)\s+(?:my\s+)?(?:laptop|computer|desktop|pc|machine|lab)\b/i);

    if (genericAppMatch && genericAppMatch[1]) {
      const rawCandidate = genericAppMatch[1].trim();
      const normalizedCandidate = normalizeApplicationEntity(rawCandidate);
      const isKnownNonApp =
        /^(?:camera|screen|desktop|monitor|display|point\s+\d+|number\s+\d+|the\s+last|last\s+one|what|how|why|who|a\s+new\s+project)$/i.test(normalizedCandidate) ||
        matchWebSiteTarget(normalizedCandidate)?.isWeb;

      if (!isKnownNonApp && normalizedCandidate.length >= 2) {
        // Disambiguate PDF requests: "open this PDF" vs "open <name>.pdf" vs "open PDF"
        if (normalizedCandidate.toLowerCase() === 'pdf' || rawCandidate.toLowerCase().includes('pdf')) {
          const isDeictic = /\b(?:this|the\s+active|the\s+current)\s+pdf\b/i.test(stripped) || /\b(?:this|the\s+active|the\s+current)\s+pdf\b/i.test(rawPrompt);
          const specificFileMatch = rawPrompt.match(/(?:open\s+)?([a-zA-Z0-9_\-.]+\.pdf)/i);
          if (specificFileMatch) {
            return {
              action: 'OPEN_APPLICATION',
              targetType: 'APPLICATION_WINDOW',
              application: 'PDF',
              target: specificFileMatch[1].trim(),
              contentRequest: null,
              ordinal: null,
              count: null,
              worker: null,
              delegationRequested: false,
              confidence: 1.0,
              isDirectCommand: true,
              rawPrompt,
              normalizedPrompt,
              reason: `Direct intent to open PDF document '${specificFileMatch[1].trim()}'`,
            };
          }
          if (isDeictic && !ctx?.activeContentSnapshot && !ctx?.activeTarget?.toLowerCase().includes('.pdf')) {
            return {
              action: 'CONVERSATIONAL',
              targetType: 'DOCUMENT_CONTENT',
              application: null,
              target: 'PDF',
              contentRequest: 'clarify_pdf_target',
              ordinal: null,
              count: null,
              worker: null,
              delegationRequested: false,
              confidence: 1.0,
              isDirectCommand: false,
              rawPrompt,
              normalizedPrompt,
              reason: 'Deictic request to open PDF, but no active PDF document was found in context. Which PDF document would you like me to open?',
            };
          }
          return {
            action: 'OPEN_APPLICATION',
            targetType: 'APPLICATION_WINDOW',
            application: 'PDF',
            target: 'PDF Reader',
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: 1.0,
            isDirectCommand: true,
            rawPrompt,
            normalizedPrompt,
            reason: `Direct intent to open default PDF viewer on user's machine`,
          };
        }

        // 1. A candidate after 'open' becomes OPEN_APPLICATION only when it resolves
        // with sufficient confidence to a known/available desktop application.
        if (isKnownDesktopApplication(normalizedCandidate)) {
          const formattedApp = normalizedCandidate.toLowerCase() === 'word'
            ? 'Word'
            : normalizedCandidate.charAt(0).toUpperCase() + normalizedCandidate.slice(1);

          return {
            action: 'OPEN_APPLICATION',
            targetType: 'APPLICATION_WINDOW',
            application: formattedApp,
            target: formattedApp,
            contentRequest: null,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: 1.0,
            isDirectCommand: true,
            rawPrompt,
            normalizedPrompt,
            reason: `Direct intent to launch/focus ${formattedApp} application on user's machine`,
          };
        }

        // 2. Unknown/unrecognized targets must NEVER automatically become application names.
        // Before OPEN_APPLICATION fallback, consult the current verified interaction state:
        const isBrowserActive = Boolean(
          (ctx?.activeApplication && /chrome|edge|firefox|brave|comet/i.test(ctx.activeApplication)) ||
          ctx?.activeCapability === 'BROWSER' ||
          ctx?.discourse?.activeModality === 'BROWSER'
        );

        const isYouTubeSurface = Boolean(
          ctx?.activeSurface === 'YouTube' ||
          (ctx?.activeUrl && /youtube\.com|youtu\.be/i.test(ctx.activeUrl)) ||
          (ctx?.activeDomain && /youtube\.com/i.test(ctx.activeDomain)) ||
          (ctx?.activePage && /youtube\.com/i.test(ctx.activePage)) ||
          (ctx?.activePageTitle && /youtube/i.test(ctx.activePageTitle)) ||
          (ctx?.activeTarget && /youtube/i.test(ctx.activeTarget))
        );

        // Ambiguous video requests: "open one video", "open a video", "play one", "open the first one",
        // "open one video from Julian Goldie", "open another one", "another video", "play another one"
        const isAnother =
          /\b(?:another\s+one|another\s+video|different\s+one|different\s+video|next\s+video)\b/i.test(stripped) ||
          /\b(?:another|different)\b/i.test(rawCandidate);

        const isVideoSelection =
          isAnother ||
          /^(?:one\s+video|a\s+video|1v|1\s*v|the\s+first\s+video|first\s+video|video|first\s+one|latest\s+video|one|play\s+one|play\s+a\s+video)$/i.test(rawCandidate) ||
          /\b(?:video|vid|1v|another\s+one)\b/i.test(rawCandidate) ||
          /\b(?:open|play|watch|select)\s+(?:one\s+video|a\s+video|1v|1\s*v|the\s+first\s+video|first\s+video|video|first\s+one|latest\s+video|one|another\s+one|another\s+video)\b/i.test(stripped);

        if (isBrowserActive && isYouTubeSurface && isVideoSelection) {
          const entityMatch = stripped.match(/(?:from|in|by|of)\s+([a-zA-Z0-9_\- ]+?)(?:\s+on\s+youtube)?$/i) ||
                              rawCandidate.match(/(?:from|in|by|of)\s+([a-zA-Z0-9_\- ]+)$/i);
          const entityHint = entityMatch ? entityMatch[1].trim() : (ctx?.focusedEntity || ctx?.currentSearchQuery || null);

          return {
            action: 'NAVIGATE_WEB',
            targetType: 'WEB_URL',
            application: ctx?.activeApplication || 'Chrome',
            target: isAnother ? 'contextual_video' : 'first_video_result',
            contentRequest: JSON.stringify({
              action: 'SELECT_VIDEO',
              entityHint: entityHint,
              isAnother: isAnother,
              ordinal: isAnother ? 2 : 1,
            }),
            ordinal: isAnother ? 2 : 1,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: 1.0,
            isDirectCommand: true,
            rawPrompt,
            normalizedPrompt,
            reason: isAnother
              ? `Contextual action resolution: Open another relevant video${entityHint ? ` for ${entityHint}` : ''} on YouTube`
              : `Contextual action resolution: Open video${entityHint ? ` for ${entityHint}` : ''} on YouTube`,
          };
        }

        // Contextual YouTube Search: "open Julian Goldie SEO", "open Julian Goldie" when on YouTube surface
        if (isYouTubeSurface && !isKnownDesktopApplication(normalizedCandidate) && !matchWebSiteTarget(normalizedCandidate)?.isWeb) {
          const query = rawCandidate;
          return {
            action: 'NAVIGATE_WEB',
            targetType: 'WEB_URL',
            application: ctx?.activeApplication || 'Chrome',
            target: query,
            contentRequest: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
            ordinal: null,
            count: null,
            worker: null,
            delegationRequested: false,
            confidence: 1.0,
            isDirectCommand: true,
            rawPrompt,
            normalizedPrompt,
            reason: `Contextual action resolution: Active browser is on YouTube. Resolving 'open ${query}' to YouTube search query`,
          };
        }

        // 3. FAIL CLOSED: If neither a desktop application nor a contextual visible entity can be resolved
        // with adequate confidence, request clarification. Do NOT invent an executable or application.
        return {
          action: 'CONVERSATIONAL',
          targetType: 'NONE',
          application: null,
          target: null,
          contentRequest: 'clarify_open_target',
          ordinal: null,
          count: null,
          worker: null,
          delegationRequested: false,
          confidence: 1.0,
          isDirectCommand: false,
          rawPrompt,
          normalizedPrompt,
          reason: `Contextual action resolution: '${rawCandidate}' does not resolve to a known desktop application or contextual visible entity. Requesting clarification.`,
          structuredIntent: {
            schemaVersion: '1',
            turnType: 'CONVERSATIONAL',
            confidence: 1.0,
            userGoal: rawPrompt,
            clarificationPrompt: `I'm not sure which application or item you would like to open. Could you please specify?`,
          },
        };
      }
    }

    // ── 9. Screen & Desktop Perception ──────────────────────────────────────
    if (
      /\b(?:can\s+you\s+(?:see|view|read|inspect)|do\s+you\s+see|see|look\s+at|inspect|capture|check)\s+(?:what(?:'s|\s+is)\s+on\s+)?(?:the\s+|my\s+)?(?:current\s+)?(?:desktop|screen|monitor|display|page)\b/i.test(stripped) ||
      /\bwhat(?:'s|\s+is)\s+(?:on|inside)\s+(?:my\s+|the\s+)?(?:current\s+)?(?:desktop|screen|monitor|display|page)\b/i.test(stripped) ||
      /\bwhat\s+do\s+you\s+see\s+on\s+(?:my\s+|the\s+)?(?:current\s+)?(?:desktop|screen|monitor|display|page)\b/i.test(stripped) ||
      /\bwhat\s+(?:application|app|page|window)\s+(?:do\s+i\s+have\s+open|is\s+(?:currently\s+)?(?:open|visible|in\s+foreground|on\s+(?:the\s+|my\s+)?(?:screen|desktop)))\b/i.test(stripped) ||
      /\bcan\s+you\s+see\s+what\s+is\s+on\s+my\s+(?:page|screen|desktop|display)\b/i.test(stripped)
    ) {
      return {
        action: 'READ_CONTENT',
        targetType: 'SCREEN',
        application: null,
        target: 'screen',
        contentRequest: 'screen_perception',
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Direct visual screen/desktop perception query',
      };
    }

    // ── 10. Task Status & Worker Introspection (NOT DELEGATION) ──────────────
    if (
      /\b(?:status\s+of|what\s+(?:is|happened\s+with)|how\s+is|did\s+(?:hermes|antigravity|codex|he|she|it|you)\s+finish|is\s+it\s+(?:done|finished|completed?)|where\s+is)\b/i.test(stripped) &&
      /\b(?:task|job|work|goal|delegat|update|github|git|repo|bgtask-|goal-|hermes|antigravity|codex)\b/i.test(stripped)
    ) {
      let worker: 'antigravity' | 'hermes' | 'codex' | null = null;
      if (/\bhermes\b/i.test(stripped)) worker = 'hermes';
      else if (/\bcodex\b/i.test(stripped)) worker = 'codex';
      else if (/\bantigravity\b/i.test(stripped)) worker = 'antigravity';

      return {
        action: 'TASK_STATUS',
        targetType: 'WORKER',
        application: null,
        target: worker,
        contentRequest: null,
        ordinal: null,
        count: null,
        worker,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Operational task status or worker referent query (NOT delegation)',
      };
    }

    // ── 11. Presence & Conversational Checks ─────────────────────────────────
    if (/\b(?:are\s+you\s+there|you\s+there|you\s+online|you\s+listening)\b/i.test(stripped) ||
        /^(?:(?:hey|hi|hello)\s+)?(?:jarvis|javis)?[.!?]?$/i.test(stripped)) {
      return {
        action: 'CONVERSATIONAL',
        targetType: 'NONE',
        application: null,
        target: null,
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt,
        normalizedPrompt,
        reason: 'Presence or conversational greeting inquiry',
      };
    }

    // ── 12. Other / General ──────────────────────────────────────────────────
    return {
      action: 'OTHER',
      targetType: 'NONE',
      application: null,
      target: null,
      contentRequest: null,
      ordinal: null,
      count: null,
      worker: null,
      delegationRequested: false,
      confidence: 0.5,
      isDirectCommand: false,
      rawPrompt,
      normalizedPrompt,
      reason: 'General unclassified turn; passed to downstream capability dispatcher',
    };
  }
}

/**
 * Backward compatibility alias for existing callers.
 */
export const arbitrateSemanticIntent = AuthoritativeIntentCompiler.compile;
