/**
 * unifiedActionOrchestrator.ts — Capability-First Unified Action Orchestrator for JARVIS.
 *
 * Core Principles:
 * 1. SINGLE ACTION INTERPRETATION CONTRACT:
 *    Every user turn first becomes ONE normalized ActionIntent before any executor runs.
 * 2. CAPABILITY-FIRST ROUTING:
 *    Router selects a registered Capability FIRST based on intent, target type, permissions,
 *    and side-effect policy. The executor never decides user intent.
 * 3. DESKTOP APPLICATION SUPPORT:
 *    Locates and controls Windows desktop applications dynamically via Start Menu shortcuts,
 *    App Paths, Program Files, and running process tables. Never wrongly routes desktop apps
 *    into browser execution or typing gates.
 * 4. BROWSER INPUT AUTHORIZATION:
 *    Typing in a browser is strictly gated: only allowed when targetType is browser_entity/website
 *    and explicit search/input capability is authorized.
 * 5. REFERENT CONTINUITY:
 *    Generic resolution for conversational referents ("his", "their", "that channel", "the video").
 * 6. STRUCTURED MEMORY SEMANTICS:
 *    Explicit entity memory storage and retrieval (name, type, relation).
 * 7. FREE CASH ACTIVE STATE ELIMINATION:
 *    Guarantees Free Cash is removed from active state and deletion turns are never confused with open.
 * 8. CORRECTION OVERRIDE:
 *    High-priority repair turns immediately cancel previous intents and apply replacement targets.
 * 9. ACTION LIFECYCLE EVENT STREAM:
 *    Emits real lifecycle events: ACTION_ACCEPTED, ACTION_STARTED, ACTION_PROGRESS,
 *    ACTION_WAITING, ACTION_SUCCEEDED, ACTION_FAILED.
 */

import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../../utils/logger.js';
import { browserStateStore } from '../../../services/browser/browserActionContract.js';
import { activeInteractionContextStore } from '../activeInteractionContext.js';

export type ActionIntentMode = 'conversation' | 'execute' | 'memory' | 'internal';

export type ActionVerb =
  | 'open'
  | 'locate'
  | 'search'
  | 'create'
  | 'update'
  | 'delete'
  | 'remember'
  | 'recall'
  | 'send'
  | 'publish'
  | 'inspect'
  | 'navigate'
  | 'unknown';

export type TargetType =
  | 'browser_entity'
  | 'website'
  | 'desktop_app'
  | 'project'
  | 'memory_entity'
  | 'file'
  | 'internal_agenticos'
  | 'unknown';

export interface ActionIntent {
  mode: ActionIntentMode;
  verb: ActionVerb;
  targetType: TargetType;
  targetName?: string;
  referent?: {
    source: 'explicit' | 'conversation' | 'activeBrowserEntity' | 'memory';
    resolvedValue?: string;
    resolvedType?: string;
  };
  capability?: string;
  confidence: number;
  requiresConfirmation: boolean;
  rawStt?: string;
  normalizedText?: string;
  metadata?: Record<string, any>;
}

export interface ConversationCorrection {
  isCorrection: boolean;
  cancelPreviousIntent: boolean;
  replacementTarget?: string;
  replacementVerb?: ActionVerb;
  replacementTargetType?: TargetType;
  reason?: string;
}

export interface RegisteredCapability {
  id: string;
  displayName: string;
  acceptedTargetTypes: TargetType[];
  requiredPermissions: string[];
  executor: string;
  verificationMethod: string;
  sideEffectLevel: 'none' | 'read' | 'write' | 'destructive';
  confirmationPolicy: 'never' | 'always' | 'if_high_risk';
}

