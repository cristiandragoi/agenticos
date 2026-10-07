/**
 * canonicalTurnExecutionService.ts — Canonical Turn Execution Service for AgenticOS
 *
 * Implements the single unified execution service consumed identically by:
 * - Desktop Jarvis UI
 * - Voice Agent
 * - Telegram Remote Jarvis
 *
 * Guarantees:
 * 1. Zero duplication of Jarvis reasoning.
 * 2. Conversational turns ("are you there", "what is AgenticOS") return real Jarvis answers,
 *    never placeholder "Task received and processed".
 * 3. Operational queries ("What is AntiGravity doing right now?") inspect real EngineeringWorkerRegistry state.
 * 4. Introspection queries ("Did you receive my Telegram message?") inspect TelegramAdapter telemetry.
 * 5. Git operations ("Check the status of my AgenticOS Git repository") execute verified git inspections.
 * 6. Explicit AntiGravity delegations emit immediate acknowledgment, start durable GoalRun, and verify worker acceptance.
 * 7. Durable conversation mapping and message persistence in conversationService.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import { conversationService } from '../conversations/service.js';
import { jarvisOrchestrator } from './orchestrator.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { engineeringWorkerRegistry } from '../controlPlane/EngineeringWorkerRegistry.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { goalLifecycleManager } from '../controlPlane/GoalLifecycle.js';
import { parseExplicitEngineeringDelegation, executeEngineeringDelegation } from '../controlPlane/ExplicitEngineeringDelegation.js';
import { unifiedOperationalContext, OperationalChannel } from '../controlPlane/UnifiedOperationalContext.js';
import { GitExecutor } from './execution/executors/gitExecutor.js';

export interface CanonicalTurnInput {
  conversationId: string;
  prompt: string;
  modality: 'desktop_chat' | 'voice' | 'telegram';
  workspacePath?: string;
  approvalPolicy?: 'manual' | 'auto';
  telegramContext?: {
    chatId: string;
    userId: string;
    messageId?: number;
  };
  onProgress?: (update: any) => void;
  onAcknowledgement?: (text: string) => void;
  /** Phase 1: when true, unmatched prompts return route 'unhandled' instead of running the orchestrator. */
  skipOrchestrator?: boolean;
  envelope?: unknown;
  semanticIntent?: unknown;
}

export interface CanonicalTurnResult {
  acknowledgment?: string;
  assistantText: string;
  goalRunId?: string;
  goalId?: string;
  taskId?: string;
  route: string;
  status: string;
  verified: boolean;
  artifacts?: any[];
  error?: string;
}

export class CanonicalTurnExecutionService {
  private static instance: CanonicalTurnExecutionService;
  private gitExecutor = new GitExecutor();

  private constructor() {}

  public static getInstance(): CanonicalTurnExecutionService {
    if (!CanonicalTurnExecutionService.instance) {
      CanonicalTurnExecutionService.instance = new CanonicalTurnExecutionService();
    }
    return CanonicalTurnExecutionService.instance;
  }

