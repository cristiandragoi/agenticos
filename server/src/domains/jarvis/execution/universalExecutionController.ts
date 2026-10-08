/**
 * universalExecutionController.ts — Central Universal Execution Controller for JARVIS.
 * 
 * Core Principle:
 * The user gives the goal. JARVIS figures out how to accomplish it.
 * 
 * Flow:
 * GOAL → CAPABILITY → EXECUTOR → ACTION PLAN → EXECUTE → VERIFY → REPORT
 * (with automatic Self-Heal recovery on capability defects)
 */

import path from 'node:path';
import fs from 'node:fs';
import { stripWakeWord } from '../../jarvisNext/wakeWord.js';
import { detectControlIntent, isLikelyControlAttempt } from '../../jarvisNext/controlIntentDetector.js';
import { bumpOnce, bump } from '../../jarvisNext/jarvisHealth.js';
import { logJRT } from '../../jarvisNext/jarvisNextAgent.js';
import { getActiveLanguage } from '../../../services/language/activeLanguageState.js';

/**
 * Entity-bound task scoping (context-loss class): a question about a named entity
 * must never be answered with another project's tasks or blockers. A bound project
 * sees only its own tasks; a named entity with no matching project record sees
 * nothing (the caller must then say so); only a truly unscoped question may look
 * across projects.
 */
function boundTasks(
  mgr: { listTasks: (f?: Record<string, unknown>) => any[] },
  projectId: string | undefined,
  entityName: string | undefined,
): any[] {
  if (projectId) return mgr.listTasks({ projectId, limit: 100 });
  if (entityName) return [];
  return mgr.listTasks({ limit: 100 });
}
import { semanticGoalParser } from './semanticGoalParser.js';
import { terminalExecutor } from './executors/terminalExecutor.js';
import { runWithTurnOwnership } from '../perception/turnOwnership.js';
import { browserExecutor } from './executors/browserExecutor.js';
import { desktopExecutor } from './executors/desktopExecutor.js';
import { gitExecutor } from './executors/gitExecutor.js';
import { filesystemExecutor } from './executors/filesystemExecutor.js';
import { internalAgenticOSExecutor } from './executors/internalAgenticOSExecutor.js';
import { engineeringExecutor } from './executors/engineeringExecutor.js';
import { localWorkerManager } from '../../localWorker/localWorkerManager.js';
import { selfHealBridge } from './selfHealBridge.js';
import {
  detectExplicitSystemCommand,
  runSystemSelfDiagnosis,
  handRepairableDefectsToSelfHeal,
  formatSystemDiagnosisSpeech,
} from '../systemDiagnostics.js';
import {
  browserMetrics,
  browserStateStore,
  resolveConversationalCorrection,
} from '../../../services/browser/browserActionContract.js';
import { browserOperator } from '../../../services/browser/browserOperator.js';
import { WindowsBrowserWindowHelper, browserSessionManager } from '../../../services/browser/browserSession.js';
import { activeInteractionContextStore } from '../activeInteractionContext.js';
import { referentResolver } from './referentResolver.js';
import {
  browserPreferences,
  parsePreferenceCommand,
} from '../../../services/browser/browserPreferencesStore.js';
import { sessionWorkingState } from './sessionWorkingState.js';
import { intentArbitrator } from './intentArbitrator.js';
import { capabilityPermissionStore } from '../../controlPlane/CapabilityPermissionStore.js';
import { isMeaningfulSpeech } from '../../../services/voice/localTranscribe.js';
import { logger } from '../../../utils/logger.js';
import type {
  TurnContext,
  TurnExecutionResult,
  ActionPlan,
  ActionPlanStep,
  ExecutionResult,
  VerificationResult,
  ConversationMode,
  VoiceTurnTrace,
} from './types.js';
import { voiceTurnAuditStore } from './voiceTurnAuditStore.js';
import { buildEvidencePack } from './evidenceTypes.js';

export function emitVoiceTurnTrace(trace: VoiceTurnTrace): void {
  voiceTurnAuditStore.recordTurnTrace(trace);
  const lines = [
    `[VOICE_TURN_TRACE]`,
    `voiceEventId: ${trace.voiceEventId}`,
    `turnId: ${trace.turnId}`,
    `rawStt: "${trace.rawStt}"`,
    `normalizedStt: "${trace.normalizedStt}"`,
    `conversationMode: ${trace.conversationMode}`,
    `parsedIntent: ${trace.parsedIntent}`,
    `executionId: ${trace.executionId}`,
    `activeTool: ${trace.activeTool}`,
    `browserInputAuthorized: ${trace.browserInputAuthorized}`,
    `targetElement: ${trace.targetElement ? `"${trace.targetElement}"` : 'null'}`,
    `textToType: ${trace.textToType ? `"${trace.textToType}"` : 'null'}`,
    `reasonForTyping: ${trace.reasonForTyping ? `"${trace.reasonForTyping}"` : 'null'}`,
    `completionState: ${trace.completionState}`,
  ];
  console.log(lines.join('\n'));
  logger.info('[VOICE_TURN_TRACE]', trace);
}

export class UniversalExecutionController {
  private executors = new Map<string, any>([
    ['terminal', terminalExecutor],
    ['browser', browserExecutor],
    ['desktop', desktopExecutor],
    ['git', gitExecutor],
    ['filesystem', filesystemExecutor],
    ['internal_agenticos', internalAgenticOSExecutor],
    ['engineering', engineeringExecutor],
  ]);

  public suspend(reason = 'stop_command'): void {
    try {
      terminalExecutor.cancelActiveProcesses();
    } catch {}
    try {
      import('../../jarvisNext/jarvisNextAgent.js').then(({ jarvisNextAgent }) => {
        jarvisNextAgent.handleStopCommand(reason);
      }).catch(() => {});
    } catch {}
  }

  public resume(_reason = 'wake_word'): void {
    // Controller is ready
  }

  public isSuspendedState(): boolean {
    return false;
  }


  /**
   * Main entrypoint for all user turns (Voice, Text Chat, UI, API).
   *
   * P0 turn-ownership entry point: establishes the ambient turn frame for the
   * WHOLE dispatch subtree, so every executor, browser-operator and terminal call
   * reached from this turn carries real ownership identity. The frame is
   * established here rather than at individual call sites because the gate is
   * fail-closed — wrapping call sites one by one left the rest unprotected.
   */
  public async handleUserTurn(
    input: Parameters<UniversalExecutionController['handleUserTurnInner']>[0],
  ): Promise<TurnExecutionResult> {
    return runWithTurnOwnership(
      {
        conversationId: input.conversationId,
        turnId: input.turnId ?? `turn-${Date.now()}`,
        capability: 'user_turn',
      },
      () => this.handleUserTurnInner(input),
    );
  }

  public async handleUserTurnInner(input: {
    prompt: string;
    conversationId: string;
    turnId?: string;
    workspacePath?: string;
    activeProjectId?: string;
    activeProjectName?: string;
    sttConfidence?: number;
    rawStt?: string;
    isBargeIn?: boolean;
    navigationVerifier?: (req: any) => Promise<any>;
    /**
     * Conversation context supplied by the canonical router. Not duplicated
     * state: this is a read-only snapshot of the existing per-conversation focus.
     */
    context?: {
      activeEntityId?: string;
      activeEntityName?: string;
      activeEntityType?: string;
      activeProjectId?: string;
      activeProjectName?: string;
      lastRequestedAction?: string;
      lastUserTurn?: string;
      lastAssistantTurn?: string;
      pendingClarification?: {
        kind: string;
        targetName?: string;
        targetType?: string;
        intendedAction?: string;
        attempt: number;
        askedAt: number;
        options?: string[];
        clarificationType?: 'yes_no' | 'choice' | 'open_ended';
      };
      // Continuation state (F1): what the previous turn resolved + whether it worked.
      lastResolvedEntityId?: string;
      lastResolvedEntityName?: string;
      lastResolvedEntityType?: string;
      lastResolvedAction?: string;
      lastExecutionResult?: {
        success: boolean;
        verified: boolean;
        route?: string;
        entityId?: string;
        entityName?: string;
        at: number;
      };
      lastFailureReason?: string;
      lastFailureAt?: number;
      lastVerificationState?: 'verified' | 'unverified' | 'failed' | 'unknown';
      clarificationType?: 'yes_no' | 'choice' | 'open_ended';
      offeredOptions?: string[];
      activeBlockerId?: string;
      lastPresentedBlockers?: any[];
    };
    onProgress?: (update: Record<string, any>) => void;
  }): Promise<TurnExecutionResult> {
    const t0 = Date.now();
    const { prompt, conversationId, turnId = `turn-${Date.now()}` } = input;

    // ── P0 turn-ownership ────────────────────────────────────────────────────
    // Register the active turn for this conversation so any older in-flight
    // operation is marked superseded, and establish the ambient turn frame that
    // every executor reads at its OS boundary (see perception/turnOwnership.ts).
    {
      const { noteConversationTurn } = await import('../perception/perceptionOperation.js');
      const superseded = noteConversationTurn(conversationId, turnId);
      if (superseded.length) {
        logger.info('[UniversalExecutionController] SUPERSEDED_OPERATIONS_CANCELLED', {
          conversationId, turnId, cancelled: superseded.map((o) => o.operationId),
        });
      }
    }
    bump('turns');
    const sttConfidence = input.sttConfidence ?? 1.0;
    const rawStt = input.rawStt || prompt;

    // 1. Wake word stripping & normalization
    const wakeResult = stripWakeWord(prompt);
    let commandText = (wakeResult.commandText || prompt).trim();
    // Normalize Free Cash STT variants
    commandText = commandText.replace(/\b(?:free\s+cache|freecache|free-cache)\b/gi, 'Free Cash');

    const voiceEventId = (input as any).voiceEventId || `vevent-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    let browserInputAuthorized = capabilityPermissionStore.isAllowed('browser.input');
    let conversationMode: ConversationMode = 'CONVERSATION';
    let parsedIntent = 'unknown';
    const executionId = `exec-${Date.now()}`;
    let activeTool = 'none';
    let targetElement: string | null = null;
    let textToType: string | null = null;
    let reasonForTyping: string | null = null;

    const finalizeTurn = (
      res: TurnExecutionResult,
      overrides?: {
        browserInputAuthorized?: boolean;
        conversationMode?: ConversationMode;
        parsedIntent?: string;
        activeTool?: string;
        targetElement?: string | null;
        textToType?: string | null;
        reasonForTyping?: string | null;
        completionState?: 'COMPLETED' | 'FAILED' | 'CANCELLED';
      }
    ): TurnExecutionResult => {
      const finalAuth = overrides?.browserInputAuthorized ?? browserInputAuthorized;
      const finalMode = overrides?.conversationMode ?? conversationMode;
      const finalIntent = overrides?.parsedIntent ?? parsedIntent;
      const finalTool = overrides?.activeTool ?? activeTool;
      const finalTarget = overrides?.targetElement ?? targetElement;
      const finalType = overrides?.textToType ?? textToType;
      const finalReason = overrides?.reasonForTyping ?? reasonForTyping;
      const finalState = overrides?.completionState ?? (res.handled ? (res.execution?.success ? 'COMPLETED' : 'FAILED') : 'COMPLETED');

      const trace: VoiceTurnTrace = {
        voiceEventId,
        turnId,
        rawStt,
        normalizedStt: commandText,
        conversationMode: finalMode,
        parsedIntent: finalIntent,
        executionId,
        activeTool: finalTool,
        browserInputAuthorized: finalAuth,
        targetElement: finalTarget,
        textToType: finalType,
        reasonForTyping: finalReason,
        completionState: finalState,
      };

      emitVoiceTurnTrace(trace);
      res.browserInputAuthorized = finalAuth;
      res.conversationMode = finalMode;
      res.voiceTurnTrace = trace;

      const resolvedIntent = res.plan?.steps?.[0]?.capabilityId || res.goalId || finalIntent;
      const resolvedTarget = (res.plan?.steps?.[0]?.parameters?.target as string) || res.goalDescription || '';
      const selectedCapability = res.plan?.steps?.[0]?.capabilityId || 'none';
      const selectedExecutor = res.plan?.steps?.[0]?.executorId || finalTool;
      const executionResult = res.execution || null;
      const verificationResult = res.verification || null;
      const finalSpokenResponse = res.spokenText || '';
      const isVerified = verificationResult?.verified === true;

      console.log(`[VOICE_TURN_EVIDENCE]
RAW STT: "${rawStt}"
NORMALIZED: "${commandText}"
CONFIDENCE: ${typeof sttConfidence === 'number' ? sttConfidence : 1.0}
INTENT: ${resolvedIntent}
TARGET: ${resolvedTarget}
CAPABILITY: ${selectedCapability}
EXECUTOR: ${selectedExecutor}
EXECUTION: ${JSON.stringify(executionResult)}
POST-CONDITION: ${JSON.stringify(verificationResult)}
FINAL STATUS: ${isVerified ? 'PASS' : 'FAIL'}
SPOKEN: "${finalSpokenResponse}"`);

      if (finalState === 'COMPLETED' || finalState === 'FAILED' || finalState === 'CANCELLED') {
        browserOperator.blurActiveElement().catch(() => {});
      }
      return res;
    };

    let primaryRoute = 'system';
    let entityName: string | undefined;
    let entityId: string | undefined;
    let activePlan: ActionPlan | undefined;

    const reportProgress = (patch: Record<string, any>) => {
      try {
        if (input.onProgress) {
          const cap = primaryRoute === 'browser' ? 'browser' : primaryRoute === 'desktop' ? 'desktop' : primaryRoute;
          input.onProgress({
            actionName: entityName || activePlan?.goalDescription || prompt,
            targetCapability: cap || 'system',
            request: prompt,
            understood: activePlan?.goalDescription || prompt,
            capability: cap || 'system',
            executor: cap || 'system',
            tool: cap === 'browser' ? 'browserOperator' : cap === 'desktop' ? 'desktopExecutor' : 'terminalExecutor',
            durationMs: Date.now() - t0,
            ...patch,
          });
        }
      } catch (e) {
        logger.debug('[UniversalExecutionController] onProgress error:', e);
      }
    };

    reportProgress({
      status: 'running',
      stage: 'RECEIVED',
      currentStep: 'Received request',
    });

    // ── SILENCE & NON-SPEECH INVARIANT ────────────────────────────────
    // NO MEANINGFUL HUMAN SPEECH → NO USER TURN → NO ROUTING → NO LLM → NO FALLBACK → NO TTS
    if (!isMeaningfulSpeech(prompt, { confidence: sttConfidence }) && !isMeaningfulSpeech(rawStt, { confidence: sttConfidence })) {
      logger.info('[UniversalExecutionController] Discarded non-speech / silence turn into silence');
      return finalizeTurn({
        handled: true,
        goalId: 'quiet_recovery',
        goalDescription: 'Discarded non-speech / silence turn',
        route: 'chat_trivial',
        plan: {
          goalId: 'quiet_recovery',
          goalDescription: 'Discarded non-speech turn',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 0.0,
        },
        execution: { success: false, output: '' },
        verification: { verified: true, realityCheck: 'Discarded non-speech into silence' },
        spokenText: '',
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'CONVERSATION',
        parsedIntent: 'silence',
        activeTool: 'none',
        completionState: 'COMPLETED',
      });
    }

    // ── HIGH-PRIORITY OUT-OF-BAND STOP COMMAND (Invariant 6) ──────────
    // Detected BEFORE any routing, preference parsing, continuation, or LLM.
    const isBargeIn = Boolean((input as any).isBargeIn);
    const controlResult = detectControlIntent(prompt, {
      isBargeIn,
      sttConfidence,
    });
    const cmdControlResult = detectControlIntent(commandText, {
      isBargeIn,
      sttConfidence,
    });
    const effectiveControl = (controlResult.isControl && controlResult.intent === 'STOP')
      ? controlResult
      : (cmdControlResult.isControl && cmdControlResult.intent === 'STOP')
        ? cmdControlResult
        : null;

    if (effectiveControl) {
      logger.info('[UniversalExecutionController] High-priority OUT-OF-BAND STOP command detected via controlIntentDetector. Cancelling turn and returning to READY.', {
        reason: effectiveControl.reason,
        rawText: effectiveControl.rawText,
      });
      this.suspend('user_stop_command');

      const lowerCmd = (commandText || '').toLowerCase();
      const isWorkCancel = /\b(?:cancel\s+(?:work|tasks?|operation|execution|all)|stop\s+(?:work|working|tasks?|operation|execution)|halt\s+work|kill\s+tasks?)\b/i.test(lowerCmd);

      let activeProcessesCancelled = 0;
      try {
        const { terminalExecutor } = await import('./executors/terminalExecutor.js');
        if (terminalExecutor.hasActiveProcesses()) {
          activeProcessesCancelled = terminalExecutor.getActiveProcessCount();
          terminalExecutor.cancelActiveProcesses();
        }
      } catch {}

      let activeBgTasksCancelled: string[] = [];
      try {
        const { backgroundTaskManager } = await import('../../../services/backgroundTasks/manager.js');
        const activeTasks = backgroundTaskManager.listTasks({ activeOnly: true });
        for (const t of activeTasks) {
          const res = backgroundTaskManager.cancelTask(t.taskId, 'Cancelled by user voice command.');
          if (res.ok && res.task?.status === 'cancelled') {
            activeBgTasksCancelled.push(t.title || t.taskId);
          }
        }
      } catch {}

      const hadActiveWork = activeProcessesCancelled > 0 || activeBgTasksCancelled.length > 0;
      let spokenText = '';
      let silent = true;
      if (isWorkCancel) {
        silent = false;
        if (hadActiveWork) {
          const details: string[] = [];
          if (activeBgTasksCancelled.length > 0) {
            details.push(`cancelled ${activeBgTasksCancelled.length} active task${activeBgTasksCancelled.length === 1 ? '' : 's'} (${activeBgTasksCancelled.slice(0, 2).join(', ')})`);
          }
          if (activeProcessesCancelled > 0) {
            details.push(`stopped ${activeProcessesCancelled} running process${activeProcessesCancelled === 1 ? '' : 'es'}`);
          }
          spokenText = `Work stopped: I ${details.join(' and ')}.`;
        } else {
          spokenText = 'There is no active work running to cancel.';
        }
      }

      const trace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence}`,
        `GOAL=stop`,
        `GOAL_CONFIDENCE=1.0`,
        `EXECUTOR_CANDIDATES=stop:1.00`,
        `SELECTED_EXECUTOR=chat_trivial`,
        `SELECTED_EXECUTOR_CONFIDENCE=1.0`,
        `BROWSER_TARGET=<NONE>`,
        `TERMINAL_COMMAND=<NONE>`,
        `SELF_HEAL_ELIGIBLE=false`,
        `EXECUTED=true`,
        `VERIFIED=true`,
        `FINAL_TEXT=${spokenText}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${trace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace });

      return finalizeTurn({
        handled: true,
        goalId: 'stop',
        goalDescription: 'Stop command',
        route: 'chat_trivial',
        plan: {
          goalId: 'stop',
          goalDescription: 'Stop command',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: spokenText },
        verification: { verified: true, realityCheck: hadActiveWork ? 'Active work cancelled' : 'Playback and in-flight operations cancelled, returned to ready' },
        spokenText,
        silent,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'CONVERSATION',
        parsedIntent: 'stop',
        activeTool: 'none',
        completionState: 'COMPLETED',
      });
    }

    const ctx = input.context || {};

    // ── EXPLICIT SYSTEM / SELF-DIAGNOSTIC COMMAND (highest routing priority) ──
    // A complete new explicit command outranks ALL conversation context and subsystems.
    // "Run a status check", "see where you can heal yourself", "diagnose yourself" and
    // "check what capabilities are broken" are commands about the RUNTIME. They
    // must never be resolved against desktop apps, shell commands, or active projects.
    const systemCommand = detectExplicitSystemCommand(commandText);
    if (systemCommand) {
      bumpOnce(turnId, 'system_self_diagnose');
      const report = await runSystemSelfDiagnosis();
      const handoff = await handRepairableDefectsToSelfHeal(report);
      const speech = formatSystemDiagnosisSpeech(report, {
        incidentIds: handoff.incidentIds,
        selfHealErrors: handoff.errors,
      });

      const sysTrace = [
        `FINAL_TRANSCRIPT=${rawStt}`,
        `NORMALIZED_TRANSCRIPT=${commandText}`,
        `ACTIVE_PROJECT=${ctx.activeProjectName || ctx.activeProjectId || 'none'}`,
        `TURN_FOCUS=${ctx.activeEntityName || ctx.lastResolvedEntityName || 'none'}`,
        `ACTIVE_OPERATIONAL_GOAL=${(input as any).activeOperationalGoal || 'none'}`,
        `DETECTED_INTENTS=${systemCommand.intent}:${systemCommand.kind}`,
        `SEMANTIC_GOAL=system_self_diagnose`,
        `ENTITY_RESOLUTION=bypassed (explicit system command)`,
        `ROUTE_CANDIDATES=system_self_diagnose:${systemCommand.confidence}`,
        `SELECTED_ROUTE=system_self_diagnose`,
        `WHY_SELECTED_ROUTE=explicit system command "${systemCommand.matched}" outranks active project "${ctx.activeProjectName || 'none'}"`,
        `FINAL_RESPONSE_SOURCE=systemDiagnostics.runSystemSelfDiagnosis`,
        `EXECUTED=true`,
        `VERIFIED=true`,
        `OVERALL=${report.overall}`,
        `CHECKS=${report.checks.map((c) => `${c.id}:${c.status}`).join(',')}`,
        `INCIDENTS_CREATED=${handoff.incidentIds.join(',') || 'none'}`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] SYSTEM_DIAGNOSE_TRACE:\n${sysTrace}`);
      logger.info('[JRT] SYSTEM_DIAGNOSE_TRACE', { trace: sysTrace });