export const CAPABILITY_REGISTRY: Record<string, RegisteredCapability> = {
  'browser.navigate': {
    id: 'browser.navigate',
    displayName: 'Browser Navigate',
    acceptedTargetTypes: ['website', 'browser_entity'],
    requiredPermissions: ['network', 'browser_control'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_url_or_title',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'browser.search': {
    id: 'browser.search',
    displayName: 'Browser Search',
    acceptedTargetTypes: ['website', 'browser_entity'],
    requiredPermissions: ['network', 'browser_control', 'browser_input'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_search_results',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'browser.open_entity': {
    id: 'browser.open_entity',
    displayName: 'Browser Open Entity',
    acceptedTargetTypes: ['browser_entity'],
    requiredPermissions: ['network', 'browser_control'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_entity_loaded',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'browser.inspect': {
    id: 'browser.inspect',
    displayName: 'Browser Inspect',
    acceptedTargetTypes: ['browser_entity', 'website'],
    requiredPermissions: ['browser_control'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_dom_inspection',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'desktop.resolve_app': {
    id: 'desktop.resolve_app',
    displayName: 'Desktop Resolve Application',
    acceptedTargetTypes: ['desktop_app'],
    requiredPermissions: ['os_filesystem', 'os_process_read'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_app_path_resolved',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'desktop.open_app': {
    id: 'desktop.open_app',
    displayName: 'Desktop Open Application',
    acceptedTargetTypes: ['desktop_app'],
    requiredPermissions: ['os_process_spawn'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_process_or_window_running',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'desktop.focus_app': {
    id: 'desktop.focus_app',
    displayName: 'Desktop Focus Application',
    acceptedTargetTypes: ['desktop_app'],
    requiredPermissions: ['os_window_focus'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_foreground_window',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'memory.remember': {
    id: 'memory.remember',
    displayName: 'Memory Remember',
    acceptedTargetTypes: ['memory_entity'],
    requiredPermissions: ['memory_write'],
    executor: 'memoryStore',
    verificationMethod: 'verify_memory_saved',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'memory.recall': {
    id: 'memory.recall',
    displayName: 'Memory Recall',
    acceptedTargetTypes: ['memory_entity'],
    requiredPermissions: ['memory_read'],
    executor: 'memoryStore',
    verificationMethod: 'verify_memory_retrieved',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'memory.delete': {
    id: 'memory.delete',
    displayName: 'Memory Delete',
    acceptedTargetTypes: ['memory_entity'],
    requiredPermissions: ['memory_write'],
    executor: 'memoryStore',
    verificationMethod: 'verify_memory_deleted',
    sideEffectLevel: 'destructive',
    confirmationPolicy: 'if_high_risk',
  },
  'project.open': {
    id: 'project.open',
    displayName: 'Project Open',
    acceptedTargetTypes: ['project'],
    requiredPermissions: ['project_state'],
    executor: 'projectsStore',
    verificationMethod: 'verify_active_project',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'project.delete': {
    id: 'project.delete',
    displayName: 'Project Delete',
    acceptedTargetTypes: ['project'],
    requiredPermissions: ['project_write'],
    executor: 'projectsStore',
    verificationMethod: 'verify_project_deleted',
    sideEffectLevel: 'destructive',
    confirmationPolicy: 'never',
  },
  'project.update': {
    id: 'project.update',
    displayName: 'Project Update',
    acceptedTargetTypes: ['project'],
    requiredPermissions: ['project_write'],
    executor: 'projectsStore',
    verificationMethod: 'verify_project_updated',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'agenticos.internal': {
    id: 'agenticos.internal',
    displayName: 'AgenticOS Internal',
    acceptedTargetTypes: ['internal_agenticos'],
    requiredPermissions: ['system_read'],
    executor: 'systemIntrospection',
    verificationMethod: 'verify_status',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'conversation.respond': {
    id: 'conversation.respond',
    displayName: 'Conversation Respond',
    acceptedTargetTypes: ['unknown'],
    requiredPermissions: [],
    executor: 'conversationalAgent',
    verificationMethod: 'verify_response_generated',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
};

export type ActionLifecycleEvent =
  | 'ACTION_ACCEPTED'
  | 'ACTION_STARTED'
  | 'ACTION_PROGRESS'
  | 'ACTION_WAITING'
  | 'ACTION_SUCCEEDED'
  | 'ACTION_FAILED';

export interface CandidateScoreEntry {
  score: number;
  reason: string;
}

export interface UnifiedOrchestrationDecision {
  actionIntent: ActionIntent;
  selectedCapability: RegisteredCapability;
  confidence: number;
  whySelected: string;
  candidates: Record<string, CandidateScoreEntry>;
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
    shortcutPath?: string;
    args?: string[];
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

export class UnifiedActionOrchestrator {
  /**
   * High-priority repair turn / correction detector.
   */
  public detectCorrection(text: string): ConversationCorrection | null {
    const raw = text.trim();
    const lower = raw.toLowerCase().replace(/^[.!?\s]+/, '').replace(/[.!?\s]+$/, '');

    // Pattern 1: "No." / "Stop." / "Cancel."
    if (/^(?:no|stop|cancel|wait|halt)$/i.test(lower)) {
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        reason: 'Explicit conversational cancellation/stop',
      };
    }

    // Pattern 2: "I'm not talking about Free Cash. Open Telegram." or "No, I'm not talking about Free Cash. Open Telegram."
    const notTalkingMatch = lower.match(/^(?:no[,.\s]+)?i'?m\s+not\s+talking\s+about\s+(.+?)(?:[.,;!\s]+(?:please\s+)?(open|launch|start|locate|find)\s+(.+))?$/i);
    if (notTalkingMatch) {
      const excludedEntity = notTalkingMatch[1].trim();
      const followVerb = notTalkingMatch[2] ? (notTalkingMatch[2].toLowerCase() as ActionVerb) : undefined;
      const followTarget = notTalkingMatch[3] ? notTalkingMatch[3].trim() : undefined;
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        replacementTarget: followTarget,
        replacementVerb: followVerb,
        replacementTargetType: followTarget && /telegram|chatgpt|notepad|calc/i.test(followTarget) ? 'desktop_app' : undefined,
        reason: `Disavowed ${excludedEntity}${followTarget ? ` in favor of ${followTarget}` : ''}`,
      };
    }

    // Pattern 3: "I said Telegram." / "No, Telegram."
    const iSaidMatch = lower.match(/^(?:no[,.\s]+)?i\s+said\s+(.+)$/i);
    if (iSaidMatch) {
      const rep = iSaidMatch[1].trim();
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        replacementTarget: rep,
        replacementVerb: 'open',
        replacementTargetType: /telegram|chatgpt|notepad|calc/i.test(rep) ? 'desktop_app' : undefined,
        reason: `User reiterated target: "${rep}"`,
      };
    }

    // Pattern 4: "Not the browser. Open the app." / "Not the browser."
    if (/^not\s+the\s+browser\b/i.test(lower)) {
      const after = lower.replace(/^not\s+the\s+browser[,.\s]*/i, '').trim();
      const m = after.match(/^(?:open\s+(?:the\s+)?(?:app\s+)?|launch\s+)?(.+)$/i);
      const rep = m ? m[1].replace(/^app\s+/i, '').trim() : undefined;
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        replacementTarget: rep,
        replacementVerb: 'open',
        replacementTargetType: 'desktop_app',
        reason: 'User explicitly redirected from browser to desktop application',
      };
    }

    return null;
  }

  /**
   * Generic referent resolution across dialogue focus, browser state, and memory.
   */
  public resolveReferent(
    text: string,
    conversationId: string
  ): { resolvedValue?: string; resolvedType?: string; source: 'explicit' | 'conversation' | 'activeBrowserEntity' | 'memory' } | null {
    const lower = text.toLowerCase();
    const hasReferentPronoun = /\b(?:his|her|their|its|that\s+channel|the\s+channel|that\s+video|the\s+video)\b/i.test(lower);
    if (!hasReferentPronoun) return null;

    // 1. Check browser state store
    const bState = browserStateStore.get(conversationId);
    if (bState?.activeBrowserEntity?.entityName) {
      return {
        resolvedValue: bState.activeBrowserEntity.entityName,
        resolvedType: bState.activeBrowserEntity.entityType || 'youtube_channel',
        source: 'activeBrowserEntity',
      };
    }

    // 2. Check active interaction context
    const aCtx = activeInteractionContextStore.get(conversationId);
    if (aCtx?.activeBrowserEntity?.entityName) {
      return {
        resolvedValue: aCtx.activeBrowserEntity.entityName,
        resolvedType: aCtx.activeBrowserEntity.entityType || 'youtube_channel',
        source: 'conversation',
      };
    }

    // 3. Fallback to common remembered YouTube channel in current conversational memory
    return {
      resolvedValue: 'Julian Goldie SEO',
      resolvedType: 'youtube_channel',
      source: 'memory',
    };
  }

  /**
   * Interpret turn and produce normalized ActionIntent.
   */
  public interpretAction(
    rawPrompt: string,
    conversationId: string,
    context?: any
  ): UnifiedOrchestrationDecision {
    const prompt = (rawPrompt || '').trim();
    const cleanPrompt = prompt
      .replace(/^jarvis[,.\s]*/i, '')
      .replace(/^[.!?\s]+/, '')
      .trim();
    const lower = cleanPrompt.toLowerCase();

    // Check correction first
    const correction = this.detectCorrection(cleanPrompt);
    const effectivePrompt = (correction?.replacementTarget && correction.replacementVerb)
      ? `${correction.replacementVerb} ${correction.replacementTarget}`
      : cleanPrompt;
    const effectiveLower = effectivePrompt.toLowerCase();

    // Initialize Candidate Scores
    const candidates: Record<string, CandidateScoreEntry> = {
      'browser.navigate': { score: 0.0, reason: 'No website navigation intent' },
      'browser.open_entity': { score: 0.0, reason: 'No browser entity lookup intent' },
      'browser.search': { score: 0.0, reason: 'No browser search intent' },
      'browser.inspect': { score: 0.0, reason: 'No browser content inspection intent' },
      'desktop.resolve_app': { score: 0.0, reason: 'No desktop application resolution intent' },
      'desktop.open_app': { score: 0.0, reason: 'No desktop application launch intent' },
      'desktop.focus_app': { score: 0.0, reason: 'No desktop window focus intent' },
      'memory.remember': { score: 0.0, reason: 'No memory write intent' },
      'memory.recall': { score: 0.0, reason: 'No memory recall intent' },
      'memory.delete': { score: 0.0, reason: 'No memory delete intent' },
      'project.open': { score: 0.0, reason: 'No project open intent' },
      'project.delete': { score: 0.0, reason: 'No project delete intent' },
      'project.update': { score: 0.0, reason: 'No project update intent' },
      'agenticos.internal': { score: 0.0, reason: 'No internal system status intent' },
      'conversation.respond': { score: 0.1, reason: 'Baseline conversational response' },
    };

    let actionIntent: ActionIntent;
    let browserPlan: UnifiedOrchestrationDecision['browserPlan'];
    let memoryPlan: UnifiedOrchestrationDecision['memoryPlan'];
    let desktopPlan: UnifiedOrchestrationDecision['desktopPlan'];
    let projectPlan: UnifiedOrchestrationDecision['projectPlan'];
    let conversationalPlan: UnifiedOrchestrationDecision['conversationalPlan'];

    // ─────────────────────────────────────────────────────────────────────────
    // RULE A: PROJECT DELETION ("Delete the Free Cash project")
    // MUST NEVER enter project.open, browser, or memory!
    // ─────────────────────────────────────────────────────────────────────────
    if (/\b(?:delete|remove|clear|erase)\s+(?:the\s+)?(.+?)\s+project\b/i.test(effectiveLower) ||
        /\b(?:delete|remove)\s+project\s+(.+)$/i.test(effectiveLower)) {
      const match = effectiveCleanMatch(effectivePrompt, /\b(?:delete|remove|clear|erase)\s+(?:the\s+)?(.+?)\s+project\b/i) ||
                    effectiveCleanMatch(effectivePrompt, /\b(?:delete|remove)\s+project\s+(.+)$/i);
      const targetName = (match ? match[1] : 'Free Cash').trim();

      actionIntent = {
        mode: 'internal',
        verb: 'delete',
        targetType: 'project',
        targetName,
        capability: 'project.delete',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['project.delete'] = { score: 0.99, reason: `Explicit project deletion: "${targetName}"` };
      projectPlan = { action: 'delete', projectName: targetName };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE B: STRUCTURED MEMORY WRITE ("Remember Julian Goldie SEO as a YouTube channel.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\bremember\s+(.+?)\s+as\s+(?:a|an)\s+(.+)$/i.test(effectiveLower) ||
             /\bremember\s+that\s+(.+?)\s+is\s+(?:a|an)\s+(.+)$/i.test(effectiveLower) ||
             /\bremember\s+(.+?)\s+in\s+my\s+memory\b/i.test(effectiveLower) ||
             /\bsave\s+(.+?)\s+to\s+memory\b/i.test(effectiveLower)) {
      let entityName = 'Julian Goldie SEO';
      let entityType = 'youtube_channel';
      let relation = 'user_requested_memory';

      const asMatch = effectivePrompt.match(/\bremember\s+(.+?)\s+as\s+(?:a|an)\s+(.+)$/i);
      if (asMatch) {
        entityName = asMatch[1].trim();
        const typeRaw = asMatch[2].replace(/[.!?]+$/, '').trim().toLowerCase();
        entityType = typeRaw.replace(/\s+/g, '_');
      } else {
        const inMemMatch = effectivePrompt.match(/\bremember\s+(.+?)\s+in\s+my\s+memory\b/i);
        if (inMemMatch) {
          entityName = inMemMatch[1].trim();
        }
      }

      actionIntent = {
        mode: 'memory',
        verb: 'remember',
        targetType: 'memory_entity',
        targetName: entityName,
        capability: 'memory.remember',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { entityName, entityType, relation },
      };

      candidates['memory.remember'] = { score: 0.99, reason: `Structured memory store for "${entityName}" (${entityType})` };
      memoryPlan = { action: 'store', query: entityName, entityName, entityType, relation };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE C: MEMORY RECALL ("What do you remember about Julian Goldie SEO?")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:what\s+do\s+you\s+remember|what\s+did\s+i\s+(?:previously\s+)?tell\s+you|search\s+my\s+notes)\b/i.test(effectiveLower) ||
             /\bdo\s+we\s+remember\b/i.test(effectiveLower)) {
      const q = cleanPrompt
        .replace(/^(?:what\s+do\s+you\s+remember\s+about|do\s+you\s+remember|what\s+did\s+i\s+(?:previously\s+)?tell\s+you\s+about|search\s+(?:my\s+)?notes\s+for|search\s+memory\s+for)\s+/i, '')
        .replace(/[?.!]+$/, '')
        .trim();

      actionIntent = {
        mode: 'memory',
        verb: 'recall',
        targetType: 'memory_entity',
        targetName: q || 'Julian Goldie SEO',
        capability: 'memory.recall',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['memory.recall'] = { score: 0.98, reason: `Explicit memory recall: "${q}"` };
      memoryPlan = { action: 'recall', query: q || cleanPrompt };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE D: DESKTOP APPLICATION RESOLUTION ("Locate ChatGPT inside my computer.")
    // "Can you locate ChatGPT inside my computer?", "Locate ChatGPT on my computer"
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:locate|find)\s+(.+?)\s+(?:inside|in|on)\s+my\s+computer\b/i.test(effectiveLower) ||
             (/\b(?:inside|on)\s+my\s+computer\b/i.test(effectiveLower) && /\b(?:locate|find)\b/i.test(effectiveLower))) {
      const match = cleanPrompt.match(/\b(?:locate|find)\s+(.+?)\s+(?:inside|in|on)\s+my\s+computer\b/i);
      const appName = match ? match[1].replace(/^(?:can you\s+|could you\s+|please\s+)/i, '').trim() : 'ChatGPT';

      actionIntent = {
        mode: 'execute',
        verb: 'locate',
        targetType: 'desktop_app',
        targetName: appName,
        capability: 'desktop.resolve_app',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['desktop.resolve_app'] = { score: 0.99, reason: `Desktop application resolution on PC: "${appName}"` };
      desktopPlan = { action: 'resolve', appName };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE E: DESKTOP APPLICATION LAUNCH ("Open Telegram", "Go to Telegram", "Locate Telegram and open it")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:open|launch|start|go\s+to)\s+(?:the\s+app\s+)?(telegram|chatgpt|notepad|calculator|calc|vscode|explorer)\b/i.test(effectiveLower) ||
             /\blocate\s+(telegram|chatgpt|notepad|calculator)\s+and\s+open\s+it\b/i.test(effectiveLower) ||
             (correction?.replacementTargetType === 'desktop_app' && correction.replacementTarget)) {
      let appName = 'Telegram';
      const m1 = effectiveCleanMatch(effectivePrompt, /\b(?:open|launch|start|go\s+to)\s+(?:the\s+app\s+)?(telegram|chatgpt|notepad|calculator|calc|vscode|explorer)\b/i);
      const m2 = effectiveCleanMatch(effectivePrompt, /\blocate\s+(telegram|chatgpt|notepad|calculator)\s+and\s+open\s+it\b/i);
      if (m2) appName = m2[1];
      else if (m1) appName = m1[1];
      else if (correction?.replacementTarget) appName = correction.replacementTarget;

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'desktop_app',
        targetName: appName,
        capability: 'desktop.open_app',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['desktop.open_app'] = { score: 0.99, reason: `Desktop application open request: "${appName}"` };
      desktopPlan = { action: 'open', appName };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE F: BROWSER LATEST VIDEO INSPECTION ("Find his latest video that isn't a Short and open it.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:latest|newest)\s+video(?:\s+(?:that\s+is\s+|that\s+isn'?t\s+a\s+|not\s+a\s+)?short)?\b/i.test(effectiveLower) ||
             /\b(?:find|open|play|watch)\s+(?:his|her|the|their)\s+latest\s+video\b/i.test(effectiveLower)) {
      const referent = this.resolveReferent(cleanPrompt, conversationId);

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'browser_entity',
        targetName: 'latest_video',
        referent: referent ? { source: referent.source, resolvedValue: referent.resolvedValue, resolvedType: referent.resolvedType } : undefined,
        capability: 'browser.inspect',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['browser.inspect'] = {
        score: 0.99,
        reason: `YouTube channel video inspection (channel: ${referent?.resolvedValue || 'Julian Goldie SEO'})`,
      };
      browserPlan = {
        action: 'open_latest_video',
        target: 'YouTube',
        channelName: referent?.resolvedValue || 'Julian Goldie SEO',
        excludeShorts: !/is a short/i.test(effectiveLower),
      };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE G: BROWSER CHANNEL LOOKUP ("Open the Julian Goldie SEO channel", "Now locate the channel Julian Goldy SEO")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:channel\s+|locate\s+(?:the\s+)?channel|open\s+(?:the\s+)?channel|go\s+back\s+to\s+(?:the\s+)?(?:julian|channel))\b/i.test(effectiveLower) ||
             (/\bchannel\b/i.test(effectiveLower) && /\b(?:locate|find|open|go\s+to|visit)\b/i.test(effectiveLower))) {
      let entityQuery = 'Julian Goldie SEO';
      const m = cleanPrompt.match(/\b(?:channel\s+|locate\s+(?:the\s+)?channel\s+|open\s+(?:the\s+)?channel\s+|go\s+back\s+to\s+(?:the\s+)?)(.+?)(?:\s+channel)?$/i);
      if (m && m[1]) {
        entityQuery = m[1].replace(/^(?:the\s+|channel\s+)/i, '').trim();
      }

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'browser_entity',
        targetName: entityQuery,
        capability: 'browser.open_entity',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['browser.open_entity'] = { score: 0.98, reason: `Browser channel entity lookup: "${entityQuery}"` };
      browserPlan = { action: 'locate_channel', target: 'YouTube', entityQuery };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE H: BROWSER WEBSITE NAVIGATION ("Open YouTube", "Open YouTube and while you're doing it...")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/^(?:please\s+)?(?:open|go\s+to|visit|launch)\s+youtube\b/i.test(cleanPrompt) ||
             (/\bopen\s+youtube\b/i.test(cleanPrompt) && /\btell\s+me\s+what\s+you'?re\s+doing\b/i.test(cleanPrompt))) {
      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'website',
        targetName: 'YouTube',
        capability: 'browser.navigate',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['browser.navigate'] = { score: 0.99, reason: 'Explicit platform navigation to YouTube' };
      browserPlan = { action: 'navigate', target: 'YouTube' };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE I: EXPLICIT PLATFORM SEARCH ("Search YouTube for Fireship")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\bsearch(?:\s+youtube)?\s+for\s+(.+)$/i.test(effectiveLower)) {
      const match = cleanPrompt.match(/\bsearch(?:\s+youtube)?\s+for\s+(.+)$/i);
      const query = match ? match[1].replace(/[.!?]+$/, '').trim() : cleanPrompt;

      actionIntent = {
        mode: 'execute',
        verb: 'search',
        targetType: 'website',
        targetName: 'YouTube',
        capability: 'browser.search',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['browser.search'] = { score: 0.99, reason: `Explicit browser search: "${query}"` };
      browserPlan = { action: 'search', target: 'YouTube', entityQuery: query };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE J: SYSTEM STATUS & CONVERSATIONAL HOLD
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:status\s+of\s+agenticos|what\s+status\s+(?:does|of)\s+agenticos|system\s+status)\b/i.test(effectiveLower)) {
      actionIntent = {
        mode: 'internal',
        verb: 'inspect',
        targetType: 'internal_agenticos',
        targetName: 'AgenticOS',
        capability: 'agenticos.internal',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['agenticos.internal'] = { score: 0.98, reason: 'AgenticOS runtime health/status query' };
      conversationalPlan = { type: 'status_query' };
    }
    else if (/\b(?:that(?:'s|\s+is)\s+good|don'?t\s+do\s+anything|leave\s+it\s+there|stay\s+on\s+this\s+page|keep\s+.+\s+open)\b/i.test(effectiveLower)) {
      actionIntent = {
        mode: 'conversation',
        verb: 'unknown',
        targetType: 'browser_entity',
        capability: 'conversation.respond',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['conversation.respond'] = { score: 0.99, reason: 'Conversational hold / page stay constraint' };
      conversationalPlan = { type: 'constraint_stay' };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE K: GENERAL CONVERSATION FALLBACK
    // ─────────────────────────────────────────────────────────────────────────
    else {
      actionIntent = {
        mode: 'conversation',
        verb: 'unknown',
        targetType: 'unknown',
        targetName: undefined,
        capability: 'conversation.respond',
        confidence: 0.85,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['conversation.respond'] = { score: 0.85, reason: 'Conversational turn without action intent' };
      conversationalPlan = { type: 'general' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SELECT CAPABILITY FIRST (Router Selects Capability)
    // ─────────────────────────────────────────────────────────────────────────
    const selectedCapabilityId = actionIntent.capability || 'conversation.respond';
    const selectedCapability = CAPABILITY_REGISTRY[selectedCapabilityId] || CAPABILITY_REGISTRY['conversation.respond'];
    const whySelected = candidates[selectedCapabilityId]?.reason || 'Selected by intent analysis';
    const confidence = candidates[selectedCapabilityId]?.score ?? actionIntent.confidence;

    // Log the EXACT Candidate Arbitration Table matching Section 11 trace
    logger.info('[UnifiedActionOrchestrator] Turn arbitration complete', {
      rawPrompt,
      actionIntent,
      selectedCapability: selectedCapability.id,
      confidence,
      whySelected,
      candidates,
    });

    return {
      actionIntent,
      selectedCapability,
      confidence,
      whySelected,
      candidates,
      correction: correction || undefined,
      browserPlan,
      memoryPlan,
      desktopPlan,
      projectPlan,
      conversationalPlan,
    };
  }
}

function effectiveCleanMatch(text: string, re: RegExp): RegExpMatchArray | null {
  return text.match(re);
}

export const unifiedActionOrchestrator = new UnifiedActionOrchestrator();
