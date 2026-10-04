/**
 * AuthoritativeInteractionContext.ts — Single Authoritative Source for Current User Interaction State
 *
 * Phase 2 of Control-Plane Replacement.
 *
 * Replaces fragmented, competing conversational / operational interaction state holders:
 *   - TurnFocus (turnRouter.ts)
 *   - PerceptionFocus (perceptionFocus.ts)
 *   - TargetContentStore (targetContentExtractor.ts)
 *   - UnifiedOperationalContext (UnifiedOperationalContext.ts referents & pending actions)
 *   - PendingActionStore
 *
 * HARD INVARIANTS:
 * 1. ONE WRITABLE OWNER: Exactly one authoritative source for current interaction state per conversation.
 * 2. PRIORITY HIERARCHY:
 *      NEW EXPLICIT COMPILED INTENT > PENDING CONFIRMED ACTION > DEICTIC / FOLLOW-UP CONTEXT > FALLBACK
 *    Old context must NEVER override a new explicit command.
 * 3. ATOMIC VERIFIED CONTEXT UPDATES:
 *    Context changes only AFTER verified capability outcomes. Never write intended state as though
 *    execution succeeded (e.g. activeChat is only set when verifiedSelectedChat === true).
 * 4. COMPOUND PLAN TRACKING:
 *    Tracks plan execution step-by-step; partial success is never recorded as total plan success.
 */

import { logger } from '../../utils/logger.js';
import type { CompiledTurnIntent, CompiledTurnPlan } from './AuthoritativeIntentCompiler.js';
import type { ExecutionStepResult } from './VerificationGateway.js';
import type { DiscourseCompilerView } from './DiscourseReferentResolver.js';

export type ActiveTargetType =
  | 'APPLICATION'
  | 'WINDOW'
  | 'BROWSER'
  | 'PAGE'
  | 'CHAT'
  | 'CONTENT'
  | 'CAMERA'
  | 'WORKER'
  | 'NONE';

export type PlanExecutionStatus =
  | 'IDLE'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED';

export interface PlanStepVerification {
  readonly stepIndex: number;
  readonly action: string;
  readonly target?: string | null;
  readonly application?: string | null;
  readonly success: boolean;
  readonly verified: boolean;
  readonly error?: string;
  readonly timestamp: number;
}

export interface ExtractedChatMessageRef {
  readonly id?: string | number;
  readonly sender?: string;
  readonly text: string;
  readonly timestamp?: string | number;
}

export interface VerifiedExecutionFailure {
  readonly turnId: string;
  readonly correlationId: string;
  readonly action: string;
  readonly target: string;
  readonly executionStage: string;
  readonly providerIdentity?: string;
  readonly technicalRootCause?: string;
  readonly userFacingFailure?: string;
  readonly failureReason: string;
  readonly physicalEvidence?: {
    readonly uia?: boolean;
    readonly screenshot?: boolean;
    readonly uiTars?: boolean;
    readonly ocr?: boolean;
    readonly errorDetails?: string;
  };
  readonly verifierState?: 'PASSED' | 'FAILED_CLOSED' | 'OPTIMISTIC_REJECTED';
  readonly verifierMismatchDetails?: Record<string, unknown>;
  readonly timestamp: number;
}

// ── Working Interaction Memory (discourse state) ─────────────────────────────
// Short-term, per-conversation, VERIFIED-ONLY. Not VoiceMem, not Obsidian.

export type ActiveModality = 'CAMERA' | 'SCREEN' | 'DESKTOP' | 'BROWSER' | 'NONE';

export interface ActivePerceptionSource {
  readonly modality: Exclude<ActiveModality, 'NONE'>;
  readonly provider: string;
  readonly identity: string;
  readonly application?: string | null;
  readonly window?: string | null;
  readonly hwnd?: number | null;
  readonly url?: string | null;
  readonly frameId?: string | null;
  readonly establishedAt: number;
  readonly turnId?: string;
}

export interface DiscourseEntity {
  readonly kind: 'MESSAGE' | 'CONTENT_ITEM' | 'CONTENT_BLOCK' | 'CAMERA_OBSERVATION';
  readonly ordinal: number; // 1-based
  readonly sender?: string;
  readonly text: string;
  readonly timestamp?: string | number;
  readonly source: string; // acquisition method / provider
  readonly sourceTarget?: string | null;
  readonly acquiredAt: number;
}

export interface VerifiedReadResult {
  readonly kind: 'MESSAGES' | 'CONTENT';
  readonly action: string;
  readonly source: string;
  readonly application: string | null;
  readonly window: string | null;
  readonly hwnd: number | null;
  readonly target: string | null;
  readonly chat: string | null;
  readonly messages: readonly ExtractedChatMessageRef[];
  readonly content: string;
  readonly entities: readonly DiscourseEntity[];
  readonly acquiredAt: number;
  readonly turnId?: string;
}

export interface DiscourseActionRecord {
  readonly action: string;
  readonly target: string | null;
  readonly at: number;
  readonly summary?: string;
  readonly reason?: string;
  readonly turnId?: string;
}

export interface CameraFrameRecord {
  readonly frameSha256: string | null;
  readonly capturedAt: string | null;
  readonly device: string | null;
  readonly artifactPath: string | null;
  readonly description: string;
  readonly observedAt: number;
  readonly turnId?: string;
}

export interface ScreenObservationRecord {
  readonly application: string | null;
  readonly window: string | null;
  readonly hwnd: number | null;
  readonly contentPreview: string;
  readonly observedAt: number;
  readonly turnId?: string;
}

export interface BrowserPageRecord {
  readonly url: string | null;
  readonly title: string | null;
  readonly domain: string | null;
  readonly contentPreview: string;
  readonly observedAt: number;
  readonly turnId?: string;
}

export interface ActivePlaybackTask {
  readonly taskType: 'READ_MESSAGES';
  readonly source: string;
  readonly requestedCount: number;
  readonly messageRecords: readonly ExtractedChatMessageRef[];
  currentMessageIndex: number;
  remainingMessages: readonly ExtractedChatMessageRef[];
  status: 'PLAYING' | 'INTERRUPTED' | 'COMPLETED';
  readonly startedAt: number;
  lastSpokenAt?: number;
}

export interface AuthoritativeInteractionContextData {
  readonly conversationId: string;

  // Active GUI & Process Context
  readonly activeApplication: string | null;
  readonly activeWindow: string | null;
  readonly activeWindowHandle: number | null; // HWND