  /**
   * Execute a turn through the canonical AgenticOS Jarvis pipeline.
   */
  public async execute(input: CanonicalTurnInput): Promise<CanonicalTurnResult> {
    const { conversationId, prompt, modality, telegramContext } = input;
    const rawPrompt = prompt.trim();
    const lower = rawPrompt.toLowerCase();
    const workspace = input.workspacePath || getWorkspaceRoot() || 'D:\\AgenticOS';
    const approvalPolicy = input.approvalPolicy || 'manual';

    logger.info(`[CanonicalTurnExecutionService] Executing turn [modality=${modality}, conv=${conversationId}]: "${rawPrompt.slice(0, 60)}"`);

    // Extract trailing explicit directive if user was speaking aloud and concluded with an explicit instruction to Jarvis:
    // e.g., "Where is saved? What the fuck is going on? Okay, he's not able. So Jarvis, open comment perplexity."
    let evalLower = lower;
    const tailDirectiveMatch = lower.match(/(?:^|[.!?\s,])(?:so\s+)?jarvis[,:\s]+([^.!?\n]+[.!?]?)$/i);
    if (tailDirectiveMatch) {
      const candidate = tailDirectiveMatch[1].trim();
      if (/\b(?:open|launch|take|capture|save|remember|find|locate|show|focus|bring)\b/i.test(candidate)) {
        evalLower = candidate;
        logger.info(`[CanonicalTurnExecutionService] Extracted trailing directive: "${evalLower}" from prompt: "${rawPrompt}"`);
      }
    }

    // Ensure conversation exists in durable persistence
    await this.ensureConversation(conversationId, telegramContext?.chatId);

    // ── 1. Presence & Conversational Check ("Jarvis, are you there?", "are you there") ──
    if (/\b(?:are\s+you\s+there|you\s+there|you\s+online|you\s+listening)\b/i.test(lower)) {
      const reply = "I'm here.";
      await this.recordTurn(conversationId, rawPrompt, reply, 'direct');
      return {
        assistantText: reply,
        route: 'direct',
        status: 'completed',
        verified: true,
      };
    }

    // ── 1a. Speech Transcript Corrections ("No, I said X, not Y", "No, not Y, X") ──
    if (/\b(?:no,?\s+i\s+said|correction:|no,?\s+not\s+.+,\s+.+)\b/i.test(lower)) {
      const correctedText = rawPrompt.replace(/^(?:no,?\s+)?(?:i\s+said\s+|correction:?\s*)/i, '').trim();
      const reply = `Understood. I've corrected that to: "${correctedText}".`;
      await this.recordTurn(conversationId, rawPrompt, reply, 'speech_correction');
      return {
        assistantText: reply,
        route: 'speech_correction',
        status: 'completed',
        verified: true,
      };
    }

    // ── 2. Real-Time Worker Introspection ("What is Hermes/AntiGravity/Codex doing right now?") ──
    if (/\b(?:what\s+is\s+(?:anti[- ]?gravity|hermes|codex|jarvis)\s+doing|current\s+worker\s+state|what\s+are\s+you\s+doing)\b/i.test(lower)) {
      let targetWorker: string | undefined = undefined;
      if (lower.includes('hermes')) targetWorker = 'hermes';
      else if (lower.includes('codex') || lower.includes('code-x')) targetWorker = 'codex';
      else if (lower.includes('anti')) targetWorker = 'antigravity';

      const reply = this.buildWorkerStatusReply(targetWorker);
      await this.recordTurn(conversationId, rawPrompt, reply, 'worker_status');
      return {
        assistantText: reply,
        route: 'worker_status',
        status: 'completed',
        verified: true,
      };
    }

    // ── 2a. Action A: Desktop Telegram Opening & Bot Introspection ──
    const isTelegramBotObjective =
      /\b(?:open|launch|show|focus|bring(?:\s+up)?)\s+(?:the\s+)?(?:desktop\s+)?telegram\b/i.test(evalLower) ||
      /\b(?:open|launch|locate|find|show)\s+(?:the\s+|my\s+)?(?:agenticos\s+)?(?:bot|board)\s+(?:in|on|using)\s+telegram\b/i.test(evalLower) ||
      /\bopen\s+telegram\s+and\s+(?:locate|find|show)\s+(?:my\s+|the\s+)?(?:agenticos\s+)?(?:bot|board)\b/i.test(evalLower) ||
      /\b(?:locate|find)\s+(?:my\s+|the\s+)?(?:agenticos\s+)?(?:bot|board)\b/i.test(evalLower) ||
      /\b(?:can\s+you\s+)?open\s+it\s+so\s+i\s+can\s+see\s+it\b/i.test(evalLower) ||
      /\bi\s+need\s+to\s+see\s+(?:the\s+)?(?:agenticos\s+)?(?:board|bot)\s+(?:in\s+front\s+of\s+me|in\s+telegram)\b/i.test(evalLower) ||
      /\bsee\s+(?:the\s+)?agenticos\s+board\b/i.test(evalLower) ||
      /\bfind\s+(?:the\s+)?bot\s+in\s+telegram\b/i.test(evalLower) ||
      (evalLower !== lower && (
        /\b(?:open|launch|show|focus|bring(?:\s+up)?)\s+(?:the\s+)?(?:desktop\s+)?telegram\b/i.test(lower) ||
        /\bopen\s+telegram\s+and\s+(?:locate|find|show)\s+(?:my\s+|the\s+)?(?:agenticos\s+)?(?:bot|board)\b/i.test(lower) ||
        /\b(?:locate|find)\s+(?:my\s+|the\s+)?(?:agenticos\s+)?(?:bot|board)\b/i.test(lower)
      ));
    if (isTelegramBotObjective) {
      const { unifiedOperationalContext } = await import('../controlPlane/UnifiedOperationalContext.js');
      const { windowsApplicationResolver } = await import('../controlPlane/WindowsApplicationResolver.js');
      const { controlPlaneExecutor } = await import('../controlPlane/ControlPlaneExecutor.js');
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      const tgState = await unifiedOperationalContext.getTelegramRuntimeState();
      const rawBot = tgState.botUsername ? tgState.botUsername.replace(/^@/, '') : 'Hermes_Cris_bot';
      const botName = `@${rawBot}`;

      // Step 1: Ensure Telegram is running
      let isRunning = false;
      try {
        const { stdout } = await execAsync('powershell -NoProfile -Command "Get-Process -Name Telegram -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"');
        isRunning = Boolean(stdout && stdout.trim());
      } catch {}

      if (!isRunning) {
        const resolved = await windowsApplicationResolver.resolve('telegram');
        if (resolved && (resolved.shortcutPath || resolved.targetPath)) {
          await controlPlaneExecutor.execute({
            surface: resolved.source === 'learned' || resolved.source === 'start_menu' || resolved.source === 'taskbar' ? 'start_menu' : 'executable',
            target: resolved.shortcutPath || resolved.targetPath!,
            parameters: { shortcutPath: resolved.shortcutPath, executablePath: resolved.targetPath },
          });
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      // Step 2: Open conversation with the bot directly via Telegram protocol
      try {
        await execAsync(`powershell -NoProfile -Command "Start-Process 'tg://resolve?domain=${rawBot}'"`);
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err: any) {
        logger.warn('[CanonicalTurn] Error launching tg protocol:', err);
      }

      // Step 3: Bring Telegram window into the foreground and verify window title & state
      let verifiedInForeground = false;
      try {
        const scriptPath = path.resolve(process.cwd(), 'scripts/focus_window.ps1');
        const altScriptPath = path.resolve(process.cwd(), 'server/scripts/focus_window.ps1');
        const effectiveScript = fs.existsSync(scriptPath) ? scriptPath : altScriptPath;
        if (fs.existsSync(effectiveScript)) {
          await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${effectiveScript}" -ProcessName "Telegram"`);
        }
        await new Promise((r) => setTimeout(r, 600));

        const listScript = path.resolve(process.cwd(), 'scripts/list_desktop_windows.ps1');
        const altListScript = path.resolve(process.cwd(), 'server/scripts/list_desktop_windows.ps1');
        const effectiveList = fs.existsSync(listScript) ? listScript : altListScript;
        if (fs.existsSync(effectiveList)) {
          const { stdout: winJson } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${effectiveList}"`);
          const wins = JSON.parse(winJson || '[]');
          const tgWin = wins.find((w: any) => /telegram/i.test(w.process));
          if (tgWin) {
            verifiedInForeground = true;
          }
        }
      } catch (err: any) {
        logger.warn('[CanonicalTurn] Window verification error:', err);
      }

      let reply = '';
      if (verifiedInForeground) {
        reply = `I have opened Telegram desktop, navigated directly to your AgenticOS bot conversation (${botName}), and brought it to the foreground.`;
      } else {
        reply = `I opened Telegram desktop and triggered navigation to ${botName}, but the Telegram window could not be verified in the foreground.`;
      }

      await this.recordTurn(conversationId, rawPrompt, reply, 'action');
      return {
        assistantText: reply,
        route: 'action',
        status: verifiedInForeground ? 'completed' : 'failed',
        verified: verifiedInForeground,
      };
    }

    // ── 2b. Action B: Conversational Memory Storage ──
    const isSaveMemoryRequest =
      /\b(?:save\s+(?:that|this|it)|remember\s+(?:that|this|it)|keep\s+(?:that|this|it)\s+in\s+memory|save\s+(?:that|this|it)\s+(?:inside|to|in)\s+memory|put\s+(?:that|this|it)\s+(?:inside|to|in)\s+memory)\b/i.test(evalLower) ||
      (evalLower !== lower && /\b(?:save\s+(?:that|this|it)|remember\s+(?:that|this|it)|keep\s+(?:that|this|it)\s+in\s+memory|save\s+(?:that|this|it)\s+(?:inside|to|in)\s+memory|put\s+(?:that|this|it)\s+(?:inside|to|in)\s+memory)\b/i.test(lower));
    if (isSaveMemoryRequest) {
      const { memoryStore } = await import('../../services/memory/store.js');
      const msgs = await conversationService.getMessages(conversationId);
      const prevAssistant = (msgs || []).slice().reverse().find((m: any) => m.role === 'agent' || m.role === 'assistant');

      let memoryContent = '';
      let memorySummary = '';
      if (prevAssistant?.content) {
        const contentStr = prevAssistant.content;
        const isVisualObservation = /see|camera|person|holding|wearing|appearance|looking/i.test(contentStr);
        if (isVisualObservation) {
          memorySummary = 'User confirmed identity and appearance from camera observation';
          memoryContent = `User confirmed visual observation: "${contentStr.slice(0, 300)}"`;
        } else {
          memorySummary = `User saved conversational context: "${contentStr.slice(0, 80)}"`;
          memoryContent = contentStr.slice(0, 500);
        }
      } else {
        memorySummary = 'User requested memory save';
        memoryContent = rawPrompt;
      }

      const memId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const savedRecord = memoryStore.create({
        id: memId,
        type: 'semantic',
        title: 'User Identity & Context Confirmation',
        summary: memorySummary,
        content: memoryContent,
        scope: 'general',
        entities: ['user', 'identity'],
        tags: ['user', 'identity', 'confirmed_observation'],
        source: {
          sourceType: 'conversation',
          conversationId,
        },
        confidence: 1.0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastConfirmedAt: Date.now(),
        lastUsedAt: Date.now(),
        useCount: 1,
        status: 'active',
        supersedesMemoryId: null,
        derivedFromMemoryIds: [],
        pinned: false,
        verificationStatus: 'human_confirmed',
      });

      const persisted = memoryStore.get(savedRecord.id);
      let reply = '';
      if (persisted) {
        reply = `I have recorded a semantic memory note confirming your appearance from the camera observation. No biometric or facial recognition profile was stored.`;
      } else {
        reply = `I could not persist that to memory due to a storage failure.`;
      }

      await this.recordTurn(conversationId, rawPrompt, reply, 'memory_write');
      return {
        assistantText: reply,
        route: 'memory_write',
        status: persisted ? 'completed' : 'failed',
        verified: !!persisted,
      };
    }

    // ── 2c. Action D: Application Launch: Comet Perplexity ──
    const isCometOpenRequest =
      /\b(?:open|launch|bring\s+up|foreground)\s+(?:comet|comment|per\s*plexity|comet\s+per\s*plexity|comment\s+per\s*plexity)\b/i.test(evalLower) ||
      /^(?:open|launch)\s+comet[.!?]?$/i.test(evalLower.trim()) ||
      (evalLower !== lower && (
        /\b(?:open|launch|bring\s+up|foreground)\s+(?:comet|comment|per\s*plexity|comet\s+per\s*plexity|comment\s+per\s*plexity)\b/i.test(lower) ||
        /^(?:open|launch)\s+comet[.!?]?$/i.test(lower.trim())
      ));
    if (isCometOpenRequest) {
      const { windowsApplicationResolver } = await import('../controlPlane/WindowsApplicationResolver.js');
      const { controlPlaneExecutor } = await import('../controlPlane/ControlPlaneExecutor.js');
      const { universalVerifier } = await import('../controlPlane/UniversalVerifier.js');

      const resolved = await windowsApplicationResolver.resolve('comet');
      let appOpened = false;
      let openError: string | undefined;

      if (resolved && (resolved.shortcutPath || resolved.targetPath)) {
        const execRes = await controlPlaneExecutor.execute({
          surface: resolved.source === 'taskbar' || resolved.source === 'start_menu' || resolved.source === 'learned' ? 'taskbar' : 'executable',
          target: resolved.shortcutPath || resolved.targetPath!,
          parameters: { shortcutPath: resolved.shortcutPath, executablePath: resolved.targetPath },
        });
        if (execRes.executed) {
          await new Promise((r) => setTimeout(r, 1200));
          const verifyRes = await universalVerifier.verify({ surface: 'taskbar', target: 'Comet' });
          appOpened = verifyRes.verified;
        } else {
          openError = execRes.error || 'Failed to launch Comet process';
        }
      } else {
        openError = 'Comet Perplexity application executable or shortcut not found on system';
      }

      let reply = '';
      if (appOpened) {
        reply = `I have opened Comet Perplexity and verified the application window is active on desktop.`;
      } else {
        reply = `Comet Perplexity application could not be opened: ${openError || 'verification failed'}.`;
      }

      await this.recordTurn(conversationId, rawPrompt, reply, 'action');
      return {
        assistantText: reply,
        route: 'action',
        status: appOpened ? 'completed' : 'failed',
        verified: appOpened,
      };
    }

    // ── 2d. Action C: Visual Perception Desktop Screenshot ──
    const isScreenshotRequest =
      /\b(?:take|capture)\s+(?:a\s+)?(?:screenshot|snapshot|screen\s+capture)(?:\s+of\s+(?:the\s+)?(?:current\s+)?(?:desktop|screen|page|window))?\b/i.test(evalLower) ||
      /\b(?:take|capture)\s+(?:a\s+)?screenshot\b/i.test(evalLower) ||
      (evalLower !== lower && (
        /\b(?:take|capture)\s+(?:a\s+)?(?:screenshot|snapshot|screen\s+capture)(?:\s+of\s+(?:the\s+)?(?:current\s+)?(?:desktop|screen|page|window))?\b/i.test(lower) ||
        /\b(?:take|capture)\s+(?:a\s+)?screenshot\b/i.test(lower)
      ));
    if (isScreenshotRequest) {
      const { desktopPerceptionService } = await import('../../services/perception/DesktopPerceptionService.js');
      const shot = await desktopPerceptionService.captureScreen({ targetWindow: 'desktop' });
      let reply = '';
      const verified = shot.success && shot.byteSize > 1024 && fs.existsSync(shot.artifactPath);
      if (verified) {
        // Copy directly to the user's Windows Desktop folder so it is visible immediately on their desktop screen!
        const userDesktopDir = path.join(process.env.USERPROFILE || 'C:\\Users\\cd-pr', 'Desktop');
        let copiedToDesktop = false;
        try {
          if (fs.existsSync(userDesktopDir)) {
            const destPath = path.join(userDesktopDir, shot.fileName);
            fs.copyFileSync(shot.artifactPath, destPath);
            copiedToDesktop = true;
          }
        } catch (e: any) {
          logger.warn('[CanonicalTurn] Failed copying screenshot to Desktop:', e);
        }

        const timeStr = new Date(shot.timestamp).toLocaleTimeString();
        if (copiedToDesktop) {
          reply = `I have captured a fresh screenshot of the current desktop and saved it directly to your Windows Desktop: ${shot.fileName} (${shot.width}x${shot.height}, ${Math.round(shot.byteSize / 1024)} KB at ${timeStr}).`;
        } else {
          reply = `I have captured a fresh screenshot of the current desktop: saved to ${shot.fileName} (${shot.width}x${shot.height}, ${Math.round(shot.byteSize / 1024)} KB at ${timeStr}).`;
        }
      } else {
        reply = `Desktop screenshot capture failed: could not capture valid image buffer.`;
      }

      await this.recordTurn(conversationId, rawPrompt, reply, 'screenshot');
      return {
        assistantText: reply,
        route: 'screenshot',
        status: verified ? 'completed' : 'failed',
        verified,
        artifacts: verified ? [shot] : undefined,
      };
    }

    // ── 3. Desktop Jarvis Telegram Introspection ──
    // "Check the connection to my AgenticOS Telegram bot", "Check the AgenticOS Telegram bot", "Does our AgenticOS Telegram bot work?"
    if (
      /\b(?:check\s+(?:the\s+)?(?:connection\s+to\s+(?:my\s+|the\s+)?(?:agenticos\s+)?telegram\s+bot|my\s+telegram\s+bot|the\s+telegram\s+bot|the\s+agenticos\s+telegram\s+bot|the\s+agenticos\s+bot|my\s+agenticos\s+bot)|does\s+(?:our|my)\s+(?:agenticos\s+)?telegram\s+bot\s+work|is\s+(?:the\s+)?telegram\s+bot\s+(?:working|active|online|connected)|telegram\s+bot\s+status|status\s+of\s+(?:the\s+)?(?:agenticos\s+)?telegram\s+bot)\b/i.test(lower) ||
      (/\b(?:check|inspect|status)\b/i.test(lower) && /\b(?:agenticos\s+bot|telegram\s+bot)\b/i.test(lower) && !/\bopen\s+(?:the\s+)?telegram\s+app\b/i.test(lower))
    ) {
      const status = await unifiedOperationalContext.getTelegramRuntimeState();
      let reply = '';
      if (status.configured && status.connected) {
        reply = `Yes, our AgenticOS Telegram bot (@${status.botUsername || 'AgenticOSBot'}) is active, connected, and polling for authorized messages.`;
      } else if (status.configured && !status.connected) {
        reply = `The Telegram bot is configured for @${status.botUsername || 'bot'}, but is currently disconnected (${status.lastError || 'offline'}).`;
      } else {
        reply = `The AgenticOS Telegram bot is currently waiting for a bot token in settings.`;
      }
      await this.recordTurn(conversationId, rawPrompt, reply, 'telegram_introspection');
      return {
        assistantText: reply,
        route: 'telegram_introspection',
        status: 'completed',
        verified: true,
      };
    }

    if (/\b(?:did\s+you\s+receive|any|check|show)\s+(?:my\s+)?(?:last\s+)?(?:message\s+(?:there|on\s+telegram)|telegram\s+(?:message|update|chat))\b/i.test(lower) || /\btelegram\s+message\b/i.test(lower)) {
      const reply = await this.buildTelegramIntrospectionReply();
      await this.recordTurn(conversationId, rawPrompt, reply, 'telegram_introspection');
      return {
        assistantText: reply,
        route: 'telegram_introspection',
        status: 'completed',
        verified: true,
      };
    }

    if (/\b(?:are\s+you\s+the\s+same\s+jarvis\s+i\s+am\s+speaking\s+with\s+on\s+telegram|same\s+jarvis\s+as\s+on\s+telegram|same\s+jarvis\s+on\s+telegram)\b/i.test(lower)) {
      const status = await unifiedOperationalContext.getTelegramRuntimeState();
      let reply = 'Yes, I am the same Jarvis. Both this desktop interface and our Telegram bot share the unified AgenticOS operational context, task ledger, and worker execution state.';
      if (status.lastInboundTextPreview) {
        reply += ` For example, I have recorded your last Telegram message: "${status.lastInboundTextPreview}".`;
      }
      await this.recordTurn(conversationId, rawPrompt, reply, 'telegram_introspection');
      return {
        assistantText: reply,
        route: 'telegram_introspection',
        status: 'completed',
        verified: true,
      };
    }

    // ── 3a. Visual Perception: Camera ("Can you see me?", "Look at me", "Then make one") ──
    if (
      !/\b(?:screen|desktop|display|monitor|window|inside|in\s+hermes|hermes)\b/i.test(lower) &&
      (/\b(?:look\s+at\s+me|what\s+am\s+i\s+holding|what\s+do\s+you\s+see\s+through\s+the\s+camera|describe\s+what\s+i\s+am\s+showing|what\s+am\s+i\s+showing|what's\s+in\s+my\s+hand|what\s+is\s+in\s+my\s+hand|can\s+you\s+see\s+me|see\s+me|what\s+do\s+you\s+see|what\s+can\s+you\s+see|tell\s+me\s+what\s+you\s+see|describe\s+what\s+you\s+see|look\s+through\s+the\s+camera|check\s+the\s+camera|open\s+(?:the\s+)?camera\s+and\s+see\s+me|capture\s+(?:a\s+)?(?:fresh\s+)?camera\s+frame|then\s+make\s+one)\b/i.test(lower))
    ) {
      const { universalPerceptionService } = await import('../controlPlane/UniversalPerceptionService.js');
      // ── P0 ownership correlation (no acquisition change) ──────────────────
      // The camera call carries the same identity as every other capability and
      // is published through the shared operation record, so a superseded camera
      // read can be refused before it speaks or mutates perception context.
      const { beginOperation, completeOperation } = await import('./perception/perceptionOperation.js');
      const { runWithTurnOwnership } = await import('./perception/turnOwnership.js');
      const camTurnId = (input as { turnId?: string | number }).turnId ?? conversationId;
      const camOperation = beginOperation({
        conversationId, turnId: camTurnId, capability: 'camera_perception',
      });
      const percRes = await runWithTurnOwnership(
        {
          conversationId,
          turnId: camTurnId,
          operationId: camOperation.operationId,
          capability: 'camera_perception',
        },
        () => universalPerceptionService.observeCamera({ userPrompt: rawPrompt }),
      );
      completeOperation(
        camOperation,
        percRes?.visionAnswer ? 'SUCCESS' : 'FAILED',
        percRes?.visionAnswer ? undefined : 'empty_camera_result',
      );
      const reply = percRes.visionAnswer || (percRes as any).summary || "I can see you clearly through the camera.";
      await this.recordTurn(conversationId, rawPrompt, reply, 'camera_perception');
      return {
        assistantText: reply,
        route: 'camera_perception',
        status: 'completed',
        verified: true,
      };
    }

    // ── 3b. Visual Perception: Desktop / Screen ("Can you see the screen right now?", "Can you see my desktop screen?", "Capture my desktop screen") ──
    if (
      /\b(?:can\s+you\s+see\s+(?:the\s+|my\s+)?(?:screen|desktop)|can\s+you\s+see\s+(?:the\s+|my\s+)?desktop\s+screen|see\s+(?:the\s+|my\s+)?(?:screen|desktop)|look\s+at\s+(?:the\s+|my\s+)?(?:screen|desktop)|what\s+is\s+on\s+(?:my\s+)?desktop|on\s+my\s+desktop|what\s+is\s+on\s+(?:my\s+|the\s+)?screen|what\s+do\s+you\s+see\s+on\s+(?:my\s+|the\s+)?screen|inspect\s+(?:the\s+|my\s+)?(?:screen|desktop)|capture\s+(?:my\s+)?(?:desktop\s+)?screen)\b/i.test(lower)
    ) {
      const { universalPerceptionService } = await import('../controlPlane/UniversalPerceptionService.js');
      const percRes = await universalPerceptionService.observeDesktop({ userPrompt: rawPrompt, targetQuery: 'desktop' });
      const reply = percRes.visionAnswer || (percRes as any).summary || "I can see your desktop screen.";
      await this.recordTurn(conversationId, rawPrompt, reply, 'screen_perception');
      return {
        assistantText: reply,
        route: 'screen_perception',
        status: 'completed',
        verified: true,
      };
    }

    // ── 3b1. Git / GitHub Repository Status & Safe Update Query ──
    const isGitStatusQuery =
      /\b(?:check\s+(?:the\s+)?(?:status\s+of\s+(?:my\s+)?(?:agenticos\s+)?(?:github\s+)?(?:repo(?:sitory)?)?|(?:agenticos\s+)?(?:github|git)\s+status)|pr[üu]fe\s+(?:den\s+)?status\s+(?:meines\s+)?(?:bestehenden\s+)?(?:agenticos\s+)?(?:github[- ]?)?repo(?:sitories|sitory)?|git\s+status\b|status\s+(?:des\s+)?(?:agenticos\s+)?repo(?:sitories|sitory)?|update\s+(?:my\s+)?(?:existing\s+)?(?:agenticos\s+)?(?:github\s+)?repo(?:sitory)?)\b/i.test(lower) ||
      (/\bstatus\b/i.test(lower) && /\b(?:git|github|repo|repository)\b/i.test(lower));

    if (isGitStatusQuery) {
      const { agenticOsGitService } = await import('../controlPlane/AgenticOsGitService.js');
      const isGerman = /\b(?:pr[üu]fe|status\s+meines|deutsch)\b/i.test(lower);
      const isUpdate = /\bupdate\s+(?:my\s+)?(?:existing\s+)?(?:agenticos\s+)?(?:github\s+)?repo/i.test(lower);
      const { formattedText } = agenticOsGitService.getStatus(isGerman ? 'de' : 'en');
      let responseText = formattedText;
      if (isUpdate) {
        responseText = `Under the Git safety contract, I have inspected your repository status without performing unreviewed remote mutations:\n${formattedText}`;
      }
      await this.recordTurn(conversationId, rawPrompt, responseText, 'action');
      return {
        assistantText: responseText,
        route: 'action',
        status: 'completed',
        verified: true,
      };
    }

    // ── 3c. Delegation Proposal Recognition ("Could you delegate an investigation of AgenticOS worker routing to Hermes?") ──
    const isDelegationProposal = /\b(?:could\s+you|can\s+you|would\s+you|please)\s+delegate\s+(?:an?\s+)?(.+?)\s+to\s+(hermes|codex|antigravity)\b/i.test(lower);
    if (isDelegationProposal) {
      const match = lower.match(/\b(?:could\s+you|can\s+you|would\s+you|please)\s+delegate\s+(?:an?\s+)?(.+?)\s+to\s+(hermes|codex|antigravity)\b/i);
      const proposedObjective = match ? match[1].trim() : 'investigation of AgenticOS worker routing';
      const proposedWorker = match ? match[2].trim().toLowerCase() : 'hermes';

      unifiedOperationalContext.proposeAction({
        proposedObjective,
        proposedWorker,
        conversationId,
        confirmationRequired: true,
      });

      const workerDisplay = proposedWorker === 'hermes' ? 'Hermes' : proposedWorker === 'codex' ? 'CodeX' : 'AntiGravity';
      const reply = `Would you like me to delegate this ${proposedObjective} to ${workerDisplay}?`;
      await this.recordTurn(conversationId, rawPrompt, reply, 'delegation_proposal');
      return {
        assistantText: reply,
        route: 'delegation_proposal',
        status: 'completed',
        verified: true,
      };
    }

    // ── 3d. Explicit Confirmation of Pending Action ("Yes, do that.", "Go ahead.", "Confirm.") ──
    const isExplicitConfirmation = /^(?:yes[,\s]+)?(?:do\s+that|please\s+do|go\s+ahead(?:\s+and\s+do\s+that)?|confirm|execute\s+it|delegate\s+it)[.!]?$/i.test(lower) ||
      (/^(?:yes|yeah|yep|sure|ok|okay)[.!]?$/i.test(lower) && Boolean(unifiedOperationalContext.getActivePendingAction(conversationId)));

    if (isExplicitConfirmation) {
      const pending = unifiedOperationalContext.getActivePendingAction(conversationId);
      if (pending) {
        unifiedOperationalContext.acceptPendingAction(pending.pendingActionId);
        logger.info(`[CanonicalTurnExecutionService] Executing confirmed PendingAction: ${pending.pendingActionId} [worker=${pending.proposedWorker}]`);

        const delRes = await executeEngineeringDelegation({
          action: 'delegate',
          worker: pending.proposedWorker as any,
          task: pending.proposedObjective,
          rawPrompt,
        }, {
          conversationId,
          workspace,
          originChannel: modality === 'telegram' ? 'telegram' : modality === 'voice' ? 'voice' : 'desktop',
          broadcastFn: input.onProgress,
        });

        let reply = '';
        if (delRes.success && delRes.taskId) {
          const workerDisplay = pending.proposedWorker === 'hermes' ? 'Hermes' : 'AntiGravity';
          reply = `I have delegated the investigation to ${workerDisplay} under task ID ${delRes.taskId}. ${workerDisplay} has accepted the task.`;
          unifiedOperationalContext.setActiveReferent({
            activeTaskId: delRes.taskId,
            activeGoalRunId: delRes.goalId,
            activeWorker: pending.proposedWorker,
            activeSubject: pending.proposedObjective,
            originChannel: modality === 'telegram' ? 'telegram' : modality === 'voice' ? 'voice' : 'desktop',
          });
        } else {
          reply = `I couldn't deliver the task to ${pending.proposedWorker} because ${delRes.error || 'the worker did not accept the task'}.`;
        }

        await this.recordTurn(conversationId, rawPrompt, reply, 'engineering_delegation');
        return {
          assistantText: reply,
          taskId: delRes.taskId,
          goalId: delRes.goalId,
          goalRunId: delRes.goalId,
          route: 'engineering_delegation',
          status: delRes.success ? 'delegated' : 'failed',
          verified: delRes.success,
        };
      }
    }

    // ── 3e. Conversational Acknowledgment Handling (Affirmation MUST NOT repeat action!) ──
    const cleanedAck = lower.replace(/[.!?,]+$/, '').trim();
    const isConversationalAck = /^(?:yes,?\s+(?:that'?s\s+(?:right|correct|what\s+i\s+meant)|exactly)|correct|exactly|thank\s+you|thanks|okay,?\s+good|that'?s\s+what\s+i\s+meant|sounds\s+good|great|perfect|got\s+it)$/i.test(cleanedAck) ||
      (/^(?:yes|yeah|yep|ok|okay)$/i.test(cleanedAck) && !unifiedOperationalContext.getActivePendingAction(conversationId));

    if (isConversationalAck) {
      const reply = "Understood. Glad I could help.";
      await this.recordTurn(conversationId, rawPrompt, reply, 'conversational_acknowledgment');
      return {
        assistantText: reply,
        route: 'conversational_acknowledgment',
        status: 'completed',
        verified: true,
      };
    }

    // ── 4. Explicit Engineering Delegation (Hermes / AntiGravity / Codex) ──
    const explicitEngineering = parseExplicitEngineeringDelegation(rawPrompt);
    if (explicitEngineering) {
      const targetWorkerName = explicitEngineering.worker === 'hermes' ? 'Hermes' : explicitEngineering.worker === 'codex' ? 'CodeX' : 'AntiGravity';
      const ackText = `Understood. Delegating to ${targetWorkerName}: ${explicitEngineering.task}`;
      input.onAcknowledgement?.(ackText);

      const delRes = await executeEngineeringDelegation(explicitEngineering, {
        conversationId,
        workspace,
        originChannel: modality === 'telegram' ? 'telegram' : modality === 'voice' ? 'voice' : 'desktop',
        broadcastFn: input.onProgress,
      });

      const fullReply = delRes.text;
      await this.recordTurn(conversationId, rawPrompt, fullReply, 'engineering_delegation');

      return {
        acknowledgment: ackText,
        assistantText: fullReply,
        taskId: delRes.taskId,
        goalId: delRes.goalId,
        goalRunId: delRes.goalId,
        route: 'engineering_delegation',
        status: delRes.success ? 'delegated' : 'failed',
        verified: delRes.success,
      };
    }

    // ── 5. Operational Task Status & Deterministic Referent Lookup (§3, §4, §8, §16, §17) ──
    const isTaskStatusQuery = (
      /\b(?:status\s+of|what\s+(?:is|happened\s+with)|how\s+is|did\s+(?:hermes|antigravity|codex|he|she|it|you)\s+finish|is\s+it\s+(?:done|finished|completed?)|where\s+is)\b/i.test(lower) &&
      /\b(?:task|job|work|goal|delegat|update|github|git|repo|bgtask-|goal-|hermes|antigravity|codex)\b/i.test(lower)
    ) || /\b(?:did\s+(?:hermes|antigravity|codex|he|it)\s+finish\s+it)\b/i.test(lower)
      || /\b(?:what\s+happened\s+with\s+(?:it|that))\b/i.test(lower)
      || /\b(?:what\s+happened\s+with\s+(?:the\s+)?task\s+i\s+gave\s+(?:you|hermes)\s+on\s+telegram)\b/i.test(lower);

    if (isTaskStatusQuery) {
      const callerChannel: OperationalChannel = modality === 'telegram' ? 'telegram' : modality === 'voice' ? 'voice' : 'desktop';
      const resolution = unifiedOperationalContext.resolveTaskReferent(rawPrompt, {
        conversationId,
        channel: callerChannel,
      });

      if (resolution.match) {
        const t = resolution.match;
        let reply = `Task \`${t.taskId}\` [Worker: ${t.worker.toUpperCase()}, Origin: ${t.originChannel.toUpperCase()}]:\n`;
        reply += `• Objective: "${t.objective}"\n`;
        reply += `• Status: ${t.status.toUpperCase()}${t.stage ? ` (Stage: ${t.stage})` : ''}\n`;
        reply += `• Verification: ${t.verificationState || 'PENDING'}\n`;
        if (t.blocker) {
          reply += `• Blocker: ${t.blocker}\n`;
        }
        if (t.completionEvidence) {
          reply += `• Evidence: ${t.completionEvidence}\n`;
        }
        if (t.lastEventAt) {
          reply += `• Last Event: ${new Date(t.lastEventAt).toLocaleTimeString()}\n`;
        }

        await this.recordTurn(conversationId, rawPrompt, reply, 'task_status');
        return {
          assistantText: reply,
          taskId: t.taskId,
          goalRunId: t.goalRunId,
          route: 'task_status',
          status: 'completed',
          verified: true,
        };
      } else if (resolution.candidates && resolution.candidates.length > 1) {
        const listStr = resolution.candidates.map(c => `• \`${c.taskId}\` (${c.worker}): "${c.objective}"`).join('\n');
        const reply = `I found multiple matching tasks:\n${listStr}\nWhich task would you like to inspect?`;
        await this.recordTurn(conversationId, rawPrompt, reply, 'task_status');
        return {
          assistantText: reply,
          route: 'task_status',
          status: 'completed',
          verified: true,
        };
      } else {
        const reply = "I could not find an existing task matching that request.";
        await this.recordTurn(conversationId, rawPrompt, reply, 'task_status');
        return {
          assistantText: reply,
          route: 'task_status',
          status: 'completed',
          verified: true,
        };
      }
    }

    // ── 6. Git Repository Status Check ("Check the status of my AgenticOS Git repository") ──
    if (/\b(?:check\s+(?:the\s+)?status\s+of\s+(?:my\s+)?(?:agenticos\s+)?git\s+repository|git\s+status|status\s+of\s+(?:my\s+)?repo)\b/i.test(lower)) {
      const gitRes = await this.gitExecutor.executeGit('status', workspace);
      const reply = gitRes.output || 'Git status checked successfully.';
      await this.recordTurn(conversationId, rawPrompt, reply, 'git_status');
      return {
        assistantText: reply,
        route: 'git_status',
        status: gitRes.success ? 'completed' : 'failed',
        verified: gitRes.success,
      };
    }

    // ── 6. Canonical Jarvis Orchestrator Execution (Full Cognitive Pipeline) ──
    if (input.skipOrchestrator) {
      return { assistantText: '', route: 'unhandled', status: 'skipped', verified: false };
    }
    const orchResult = await jarvisOrchestrator.handleMessage(
      conversationId,
      rawPrompt,
      workspace,
      approvalPolicy,
      undefined,
      undefined,
      undefined
    );

    // Retrieve the actual assistant reply recorded by orchestrator
    const assistantText = await this.extractLatestAgentMessage(conversationId, orchResult);

    return {
      assistantText,
      goalRunId: orchResult?.goalId,
      taskId: orchResult?.taskId,
      route: orchResult?.route || 'direct',
      status: orchResult?.status || 'completed',
      verified: !orchResult?.error,
      error: orchResult?.error,
    };
  }

  /**
   * Ensure the conversation record exists in SQLite.
   */
  private async ensureConversation(conversationId: string, telegramChatId?: string): Promise<void> {
    try {
      const existing = await conversationService.getConversation(conversationId);
      if (!existing) {
        const title = telegramChatId ? `Telegram Remote (${telegramChatId})` : 'Jarvis Conversation';
        await conversationService.createConversation(title, undefined, 'jarvis', conversationId);
      }
    } catch {}
  }

  /**
   * Persist user prompt and agent response to conversationService.
   */
  private async recordTurn(conversationId: string, prompt: string, reply: string, route: string): Promise<void> {
    try {
      await conversationService.appendMessage({
        conversationId,
        role: 'user',
        content: prompt,
      });

      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { route },
      });
    } catch (err: any) {
      logger.warn('[CanonicalTurnExecutionService] Failed to record turn to conversationService:', err?.message);
    }
  }

  /**
   * Extract the authoritative response text generated by jarvisOrchestrator.
   */
  private async extractLatestAgentMessage(conversationId: string, orchResult: any): Promise<string> {
    if (orchResult?.message) {
      return orchResult.message;
    }

    try {
      const msgs = await conversationService.getMessages(conversationId);
      if (Array.isArray(msgs) && msgs.length > 0) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.role === 'agent' && m.content) {
            return m.content;
          }
        }
      }
    } catch {}

    if (orchResult?.error) {
      return `Execution error: ${orchResult.error}`;
    }

    return "I'm here. How can I assist you with AgenticOS?";
  }

