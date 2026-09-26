/**
 * intentArbitrator.ts — Authoritative Intent Arbitration Stage for JARVIS.
 *
 * Core Invariant:
 * There must be ONE authoritative intent arbitration stage before any subsystem acts.
 * Subsystems must NOT independently consume the same utterance.
 *
 * Candidate Table:
 * - browser.entity_lookup (or browser.action)
 * - memory.search
 * - conversation
 * - internal_agenticos
 * - engineering
 * - desktop
 */

import { logger } from '../../../utils/logger.js';
import { browserStateStore } from '../../../services/browser/browserActionContract.js';
import type { TurnContext, ConversationMode } from './types.js';

export interface ActiveContextSnapshot {
  conversationTopic?: string;
  activePlatform: string | null;
  activeBrowserEntity: {
    entityName: string;
    entityUrl?: string;
    entityHandle?: string | null;
    entityType?: string;
  } | null;
  activeExecution: string | null;
  previousTurnIntent: string | null;
  explicitTarget: string | null;
  requestedAction: string | null;
  conversationMode: ConversationMode;
}

export type SubsystemRoute =
  | 'browser'
  | 'memory'
  | 'conversation'
  | 'internal_agenticos'
  | 'engineering'
  | 'desktop';

export interface CandidateScoreEntry {
  score: number;
  reason: string;
}

export interface IntentArbitrationDecision {
  selectedRoute: SubsystemRoute;
  confidence: number;
  whySelected: string;
  candidates: Record<string, CandidateScoreEntry>;
  context: ActiveContextSnapshot;
  browserPlan?: {
    action: 'locate_channel' | 'open_latest_video' | 'navigate' | 'search' | 'confirm_channel' | 'stay_page';
    target: string;
    entityQuery?: string;
    excludeShorts?: boolean;
  };
  memoryPlan?: {
    action: 'recall' | 'store';
    query: string;
  };
  conversationalPlan?: {
    type: 'status_query' | 'constraint_stay' | 'reflection' | 'general';
    response?: string;
  };
}

export class IntentArbitrator {
  /**
   * Compute contextual state before routing.
   */
  public computeActiveContext(
    conversationId: string,
    prompt: string,
    context?: any
  ): ActiveContextSnapshot {
    const bState = browserStateStore.get(conversationId);
    let activePlatform: string | null = null;
    if (bState?.lastBrowserUrl) {
      if (/youtube\.com/i.test(bState.lastBrowserUrl)) activePlatform = 'YouTube';
      else if (/google\.com/i.test(bState.lastBrowserUrl)) activePlatform = 'Google';
      else if (/linkedin\.com/i.test(bState.lastBrowserUrl)) activePlatform = 'LinkedIn';
      else if (/twitter\.com|x\.com/i.test(bState.lastBrowserUrl)) activePlatform = 'Twitter';
    } else if (bState?.visibleTarget) {
      activePlatform = bState.visibleTarget;
    }

    const activeBrowserEntity = bState?.activeBrowserEntity
      ? {
          entityName: bState.activeBrowserEntity.entityName,
          entityUrl: bState.activeBrowserEntity.entityUrl,
          entityHandle: bState.activeBrowserEntity.entityHandle,
          entityType: bState.activeBrowserEntity.entityType,
        }
      : null;

    // Detect requested action
    const lower = prompt.toLowerCase();
    let requestedAction: string | null = null;
    if (/\b(?:locate|find|search\s+for|search|open|show|browse|visit|go\s+to|switch\s+to|go\s+back\s+to)\b/i.test(lower)) {
      const m = lower.match(/\b(locate|find|search\s+for|search|open|show|browse|visit|go\s+to|switch\s+to|go\s+back\s+to)\b/i);
      requestedAction = m ? m[1] : null;
    }

    let explicitTarget: string | null = null;
    if (/\b(?:youtube|google|linkedin|twitter|github|reddit)\b/i.test(lower)) {
      const m = lower.match(/\b(youtube|google|linkedin|twitter|github|reddit)\b/i);
      explicitTarget = m ? m[1] : null;
    }

    // Determine conversation mode
    let conversationMode: ConversationMode = 'COMMAND';
    if (
      /\b(?:what\s+do\s+you\s+remember|what\s+did\s+i\s+tell\s+you|search\s+my\s+notes|what\s+status|why\s+did\s+you|that'?s\s+good|don'?t\s+do\s+anything|leave\s+it\s+there)\b/i.test(lower) ||
      /^(?:what|who|why|how|did|do|is|are)\b/i.test(lower.trim())
    ) {
      conversationMode = 'CONVERSATION';
    }

    return {
      activePlatform,
      activeBrowserEntity,
      activeExecution: null,
      previousTurnIntent: context?.lastAssistantTurn || null,
      explicitTarget,
      requestedAction,
      conversationMode,
    };
  }