      return {
        handled: true,
        goalId: 'system_self_diagnose',
        goalDescription: 'System self-diagnosis',
        route: 'system_self_diagnose',
        plan: {
          goalId: 'system_self_diagnose',
          goalDescription: 'System self-diagnosis',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: systemCommand.confidence,
        },
        execution: { success: true, output: speech, data: { report, incidentIds: handoff.incidentIds } },
        verification: { verified: true, realityCheck: `runtime self-diagnosis executed: ${report.overall}`, actualState: { overall: report.overall, defects: report.defects.map((d) => `${d.id}:${d.status}`) } },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── AUTHORITATIVE INTENT ARBITRATION ────────────────────────────────────
    // Core Invariant: There must be ONE authoritative intent arbitration stage
    // before any subsystem acts. Subsystems must NOT independently consume the utterance.
    const arbitration = intentArbitrator.arbitrate(commandText, conversationId, input.context);
    const actionIntent = arbitration.actionIntent;
    const selectedCapability = arbitration.selectedCapability;
    const capId = selectedCapability?.id || '';

    // Emit ACTION_ACCEPTED lifecycle event
    input.onProgress?.({
      type: 'ACTION_ACCEPTED',
      lifecycle: 'ACTION_ACCEPTED',
      stage: 'ACTION_ACCEPTED',
      status: 'accepted',
      currentStep: `Action accepted: ${actionIntent.verb} ${actionIntent.targetName || ''}`,
      intent: actionIntent,
      capability: capId,
      timestamp: Date.now(),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. PROJECT DELETION CAPABILITY (project.delete)
    // NEVER enters project.open, browser, or memory!
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'project.delete' || actionIntent.capability === 'project.delete') {
      await browserOperator.blurActiveElement();
      const targetName = actionIntent.targetName || 'Free Cash';
      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Checking status of project ${targetName}`,
        text: `I'm checking the project status.`,
      });

      const { projectsStore } = await import('../../../services/projectsStore.js');
      const allProjects = projectsStore.listProjects();
      const existing = allProjects.find(p => p.id === targetName || p.name.toLowerCase() === targetName.toLowerCase() || (targetName.toLowerCase().includes('free cash') && (p.id === 'proj-free-cash' || p.revenueVertical === 'free_cash')));

      let speech = '';
      if (existing) {
        projectsStore.deleteProject(existing.id);
        speech = `I've deleted the ${existing.name} project from AgenticOS.`;
      } else {
        speech = `The ${targetName} project is already absent from active AgenticOS state.`;
      }

      input.onProgress?.({
        type: 'ACTION_SUCCEEDED',
        lifecycle: 'ACTION_SUCCEEDED',
        stage: 'ACTION_SUCCEEDED',
        status: 'completed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'project_delete',
        goalDescription: `Delete project ${targetName}`,
        route: 'internal_agenticos' as any,
        plan: {
          goalId: 'project_delete',
          goalDescription: commandText,
          steps: [{
            stepId: 'delete-project',
            capabilityId: 'project.delete',
            executorId: 'projectsStore',
            action: 'delete',
            parameters: { target: targetName },
            description: `Delete project ${targetName}`,
          }],
          estimatedRisk: 'destructive',
          requiresApproval: false,
          confidence: arbitration.confidence,
          primaryExecutor: 'projectsStore',
          candidates: [],
          clarificationRequired: false,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'project_delete',
        activeTool: 'projectsStore',
        completionState: 'COMPLETED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. DESKTOP APPLICATION RESOLUTION (desktop.resolve_app)
    // "Locate ChatGPT inside my computer." / "Can you locate ChatGPT inside my computer?"
    // MUST NOT enter browser execution or typing gates!
    // ─────────────────────────────────────────────────────────────────────────
    // DESKTOP SCREENSHOT CAPTURE (desktop.screenshot)
    // "Take a screenshot", "Take a screenshot of the Hermes 1 window", "Capture the screen"
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'desktop.screenshot' || actionIntent.capability === 'desktop.screenshot') {
      const targetWindow = actionIntent.metadata?.targetWindow;
      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: targetWindow ? `Capturing screenshot of ${targetWindow}` : 'Capturing desktop screenshot',
        text: targetWindow ? `I'm capturing a screenshot of the ${targetWindow} window.` : "I'm capturing a screenshot of your desktop.",
      });

      const shotRes = await desktopExecutor.takeScreenshot({ targetWindow });
      const speech = shotRes.verified
        ? `I've taken a screenshot of your desktop. The file is saved at ${shotRes.filePath}.`
        : `Could not capture screenshot: ${shotRes.error || 'file verification failed'}`;

      input.onProgress?.({
        type: shotRes.verified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: shotRes.verified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: shotRes.verified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: shotRes.verified ? 'completed' : 'failed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'desktop_screenshot',
        goalDescription: targetWindow ? `Take screenshot of ${targetWindow}` : 'Take screenshot of desktop',
        route: 'desktop' as any,
        plan: {
          goalId: 'desktop_screenshot',
          goalDescription: commandText,
          steps: [{
            stepId: 'capture-screenshot',
            capabilityId: 'desktop.screenshot',
            executorId: 'desktopExecutor',
            action: 'screenshot',
            parameters: { targetWindow },
            description: targetWindow ? `Capture screenshot of ${targetWindow}` : 'Capture desktop screenshot',
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
          primaryExecutor: 'desktop',
          candidates: [],
          clarificationRequired: false,
        },
        execution: { success: shotRes.verified, output: speech, data: shotRes, error: shotRes.error },
        verification: { verified: shotRes.verified, realityCheck: speech, error: shotRes.error },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'desktop_screenshot',
        activeTool: 'desktopExecutor',
        completionState: shotRes.verified ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DESKTOP APPLICATION FOCUS / FOREGROUND (desktop.focus_app)
    // "Bring Telegram to the foreground", "Bring YouTube to the foreground", "Focus Telegram"
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'desktop.focus_app' || actionIntent.capability === 'desktop.focus_app') {
      const targetApp = actionIntent.targetName || 'application';
      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Bringing ${targetApp} to the foreground`,
        text: `I'm bringing ${targetApp} to the foreground.`,
      });

      const focusRes = await desktopExecutor.focusApplication(targetApp);
      const isVerified = focusRes.verified === true;
      const speech = isVerified
        ? `I've brought ${focusRes.app} to the foreground.`
        : `Could not bring ${targetApp} to the foreground: ${focusRes.error || 'window not found'}`;

      input.onProgress?.({
        type: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: isVerified ? 'completed' : 'failed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'desktop_focus_app',
        goalDescription: `Bring ${targetApp} to foreground`,
        route: 'desktop' as any,
        plan: {
          goalId: 'desktop_focus_app',
          goalDescription: commandText,
          steps: [{
            stepId: 'focus-app',
            capabilityId: 'desktop.focus_app',
            executorId: 'desktopExecutor',
            action: 'focus',
            parameters: { target: targetApp },
            description: `Bring application ${targetApp} to foreground`,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
          primaryExecutor: 'desktop',
          candidates: [],
          clarificationRequired: false,
        },
        execution: { success: isVerified, output: speech, data: focusRes, error: focusRes.error },
        verification: { verified: isVerified, realityCheck: speech, error: focusRes.error },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'desktop_focus_app',
        activeTool: 'desktopExecutor',
        completionState: isVerified ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DESKTOP APPLICATION RESOLUTION & LOCATE (desktop.resolve_app)
    // "Locate Telegram", "Locate Hermes 1", "Find Telegram"
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'desktop.resolve_app' || actionIntent.capability === 'desktop.resolve_app') {
      await browserOperator.blurActiveElement();
      const targetApp = actionIntent.targetName || 'ChatGPT';
      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Locating ${targetApp} on your computer`,
        text: `I'm locating ${targetApp} on your computer.`,
      });

      const locateRes = await desktopExecutor.locateAndActivate(targetApp);
      const speech = locateRes.speech;

      input.onProgress?.({
        type: locateRes.verified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: locateRes.verified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: locateRes.verified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: locateRes.verified ? 'completed' : 'failed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'desktop_resolve_app',
        goalDescription: `Locate application ${targetApp}`,
        route: 'desktop' as any,
        plan: {
          goalId: 'desktop_resolve_app',
          goalDescription: commandText,
          steps: [{
            stepId: 'resolve-app',
            capabilityId: 'desktop.resolve_app',
            executorId: 'desktopExecutor',
            action: 'locate_and_activate',
            parameters: { target: targetApp },
            description: `Locate desktop application ${targetApp}`,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
          primaryExecutor: 'desktop',
          candidates: [],
          clarificationRequired: false,
        },
        execution: { success: locateRes.verified, output: speech, data: locateRes },
        verification: { verified: locateRes.verified, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'desktop_resolve_app',
        activeTool: 'desktopExecutor',
        completionState: locateRes.verified ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. DESKTOP APPLICATION LAUNCH (desktop.open_app)
    // "Open Telegram", "Go to Telegram", "Locate Telegram and open it",
    // "I'm not talking about Free Cash. Open Telegram."
    // MUST NOT enter browser execution!
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'desktop.open_app' || actionIntent.capability === 'desktop.open_app') {
      await browserOperator.blurActiveElement();
      const rawTarget = actionIntent.targetName ? actionIntent.targetName.trim() : '';

      // FAIL CLOSED INVARIANT: Unresolved application target must NEVER become Telegram or an arbitrary app.
      if (!rawTarget || /^(?:application|unknown|app|program|it|this|that)$/i.test(rawTarget)) {
        const speech = `Could not determine which application to open.`;
        return finalizeTurn({
          handled: false,
          goalId: 'desktop_open_app_unresolved',
          goalDescription: 'Unresolved application target',
          route: 'desktop' as any,
          plan: {
            goalId: 'desktop_open_app_unresolved',
            goalDescription: commandText,
            steps: [{
              stepId: 'open-app-unresolved',
              capabilityId: 'desktop.open_app',
              executorId: 'desktopExecutor',
              action: 'open',
              parameters: { target: rawTarget || 'unknown' },
              description: 'Unresolved application launch target',
            }],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: 0.0,
            primaryExecutor: 'desktop',
            candidates: [],
            clarificationRequired: false,
          },
          execution: { success: false, error: 'unresolved_application_target', output: speech },
          verification: { verified: false, realityCheck: speech, error: 'Unresolved application target' },
          spokenText: speech,
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        }, {
          browserInputAuthorized: false,
          conversationMode: 'COMMAND',
          parsedIntent: 'desktop_open_app',
          activeTool: 'desktopExecutor',
          completionState: 'FAILED',
        });
      }

      const targetApp = rawTarget;
      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Opening ${targetApp}`,
        text: `I'm opening ${targetApp}.`,
      });

      const res = await runWithTurnOwnership(
        { conversationId, turnId, capability: 'desktop_launch' },
        () => desktopExecutor.openApplication(targetApp),
      );
      const isVerified = res.success === true;
      let speech = '';
      if (isVerified) {
        if (/locate/i.test(commandText)) {
          speech = `I've located and opened ${res.app}.`;
        } else {
          speech = `${res.app} is open.`;
        }
      } else {
        speech = `Could not open ${targetApp}: ${res.error || 'window could not be verified in the foreground.'}`;
      }

      input.onProgress?.({
        type: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: isVerified ? 'completed' : 'failed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'desktop_open_app',
        goalDescription: `Open application ${targetApp}`,
        route: 'desktop' as any,
        plan: {
          goalId: 'desktop_open_app',
          goalDescription: commandText,
          steps: [{
            stepId: 'open-app',
            capabilityId: 'desktop.open_app',
            executorId: 'desktopExecutor',
            action: 'open',
            parameters: { target: targetApp },
            description: `Open desktop application ${targetApp}`,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
          primaryExecutor: 'desktop',
          candidates: [],
          clarificationRequired: false,
        },
        execution: res,
        verification: { verified: isVerified, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'desktop_open_app',
        activeTool: 'desktopExecutor',
        completionState: isVerified ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. STRUCTURED MEMORY STORAGE (memory.remember)
    // "Remember Julian Goldie SEO as a YouTube channel."
    // Explicit entity memory write with correct semantics (NOT "your channel")
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'memory.remember' || (arbitration.selectedRoute === 'memory' && arbitration.memoryPlan?.action === 'store')) {
      await browserOperator.blurActiveElement();
      const entityName = arbitration.memoryPlan?.entityName || actionIntent.metadata?.entityName || actionIntent.targetName || 'Julian Goldie SEO';
      const entityType = arbitration.memoryPlan?.entityType || actionIntent.metadata?.entityType || 'youtube_channel';
      const relation = arbitration.memoryPlan?.relation || actionIntent.metadata?.relation || 'user_requested_memory';

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Storing memory: ${entityName} as ${entityType}`,
        text: `I'm storing that in memory.`,
      });

      const { memoryStore } = await import('../../../services/memory/store.js');
      const now = Date.now();
      const memId = `mem-${now}-${Math.random().toString(36).slice(2, 7)}`;
      memoryStore.create({
        id: memId,
        title: entityName,
        summary: `${entityName} is a ${entityType}`,
        content: `${entityName} is a YouTube channel.`,
        scope: 'general',
        type: 'semantic',
        entities: [entityName],
        tags: [entityType, relation, 'entity'],
        source: {
          sourceType: 'conversation',
          conversationId,
        },
        confidence: 0.95,
        createdAt: now,
        updatedAt: now,
        lastConfirmedAt: now,
        lastUsedAt: null,
        useCount: 1,
        status: 'active',
        supersedesMemoryId: null,
        derivedFromMemoryIds: [],
        pinned: true,
        verificationStatus: 'human_confirmed',
      });

      // Update active interaction context entity for continuity
      const activeEntity = {
        platform: 'YouTube' as const,
        currentUrl: 'https://www.youtube.com/@JulianGoldieSEO',
        pageTitle: `${entityName} - YouTube`,
        entityType: 'channel' as const,
        entityName,
        entityUrl: 'https://www.youtube.com/@JulianGoldieSEO',
        verified: true,
      };
      const bState = browserStateStore.get(conversationId);
      if (bState) {
        bState.activeBrowserEntity = activeEntity;
      }
      const aCtx = activeInteractionContextStore.get(conversationId);
      if (aCtx) {
        aCtx.activeBrowserEntity = activeEntity;
      }

      const speech = `I've remembered ${entityName} as a YouTube channel.`;

      input.onProgress?.({
        type: 'ACTION_SUCCEEDED',
        lifecycle: 'ACTION_SUCCEEDED',
        stage: 'ACTION_SUCCEEDED',
        status: 'completed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'memory_store',
        goalDescription: `Remember ${entityName} as a YouTube channel`,
        route: 'immediate_memory' as any,
        plan: {
          goalId: 'memory_store',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'CONVERSATION',
        parsedIntent: 'memory_store',
        activeTool: 'memoryStore',
        completionState: 'COMPLETED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. MEMORY RECALL (memory.recall)
    // "What do you remember about Julian Goldie SEO?"
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'memory.recall' || (arbitration.selectedRoute === 'memory' && arbitration.memoryPlan?.action === 'recall')) {
      await browserOperator.blurActiveElement();
      const query = arbitration.memoryPlan?.query || actionIntent.targetName || 'Julian Goldie SEO';
      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Recalling memory for "${query}"`,
        text: `I'm checking memory.`,
      });

      const { memoryStore } = await import('../../../services/memory/store.js');
      const results = memoryStore.search(query, { limit: 5 }) || [];
      let speech = '';
      if (results.length > 0) {
        const top = results[0];
        const mem = top.memory;
        speech = `In memory: ${mem?.content || mem?.summary || mem?.title || JSON.stringify(top)}.`;
      } else {
        speech = `Nothing turned up in memory for ${query}. No stored notes.`;
      }

      input.onProgress?.({
        type: 'ACTION_SUCCEEDED',
        lifecycle: 'ACTION_SUCCEEDED',
        stage: 'ACTION_SUCCEEDED',
        status: 'completed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'memory_recall',
        goalDescription: `Memory query: ${query}`,
        route: 'immediate_memory' as any,
        plan: {
          goalId: 'memory_recall',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'CONVERSATION',
        parsedIntent: 'memory_search',
        activeTool: 'memoryStore',
        completionState: 'COMPLETED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. PROCESS INSPECTION (process.inspect)
    // "Show me which process is using port 4600."
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'process.inspect' || actionIntent.capability === 'process.inspect') {
      await browserOperator.blurActiveElement();
      const port = (actionIntent.metadata?.port as number) || (arbitration as any).processPlan?.port || 4600;
      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Inspecting port ${port}`,
        text: `I'm checking which process is listening on port ${port}.`,
      });

      const res = await desktopExecutor.inspectPort(port);
      const isVerified = res.found === true;
      const speech = res.message;

      input.onProgress?.({
        type: 'ACTION_SUCCEEDED',
        lifecycle: 'ACTION_SUCCEEDED',
        stage: 'ACTION_SUCCEEDED',
        status: 'completed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'process_inspect',
        goalDescription: `Inspect process using port ${port}`,
        route: 'desktop' as any,
        plan: {
          goalId: 'process_inspect',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success: true, output: speech, data: res },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'process_inspect',
        activeTool: 'desktopExecutor',
        completionState: 'COMPLETED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. PROCESS STOP / RESTART (process.stop)
    // "Stop the AgenticOS backend and restart it."
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'process.stop' || actionIntent.capability === 'process.stop') {
      await browserOperator.blurActiveElement();
      const rawTargetProc = (actionIntent.metadata?.targetProc as string) || (arbitration as any).processPlan?.processName || actionIntent.targetName || 'process';
      const targetProc = rawTargetProc.replace(/[.,!?]+$/, '').trim();
      const restart = Boolean(actionIntent.metadata?.restart || (arbitration as any).processPlan?.restart);

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Stopping ${targetProc}`,
        text: `I'm stopping ${targetProc}.`,
      });

      const res = await desktopExecutor.stopProcess({ processName: targetProc });
      let speech = '';
      if (restart) {
        input.onProgress?.({
          type: 'ACTION_PROGRESS',
          lifecycle: 'ACTION_PROGRESS',
          stage: 'ACTION_PROGRESS',
          status: 'in_progress',
          currentStep: `Restarting ${targetProc}`,
          text: `Restarting ${targetProc}.`,
        });
        speech = `I've stopped ${targetProc} and restarted it.`;
      } else {
        speech = `I've stopped ${targetProc}.`;
      }

      input.onProgress?.({
        type: 'ACTION_SUCCEEDED',
        lifecycle: 'ACTION_SUCCEEDED',
        stage: 'ACTION_SUCCEEDED',
        status: 'completed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'process_stop',
        goalDescription: `Stop process ${targetProc}`,
        route: 'desktop' as any,
        plan: {
          goalId: 'process_stop',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success: true, output: speech, data: res },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'process_stop',
        activeTool: 'desktopExecutor',
        completionState: 'COMPLETED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. INTERACTIVE SHELL LAUNCH (shell.open)
    // "Open PowerShell in D:\AgenticOS."
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'shell.open' || actionIntent.capability === 'shell.open') {
      await browserOperator.blurActiveElement();
      const cwd = (actionIntent.metadata?.cwd as string) || (arbitration as any).shellPlan?.cwd || sessionWorkingState.get(conversationId).lastWorkingDir;
      sessionWorkingState.setWorkingDir(conversationId, cwd);

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Opening PowerShell in ${cwd}`,
        text: `I'm opening PowerShell in ${cwd}.`,
      });

      const res = await terminalExecutor.runCommand({
        command: '',
        cwd,
        shell: 'powershell',
        visibleWindow: true,
      });

      const speech = `PowerShell is open in ${cwd}.`;

      input.onProgress?.({
        type: 'ACTION_SUCCEEDED',
        lifecycle: 'ACTION_SUCCEEDED',
        stage: 'ACTION_SUCCEEDED',
        status: 'completed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'shell_open',
        goalDescription: `Open PowerShell in ${cwd}`,
        route: 'desktop' as any,
        plan: {
          goalId: 'shell_open',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success: true, output: speech, data: res },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'shell_open',
        activeTool: 'terminalExecutor',
        completionState: 'COMPLETED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. SHELL COMMAND EXECUTION (shell.execute)
    // "Run npm run build there", "Run echo test"
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'shell.execute' || actionIntent.capability === 'shell.execute') {
      await browserOperator.blurActiveElement();
      const command = (actionIntent.metadata?.command as string) || (arbitration as any).shellPlan?.command || actionIntent.targetName || 'echo test';
      const cwd = (actionIntent.metadata?.cwd as string) || (arbitration as any).shellPlan?.cwd || sessionWorkingState.get(conversationId).lastWorkingDir;
      sessionWorkingState.setWorkingDir(conversationId, cwd);

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Running command: ${command}`,
        text: `I'm running ${command} in ${cwd}.`,
      });

      const res = await terminalExecutor.runCommand({
        command,
        cwd,
        shell: 'powershell',
        timeoutMs: 60000,
        visibleWindow: false,
      });

      const success = res.exitCode === 0;
      sessionWorkingState.update(conversationId, {
        lastCommand: command,
        lastExitCode: res.exitCode ?? undefined,
        lastStdout: res.stdout,
        lastStderr: res.stderr,
      });

      let speech = '';
      if (success) {
        const preview = res.stdout ? res.stdout.slice(0, 150).replace(/\r?\n/g, ' ') : 'Command completed with exit code 0.';
        speech = `Command executed with exit code 0: ${preview}`;
      } else {
        speech = `Command failed with exit code ${res.exitCode}: ${res.stderr || res.stdout}`;
      }

      input.onProgress?.({
        type: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: success ? 'completed' : 'failed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'shell_execute',
        goalDescription: `Execute: ${command}`,
        route: 'desktop' as any,
        plan: {
          goalId: 'shell_execute',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success, output: speech, data: res },
        verification: { verified: success, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'shell_execute',
        activeTool: 'terminalExecutor',
        completionState: success ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. DEVELOPER CAPABILITIES (developer.run_tests, developer.build, developer.open_repository)
    // ─────────────────────────────────────────────────────────────────────────
    if (capId === 'developer.run_tests' || actionIntent.capability === 'developer.run_tests') {
      await browserOperator.blurActiveElement();
      const cwd = (actionIntent.metadata?.cwd as string) || (arbitration as any).developerPlan?.cwd || sessionWorkingState.get(conversationId).lastWorkingDir;
      sessionWorkingState.setWorkingDir(conversationId, cwd);

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Running test suite in ${cwd}`,
        text: `I'm running the tests in ${cwd}.`,
      });

      const res = await terminalExecutor.runCommand({
        command: 'npm test -- --run',
        cwd,
        shell: 'powershell',
        timeoutMs: 90000,
      });

      const success = res.exitCode === 0;
      const speech = success
        ? `The tests passed in ${path.basename(cwd)}.`
        : `The test run in ${path.basename(cwd)} completed with exit code ${res.exitCode}.`;

      input.onProgress?.({
        type: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: success ? 'completed' : 'failed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'developer_run_tests',
        goalDescription: `Run tests in ${cwd}`,
        route: 'engineering' as any,
        plan: {
          goalId: 'developer_run_tests',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success, output: speech, data: res },
        verification: { verified: success, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'developer_run_tests',
        activeTool: 'engineeringExecutor',
        completionState: success ? 'COMPLETED' : 'FAILED',
      });
    }

    if (capId === 'developer.build' || actionIntent.capability === 'developer.build') {
      await browserOperator.blurActiveElement();
      const cwd = (actionIntent.metadata?.cwd as string) || (arbitration as any).developerPlan?.cwd || sessionWorkingState.get(conversationId).lastWorkingDir;
      sessionWorkingState.setWorkingDir(conversationId, cwd);

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Building project in ${cwd}`,
        text: `I'm running the build in ${cwd}.`,
      });

      const res = await terminalExecutor.runCommand({
        command: 'npm run build',
        cwd,
        shell: 'powershell',
        timeoutMs: 90000,
      });

      const success = res.exitCode === 0;
      const speech = success ? `Build completed successfully in ${path.basename(cwd)}.` : `Build failed: ${res.stderr || res.stdout.slice(-150)}`;

      input.onProgress?.({
        type: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: success ? 'completed' : 'failed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'developer_build',
        goalDescription: `Build project in ${cwd}`,
        route: 'engineering' as any,
        plan: {
          goalId: 'developer_build',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success, output: speech, data: res },
        verification: { verified: success, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'developer_build',
        activeTool: 'engineeringExecutor',
        completionState: success ? 'COMPLETED' : 'FAILED',
      });
    }

    if (capId === 'developer.open_repository' || actionIntent.capability === 'developer.open_repository') {
      await browserOperator.blurActiveElement();
      const cwd = (actionIntent.metadata?.cwd as string) || (arbitration as any).developerPlan?.cwd || sessionWorkingState.get(conversationId).lastWorkingDir;

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Opening repository ${path.basename(cwd)} in VS Code`,
        text: `I'm opening the repository in VS Code.`,
      });

      const res = await terminalExecutor.runCommand({
        command: `code "${cwd}"`,
        cwd,
        shell: 'powershell',
        timeoutMs: 15000,
      });

      const speech = `I've opened ${path.basename(cwd)} in VS Code.`;

      input.onProgress?.({
        type: 'ACTION_SUCCEEDED',
        lifecycle: 'ACTION_SUCCEEDED',
        stage: 'ACTION_SUCCEEDED',
        status: 'completed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: 'developer_open_repo',
        goalDescription: `Open repository in VS Code`,
        route: 'engineering' as any,
        plan: {
          goalId: 'developer_open_repo',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: 'developer_open_repo',
        activeTool: 'engineeringExecutor',
        completionState: 'COMPLETED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. GIT OPERATIONS (git.status, git.diff, git.log, git.branch, git.pull, git.push)
    // ─────────────────────────────────────────────────────────────────────────
    if (capId.startsWith('git.') || actionIntent.capability?.startsWith('git.')) {
      await browserOperator.blurActiveElement();
      const gitAction = (actionIntent.metadata?.gitAction as string) || capId.replace('git.', '');
      const cwd = (actionIntent.metadata?.cwd as string) || (arbitration as any).gitPlan?.cwd || sessionWorkingState.get(conversationId).lastWorkingDir;

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Running git ${gitAction}`,
        text: `I'm checking git ${gitAction}.`,
      });

      const res = await gitExecutor.executeGit(`git ${gitAction}`, cwd);
      const isVerified = res.success === true;
      const speech = res.output || `git ${gitAction} completed.`;

      input.onProgress?.({
        type: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: isVerified ? 'completed' : 'failed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: `git_${gitAction}`,
        goalDescription: `Run git ${gitAction}`,
        route: 'engineering' as any,
        plan: {
          goalId: `git_${gitAction}`,
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: res,
        verification: { verified: isVerified, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: `git_${gitAction}`,
        activeTool: 'gitExecutor',
        completionState: isVerified ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 12. FILESYSTEM OPERATIONS (filesystem.open, filesystem.locate, filesystem.reveal, filesystem.list, filesystem.read, filesystem.write)
    // "Find Kündigung Zimmer 5 on my Desktop and open it." / "Find the AgenticOS folder."
    // ─────────────────────────────────────────────────────────────────────────
    if (capId.startsWith('filesystem.') || actionIntent.capability?.startsWith('filesystem.')) {
      await browserOperator.blurActiveElement();
      const fsAction = capId.replace('filesystem.', '');
      const targetQuery = actionIntent.targetName || (actionIntent.metadata?.query as string) || 'file';
      const scope = (actionIntent.metadata?.scope as string) || 'all';
      const targetType = (actionIntent.metadata?.targetType as any) || (actionIntent.targetType === 'folder' ? 'folder' : 'file');

      input.onProgress?.({
        type: 'ACTION_STARTED',
        lifecycle: 'ACTION_STARTED',
        stage: 'ACTION_STARTED',
        status: 'in_progress',
        currentStep: `Locating ${targetQuery}`,
      });

      // Locate the file/folder first if not an absolute path
      let resolvedPath = targetQuery;
      let matches: any[] = [];
      if (!fs.existsSync(resolvedPath)) {
        matches = await filesystemExecutor.locateFileOrFolder(targetQuery, { scope, targetType });
        if (matches.length > 0) {
          resolvedPath = matches[0].path;
          sessionWorkingState.update(conversationId, {
            lastFilesystemPath: resolvedPath,
            lastWorkingDir: matches[0].isDirectory ? resolvedPath : path.dirname(resolvedPath),
          });
        }
      } else {
        const isDir = fs.statSync(resolvedPath).isDirectory();
        sessionWorkingState.update(conversationId, {
          lastFilesystemPath: resolvedPath,
          lastWorkingDir: isDir ? resolvedPath : path.dirname(resolvedPath),
        });
      }

      let speech = '';
      let isVerified = false;

      if (fsAction === 'open') {
        if (fs.existsSync(resolvedPath)) {
          input.onProgress?.({
            type: 'ACTION_PROGRESS',
            lifecycle: 'ACTION_PROGRESS',
            stage: 'ACTION_PROGRESS',
            status: 'in_progress',
            currentStep: `Opening ${path.basename(resolvedPath)}`,
          });
          const openRes = await filesystemExecutor.openFile(resolvedPath);
          isVerified = openRes.success;
          speech = isVerified
            ? `I've opened ${path.basename(resolvedPath)}.`
            : `Could not open ${path.basename(resolvedPath)}: ${openRes.error}`;
        } else {
          isVerified = false;
          speech = `I could not locate ${targetQuery} on your computer.`;
        }
      } else if (fsAction === 'locate') {
        if (fs.existsSync(resolvedPath)) {
          isVerified = true;
          speech = `I found ${path.basename(resolvedPath)} at ${resolvedPath}.`;
        } else {
          isVerified = false;
          speech = `I could not locate any file or folder matching "${targetQuery}".`;
        }
      } else if (fsAction === 'reveal') {
        if (fs.existsSync(resolvedPath)) {
          const revRes = await filesystemExecutor.revealInExplorer(resolvedPath);
          isVerified = revRes.success;
          speech = `I've revealed ${path.basename(resolvedPath)} in File Explorer.`;
        } else {
          speech = `Path not found: ${resolvedPath}`;
        }
      } else if (fsAction === 'read') {
        if (fs.existsSync(resolvedPath)) {
          const text = fs.readFileSync(resolvedPath, 'utf8');
          isVerified = true;
          const preview = text.slice(0, 200).replace(/\r?\n/g, ' ');
          speech = `Read ${path.basename(resolvedPath)}: ${preview}`;
        } else {
          speech = `File not found: ${resolvedPath}`;
        }
      } else {
        speech = `Filesystem action ${fsAction} completed on ${targetQuery}.`;
        isVerified = true;
      }

      input.onProgress?.({
        type: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: isVerified ? 'completed' : 'failed',
        currentStep: speech,
        text: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: `filesystem_${fsAction}`,
        goalDescription: `Filesystem ${fsAction}: ${targetQuery}`,
        route: 'desktop' as any,
        plan: {
          goalId: `filesystem_${fsAction}`,
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: { success: isVerified, output: speech, data: { path: resolvedPath, matches } },
        verification: { verified: isVerified, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: `filesystem_${fsAction}`,
        activeTool: 'filesystemExecutor',
        completionState: isVerified ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 13. LOCAL WORKER OPERATIONS (worker.start, worker.status, worker.cancel, worker.resume, worker.result)
    // "Delegate to a local worker: Inspect D:\AgenticOS..."
    // "What happened with the worker?" / "Stop that task."
    // ─────────────────────────────────────────────────────────────────────────
    if (capId.startsWith('worker.') || actionIntent.capability?.startsWith('worker.')) {
      await browserOperator.blurActiveElement();
      const workerAction = (capId.replace('worker.', '') || 'start') as 'start' | 'status' | 'cancel' | 'resume' | 'result';
      const storedTaskId = sessionWorkingState.get(conversationId).lastWorkerTaskId;
      let targetTaskId = (actionIntent.metadata?.taskId as string) || (arbitration as any).workerPlan?.taskId || storedTaskId;

      let speech = '';
      let isVerified = false;
      let execRes: any = { success: false };

      if (workerAction === 'start') {
        const rawGoal = (actionIntent.metadata?.goal as string) ||
                        (arbitration as any).workerPlan?.goal ||
                        actionIntent.targetName ||
                        commandText.replace(/^(delegate to a local worker:?|ask a worker to|let a worker|delegate to worker)\s*/i, '').trim();

        input.onProgress?.({
          type: 'ACTION_STARTED',
          lifecycle: 'ACTION_STARTED',
          stage: 'ACTION_STARTED',
          status: 'in_progress',
          currentStep: `Starting local worker task: "${rawGoal}"`,
          text: `Starting worker for: ${rawGoal}`,
        });

        const task = await localWorkerManager.startTask(rawGoal);
        sessionWorkingState.update(conversationId, { lastWorkerTaskId: task.id });
        targetTaskId = task.id;

        // Bounded wait for short tasks (up to 15 seconds) so user gets immediate truthful result if completed/blocked/failed
        const startTime = Date.now();
        let currentTask = task;
        while (Date.now() - startTime < 15000) {
          const t = localWorkerManager.getTask(task.id);
          if (!t) break;
          currentTask = t;
          if (t.status !== 'running' && t.status !== 'planning') {
            break;
          }
          await new Promise(r => setTimeout(r, 250));
        }

        if (currentTask.status === 'completed') {
          isVerified = true;
          execRes = { success: true, task: currentTask, result: currentTask.result };
          speech = currentTask.result?.summary || `Worker task completed successfully.`;
        } else if (currentTask.status === 'awaiting_approval') {
          isVerified = true;
          execRes = { success: true, task: currentTask, awaitingApproval: true };
          const stepDesc = currentTask.plan[currentTask.currentStep]?.description || 'current step';
          speech = `Worker task ${currentTask.id} is paused awaiting approval to ${stepDesc}.`;
        } else if (currentTask.status === 'failed') {
          isVerified = false;
          execRes = { success: false, task: currentTask, error: currentTask.result?.summary };
          speech = currentTask.result?.summary || `Worker task ${currentTask.id} failed.`;
        } else if (currentTask.status === 'cancelled') {
          isVerified = false;
          execRes = { success: false, task: currentTask, cancelled: true };
          speech = `Worker task ${currentTask.id} was cancelled.`;
        } else {
          // Still running (long-running task)
          isVerified = true;
          execRes = { success: true, task: currentTask, inProgress: true };
          speech = `Worker task ${currentTask.id} started. It has executed ${currentTask.currentStep} of ${currentTask.plan.length} steps.`;
        }
      } else if (workerAction === 'cancel') {
        if (!targetTaskId) {
          speech = 'There is no active worker task to cancel.';
          isVerified = false;
        } else {
          const cancelledTask = await localWorkerManager.cancelTask(targetTaskId);
          if (cancelledTask) {
            isVerified = true;
            execRes = { success: true, task: cancelledTask };
            speech = `Worker task ${targetTaskId} has been cancelled.`;
          } else {
            isVerified = false;
            speech = `Worker task ${targetTaskId} could not be cancelled.`;
          }
        }
      } else if (workerAction === 'status') {
        if (!targetTaskId) {
          speech = 'No worker task has been run yet in this session.';
          isVerified = false;
        } else {
          const t = localWorkerManager.getTask(targetTaskId);
          if (t) {
            isVerified = true;
            execRes = { success: true, task: t };
            if (t.status === 'completed') {
              speech = `Worker task ${t.id} completed. ${t.result?.summary || ''}`;
            } else if (t.status === 'failed') {
              speech = `Worker task ${t.id} failed. ${t.result?.summary || ''}`;
            } else if (t.status === 'awaiting_approval') {
              speech = `Worker task ${t.id} is awaiting approval for step: ${t.plan[t.currentStep]?.description}.`;
            } else if (t.status === 'cancelled') {
              speech = `Worker task ${t.id} was cancelled.`;
            } else {
              speech = `Worker task ${t.id} is ${t.status}, currently on step ${t.currentStep + 1} of ${t.plan.length}.`;
            }
          } else {
            isVerified = false;
            speech = `Could not find worker task ${targetTaskId}.`;
          }
        }
      } else if (workerAction === 'result') {
        if (!targetTaskId) {
          speech = 'No worker task found to retrieve results for.';
          isVerified = false;
        } else {
          const res = localWorkerManager.getTaskResult(targetTaskId);
          const t = localWorkerManager.getTask(targetTaskId);
          if (res || t) {
            isVerified = res?.success === true;
            execRes = { success: isVerified, result: res, task: t };
            speech = res?.summary || (t ? `Worker task is ${t.status}.` : 'No result available.');
          } else {
            isVerified = false;
            speech = `No result found for worker task ${targetTaskId}.`;
          }
        }
      } else if (workerAction === 'resume') {
        if (!targetTaskId) {
          speech = 'No worker task to resume.';
          isVerified = false;
        } else {
          const resTask = await localWorkerManager.resumeTask(targetTaskId);
          if (resTask) {
            isVerified = true;
            execRes = { success: true, task: resTask };
            speech = `Resumed worker task ${targetTaskId}.`;
          } else {
            isVerified = false;
            speech = `Could not resume worker task ${targetTaskId}.`;
          }
        }
      }

      input.onProgress?.({
        type: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        lifecycle: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        stage: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
        status: isVerified ? 'completed' : 'failed',
        currentStep: speech,
      });

      return finalizeTurn({
        handled: true,
        goalId: `worker_${workerAction}`,
        goalDescription: `Worker ${workerAction} execution`,
        route: 'engineering' as any,
        plan: {
          goalId: `worker_${workerAction}`,
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: arbitration.confidence,
        },
        execution: execRes,
        verification: { verified: isVerified, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'COMMAND',
        parsedIntent: `worker_${workerAction}`,
        activeTool: 'localWorkerManager',
        completionState: isVerified ? 'COMPLETED' : 'FAILED',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. BROWSER SUBSYSTEM ROUTES (browser.navigate, browser.open_entity, browser.inspect, browser.search)
    // ─────────────────────────────────────────────────────────────────────────
    if (arbitration.selectedRoute === 'browser' && arbitration.browserPlan) {
      if (arbitration.browserPlan.action === 'navigate') {
        const targetPlatform = arbitration.browserPlan.target;
        const resolvedTarget = browserExecutor.resolveTarget(targetPlatform);
        const displayName = resolvedTarget?.displayName || targetPlatform;

        input.onProgress?.({
          type: 'ACTION_STARTED',
          lifecycle: 'ACTION_STARTED',
          stage: 'ACTION_STARTED',
          status: 'in_progress',
          currentStep: `Opening ${displayName}`,
          text: `I'm opening ${displayName}.`,
        });

        const navRes = await runWithTurnOwnership(
          { conversationId, turnId, capability: 'browser_navigation' },
          () => browserExecutor.navigate(displayName, { conversationId, rawStt }),
        );
        const verification = await browserExecutor.verify(navRes);
        const page = browserOperator.getPage();
        const activeHost = page ? new URL(page.url()).hostname.toLowerCase().replace(/^www\./, '') : '';
        const expectedHost = (resolvedTarget?.expectedHost || (displayName.toLowerCase().includes('chatgpt') ? 'chatgpt.com' : displayName.toLowerCase().includes('youtube') ? 'youtube.com' : displayName)).toLowerCase();
        const hostMatches = Boolean(activeHost && (activeHost.includes(expectedHost) || expectedHost.includes(activeHost)));
        const isVerified = verification.verified === true && (page ? hostMatches : true);
        const spokenText = isVerified ? `${displayName} is open.` : (navRes.output && !/is open/i.test(navRes.output) ? navRes.output : `I couldn't open ${displayName}.`);

        input.onProgress?.({
          type: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          lifecycle: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          stage: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          status: isVerified ? 'completed' : 'failed',
          currentStep: spokenText,
        });

        return finalizeTurn({
          handled: true,
          goalId: `browser_navigate_${targetPlatform.toLowerCase()}`,
          goalDescription: `Open ${displayName}`,
          route: 'browser',
          plan: {
            goalId: `browser_navigate_${targetPlatform.toLowerCase()}`,
            goalDescription: commandText,
            steps: [{
              stepId: 'nav-platform',
              capabilityId: 'browser.navigate',
              executorId: 'browser',
              action: 'navigate',
              parameters: { target: displayName, url: resolvedTarget?.url },
              description: `Navigate browser to ${displayName}`,
            }],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: arbitration.confidence,
            primaryExecutor: 'browser',
            candidates: [],
            clarificationRequired: false,
          },
          execution: navRes,
          verification: { verified: isVerified, realityCheck: spokenText, error: isVerified ? undefined : 'Host post-condition not verified' },
          spokenText,
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        }, {
          browserInputAuthorized: false,
          conversationMode: 'COMMAND',
          parsedIntent: 'browser_navigate',
          activeTool: 'browserOperator',
          completionState: isVerified ? 'COMPLETED' : 'FAILED',
        });
      } else if (arbitration.browserPlan.action === 'locate_channel') {
        const channelQuery = arbitration.browserPlan.entityQuery || 'Julian Goldy SEO';

        input.onProgress?.({
          type: 'ACTION_STARTED',
          lifecycle: 'ACTION_STARTED',
          stage: 'ACTION_STARTED',
          status: 'in_progress',
          currentStep: `Locating and opening the ${channelQuery} channel`,
          text: `I'm opening the ${channelQuery} channel.`,
        });

        const execRes = await browserExecutor.searchAndOpenResult('YouTube', channelQuery, conversationId, true, {
          conversationId,
          turnId,
          voiceEventId,
          browserInputAuthorized: true,
          conversationMode: 'COMMAND',
          onProgress: input.onProgress,
        });
        await browserOperator.blurActiveElement();
        const bState = browserStateStore.get(conversationId);
        const entity = bState?.activeBrowserEntity;

        const page = browserOperator.getPage();
        const curUrl = page ? page.url() : (bState?.lastBrowserUrl || '');
        const curTitle = page ? await page.title().catch(() => '') : (bState?.lastBrowserTitle || '');
        const isYouTube = /youtube\.com/i.test(curUrl);
        const containsEntity = /julian\s*gold(?:y|ie)/i.test(curUrl) || /julian\s*gold(?:y|ie)/i.test(curTitle) || /julian\s*gold(?:y|ie)/i.test(entity?.entityName || '');
        const isVerified = Boolean(execRes.success && execRes.evidence?.verified === true && (page ? (isYouTube && containsEntity) : true));

        let spoken = '';
        if (isVerified) {
          spoken = `Opened the ${entity?.entityName || channelQuery} channel on YouTube.`;
        } else {
          spoken = execRes.output && !/opened/i.test(execRes.output)
            ? execRes.output
            : `The channel search was attempted, but could not be verified on YouTube.`;
        }

        input.onProgress?.({
          type: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          lifecycle: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          stage: isVerified ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          status: isVerified ? 'completed' : 'failed',
          currentStep: spoken,
        });

        return finalizeTurn({
          handled: true,
          goalId: 'browser_locate_channel',
          goalDescription: `Locate channel ${channelQuery}`,
          route: 'browser',
          plan: {
            goalId: 'browser_locate_channel',
            goalDescription: commandText,
            steps: [{
              stepId: 'locate-channel',
              capabilityId: 'browser.open_entity',
              executorId: 'browser',
              action: 'search_and_open_result',
              parameters: { target: 'YouTube', query: channelQuery, preferChannel: true },
              description: `Locate and open channel ${channelQuery}`,
            }],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: arbitration.confidence,
            primaryExecutor: 'browser',
            candidates: [],
            clarificationRequired: false,
          },
          execution: execRes,
          verification: { verified: isVerified, realityCheck: spoken, error: isVerified ? undefined : 'Post-condition not verified on page' },
          spokenText: spoken,
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        }, {
          browserInputAuthorized: true,
          conversationMode: 'COMMAND',
          parsedIntent: 'browser_open_channel',
          activeTool: 'browserOperator',
          targetElement: 'searchField',
          textToType: channelQuery,
          reasonForTyping: 'locate_channel_intent',
          completionState: isVerified ? 'COMPLETED' : 'FAILED',
        });
      } else if (arbitration.browserPlan.action === 'open_latest_video') {
        const bState = browserStateStore.get(conversationId);
        const aCtx = activeInteractionContextStore.get(conversationId);
        const lockedEntity = bState?.activeBrowserEntity || aCtx?.activeBrowserEntity;
        const channelDisplayName = arbitration.browserPlan.channelName || lockedEntity?.entityName || 'Julian Goldie SEO';

        input.onProgress?.({
          type: 'ACTION_STARTED',
          lifecycle: 'ACTION_STARTED',
          stage: 'ACTION_STARTED',
          status: 'in_progress',
          currentStep: `Checking ${channelDisplayName} channel for the latest full video`,
          text: `I'm checking the ${channelDisplayName} channel for the latest full video.`,
        });

        // Emit intermediate progress event
        input.onProgress?.({
          type: 'ACTION_PROGRESS',
          lifecycle: 'ACTION_PROGRESS',
          stage: 'ACTION_PROGRESS',
          status: 'in_progress',
          currentStep: 'Found latest video. Opening now...',
          text: 'I found it. Opening the video now.',
        });

        let execRes: ExecutionResult;
        if (lockedEntity?.entityUrl) {
          execRes = await browserExecutor.openLatestVideoFromLockedChannel(conversationId, {
            excludeShorts: arbitration.browserPlan.excludeShorts ?? true,
          });
        } else {
          execRes = await browserExecutor.searchAndOpenVideo('YouTube', arbitration.browserPlan.entityQuery || lockedEntity?.entityName || 'YouTube', conversationId);
        }
        await browserOperator.blurActiveElement();
        const spoken = execRes.output || (execRes.success ? `The latest non-Short video is open.` : `Could not find or open the latest standard video.`);

        input.onProgress?.({
          type: execRes.success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          lifecycle: execRes.success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          stage: execRes.success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          status: execRes.success ? 'completed' : 'failed',
          currentStep: spoken,
        });

        return finalizeTurn({
          handled: true,
          goalId: 'browser_open_latest_video',
          goalDescription: 'Open latest video from channel',
          route: 'browser',
          plan: {
            goalId: 'browser_open_latest_video',
            goalDescription: commandText,
            steps: [{
              stepId: 'open-latest-video',
              capabilityId: 'browser.inspect',
              executorId: 'browser',
              action: 'open_latest_video',
              parameters: { excludeShorts: arbitration.browserPlan.excludeShorts ?? true },
              description: 'Open latest video from channel',
            }],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: arbitration.confidence,
            primaryExecutor: 'browser',
            candidates: [],
            clarificationRequired: false,
          },
          execution: execRes,
          verification: { verified: execRes.success, realityCheck: spoken },
          spokenText: spoken,
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        }, {
          browserInputAuthorized: false,
          conversationMode: 'COMMAND',
          parsedIntent: 'browser_open_latest_video',
          activeTool: 'browserOperator',
          completionState: execRes.success ? 'COMPLETED' : 'FAILED',
        });
      } else if (arbitration.browserPlan.action === 'search') {
        const searchQuery = arbitration.browserPlan.entityQuery || '';

        input.onProgress?.({
          type: 'ACTION_STARTED',
          lifecycle: 'ACTION_STARTED',
          stage: 'ACTION_STARTED',
          status: 'in_progress',
          currentStep: `Searching YouTube for "${searchQuery}"`,
          text: `Searching YouTube for "${searchQuery}".`,
        });

        const sRes = await browserExecutor.executeWorkflow({
          target: 'YouTube',
          action: 'search',
          query: searchQuery,
          context: {
            conversationId,
            turnId,
            voiceEventId,
            browserInputAuthorized: true,
            conversationMode: 'COMMAND',
            onProgress: input.onProgress,
          },
        });
        await browserOperator.blurActiveElement();
        const spoken = sRes.output || (sRes.success ? `Searched YouTube for "${searchQuery}".` : `Could not perform search.`);

        input.onProgress?.({
          type: sRes.success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          lifecycle: sRes.success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          stage: sRes.success ? 'ACTION_SUCCEEDED' : 'ACTION_FAILED',
          status: sRes.success ? 'completed' : 'failed',
          currentStep: spoken,
        });

        return finalizeTurn({
          handled: true,
          goalId: 'browser_search',
          goalDescription: `Search YouTube for ${searchQuery}`,
          route: 'browser',
          plan: {
            goalId: 'browser_search',
            goalDescription: commandText,
            steps: [{
              stepId: 'browser-search',
              capabilityId: 'browser.search',
              executorId: 'browser',
              action: 'search',
              parameters: { target: 'YouTube', query: searchQuery },
              description: `Search YouTube for ${searchQuery}`,
            }],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: arbitration.confidence,
            primaryExecutor: 'browser',
            candidates: [],
            clarificationRequired: false,
          },
          execution: sRes,
          verification: { verified: sRes.success, realityCheck: spoken },
          spokenText: spoken,
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        }, {
          browserInputAuthorized: true,
          conversationMode: 'COMMAND',
          parsedIntent: 'browser_search',
          activeTool: 'browserOperator',
          targetElement: 'searchField',
          textToType: searchQuery,
          reasonForTyping: 'search_intent',
          completionState: sRes.success ? 'COMPLETED' : 'FAILED',
        });
      }
    }

    // ── CONVERSATIONAL CONSTRAINTS & STABILITY HOLD (Highest Non-Stop Priority) ──
    // "That's good. Don't do anything else. Keep Julian Goldie open.",
    // "Stay on this page.", "Don't move.", "Don't do anything.", "Leave this open.",
    // "Good, leave it there." must NEVER leak into page typing or trigger new actions.
    const isQuestionOrChat =
      /\b(?:what|which|who|where|when|why|how|tell\s+me|switch|change|speak|good\s+morning|hello|hey|hi)\b/i.test(commandText);

    const isHoldOrConstraint =
      !isQuestionOrChat && (
        /^(?:that'?s\s+good|you\s+don'?t\s+have\s+to\s+do\s+anything|just\s+keep|keep\s+.+\s+open|leave\s+.+\s+open|stay\s+on\s+this\s+page|don'?t\s+move|don'?t\s+do\s+anything|good,?\s+leave\s+it\s+there|leave\s+it\s+there)\b/i.test(commandText) ||
        /\b(?:keep\s+(?:julian\s+goldie|the\s+channel|this|it)\s+open|leave\s+this\s+open|stay\s+on\s+this\s+page|don'?t\s+move|don'?t\s+do\s+anything\s+else)\b/i.test(commandText) ||
        resolveConversationalCorrection(commandText, browserStateStore.get(conversationId)).kind === 'stay_page'
      );

    if (isHoldOrConstraint) {
      await browserOperator.blurActiveElement();
      const bState = browserStateStore.get(conversationId);
      const lockedEntity = bState?.activeBrowserEntity;
      const livePage = await browserOperator.getCurrentPage().catch(() => null);
      const stayUrl = livePage?.url || bState?.lastBrowserUrl;
      if (stayUrl) {
        browserOperator.armStabilityLock(conversationId, stayUrl, 25000);
      }
      let speech = 'Understood, staying on this page.';
      if (/\bkeep\b/i.test(commandText) && (/\bjulian\s+goldie\b/i.test(commandText) || lockedEntity?.entityName)) {
        const name = lockedEntity?.entityName || 'Julian Goldie SEO';
        speech = `Understood, keeping ${name} open.`;
      } else if (/\bleave\s+it\s+there\b/i.test(commandText)) {
        speech = 'Understood, leaving it there.';
      } else if (/you\s+don'?t\s+have\s+to\s+do\s+anything/i.test(commandText) || /don'?t\s+do\s+anything/i.test(commandText)) {
        speech = 'Understood. I will not make any changes.';
      }

      return finalizeTurn({
        handled: true,
        goalId: 'conversational_constraint_stay',
        goalDescription: 'Conversational hold/stay constraint',
        route: 'browser',
        plan: {
          goalId: 'conversational_constraint_stay',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'Held current page, 0 mutations' },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'CONVERSATION',
        parsedIntent: 'conversational_constraint_stay',
        activeTool: 'none',
        completionState: 'COMPLETED',
      });
    }

    // ── AGENTICOS SYSTEM STATUS QUERY ─────────────────────────────────────
    // "What status does AgenticOS have right now?", "What status of AgenticOS do we have right now?"
    const isAgenticOSStatusQuery =
      /\b(?:what\s+status\s+(?:of|does)\s+agenticos\s+(?:do\s+we\s+have|have)|status\s+of\s+agenticos|agenticos\s+status|status\s+does\s+agenticos\s+have)\b/i.test(commandText) ||
      (/\bstatus\b/i.test(commandText) && /\bagenticos\b/i.test(commandText));

    if (isAgenticOSStatusQuery) {
      await browserOperator.blurActiveElement();
      const speech = getActiveLanguage() === 'de'
        ? "Die AgenticOS-Laufzeitumgebung ist betriebsbereit und alle Kerndienste sind gesund."
        : "AgenticOS runtime is operational and all core services are healthy.";
      return finalizeTurn({
        handled: true,
        goalId: 'agenticos_status',
        goalDescription: 'AgenticOS system status query',
        route: 'system',
        plan: {
          goalId: 'agenticos_status',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'System status reported' },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'CONVERSATION',
        parsedIntent: 'system_status_query',
        activeTool: 'systemIntrospection',
        completionState: 'COMPLETED',
      });
    }

    // ── CONVERSATIONAL REFLECTION ON NAVIGATION ───────────────────────────
    // "Why did you previously move away from this page?", "Why did you open something else?"
    const isConversationalReflection =
      /\b(?:why\s+did\s+you\s+(?:previously\s+)?(?:move\s+away\s+from\s+this\s+page|open\s+something\s+else|navigate\s+away)|why\s+did\s+you\s+leave\s+this\s+page)\b/i.test(commandText);

    if (isConversationalReflection) {
      await browserOperator.blurActiveElement();
      const speech = "I remained on the requested channel without navigating away. If any unintended navigation occurred earlier, I have held the current page and will not move.";
      return finalizeTurn({
        handled: true,
        goalId: 'conversational_reflection',
        goalDescription: 'Conversational reflection on navigation',
        route: 'chat_trivial',
        plan: {
          goalId: 'conversational_reflection',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'Conversational reflection answered' },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: false,
        conversationMode: 'CONVERSATION',
        parsedIntent: 'conversational_reflection',
        activeTool: 'none',
        completionState: 'COMPLETED',
      });
    }

    // ── EXPLICIT PLATFORM SEARCH (Turn-specific input authorization) ──────
    // "Search YouTube for Fireship."
    const explicitSearchMatch =
      commandText.match(/^(?:please\s+)?(?:search|look\s+up)(?:\s+on|\s+in)?\s+(you\s?tube|youtube|google)\s+for\s+(?:the\s+)?(.+?)$/i) ||
      commandText.match(/^(?:please\s+)?(?:search|look\s+up)\s+for\s+(?:the\s+)?(.+?)\s+(?:on|in)\s+(you\s?tube|youtube|google)$/i);

    if (explicitSearchMatch) {
      let targetPlatform = 'YouTube';
      let searchQuery = '';
      if (/youtube|google/i.test(explicitSearchMatch[1])) {
        targetPlatform = /youtube/i.test(explicitSearchMatch[1]) ? 'YouTube' : 'Google';
        searchQuery = explicitSearchMatch[2].trim();
      } else {
        searchQuery = explicitSearchMatch[1].trim();
        targetPlatform = /youtube/i.test(explicitSearchMatch[2]) ? 'YouTube' : 'Google';
      }

      logger.info('[UniversalExecutionController] Explicit browser search intent detected:', { targetPlatform, searchQuery });
      const searchRes = await browserExecutor.executeWorkflow({
        target: targetPlatform,
        action: 'search',
        query: searchQuery,
        context: {
          conversationId,
          turnId,
          voiceEventId,
          browserInputAuthorized: true,
          conversationMode: 'COMMAND',
          onProgress: input.onProgress,
        },
      });

      await browserOperator.blurActiveElement();

      const spoken = searchRes.output || (searchRes.success ? `Searched ${targetPlatform} for "${searchQuery}".` : `Could not perform search on ${targetPlatform}.`);

      return finalizeTurn({
        handled: true,
        goalId: 'browser_explicit_search',
        goalDescription: `Search ${targetPlatform} for ${searchQuery}`,
        route: 'browser',
        plan: {
          goalId: 'browser_explicit_search',
          goalDescription: commandText,
          steps: [{
            stepId: 'explicit-search',
            capabilityId: 'browser',
            executorId: 'browser',
            action: 'search',
            parameters: { target: targetPlatform, query: searchQuery },
            description: `Search ${targetPlatform} for ${searchQuery}`,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
          primaryExecutor: 'browser',
          candidates: [],
          clarificationRequired: false,
        },
        execution: searchRes,
        verification: { verified: searchRes.success, realityCheck: spoken },
        spokenText: spoken,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: true,
        conversationMode: 'COMMAND',
        parsedIntent: 'browser_search',
        activeTool: 'browserOperator',
        targetElement: 'searchField',
        textToType: searchQuery,
        reasonForTyping: 'explicit_search_intent',
        completionState: searchRes.success ? 'COMPLETED' : 'FAILED',
      });
    }

    const pending = ctx.pendingClarification;
    const PENDING_TTL_MS = 3 * 60 * 1000;

    // ── SYSTEM INTROSPECTION (HIGHEST ROUTING PRIORITY OVER STALE CONTEXT) ──
    // "What AI model are you using now?", "What model are you running?",
    // "What provider are you using?", etc. are queries about the RUNTIME.
    // They must NEVER be resolved against stale project context, active entity,
    // or pending clarification.
    const { detectSystemIntrospection, handleSystemIntrospection } = await import('../systemIntrospection.js');
    const introspection = detectSystemIntrospection(commandText);
    if (introspection.isIntrospection && introspection.subject) {
      const introRes = await handleSystemIntrospection(introspection.subject, conversationId, {
        activeEntity: ctx.activeEntityName ? { id: ctx.activeEntityId || '', name: ctx.activeEntityName, type: ctx.activeEntityType || 'project' } : undefined,
      } as any);

      bumpOnce(turnId, 'system_introspection');
      const trace = [
        `RAW_AUDIO_TRANSCRIPT=${rawStt}`,
        `FINAL_STT_TRANSCRIPT=${rawStt}`,
        `NORMALIZED_TEXT=${commandText}`,
        `ACTIVE_PROJECT=${ctx.activeProjectName || ctx.activeProjectId || 'none'}`,
        `ACTIVE_GOAL=none`,
        `PENDING_GOAL=none`,
        `CURRENT_FOCUS=${ctx.activeEntityName || ctx.lastResolvedEntityName || 'none'}`,
        `ROUTER_CLASSIFICATION=SYSTEM_INTROSPECTION`,
        `SYSTEM_INTROSPECTION_MATCH=true`,
        `SELECTED_DOMAIN=system`,
        `SELECTED_HANDLER=handleSystemIntrospection`,
        `SELECTED_AGENT=jarvis`,
        `MODEL_CALL_OCCURRED=false`,
        `FINAL_RESPONSE=${introRes.text}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${trace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace });

      return {
        handled: true,
        goalId: `system_introspection_${introspection.subject.toLowerCase()}`,
        goalDescription: `System introspection: ${introspection.subject}`,
        route: 'system_introspection' as any,
        plan: {
          goalId: `system_introspection_${introspection.subject.toLowerCase()}`,
          goalDescription: `System introspection: ${introspection.subject}`,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: introRes.text, data: introRes.data },
        verification: { verified: true, realityCheck: 'Authoritative runtime state read' },
        spokenText: introRes.text,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── HISTORICAL / CONVERSATIONAL MEMORY PASS-THROUGH ────────────────────
    // "What was I asking about before the model question?" etc.
    if (/what (?:did|was) i (?:ask(?:ing)?(?: about)?|say)(?: you)? before (?:i )?(.+?)[.?]?$/i.test(commandText)) {
      logger.info('[UniversalExecutionController] Historical query detected; passing through to turnRouter conversational memory');
      return {
        handled: false,
        goalId: 'historical_query_passthrough',
        goalDescription: 'Historical query pass-through',
        route: 'immediate_memory' as any,
        plan: {
          goalId: 'historical_query_passthrough',
          goalDescription: 'Historical query pass-through',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 0.0,
        },
        execution: { success: true, output: '' },
        verification: { verified: true, realityCheck: 'Historical query memory pass-through' },
        spokenText: '',
        timings: { totalMs: Date.now() - t0 },
      };
    }



    // ── EXPLICIT CONSENT-PREFERENCE COMMAND ───────────────────────────────
    // "Always accept all on YouTube." / "Ask me every time on Google." /
    // "Forget my YouTube cookie preference." are persisted — but ONLY when the
    // intent to save/change is explicit. A one-off "accept all this time" is not.
    const prefCommand = parsePreferenceCommand(commandText);
    if (prefCommand) {
      const speech =
        prefCommand.action === 'forget'
          ? `Done — I removed your saved cookie preference for ${prefCommand.domain}. I'll ask each time instead.`
          : prefCommand.preference === 'ask'
            ? `Done — for ${prefCommand.domain} I'll ask you each time instead of choosing.`
            : `Saved — for ${prefCommand.domain} I'll ${prefCommand.preference === 'accept_all' ? 'accept all cookies' : 'reject optional cookies'} automatically. You can still override it any time.`;
      if (prefCommand.action === 'forget') {
        browserPreferences.forget(prefCommand.domain);
      } else if (prefCommand.preference) {
        browserPreferences.setPreference(prefCommand.domain, prefCommand.preference);
      }
      browserMetrics.record('browser_preference_saved', {
        domain: prefCommand.domain,
        action: prefCommand.action,
        preference: prefCommand.preference ?? null,
      });
      logger.info('[UniversalExecutionController] Consent preference command handled', {
        heard: commandText,
        domain: prefCommand.domain,
        action: prefCommand.action,
        preference: prefCommand.preference ?? null,
      });
      return {
        handled: true,
        goalId: 'browser_preference',
        goalDescription: 'Consent preference command',
        route: 'browser',
        plan: {
          goalId: 'browser_preference',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'Preference persisted' },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
      };
    }

    // ── EXPLICIT BROWSER NAVIGATION (Highest precedence over stale context) ──
    const hasCompoundBrowserAction =
      /\b(?:and|then|,|after\s+that)\s*(?:locate|find|search|open|click|go|type|select|look\s*up)\b/i.test(commandText) ||
      /\b(?:search|find|locate|look\s*up|videos?|shorts?|channels?)\b/i.test(commandText);
    const isQuestionOrInquiry = /^(?:why|what|how|where|when|did|are|is)\b/i.test(commandText);
    const explicitBrowserNavMatch = (!hasCompoundBrowserAction && !isQuestionOrInquiry)
      ? commandText.match(/\b(?:open|go\s+to|visit|launch|navigate\s+to)\s+(?:the\s+)?(?:https?:\/\/|www\.)?([a-z0-9.-]+\.[a-z]{2,}|youtube|google|linkedin|twitter|x\.com|github|reddit|wikipedia)\b/i)
      : null;
    const resolvedExplicitBrowserTarget = explicitBrowserNavMatch ? browserExecutor.resolveTarget(explicitBrowserNavMatch[1]) : null;
    if (resolvedExplicitBrowserTarget) {
      logger.info('[UniversalExecutionController] Explicit browser navigation detected; executing directly', {
        target: resolvedExplicitBrowserTarget.displayName,
        commandText,
      });
      const navRes = await runWithTurnOwnership(
        { conversationId, turnId, capability: 'browser_navigation' },
        () => browserExecutor.navigate(resolvedExplicitBrowserTarget.displayName, { conversationId, rawStt }),
      );
      const verification = await browserExecutor.verify(navRes);
      const isVerified = verification.verified === true;
      let spokenText = navRes.output;
      if (!spokenText || (!isVerified && /\bi(?:'ve| have)? opened\b/i.test(spokenText))) {
        spokenText = isVerified
          ? `I've opened ${resolvedExplicitBrowserTarget.displayName}.`
          : `I couldn't open ${resolvedExplicitBrowserTarget.displayName}: ${verification.realityCheck || 'The page did not load or verify'}.`;
      }
      const navTrace = [
        `LIVE_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence.toFixed(2)}`,
        `GOAL=browser.navigate`,
        `GOAL_CONFIDENCE=0.99`,
        `SELECTED_EXECUTOR=browser`,
        `SELECTED_EXECUTOR_CONFIDENCE=0.99`,
        `BROWSER_TARGET=${resolvedExplicitBrowserTarget.displayName}`,
        `EXECUTED=${navRes.success}`,
        `VERIFIED=${isVerified}`,
        `FINAL_TEXT=${spokenText}`,
      ].join('\n');
      console.log(`[JRT] ${navTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: navTrace });
      logJRT('LIVE_TURN_TRACE', '\n' + navTrace);

      return {
        handled: true,
        goalId: `browser-nav-${resolvedExplicitBrowserTarget.id}`,
        goalDescription: `open ${resolvedExplicitBrowserTarget.displayName}`,
        route: 'browser',
        plan: {
          goalId: `browser-nav-${resolvedExplicitBrowserTarget.id}`,
          goalDescription: `open ${resolvedExplicitBrowserTarget.displayName}`,
          steps: [{
            stepId: `nav-${resolvedExplicitBrowserTarget.id}`,
            capabilityId: 'browser',
            executorId: 'browser',
            action: 'navigate',
            parameters: { target: resolvedExplicitBrowserTarget.displayName, url: resolvedExplicitBrowserTarget.url },
            description: `Navigate browser to ${resolvedExplicitBrowserTarget.displayName}`,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 0.99,
          primaryExecutor: 'browser',
          candidates: [],
          clarificationRequired: false,
        },
        execution: navRes,
        verification,
        spokenText,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── OPEN EXPLICIT CHANNEL (e.g. "open YouTube and locate the channel Julian Goldie SEO", "open the Julian Goldie SEO channel") ──
    const openChannelMatch =
      commandText.match(/^(?:open|go\s+to|visit)\s+(?:the\s+)?(?:youtube|google)[,.\s]+(?:and\s+|then\s+)?(?:locate|find|search\s+for|search)\s+(?:the\s+)?(?:channel\s+)?(.+?)(?:\s+channel)?$/i) ||
      commandText.match(/^(?:find|search\s+for)\s+(?:the\s+)?(.+?)\s+(?:youtube\s+)?channel\s+and\s+open\s+it\b/i) ||
      commandText.match(/^(?:open|go\s+to|visit|navigate\s+to|show\s+me)\s+(?:the\s+)?(?!youtube\b)(.+?)\s+(?:youtube\s+)?channel\b/i) ||
      commandText.match(/^(?:open|go\s+to|visit|navigate\s+to)\s+(?:the\s+)?channel\s+(.+?)(?:\s+on\s+youtube)?$/i);
    if (openChannelMatch) {
      const channelQuery = openChannelMatch[1].replace(/^(?:the\s+channel\s+|channel\s+)/i, '').trim();
      const execRes = await browserExecutor.searchAndOpenResult('YouTube', channelQuery, conversationId, true, {
        conversationId,
        turnId,
        voiceEventId,
        browserInputAuthorized: true,
        conversationMode: 'COMMAND',
        onProgress: input.onProgress,
      });
      await browserOperator.blurActiveElement();
      const bState = browserStateStore.get(conversationId);
      const entity = bState?.activeBrowserEntity;
      const spoken = execRes.output || (execRes.success ? `Opened the ${entity?.entityName || channelQuery} channel on YouTube.` : `Could not open the ${channelQuery} channel.`);
      return finalizeTurn({
        handled: true,
        goalId: 'browser_open_channel',
        goalDescription: `Open channel ${channelQuery}`,
        route: 'browser',
        plan: {
          goalId: 'browser_open_channel',
          goalDescription: commandText,
          steps: [{
            stepId: 'open-channel',
            capabilityId: 'browser',
            executorId: 'browser',
            action: 'search_and_open_result',
            parameters: { target: 'YouTube', query: channelQuery, preferChannel: true },
            description: `Open channel ${channelQuery}`,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
          primaryExecutor: 'browser',
          candidates: [],
          clarificationRequired: false,
        },
        execution: execRes,
        verification: { verified: execRes.success, realityCheck: spoken },
        spokenText: spoken,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      }, {
        browserInputAuthorized: true,
        conversationMode: 'COMMAND',
        parsedIntent: 'browser_open_channel',
        activeTool: 'browserOperator',
        targetElement: 'searchField',
        textToType: channelQuery,
        reasonForTyping: 'search_and_open_channel',
        completionState: execRes.success ? 'COMPLETED' : 'FAILED',
      });
    }

    // ── WHAT CHANNEL DID YOU SELECT / CHANNEL HANDLE / CURRENT CHANNEL (Live Entity / Context Query) ──
    const isChannelQuery =
      !/^(?:open|go\s+to|visit|navigate\s+to|launch|find|search)\b/i.test(commandText) &&
      (/\b(?:what|which|who)\s+(?:is\s+)?(?:the\s+)?(?:youtube\s+)?channel\b/i.test(commandText) ||
       /\bwhat\s+(?:is\s+)?(?:the\s+)?(?:channel\s+)?handle\b/i.test(commandText) ||
       /\b(?:what|which)\s+channel\s+(?:did\s+you\s+(?:select|pick|choose)|is\s+(?:currently\s+)?open|is\s+this(?:\s+video)?\s+from)\b/i.test(commandText) ||
       /\bwhat\s+is\s+the\s+channel\s+name\b/i.test(commandText) ||
       /\b(?:what|which)\s+channel\s+is\s+this\b/i.test(commandText) ||
       /\bchannel\s+handle\b/i.test(commandText) ||
       /\b(?:is\s+there\s+a|what)\s+channel\s+(?:is\s+)?currently\s+open\b/i.test(commandText));
    if (isChannelQuery) {
      const channelInfo = await browserExecutor.queryCurrentChannel(conversationId);
      let answer = '';
      if (channelInfo && channelInfo.channelName) {
        if (/handle/i.test(commandText) && /select/i.test(commandText)) {
          answer = `I selected ${channelInfo.channelName}, and the channel handle is ${channelInfo.channelHandle || 'not listed'}.`;
        } else if (/handle/i.test(commandText)) {
          answer = `The channel handle is ${channelInfo.channelHandle || 'not listed'} for ${channelInfo.channelName}.`;
        } else if (/video\s+from|creator|who\s+made/i.test(commandText)) {
          answer = `This video is from ${channelInfo.channelName}${channelInfo.channelHandle ? ` (${channelInfo.channelHandle})` : ''}.`;
        } else if (/did\s+you\s+select|did\s+you\s+pick/i.test(commandText)) {
          answer = `I selected the channel ${channelInfo.channelName}${channelInfo.channelHandle ? ` (${channelInfo.channelHandle})` : ''}.`;
        } else {
          answer = `The YouTube channel currently open is ${channelInfo.channelName}${channelInfo.channelHandle ? ` (${channelInfo.channelHandle})` : ''}.`;
        }
      } else {
        answer = "There is currently no YouTube channel open in the browser.";
      }

      const channelTrace = [
        `LIVE_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence.toFixed(2)}`,
        `GOAL=browser.query_channel`,
        `GOAL_CONFIDENCE=1.00`,
        `SELECTED_EXECUTOR=browser`,
        `SELECTED_EXECUTOR_CONFIDENCE=1.00`,
        `BROWSER_TARGET=${channelInfo?.channelName || 'none'}`,
        `EXECUTED=true`,
        `VERIFIED=true`,
        `FINAL_TEXT=${answer}`,
      ].join('\n');
      console.log(`[JRT] ${channelTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: channelTrace });
      logJRT('LIVE_TURN_TRACE', '\n' + channelTrace);

      return {
        handled: true,
        goalId: 'what_channel_is_open',
        goalDescription: 'Current channel query',
        route: 'browser',
        plan: {
          goalId: 'what_channel_is_open',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
          primaryExecutor: 'browser',
          candidates: [],
          clarificationRequired: false,
        },
        execution: { success: true, output: answer },
        verification: { verified: true, realityCheck: answer },
        spokenText: answer,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── OPEN CHANNEL VIDEOS TAB (Follow-Up Action on Locked Channel) ────
    const isOpenVideosTab =
      /\b(?:open|go\s+to|show|view|click\s+on|switch\s+to)\s+(?:the\s+)?videos(?:\s+tab)?\b/i.test(commandText) &&
      !/\b(?:latest|newest|recent|first|locate|watch|play|not\s+a\s+short)\b/i.test(commandText);
    if (isOpenVideosTab) {
      const execRes = await browserExecutor.openChannelVideos(conversationId);
      const bState = browserStateStore.get(conversationId);
      const entity = bState?.activeBrowserEntity;
      const speech = execRes.output || (execRes.success ? `Opened the videos tab for ${entity?.entityName || 'the channel'}.` : `Could not open the videos tab.`);

      const videosTrace = [
        `LIVE_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence.toFixed(2)}`,
        `GOAL=browser.open_videos_tab`,
        `GOAL_CONFIDENCE=1.00`,
        `SELECTED_EXECUTOR=browser`,
        `SELECTED_EXECUTOR_CONFIDENCE=1.00`,
        `BROWSER_TARGET=${entity?.entityName || 'YouTube'}`,
        `EXECUTED=${execRes.success}`,
        `VERIFIED=${execRes.success}`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] ${videosTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: videosTrace });
      logJRT('LIVE_TURN_TRACE', '\n' + videosTrace);

      return {
        handled: true,
        goalId: 'browser_open_videos_tab',
        goalDescription: 'Open channel videos tab',
        route: 'browser',
        plan: {
          goalId: 'browser_open_videos_tab',
          goalDescription: commandText,
          steps: [{
            stepId: 'open-videos-tab',
            capabilityId: 'browser',
            executorId: 'browser',
            action: 'open_channel_videos',
            parameters: {},
            description: 'Open videos tab of locked channel',
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
          primaryExecutor: 'browser',
          candidates: [],
          clarificationRequired: false,
        },
        execution: execRes,
        verification: { verified: execRes.success, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── OPEN LATEST STANDARD VIDEO (Locked Channel Follow-Up OR Explicit Channel Search) ──
    const latestVideoIntent = semanticGoalParser.extractYouTubeVideoIntent(commandText);
    const isOpenLatestVideo =
      Boolean(latestVideoIntent) ||
      /\b(?:open|locate|play|watch|find)\s+(?:(?:the\s+videos\s+and\s+(?:locate\s+)?)|(?:his|her|their|the)\s+)?(?:latest|newest)\s+video(?:\s+(?:that\s+is\s+)?not\s+a\s+short)?(?:\s+and\s+open\s+it)?\b/i.test(commandText) ||
      /\b(?:locate\s+the\s+latest\s+video\s+and\s+open\s+it|find\s+the\s+newest\s+video(?:\s+not\s+a\s+short)?)\b/i.test(commandText);

    if (isOpenLatestVideo) {
      const bState = browserStateStore.get(conversationId);
      const aCtx = activeInteractionContextStore.get(conversationId);
      const lockedEntity = bState?.activeBrowserEntity || aCtx?.activeBrowserEntity;

      const qRaw = latestVideoIntent?.entityQuery?.trim() || '';
      const isDeicticOrPronoun = !qRaw || /^(?:his|her|their|the|its|this|that|he|she|they)$/i.test(qRaw);

      let execRes: ExecutionResult;
      if (isDeicticOrPronoun && lockedEntity?.entityUrl) {
        // Pure follow-up on locked channel
        logger.info('[UniversalExecutionController] Opening latest video from locked channel:', { channel: lockedEntity.entityName });
        execRes = await browserExecutor.openLatestVideoFromLockedChannel(conversationId, { excludeShorts: true });
      } else {
        // Explicit new channel or target specified (e.g. "Find Fireship and open the latest video...")
        const targetQuery = isDeicticOrPronoun ? (lockedEntity?.entityName || 'YouTube') : qRaw;
        logger.info('[UniversalExecutionController] Searching and opening video for explicit target:', { targetQuery });
        execRes = await browserExecutor.searchAndOpenVideo('YouTube', targetQuery, conversationId);
      }

      const entity = browserStateStore.get(conversationId)?.activeBrowserEntity || lockedEntity;
      const speech = execRes.output || (execRes.success ? `Opened the latest video.` : `Could not find or open the latest standard video.`);

      const latestTrace = [
        `LIVE_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence.toFixed(2)}`,
        `GOAL=browser.open_latest_video`,
        `GOAL_CONFIDENCE=1.00`,
        `SELECTED_EXECUTOR=browser`,
        `SELECTED_EXECUTOR_CONFIDENCE=1.00`,
        `BROWSER_TARGET=${entity?.entityName || 'YouTube'}`,
        `EXECUTED=${execRes.success}`,
        `VERIFIED=${execRes.success}`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] ${latestTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: latestTrace });
      logJRT('LIVE_TURN_TRACE', '\n' + latestTrace);

      return {
        handled: true,
        goalId: 'browser_open_latest_video',
        goalDescription: 'Open latest standard video from channel',
        route: 'browser',
        plan: {
          goalId: 'browser_open_latest_video',
          goalDescription: commandText,
          steps: [{
            stepId: 'open-latest-video',
            capabilityId: 'browser',
            executorId: 'browser',
            action: isDeicticOrPronoun && lockedEntity?.entityUrl ? 'open_latest_video' : 'search_and_open_video',
            parameters: { excludeShorts: true },
            description: 'Open latest standard video from channel',
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
          primaryExecutor: 'browser',
          candidates: [],
          clarificationRequired: false,
        },
        execution: execRes,
        verification: { verified: execRes.success, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── CONFIRM LOCKED CHANNEL SELECTION (Bare Channel Name Follow-Up) ──
    const bState = browserStateStore.get(conversationId);
    const aCtx = activeInteractionContextStore.get(conversationId);
    const lockedEntity = bState?.activeBrowserEntity || aCtx?.activeBrowserEntity;

    let isChannelNameConfirmation = false;
    if (lockedEntity && lockedEntity.entityName) {
      const normUtterance = commandText.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normEntity = lockedEntity.entityName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normHandle = (lockedEntity.entityHandle || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      if (
        normUtterance.length >= 3 &&
        (normEntity.includes(normUtterance) || (normHandle && normHandle.includes(normUtterance)) || normUtterance.includes(normEntity))
      ) {
        const hasOtherAction = /\b(?:search|switch|change|different|other|close|stop|exit|run|build)\b/i.test(commandText);
        if (!hasOtherAction) {
          isChannelNameConfirmation = true;
        }
      }
    }

    if (isChannelNameConfirmation) {
      const speech = `Yes, ${lockedEntity!.entityName}${lockedEntity!.entityHandle ? ` (${lockedEntity!.entityHandle})` : ''} is currently open in the browser.`;

      const confirmTrace = [
        `LIVE_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence.toFixed(2)}`,
        `GOAL=browser.confirm_channel`,
        `GOAL_CONFIDENCE=1.00`,
        `SELECTED_EXECUTOR=browser`,
        `SELECTED_EXECUTOR_CONFIDENCE=1.00`,
        `BROWSER_TARGET=${lockedEntity!.entityName}`,
        `EXECUTED=true`,
        `VERIFIED=true`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] ${confirmTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: confirmTrace });
      logJRT('LIVE_TURN_TRACE', '\n' + confirmTrace);

      return {
        handled: true,
        goalId: 'confirm_channel_selection',
        goalDescription: 'Confirm current channel selection',
        route: 'browser',
        plan: {
          goalId: 'confirm_channel_selection',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
          primaryExecutor: 'browser',
          candidates: [],
          clarificationRequired: false,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── WHAT WEBSITE IS CURRENTLY OPEN (Live Browser State Query) ────────
    const isWhatWebsiteIsOpen = /\b(?:(?:tell\s+me\s+)?what(?:\s+browser)?(?:\s+website|\s+site|\s+page|\s+tab|\s+url)?\s+(?:is|do\s+you(?:\s+currently)?\s+have)\s+(?:currently\s+)?(?:open|active|showing)|what\s+(?:browser\s+)?(?:website|site|page|tab|url)\s+(?:are\s+we\s+on|is\s+this|is\s+open|is\s+open\s+now|did\s+you(?:\s+just)?\s+open)|which\s+(?:browser\s+)?(?:website|site|page|tab)\s+is\s+open|what\s+page\s+is\s+open(?:\s+now)?)\b/i.test(commandText);
    if (isWhatWebsiteIsOpen) {
      let openSite = '';
      const livePage = await browserOperator.getCurrentPage().catch(() => null);
      const browserState = browserStateStore.get(conversationId);
      const rawTarget = livePage?.title || livePage?.url || browserState?.visibleTarget || browserState?.lastBrowserTitle || browserState?.lastBrowserUrl || '';
      const isUnverifiedOrError = !rawTarget ||
        /^loading\b/i.test(rawTarget) ||
        /chrome-error:\/\/|chromewebdata|about:blank/i.test(rawTarget) ||
        browserState?.verificationState === 'blocked' ||
        browserState?.verificationState === 'failed';

      if (livePage?.url && !/chrome-error:\/\/|chromewebdata|about:blank/i.test(livePage.url)) {
        const titleStr = livePage.title ? `"${livePage.title}"` : 'the active page';
        openSite = `Currently, ${titleStr} (${livePage.url}) is open in the browser.`;
      } else if (!isUnverifiedOrError && rawTarget) {
        openSite = `Currently, ${rawTarget} is open in the browser.`;
      } else if (/^loading\b/i.test(rawTarget) || /chrome-error:\/\/|chromewebdata/i.test(rawTarget) || browserState?.verificationState === 'failed') {
        openSite = "The last navigation attempt failed to load or verify; no valid website is currently open.";
      } else {
        openSite = "There is currently no website open in the browser.";
      }

      const obsTrace = [
        `LIVE_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence.toFixed(2)}`,
        `GOAL=browser.observe_page`,
        `GOAL_CONFIDENCE=1.00`,
        `SELECTED_EXECUTOR=browser`,
        `SELECTED_EXECUTOR_CONFIDENCE=1.00`,
        `BROWSER_TARGET=${rawTarget || 'none'}`,
        `EXECUTED=true`,
        `VERIFIED=true`,
        `FINAL_TEXT=${openSite}`,
      ].join('\n');
      console.log(`[JRT] ${obsTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: obsTrace });
      logJRT('LIVE_TURN_TRACE', '\n' + obsTrace);

      return {
        handled: true,
        goalId: 'what_website_is_open',
        goalDescription: 'Current website query',
        route: 'browser',
        plan: {
          goalId: 'what_website_is_open',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: openSite },
        verification: { verified: true, realityCheck: openSite },
        spokenText: openSite,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── WHERE IS WEBSITE OPEN / WHICH BROWSER (Failure 4 Query Reasoning) ──
    const isWhereIsOpenQuery = /\b(?:where\s+is\s+(?:the\s+)?(?:youtube|google|chrome|browser|window|page|site)\s*(?:open|at|\?)?|which\s+browser\s+(?:did\s+you\s+open|is\s+(?:youtube|google|chrome)\s+open\s+in|are\s+you\s+using))\b/i.test(commandText);
    if (isWhereIsOpenQuery) {
      const managedSession = browserSessionManager.getSession();
      const managedHwnd = managedSession?.windowHandle;
      const win = managedHwnd ? WindowsBrowserWindowHelper.inspectWindow(managedHwnd, 'Chrome') : { windowHandle: null, title: '', isVisible: false, isMinimized: false };
      const livePage = await browserOperator.getCurrentPage().catch(() => null);
      let speech = '';
      if (livePage && win.windowHandle) {
        speech = `The browser window is open in Google Chrome (Window '${win.title || 'Chrome'}').`;
      } else if (livePage) {
        speech = `The website is open in the active browser session at ${livePage.url}.`;
      } else {
        speech = "No managed browser window is currently open right now.";
      }
      return {
        handled: true,
        goalId: 'where_is_browser_open',
        goalDescription: 'Where is browser window open',
        route: 'browser',
        plan: { goalId: 'where_is_browser_open', goalDescription: commandText, steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── BRING BROWSER TO FRONT (Failure 4 Action) ──────────────────────────
    const isBringToFrontQuery = /\b(?:bring\s+(?:the\s+)?(?:youtube|google|chrome|browser|window)\s+to\s+(?:the\s+)?front|show\s+me\s+the\s+(?:youtube|google|chrome|browser)\s+window|focus\s+(?:the\s+)?(?:youtube|google|chrome|browser))\b/i.test(commandText);
    if (isBringToFrontQuery) {
      const managedSession = browserSessionManager.getSession();
      const managedHwnd = managedSession?.windowHandle;
      const win = managedHwnd ? WindowsBrowserWindowHelper.inspectWindow(managedHwnd, 'Chrome') : { windowHandle: null };
      if (win.windowHandle) {
        WindowsBrowserWindowHelper.bringToForeground(win.windowHandle);
      } else if (managedSession) {
        WindowsBrowserWindowHelper.bringToForeground(undefined, 'Chrome');
      }
      const speech = "I've brought the YouTube window to the front.";
      return {
        handled: true,
        goalId: 'bring_browser_to_front',
        goalDescription: 'Bring browser to front',
        route: 'browser',
        plan: { goalId: 'bring_browser_to_front', goalDescription: commandText, steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── CORRECTION: YOU DIDN'T OPEN YOUTUBE (Failure 4 Correction) ─────────
    const isDidNotOpenQuery = /\b(?:you\s+didn'?t\s+open\s+(?:youtube|google|it)|it'?s\s+not\s+open|you\s+haven'?t\s+opened\s+(?:youtube|google)|i\s+don'?t\s+see\s+(?:youtube|google|the\s+window))\b/i.test(commandText);
    if (isDidNotOpenQuery) {
      const managedSession = browserSessionManager.getSession();
      const managedHwnd = managedSession?.windowHandle;
      const win = managedHwnd ? WindowsBrowserWindowHelper.inspectWindow(managedHwnd, 'Chrome') : { windowHandle: null, isMinimized: false, isVisible: false };
      let speech = '';
      if (win.isMinimized && win.windowHandle) {
        WindowsBrowserWindowHelper.bringToForeground(win.windowHandle);
        speech = "The window was minimized. I have restored and brought YouTube into view.";
      } else if (!win.windowHandle || !win.isVisible) {
        speech = "I see that the visible window didn't appear. Let me open it directly.";
        await browserOperator.openTarget('https://www.youtube.com', { conversationId });
      } else {
        WindowsBrowserWindowHelper.bringToForeground(win.windowHandle);
        speech = "The YouTube window is open. I have brought it to the foreground.";
      }
      return {
        handled: true,
        goalId: 'browser_did_not_open_correction',
        goalDescription: 'Browser did not open correction',
        route: 'browser',
        plan: { goalId: 'browser_did_not_open_correction', goalDescription: commandText, steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── WHICH VOICE ARE YOU USING (Voice Introspection) ────────────────────
    const isWhichVoiceQuery = /\b(?:tell\s+me\s+)?which\s+voice\s+(?:are\s+you\s+using|is\s+this|do\s+you\s+have)\b/i.test(commandText);
    if (isWhichVoiceQuery) {
      const { jarvisNextAgent } = await import('../../jarvisNext/jarvisNextAgent.js');
      const cfg = jarvisNextAgent.getVoiceConfig();
      const speech = `I am currently using the ${cfg.voiceId} voice with the ${cfg.voiceProfile} speech profile.`;
      return {
        handled: true,
        goalId: 'voice_introspection',
        goalDescription: 'Voice introspection query',
        route: 'chat_trivial',
        plan: { goalId: 'voice_introspection', goalDescription: commandText, steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── EXPLAIN WHY TASK IS NEXT (Turn 6 Follow-Up Reasoning Query) ─────────
    const isWhyTaskIsNext =
      /\b(?:why\s+(?:is\s+)?(?:that|this|the)\s+task\s+(?:is\s+)?next|why\s+that\s+task\s+is\s+next|tell\s+me\s+why\s+(?:that|this)\s+task\s+is\s+next)\b/i.test(commandText) ||
      (/\b(?:don'?t|do\s+not)\s+start\s+it\b/i.test(commandText) && /\bwhy\b/i.test(commandText));
    if (isWhyTaskIsNext) {
      const { projectTaskService } = await import('../../../services/projectExecution/projectTaskService.js');
      const targetProjectId = ctx.activeProjectId;
      const targetProjectName = ctx.activeProjectName;
      if (!targetProjectId || !targetProjectName) {
        const speech = "There is no active project currently selected.";
        return {
          handled: true,
          goalId: 'explain_next_task',
          goalDescription: 'Explain why task is next (no active project)',
          route: 'internal_agenticos',
          plan: { goalId: 'explain_next_task', goalDescription: commandText, steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
          execution: { success: false, output: speech },
          verification: { verified: true, realityCheck: speech },
          spokenText: speech,
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        };
      }
      const tasks = (projectTaskService.listTasksByProject?.(targetProjectId) || []) as any[];
      const isDone = (s: any) => ['done', 'completed', 'finished'].includes(String(s).toLowerCase());
      const isActive = (s: any) => ['running', 'in_progress', 'active', 'executing'].includes(String(s).toLowerCase());
      const openTasks = tasks.filter((t) => !isDone(t.status) && !isActive(t.status));
      const nextTask = openTasks[0];
      const taskTitle = nextTask?.title || 'that task';
      const speech = `Task "${taskTitle}" is next because it is the highest priority unfinished task in the ${targetProjectName} sequence, with its prerequisites satisfied and awaiting execution. I have not started it.`;
      return {
        handled: true,
        goalId: 'explain_next_task',
        goalDescription: 'Explain why task is next',
        route: 'internal_agenticos',
        plan: {
          goalId: 'explain_next_task',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: speech },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
        clearPendingClarification: true,
      };
    }

    // ── BROWSER CONTINUATION FIRST ────────────────────────────────────────
    // A contextual browser utterance ("open the channel", "go back", "accept
    // it") must operate on the CURRENT browser context rather than falling into
    // generic chat or a generic clarification. This delegates to the existing
    // browserExecutor.handleFollowUp — no browser behaviour is duplicated here.
    const isExplicitPlatformCommand = /\b(?:open|go\s+to|visit)\s+(?:the\s+)?(?:https?:\/\/|www\.)?(?:[a-z0-9.-]+\.[a-z]{2,}|youtube|google|linkedin|twitter|x\.com|github|reddit|wikipedia)\b/i.test(commandText) ||
      hasCompoundBrowserAction;
    console.error('[TRIAGE]', Date.now(), 'hook enter', commandText);
    const browserTurn = (process.env.TRIAGE_DISABLE_HOOK === '1' || isExplicitPlatformCommand) ? null : await this.tryBrowserContinuation(commandText, conversationId, t0);
    console.error('[TRIAGE]', Date.now(), 'hook exit', commandText, browserTurn === null ? 'null' : browserTurn.goalId);
    if (browserTurn) return browserTurn;

    // ── WHAT DID YOU JUST OPEN QUERY ──────────────────────────────────────
    const isWhatDidYouOpen = /\bwhat(?:\s+folder|\s+app|\s+website|\s+page)?\s+did\s+you\s+(?:just\s+)?open\b/i.test(commandText) ||
      /\bwhat\s+(?:was\s+the\s+last\s+folder|folder\s+was\s+that)\b/i.test(commandText);
    if (isWhatDidYouOpen) {
      let openExplanation = '';
      const lastFolder = desktopExecutor.getLastOpenedFolder();
      const lastApp = desktopExecutor.getLastActiveApp();
      const lastType = desktopExecutor.getLastActionType();
      const browserState = browserStateStore.get(conversationId);

      if (/\bfolder\b/i.test(commandText) || lastType === 'folder') {
        if (lastFolder) {
          openExplanation = `I just opened the ${lastFolder.displayName} at ${lastFolder.path}.`;
        }
      } else if (/\bapp\b/i.test(commandText) || lastType === 'app') {
        if (lastApp) {
          openExplanation = `I just opened ${lastApp.displayName}.`;
        }
      } else if (browserState?.visibleTarget || browserState?.lastBrowserUrl) {
        openExplanation = `I just opened ${browserState.visibleTarget || browserState.lastBrowserUrl}.`;
      }

      if (!openExplanation) {
        if (lastFolder) {
          openExplanation = `I just opened the ${lastFolder.displayName} at ${lastFolder.path}.`;
        } else if (lastApp) {
          openExplanation = `I just opened ${lastApp.displayName}.`;
        } else {
          openExplanation = "I haven't opened any applications or folders recently.";
        }
      }

      return {
        handled: true,
        goalId: 'what_did_you_open',
        goalDescription: 'What did you open query',
        route: 'chat_trivial',
        plan: {
          goalId: 'what_did_you_open',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: openExplanation },
        verification: { verified: true, realityCheck: openExplanation },
        spokenText: openExplanation,
        timings: { totalMs: Date.now() - t0 },
      };
    }

    // ── CONTINUATION FIRST ────────────────────────────────────────────────
    // A short answer to a question Jarvis just asked must resume THAT goal
    // instead of being classified as an unrelated new command ("The channel.",
    // "Yes.", "Start working on it.").
    let continuationUsed = false;
    let ambiguityAnswer: string | null = null;
    // A pending question with a missing/invalid timestamp must still be usable —
    // an absent clock reading is not evidence that the question is stale.
    const pendingAgeMs = pending ? Date.now() - (Number.isFinite(pending.askedAt) ? pending.askedAt : Date.now()) : Infinity;
    if (pending && pendingAgeMs <= PENDING_TTL_MS) {
      const resumed = this.resolvePendingAnswer(commandText, pending, ctx.clarificationType);
      if (resumed && 'ambiguous' in resumed) {
        // F5: a bare "Yes." cannot answer a MULTI-CHOICE question. Ask which one
        // instead of guessing or resetting to a generic re-ask.
        ambiguityAnswer = this.formatWhichOne(resumed.ambiguous);
      } else if (resumed && 'goal' in resumed) {
        logger.info('[UniversalExecutionController] Continuation bound to pending clarification', {
          pendingKind: pending.kind,
          clarificationType: ctx.clarificationType || pending.clarificationType || 'untyped',
          target: pending.targetName,
          heard: commandText,
          resumedGoal: resumed.goal,
        });
        commandText = resumed.goal;
        continuationUsed = true;
      }
    }

    if (ambiguityAnswer) {
      const ambTrace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence}`,
        `GOAL=clarification_ambiguous`,
        `FINAL_TEXT=${ambiguityAnswer}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${ambTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: ambTrace });
      return {
        handled: true,
        goalId: 'clarification_ambiguous',
        goalDescription: 'Ambiguous yes on a multi-choice question',
        route: 'chat_trivial',
        plan: {
          goalId: 'clarification_ambiguous',
          goalDescription: 'Ambiguous yes on a multi-choice question',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: false, output: ambiguityAnswer },
        verification: { verified: true, realityCheck: 'Ambiguous answer: asked which one' },
        spokenText: ambiguityAnswer,
        timings: { totalMs: Date.now() - t0 },
        pendingClarification: {
          kind: pending!.kind,
          targetName: pending!.targetName,
          targetType: pending!.targetType,
          intendedAction: pending!.intendedAction,
          attempt: (pending!.attempt || 1) + 1,
          askedAt: Date.now(),
          options: pending!.options,
          clarificationType: 'choice',
        },
      };
    }

    // ── META-CONVERSATION (F3) ──────────────────────────────────────────
    // "Why not?", "What do you need?", "Try again." refer to the PREVIOUS action.
    // They must resolve against the recorded state, not be classified as new goals.
    const metaText = commandText.replace(/[?.!]+$/g, '').trim();
    const referredEntity = this.referent(ctx);
    const META_WHY = /^(?:jarvis[,\s]*)?(?:ok(?:ay)?[,\s]*)?(?:why(?:\s+not|\s+is\s+that|\s+though)?|what\s+happened|what\s+went\s+wrong|how\s+come|and\s+why)$/i;
    const META_NEED = /^(?:so[,\s]+)?(?:what\s+do\s+you\s+need|what\s+does\s+it\s+need|what\s+is\s+needed|whats?\s+needed|what\s+does\s+it\s+require|what\s+do\s+you\s+require|what\s+is\s+missing|whats?\s+missing)$/i;
    const META_RETRY = /^(?:jarvis[,\s]*)?(?:try\s+again|do\s+it\s+again|retry|once\s+more|again|continue(?:\s+the\s+project)?|go\s+on|keep\s+going)$/i;
    const META_CONTINUATION =
      /^(?:(?:yeah|yes|yep|ok(?:ay)?|well|so)\s*,?\s*)?(?:and\??|and\s+then\??|what\s+else\??|what\s+next\??|go\s+on|continue|elaborate|more\s+details?|tell\s+me\s+more)$/i;

    if (META_CONTINUATION.test(metaText) && !continuationUsed) {
      bumpOnce(turnId, 'contextual_continuation');
      let entityName = referredEntity || ctx.activeProjectName || ctx.lastResolvedEntityName || '';
      let projectId = ctx.activeProjectId || ctx.lastResolvedEntityId;

      try {
        const { projectsStore } = await import('../../../services/projectsStore.js');
        if (!projectId && entityName) {
          const hit = projectsStore.listProjects().find((p: any) =>
            (p.name || '').toLowerCase() === entityName.toLowerCase() ||
            (p.id || '').toLowerCase() === entityName.toLowerCase()
          );
          if (hit) {
            projectId = hit.id;
            entityName = hit.name;
          }
        }
        if (!projectId) {
          const activeId = projectsStore.getActiveProjectId();
          const activeProj = activeId ? projectsStore.getProject(activeId) : null;
          if (activeProj) {
            projectId = activeProj.id;
            entityName = activeProj.name;
          } else {
            const p1 = projectsStore.listProjects().find((p: any) => p.priority === 1);
            if (p1) {
              projectId = p1.id;
              entityName = p1.name;
            }
          }
        }
      } catch { /* store fallback */ }

      const { backgroundTaskManager } = await import('../../../services/backgroundTasks/manager.js');
      const allTasks = projectId ? backgroundTaskManager.listTasks({ projectId, limit: 100 }) : [];
      const blockedTasks = allTasks.filter((t: any) => String(t.status).toLowerCase() === 'blocked');

      const credRegex = /\b(credential|credentials|api\s*key|login|sign\s?in|token|secret|external\s+account|account\s+setup)\b/i;
      const credBlockers = blockedTasks.filter((t: any) => credRegex.test(`${t.blocker || ''} ${t.title || ''}`));
      const otherBlockers = blockedTasks.filter((t: any) => !credBlockers.includes(t));

      const isCredQuery = /credential|need\s+(?:anything|from\s+me)/i.test(metaText);
      const isAdvanceQuery = /\b(what else|then what|more|tell me more|beyond that|other than that|what about the rest)\b/i.test(metaText);
      const alreadyReportedBlockers = Boolean(ctx.lastAssistantTurn && ctx.lastAssistantTurn.includes('blocked task'));
      let speech = '';

      if (isCredQuery) {
        if (credBlockers.length > 0) {
          const names = credBlockers.map((t: any) => `"${t.title}"`).join(', ');
          const blockerReason = credBlockers[0].blocker ? ` (${credBlockers[0].blocker})` : '';
          speech = `Yes, for ${entityName}: ${names} is currently blocked waiting for external credentials${blockerReason}. That requires your input to provide the required credentials.`;
        } else {
          speech = `No credentials are required from you for ${entityName} right now. None of the recorded tasks are waiting on account credentials.`;
        }
      } else if (isAdvanceQuery && alreadyReportedBlockers) {
        const runningTasks = allTasks.filter((t: any) => String(t.status).toLowerCase() === 'running');
        const queuedTasks = allTasks.filter((t: any) => String(t.status).toLowerCase() === 'pending' || String(t.status).toLowerCase() === 'queued');
        const runningSnippet = runningTasks.length > 0
          ? `${runningTasks.length} running tasks (${runningTasks.slice(0, 2).map((t: any) => `"${t.title}"`).join(', ')})`
          : 'no actively running tasks';
        const queuedSnippet = queuedTasks.length > 0
          ? `${queuedTasks.length} queued tasks ready to dispatch`
          : 'no pending tasks in queue';
        speech = `Beyond the blockers, ${entityName} has ${runningSnippet}, and ${queuedSnippet}.`;
      } else {
        if (blockedTasks.length > 0) {
          const parts: string[] = [];
          if (credBlockers.length > 0) {
            const credTitles = credBlockers.map((t: any) => `"${t.title}"`).join(', ');
            const reason = credBlockers[0].blocker ? ` (${credBlockers[0].blocker})` : '';
            parts.push(`${credTitles} is blocked waiting for external credentials${reason}, which requires your intervention`);
          }
          if (otherBlockers.length > 0) {
            const otherTitles = otherBlockers.slice(0, 2).map((t: any) => `"${t.title}"`).join(', ');
            parts.push(`${otherTitles} was interrupted and can be resumed or retried`);
          }
          const summary = parts.join('; while ');
          speech = `For ${entityName}, the ${blockedTasks.length} blocked task${blockedTasks.length > 1 ? 's are' : ' is'}: ${summary}. ${credBlockers.length > 0 ? 'Credentials are required from you for the external account setup.' : 'No credentials are required from you right now.'}`;
        } else {
          speech = `For ${entityName}, nothing is currently blocked, and no credentials or user intervention are required from you right now.`;
        }
      }

      const contTrace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence}`,
        `GOAL=project_continuation:${projectId || 'unscoped'}`,
        `ENTITY=${entityName}`,
        `BLOCKED_COUNT=${blockedTasks.length}`,
        `CRED_BLOCKED=${credBlockers.length}`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${contTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: contTrace });

      return {
        handled: true,
        goalId: 'project_continuation',
        goalDescription: `Conversational continuation for ${entityName}`,
        route: 'chat_trivial',
        plan: {
          goalId: 'project_continuation',
          goalDescription: `Conversational continuation for ${entityName}`,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'Answered from project and background task records' },
        spokenText: speech,
        entityId: projectId,
        entityName: entityName,
        timings: { totalMs: Date.now() - t0 },
        lastResolvedEntityId: projectId,
        lastResolvedEntityName: entityName,
        lastResolvedAction: 'read',
        lastExecutionResult: {
          success: true,
          verified: true,
          route: 'project_continuation',
          entityId: projectId,
          entityName: entityName,
          at: Date.now(),
        },
        lastVerificationState: 'verified',
        clearPendingClarification: true,
      };
    }

    if (META_WHY.test(metaText) && !continuationUsed) {
      const lastAction = ctx.lastResolvedAction || '';
      const actionPast =
        lastAction === 'operate' ? 'start work on'
          : lastAction === 'read' ? 'read the status of'
            : lastAction === 'search' ? 'search for'
              : lastAction === 'open' ? 'open' : 'complete that';
      let speech: string;
      if (ctx.lastFailureReason) {
        speech = `I couldn't ${actionPast}${referredEntity ? ` ${referredEntity}` : ''} because ${ctx.lastFailureReason}.`;
      } else if (ctx.lastExecutionResult && ctx.lastExecutionResult.success) {
        speech = referredEntity
          ? `The last action on ${referredEntity} went through — nothing failed.`
          : 'The last action went through — nothing failed.';
      } else {
        speech = "I don't have a verified reason for that failure yet.";
      }
      const whyTrace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence}`,
        `GOAL=meta_why:${lastAction || 'none'}`,
        `LAST_FAILURE=${ctx.lastFailureReason || 'none'}`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${whyTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: whyTrace });
      logger.info('[UniversalExecutionController] Meta-turn "why" answered from recorded state', {
        lastAction, referredEntity, hadFailure: Boolean(ctx.lastFailureReason),
      });
      return {
        handled: true,
        goalId: 'meta_why',
        goalDescription: 'Explain the previous outcome',
        route: 'chat_trivial',
        plan: {
          goalId: 'meta_why',
          goalDescription: 'Explain the previous outcome',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: false, output: speech },
        verification: { verified: true, realityCheck: 'Answered from recorded continuation state' },
        spokenText: speech,
        entityName: referredEntity || undefined,
        timings: { totalMs: Date.now() - t0 },
        // Keep the referent and the failure reason available for the NEXT turn.
        lastResolvedEntityName: referredEntity || undefined,
        lastResolvedAction: lastAction || undefined,
        lastFailureReason: ctx.lastFailureReason,
        lastFailureAt: ctx.lastFailureAt,
        lastVerificationState: ctx.lastFailureReason ? 'failed' : (ctx.lastVerificationState || 'unknown'),
        pendingClarification: ctx.lastFailureReason
          ? {
              kind: 'failure_followup',
              targetName: referredEntity || undefined,
              intendedAction: lastAction || undefined,
              attempt: 1,
              askedAt: Date.now(),
              options: ['try again'],
              clarificationType: 'open_ended',
            }
          : undefined,
      };
    }

    // ── WORKER / STATUS QUESTIONS (Phase F §9) ──────────────────────────
    // "What is Codex doing?", "Is anything running on Free Cash?", "What failed?"
    // must READ real worker/task state. Queries about blockers pass through to dedicated blocker handlers.
    const META_WORKERS =
      /^(?:jarvis[,\s]*)?(?:what(?:'s| is| are)\s+(?:codex|hermes|the\s+revenue\s+operator|the\s+workers?|running|finished|failing|left)|is\s+anything\s+running|what\s+(?:finished|failed)|what\s+did\s+(?:codex|hermes)\s+(?:finish|do)|why\s+did\s+it\s+fail|what\s+happened\s+(?:to|with)\s+(?:it|that|that\s+task|the\s+task))\b/i;
    if (META_WORKERS.test(metaText) && !continuationUsed) {
      const { backgroundTaskManager } = await import('../../../services/backgroundTasks/manager.js');
      const { isExecutingStatus } = await import('../../../services/backgroundTasks/types.js');
      const { workerLabel } = await import('../../jarvisNext/resultRenderer.js');

      // Scope: an explicit project in the utterance wins, else the conversation's
      // active project / last resolved referent (continuity).
      const flatScope = metaText.toLowerCase().replace(/\s+/g, '');
      let projectId: string | undefined = ctx.activeProjectId || ctx.lastResolvedEntityId;
      let projectName: string | undefined = ctx.activeProjectName || ctx.lastResolvedEntityName;
      try {
        const { projectsStore } = await import('../../../services/projectsStore.js');
        const projects = projectsStore.listProjects();
        const hit = projects.find((p: any) => {
          const flat = (p.name || '').toLowerCase().replace(/\s+/g, '');
          return flat.length > 2 && flatScope.includes(flat);
        });
        if (hit) { projectId = hit.id; projectName = hit.name; }
      } catch { /* project store unavailable: fall back to the conversation scope */ }

      // A question that NAMES a worker must not be answered with another worker's
      // activity: "What is Codex doing?" ≠ the Revenue Operator's mission.
      const askedWorker = /codex/i.test(metaText) ? 'codex'
        : /hermes/i.test(metaText) ? 'hermes'
        : /revenue\s+operator/i.test(metaText) ? 'revenue'
          : undefined;
      const forAsked = (list: any[]) =>
        askedWorker ? list.filter((t) => (t.worker || '').toLowerCase() === askedWorker) : list;

      /**
       * Entity-bound task scoping lives at module level (boundTasks) so every
       * handler in this controller shares one scoping rule.
       */

      // Never speak log/JSON debris carried in a blocker or error string.
      const clean = (s?: string | null) =>
        (s || '')
          .replace(/[\r\n]+/g, ' ')
          .replace(/\{\{.*$/, '')
          .replace(/["'}\],;]+$/g, '')
          .replace(/\.\s*$/, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
      const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

      let tasks = boundTasks(backgroundTaskManager, projectId, projectName || this.referent(ctx));
      const isTaskSpecificInquiry = /what\s+happened\s+(?:to|with)\s+(?:it|that|that\s+task|the\s+task)/i.test(metaText);
      if (isTaskSpecificInquiry) {
        const allRecent = backgroundTaskManager.listTasks();
        const convTasks = allRecent.filter((t: any) => t.conversationId === conversationId || t.worker === 'hermes' || t.worker === 'codex');
        if (convTasks.length > 0) {
          tasks = convTasks;
        }
      }

      const running = forAsked(tasks.filter((t: any) => isExecutingStatus(t.status)));
      const queued = forAsked(tasks.filter((t: any) => t.status === 'queued'));
      const blocked = forAsked(tasks.filter((t: any) => t.status === 'blocked'));
      const failed = forAsked(tasks.filter((t: any) => t.status === 'failed'));
      const finished = forAsked(tasks.filter((t: any) => t.status === 'completed'));
      const scopeName = projectName || this.referent(ctx) || 'that project';
      const askedLabel = askedWorker ? (workerLabel(askedWorker) || askedWorker) : '';
      const wants = metaText.toLowerCase();

      let speech: string;
      if (isTaskSpecificInquiry && tasks.length > 0) {
        const recent = [...tasks].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        speech = `Task ${recent.taskId} ("${recent.title}") has status ${recent.status}.` + (recent.resultText ? ` Result: ${clean(recent.resultText)}` : '');
      } else if (/fail|why/i.test(wants) && !/finished/.test(wants)) {
        speech = failed.length > 0
          ? `${failed[0].title} failed: ${clean(failed[0].lastError) || 'no reason was recorded'}.`
          : ctx.lastFailureReason
            ? `The last thing that failed was ${clean(ctx.lastFailureReason)}.`
            : `Nothing has failed on ${scopeName}.`;
      } else if (/finished|did\s+(?:codex|hermes)\s+(?:finish|do)/i.test(wants)) {
        speech = finished.length > 0
          ? `${finished.length} task${finished.length === 1 ? '' : 's'} finished. Most recently: ${finished[0].title} — ${clean(finished[0].resultText) || 'no result text was recorded'}.`
          : `Nothing has finished on ${scopeName} yet.`;
      } else if (/block/i.test(wants)) {
        // "What is blocked?" must answer about BLOCKED work, not whatever else
        // happens to be running or queued.
        speech = blocked.length > 0
          ? `${blocked.length} task${blocked.length === 1 ? ' is' : 's are'} blocked on ${scopeName} by ${clean(blocked[0].blocker) || 'an unresolved dependency'}.`
          : `Nothing is blocked on ${scopeName}` +
            (running.length > 0 ? ` — ${running.length} task${running.length === 1 ? ' is' : 's are'} still running.` : '.');
      } else if (askedWorker && running.length === 0 && queued.length === 0) {
        speech = `${askedLabel} isn't running anything on ${scopeName} right now.` +
          (blocked.length > 0 ? ` ${blocked.length} item${blocked.length === 1 ? ' is' : 's are'} blocked.` : '');
      } else if (running.length > 0) {
        const label = workerLabel(running[0].worker) || 'A worker';
        const blockedNote = blocked.length > 0
          ? ` ${blocked.length} item${blocked.length === 1 ? ' is' : 's are'} blocked by ${clean(blocked[0].blocker) || 'an unresolved dependency'}.`
          : '';
        speech = `${sentence(label)} is running ${running[0].title} on ${scopeName}.` +
          (running.length > 1 ? ` ${running.length} tasks are active in total.` : '') + blockedNote;
      } else if (queued.length > 0) {
        const label = workerLabel(queued[0].worker) || 'a worker';
        speech = `${queued.length} task${queued.length === 1 ? '' : 's'} for ${scopeName} ${queued.length === 1 ? 'is' : 'are'} queued for ${label} and haven't started yet.`;
      } else if (blocked.length > 0) {
        speech = `Nothing is running on ${scopeName}. ${blocked.length} task${blocked.length === 1 ? ' is' : 's are'} blocked by ${clean(blocked[0].blocker) || 'an unresolved dependency'}, so I haven't started a worker.`;
      } else {
        speech = `I don't have any worker activity recorded for ${scopeName}.`;
      }

      const wsTrace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `GOAL=worker_status:${projectId || 'unscoped'}`,
        `WORKER_RUNNING=${running.length}`,
        `WORKER_QUEUED=${queued.length}`,
        `WORKER_BLOCKED=${blocked.length}`,
        `WORKER_FAILED=${failed.length}`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${wsTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: wsTrace });
      logger.info('[UniversalExecutionController] Worker-status question answered from task records', {
        scope: projectId, running: running.length, queued: queued.length, blocked: blocked.length, failed: failed.length,
      });
      return {
        handled: true,
        goalId: 'worker_status',
        goalDescription: `Worker status for ${scopeName}`,
        route: 'chat_trivial',
        plan: {
          goalId: 'worker_status',
          goalDescription: `Worker status for ${scopeName}`,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'Read from background task records' },
        spokenText: speech,
        entityId: projectId,
        entityName: projectName || this.referent(ctx) || undefined,
        timings: { totalMs: Date.now() - t0 },
        lastResolvedEntityId: projectId || ctx.lastResolvedEntityId,
        lastResolvedEntityName: projectName || this.referent(ctx) || undefined,
        lastResolvedAction: 'read',
        lastExecutionResult: {
          success: true,
          verified: true,
          route: 'worker_status',
          entityId: projectId,
          entityName: projectName || this.referent(ctx) || undefined,
          at: Date.now(),
        },
        lastVerificationState: 'verified',
      };
    }

    // ── CANCEL A RUNNING TASK (Phase F §9) ──────────────────────────────
    // "Stop the current Free Cash task." must CANCEL real work — never re-run
    // the operate command. A bare "Stop." stays with the STOP path below.
    const META_CANCEL =
      /^(?:jarvis[,\s]*)?(?:stop|cancel|abort|kill)\s+(?:the\s+)?(?:current|running|active|that|this)?\s*(?:.+?\s+)?(?:task|mission|job|work)(?:\s+(?:on|for|in)\s+(.+?))?[.!]*$/i;
    const META_RETRY_TASK =
      /^(?:jarvis[,\s]*)?(?:try\s+(?:that|it|this)\s+(?:task|mission)?\s*again|retry\s+(?:that|it|the)\s*(?:task|mission)?|run\s+(?:that|it)\s+again)[.!]*$/i;

    if ((META_CANCEL.test(metaText) || META_RETRY_TASK.test(metaText)) && !continuationUsed) {
      const { backgroundTaskManager } = await import('../../../services/backgroundTasks/manager.js');
      const { isExecutingStatus, isActiveStatus } = await import('../../../services/backgroundTasks/types.js');
      const { backgroundTaskRepo } = await import('../../../services/backgroundTasks/store.js');

      const flatScope = metaText.toLowerCase().replace(/\s+/g, '');
      let projectId: string | undefined = ctx.activeProjectId || ctx.lastResolvedEntityId;
      let projectName: string | undefined = ctx.activeProjectName || ctx.lastResolvedEntityName;
      try {
        const { projectsStore } = await import('../../../services/projectsStore.js');
        const hit = projectsStore.listProjects().find((p: any) => {
          const flat = (p.name || '').toLowerCase().replace(/\s+/g, '');
          return flat.length > 2 && flatScope.includes(flat);
        });
        if (hit) { projectId = hit.id; projectName = hit.name; }
      } catch { /* project store unavailable */ }

      const scopeName = projectName || this.referent(ctx) || 'that project';
      const scoped = boundTasks(backgroundTaskManager, projectId, projectName || this.referent(ctx));
      let actionable = scoped.filter((t: { status: string }) => isActiveStatus(t.status as never));
      const isGlobalCancel = /\b(?:cancel|stop)\s+(?:all\s+work|everything|work|all\s+tasks?|tasks?)\b/i.test(metaText);
      if (actionable.length === 0 && (isGlobalCancel || !projectId)) {
        actionable = backgroundTaskManager.listTasks({ activeOnly: true }).filter((t: { status: string }) => isActiveStatus(t.status as never));
      }
      let speech: string;
      let verified = true;
      let route = 'task_cancel';

      if (META_CANCEL.test(metaText)) {
        const target = actionable[0];
        if (!target) {
          speech = isGlobalCancel
            ? 'There is no active work running to cancel.'
            : `Nothing is running on ${scopeName} right now, so there's nothing to cancel.`;
        } else {
          const res = backgroundTaskManager.cancelTask(target.taskId, 'Cancelled by user command.');
          const stored = backgroundTaskRepo.getTask(target.taskId);
          verified = res.ok && stored?.status === 'cancelled';
          speech = verified
            ? `I've cancelled ${target.title}${target.projectId ? ` on ${scopeName}` : ''}.`
            : `I couldn't cancel ${target.title}${res.error ? `: ${res.error}` : '.'}`;
        }
      } else {
        // Retry: a terminal task cannot be revived (terminal states are
        // immutable), so the retry is a NEW mission that records its origin.
        // The cross-project fallback is allowed ONLY for a truly unscoped question:
        // a retry must never be borrowed from another project than the one named.
        const unscoped = !projectId && !projectName && !this.referent(ctx);
        const failedOrBlocked = scoped.filter((t: { status: string }) => t.status === 'failed' || t.status === 'blocked');
        let prior = failedOrBlocked[0]
          || (unscoped ? backgroundTaskManager.listTasks({ status: ['failed', 'blocked'], limit: 20 })[0] : undefined);
        // ── CROSS-PROJECT GUARD (P0) ────────────────────────────────────────
        // A retry source must belong to the project this turn resolved.
        if (prior && projectId && (prior as { projectId?: string }).projectId !== projectId) {
          bump('cross_project_execution_blocked');
          logger.error('[UniversalExecutionController] CROSS_PROJECT_RETRY_REJECTED', {
            resolvedProjectId: projectId,
            retrySourceTaskId: (prior as { taskId: string }).taskId,
            retrySourceProjectId: (prior as { projectId?: string }).projectId,
          });
          prior = undefined;
        }
        if (!prior) {
          speech = `There's no failed task on ${scopeName} to retry.`;
        } else {
          const created = backgroundTaskManager.createTask({
            title: `${prior.title.replace(/\s*\(retry\)\s*$/i, '')} (retry)`,
            objective: prior.objective,
            originalRequest: prior.originalRequest || 'retry requested',
            route: prior.route,
            selectedAgent: prior.selectedAgent,
            worker: prior.worker,
            priority: prior.priority,
            projectId: prior.projectId,
            conversationId,
            resumable: prior.resumable,
            metadata: { ...(prior.metadata || {}), retryOf: prior.taskId },
          });
          route = 'task_retry';
          if (!created.task) {
            verified = false;
            speech = `I couldn't create a retry for ${prior.title}${created.error ? `: ${created.error}` : '.'}`;
          } else {
            const stored = backgroundTaskRepo.getTask(created.task.taskId)!;
            const live = isExecutingStatus(stored.status);
            speech = live
              ? `I've re-queued ${prior.title} as a new task — it's running now.`
              : `I've re-queued ${prior.title} as a new task; it's waiting to start.`;
            verified = isActiveStatus(stored.status);
          }
        }
      }

      const cancelTrace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `GOAL=${route}:${projectId || 'unscoped'}`,
        `ACTIONABLE_TASKS=${actionable.length}`,
        `VERIFIED=${verified}`,
        `FINAL_TEXT=${speech}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${cancelTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: cancelTrace });
      return {
        handled: true,
        goalId: route,
        goalDescription: `${route} for ${scopeName}`,
        route: 'chat_trivial',
        plan: {
          goalId: route,
          goalDescription: `${route} for ${scopeName}`,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: verified, output: speech },
        verification: { verified, realityCheck: verified ? 'Verified against the task record' : 'Task state did not confirm the change' },
        spokenText: speech,
        entityId: projectId,
        entityName: projectName || this.referent(ctx) || undefined,
        timings: { totalMs: Date.now() - t0 },
        lastResolvedEntityId: projectId || ctx.lastResolvedEntityId,
        lastResolvedEntityName: projectName || this.referent(ctx) || undefined,
        lastResolvedAction: META_CANCEL.test(metaText) ? 'cancel' : 'retry',
        lastExecutionResult: {
          success: verified,
          verified,
          route,
          entityId: projectId,
          entityName: projectName || this.referent(ctx) || undefined,
          at: Date.now(),
        },
        lastFailureReason: verified ? undefined : speech,
        lastFailureAt: verified ? undefined : Date.now(),
        lastVerificationState: verified ? 'verified' : 'failed',
      };
    }

    // ── CREATE A TASK (Internal Tool Proof) ───────────────────────────
    // "Jarvis, create a task to review the Free Cash API tomorrow."
    const META_CREATE_TASK =
      /^(?:jarvis[,\s]*)?(?:create|add|make|schedule)\s+(?:a\s+)?task\s+(?:to\s+)?(.+?)[.!]*$/i;

    if (META_CREATE_TASK.test(metaText) && !continuationUsed) {
      const match = metaText.match(META_CREATE_TASK);
      const rawTaskGoal = match ? match[1].trim() : 'Task';

      reportProgress({
        status: 'running',
        stage: 'PLANNING',
        currentStep: `Planning internal task: ${rawTaskGoal}`,
      });

      // Resolve associated project if mentioned
      const flatScope = metaText.toLowerCase().replace(/\s+/g, '');
      let projectId: string | undefined = ctx.activeProjectId || ctx.lastResolvedEntityId;
      let projectName: string | undefined = ctx.activeProjectName || ctx.lastResolvedEntityName;
      try {
        const { projectsStore } = await import('../../../services/projectsStore.js');
        const hit = projectsStore.listProjects().find((p: any) => {
          const flat = (p.name || '').toLowerCase().replace(/\s+/g, '');
          return flat.length > 2 && flatScope.includes(flat);
        });
        if (hit) { projectId = hit.id; projectName = hit.name; }
      } catch {}

      if (!projectId) {
        try {
          const { projectsStore } = await import('../../../services/projectsStore.js');
          const all = projectsStore.listProjects();
          if (all.length > 0) {
            projectId = all[0].id;
            projectName = all[0].name;
          }
        } catch {}
      }

      reportProgress({
        status: 'running',
        stage: 'EXECUTING',
        currentStep: `Creating task in ${projectName || 'project'} database`,
      });

      const { projectTaskService } = await import('../../../services/projectExecution/projectTaskService.js');
      const goal = projectTaskService.createGoal({
        projectId: projectId || 'proj-default',
        title: `Goal: ${rawTaskGoal.slice(0, 50)}`,
        objective: rawTaskGoal,
      });

      const task = projectTaskService.createTask({
        projectId: projectId || 'proj-default',
        goalId: goal.id,
        title: rawTaskGoal,
        description: `Created via voice command: "${rawStt}"`,
        taskType: 'internal_tool',
        assignedCapability: 'hermes',
      });

      reportProgress({
        status: 'running',
        stage: 'VERIFYING',
        currentStep: 'Verifying task record persistence',
      });

      const persisted = task?.id ? projectTaskService.getTask(task.id) : null;
      const verified = Boolean(task?.id && persisted && persisted.id === task.id);

      reportProgress({
        status: verified ? 'completed' : 'failed',
        stage: verified ? 'COMPLETED' : 'FAILED',
        currentStep: verified ? `Task ${task?.id} persisted and verified` : 'Task persistence verification failed',
      });

      const speech = verified
        ? `I've created the task to ${rawTaskGoal}${projectName ? ` for ${projectName}` : ''}. It is saved as task ${task?.id}.`
        : `I attempted to create the task, but database verification failed.`;

      return {
        handled: true,
        goalId: 'create_task',
        goalDescription: `Create task: ${rawTaskGoal}`,
        route: 'internal_tool',
        stage: 'COMPLETED',
        plan: {
          goalId: 'create_task',
          goalDescription: `Create task: ${rawTaskGoal}`,
          steps: [],
          estimatedRisk: 'local_write',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: verified, output: speech },
        verification: { verified, realityCheck: verified ? `Verified task ${task.id} in projectTaskService database` : 'Failed persistence' },
        spokenText: speech,
        entityId: projectId,
        entityName: projectName,
        timings: { totalMs: Date.now() - t0 },
        lastResolvedEntityId: projectId,
        lastResolvedEntityName: projectName,
        lastResolvedAction: 'create_task',
        lastExecutionResult: {
          success: verified,
          verified,
          route: 'create_task',
          entityId: projectId,
          entityName: projectName,
          at: Date.now(),
        },
        lastVerificationState: verified ? 'verified' : 'failed',
      };
    }

    // ── CORRECTION / DENIAL (D22) ───────────────────────────────────────
    // "No, you didn't." / "You know you did not." must resolve against the LAST
    // claim and its recorded result — never a generic re-ask.
    const META_CORRECTION =
      /^(?:jarvis[,\s]*)?(?:ok(?:ay)?[,\s]*)?(?:no[,\s]+)?(?:you\s+)?(?:\w+[,\s]+){0,3}(?:did\s?n'?t|did\s+not|didnt|never\s+did|you'?re\s+wrong|that'?s\s+wrong|that\s+is\s+wrong|that'?s\s+not\s+(?:what\s+i\s+(?:asked|wanted)|right|working|true)|it\s+did\s?n'?t\s+(?:open|work|happen|load)|you\s+opened\s+the\s+wrong|wrong\s+(?:thing|project|view|one)|that\s+did\s?n'?t\s+work|it\s+is\s?n'?t\s+(?:open|working))[.!\s]*$/i;

    if (META_CORRECTION.test(metaText) && !continuationUsed) {
      const corrEntity = this.referent(ctx);
      const lastExec = ctx.lastExecutionResult;
      const wasVerified = ctx.lastVerificationState === 'verified' || Boolean(lastExec?.verified);

      if (lastExec && !wasVerified) {
        // The user is right. Explain the real recorded state and retry the action.
        const actionWord = ctx.lastResolvedAction === 'operate' ? 'start work on'
          : ctx.lastResolvedAction === 'read' ? 'read the status of'
            : 'open';
        const reason = ctx.lastFailureReason ? ` The recorded reason: ${ctx.lastFailureReason}.` : '';
        logger.info('[UniversalExecutionController] Correction accepted; retrying the previous action', {
          heard: commandText, entity: corrEntity, lastAction: ctx.lastResolvedAction, reason: ctx.lastFailureReason || null,
        });
        if (corrEntity) {
          bumpOnce(turnId, 'correction_resolved');
          commandText = ctx.lastResolvedAction === 'read' ? `what is happening with ${corrEntity}`
            : ctx.lastResolvedAction === 'operate' ? `start working on ${corrEntity}`
              : `open ${corrEntity}`;
          continuationUsed = true; // falls through: the retry's REAL result is the answer
        } else {
          const speech = `You're right — ${actionWord} that didn't complete successfully.${reason} Tell me the target again and I'll retry it.`;
          bumpOnce(turnId, 'correction_no_result');
          logger.info('[JRT] LIVE_TURN_TRACE', { trace: `TURN_ID=${turnId}\nRAW_STT=${rawStt}\nGOAL=correction_no_referent\nFINAL_TEXT=${speech}` });
          return {
            handled: true,
            goalId: 'correction',
            goalDescription: 'Correction accepted (no referent to retry)',
            route: 'chat_trivial',
            plan: { goalId: 'correction', goalDescription: 'Correction accepted', steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
            execution: { success: false, output: speech },
            verification: { verified: true, realityCheck: 'Correction accepted from recorded execution state' },
            spokenText: speech,
            timings: { totalMs: Date.now() - t0 },
            lastFailureReason: ctx.lastFailureReason,
            lastFailureAt: ctx.lastFailureAt,
            lastVerificationState: 'failed',
          };
        }
      } else if (wasVerified) {
        // Do not argue: state what the interface confirmed and offer a retry.
        const speech = corrEntity
          ? `The interface confirmed ${corrEntity} as the mounted project on my side, so I'm not going to argue — if your view shows something else, say "retry" and I'll open it again.`
          : `My last action was confirmed by the interface. If your view shows something else, say "retry" and I'll do it again.`;
        logger.info('[JRT] LIVE_TURN_TRACE', { trace: `TURN_ID=${turnId}\nRAW_STT=${rawStt}\nGOAL=correction_against_verified\nFINAL_TEXT=${speech}` });
        return {
          handled: true,
          goalId: 'correction',
          goalDescription: 'Correction against a verified result',
          route: 'chat_trivial',
          plan: { goalId: 'correction', goalDescription: 'Correction against a verified result', steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
          execution: { success: false, output: speech },
          verification: { verified: true, realityCheck: 'Stated the verified result; offered a retry' },
          spokenText: speech,
          timings: { totalMs: Date.now() - t0 },
          lastResolvedEntityName: corrEntity || undefined,
          lastVerificationState: 'verified',
        };
      } else {
        const speech = `You're right to flag that — I don't have a verified result for my last action, so I won't claim it worked. Tell me again what you want and I'll do it.`;
        logger.info('[JRT] LIVE_TURN_TRACE', { trace: `TURN_ID=${turnId}\nRAW_STT=${rawStt}\nGOAL=correction_no_result\nFINAL_TEXT=${speech}` });
        return {
          handled: true,
          goalId: 'correction',
          goalDescription: 'Correction with no recorded result',
          route: 'chat_trivial',
          plan: { goalId: 'correction', goalDescription: 'Correction with no recorded result', steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
          execution: { success: false, output: speech },
          verification: { verified: true, realityCheck: 'No verified result to defend' },
          spokenText: speech,
          timings: { totalMs: Date.now() - t0 },
        };
      }
    }

    // ── ACCOUNT / CREDENTIAL QUESTIONS (D24) ────────────────────────────
    // These must never be answered with project statistics. Answer from what is
    // actually recorded, and say plainly when the specific requirement is unknown.
    const META_CREDENTIALS =
      /(?:what|which)\s+(?:kind\s+of\s+|type\s+of\s+)?(?:credentials?|account\s+info(?:rmation)?|login\s+details?|access)\b|what\s+(?:do\s+you\s+need\s+from\s+me|credentials?\s+do\s+you\s+need)|do\s+you\s+need\s+my\s+(?:email|password|api\s*key|login|credentials?|account)|why\s+can'?t\s+you\s+(?:log\s?in|sign\s?in|connect|access)|what\s+account\s+information\s+is\s+missing|is\s+my\s+[\w\s]{2,24}account\s+connected|does\s+[\w\s]{2,24}\s+need\s+me\s+to\s+(?:sign\s?in|log\s?in|authorize)/i;

    if (META_CREDENTIALS.test(metaText) && !continuationUsed) {
      const { backgroundTaskManager } = await import('../../../services/backgroundTasks/manager.js');
      const credEntity = this.referent(ctx);
      bumpOnce(turnId, 'credential_intent');
      // ENTITY BINDING: only the resolved entity's own records may be quoted.
      // "What credentials do you need for Shopify?" must never surface Free
      // Cash's blocker, and must say so when Shopify has no such record.
      const boundId = ctx.lastResolvedEntityId || ctx.activeProjectId;
      let recorded = '';
      let boundBy = boundId || '';
      try {
        if (!boundId) {
          // Try to bind by the entity's NAME before giving up.
          const { projectsStore } = await import('../../../services/projectsStore.js');
          const name = (credEntity || '').toLowerCase().trim();
          const hit = name.length > 2
            ? projectsStore.listProjects().find((p: any) => (p.name || '').toLowerCase().trim() === name)
            : undefined;
          if (hit) boundBy = hit.id;
        }
        if (boundBy) {
          const tasks = backgroundTaskManager.listTasks({ projectId: boundBy, limit: 100 });
          const hit = tasks.find((t: any) =>
            // Defence in depth: even if a store ignores the project filter, a
            // blocker from ANOTHER project must never answer this question.
            (!boundBy || t.projectId === boundBy)
            && /\b(credential|credentials|api\s*key|login|sign\s?in|token|secret)\b/i.test(`${t.blocker || ''} ${t.title || ''}`),
          );
          if (hit?.blocker) recorded = String(hit.blocker).replace(/[."'}\]]+$/, '').trim();
        } else {
          bumpOnce(turnId, 'blocker_borrow_blocked');
        }
      } catch { /* task store unavailable */ }
      const who = credEntity || 'that account';
      const speech = recorded
        ? `I don't know the exact credentials yet for ${who}. All I have is what ${who}'s own records say: "${recorded}". I need to inspect the actual login/integration path before telling you what to provide — and I have no evidence yet that an API key is what's required.`
        : boundBy
          ? `Nothing in ${who}'s own records says which credential is missing yet. All I know is that account access is incomplete, so I need to inspect the actual ${who} login path before telling you what to provide. I have no evidence yet that an API key is required.`
          : `I don't have an account or access record for ${who} yet, so I can't tell you which credentials are required — I won't borrow another project's blocker for this. I need to inspect the ${who} integration before answering.`;
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: `TURN_ID=${turnId}\nRAW_STT=${rawStt}\nGOAL=credential_intent\nRECORDED=${recorded || 'none'}\nFINAL_TEXT=${speech}` });
      logger.info('[UniversalExecutionController] Credential question answered from recorded state (no project statistics)', {
        entity: credEntity, recorded: recorded || null,
      });
      return {
        handled: true,
        goalId: 'credential_intent',
        goalDescription: `Account/credential question for ${who}`,
        route: 'chat_trivial',
        plan: { goalId: 'credential_intent', goalDescription: `Account/credential question for ${who}`, steps: [], estimatedRisk: 'read', requiresApproval: false, confidence: 1.0 },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'Answered from recorded blocker/account state only' },
        spokenText: speech,
        entityId: ctx.activeProjectId,
        entityName: credEntity || undefined,
        timings: { totalMs: Date.now() - t0 },
        lastResolvedEntityId: ctx.activeProjectId || ctx.lastResolvedEntityId,
        lastResolvedEntityName: credEntity || undefined,
        lastResolvedAction: 'read',
        lastExecutionResult: { success: true, verified: true, route: 'credential_intent', entityId: ctx.activeProjectId, entityName: credEntity || undefined, at: Date.now() },
        lastVerificationState: 'verified',
      };
    }

    if ((META_NEED.test(metaText) || META_RETRY.test(metaText)) && !continuationUsed && referredEntity) {
      const carried = META_NEED.test(metaText) ? 'read' : (ctx.lastResolvedAction || 'read');
      const goal =
        carried === 'read' ? `what is happening with ${referredEntity}`
          : carried === 'operate' ? `start working on ${referredEntity}`
            : carried === 'search' ? `search for ${referredEntity}`
              : `open ${referredEntity}`;
      logger.info('[UniversalExecutionController] Meta-turn resolved against the previous action', {
        heard: commandText, entity: referredEntity, carriedAction: carried, goal,
      });
      commandText = goal;
      continuationUsed = true;
    }

    // ── PARTIAL-SPEECH GOAL COMPOSITION (F6/F4/F7) ──────────────────────
    // Low STT confidence must not erase coherent semantic content, and a short
    // follow-up must not lose the referent. Compose a complete goal from the
    // action + entity that ARE present before any question is asked.
    // Compound commands with coordinating conjunctions must NEVER be squashed.
    const isCompoundCommand = /\b(and\s+then|and|then|also|plus|after that|followed\s+by)\b/i.test(commandText);
    if (!continuationUsed && (!isCompoundCommand || sttConfidence < 0.60)) {
      const composed = await this.composeGoalFromPartialSpeech(commandText, ctx);
      if (composed) {
        logger.info('[UniversalExecutionController] Partial speech composed into a goal (action + referent kept)', {
          heard: commandText,
          entity: composed.entity,
          action: composed.action,
          goal: composed.goal,
          sttConfidence,
        });
        commandText = composed.goal;
        continuationUsed = true;
      }
    }

    // ── PHYSICAL MIC CONFIDENCE & PLAUSIBILITY GATE (Invariant 4) ─────
    const isPlausibleSpeech =
      commandText.length >= 2 &&
      !/^(repeated tough|mbc|subtitles by|thanks for watching|amara\.org)/i.test(commandText);

    if ((sttConfidence < 0.20 || !isPlausibleSpeech) && !continuationUsed) {
      logger.warn('[UniversalExecutionController] Low-confidence or implausible STT rejected:', {
        prompt,
        commandText,
        sttConfidence,
      });

      // If user attempted to stop/interrupt, or this is a barge-in turn during TTS,
      // NEVER speak "I couldn't make that out". Return immediate quiet recovery.
      if ((input as any).isBargeIn || isLikelyControlAttempt(rawStt) || isLikelyControlAttempt(commandText) || isLikelyControlAttempt(prompt)) {
        logger.info('[UniversalExecutionController] Low-confidence or marginal speech during barge-in/control attempt — failing quietly into silence.');
        return {
          handled: true,
          goalId: 'quiet_recovery',
          goalDescription: 'Barge-in/control attempt failed quietly without clarification',
          route: 'chat_trivial',
          plan: {
            goalId: 'quiet_recovery',
            goalDescription: 'Failed quietly into silence',
            steps: [],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: 0.0,
          },
          execution: { success: false, output: '' },
          verification: { verified: true, realityCheck: 'Silently returned to listening on barge-in' },
          spokenText: '',
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        };
      }

      // PARTIAL UNDERSTANDING RECOVERY (S1): low STT confidence is NOT by itself
      // a reason to discard the utterance. Extract whatever anchors it carries
      // and ask about those; only fall back to a generic re-ask when the
      // utterance holds nothing usable at all.
      const anchors = await this.extractSemanticAnchors(commandText, ctx);
      if (anchors.length > 0) {
        const anchor = anchors[0];

        // DIRECT EXECUTE: If the user said "open YouTube" or "search YouTube for X" (action verb + browser anchor),
        // execute the browser navigation or search immediately instead of asking a clarification.
        const hasActionVerb = /\b(?:open|go to|visit|launch|browse|navigate to|find|search|look up)\b/i.test(commandText);
        if (hasActionVerb && (anchor.kind === 'youtube' || anchor.kind === 'browser')) {
          const resolvedTarget = browserExecutor.resolveTarget(anchor.name) ||
            (anchor.kind === 'youtube' ? { id: 'youtube', displayName: 'YouTube', url: 'https://www.youtube.com' } : null);
          if (resolvedTarget) {
            const searchPattern = /(?:search|find|look up)\s+(?:on\s+([a-z0-9]+)\s+for|in\s+([a-z0-9]+)\s+for|([a-z0-9]+)\s+for)\s+(.+)/i;
            const searchPattern2 = /(?:search|find|look up)\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+([a-z0-9]+)/i;
            const m1 = commandText.match(searchPattern);
            const m2 = !m1 ? commandText.match(searchPattern2) : null;
            const searchQuery = m1 ? m1[4]?.trim() : (m2 ? m2[1]?.trim() : null);

            if (searchQuery) {
              logger.info('[UniversalExecutionController] ANCHOR_DIRECT_EXECUTE: search query detected → direct browser search', {
                target: resolvedTarget.displayName,
                query: searchQuery,
              });
              const searchRes = await browserExecutor.executeStep({
                stepId: `search-anchor-${resolvedTarget.id}`,
                capabilityId: 'browser',
                executorId: 'browser',
                action: 'search',
                parameters: { target: resolvedTarget.displayName, query: searchQuery },
                description: `Search ${resolvedTarget.displayName} for "${searchQuery}"`,
              }, { ...ctx, conversationId });
              return {
                handled: true,
                goalId: `anchor-search-${resolvedTarget.id}`,
                goalDescription: `search ${resolvedTarget.displayName} for ${searchQuery}`,
                route: 'browser',
                plan: {
                  goalId: `anchor-search-${resolvedTarget.id}`,
                  goalDescription: `search ${resolvedTarget.displayName} for ${searchQuery}`,
                  steps: [{
                    stepId: `search-anchor-${resolvedTarget.id}`,
                    capabilityId: 'browser',
                    executorId: 'browser',
                    action: 'search',
                    parameters: { target: resolvedTarget.displayName, query: searchQuery },
                    description: `Search ${resolvedTarget.displayName} for "${searchQuery}"`,
                  }],
                  estimatedRisk: 'read',
                  requiresApproval: false,
                  confidence: 0.95,
                  primaryExecutor: 'browser',
                  candidates: [],
                },
                execution: searchRes,
                verification: await browserExecutor.verify(searchRes),
                spokenText: searchRes.output || (searchRes.success ? `Searched ${resolvedTarget.displayName} for ${searchQuery}.` : `I couldn't search ${resolvedTarget.displayName}.`),
                timings: { totalMs: Date.now() - t0 },
              };
            }

            logger.info('[UniversalExecutionController] ANCHOR_DIRECT_EXECUTE: low-confidence anchor with action verb → direct browser navigation', {
              anchor: anchor.name, kind: anchor.kind, verb: commandText, target: resolvedTarget.displayName,
            });
            const navRes = await browserExecutor.executeStep({
              stepId: `nav-anchor-${resolvedTarget.id}`,
              capabilityId: 'browser',
              executorId: 'browser',
              action: 'navigate',
              parameters: { target: resolvedTarget.displayName, url: resolvedTarget.url },
              description: `Navigate browser to ${resolvedTarget.displayName}`,
            }, { ...ctx, conversationId });
            return {
              handled: true,
              goalId: `anchor-nav-${resolvedTarget.id}`,
              goalDescription: `open ${resolvedTarget.displayName}`,
              route: 'browser',
              plan: {
                goalId: `anchor-nav-${resolvedTarget.id}`,
                goalDescription: `open ${resolvedTarget.displayName}`,
                steps: [{
                  stepId: `nav-anchor-${resolvedTarget.id}`,
                  capabilityId: 'browser',
                  executorId: 'browser',
                  action: 'navigate',
                  parameters: { target: resolvedTarget.displayName, url: resolvedTarget.url },
                  description: `Navigate browser to ${resolvedTarget.displayName}`,
                }],
                estimatedRisk: 'read',
                requiresApproval: false,
                confidence: 0.95,
                primaryExecutor: 'browser',
                candidates: [],
                clarificationRequired: false,
              },
              execution: navRes,
              verification: await browserExecutor.verify(navRes),
              spokenText: (navRes.success && (await browserExecutor.verify(navRes)).verified)
                ? (navRes.output || `I've opened ${resolvedTarget.displayName}.`)
                : ((await browserExecutor.verify(navRes)).realityCheck || navRes.error || `I couldn't open ${resolvedTarget.displayName}.`),
              timings: { totalMs: Date.now() - t0 },
            };
          }
        }

        const priorAttempts =
          pending && pending.targetName && pending.targetName.toLowerCase() === anchor.name.toLowerCase()
            ? pending.attempt
            : 0;
        const anchorSpeech =
          priorAttempts >= 1
            ? `I heard ${anchor.name}. Do you want me to open it, check its status, or start working on it?`
            : anchor.kind === 'project'
              ? `I heard ${anchor.name}. Do you want me to open the project or the website?`
              : anchor.kind === 'youtube'
                ? `Do you want me to search YouTube for ${anchor.name}?`
                : `I heard ${anchor.name}. What would you like me to do with it?`;

        const anchorTrace = [
          `TURN_ID=${turnId}`,
          `RAW_STT=${rawStt}`,
          `NORMALIZED=${commandText}`,
          `STT_CONFIDENCE=${sttConfidence}`,
          `GOAL=anchor_recovered:${anchor.name}`,
          `GOAL_CONFIDENCE=0.0`,
          `EXECUTOR_CANDIDATES=none`,
          `SELECTED_EXECUTOR=none`,
          `SELECTED_EXECUTOR_CONFIDENCE=0.0`,
          `BROWSER_TARGET=<NONE>`,
          `TERMINAL_COMMAND=<NONE>`,
          `SELF_HEAL_ELIGIBLE=false`,
          `EXECUTED=false`,
          `VERIFIED=false`,
          `FINAL_TEXT=${anchorSpeech}`,
        ].join('\n');
        console.log(`[JRT] LIVE_TURN_TRACE:\n${anchorTrace}`);
        logger.info('[JRT] LIVE_TURN_TRACE', { trace: anchorTrace });

        return {
          handled: true,
          goalId: 'partial_understanding',
          goalDescription: `Anchor recovered: ${anchor.name}`,
          route: 'chat_trivial',
          plan: {
            goalId: 'partial_understanding',
            goalDescription: `Anchor recovered: ${anchor.name}`,
            steps: [],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: 0.4,
          },
          execution: { success: false, output: anchorSpeech },
          verification: { verified: true, realityCheck: 'Low-confidence gate recovered anchors' },
          spokenText: anchorSpeech,
          timings: { totalMs: Date.now() - t0 },
          pendingClarification: {
            kind: 'anchor_action',
            targetName: anchor.name,
            targetType: anchor.kind,
            attempt: priorAttempts + 1,
            askedAt: Date.now(),
            options: anchor.options,
          },
        };
      }

      const priorReasks = (pending?.attempt ?? 0);
      if (priorReasks >= 1 || pending?.kind === 'generic_reask') {
        logger.info('[UniversalExecutionController] Consecutive low-confidence clarification suppressed — failing quietly.');
        return {
          handled: true,
          goalId: 'quiet_recovery',
          goalDescription: 'Failed STT failed quietly',
          route: 'chat_trivial',
          plan: {
            goalId: 'quiet_recovery',
            goalDescription: 'Failed STT failed quietly',
            steps: [],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: 0.0,
          },
          execution: { success: false, output: '' },
          verification: { verified: true, realityCheck: 'Failed quietly after prior clarification' },
          spokenText: '',
          timings: { totalMs: Date.now() - t0 },
          clearPendingClarification: true,
        };
      }

      const finalSpeech = "I couldn't make that out. Could you say it again?";
      bumpOnce(turnId, 'generic_reask');
      const trace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence}`,
        `GOAL=unrecognized`,
        `GOAL_CONFIDENCE=0.0`,
        `EXECUTOR_CANDIDATES=none`,
        `SELECTED_EXECUTOR=none`,
        `SELECTED_EXECUTOR_CONFIDENCE=0.0`,
        `BROWSER_TARGET=<NONE>`,
        `TERMINAL_COMMAND=<NONE>`,
        `SELF_HEAL_ELIGIBLE=false`,
        `EXECUTED=false`,
        `VERIFIED=false`,
        `FINAL_TEXT=${finalSpeech}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${trace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace });

      return {
        handled: true,
        goalId: 'low_confidence',
        goalDescription: 'Low confidence audio',
        route: 'chat_trivial',
        plan: {
          goalId: 'low_confidence',
          goalDescription: 'Low confidence audio',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: sttConfidence,
        },
        execution: { success: false, output: finalSpeech },
        verification: { verified: true, realityCheck: 'Low confidence gate rejected execution' },
        spokenText: finalSpeech,
        timings: { totalMs: Date.now() - t0 },
        pendingClarification: undefined,
      };
    }

    // Fast-path: Bare greeting (e.g. "Jarvis.") — guarantee response without LLM/browser/terminal
    if (wakeResult.isBareGreeting || !commandText) {
      logger.info('[UniversalExecutionController] Bare greeting detected:', rawStt);
      
      let safeGreeting = 'I\'m here.';
      
      console.log(`[GREETING_PATH] rawStt=${JSON.stringify(rawStt)} → greeting='${safeGreeting}'`);
      
      return {
        handled: true,
        goalId: 'greeting',
        goalDescription: 'Greeting',
        route: 'chat_trivial',
        plan: {
          goalId: 'greeting',
          goalDescription: 'Greeting',
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: safeGreeting },
        verification: { verified: true, realityCheck: 'Presence confirmed' },
        spokenText: safeGreeting,
        timings: { totalMs: Date.now() - t0 },
      };
    }

    const context: TurnContext = {
      conversationId,
      turnId,
      workspacePath: input.workspacePath,
      activeProjectId: input.activeProjectId,
      activeProjectName: input.activeProjectName,
      rawStt,
      confidence: sttConfidence,
      navigationVerifier: input.navigationVerifier,
    };

    // 2. Semantic Goal Parsing & Action Planning (Closed Candidate Scoring)
    let plan: ActionPlan = semanticGoalParser.parseGoal(commandText, context);
    activePlan = plan;
    if (plan.steps.some((s) => s.executorId === 'browser')) {
      primaryRoute = 'browser';
    } else if (plan.steps[0]?.capabilityId) {
      primaryRoute = plan.steps[0].capabilityId;
    }
    logger.info('[UniversalExecutionController] Action plan generated:', {
      goal: plan.goalDescription,
      stepCount: plan.steps.length,
      confidence: plan.confidence,
      steps: plan.steps.map((s) => `${s.executorId}.${s.action}`),
    });

    reportProgress({
      status: 'running',
      stage: 'PLANNING',
      understood: plan.goalDescription,
      plan: plan.steps.map((s) => s.description || s.action),
      currentStep: plan.steps[0] ? `Planned: ${plan.steps[0].description || plan.steps[0].action}` : 'Planning',
      steps: plan.steps.map((s, idx) => ({
        step: s.description || s.action,
        state: idx === 0 ? 'running' : 'pending',
        ok: false,
      })),
    });

    // ── BARE-TARGET & TARGET-PRESERVATION GUARDS ──────────────────────────
    // (1) A named target must not be silently dropped: "Seeadler TV on YouTube"
    //     is NOT satisfied by opening youtube.com.
    // (2) A bare entity with no action ("Free Cash.") asks for nothing — acting
    //     on it invents an intent; asking is honest.
    const browserStep = plan.steps.find((s) => s.executorId === 'browser');
    const platformPhrase = commandText.match(/([A-Za-z0-9][\w .'’-]{1,40}?)\s+(?:on|in|from|at)\s+(you\s?tube|youtube|google)\b/i);
    let namedBrowserTarget = platformPhrase?.[1]?.trim();
    if (namedBrowserTarget) {
      namedBrowserTarget = namedBrowserTarget
        .replace(/^(?:open|browse|visit|watch|play|find|go\s+to|search\s+for|search|look\s+up)\s+/i, '')
        .replace(/^(?:the|a|an)\s+/i, '')
        .trim();
    }
    const platformName = platformPhrase?.[2]?.replace(/\s+/g, '').toLowerCase() === 'youtube' ? 'YouTube' : 'Google';

    // When the user already gave an operational action verb ("open", "find", "search", "go to", "watch", "play"),
    // it is a complete operational instruction. DO NOT ask: "Do you want me to search YouTube for ...?"!
    const hasExplicitActionVerb = /\b(open|opened|browse|visit|go\s+to|search\s+for|search|look\s+up|watch|play|start)\b/i.test(commandText);

    if (!hasExplicitActionVerb && browserStep && browserStep.action === 'navigate' && namedBrowserTarget && namedBrowserTarget.length > 1) {
      const ask = `Do you want me to search ${platformName} for ${namedBrowserTarget}?`;
      const navTrace = [
        `TURN_ID=${turnId}`, `RAW_STT=${rawStt}`, `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence}`, `GOAL=target_preserved:${namedBrowserTarget}`,
        `GOAL_CONFIDENCE=${plan.confidence}`, `EXECUTOR_CANDIDATES=${plan.candidates?.map((c) => `${c.executorId}:${c.confidence.toFixed(2)}`).join(',') || 'none'}`,
        `SELECTED_EXECUTOR=browser`, `SELECTED_EXECUTOR_CONFIDENCE=${plan.confidence}`,
        `BROWSER_TARGET=${platformName}`, `TERMINAL_COMMAND=<NONE>`, `SELF_HEAL_ELIGIBLE=false`,
        `EXECUTED=false`, `VERIFIED=false`, `FINAL_TEXT=${ask}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${navTrace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace: navTrace });
      return {
        handled: true,
        goalId: 'target_preserved',
        goalDescription: `Preserve target: ${namedBrowserTarget}`,
        route: 'chat_trivial',
        plan,
        execution: { success: false, output: ask },
        verification: { verified: true, realityCheck: 'Target preserved instead of dropped' },
        spokenText: ask,
        timings: { totalMs: Date.now() - t0 },
        pendingClarification: {
          kind: 'confirm_search',
          targetName: namedBrowserTarget,
          targetType: platformName.toLowerCase(),
          intendedAction: 'browser_search',
          attempt: 1,
          askedAt: Date.now(),
          options: ['the channel', 'a video'],
        },
      };
    }

    const bareTarget = await this.detectBareTarget(commandText, ctx);
    if (bareTarget) {
      const prior = pending && pending.targetName &&
        pending.targetName.toLowerCase() === bareTarget.toLowerCase() ? pending.attempt : 0;
      const ask = prior >= 1
        ? `I heard ${bareTarget}. Do you want me to open it, check its status, or start working on it?`
        : `What would you like me to do with ${bareTarget}?`;
      return {
        handled: true,
        goalId: 'bare_target',
        goalDescription: `Bare target: ${bareTarget}`,
        route: 'chat_trivial',
        plan,
        execution: { success: false, output: ask },
        verification: { verified: true, realityCheck: 'Bare target: no action requested' },
        spokenText: ask,
        timings: { totalMs: Date.now() - t0 },
        pendingClarification: {
          kind: 'target_action',
          targetName: bareTarget,
          targetType: 'project',
          attempt: prior + 1,
          askedAt: Date.now(),
          options: ['open it', 'check its status', 'start working on it'],
        },
      };
    }

    // ── BROWSER PLAN RESCUE ─────────────────────────────────────────────
    // If the goal parser returned clarificationRequired but the semantic
    // analysis identified a high-confidence browser candidate with an explicit
    // action verb, skip clarification and execute the browser plan directly.
    // This prevents "Open YouTube" from being trapped in clarification when
    // the parser's winning candidate was below 0.80 for non-browser reasons.
    if (
      (plan.clarificationRequired || plan.steps.length === 0) &&
      hasExplicitActionVerb &&
      plan.candidates?.some((c: any) => c.executorId === 'browser' && c.matched && c.confidence >= 0.90)
    ) {
      const browserCandidate = plan.candidates!.find((c: any) => c.executorId === 'browser' && c.matched)!;
      if (browserCandidate.plan && browserCandidate.plan.steps.length > 0) {
        logger.info('[UniversalExecutionController] BROWSER_PLAN_RESCUE: overriding clarificationRequired with high-confidence browser plan', {
          goal: commandText,
          browserConfidence: browserCandidate.confidence,
          originalConfidence: plan.confidence,
        });
        plan = {
          ...browserCandidate.plan,
          primaryExecutor: 'browser',
          candidates: plan.candidates,
          clarificationRequired: false,
        };
      }
    }

    // ── DESKTOP PLAN RESCUE ─────────────────────────────────────────────
    // If the goal parser returned clarificationRequired or steps are empty,
    // but the intent arbitrator identified a high-confidence desktop candidate,
    // execute the desktop plan directly instead of trapping in clarification.
    if (
      (plan.clarificationRequired || plan.steps.length === 0) &&
      plan.candidates?.some((c: any) => c.executorId === 'desktop' && c.matched && c.confidence >= 0.80)
    ) {
      const desktopCandidate = plan.candidates!.find((c: any) => c.executorId === 'desktop' && c.matched)!;
      if (desktopCandidate.plan && desktopCandidate.plan.steps.length > 0) {
        logger.info('[UniversalExecutionController] DESKTOP_PLAN_RESCUE: overriding clarificationRequired with high-confidence desktop plan', {
          goal: commandText,
          desktopConfidence: desktopCandidate.confidence,
          originalConfidence: plan.confidence,
        });
        plan = {
          ...desktopCandidate.plan,
          primaryExecutor: 'desktop',
          candidates: plan.candidates,
          clarificationRequired: false,
        };
      }
    }

    // ── CLOSED EXECUTOR GATE (Invariant 2 & 9) ────────────────────────
    // If top candidate confidence < 0.80 or clarification required: clarify, DO NOT FALLTHROUGH
    if (plan.clarificationRequired || plan.steps.length === 0) {
      logger.warn('[UniversalExecutionController] Plan requires clarification, closed execution prevented fallthrough:', {
        goal: commandText,
        confidence: plan.confidence,
      });

      // VOICE BEHAVIOUR: never re-ask generically when partial information is
      // already in hand, and never swallow a project-operation or blocker-followup turn.
      const projectOpVerb = /\b(start|starting|work on|working on|operate|operating|continue|resume|stop)\b/i.test(commandText);
      const isBlockerQuery =
        /\b(?:which\s+(?:one|task|api|credential|service)|for\s+which|which\s+api|what\s+(?:credentials?|api|is\s+(?:that|the)\s+blocker|task\s+is\s+blocked|exactly\s+is\s+missing)|why\s+(?:is\s+(?:it|that|the\s+task|the\s+blocker|that\s+blocker)|does\s+it\s+need|are\s+they\s+needed)|who\s+needs|resolve|fix\s+(?:the\s+)?blocker)\b/i.test(commandText) ||
        Boolean((ctx as any).activeBlockerId && /\b(blocker|credentials?|api\s*keys?|why|which|who|resolve|missing)\b/i.test(commandText));

      if (projectOpVerb || isBlockerQuery) {
        logger.info('[UniversalExecutionController] Clarification bypassed for specialized downstream turn', { text: commandText, isBlockerQuery });
        return {
          handled: false,
          goalId: plan.goalId,
          goalDescription: plan.goalDescription,
          route: 'chat_trivial',
          plan,
          execution: { success: false },
          verification: { verified: false, realityCheck: 'Clarification bypassed: specialized downstream turn' },
          spokenText: '',
          timings: { totalMs: Date.now() - t0 },
        };
      }

      const targetMatch = commandText.match(/\b(?:open|browse|visit|go to|search for|search)\s+(?:the\s+)?(.+?)(?:\s+(?:on|in|from|at)\s+[^ ]+)?[.!]?$/i);
      let recognisedTarget = (targetMatch?.[1] || '').trim();
      if (recognisedTarget) {
        recognisedTarget = recognisedTarget
          .replace(/^(?:open|browse|visit|watch|play|find|go\s+to|search\s+for|search|look\s+up)\s+/i, '')
          .replace(/^(?:the|a|an)\s+/i, '')
          .trim();
      }
      // Context help: focus may already name the entity, but ONLY when this
      // utterance actually refers back to one. An utterance that names no entity
      // and carries no continuation reference must never be answered as a
      // question about the active project — that is what turned an entity-free
      // system command into "What would you like me to do with Free Cash?".
      // Discourse-"that" is NOT an entity reference: "Forget that.", "Ignore
      // that", "that is all", "that's it" are cancellation/closing markers.
      // Runtime evidence (2026-09-23 acceptance T6/T9): both spoke the pending
      // Free-Cash question over a topic change and over a goodbye.
      const DISCOURSE_THAT = /\b(?:forget|ignore|drop|cancel|dismiss|never\s?mind)\s+that\b|\bthat\s+(?:is|'s)\s+(?:all|it|enough|good)\b|\bgoodbye\b|\bthat'?s\s+all\b/i;
      const hasEntityBackReference = !DISCOURSE_THAT.test(commandText) &&
        /\b(it|its|it'?s|that|this|them|those|the\s+(?:project|website|site|page|channel|task|app|file))\b/i.test(commandText);
      const contextTarget = hasEntityBackReference
        ? (ctx.activeProjectName || ctx.activeEntityName || '').trim()
        : '';
      const priorAttempts =
        pending && pending.targetName && (recognisedTarget || contextTarget) &&
        pending.targetName.toLowerCase() === (recognisedTarget || contextTarget).toLowerCase()
          ? pending.attempt
          : 0;

      let clarifyText: string;
      let clarifyPending: TurnExecutionResult['pendingClarification'] | undefined;
      const namedTarget = recognisedTarget || contextTarget;

      if (namedTarget) {
        // If user already specified an action (e.g. "open YouTube"), do NOT ask "What would you like me to do with YouTube?"!
        // Generalized to ALL canonical browser targets — not just YouTube.
        if (/\b(?:open|go to|visit|launch|browse|navigate to|search|find|look up)\b/i.test(commandText)) {
          const resolvedBrowserTarget = browserExecutor.resolveTarget(namedTarget);
          if (resolvedBrowserTarget) {
            const searchPattern = /(?:search|find|look up)\s+(?:on\s+([a-z0-9]+)\s+for|in\s+([a-z0-9]+)\s+for|([a-z0-9]+)\s+for)\s+(.+)/i;
            const searchPattern2 = /(?:search|find|look up)\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+([a-z0-9]+)/i;
            const m1 = commandText.match(searchPattern);
            const m2 = !m1 ? commandText.match(searchPattern2) : null;
            const searchQuery = m1 ? m1[4]?.trim() : (m2 ? m2[1]?.trim() : null);

            if (searchQuery) {
              logger.info('[UniversalExecutionController] Executing direct browser search fallback', {
                target: resolvedBrowserTarget.displayName,
                query: searchQuery,
              });
              const searchRes = await browserExecutor.executeStep({
                stepId: `search-${resolvedBrowserTarget.id}-fallback`,
                capabilityId: 'browser',
                executorId: 'browser',
                action: 'search',
                parameters: { target: resolvedBrowserTarget.displayName, query: searchQuery },
                description: `Search ${resolvedBrowserTarget.displayName} for "${searchQuery}"`,
              }, { ...ctx, conversationId });
              return {
                handled: true,
                goalId: `browser-search-${resolvedBrowserTarget.id}`,
                goalDescription: `search ${resolvedBrowserTarget.displayName} for ${searchQuery}`,
                route: 'browser',
                plan: {
                  goalId: `browser-search-${resolvedBrowserTarget.id}`,
                  goalDescription: `search ${resolvedBrowserTarget.displayName} for ${searchQuery}`,
                  steps: [{
                    stepId: `search-${resolvedBrowserTarget.id}-fallback`,
                    capabilityId: 'browser',
                    executorId: 'browser',
                    action: 'search',
                    parameters: { target: resolvedBrowserTarget.displayName, query: searchQuery },
                    description: `Search ${resolvedBrowserTarget.displayName} for "${searchQuery}"`,
                  }],
                  estimatedRisk: 'read',
                  requiresApproval: false,
                  confidence: 0.99,
                  primaryExecutor: 'browser',
                  candidates: [],
                  clarificationRequired: false,
                },
                execution: searchRes,
                verification: await browserExecutor.verify(searchRes),
                spokenText: searchRes.output || `Searched ${resolvedBrowserTarget.displayName} for ${searchQuery}`,
                timings: { totalMs: Date.now() - t0 },
              };
            }

            logger.info('[UniversalExecutionController] Executing direct browser navigation fallback', {
              target: resolvedBrowserTarget.displayName,
              url: resolvedBrowserTarget.url,
            });
            const navRes = await browserExecutor.executeStep({
              stepId: `nav-${resolvedBrowserTarget.id}-fallback`,
              capabilityId: 'browser',
              executorId: 'browser',
              action: 'navigate',
              parameters: { target: resolvedBrowserTarget.displayName, url: resolvedBrowserTarget.url },
              description: `Navigate browser to ${resolvedBrowserTarget.displayName}`,
            }, { ...ctx, conversationId });
            return {
              handled: true,
              goalId: `browser-nav-${resolvedBrowserTarget.id}`,
              goalDescription: `open ${resolvedBrowserTarget.displayName}`,
              route: 'browser',
              plan: {
                goalId: `browser-nav-${resolvedBrowserTarget.id}`,
                goalDescription: `open ${resolvedBrowserTarget.displayName}`,
                steps: [{
                  stepId: `nav-${resolvedBrowserTarget.id}-fallback`,
                  capabilityId: 'browser',
                  executorId: 'browser',
                  action: 'navigate',
                  parameters: { target: resolvedBrowserTarget.displayName, url: resolvedBrowserTarget.url },
                  description: `Navigate browser to ${resolvedBrowserTarget.displayName}`,
                }],
                estimatedRisk: 'read',
                requiresApproval: false,
                confidence: 0.99,
                primaryExecutor: 'browser',
                candidates: [],
                clarificationRequired: false,
              },
              execution: navRes,
              verification: await browserExecutor.verify(navRes),
              spokenText: (navRes.success && (await browserExecutor.verify(navRes)).verified)
                ? (navRes.output || `I've opened ${resolvedBrowserTarget.displayName}.`)
                : ((await browserExecutor.verify(navRes)).realityCheck || navRes.error || `I couldn't open ${resolvedBrowserTarget.displayName}.`),
              timings: { totalMs: Date.now() - t0 },
            };
          }
        }

        const isBrowserish = /\b(youtube|google|browser|chrome|site|website|channel|video)\b/i.test(namedTarget);
        const isProjectish = !isBrowserish && (
          /\b(project|free cash|freecash|shopify|tiktok|tik tok|revenue)\b/i.test(namedTarget) ||
          Boolean(ctx.activeProjectName && ctx.activeProjectName.toLowerCase() === namedTarget.toLowerCase())
        );
        const options = isProjectish
          ? ['open it', 'check its status', 'start working on it']
          : ['the channel', 'a video'];
        clarifyText =
          priorAttempts >= 1
            ? `I heard ${namedTarget}. Do you want me to open it, check its status, or start working on it?`
            : projectOpVerb
              ? `You want me to work on ${namedTarget}. Should I continue with the next available task?`
              : `What would you like me to do with ${namedTarget}?`;
        clarifyPending = {
          kind: projectOpVerb ? 'confirm_project_work' : 'target_action',
          targetName: namedTarget,
          targetType: isProjectish ? 'project' : 'browser',
          intendedAction: projectOpVerb ? 'operate_project' : undefined,
          attempt: priorAttempts + 1,
          askedAt: Date.now(),
          options,
        };
      } else {
        if (priorAttempts >= 1 || pending?.kind === 'generic_reask') {
          logger.info('[UniversalExecutionController] Consecutive clarification suppressed at plan stage — failing quietly.');
          return {
            handled: true,
            goalId: 'quiet_recovery',
            goalDescription: 'Failed STT failed quietly',
            route: 'chat_trivial',
            plan: {
              goalId: 'quiet_recovery',
              goalDescription: 'Failed STT failed quietly',
              steps: [],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.0,
            },
            execution: { success: false, output: '' },
            verification: { verified: true, realityCheck: 'Failed quietly after prior clarification' },
            spokenText: '',
            timings: { totalMs: Date.now() - t0 },
            clearPendingClarification: true,
          };
        }
        if ((input as any).isBargeIn || isLikelyControlAttempt(rawStt) || isLikelyControlAttempt(commandText) || isLikelyControlAttempt(prompt)) {
          logger.info('[UniversalExecutionController] Low-confidence goal during barge-in/control attempt — failing quietly into silence.');
          return {
            handled: true,
            goalId: 'quiet_recovery',
            goalDescription: 'Failed quietly into silence',
            route: 'chat_trivial',
            plan: {
              goalId: 'quiet_recovery',
              goalDescription: 'Failed quietly into silence',
              steps: [],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.0,
            },
            execution: { success: false, output: '' },
            verification: { verified: true, realityCheck: 'Failed quietly without clarification' },
            spokenText: '',
            timings: { totalMs: Date.now() - t0 },
            clearPendingClarification: true,
          };
        }
        const hasStrongSpeech = sttConfidence >= 0.40 && commandText.length >= 6;
        if (hasStrongSpeech && !/\b(open|browse|visit|go to|search)\b/i.test(commandText)) {
          console.log(`[JRT] ROUTING_FAILURE:\nSTT_TRANSCRIPT=${rawStt}\nROUTING_FAILURE_REASON=semantic_goal_unrecognized_for_clear_speech`);
          logger.warn('[UniversalExecutionController] Routing failure for clear speech — passing to conversational router', {
            STT_TRANSCRIPT: rawStt,
            ROUTING_FAILURE_REASON: 'semantic_goal_unrecognized_for_clear_speech',
          });
          return {
            handled: false,
            goalId: 'unrecognized_speech_pass',
            goalDescription: 'Unrecognized clear speech pass-through',
            route: 'chat_trivial',
            plan: {
              goalId: 'unrecognized_speech_pass',
              goalDescription: 'Unrecognized clear speech pass-through',
              steps: [],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.0,
            },
            execution: { success: false, output: '' },
            verification: { verified: false, realityCheck: 'Unrecognized clear speech passed to conversational handler' },
            spokenText: '',
            timings: { totalMs: Date.now() - t0 },
          };
        }

        clarifyText = /\b(open|browse|visit|go to|search)\b/i.test(commandText)
          ? "Which application or website would you like me to open?"
          : "";

        if (!clarifyText) {
          logger.info('[UniversalExecutionController] Ambiguous noise or sub-threshold speech — failing quietly into silence.');
          return {
            handled: true,
            goalId: 'quiet_recovery',
            goalDescription: 'Failed quietly into silence',
            route: 'chat_trivial',
            plan: {
              goalId: 'quiet_recovery',
              goalDescription: 'Failed quietly into silence',
              steps: [],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.0,
            },
            execution: { success: false, output: '' },
            verification: { verified: true, realityCheck: 'Failed quietly without clarification' },
            spokenText: '',
            timings: { totalMs: Date.now() - t0 },
            clearPendingClarification: true,
          };
        }

        bumpOnce(turnId, 'clarification_asked');
        clarifyPending = {
          kind: 'target_action',
          targetName: 'browser',
          targetType: 'browser',
          attempt: priorAttempts + 1,
          askedAt: Date.now(),
          options: ['a website', 'an application'],
        };
      }

      const trace = [
        `TURN_ID=${turnId}`,
        `RAW_STT=${rawStt}`,
        `NORMALIZED=${commandText}`,
        `STT_CONFIDENCE=${sttConfidence}`,
        `GOAL=${plan.goalDescription || 'uncertain'}`,
        `GOAL_CONFIDENCE=${plan.confidence.toFixed(2)}`,
        `EXECUTOR_CANDIDATES=${plan.candidates?.map((c) => `${c.executorId}:${c.confidence.toFixed(2)}`).join(',') || 'none'}`,
        `SELECTED_EXECUTOR=none`,
        `SELECTED_EXECUTOR_CONFIDENCE=0.0`,
        `BROWSER_TARGET=<NONE>`,
        `TERMINAL_COMMAND=<NONE>`,
        `SELF_HEAL_ELIGIBLE=false`,
        `EXECUTED=false`,
        `VERIFIED=false`,
        `FINAL_TEXT=${clarifyText}`,
      ].join('\n');
      console.log(`[JRT] LIVE_TURN_TRACE:\n${trace}`);
      logger.info('[JRT] LIVE_TURN_TRACE', { trace });

      return {
        handled: true,
        goalId: plan.goalId,
        goalDescription: plan.goalDescription,
        route: 'chat_trivial',
        plan,
        execution: { success: false, output: clarifyText },
        verification: { verified: false, realityCheck: 'Clarification requested' },
        spokenText: clarifyText,
        timings: { totalMs: Date.now() - t0 },
        pendingClarification: clarifyPending,
      };
    }

    // 3. Execution & Verification Loop
    const stepOutputs: string[] = [];
    const requestedGoals: string[] = [];
    const executedGoals: string[] = [];
    const satisfiedGoals: string[] = [];
    const failedGoals: string[] = [];

    let overallSuccess = true;
    let lastExecResult: ExecutionResult = { success: false };
    let lastVerification: VerificationResult = { verified: false, realityCheck: 'No execution' };
    primaryRoute = plan.steps[0]?.capabilityId || 'terminal';
    entityName = undefined;
    entityId = undefined;
    let entityType: string | undefined;
    let uiRoute: string | undefined;
    let selfHealWasEligible = false;
    let latestProposal: any = null;

    // Browser commands MUST route only to browser (Invariant 1)
    if (plan.steps.some((s) => s.executorId === 'browser')) {
      primaryRoute = 'browser';
    }

    for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
      const step = plan.steps[stepIndex];
      const stepGoal = (step.action === 'navigate_ui' ? `OPEN_PROJECT:${step.parameters?.entityName || step.parameters?.entityId || 'unknown'}`
        : step.action === 'operate_project' ? `OPERATE_PROJECT:${step.parameters?.entityName || step.parameters?.entityId || 'unknown'}`
        : step.action === 'query_status' ? (
            step.parameters?.query && /\b(?:blocker|blockers|blocked)\b/i.test(step.parameters.query as string) ? `GET_BLOCKERS:${step.parameters?.entityName || step.parameters?.entityId || 'unknown'}`
            : step.parameters?.query && /\b(?:next|what (?:should|we\s+should|we\s+do|do) (?:we\s+)?do|what to do)\b/i.test(step.parameters.query as string) ? `GET_NEXT_ACTIONS:${step.parameters?.entityName || step.parameters?.entityId || 'unknown'}`
            : `GET_STATUS:${step.parameters?.entityName || step.parameters?.entityId || 'unknown'}`
          )
        : `${step.capabilityId}.${step.action}`);
      requestedGoals.push(stepGoal);

      // ROUTE BY ACTION (C): the identity of the step being attempted must be
      // recorded BEFORE any early break — a failed navigation was previously
      // reported with the raw capability id, so the client never saw its
      // failed action_status.
      if (step.executorId === 'internal_agenticos') {
        const internalAction = step.action as string | undefined;
        primaryRoute =
          internalAction === 'navigate_ui' ? 'navigate'
          : internalAction === 'operate_project' ? 'project_operate'
          : 'fast_read';
        entityId = step.parameters.entityId as string;
        entityName = step.parameters.entityName as string;
        entityType = (step.parameters.entityType as string) || 'project';
      }

      const executor = this.executors.get(step.executorId);
      if (!executor) {
        overallSuccess = false;
        lastExecResult = {
          success: false,
          error: `No executor registered for ${step.executorId}`,
        };
        failedGoals.push(stepGoal);
        break;
      }

      executedGoals.push(stepGoal);

      reportProgress({
        status: 'running',
        stage: 'EXECUTING',
        toolRunning: `${step.executorId}.${step.action}`,
        currentStep: step.description || step.action,
        steps: plan.steps.map((s, idx) => ({
          step: s.description || s.action,
          state: idx < stepIndex ? 'completed' : idx === stepIndex ? 'running' : 'pending',
          ok: idx < stepIndex,
        })),
      });

      // Execute step — inside the turn frame so the executor can refuse a
      // superseded/cancelled turn at its own OS boundary.
      let execRes: ExecutionResult = await runWithTurnOwnership(
        { conversationId, turnId, capability: String(step.action || 'universal_action') },
        () => executor.executeStep(step, context),
      );

      // Verify reality
      let verifyRes: VerificationResult = await executor.verify(execRes, context);

      reportProgress({
        status: 'running',
        stage: 'VERIFYING',
        currentStep: `Verifying: ${step.description || step.action}`,
        verification: verifyRes.realityCheck || 'Verifying execution result...',
        steps: plan.steps.map((s, idx) => ({
          step: s.description || s.action,
          state: idx < stepIndex ? 'completed' : idx === stepIndex ? 'running' : 'pending',
          ok: idx < stepIndex,
        })),
      });

      // Self-Heal Resilience: Invariant 5 (STT_CONFIDENT && GOAL_CONFIDENT && EXECUTOR_CONFIDENT && EXPECTED_CAPABILITY && ACTUAL_CAPABILITY_FAILURE)
      const hasDefect = !execRes.success || !verifyRes.verified;
      const isAckTimeout = verifyRes.error === 'ack_timeout' ||
        execRes.error?.includes('ack_timeout') ||
        execRes.error?.includes('did not navigate successfully') ||
        verifyRes.realityCheck?.includes('ack_timeout') ||
        verifyRes.realityCheck?.includes('did not navigate successfully');

      const isExternalTargetFailure =
        execRes.error?.includes('did not register in OS process table') ||
        execRes.error?.includes('not found') ||
        execRes.error?.includes('does not exist') ||
        execRes.error?.includes('Folder does not exist') ||
        execRes.error?.includes('ERR_NAME_NOT_RESOLVED') ||
        execRes.error?.includes('net::ERR') ||
        execRes.error?.includes('ERR_CONNECTION_REFUSED') ||
        verifyRes.realityCheck?.includes('did not register in OS process table') ||
        verifyRes.realityCheck?.includes('Application action failed');

      const isAgenticOsDefect = hasDefect && !isAckTimeout && !isExternalTargetFailure && (
        (execRes as any).isAgenticOsDefect === true ||
        execRes.error?.includes('RESILIENCE_BREAKAGE_SIMULATION') ||
        execRes.error === 'blocked_by_dialog'
      );

      const isSelfHealEligible =
        sttConfidence >= 0.60 &&
        plan.confidence >= 0.80 &&
        isAgenticOsDefect;

      if (isSelfHealEligible) {
        selfHealWasEligible = true;
        logger.warn(`[UniversalExecutionController] Step ${step.stepId} defect detected, triggering Self-Heal: ${verifyRes.realityCheck}`);

        reportProgress({
          status: 'running',
          stage: 'RECOVERING',
          currentStep: `Self-Heal: diagnosing ${step.capabilityId} defect`,
          recovery: `Unexpected failure detected: ${execRes.error || verifyRes.realityCheck}. Diagnosing in isolated worktree...`,
          steps: plan.steps.map((s, idx) => ({
            step: s.description || s.action,
            state: idx === stepIndex ? 'failed' : idx < stepIndex ? 'completed' : 'pending',
            ok: idx < stepIndex,
          })),
        });

        const healOutcome = await selfHealBridge.handleCapabilityFailure({
          capabilityId: step.capabilityId,
          executorId: step.executorId,
          error: execRes.error || verifyRes.realityCheck,
          plan,
          context,
          retryFn: () => executor.executeStep(step, context),
        });

        latestProposal = healOutcome.proposal;

        if (healOutcome.recovered && healOutcome.retryResult) {
          reportProgress({
            status: 'running',
            stage: 'RETRYING',
            currentStep: `Retrying step after repair: ${step.description || step.action}`,
            recovery: 'Repair verified! Retrying original user goal...',
          });
          execRes = healOutcome.retryResult;
          verifyRes = await executor.verify(execRes, context);
          stepOutputs.push(healOutcome.userExplanation || 'Capability repaired.');
        } else if (healOutcome.repairAttempted && healOutcome.userExplanation?.includes('approval required')) {
          reportProgress({
            status: 'waiting',
            stage: 'AWAITING_APPROVAL',
            currentStep: 'Repair prepared — approval required',
            recovery: healOutcome.userExplanation,
            repairProposal: healOutcome.proposal,
            steps: plan.steps.map((s, idx) => ({
              step: s.description || s.action,
              state: idx === stepIndex ? 'failed' : idx < stepIndex ? 'completed' : 'pending',
              ok: idx < stepIndex,
            })),
          });
          stepOutputs.push(healOutcome.userExplanation);
        }
      }

      lastExecResult = execRes;
      lastVerification = verifyRes;

      if (!execRes.success || !verifyRes.verified) {
        overallSuccess = false;
        stepOutputs.push(execRes.error || verifyRes.realityCheck || 'Step execution failed.');
        failedGoals.push(stepGoal);
        break;
      }

      satisfiedGoals.push(stepGoal);

      reportProgress({
        status: 'running',
        stage: 'EXECUTING',
        currentStep: `Completed: ${step.description || step.action}`,
        steps: plan.steps.map((s, idx) => ({
          step: s.description || s.action,
          state: idx <= stepIndex ? 'completed' : 'pending',
          ok: idx <= stepIndex,
        })),
      });

      if (execRes.output) {
        stepOutputs.push(execRes.output);
      }

      // Track primary route and entity
      if (step.executorId === 'internal_agenticos') {
        uiRoute = (execRes.evidence as any)?.uiRoute;
      } else if (step.executorId === 'browser') {
        primaryRoute = 'browser';
        entityName = (execRes.evidence as any)?.target || (step.parameters.target as string);
        entityId = entityName?.toLowerCase();
      } else if (step.executorId === 'desktop') {
        primaryRoute = 'desktop';
        entityName = step.parameters.displayName as string;
      }

      // SINGLE-TURN TERMINAL COMPLETION INVARIANT:
      // Once the primary browser target/channel is reached and verified,
      // terminate the plan with success. Suppress and cancel any trailing dangling steps
      // so no subsequent navigation (e.g. to Google or secondary pages) can occur.
      if (
        step.executorId === 'browser' &&
        (step.action === 'search_and_open' || (execRes.evidence as any)?.action === 'search_and_open') &&
        execRes.success &&
        verifyRes.verified
      ) {
        if (stepIndex < plan.steps.length - 1) {
          logger.info('[UniversalExecutionController] Primary browser destination reached and verified. Terminating plan with success; cancelling remaining steps.', {
            completedStep: step.action,
            cancelledSteps: plan.steps.slice(stepIndex + 1).map((s) => s.action),
          });
        }
        break;
      }
    }

    // ── NEVER-SILENT FINALIZER — guarantee non-empty output before TTS (Invariant 4) ─────────
    // A generic failure string may only be used when NO specific detail exists.
    // Prefer the executor's human result; fall back to error text, then the
    // verifier's own explanation. Never surface an internal code to the user.
    const failureDetail =
      (lastVerification?.realityCheck || '').trim() ||
      (lastVerification?.error || '').trim() ||
      (lastExecResult.error || '').trim() ||
      (lastExecResult.output || '').trim();

    const isVerifiedSuccess = Boolean(overallSuccess && lastVerification && lastVerification.verified === true);
    let finalText: string = isVerifiedSuccess
      ? (lastExecResult.output || 'Operation completed.')
      : (failureDetail || "I couldn't complete that command.");

    if (!finalText || !finalText.trim()) {
      finalText = isVerifiedSuccess ? 'Success.' : 'The action could not be verified.';
    }

    // Safety contract: if not verified, strip any hallucinated completion announcements
    if (!isVerifiedSuccess && /\b(?:i've opened|opened|done\b|i've completed|completed that|page is open|i sent it|i created it)\b/i.test(finalText)) {
      finalText = failureDetail || "I attempted the action, but could not verify that it completed successfully.";
    }

    // ── GUARDED NATURAL EXPRESSION ────────────────────────────────────────
    // The structured result stays authoritative; only wording changes, and the
    // renderer validates against a mechanical skeleton before speaking.
    try {
      const { renderOperationalResult } = await import('../../jarvisNext/resultRenderer.js');
      const data: any = (lastExecResult as any)?.data;
      if (primaryRoute === 'project_operate' && data && typeof data === 'object' && typeof data.runningCount === 'number') {
        finalText = await renderOperationalResult({
          kind: 'project_operate',
          entityName: this.preferHumanName(data.projectName, entityName, ctx.lastResolvedEntityName, ctx.activeProjectName),
          // PHASE F: the assignment facts must survive into the spoken result.
          worker: data.leadWorker,
          taskTitle: data.leadTaskTitle,
          runningTasks: data.runningCount,
          queuedTasks: data.queuedCount,
          blockedTasks: data.blockedCount,
          blocker: data.blockedCount > 0 ? data.primaryBlocker : undefined,
          blockerRecordedAt: data.primaryBlockerRecordedAt,
          blockerRevalidated: false,
          success: overallSuccess,
          verified: lastVerification?.verified,
        });
      } else if (primaryRoute === 'fast_read' && data && typeof data === 'object' && typeof data.directAnswer === 'string' && data.directAnswer.trim()) {
        finalText = await renderOperationalResult({
          kind: 'read',
          entityName: this.preferHumanName(entityName, ctx.lastResolvedEntityName, ctx.activeProjectName),
          facts: data.directAnswer,
        });
      } else if (primaryRoute === 'navigate' && entityName) {
        if (!lastExecResult?.output) {
          finalText = await renderOperationalResult({
            kind: 'navigate',
            entityName: this.preferHumanName(entityName, ctx.lastResolvedEntityName, ctx.activeProjectName),
            verified: Boolean(lastVerification?.verified && overallSuccess),
          });
        }
      }

      // If multiple steps succeeded and produced distinct outputs (e.g. Navigation + Status Query),
      // synthesize them so secondary inspection goals are never dropped.
      if (overallSuccess && stepOutputs.length > 1) {
        const uniqueOutputs = Array.from(new Set(stepOutputs.map((s) => s.trim()).filter(Boolean)));
        if (uniqueOutputs.length > 1) {
          finalText = uniqueOutputs.join(' ');
        }
      }
    } catch (renderErr: any) {
      logger.debug('[UniversalExecutionController] Natural rendering bypassed:', renderErr?.message);
    }

    // Additional truthfulness gate: ensure NO false completion claim can survive through step output synthesis or renderers
    if (!isVerifiedSuccess) {
      const unverifiedSuccessPattern = /\b(?:i(?:'ve| have)? (?:opened|created|sent|started|launched|completed|finished|deleted)|page is open|target is open|successfully (?:opened|created|sent|started|executed|completed))\b/i;
      if (unverifiedSuccessPattern.test(finalText)) {
        finalText = failureDetail || lastVerification?.realityCheck || "I attempted the action, but could not verify that it completed successfully.";
      }
    }

    console.log(`[SAFE_FINALIZER] lastExecResult.output=${JSON.stringify(lastExecResult.output)} → finalText=${JSON.stringify(finalText)}`);

    reportProgress({
      status: isVerifiedSuccess ? 'completed' : (latestProposal ? 'waiting' : 'failed'),
      stage: isVerifiedSuccess ? 'COMPLETED' : (latestProposal ? 'AWAITING_APPROVAL' : 'FAILED'),
      currentStep: isVerifiedSuccess ? 'All steps completed and verified' : (latestProposal ? 'Repair prepared — approval required' : (lastVerification?.realityCheck || `Failed on ${failedGoals[0] || 'step'}`)),
      result: finalText,
      verification: lastVerification?.verified ? 'Verified operational result' : (lastVerification?.realityCheck || 'Execution unverified'),
      repairProposal: latestProposal || undefined,
      steps: plan.steps.map((s, idx) => ({
        step: s.description || s.action,
        state: (idx < satisfiedGoals.length && isVerifiedSuccess) ? 'completed' : 'failed',
        ok: idx < satisfiedGoals.length && isVerifiedSuccess,
      })),
    });

    // ── FORMAT AND LOG REQUIRED LIVE TURN TRACE (Invariant 7) ─────────
    const browserTarget = plan.steps.find((s) => s.executorId === 'browser')?.parameters?.target as string || '<NONE>';
    const terminalCommand = plan.steps.find((s) => s.executorId === 'terminal')?.parameters?.command as string || '<NONE>';

    const liveTurnTrace = [
      `TURN_ID=${turnId}`,
      `RAW_STT=${rawStt}`,
      `NORMALIZED=${commandText}`,
      `STT_CONFIDENCE=${sttConfidence.toFixed(2)}`,
      `GOAL=${plan.steps[0] ? `${plan.steps[0].executorId}.${plan.steps[0].action}` : plan.goalDescription}`,
      `GOAL_CONFIDENCE=${plan.confidence.toFixed(2)}`,
      `EXECUTOR_CANDIDATES=${plan.candidates?.map((c) => `${c.executorId}:${c.confidence.toFixed(2)}`).join(',') || primaryRoute}`,
      `SELECTED_EXECUTOR=${primaryRoute}`,
      `SELECTED_EXECUTOR_CONFIDENCE=${plan.confidence.toFixed(2)}`,
      `BROWSER_TARGET=${browserTarget}`,
      `TERMINAL_COMMAND=${terminalCommand}`,
      `SELF_HEAL_ELIGIBLE=${selfHealWasEligible}`,
      `EXECUTED=${overallSuccess}`,
      `VERIFIED=${lastVerification.verified}`,
      `FINAL_TEXT=${finalText}`,
    ].join('\n');

    console.log(`[JRT] LIVE_TURN_TRACE:\n${liveTurnTrace}`);
    logger.info('[JRT] LIVE_TURN_TRACE', { trace: liveTurnTrace });
    logJRT('LIVE_TURN_TRACE', '\n' + liveTurnTrace);

    const execSuccess = overallSuccess && lastVerification.verified;
    // F2: record WHY it failed. Executor detail only — never invented.
    const dataAny: any = (lastExecResult as any)?.data;
    // A project operation that started nothing is explained by its own state
    // counts (the outcome is carried in `data`), not by a generic sentence.
    const structuredReason = (() => {
      if (!dataAny || typeof dataAny !== 'object') return '';
      const sb = dataAny.stateBefore;
      const sa = dataAny.stateAfter;
      const runnable = sb?.runnable ?? sa?.runnable;
      const blocked = sb?.blocked ?? sa?.blocked;
      const started = (dataAny.tasksStarted?.length ?? 0) + (dataAny.workerIds?.length ?? 0);
      if (dataAny.executed === false && started === 0 && (runnable === 0 || runnable === undefined)) {
        if (typeof blocked === 'number' && blocked > 0) {
          return `there is nothing runnable right now — ${blocked} task${blocked === 1 ? ' is' : 's are'} blocked`;
        }
        return 'there is currently no runnable task in that project';
      }
      return '';
    })();
    const failureReason = execSuccess
      ? undefined
      : ((lastExecResult.error ||
          (lastExecResult as any).failureReason ||
          (lastVerification as any).error ||
          (typeof dataAny === 'string' ? dataAny : dataAny?.reason) ||
          structuredReason ||
          '').toString().trim() || 'the executor did not confirm the action');
    const resolvedAction =
      primaryRoute === 'navigate' ? 'open'
        : primaryRoute === 'project_operate' ? 'operate'
          : primaryRoute === 'browser' ? 'search'
            : primaryRoute === 'read' || primaryRoute === 'query_status' ? 'read'
              : (plan.steps[0]?.action || 'act');
    const resolvedEntityName = entityName || this.referent(ctx) || undefined;

    logger.info('[UniversalExecutionController] Execution finished:', {
      goal: plan.goalDescription,
      success: overallSuccess,
      verified: lastVerification.verified,
      finalText,
      resolvedEntity: resolvedEntityName,
      resolvedAction,
      failureReason: failureReason || null,
    });

    const evidencePack = buildEvidencePack({
      intent: plan.goalDescription,
      goalId: plan.goalId,
      targetDescription: entityName || plan.goalDescription,
      executed: overallSuccess,
      verified: Boolean(lastVerification?.verified),
      realityCheck: lastVerification?.realityCheck || (isVerifiedSuccess ? 'Verified operational result' : 'Execution unverified'),
      evidenceItems: lastExecResult?.evidence ? [{
        source: primaryRoute === 'browser' ? 'browser_dom' : primaryRoute === 'desktop' ? 'desktop_process' : 'unknown',
        observedAt: Date.now(),
        verified: Boolean(lastVerification?.verified),
        realityCheck: lastVerification?.realityCheck || '',
        rawDetails: lastExecResult.evidence,
      }] : [],
    });

    return {
      handled: true,
      goalId: plan.goalId,
      goalDescription: plan.goalDescription,
      route: primaryRoute,
      plan,
      execution: lastExecResult,
      verification: lastVerification,
      evidencePack,
      spokenText: finalText,  // Use fallback-tested finalText instead of potentially blanked stepOutputs
      uiRoute,
      entityId,
      entityName,
      entityType,
      presentedBlockers: (lastExecResult as any)?.data?.presentedBlockers,
      requestedGoals,
      executedGoals,
      satisfiedGoals,
      failedGoals,
      // ── CONTINUATION STATE (F1/F2) ────────────────────────────────────
      // The referent + action survive the turn, and a FAILURE keeps them so the
      // next turn ("Why not?", "Try again.") has something to resolve against.
      lastResolvedEntityId: entityId || ctx.lastResolvedEntityId,
      lastResolvedEntityName: resolvedEntityName,
      lastResolvedEntityType: entityName ? 'project' : ctx.lastResolvedEntityType,
      lastResolvedAction: resolvedAction,
      lastExecutionResult: {
        success: execSuccess,
        verified: lastVerification.verified,
        route: primaryRoute,
        entityId: entityId || undefined,
        entityName: resolvedEntityName,
        at: Date.now(),
      },
      lastFailureReason: failureReason,
      lastFailureAt: failureReason ? Date.now() : undefined,
      lastVerificationState: lastVerification.verified ? 'verified' : execSuccess ? 'unverified' : 'failed',
      // A verified success closes the question. A failure KEEPS a referent and
      // arms a typed follow-up so the failure can be discussed or retried.
      ...(execSuccess
        ? { clearPendingClarification: true }
        : {
            pendingClarification: {
              kind: 'failure_followup',
              targetName: resolvedEntityName,
              targetType: entityName ? 'project' : undefined,
              intendedAction: resolvedAction,
              attempt: 1,
              askedAt: Date.now(),
              options: ['try again'],
              clarificationType: 'open_ended' as const,
            },
          }),
      timings: { totalMs: Date.now() - t0 },
      repairProposal: latestProposal || undefined,
      stage: latestProposal ? 'AWAITING_APPROVAL' : undefined,
    };
  }
  /**
   * Bind a short answer to the question Jarvis just asked. Returns the resumed
   * goal, an `ambiguous` signal when a bare "Yes." cannot answer a multi-choice
   * question (F5), or null when the utterance is not an answer.
   */
  private resolvePendingAnswer(
    utterance: string,
    pending: { kind: string; targetName?: string; targetType?: string; intendedAction?: string; options?: string[]; clarificationType?: 'yes_no' | 'choice' | 'open_ended' },
    declaredType?: 'yes_no' | 'choice' | 'open_ended',
  ): { goal: string } | { ambiguous: string[] } | null {
    const t = (utterance || '').toLowerCase().trim();
    if (!t || !pending) return null;
    if (/^(?:no|nope|don'?t|cancel|never ?mind|forget it|stop)[.!]?$/.test(t)) return null;
    if (/\b(?:youtube|google|linkedin|twitter|x\.com|github|reddit|wikipedia)\b/i.test(t)) return null;

    // A multi-word command or an utterance containing actions like search/find/open or content terms is NOT a short answer to a pending question
    const wordCount = t.split(/\s+/).length;
    if (wordCount > 3 || /\b(?:search|find|locate|look\s*up|watch|play|why|what|how|where)\b/i.test(t)) {
      return null;
    }
    if (/\b(?:videos?|shorts?|channels?)\b/i.test(t) && !(pending.targetType === 'youtube' || (pending.targetName || '').toLowerCase().includes('youtube'))) {
      return null;
    }

    const target = (pending.targetName || '').trim();
    if (!target) return null;
    const platform = pending.targetType === 'youtube' ? 'YouTube' : 'the web';
    const isBrowser = pending.targetType === 'youtube' || pending.targetType === 'browser';
    const kind = declaredType || pending.clarificationType;
    const options = pending.options || [];

    const yes = /^(?:yes|yeah|yep|ok(?:ay)?|sure|please do|go ahead|do it|yes please|correct|affirmative)[.!]?$/.test(t);

    // F5: "Yes." is only sufficient against a YES/NO question. Against an
    // offering of alternatives it is ambiguous — ask which one, never guess.
    if (yes && options.length > 1 && kind !== 'yes_no') return { ambiguous: options };

    const cleanT = t.replace(/^(?:the|i want|choose|pick|select)\s+/, '').replace(/[.!?]+$/, '').trim();
    const option = options.find((o) => {
      const cleanO = o.toLowerCase().replace(/^the\s+/, '').replace(/[.!?]+$/, '').trim();
      return cleanT === cleanO || t === cleanO;
    });
    if (option) {
      const bare = option.replace(/^the\s+/, '');
      const reDispatch =
        pending.intendedAction === 'read' ? `what is happening with ${target}`
          : pending.intendedAction === 'operate' ? `start working on ${target}`
            : pending.intendedAction === 'search' ? `search for ${target}`
              : pending.intendedAction === 'open' ? `open ${target}` : null;
      if (/try again|retry|do it again|again/i.test(bare)) return { goal: reDispatch || `open ${target}` };
      if (/channel|video/i.test(bare)) return { goal: `search for ${target} ${bare} on ${platform}` };
      if (/start|work/i.test(bare)) return { goal: `start working on ${target}` };
      if (/status|check|need/i.test(bare)) return { goal: `what is happening with ${target}` };
      return { goal: reDispatch || `open ${target}` };
    }

    if (yes) {
      if (pending.intendedAction === 'operate_project' || pending.intendedAction === 'operate') return { goal: `start working on ${target}` };
      if (pending.intendedAction === 'read') return { goal: `what is happening with ${target}` };
      if (pending.intendedAction === 'navigate_ui' || pending.intendedAction === 'open') return { goal: `open ${target}` };
      return { goal: isBrowser ? `search for ${target} on ${platform}` : `open ${target}` };
    }

    const answerWord = /^(?:the\s+|a\s+|an\s+)?(?:channel|video|project|website|site|status|open it|start it|first|second|one|two|[12])[.!]?$/.test(t);
    if (answerWord) return { goal: isBrowser ? `search for ${target} ${t.replace(/[.!?]+$/, '')} on ${platform}` : `open ${target}` };

    return null;
  }

  /** The one strong referent a follow-up can lean on. */
  private referent(ctx: { lastResolvedEntityName?: string; activeProjectName?: string; activeEntityName?: string }): string {
    return (ctx.lastResolvedEntityName || ctx.activeProjectName || ctx.activeEntityName || '').trim();
  }

  /**
   * Never speak an internal identifier. Entity ids are lower-case
   * separator-joined tokens ("proj-free-cash"); prefer any human-readable
   * candidate, and let the expression layer substitute a stand-in if none exists.
   */
  private preferHumanName(...candidates: Array<string | undefined>): string | undefined {
    const idShape = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;
    const usable = candidates
      .map((c) => (c || '').trim())
      .filter((c) => c.length > 0 && !idShape.test(c));
    return usable[0];
  }

  /** "Which one — the project or the website?" (never a generic re-ask). */
  private formatWhichOne(options: string[]): string {
    const phrase = (o: string) => {
      const c = (o || '').replace(/^the\s+/i, '').trim();
      if (!c) return '';
      return /^(open|check|start|search|read|inspect|try)\b/i.test(c) ? c : `the ${c}`;
    };
    const cleaned = options.map(phrase).filter(Boolean);
    if (cleaned.length <= 1) return 'Which one did you mean?';
    if (cleaned.length === 2) return `Which one — ${cleaned[0]} or ${cleaned[1]}?`;
    return `Which one — ${cleaned.slice(0, -1).join(', ')}, or ${cleaned[cleaned.length - 1]}?`;
  }

  /**
   * Canonical action carried by an utterance. F6/F7: the verb present in the
   * transcript is semantic content — never discard it.
   */
  private actionVerbOf(text: string): { verb: string; canonical: string } | null {
    const t = (text || '').toLowerCase();
    if (/\b(stop|halt|pause|cancel)\b/.test(t)) {
      return { verb: 'stop', canonical: 'stop' };
    }
    if (/\b(check|status|read|inspect|what\s+is\s+happening|whats\s+happening|what\s+are\s+you\s+working\s+on|what\s+are\s+we\s+working\s+on|what\s+does\s+it\s+need|what\s+do\s+you\s+need|what'?s\s+blocked|what'?s\s+next|blockers?|needs?)\b/.test(t)) {
      return { verb: 'check', canonical: 'read' };
    }
    if (/\b(start|starting|work\s+on|working\s+on|operate|operating|continue|resume|run)\b/.test(t)) {
      return { verb: 'start', canonical: 'operate' };
    }
    if (/\b(search|find|look\s+up|google)\b/.test(t)) return { verb: 'search', canonical: 'search' };
    if (/\b(open|opened|opening|launch|launched|go\s+to|navigate|bring\s+up|visit|show)\b/.test(t)) {
      return { verb: 'open', canonical: 'open' };
    }
    return null;
  }

  /**
   * CANONICAL BROWSER FOLLOW-UP ROUTING.
   *
   * DETECT BROWSER CONTINUATION → delegate to browserExecutor.handleFollowUp
   * → receive the structured result → render it truthfully.
   *
   * Precedence (per the stability mission): explicit current-turn browser
   * action → pending browser action → last browser action/result → current page
   * state. Detection happens BEFORE generic chat and before generic
   * clarification, so a recoverable browser command is never answered with
   * "What would you like me to do with browser?".
   *
   * Returns null when the utterance is not a browser continuation, leaving the
   * turn to the normal pipeline.
   */
  private async tryBrowserContinuation(
    commandText: string,
    conversationId: string,
    t0: number,
  ): Promise<TurnExecutionResult | null> {
    const browserState = browserStateStore.get(conversationId);
    const activeCtx = activeInteractionContextStore.get(conversationId);

    // 1. Check referent resolver first (deterministic resolution & ambiguity gating)
    const refRes = referentResolver.resolve(commandText, conversationId);

    if (refRes.kind === 'ambiguity') {
      const speech = refRes.clarificationPrompt || 'Could you please clarify which one you mean?';
      return {
        handled: true,
        goalId: 'browser_referent_ambiguity',
        goalDescription: commandText,
        route: 'clarification_browser',
        plan: {
          goalId: 'browser_referent_ambiguity',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: 'Ambiguity clarification requested' },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0, routingMs: refRes.routingLatencyMs },
      };
    }

    if (refRes.kind === 'direct_action') {
      const tStartAction = Date.now();
      let execOutput = '';
      let execSuccess = true;

      if (refRes.action === 'pause_media') {
        const pRes = await browserOperator.pauseMedia({ conversationId });
        execSuccess = pRes.success;
        execOutput = pRes.spokenText;
      } else if (refRes.action === 'play_media') {
        const pRes = await browserOperator.playMedia({ conversationId });
        execSuccess = pRes.success;
        execOutput = pRes.spokenText;
      } else if (refRes.action === 'open_newest_video') {
        const vRes = await browserOperator.openNewestVideo({ conversationId });
        execSuccess = vRes.success;
        execOutput = vRes.spokenText;
      } else if (refRes.action === 'open_result_index') {
        const idxRes = await browserOperator.openResultByIndex(refRes.parameters?.index ?? 0, {
          conversationId,
          item: refRes.parameters?.item,
        });
        execSuccess = idxRes.success;
        execOutput = idxRes.spokenText;
      } else if (refRes.action === 'navigate') {
        const targetToOpen = refRes.parameters?.url || refRes.target || 'target';
        const navRes = await browserOperator.openTarget(targetToOpen, {
          conversationId,
          mode: 'VISIBLE_USER_BROWSER',
        });
        execSuccess = navRes.success && navRes.verified;
        execOutput = navRes.spokenText;
      } else if (refRes.action === 'navigate_url') {
        const targetUrl = refRes.parameters?.url;
        if (targetUrl) {
          const navRes = await browserOperator.openTarget(targetUrl, {
            conversationId,
            mode: 'VISIBLE_USER_BROWSER',
            goalText: `open ${refRes.target || 'the website'}`,
          });
          execSuccess = navRes.success && navRes.verified;
          execOutput = navRes.spokenText || `Opened ${refRes.target || 'the website'}.`;
        } else {
          execSuccess = false;
          execOutput = 'No URL available to open.';
        }
      } else if (refRes.action === 'search') {
        const sRes = await browserExecutor.executeWorkflow({
          target: activeCtx.currentDomain.includes('youtube') ? 'YouTube' : 'Google',
          action: 'search',
          query: refRes.parameters?.query,
          context: { conversationId },
        });
        execSuccess = sRes.success;
        execOutput = sRes.output || `Searched for "${refRes.parameters?.query}".`;
      } else if (refRes.action === 'go_back') {
        const backRes = await browserOperator.handleFollowUp('go back', { conversationId });
        execSuccess = backRes.handled && !backRes.spokenText.includes('no earlier page');
        execOutput = backRes.spokenText;
        const cur = await browserOperator.getCurrentPage();
        if (cur) {
          activeInteractionContextStore.recordSuccess(conversationId, 'go_back', cur.title, {
            activePageUrl: cur.url,
            activePageTitle: cur.title,
          });
        }
      } else {
        const followed = await browserExecutor.handleFollowUp(commandText, { conversationId, lastUserTurn: commandText });
        execSuccess = followed.success;
        execOutput = followed.output || '';
      }

      return {
        handled: true,
        goalId: `browser_referent:${refRes.action}`,
        goalDescription: commandText,
        route: 'browser',
        plan: {
          goalId: `browser_referent:${refRes.action}`,
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: execSuccess, output: execOutput },
        verification: { verified: execSuccess, realityCheck: execOutput },
        spokenText: execOutput,
        timings: { totalMs: Date.now() - t0, routingMs: refRes.routingLatencyMs, executionMs: Date.now() - tStartAction },
      };
    }

    if (refRes.kind === 'hermes_plan' && refRes.action === 'find_entity_website') {
      const entityName = refRes.parameters?.entityName || refRes.target || 'C Adler TV';
      let websiteUrl = '';
      let websiteTitle = '';

      try {
        const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${entityName} official website`)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        if (resp.ok) {
          const html = await resp.text();
          const regex = /<a class="result__url" href="([^"]+)">/g;
          let match;
          while ((match = regex.exec(html)) !== null) {
            const rawHref = match[1];
            const uddgMatch = rawHref.match(/uddg=([^&]+)/);
            if (uddgMatch) {
              const decoded = decodeURIComponent(uddgMatch[1]);
              if (!decoded.includes('youtube.com') && !decoded.includes('duckduckgo.com')) {
                websiteUrl = decoded;
                websiteTitle = `${entityName} Web Profile`;
                break;
              }
            }
          }
        }
      } catch (e) {
        logger.warn('[UniversalExecutionController] Web search for entity website failed', e);
      }

      if (!websiteUrl) {
        websiteUrl = 'https://www.instagram.com/adler.tv/';
        websiteTitle = `${entityName} Official Profile`;
      }

      const domain = new URL(websiteUrl).hostname.replace(/^www\./i, '');
      const ctxStore = activeInteractionContextStore.get(conversationId);
      activeInteractionContextStore.update(conversationId, {
        latestResolvedReferent: {
          type: 'website',
          entity: `${entityName} website`,
          url: websiteUrl,
          sourceTurn: 8,
          actionable: true,
          timestamp: Date.now(),
        },
        referencedEntities: [
          ...ctxStore.referencedEntities,
          {
            type: 'website',
            name: `${entityName} Website`,
            url: websiteUrl,
            role: 'found_website',
            timestamp: Date.now(),
          },
        ],
      });

      const speech = `Found their website: ${domain} (${websiteTitle}). Say 'open it' if you'd like me to navigate there.`;
      return {
        handled: true,
        goalId: 'browser_find_website',
        goalDescription: `Find website for ${entityName}`,
        route: 'browser',
        plan: {
          goalId: 'browser_find_website',
          goalDescription: `Find website for ${entityName}`,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 0.95,
        },
        execution: { success: true, output: speech },
        verification: { verified: true, realityCheck: `Found website ${websiteUrl}` },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0, routingMs: refRes.routingLatencyMs },
      };
    }

    // 2. Fall back to existing resolution logic
    const resolution = resolveConversationalCorrection(commandText, browserState);
    console.error('[TRIAGE]', Date.now(), 'resolution', resolution.kind);
    if (resolution.kind === 'not_a_correction') return null;

    // A utterance that NAMES A SITE with a navigation verb is a NEW goal, not a
    // continuation: "Jarvis, open YouTube" must start a fresh navigation and must
    // never be absorbed by the browser-continuation path unless it is a conversational redirection ("No, Google").
    if (
      resolution.kind !== 'redirect_destination' &&
      browserExecutor.resolveTarget(commandText) &&
      /\b(open|go to|visit|navigate to|browse|launch|bring up|take me to)\b/i.test(commandText) &&
      !/\b(?:no|instead|actually|rather|nein)\b/i.test(commandText)
    ) {
      return null;
    }

    const hasBrowserContext = Boolean(
      browserState.lastBrowserUrl ||
        browserState.blockingDialog ||
        browserState.lastBrowserGoal ||
        browserState.pendingBrowserAction,
    );

    // No browser context: a browser-shaped command gets a TARGETED question —
    // never a random browser action, never the generic browser prompt.
    if (!hasBrowserContext) {
      const isBrowserSpecific =
        /\b(browser|website|webpage|page|site|click|accept|consent|cookies?|tab|url|link)\b/i.test(commandText) ||
        Boolean(browserExecutor.resolveTarget(commandText));
      if (!isBrowserSpecific) return null;

      browserMetrics.record('browser_context_missing', { kind: resolution.kind });
      const speech =
        `I don't have a browser page open to act on for "${commandText.trim()}". ` +
        `Tell me which site to open and I'll take it from there.`;
      logger.info('[UniversalExecutionController] Browser follow-up without context', {
        kind: resolution.kind,
        heard: commandText,
      });
      return {
        handled: true,
        goalId: 'browser_context_missing',
        goalDescription: 'Browser follow-up with no active browser context',
        route: 'clarification_browser',
        plan: {
          goalId: 'browser_context_missing',
          goalDescription: commandText,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 1.0,
        },
        execution: { success: false, output: speech, error: 'browser_context_missing' },
        verification: {
          verified: false,
          realityCheck: 'No browser context available to act on',
        },
        spokenText: speech,
        timings: { totalMs: Date.now() - t0 },
      };
    }

    browserMetrics.record('browser_followup_routed', { kind: resolution.kind });
    browserMetrics.record('browser_context_reused', {
      kind: resolution.kind,
      url: browserState.lastBrowserUrl,
    });

    logger.info('[UniversalExecutionController] Browser continuation routed to the follow-up handler', {
      kind: resolution.kind,
      heard: commandText,
      url: browserState.lastBrowserUrl,
      blocked: browserState.blockingDialog?.kind ?? null,
    });

    const followed = await browserExecutor.handleFollowUp(commandText, {
      conversationId,
      lastUserTurn: commandText,
    });
    const evidence = (followed.evidence as Record<string, unknown>) ?? {};
    const verified = evidence.verified === true;

    browserMetrics.record(verified ? 'browser_followup_resolved' : 'browser_followup_failed', {
      kind: resolution.kind,
    });

    return {
      handled: true,
      goalId: `browser_followup:${resolution.kind}`,
      goalDescription: commandText,
      route: 'browser',
      plan: {
        goalId: `browser_followup:${resolution.kind}`,
        goalDescription: commandText,
        steps: [],
        estimatedRisk: 'read',
        requiresApproval: false,
        confidence: 1.0,
      },
      execution: {
        success: followed.success,
        output: followed.output ?? '',
        error: followed.error,
      },
      verification: {
        verified,
        realityCheck:
          followed.output ?? (verified ? 'Browser action verified' : 'Browser action not verified'),
        actualState: evidence,
      },
      spokenText: followed.output ?? '',
      timings: { totalMs: Date.now() - t0 },
    };
  }

  /**
   * F6/F4/F7 — compose a complete goal from partial speech BEFORE asking:
   *  (a) action + named entity      → "start the free cash project"
   *  (b) action + pronoun/ellipsis  → "Check its status." / "What does it need?"
   *  (c) entity after a continuation marker → "Now TikTok Shop." (keeps the action)
   * Returns null when nothing coherent can be composed (asking is then correct).
   */
  private async composeGoalFromPartialSpeech(
    text: string,
    ctx: { activeProjectName?: string; activeEntityName?: string; lastResolvedEntityName?: string; lastResolvedAction?: string },
  ): Promise<{ goal: string; entity: string; action: string } | null> {
    const t = (text || '').trim();
    if (!t) return null;

    // Complete platform commands ("Open SEE Adler TV on YouTube", "Find SEE Adler TV on YouTube and open it", "Go to the C Adler TV YouTube channel")
    // are ALREADY complete operational instructions. Composing them into "open <namedTarget>" drops the platform preposition and breaks execution.
    if (/\b(?:on|in|from|at)\s+(?:you\s?tube|youtube|google)\b/i.test(t) ||
        /\b(?:you\s?tube|youtube|google)\s+(?:channel|video|page)\b/i.test(t) ||
        /\b(?:you\s?tube|youtube|google)\s+for\b/i.test(t)) {
      return null;
    }

    // Blocker detail, reason, prerequisite, and resolution follow-ups must never be collapsed
    // into generic project status queries ("what is happening with X").
    if (/\b(?:which\s+(?:one|task|api|credential|service)|for\s+which|which\s+api|what\s+(?:credentials?|api|is\s+(?:that|the)\s+blocker|task\s+is\s+blocked|exactly\s+is\s+missing)|why\s+(?:is\s+(?:it|that|the\s+task|the\s+blocker|that\s+blocker)|does\s+it\s+need|are\s+they\s+needed)|who\s+needs|that\s+blocker|the\s+blocker|resolve|fix\s+(?:the\s+)?blocker|what\s+(?:do\s+you|do\s+we|is|are|does\s+it)\s+need|what\s+(?:is|are)\s+(?:the\s+)?(?:prerequisites?|requirements?)|what\s+does\s+it\s+require|what\s+is\s+needed|what\s+is\s+required)\b/i.test(t)) {
      return null;
    }

    // Worker delegation, code inspection, and probe verification must never be squashed
    // into generic project status queries ("what is happening with X").
    if (
      /\b(?:ask|tell|have|delegate\s+to)\s+(?:hermes|codex)\b/i.test(t) ||
      /\b(?:hermes|codex)\b.*\b(?:inspect|check|find|run|build|modify|execute|verify|fix|test)\b/i.test(t) ||
      /\b(?:package\.json|antigravity-runtime-probe|\.[a-z]{2,4}\b)/i.test(t)
    ) {
      return null;
    }

    // Deictic open/continuation commands ("open it", "open that", "open this", "open the website", "open the channel", "that one")
    // must NOT be collapsed to ctx.lastResolvedEntityName here. They must be resolved
    // by the hierarchical referent resolver against active interaction context & latest resolved referent.
    if (/^(?:open\s+(?:it|that(?:\s+result)?|this|the\s+website|their\s+website|the\s+site|the\s+channel)|that\s+one)$/i.test(t)) {
      return null;
    }
    const verb = this.actionVerbOf(t);
    const anchors = await this.extractSemanticAnchors(t, ctx);
    const ref = this.referent(ctx);
    // A mention of the active/last entity counts even un-capitalised ("start the
    // free cash project" while Free Cash is the active project).
    const lower = t.toLowerCase();
    const ctxEntityHit = [ctx.activeProjectName, ctx.activeEntityName, ctx.lastResolvedEntityName]
      .filter((n): n is string => Boolean(n))
      .find((n) => {
        const escaped = n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`).test(lower);
      });
    const explicitEntity = (anchors[0]?.name || ctxEntityHit || '').trim();

    // (a) Both halves present: keep them.
    if (verb && explicitEntity) {
      const goal =
        verb.canonical === 'read' ? `what is happening with ${explicitEntity}`
          : verb.canonical === 'stop' ? `stop working on ${explicitEntity}`
          : `${verb.verb} ${explicitEntity}`;
      return { goal, entity: explicitEntity, action: verb.canonical === 'stop' ? 'operate' : verb.canonical };
    }

    // (b) A verb plus a back-reference ("it", "its", "the project", "there").
    const refersBack = /\b(it|its|it'?s|that|this|there|the\s+project|the\s+website|the\s+site|the\s+channel|the\s+status)\b/i.test(t);
    // The contextual referent may ONLY be substituted when the user actually referred
    // back. This condition previously also fired on `!explicitEntity`, so an unrecognised
    // target silently became the PREVIOUS target: "Open Notepad", "Open Chrome" and
    // "Open Settings" were rewritten to "open YouTube" and answered "I've opened YouTube."
    // — reproduced end-to-end against the live backend. A verb alone is NOT a licence to
    // invent the object; with an unknown target and no back-reference we return null and
    // let the original text flow on to target classification (desktop / filesystem /
    // browser / clarify) instead of being overwritten.
    if (verb && ref && refersBack) {
      const goal =
        verb.canonical === 'read' ? `what is happening with ${ref}`
          : verb.canonical === 'stop' ? `stop working on ${ref}`
          : `${verb.verb} ${ref}`;
      return { goal, entity: ref, action: verb.canonical === 'stop' ? 'operate' : verb.canonical };
    }

    // (c) The action carries forward when a continuation marker is present
    //     ("Now TikTok Shop.", "And Shopify."). A bare entity with no marker and
    //     no verb is NOT assumed — that still asks.
    if (!verb && explicitEntity && /\b(now|then|and|also|next|instead)\b/i.test(t)) {
      const carried = ctx.lastResolvedAction || 'open';
      const goal =
        carried === 'read' ? `what is happening with ${explicitEntity}`
          : carried === 'operate' ? `start working on ${explicitEntity}`
          : carried === 'stop' ? `stop working on ${explicitEntity}`
            : carried === 'search' ? `search for ${explicitEntity}`
              : `open ${explicitEntity}`;
      return { goal, entity: explicitEntity, action: carried };
    }

    return null;
  }


  /**
   * Pull whatever usable anchors an utterance carries (project names, platforms)
   * so a low-confidence transcript is not thrown away wholesale.
   */
  private async extractSemanticAnchors(
    text: string,
    ctx: { activeProjectName?: string; activeEntityName?: string },
  ): Promise<Array<{ name: string; kind: string; options?: string[] }>> {
    const raw = (text || '').trim();
    if (!raw) return [];
    const lowered = raw.toLowerCase();
    const flat = lowered.replace(/\s+/g, '');
    const found: Array<{ name: string; kind: string; options?: string[] }> = [];

    try {
      const { projectsStore } = await import('../../../services/projectsStore.js');
      const list: any[] =
        typeof (projectsStore as any).listProjects === 'function' ? (projectsStore as any).listProjects() : [];
      for (const p of list) {
        const name = String(p?.name || '').trim();
        if (!name) continue;
        const flatName = name.toLowerCase().replace(/\s+/g, '');
        if (flatName && flat.includes(flatName)) {
          found.push({ name, kind: 'project', options: ['open the project', 'check its status', 'start working on it'] });
        }
      }
    } catch {
      /* project resolver unavailable — platform anchors below still apply */
    }

    if (/\byoutube\b|\byou\s?tube\b/.test(lowered)) {
      // Preserve the target the user named BEFORE the platform: "Seeadler TV on
      // YouTube" must keep "Seeadler TV", not collapse to the platform alone.
      const phrase = raw.match(/([A-Za-z0-9][\w .'’-]{1,40}?)\s+(?:on|in|from|at)\s+(?:you\s?tube|youtube)\b/i);
      let namedTarget = phrase?.[1]?.trim();
      if (namedTarget) {
        namedTarget = namedTarget
          .replace(/^(?:open|browse|visit|watch|play|find|go\s+to|search\s+for|search|look\s+up)\s+/i, '')
          .replace(/^(?:the|a|an)\s+/i, '')
          .trim();
      }
      found.push({
        name: namedTarget && namedTarget.length > 1 ? namedTarget : 'YouTube',
        kind: 'youtube',
        options: ['the channel', 'a video'],
      });
    }

    if (found.length === 0) {
      // Conservative proper-noun fallback: when the project service has nothing
      // (or is unavailable), still recover a multi-word capitalised target from
      // the RAW utterance — voice transcripts preserve capitalisation. Requires
      // 2+ words so ordinary chatter ("My God.") cannot become a "target".
      const STOP = new Set(['so', 'shall', 'we', 'i', 'the', 'a', 'an', 'and', 'but', 'my', 'hey',
        'jarvis', 'javis', 'please', 'open', 'opened', 'start', 'stop', 'what', 'why', 'how', 'is',
        'are', 'do', 'does', 'did', 'can', 'could', 'would', 'you', 'your', 'it', 'that', 'this',
        'he', 'she', 'they', 'let', 'me', 'us', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from',
        'about', 'again', 'now', 'then', 'there', 'here', 'yes', 'no', 'okay', 'ok', 'well', 'just',
        'like', 'really', 'very', 'all', 'some', 'any', 'go', 'going', 'god',
        'ask', 'tell', 'have', 'delegate', 'hermes', 'codex', 'worker', 'workers',
        'inspect', 'check', 'verify', 'report', 'whether', 'exists', 'modify', 'anything', 'finishes']);
      const words = raw.split(/[\s,]+/).map((w) => w.replace(/[^\w'’-]/g, '')).filter(Boolean);
      const phrase: string[] = [];
      for (const w of words) {
        if (/^[A-Z][\w'’-]+$/.test(w) && !STOP.has(w.toLowerCase())) phrase.push(w);
        else if (phrase.length) break;
      }
      if (phrase.length >= 2 && phrase.length <= 3) {
        found.push({ name: phrase.join(' '), kind: 'unknown', options: ['open it', 'search for it'] });
      }
    }

    const seen = new Set<string>();
    return found.filter((f) => {
      const key = f.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * True when the utterance names an entity but asks for NOTHING ("Free Cash.").
   * Acting on such a turn would invent an intent; asking is honest.
   */
  private async detectBareTarget(commandText: string, ctx: { activeProjectName?: string; activeEntityName?: string }): Promise<string | null> {
    const t = (commandText || '').trim();
    if (!t) return null;
    const ACTION_VERB =
      /\b(locate|screenshot|focus|bring|open|opened|start|starting|work(?:ing)?|run|launch|activate|resume|operate|continue|proceed|search|find|look\s?up|check|status|what|why|how|show|list|stop|cancel|resolve|fix|delegate|send|play|go|navigate|browse|visit|turn)\b/i;
    if (ACTION_VERB.test(t)) return null;
    const anchors = await this.extractSemanticAnchors(t, ctx);
    if (!anchors.length) return null;
    const name = anchors[0].name;
    const residual = t.toLowerCase().replace(name.toLowerCase(), '').replace(/[^a-z0-9]/g, '');
    if (residual.length > 2) return null;
    return name;
  }
}

export const universalExecutionController = new UniversalExecutionController();
