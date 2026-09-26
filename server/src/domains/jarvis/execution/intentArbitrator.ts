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
import {
  unifiedActionOrchestrator,
  type ActionIntent,
  type RegisteredCapability,
  type ConversationCorrection,
} from './unifiedActionOrchestrator.js';

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
  actionIntent: ActionIntent;
  selectedCapability: RegisteredCapability;
  correction?: ConversationCorrection;
  browserPlan?: {
    action: 'locate_channel' | 'open_latest_video' | 'navigate' | 'search' | 'confirm_channel' | 'stay_page';
    target: string;
    entityQuery?: string;
    excludeShorts?: boolean;
    channelName?: string;
  };
  memoryPlan?: {
    action: 'recall' | 'store';
    query: string;
    entityName?: string;
    entityType?: string;
    relation?: string;
  };
  desktopPlan?: {
    action: 'resolve' | 'open' | 'focus';
    appName: string;
    executable?: string;
    processName?: string;
  };
  projectPlan?: {
    action: 'delete' | 'open' | 'update';
    projectName: string;
    projectId?: string;
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
   * Authoritative intent arbitration powered by UnifiedActionOrchestrator.
   * Evaluates all capabilities and normalizes into ONE ActionIntent before execution.
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
    const snapshot = this.computeActiveContext(conversationId, cleanPrompt, context);

    // Run unified capability-first orchestration
    const unified = unifiedActionOrchestrator.interpretAction(rawPrompt, conversationId, context);

    // Map capability ID to SubsystemRoute for backward compatibility
    let selectedRoute: SubsystemRoute = 'conversation';
    const capId = unified.selectedCapability.id;
    if (capId.startsWith('browser.')) {
      selectedRoute = 'browser';
    } else if (capId.startsWith('desktop.')) {
      selectedRoute = 'desktop';
    } else if (capId.startsWith('memory.')) {
      selectedRoute = 'memory';
    } else if (capId.startsWith('project.') || capId.startsWith('agenticos.')) {
      selectedRoute = 'internal_agenticos';
    } else {
      selectedRoute = 'conversation';
    }

    // Construct candidate arbitration entries for trace output
    const candidatesForTrace: Record<string, CandidateScoreEntry> = {
      'browser.entity_lookup': {
        score: Math.max(unified.candidates['browser.open_entity']?.score || 0, unified.candidates['browser.navigate']?.score || 0, unified.candidates['browser.inspect']?.score || 0),
        reason: unified.candidates['browser.open_entity']?.reason || unified.candidates['browser.navigate']?.reason || 'Browser capability evaluation',
      },
      'memory.search': {
        score: Math.max(unified.candidates['memory.recall']?.score || 0, unified.candidates['memory.remember']?.score || 0),
        reason: unified.candidates['memory.recall']?.reason || unified.candidates['memory.remember']?.reason || 'Memory capability evaluation',
      },
      'conversation': {
        score: unified.candidates['conversation.respond']?.score || 0.1,
        reason: unified.candidates['conversation.respond']?.reason || 'Conversational capability',
      },
      'internal_agenticos': {
        score: Math.max(unified.candidates['project.delete']?.score || 0, unified.candidates['project.open']?.score || 0, unified.candidates['agenticos.internal']?.score || 0),
        reason: unified.candidates['project.delete']?.reason || unified.candidates['agenticos.internal']?.reason || 'Internal AgenticOS capability',
      },
      'engineering': {
        score: 0.0,
        reason: 'No engineering/code operation requested',
      },
      'desktop': {
        score: Math.max(unified.candidates['desktop.open_app']?.score || 0, unified.candidates['desktop.resolve_app']?.score || 0),
        reason: unified.candidates['desktop.open_app']?.reason || unified.candidates['desktop.resolve_app']?.reason || 'Desktop OS application capability',
      },
    };

    // Log the EXACT Candidate Arbitration Table matching Section 11 trace
    const tableHeader = [
      '\n================================================================',
      'JARVIS AUTHORITATIVE INTENT ARBITRATION',
      `Prompt: "${rawPrompt}"`,
      `ActionIntent: mode=${unified.actionIntent.mode} verb=${unified.actionIntent.verb} targetType=${unified.actionIntent.targetType} targetName=${unified.actionIntent.targetName || 'none'}`,
      `Capability: ${unified.selectedCapability.id}`,
      `Active Context: Platform=${snapshot.activePlatform || 'none'}, Entity=${snapshot.activeBrowserEntity?.entityName || 'none'}, Mode=${snapshot.conversationMode}`,
      '----------------------------------------------------------------',
      `browser.entity_lookup = ${candidatesForTrace['browser.entity_lookup'].score.toFixed(2)}  ${candidatesForTrace['browser.entity_lookup'].reason}`,
      `memory.search         = ${candidatesForTrace['memory.search'].score.toFixed(2)}  ${candidatesForTrace['memory.search'].reason}`,
      `conversation          = ${candidatesForTrace['conversation'].score.toFixed(2)}  ${candidatesForTrace['conversation'].reason}`,
      `internal_agenticos    = ${candidatesForTrace['internal_agenticos'].score.toFixed(2)}  ${candidatesForTrace['internal_agenticos'].reason}`,
      `engineering           = ${candidatesForTrace['engineering'].score.toFixed(2)}  ${candidatesForTrace['engineering'].reason}`,
      `desktop               = ${candidatesForTrace['desktop'].score.toFixed(2)}  ${candidatesForTrace['desktop'].reason}`,
      '----------------------------------------------------------------',
      `SELECTED ROUTE: ${selectedRoute.toUpperCase()} (capability: ${unified.selectedCapability.id}, confidence: ${unified.confidence.toFixed(2)})`,
      `WHY SELECTED  : ${unified.whySelected}`,
      '================================================================\n',
    ].join('\n');

    console.log(tableHeader);
    logger.info('[IntentArbitrator] Arbitration complete', {
      prompt: rawPrompt,
      actionIntent: unified.actionIntent,
      selectedCapability: unified.selectedCapability.id,
      selectedRoute,
      confidence: unified.confidence,
      whySelected: unified.whySelected,
      candidates: unified.candidates,
    });

    return {
      selectedRoute,
      confidence: unified.confidence,
      whySelected: unified.whySelected,
      candidates: candidatesForTrace,
      context: snapshot,
      actionIntent: unified.actionIntent,
      selectedCapability: unified.selectedCapability,
      correction: unified.correction,
      browserPlan: unified.browserPlan,
      memoryPlan: unified.memoryPlan,
      desktopPlan: unified.desktopPlan,
      projectPlan: unified.projectPlan,
      conversationalPlan: unified.conversationalPlan,
    };
  }
}

export const intentArbitrator = new IntentArbitrator();