  // Target & Capability
  readonly activeTargetType: ActiveTargetType;
  readonly activeTarget: string | null;
  readonly activeNestedTarget: string | null;
  readonly activeCapability: string | null;

  // Web / Browser Context
  readonly activePage: string | null;
  readonly activeUrl: string | null;
  readonly activeDomain: string | null;
  readonly activePageTitle: string | null;
  readonly activeTabId: string | number | null;
  readonly activeElement: string | null;
  readonly lastBrowserAction: string | null;

  // Chat / Messaging Context
  readonly activeChat: string | null;
  readonly verifiedSelectedChat: boolean;

  // Content & Perception Snapshot
  readonly activeContentSnapshot: string | null;
  readonly contentSnapshot: string | null;
  readonly activeContentItems: readonly string[];
  readonly activeMessages: readonly ExtractedChatMessageRef[];

  // Turn History & Intent State
  readonly lastCompiledIntent: Readonly<CompiledTurnIntent> | null;
  readonly lastCompletedAction: string | null;
  readonly lastAction: string | null;
  readonly lastVerifiedResult: Readonly<{
    success: boolean;
    verified: boolean;
    summary?: string;
    at: number;
    details?: any;
  }> | null;
  readonly lastResult: Readonly<{
    success: boolean;
    verified: boolean;
    summary?: string;
    at: number;
    details?: any;
  }> | null;
  readonly timestamp: number;

  // Pending Action Continuity
  readonly pendingAction: string | null;
  readonly pendingTarget: string | null;
  readonly pendingOrdinal: number | null;
  readonly pendingContext?: Record<string, any> | null;

  // Compound Plan State
  readonly currentPlan: Readonly<CompiledTurnPlan> | null;
  readonly currentStepIndex: number;
  readonly completedSteps: readonly Readonly<CompiledTurnIntent>[];
  readonly pendingStep: Readonly<CompiledTurnIntent> | null;
  readonly planVerificationResults: readonly PlanStepVerification[];
  readonly planStatus: PlanExecutionStatus;

  // Autonomous / Worker Context
  readonly activeWorker: string | null;
  readonly activeTaskId: string | null;

  // Causal Execution Failure & Spoken Telemetry
  readonly lastExecutionFailure: VerifiedExecutionFailure | null;
  readonly lastSpokenResponseText: string | null;

  // Working Interaction Memory (discourse state; verified results only)
  readonly activeConversation: string | null;
  readonly activeContentEntities: readonly DiscourseEntity[];
  readonly lastReferencedEntities: readonly DiscourseEntity[];
  readonly lastReadResult: VerifiedReadResult | null;
  readonly lastSuccessfulAction: DiscourseActionRecord | null;
  readonly lastFailedAction: DiscourseActionRecord | null;
  readonly activeModality: ActiveModality;
  readonly activePerceptionSource: ActivePerceptionSource | null;
  readonly lastCameraFrame: CameraFrameRecord | null;
  readonly lastScreenObservation: ScreenObservationRecord | null;
  readonly lastBrowserPage: BrowserPageRecord | null;
  readonly lastExplainedFailureAt: number | null;
  readonly explainDepth: number;

  // Verified Working Interaction State (YouTube / Browser / Multiturn continuity)
  readonly currentGoal: string | null;
  readonly activeSurface: string | null;
  readonly currentSearchQuery: string | null;
  readonly focusedEntity: string | null;
  readonly currentResultSet: readonly any[] | null;
  readonly previousVerifiedAction: string | null;
  readonly activeTask: string | null;
  readonly unresolvedReferents: readonly string[];
  readonly openedVideoUrls: readonly string[];

  // Persistent Playback State (Telegram / Multi-message continuation)
  readonly activePlaybackTask: ActivePlaybackTask | null;

  // Metadata & Versioning
  readonly contextVersion: number;
  readonly updatedAt: string;
}

export interface VerifiedOutcomeInput {
  application?: string | null;
  window?: string | null;
  windowHandle?: number | null;
  target?: string | null;
  nestedTarget?: string | null;
  targetType?: ActiveTargetType;
  capability?: string | null;
  url?: string | null;
  page?: string | null;
  domain?: string | null;
  pageTitle?: string | null;
  tabId?: string | number | null;
  activeElement?: string | null;
  lastBrowserAction?: string | null;
  chat?: string | null;
  verifiedSelectedChat?: boolean;
  contentSnapshot?: string | null;
  contentItems?: string[];
  messages?: ExtractedChatMessageRef[];
  worker?: string | null;
  taskId?: string | null;
  summary?: string;
  details?: any;

  // Working Interaction State
  currentGoal?: string | null;
  activeSurface?: string | null;
  currentSearchQuery?: string | null;
  focusedEntity?: string | null;
  currentResultSet?: any[] | null;
  previousVerifiedAction?: string | null;
  activeTask?: string | null;
  unresolvedReferents?: string[];
  openedVideoUrls?: string[];
  activePlaybackTask?: ActivePlaybackTask | null;
}

export interface DeicticResolutionResult {
  readonly resolved: boolean;
  readonly source: 'CONTENT_ITEM' | 'CONTENT_SNAPSHOT' | 'CHAT_MESSAGE' | 'ACTIVE_APP' | 'ACTIVE_CHAT' | 'CAMERA' | 'NONE';
  readonly resolvedTarget?: string;
  readonly resolvedContent?: string;
  readonly resolvedOrdinal?: number;
  readonly message?: ExtractedChatMessageRef;
}