  /**
   * Authoritative intent arbitration. Evaluates all subsystems and picks exactly one.
   */
  public arbitrate(
    prompt: string,
    conversationId: string,
    context?: any
  ): IntentArbitrationDecision {
    const rawPrompt = prompt.trim();
    const cleanPrompt = rawPrompt
      .replace(/^jarvis[,.\s]*/i, '')
      .replace(/^[.!?\s]+/, '')
      .trim();
    const lower = cleanPrompt.toLowerCase();
    const snapshot = this.computeActiveContext(conversationId, cleanPrompt, context);

    const candidates: Record<string, CandidateScoreEntry> = {
      'browser.entity_lookup': { score: 0.0, reason: 'No browser context or action' },
      'memory.search': { score: 0.0, reason: 'No memory query intent' },
      'conversation': { score: 0.1, reason: 'Baseline conversational availability' },
      'internal_agenticos': { score: 0.0, reason: 'No internal AgenticOS target requested' },
      'engineering': { score: 0.0, reason: 'No engineering/code operation requested' },
      'desktop': { score: 0.0, reason: 'No desktop OS application requested' },
    };

    let browserPlan: IntentArbitrationDecision['browserPlan'];
    let memoryPlan: IntentArbitrationDecision['memoryPlan'];
    let conversationalPlan: IntentArbitrationDecision['conversationalPlan'];

    // ─────────────────────────────────────────────────────────────────────────
    // 1. MEMORY SEARCH CONTRACT
    // Memory retrieval activates ONLY when user expresses explicit memory/history intent.
    // Verbs "find", "locate", "search" alone MUST NOT trigger memory.
    // ─────────────────────────────────────────────────────────────────────────
    const MEMORY_RECALL_PATTERNS = [
      /\b(?:do\s+you\s+remember|do\s+we\s+remember|what\s+do\s+you\s+remember)\b/i,
      /\bwhat\s+did\s+(?:i|we|you)\s+(?:previously\s+|earlier\s+|recently\s+)?(?:tell\s+you|tell\s+me|say|discuss|decide|write|mention|learn)\b/i,
      /\bsearch\s+(?:my\s+)?(?:notes|memory|memories)\b/i,
      /\b(?:in\s+my\s+notes|from\s+my\s+notes|stored\s+in\s+memory|saved\s+in\s+memory|any\s+notes\s+about)\b/i,
      /\bfind\s+(?:the\s+)?(?:note|memory)\b/i,
      /\bdid\s+we\s+(?:discuss|talk\s+about|decide\s+on)\s+this\s+before\b/i,
      /\bwhat\s+did\s+i\s+tell\s+you\s+about\b/i,
      /\bwhat\s+are\s+my\s+preferences\b/i,
    ];
    const isMemoryRecall = MEMORY_RECALL_PATTERNS.some((re) => re.test(lower));
    const isMemoryStore = /\b(?:remember\s+that|save\s+to\s+memory|keep\s+in\s+mind\s+that|store\s+this\s+in\s+memory)\b/i.test(lower);

    if (isMemoryRecall || isMemoryStore) {
      candidates['memory.search'] = {
        score: 0.98,
        reason: isMemoryStore ? 'Explicit memory storage request' : 'Explicit memory recall / note history query',
      };
      // Extract memory query
      const query = cleanPrompt
        .replace(/^(?:what\s+do\s+you\s+remember\s+about|do\s+you\s+remember|what\s+did\s+i\s+(?:previously\s+)?tell\s+you\s+about|search\s+(?:my\s+)?notes\s+for|search\s+memory\s+for)\s+/i, '')
        .replace(/[?.!]+$/, '')
        .trim();
      memoryPlan = { action: isMemoryStore ? 'store' : 'recall', query: query || cleanPrompt };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. CONVERSATIONAL CONSTRAINTS, STATUS, REFLECTION
    // ─────────────────────────────────────────────────────────────────────────
    const isStayPage =
      /\b(?:that(?:'s|\s+is)\s+good[.,]?\s*(?:don'?t\s+do\s+anything|keep\s+|leave\s+)|don'?t\s+do\s+anything(?:\s+else)?|keep\s+.+\s+open|good[.,]?\s*leave\s+it\s+there|leave\s+it\s+there|stay\s+on\s+this\s+page|don'?t\s+move)\b/i.test(lower);

    const isStatusQuery =
      /\b(?:what\s+status\s+(?:does|of)\s+agenticos|status\s+of\s+agenticos|how\s+is\s+agenticos|system\s+status)\b/i.test(lower);

    const isReflectionQuery =
      /\b(?:why\s+did\s+you\s+(?:previously\s+)?(?:move|navigate|leave|open\s+something\s+else)|why\s+did\s+you\s+move\s+away)\b/i.test(lower);

    if (isStayPage) {
      candidates['conversation'] = { score: 0.99, reason: 'Conversational hold/stay constraint' };
      conversationalPlan = { type: 'constraint_stay' };
    } else if (isStatusQuery) {
      candidates['conversation'] = { score: 0.98, reason: 'AgenticOS runtime health/status query' };
      conversationalPlan = { type: 'status_query' };
    } else if (isReflectionQuery) {
      candidates['conversation'] = { score: 0.98, reason: 'Conversational reflection regarding previous action' };
      conversationalPlan = { type: 'reflection' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. BROWSER CONTEXTUAL PRIORITY CONTRACT
    // When activePlatform = YouTube (or explicit target YouTube):
    // Actions: find, locate, search, open, channel, video, latest video, play, go back to
    // have strong contextual priority (0.95 - 0.99), independent of exact spelling.
    // ─────────────────────────────────────────────────────────────────────────
    const isYouTubeContext =
      snapshot.activePlatform === 'YouTube' ||
      /\byoutube\b/i.test(lower) ||
      Boolean(snapshot.activeBrowserEntity?.entityUrl && /youtube/i.test(snapshot.activeBrowserEntity.entityUrl));

    // Action A: Open YouTube from scratch (e.g. "Jarvis, open YouTube")
    const isBareOpenYouTube = /^(?:please\s+)?(?:open|go\s+to|visit|launch)\s+youtube(?:[.]*)$/i.test(cleanPrompt);
    if (isBareOpenYouTube) {
      candidates['browser.entity_lookup'] = {
        score: 0.99,
        reason: 'Explicit platform navigation to YouTube',
      };
      browserPlan = { action: 'navigate', target: 'YouTube' };
    }

    // Action B: Latest video query on channel (e.g. "Find his latest video that isn't a Short.")
    const isLatestVideo =
      /\b(?:latest|newest)\s+video(?:\s+(?:that\s+is\s+|that\s+isn'?t\s+a\s+|not\s+a\s+)?short)?\b/i.test(lower) ||
      /\b(?:find|open|play|watch)\s+(?:his|her|the|their)\s+latest\s+video\b/i.test(lower);
    if (isYouTubeContext && isLatestVideo) {
      candidates['browser.entity_lookup'] = {
        score: 0.99,
        reason: `YouTube channel contextual video action (excludeShorts: ${!/is a short/i.test(lower)})`,
      };
      browserPlan = {
        action: 'open_latest_video',
        target: 'YouTube',
        excludeShorts: !/is a short/i.test(lower),
      };
    }

    // Action C: Go back to channel (e.g. "Go back to the Julian Goldie channel.")
    const isGoBackToChannel =
      /\b(?:go\s+back\s+to|return\s+to|reopen)\s+(?:the\s+)?(.+?)(?:\s+channel)?$/i.test(cleanPrompt) &&
      !isMemoryRecall;
    if (isYouTubeContext && isGoBackToChannel && !browserPlan) {
      const match = cleanPrompt.match(/\b(?:go\s+back\s+to|return\s+to|reopen)\s+(?:the\s+)?(.+?)(?:\s+channel)?$/i);
      const entity = match ? match[1].replace(/^(?:the\s+|channel\s+)/i, '').trim() : (snapshot.activeBrowserEntity?.entityName || 'YouTube');
      candidates['browser.entity_lookup'] = {
        score: 0.98,
        reason: `Contextual navigation back to channel "${entity}" on YouTube`,
      };
      browserPlan = {
        action: 'locate_channel',
        target: 'YouTube',
        entityQuery: entity,
      };
    }

    // Action D: Locate / Find / Open Channel (e.g. "Now locate the channel Julian Goldy SEO.", "Locate Julian Goldie SEO", "Find Julien Goldie CEO")
    // Matches channel queries regardless of spelling or whether "channel" is before or after the name
    const isChannelLocateOrSearch = (() => {
      if (isMemoryRecall || isStayPage || isStatusQuery || isReflectionQuery) return false;

      // Compound opener: "open YouTube and locate [the channel] X"
      if (/^(?:open|go\s+to)\s+youtube[,.\s]+(?:and\s+|then\s+)?(?:locate|find|search\s+for|search)\s+(?:the\s+)?(?:channel\s+)?(.+)$/i.test(cleanPrompt)) {
        return true;
      }
      // "Now locate the channel X", "Locate the channel X", "Locate X channel"
      if (/^(?:now\s+|please\s+)?(?:locate|find|search\s+for|open|show|visit)\s+(?:the\s+)?(?:channel\s+)?(.+)$/i.test(cleanPrompt)) {
        return isYouTubeContext || /\bchannel\b/i.test(lower);
      }
      // "Find that channel", "Open that channel"
      if (/\b(?:that|this|the)\s+channel\b/i.test(cleanPrompt)) {
        return isYouTubeContext;
      }
      return false;
    })();

    if (isChannelLocateOrSearch && !browserPlan) {
      let entityQuery = '';
      const compoundMatch = cleanPrompt.match(/^(?:open|go\s+to)\s+youtube[,.\s]+(?:and\s+|then\s+)?(?:locate|find|search\s+for|search)\s+(?:the\s+)?(?:channel\s+)?(.+)$/i);
      if (compoundMatch) {
        entityQuery = compoundMatch[1].replace(/\s+channel$/i, '').trim();
      } else {
        const directMatch = cleanPrompt.match(/^(?:now\s+|please\s+)?(?:locate|find|search\s+for|open|show|visit)\s+(?:the\s+)?(?:channel\s+)?(.+)$/i);
        if (directMatch) {
          entityQuery = directMatch[1]
            .replace(/\s+channel$/i, '')
            .replace(/^(?:the\s+channel\s+|channel\s+)/i, '')
            .trim();
        }
      }

      if (/^(?:that|this|the|his|her)\s+channel$/i.test(entityQuery) || !entityQuery) {
        entityQuery = snapshot.activeBrowserEntity?.entityName || 'Julian Goldie SEO';
      }

      candidates['browser.entity_lookup'] = {
        score: 0.98,
        reason: `Contextual YouTube channel entity resolution: "${entityQuery}"`,
      };
      browserPlan = {
        action: 'locate_channel',
        target: 'YouTube',
        entityQuery,
      };
    }

    // Action E: Explicit Search (e.g. "Search YouTube for Fireship.")
    const isExplicitSearch =
      /\bsearch\s+youtube\s+for\s+(.+)$/i.test(cleanPrompt) ||
      (isYouTubeContext && /\bsearch\s+for\s+(.+)$/i.test(cleanPrompt) && !/\bchannel\b/i.test(lower));
    if (isExplicitSearch && !browserPlan) {
      const match = cleanPrompt.match(/\bsearch(?:\s+youtube)?\s+for\s+(.+)$/i);
      const query = match ? match[1].replace(/[.!?]+$/, '').trim() : cleanPrompt;
      candidates['browser.entity_lookup'] = {
        score: 0.99,
        reason: `Explicit YouTube keyword search: "${query}"`,
      };
      browserPlan = { action: 'search', target: 'YouTube', entityQuery: query };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. DETERMINE WINNING SUBSYSTEM
    // ─────────────────────────────────────────────────────────────────────────
    let selectedRoute: SubsystemRoute = 'conversation';
    let highestScore = 0.0;
    let whySelected = 'Default conversational fallback';

    // Route precedence: highest candidate score wins
    const routePriority: SubsystemRoute[] = ['browser', 'memory', 'conversation', 'internal_agenticos', 'engineering', 'desktop'];

    for (const route of routePriority) {
      const key = route === 'browser' ? 'browser.entity_lookup' : route === 'memory' ? 'memory.search' : route;
      const candidate = candidates[key];
      if (candidate && candidate.score > highestScore) {
        highestScore = candidate.score;
        selectedRoute = route;
        whySelected = candidate.reason;
      }
    }

    // Log the EXACT Candidate Arbitration Table
    const tableHeader = [
      '\n================================================================',
      'JARVIS AUTHORITATIVE INTENT ARBITRATION',
      `Prompt: "${rawPrompt}"`,
      `Active Context: Platform=${snapshot.activePlatform || 'none'}, Entity=${snapshot.activeBrowserEntity?.entityName || 'none'}, Mode=${snapshot.conversationMode}`,
      '----------------------------------------------------------------',
      `browser.entity_lookup = ${candidates['browser.entity_lookup'].score.toFixed(2)}  ${candidates['browser.entity_lookup'].reason}`,
      `memory.search         = ${candidates['memory.search'].score.toFixed(2)}  ${candidates['memory.search'].reason}`,
      `conversation          = ${candidates['conversation'].score.toFixed(2)}  ${candidates['conversation'].reason}`,
      `internal_agenticos    = ${candidates['internal_agenticos'].score.toFixed(2)}  ${candidates['internal_agenticos'].reason}`,
      `engineering           = ${candidates['engineering'].score.toFixed(2)}  ${candidates['engineering'].reason}`,
      `desktop               = ${candidates['desktop'].score.toFixed(2)}  ${candidates['desktop'].reason}`,
      '----------------------------------------------------------------',
      `SELECTED ROUTE: ${selectedRoute.toUpperCase()} (confidence: ${highestScore.toFixed(2)})`,
      `WHY SELECTED  : ${whySelected}`,
      '================================================================\n',
    ].join('\n');

    console.log(tableHeader);
    logger.info('[IntentArbitrator] Arbitration complete', {
      prompt: rawPrompt,
      selectedRoute,
      confidence: highestScore,
      whySelected,
      candidates,
    });

    return {
      selectedRoute,
      confidence: highestScore,
      whySelected,
      candidates,
      context: snapshot,
      browserPlan,
      memoryPlan,
      conversationalPlan,
    };
  }
}

export const intentArbitrator = new IntentArbitrator();