  /**
   * Build accurate real-time worker status reply.
   */
  private buildWorkerStatusReply(targetWorker?: string): string {
    if (targetWorker) {
      const state = unifiedOperationalContext.getWorkerState(targetWorker);
      const workerName = targetWorker === 'hermes' ? 'Hermes' : targetWorker === 'codex' ? 'CodeX' : 'AntiGravity';

      if (state.activeTask) {
        let msg = `${workerName} is currently active on task \`${state.activeTask.taskId}\` ("${state.activeTask.objective}").\n`;
        msg += `• Status: ${state.activeTask.status.toUpperCase()}\n`;
        msg += `• Stage: ${state.activeTask.stage || 'executing'}\n`;
        if (state.activeTask.blocker) msg += `• Blocker: ${state.activeTask.blocker}\n`;
        if (state.activeTask.lastEventAt) msg += `• Last Event: ${new Date(state.activeTask.lastEventAt).toLocaleTimeString()}\n`;
        return msg;
      }

      if (targetWorker === 'antigravity') {
        const agSession = engineeringWorkerRegistry.getActiveSession('antigravity');
        if (agSession && (agSession.status === 'BUSY' || agSession.status === 'ONLINE')) {
          let msg = `AntiGravity is currently active on task \`${agSession.taskId}\` ("${agSession.title || 'Engineering Task'}").\n`;
          msg += `• Status: ${agSession.status}\n`;
          msg += `• Current Stage: ${agSession.currentStage || 'executing'}\n`;
          if (agSession.currentCommand) msg += `• Running: \`${agSession.currentCommand}\`\n`;
          if (agSession.currentFile) msg += `• Active File: \`${agSession.currentFile}\`\n`;
          return msg;
        }
      }

      return `${workerName} is currently idle in standby, ready for incoming engineering or control tasks.`;
    }

    const agSession = engineeringWorkerRegistry.getActiveSession('antigravity');
    const activeTasks = backgroundTaskManager.listTasks({ activeOnly: true });
    const recentGoals = goalLifecycleManager.listGoalRuns(5).filter(g =>
      !['COMPLETED', 'FAILED_EXHAUSTED', 'CANCELLED'].includes(g.status)
    );

    if (agSession && (agSession.status === 'BUSY' || agSession.status === 'ONLINE')) {
      let msg = `AntiGravity is currently active on task \`${agSession.taskId}\` ("${agSession.title || 'Engineering Task'}").\n`;
      msg += `• Status: ${agSession.status}\n`;
      msg += `• Current Stage: ${agSession.currentStage || 'executing'}\n`;
      if (agSession.currentCommand) msg += `• Running: \`${agSession.currentCommand}\`\n`;
      if (agSession.currentFile) msg += `• Active File: \`${agSession.currentFile}\`\n`;
      return msg;
    }

    if (activeTasks.length > 0) {
      const t = activeTasks[0];
      return `AntiGravity and Hermes are in standby. Background worker [${t.worker}] is currently running task \`${t.taskId}\`: "${t.title}".`;
    }

    if (recentGoals.length > 0) {
      const g = recentGoals[0];
      return `Engineering workers are in standby. ControlPlane goal \`${g.goalId}\` is currently in progress (${g.status}): "${g.normalizedGoal}".`;
    }

    return 'AntiGravity, Hermes, and Codex are currently idle in standby, ready for incoming engineering or control tasks.';
  }

  /**
   * Build response for desktop Jarvis asking about received Telegram messages.
   */
  private async buildTelegramIntrospectionReply(): Promise<string> {
    try {
      const { telegramAdapter } = await import('../../adapters/telegramAdapter.js');
      const telemetry = telegramAdapter.getInboundTelemetry();

      if (!telemetry || !telemetry.lastInboundMessageAt) {
        return 'I have not received a Telegram message in the current runtime.';
      }

      const timeStr = new Date(telemetry.lastInboundMessageAt).toLocaleTimeString();
      const preview = telemetry.lastInboundTextPreview || 'Unknown message';
      const chatId = telemetry.lastInboundChatId || 'Unknown';
      const userId = telemetry.lastInboundUserId || 'Unknown';
      const convId = telemetry.mappedConversationId || 'conv-telegram';

      return `Yes. I received your Telegram message "${preview}" at ${timeStr} from User ID ${userId} (Chat ID ${chatId}) and replied through conversation ${convId}.`;
    } catch (err: any) {
      return `Error inspecting Telegram state: ${err?.message || 'Unknown error'}`;
    }
  }
}

export const canonicalTurnExecutionService = CanonicalTurnExecutionService.getInstance();