class MutableInteractionContext {
  public conversationId: string;
  public activeApplication: string | null = null;
  public activeWindow: string | null = null;
  public activeWindowHandle: number | null = null;
  public activeTargetType: ActiveTargetType = 'NONE';
  public activeTarget: string | null = null;
  public activeNestedTarget: string | null = null;
  public activeCapability: string | null = null;
  public activePage: string | null = null;
  public activeUrl: string | null = null;
  public activeDomain: string | null = null;
  public activePageTitle: string | null = null;
  public activeTabId: string | number | null = null;
  public activeElement: string | null = null;
  public lastBrowserAction: string | null = null;
  public activeChat: string | null = null;
  public verifiedSelectedChat: boolean = false;
  public activeContentSnapshot: string | null = null;
  public activeContentItems: string[] = [];
  public activeMessages: ExtractedChatMessageRef[] = [];
  public lastCompiledIntent: CompiledTurnIntent | null = null;
  public lastCompletedAction: string | null = null;
  public lastVerifiedResult: {
    success: boolean;
    verified: boolean;
    summary?: string;
    at: number;
    details?: any;
  } | null = null;
  public pendingAction: string | null = null;
  public pendingTarget: string | null = null;
  public pendingOrdinal: number | null = null;
  public pendingContext: Record<string, any> | null = null;
  public currentPlan: CompiledTurnPlan | null = null;
  public currentStepIndex: number = 0;
  public completedSteps: CompiledTurnIntent[] = [];
  public pendingStep: CompiledTurnIntent | null = null;
  public planVerificationResults: PlanStepVerification[] = [];
  public planStatus: PlanExecutionStatus = 'IDLE';
  public activeWorker: string | null = null;
  public activeTaskId: string | null = null;
  public lastExecutionFailure: VerifiedExecutionFailure | null = null;
  public lastSpokenResponseText: string | null = null;
  public activeContentEntities: DiscourseEntity[] = [];
  public lastReferencedEntities: DiscourseEntity[] = [];
  public lastReadResult: VerifiedReadResult | null = null;
  public lastSuccessfulAction: DiscourseActionRecord | null = null;
  public lastFailedAction: DiscourseActionRecord | null = null;
  public activeModality: ActiveModality = 'NONE';
  public activePerceptionSource: ActivePerceptionSource | null = null;
  public lastCameraFrame: CameraFrameRecord | null = null;
  public lastScreenObservation: ScreenObservationRecord | null = null;
  public lastBrowserPage: BrowserPageRecord | null = null;
  public lastExplainedFailureAt: number | null = null;
  public explainDepth: number = 0;

  // Verified Working Interaction State
  public currentGoal: string | null = null;
  public activeSurface: string | null = null;
  public currentSearchQuery: string | null = null;
  public focusedEntity: string | null = null;
  public currentResultSet: any[] | null = null;
  public previousVerifiedAction: string | null = null;
  public activeTask: string | null = null;
  public unresolvedReferents: string[] = [];
  public openedVideoUrls: string[] = [];

  // Persistent Playback State
  public activePlaybackTask: ActivePlaybackTask | null = null;

  public contextVersion: number = 1;
  public updatedAt: string = new Date().toISOString();

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }

  public toImmutable(): AuthoritativeInteractionContextData {
    return Object.freeze({
      conversationId: this.conversationId,
      activeApplication: this.activeApplication,
      activeWindow: this.activeWindow,
      activeWindowHandle: this.activeWindowHandle,
      activeTargetType: this.activeTargetType,
      activeTarget: this.activeTarget,
      activeNestedTarget: this.activeNestedTarget || this.activeChat || this.activeTarget || null,
      activeCapability: this.activeCapability,
      activePage: this.activePage,
      activeUrl: this.activeUrl,
      activeDomain: this.activeDomain,
      activePageTitle: this.activePageTitle,
      activeTabId: this.activeTabId,
      activeElement: this.activeElement,
      lastBrowserAction: this.lastBrowserAction,
      activeChat: this.activeChat,
      verifiedSelectedChat: this.verifiedSelectedChat,
      activeContentSnapshot: this.activeContentSnapshot,
      contentSnapshot: this.activeContentSnapshot,
      activeContentItems: Object.freeze([...this.activeContentItems]),
      activeMessages: Object.freeze(this.activeMessages.map(m => Object.freeze({ ...m }))),
      lastCompiledIntent: this.lastCompiledIntent ? Object.freeze({ ...this.lastCompiledIntent }) : null,
      lastCompletedAction: this.lastCompletedAction,
      lastAction: this.lastCompletedAction,
      lastVerifiedResult: this.lastVerifiedResult ? Object.freeze({ ...this.lastVerifiedResult }) : null,
      lastResult: this.lastVerifiedResult ? Object.freeze({ ...this.lastVerifiedResult }) : null,
      timestamp: new Date(this.updatedAt).getTime() || Date.now(),
      pendingAction: this.pendingAction,
      pendingTarget: this.pendingTarget,
      pendingOrdinal: this.pendingOrdinal,
      pendingContext: this.pendingContext ? Object.freeze({ ...this.pendingContext }) : null,
      currentPlan: this.currentPlan,
      currentStepIndex: this.currentStepIndex,
      completedSteps: Object.freeze([...this.completedSteps]),
      pendingStep: this.pendingStep ? Object.freeze({ ...this.pendingStep }) : null,
      planVerificationResults: Object.freeze([...this.planVerificationResults]),
      planStatus: this.planStatus,
      activeWorker: this.activeWorker,
      activeTaskId: this.activeTaskId,
      lastExecutionFailure: this.lastExecutionFailure ? Object.freeze({ ...this.lastExecutionFailure }) : null,
      lastSpokenResponseText: this.lastSpokenResponseText,
      activeConversation: this.verifiedSelectedChat ? this.activeChat : null,
      activeContentEntities: Object.freeze(this.activeContentEntities.map(e => Object.freeze({ ...e }))),
      lastReferencedEntities: Object.freeze(this.lastReferencedEntities.map(e => Object.freeze({ ...e }))),
      lastReadResult: this.lastReadResult
        ? Object.freeze({
            ...this.lastReadResult,
            messages: Object.freeze(this.lastReadResult.messages.map(m => Object.freeze({ ...m }))),
            entities: Object.freeze(this.lastReadResult.entities.map(e => Object.freeze({ ...e }))),
          })
        : null,
      lastSuccessfulAction: this.lastSuccessfulAction ? Object.freeze({ ...this.lastSuccessfulAction }) : null,
      lastFailedAction: this.lastFailedAction ? Object.freeze({ ...this.lastFailedAction }) : null,
      activeModality: this.activeModality,
      activePerceptionSource: this.activePerceptionSource ? Object.freeze({ ...this.activePerceptionSource }) : null,
      lastCameraFrame: this.lastCameraFrame ? Object.freeze({ ...this.lastCameraFrame }) : null,
      lastScreenObservation: this.lastScreenObservation ? Object.freeze({ ...this.lastScreenObservation }) : null,
      lastBrowserPage: this.lastBrowserPage ? Object.freeze({ ...this.lastBrowserPage }) : null,
      lastExplainedFailureAt: this.lastExplainedFailureAt,
      explainDepth: this.explainDepth,

      // Verified Working Interaction State
      currentGoal: this.currentGoal,
      activeSurface: this.activeSurface,
      currentSearchQuery: this.currentSearchQuery,
      focusedEntity: this.focusedEntity,
      currentResultSet: this.currentResultSet ? Object.freeze([...this.currentResultSet]) : null,
      previousVerifiedAction: this.previousVerifiedAction,
      activeTask: this.activeTask,
      unresolvedReferents: Object.freeze([...this.unresolvedReferents]),
      openedVideoUrls: Object.freeze([...this.openedVideoUrls]),

      // Persistent Playback State
      activePlaybackTask: this.activePlaybackTask ? Object.freeze({ ...this.activePlaybackTask }) : null,

      contextVersion: this.contextVersion,
      updatedAt: this.updatedAt,
    });
  }

  public touch(): void {
    this.contextVersion++;
    this.updatedAt = new Date().toISOString();
  }
}

export class AuthoritativeInteractionContextManager {
  private static instance: AuthoritativeInteractionContextManager;
  private contexts = new Map<string, MutableInteractionContext>();

  private constructor() {}

  public static getInstance(): AuthoritativeInteractionContextManager {
    if (!AuthoritativeInteractionContextManager.instance) {
      AuthoritativeInteractionContextManager.instance = new AuthoritativeInteractionContextManager();
    }
    return AuthoritativeInteractionContextManager.instance;
  }

  private getOrCreate(conversationId: string): MutableInteractionContext {
    const id = conversationId || 'global-default';
    let ctx = this.contexts.get(id);
    if (!ctx) {
      ctx = new MutableInteractionContext(id);
      this.contexts.set(id, ctx);
    }
    return ctx;
  }

  /**
   * Retrieves an immutable snapshot of the current interaction context.
   */
  public getContext(conversationId: string): AuthoritativeInteractionContextData {
    return this.getOrCreate(conversationId).toImmutable();
  }

  /**
   * Evaluates and records an explicit compiled intent before execution.
   *
   * Hard Invariant 2:
   * NEW EXPLICIT COMPILED INTENT > PENDING CONFIRMED ACTION > DEICTIC / FOLLOW-UP CONTEXT
   *
   * An explicit command clears incompatible pending actions and updates target orientation.
   */
  public recordExplicitIntent(
    conversationId: string,
    intent: CompiledTurnIntent,
    plan?: CompiledTurnPlan | null
  ): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);
    ctx.lastCompiledIntent = intent;

    // Check if this is an explicit command (not a pure deictic follow-up like "What does that mean?")
    const isExplicitNewGoal = intent.isDirectCommand && (
      intent.action === 'OPEN_APPLICATION' ||
      intent.action === 'OPEN_CHAT' ||
      intent.action === 'READ_CONTENT' ||
      intent.action === 'NAVIGATE_WEB' ||
      intent.action === 'DELEGATE' ||
      Boolean(intent.application) ||
      Boolean(intent.target)
    );

    if (isExplicitNewGoal) {
      // Incompatible pending actions are cancelled by a new explicit command
      ctx.pendingAction = null;
      ctx.pendingTarget = null;
      ctx.pendingOrdinal = null;
      ctx.pendingContext = null;

      // Handle capability switch: if switching from CAMERA to an application or web
      if (intent.action === 'OPEN_APPLICATION' || intent.action === 'NAVIGATE_WEB') {
        if (ctx.activeCapability === 'CAMERA') {
          // Camera is no longer active conversational target
          ctx.activeCapability = 'APPLICATION';
          ctx.activeTargetType = 'APPLICATION';
        }
      }

      // Handle Compound Plan
      if (plan && plan.steps.length > 1) {
        ctx.currentPlan = plan;
        ctx.currentStepIndex = 0;
        ctx.completedSteps = [];
        ctx.pendingStep = plan.steps[0];
        ctx.planVerificationResults = [];
        ctx.planStatus = 'EXECUTING';
      } else {
        ctx.currentPlan = null;
        ctx.currentStepIndex = 0;
        ctx.completedSteps = [];
        ctx.pendingStep = null;
        ctx.planVerificationResults = [];
        ctx.planStatus = 'IDLE';
      }
    }

    ctx.touch();
    return ctx.toImmutable();
  }

  /**
   * Sets a pending proposed action awaiting confirmation ("Yes", "Do it", "Go ahead").
   */
  public setPendingAction(
    conversationId: string,
    pending: {
      action: string;
      target?: string | null;
      ordinal?: number | null;
      context?: Record<string, any>;
    }
  ): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);
    ctx.pendingAction = pending.action;
    ctx.pendingTarget = pending.target || null;
    ctx.pendingOrdinal = pending.ordinal ?? null;
    ctx.pendingContext = pending.context || null;
    ctx.touch();
    return ctx.toImmutable();
  }

  /**
   * Clears any active pending action.
   */
  public clearPendingAction(conversationId: string): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);
    ctx.pendingAction = null;
    ctx.pendingTarget = null;
    ctx.pendingOrdinal = null;
    ctx.pendingContext = null;
    ctx.touch();
    return ctx.toImmutable();
  }

  /**
   * ATOMIC VERIFIED STEP SUCCESS:
   *
   * Invariant: Context changes ONLY after verified capability outcomes.
   * If a target was not verified (e.g. Telegram opened but requested chat not verified),
   * activeChat is NOT set and verifiedSelectedChat remains false!
   */
  public recordVerifiedStepSuccess(
    conversationId: string,
    stepIndex: number,
    outcome: VerifiedOutcomeInput
  ): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);

    // 1. Process / Window Context
    if (outcome.application !== undefined) {
      ctx.activeApplication = outcome.application;
    }
    if (outcome.window !== undefined) {
      ctx.activeWindow = outcome.window;
    }
    if (outcome.windowHandle !== undefined) {
      ctx.activeWindowHandle = outcome.windowHandle;
    }

    // 2. Capability & Target Type
    if (outcome.capability) {
      ctx.activeCapability = outcome.capability;
    } else if (outcome.application) {
      ctx.activeCapability = 'APPLICATION';
    }
    if (outcome.targetType) {
      ctx.activeTargetType = outcome.targetType;
    } else if (outcome.chat && outcome.verifiedSelectedChat) {
      ctx.activeTargetType = 'CHAT';
    } else if (outcome.application) {
      ctx.activeTargetType = 'APPLICATION';
    }

    if (outcome.target !== undefined) {
      ctx.activeTarget = outcome.target;
    }
    if (outcome.nestedTarget !== undefined) {
      ctx.activeNestedTarget = outcome.nestedTarget;
    } else if (outcome.chat && outcome.verifiedSelectedChat) {
      ctx.activeNestedTarget = outcome.chat;
    } else if (outcome.target) {
      ctx.activeNestedTarget = outcome.target;
    }

    // 3. Web Navigation & Browser Context
    if (outcome.url !== undefined) {
      ctx.activeUrl = outcome.url;
      try {
        if (outcome.url && /^https?:\/\//i.test(outcome.url)) {
          ctx.activeDomain = new URL(outcome.url).hostname;
        }
      } catch {}
    }
    if (outcome.domain !== undefined) {
      ctx.activeDomain = outcome.domain;
    }
    if (outcome.page !== undefined) {
      ctx.activePage = outcome.page;
    }
    if (outcome.pageTitle !== undefined) {
      ctx.activePageTitle = outcome.pageTitle;
    }
    if (outcome.tabId !== undefined) {
      ctx.activeTabId = outcome.tabId;
    }
    if (outcome.activeElement !== undefined) {
      ctx.activeElement = outcome.activeElement;
    }
    if (outcome.lastBrowserAction !== undefined) {
      ctx.lastBrowserAction = outcome.lastBrowserAction;
    }

    // 4. Chat verification (STRICT NESTED TELEGRAM INVARIANT):
    // Telegram foreground != selected chat.
    // activeChat is recorded ONLY if verifiedSelectedChat is true.
    if (outcome.verifiedSelectedChat === true) {
      ctx.activeChat = outcome.chat || ctx.activeChat;
      ctx.verifiedSelectedChat = true;
      ctx.activeTargetType = 'CHAT';
    } else if (outcome.verifiedSelectedChat === false) {
      ctx.verifiedSelectedChat = false;
      // Do NOT pretend the requested chat is active
      if (outcome.chat && ctx.activeChat === outcome.chat) {
        ctx.activeChat = null;
      }
    }

    // 5. Content Snapshot & Items
    if (outcome.contentSnapshot !== undefined) {
      ctx.activeContentSnapshot = outcome.contentSnapshot;
      if (outcome.contentItems && outcome.contentItems.length > 0) {
        ctx.activeContentItems = [...outcome.contentItems];
      } else if (outcome.contentSnapshot) {
        // Derive numbered items from snapshot if not explicitly provided
        ctx.activeContentItems = extractNumberedItems(outcome.contentSnapshot);
      }
    }

    // 6. Messages
    if (outcome.messages && Array.isArray(outcome.messages)) {
      ctx.activeMessages = outcome.messages.map(m => ({ ...m }));
    }

    // 7. Workers / Tasks
    if (outcome.worker !== undefined) {
      ctx.activeWorker = outcome.worker;
    }
    if (outcome.taskId !== undefined) {
      ctx.activeTaskId = outcome.taskId;
    }

    // 8. Completed Action Record
    ctx.lastCompletedAction = ctx.lastCompiledIntent?.action || (outcome.capability ?? 'ACTION');
    ctx.lastVerifiedResult = {
      success: true,
      verified: true,
      summary: outcome.summary,
      at: Date.now(),
      details: outcome.details,
    };

    // 9. Verified Working Interaction State (YouTube, Browser, Search)
    if (outcome.currentGoal !== undefined) {
      ctx.currentGoal = outcome.currentGoal;
    }
    if (outcome.activeSurface !== undefined) {
      ctx.activeSurface = outcome.activeSurface;
    }
    if (outcome.currentSearchQuery !== undefined) {
      ctx.currentSearchQuery = outcome.currentSearchQuery;
    }
    if (outcome.focusedEntity !== undefined) {
      ctx.focusedEntity = outcome.focusedEntity;
    }
    if (outcome.currentResultSet !== undefined) {
      ctx.currentResultSet = outcome.currentResultSet;
    }
    if (outcome.previousVerifiedAction !== undefined) {
      ctx.previousVerifiedAction = outcome.previousVerifiedAction;
    }
    if (outcome.activeTask !== undefined) {
      ctx.activeTask = outcome.activeTask;
    }
    if (outcome.unresolvedReferents !== undefined) {
      ctx.unresolvedReferents = outcome.unresolvedReferents;
    }
    if (outcome.openedVideoUrls && Array.isArray(outcome.openedVideoUrls)) {
      ctx.openedVideoUrls = Array.from(new Set([...ctx.openedVideoUrls, ...outcome.openedVideoUrls]));
    }
    if (outcome.activePlaybackTask !== undefined) {
      ctx.activePlaybackTask = outcome.activePlaybackTask;
    }

    // 10. Compound Plan Progression
    if (ctx.currentPlan && ctx.planStatus === 'EXECUTING') {
      const step = ctx.currentPlan.steps[stepIndex];
      ctx.completedSteps.push(step || {
        action: (outcome.capability as any) || 'OTHER',
        targetType: outcome.targetType || 'APPLICATION_WINDOW',
        application: outcome.application || null,
        target: outcome.target || null,
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: outcome.worker || null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt: '',
        normalizedPrompt: '',
        reason: outcome.summary || 'Step verified',
      });

      ctx.planVerificationResults.push({
        stepIndex,
        action: step?.action || 'UNKNOWN',
        target: step?.target || outcome.target,
        application: step?.application || outcome.application,
        success: true,
        verified: true,
        timestamp: Date.now(),
      });

      const nextIndex = stepIndex + 1;
      if (nextIndex < ctx.currentPlan.steps.length) {
        ctx.currentStepIndex = nextIndex;
        ctx.pendingStep = ctx.currentPlan.steps[nextIndex];
      } else {
        ctx.planStatus = 'COMPLETED';
        ctx.pendingStep = null;
      }
    }

    ctx.touch();
    return ctx.toImmutable();
  }

  public startPlaybackTask(
    conversationId: string,
    task: {
      taskType: 'READ_MESSAGES';
      source: string;
      requestedCount: number;
      messageRecords: readonly ExtractedChatMessageRef[];
      currentMessageIndex: number;
      remainingMessages: readonly ExtractedChatMessageRef[];
    }
  ): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);
    ctx.activePlaybackTask = {
      ...task,
      status: 'PLAYING',
      startedAt: Date.now(),
      lastSpokenAt: Date.now(),
    };
    ctx.activeTask = 'READ_MESSAGES';
    ctx.touch();
    return ctx.toImmutable();
  }

  public updatePlaybackCursor(
    conversationId: string,
    currentMessageIndex: number,
    status: 'PLAYING' | 'INTERRUPTED' | 'COMPLETED'
  ): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);
    if (ctx.activePlaybackTask) {
      ctx.activePlaybackTask = {
        ...ctx.activePlaybackTask,
        currentMessageIndex,
        remainingMessages: ctx.activePlaybackTask.messageRecords.slice(currentMessageIndex),
        status,
        lastSpokenAt: Date.now(),
      };
      if (status === 'COMPLETED') {
        ctx.activeTask = null;
      }
    }
    ctx.touch();
    return ctx.toImmutable();
  }

  public getActivePlaybackTask(conversationId: string): ActivePlaybackTask | null {
    const ctx = this.getOrCreate(conversationId);
    return ctx.activePlaybackTask ? { ...ctx.activePlaybackTask } : null;
  }

  public recordOpenedVideoUrl(conversationId: string, url: string): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);
    if (url && !ctx.openedVideoUrls.includes(url)) {
      ctx.openedVideoUrls.push(url);
    }
    ctx.touch();
    return ctx.toImmutable();
  }

  /**
   * ATOMIC STEP FAILURE RECORDING:
   *
   * For compound plans, records partial failure without claiming whole plan succeeded.
   */
  public recordStepFailure(
    conversationId: string,
    stepIndex: number,
    error: string,
    stepIntent?: CompiledTurnIntent
  ): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);

    const step = stepIntent || ctx.currentPlan?.steps[stepIndex];
    ctx.lastVerifiedResult = {
      success: false,
      verified: false,
      summary: error,
      at: Date.now(),
    };

    if (ctx.currentPlan) {
      ctx.planVerificationResults.push({
        stepIndex,
        action: step?.action || 'UNKNOWN',
        target: step?.target || null,
        application: step?.application || null,
        success: false,
        verified: false,
        error,
        timestamp: Date.now(),
      });

      ctx.planStatus = ctx.completedSteps.length > 0 ? 'PARTIALLY_COMPLETED' : 'FAILED';
      // The pending/failed step remains marked
      ctx.pendingStep = step || null;
    }

    ctx.touch();
    return ctx.toImmutable();
  }

  /**
   * Persists a compact verified execution failure record for causal follow-up queries.
   */
  public recordExecutionFailure(conversationId: string, failure: VerifiedExecutionFailure): void {
    const ctx = this.getOrCreate(conversationId);
    ctx.lastExecutionFailure = failure;
    ctx.touch();
    logger.info('[AuthoritativeInteractionContext] Persisted execution failure record:', failure);
  }

  /**
   * Persists the last spoken response text for repetition queries ("say that again", "repeat that").
   */
  public recordSpokenResponse(conversationId: string, text: string): void {
    const ctx = this.getOrCreate(conversationId);
    ctx.lastSpokenResponseText = text;
    ctx.touch();
  }

  // ── Working Interaction Memory commits ─────────────────────────────────────

  /**
   * Commits discourse state from a VERIFIED step result (VerificationGateway passed).
   * Never called for unverified/failed steps. Conversational steps (replay, explanation)
   * do not change modality, read results or the last successful action.
   */
  public commitVerifiedDiscourse(
    conversationId: string,
    step: CompiledTurnIntent,
    result: ExecutionStepResult,
    turnId?: string
  ): AuthoritativeInteractionContextData {
    const ctx = this.getOrCreate(conversationId);
    if (!result.success || !result.verified) return ctx.toImmutable();

    const action = String(step.action);
    if (action === 'CONVERSATIONAL' || action === 'OTHER') return ctx.toImmutable();

    const now = Date.now();
    const mutation: any = result.contextMutation || {};
    const evidence: any = result.verificationEvidence || {};
    const data: any = evidence.data || {};
    const identity: any = evidence.targetIdentity || data.targetIdentity || null;
    const hwnd: number | null = typeof identity?.hwnd === 'number' ? identity.hwnd : (typeof data.sourceHwnd === 'number' ? data.sourceHwnd : null);
    const application: string | null = mutation.application ?? identity?.application ?? step.application ?? null;
    const windowTitle: string | null = mutation.window ?? identity?.title ?? null;
    const content: string = String(mutation.contentSnapshot ?? result.outputText ?? '');
    const preview = content.length > 500 ? `${content.slice(0, 497)}...` : content;
    const isBrowserApp = /chrome|edge|brave|firefox|comet|browser/i.test(String(application || ''));

    ctx.lastSuccessfulAction = {
      action,
      target: step.target || step.application || null,
      at: now,
      summary: result.outputText,
      turnId,
    };

    // 1. Active modality / perception source
    if (action === 'CAMERA_OBSERVE') {
      ctx.activeModality = 'CAMERA';
      ctx.lastCameraFrame = {
        frameSha256: data.frameSha256 ?? null,
        capturedAt: data.captureTimestamp ?? null,
        device: data.device ?? null,
        artifactPath: data.artifactPath ?? null,
        description: String(result.outputText || mutation.contentSnapshot || ''),
        observedAt: now,
        turnId,
      };
      ctx.activePerceptionSource = {
        modality: 'CAMERA',
        provider: String(data.provider || 'camera'),
        identity: String(data.device || 'camera'),
        frameId: data.frameSha256 ?? null,
        establishedAt: now,
        turnId,
      };
      ctx.lastReferencedEntities = [{
        kind: 'CAMERA_OBSERVATION', ordinal: 1, text: ctx.lastCameraFrame.description,
        source: 'camera', sourceTarget: 'camera', acquiredAt: now,
      }];
    } else if (
      action === 'READ_WEB_CONTENT' || action === 'NAVIGATE_WEB' || action === 'OPEN_URL' ||
      action === 'SWITCH_TAB' || action === 'BROWSER_GOAL' || step.targetType === 'WEB_URL'
    ) {
      ctx.activeModality = 'BROWSER';
      ctx.lastBrowserPage = {
        url: mutation.url ?? ctx.activeUrl ?? null,
        title: mutation.pageTitle ?? ctx.activePageTitle ?? windowTitle ?? null,
        domain: mutation.domain ?? ctx.activeDomain ?? null,
        contentPreview: preview,
        observedAt: now,
        turnId,
      };
      ctx.activePerceptionSource = {
        modality: 'BROWSER',
        provider: String(evidence.source || 'browser'),
        identity: String(ctx.lastBrowserPage.url || ctx.lastBrowserPage.title || 'browser'),
        application, window: windowTitle, hwnd, url: ctx.lastBrowserPage.url,
        establishedAt: now,
        turnId,
      };
    } else if ((action === 'READ_CONTENT' || action === 'READ_SCREEN') && (step.targetType === 'SCREEN' || step.target === 'screen')) {
      ctx.activeModality = 'SCREEN';
      ctx.lastScreenObservation = { application, window: windowTitle, hwnd, contentPreview: preview, observedAt: now, turnId };
      ctx.activePerceptionSource = {
        modality: 'SCREEN',
        provider: String(evidence.source || 'screen'),
        identity: String(windowTitle || application || 'screen'),
        application, window: windowTitle, hwnd,
        establishedAt: now,
        turnId,
      };
    } else if (
      action === 'OPEN_APPLICATION' || action === 'FOCUS_APPLICATION' || action === 'OPEN_CHAT' ||
      action === 'READ_MESSAGES' || action === 'READ_CONTENT' || action === 'READ_WINDOW' ||
      action === 'NAVIGATE_GUI' || action === 'LOCATE_ELEMENT' || action === 'ACTIVATE_CONTROL'
    ) {
      const modality: ActiveModality = isBrowserApp ? 'BROWSER' : 'DESKTOP';
      ctx.activeModality = modality;
      ctx.activePerceptionSource = {
        modality: modality as Exclude<ActiveModality, 'NONE'>,
        provider: String(evidence.source || 'desktop'),
        identity: String(windowTitle || application || step.target || 'desktop'),
        application, window: windowTitle, hwnd,
        establishedAt: now,
        turnId,
      };
    }

    // 2. Verified read results (textual content) → lastReadResult + entities
    const isRead = action === 'READ_MESSAGES' || action === 'READ_CONTENT' || action === 'READ_WEB_CONTENT' || action === 'READ_SCREEN' || action === 'READ_WINDOW';
    const isOrdinalRead = step.ordinal !== null && step.ordinal !== undefined && step.ordinal > 0;
    if (isRead) {
      const messages: ExtractedChatMessageRef[] = Array.isArray(mutation.messages)
        ? mutation.messages.filter((m: any) => m && typeof m.text === 'string' && m.text.trim()).map((m: any) => ({ ...m }))
        : [];
      const source = String(data.methodUsed || evidence.source || 'verified_acquisition');
      let entities: DiscourseEntity[];
      if (messages.length > 0) {
        entities = messages.map((m, i) => ({
          kind: 'MESSAGE' as const, ordinal: i + 1, sender: m.sender, text: m.text, timestamp: m.timestamp,
          source, sourceTarget: mutation.chat ?? step.target ?? null, acquiredAt: now,
        }));
      } else {
        const items: string[] = Array.isArray(mutation.contentItems) && mutation.contentItems.length > 0
          ? mutation.contentItems
          : (content ? [content] : []);
        entities = items.map((text, i) => ({
          kind: (items.length > 1 ? 'CONTENT_ITEM' : 'CONTENT_BLOCK') as DiscourseEntity['kind'], ordinal: i + 1, text,
          source, sourceTarget: step.target ?? application, acquiredAt: now,
        }));
      }

      if (entities.length > 0) {
        ctx.lastReferencedEntities = entities;
        if (!isOrdinalRead) {
          ctx.activeContentEntities = entities;
          ctx.lastReadResult = {
            kind: messages.length > 0 ? 'MESSAGES' : 'CONTENT',
            action,
            source,
            application,
            window: windowTitle,
            hwnd,
            target: step.target ?? null,
            chat: messages.length > 0 ? (mutation.chat ?? ctx.activeChat ?? step.target ?? null) : null,
            messages,
            content,
            entities,
            acquiredAt: now,
            turnId,
          };
        }
      }
    }

    ctx.touch();
    logger.info('[AuthoritativeInteractionContext] DISCOURSE_COMMIT', {
      conversationId,
      turnId,
      action,
      activeModality: ctx.activeModality,
      perceptionSource: ctx.activePerceptionSource?.identity,
      lastReadEntities: ctx.lastReadResult?.entities.length ?? 0,
    });
    return ctx.toImmutable();
  }

  /** Records a failed (non-conversational) action in working memory. */
  public recordFailedAction(conversationId: string, step: CompiledTurnIntent, reason: string, turnId?: string): void {
    const ctx = this.getOrCreate(conversationId);
    ctx.lastFailedAction = { action: String(step.action), target: step.target || step.application || null, at: Date.now(), reason, turnId };
    ctx.touch();
  }

  /** Records which discourse entities the most recent turn referred to. */
  public recordReferencedEntities(conversationId: string, entities: readonly DiscourseEntity[]): void {
    const ctx = this.getOrCreate(conversationId);
    ctx.lastReferencedEntities = entities.map(e => ({ ...e }));
    ctx.touch();
  }

  /**
   * Marks that the given failure has been explained once more; returns the explanation depth
   * (1 = first "why", 2 = second "why" about the same failure, ...).
   */
  public markFailureExplained(conversationId: string, failureTimestamp: number): number {
    const ctx = this.getOrCreate(conversationId);
    if (ctx.lastExplainedFailureAt === failureTimestamp) {
      ctx.explainDepth += 1;
    } else {
      ctx.lastExplainedFailureAt = failureTimestamp;
      ctx.explainDepth = 1;
    }
    ctx.touch();
    return ctx.explainDepth;
  }

  /** Read-only discourse projection used by AuthoritativeIntentCompiler (no mutation). */
  public getDiscourseCompilerView(conversationId: string): DiscourseCompilerView {
    const ctx = this.getOrCreate(conversationId);
    const lr = ctx.lastReadResult;
    return Object.freeze({
      activeModality: ctx.activeModality,
      activePerceptionAt: ctx.activePerceptionSource?.establishedAt ?? null,
      activeApplication: ctx.activeApplication,
      activeWindow: ctx.activeWindow,
      activeChat: ctx.activeChat,
      verifiedSelectedChat: ctx.verifiedSelectedChat,
      lastRead: lr
        ? Object.freeze({
            kind: lr.kind,
            action: lr.action,
            application: lr.application,
            target: lr.target,
            chat: lr.chat,
            entityCount: lr.entities.length,
            acquiredAt: lr.acquiredAt,
          })
        : null,
      lastExecutionFailureAt: ctx.lastExecutionFailure?.timestamp ?? null,
      lastSuccessfulActionAt: ctx.lastSuccessfulAction?.at ?? null,
      activeSurface: ctx.activeSurface || (ctx.activeDomain?.includes('youtube.com') ? 'YouTube' : null),
      currentSearchQuery: ctx.currentSearchQuery,
      focusedEntity: ctx.focusedEntity,
      openedVideoUrls: Object.freeze([...ctx.openedVideoUrls]),
      activePlaybackTask: ctx.activePlaybackTask ? Object.freeze({ ...ctx.activePlaybackTask }) : null,
    });
  }

  /**
   * DEICTIC CONTINUATION RESOLVER:
   *
   * Resolves follow-ups against the current active interaction context:
   * - "What does that mean?" -> refers to lastVerifiedResult or activeContentSnapshot
   * - "Read point two" -> resolves ordinal 2 against activeContentItems / activeContentSnapshot
   * - "What does the last one mean?" -> resolves against last item in activeMessages or activeContentItems
   * - "What am I holding?" -> resolves against active CAMERA context
   */
  public resolveDeicticReferent(
    conversationId: string,
    referenceWord: string,
    ordinal?: number | null
  ): DeicticResolutionResult {
    const ctx = this.getOrCreate(conversationId);
    const ref = (referenceWord || '').toLowerCase().trim();

    // 1. Ordinal document/bullet item follow-up: e.g. "read point two" / "ordinal=2"
    if (ordinal !== undefined && ordinal !== null && ordinal > 0) {
      if (ctx.activeContentItems.length >= ordinal) {
        const item = ctx.activeContentItems[ordinal - 1];
        return {
          resolved: true,
          source: 'CONTENT_ITEM',
          resolvedOrdinal: ordinal,
          resolvedContent: item,
          resolvedTarget: ctx.activeApplication || ctx.activeTarget || undefined,
        };
      }
      if (ctx.activeContentSnapshot) {
        const derived = extractNumberedItems(ctx.activeContentSnapshot);
        if (derived.length >= ordinal) {
          return {
            resolved: true,
            source: 'CONTENT_ITEM',
            resolvedOrdinal: ordinal,
            resolvedContent: derived[ordinal - 1],
            resolvedTarget: ctx.activeApplication || ctx.activeTarget || undefined,
          };
        }
      }
    }

    // 2. "previous" / "before that" / "one before"
    if (/\b(?:previous|before\s+that|one\s+before)\b/i.test(ref)) {
      if (ctx.activeMessages.length >= 2) {
        const prevMsg = ctx.activeMessages[ctx.activeMessages.length - 2];
        return {
          resolved: true,
          source: 'CHAT_MESSAGE',
          resolvedContent: prevMsg.text,
          message: prevMsg,
          resolvedTarget: ctx.activeChat || ctx.activeApplication || undefined,
        };
      }
      if (ctx.activeContentItems.length >= 2) {
        const prevItem = ctx.activeContentItems[ctx.activeContentItems.length - 2];
        return {
          resolved: true,
          source: 'CONTENT_ITEM',
          resolvedOrdinal: ctx.activeContentItems.length - 1,
          resolvedContent: prevItem,
          resolvedTarget: ctx.activeApplication || ctx.activeTarget || undefined,
        };
      }
    }

    // 2b. "what did he say" / "what did they say"
    if (/\b(?:what\s+did\s+(?:he|she|they|it)\s+say|what\s+did\s+(?:the\s+)?(?:last|previous)\s+one\s+say)\b/i.test(ref)) {
      if (ctx.activeMessages.length > 0) {
        const targetMsg = ctx.activeMessages[ctx.activeMessages.length - 1];
        return {
          resolved: true,
          source: 'CHAT_MESSAGE',
          resolvedContent: `${targetMsg.sender} said: "${targetMsg.text}"`,
          message: targetMsg,
          resolvedTarget: ctx.activeChat || ctx.activeApplication || undefined,
        };
      }
    }

    // 2c. "the last one" / "last message"
    if (/\b(?:last|latest|recent)\s*(?:one|message|point|item)?\b/i.test(ref)) {
      if (ctx.activeMessages.length > 0) {
        const lastMsg = ctx.activeMessages[ctx.activeMessages.length - 1];
        return {
          resolved: true,
          source: 'CHAT_MESSAGE',
          resolvedContent: lastMsg.text,
          message: lastMsg,
          resolvedTarget: ctx.activeChat || ctx.activeApplication || undefined,
        };
      }
      if (ctx.activeContentItems.length > 0) {
        const lastItem = ctx.activeContentItems[ctx.activeContentItems.length - 1];
        return {
          resolved: true,
          source: 'CONTENT_ITEM',
          resolvedOrdinal: ctx.activeContentItems.length,
          resolvedContent: lastItem,
          resolvedTarget: ctx.activeApplication || ctx.activeTarget || undefined,
        };
      }
    }

    // 3. Camera observation follow-up: "What am I holding?", "Describe me", "Can you see me"
    if (ctx.activeCapability === 'CAMERA' && /\b(?:holding|see|describe|camera|watching|looking)\b/i.test(ref)) {
      return {
        resolved: true,
        source: 'CAMERA',
        resolvedTarget: 'camera',
        resolvedContent: ctx.activeContentSnapshot || 'Active camera perception stream',
      };
    }

    // 4. "that" / "this" general deictic reference: refers to last read or snapshot
    if (/\b(?:that|this|it)\b/i.test(ref)) {
      if (ctx.lastVerifiedResult?.summary) {
        return {
          resolved: true,
          source: 'CONTENT_ITEM',
          resolvedContent: ctx.lastVerifiedResult.summary,
          resolvedTarget: ctx.activeApplication || ctx.activeTarget || undefined,
        };
      }
      if (ctx.activeContentSnapshot) {
        return {
          resolved: true,
          source: 'CONTENT_SNAPSHOT',
          resolvedContent: ctx.activeContentSnapshot,
          resolvedTarget: ctx.activeApplication || ctx.activeTarget || undefined,
        };
      }
    }

    return { resolved: false, source: 'NONE' };
  }

  /**
   * Resets context (primarily for unit tests and clean session start).
   */
  public resetContext(conversationId?: string): void {
    if (conversationId) {
      this.contexts.delete(conversationId);
    } else {
      this.contexts.clear();
    }
  }
}

/**
 * Extracts numbered items (e.g. "1. System init\n2. Do NOT begin Phase 2") from text.
 */
function extractNumberedItems(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  const items: string[] = [];
  const regex = /^\s*(?:\d+[\.\)]|[-*•]|\bpoint\s+\d+[:.]?)\s*(.+)$/i;

  for (const line of lines) {
    const match = line.match(regex);
    if (match && match[1]) {
      items.push(match[1].trim());
    }
  }

  // Fallback to non-empty lines if no numbered format detected
  if (items.length === 0) {
    return lines.map(l => l.trim()).filter(Boolean);
  }

  return items;
}

export const authoritativeInteractionContext = AuthoritativeInteractionContextManager.getInstance();

export function getWritableInteractionContextOwnersCount(): number {
  return 1;
}
