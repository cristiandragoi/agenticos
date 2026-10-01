/**
 * telegramAdapter.ts — Telegram Remote Jarvis Integration Adapter
 *
 * Implements Telegram as a first-class remote interface to AgenticOS/Jarvis:
 * - Credentials retrieved via CanonicalSecretStore (keytar / encrypted SQLite / env)
 * - Validates bot token via getMe without crashing if unconfigured
 * - Outbound HTTPS long polling (getUpdates) with offset tracking & exponential backoff
 * - Strict authorization check against allowed_user_ids and allowed_chat_ids
 * - Command handling: /start, /help, /health, /status, /tasks, /task, /cancel, /screenshot
 * - Conversational turns wired into canonicalTurnExecutionService (same cognitive pipeline as AgenticOS chat)
 * - Native desktop screenshot capture via DesktopPerceptionService delivered via sendPhoto
 * - Proactive milestone notification updates to authorized Telegram chats
 * - Inbound and outbound message correlation via reply_to_message_id
 * - Full telemetry introspection without exposing bot token
 * - Zero public port exposure (outbound polling only)
 */

import fs from 'node:fs';
import path from 'node:path';
import { secretStore } from '../services/gateway/secretStore.js';
import { logger } from '../utils/logger.js';
import { getBuildIdentity } from '../services/buildIdentity.js';
import { DesktopPerceptionService } from '../services/perception/DesktopPerceptionService.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { engineeringWorkerRegistry } from '../domains/controlPlane/EngineeringWorkerRegistry.js';

export interface TelegramAdapterStatus {
  configured: boolean;
  connected: boolean;
  polling: boolean;
  status: 'TELEGRAM_NOT_CONFIGURED' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  botUsername: string | null;
  botId: number | null;
  authorizedUserCount: number;
  authorizedChatCount: number;
  lastUpdateAt: string | null;
  lastInboundMessageAt: string | null;
  lastInboundMessageId: number | null;
  lastInboundChatId: string | null;
  lastInboundUserId: string | null;
  lastInboundTextPreview: string | null;
  lastOutboundAt: string | null;
  lastOutboundMessageId: number | null;
  mappedConversationId: string | null;
  lastExecutionStatus: string | null;
  lastError: string | null;
}

export class TelegramAdapter {
  private static instance: TelegramAdapter;

  private botToken: string | null = null;
  private allowedUserIds = new Set<string>();
  private allowedChatIds = new Set<string>();

  private configured = false;
  private connected = false;
  private polling = false;
  private botUsername: string | null = null;
  private botId: number | null = null;
  private lastUpdateAt: string | null = null;

  // Runtime Inbound Telemetry
  private lastInboundMessageAt: string | null = null;
  private lastInboundMessageId: number | null = null;
  private lastInboundChatId: string | null = null;
  private lastInboundUserId: string | null = null;
  private lastInboundTextPreview: string | null = null;
  private mappedConversationId: string | null = null;

  // Runtime Outbound Telemetry
  private lastOutboundAt: string | null = null;
  private lastOutboundMessageId: number | null = null;
  private lastExecutionStatus: string | null = null;
  private lastError: string | null = null;

  private abortController: AbortController | null = null;
  private pollOffset = 0;
  private backoffMs = 1000;

  // Active chat mapping for milestone updates: goalId -> chatId
  private goalChatMap = new Map<string, string>();

  private constructor() {
    this.setupMilestoneListener();
  }

  public static getInstance(): TelegramAdapter {
    if (!TelegramAdapter.instance) {
      TelegramAdapter.instance = new TelegramAdapter();
    }
    return TelegramAdapter.instance;
  }

  /**
   * Listen to GoalLifecycle state transitions and dispatch milestone updates
   * to the originating Telegram chat.
   */
  private setupMilestoneListener(): void {
    // GoalLifecycle milestone events (§12)
    goalLifecycleManager.on('goal:state', ({ goalId, to, event }: any) => {
      const chatId = this.goalChatMap.get(goalId);
      if (!chatId) return;

      const summary = event?.summary || `Goal reached state ${to}`;
      let icon = '🔄';
      if (to === 'COMPLETED') icon = '✅';
      else if (to === 'FAILED' || to === 'FAILED_EXHAUSTED' || to === 'BLOCKED') icon = '❌';
      else if (to === 'CANCELLED') icon = '🛑';
      else if (to === 'EXECUTING') icon = '⚡';
      else if (to === 'WORKER_ACCEPTED') icon = '🤝';
      else if (to === 'VERIFYING') icon = '🔍';

      const text = `${icon} *Task Update* [\`${goalId}\`]\n*Status:* \`${to}\`\n${summary}`;
      this.sendMessage(chatId, text).catch(err => {
        logger.debug?.('[TelegramAdapter] Failed to send milestone update:', err?.message);
      });

      if (['COMPLETED', 'FAILED', 'FAILED_EXHAUSTED', 'CANCELLED'].includes(to)) {
        this.goalChatMap.delete(goalId);
      }
    });

    // Background task milestone events (§12)
    backgroundTaskManager.on('task:updated', (task: any) => {
      if (!task || !task.taskId) return;
      const meta = (task.metadata || {}) as Record<string, any>;
      const chatId = meta.originTelegramChatId || meta.telegramChatId || this.goalChatMap.get(task.taskId) || (meta.goalId ? this.goalChatMap.get(meta.goalId) : null);
      if (!chatId) return;

      const meaningfulStatuses = ['worker_accepted', 'blocked', 'verifying', 'completed', 'failed'];
      if (!meaningfulStatuses.includes(task.status)) return;

      let icon = '🔄';
      if (task.status === 'completed') icon = '✅';
      else if (task.status === 'failed' || task.status === 'blocked') icon = '⚠️';
      else if (task.status === 'worker_accepted') icon = '🤝';
      else if (task.status === 'verifying') icon = '🔍';

      const text = `${icon} *Task Status* [\`${task.taskId}\`]\n*Worker:* \`${task.worker || 'Jarvis'}\`\n*Status:* \`${task.status.toUpperCase()}\`${task.currentStage ? ` (${task.currentStage})` : ''}\n${task.objective || task.title}`;
      this.sendMessage(chatId, text).catch(err => {
        logger.debug?.('[TelegramAdapter] Failed to send task:updated notification:', err?.message);
      });

      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        this.goalChatMap.delete(task.taskId);
        if (meta.goalId) this.goalChatMap.delete(meta.goalId);
      }
    });
  }

  /**
   * Initialize and start the Telegram adapter.
   */
  public async start(): Promise<void> {
    await this.loadConfig();

    if (!this.botToken) {
      this.configured = false;
      this.connected = false;
      this.polling = false;
      this.lastError = 'TELEGRAM_NOT_CONFIGURED';
      logger.info('[TelegramAdapter] TELEGRAM_NOT_CONFIGURED: No bot token configured. Adapter waiting in standby.');
      return;
    }

    this.configured = true;
    logger.info('[TelegramAdapter] Token detected. Validating with Telegram Bot API (getMe)...');

    const valid = await this.validateToken();
    if (!valid) {
      this.connected = false;
      this.polling = false;
      logger.warn('[TelegramAdapter] Token validation failed. Long polling will not start.', { error: this.lastError });
      return;
    }

    this.connected = true;
    this.startPolling();
  }

  /**
   * Stop polling and disconnect.
   */
  public async stop(): Promise<void> {
    this.polling = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.connected = false;
    logger.info('[TelegramAdapter] Polling stopped.');
  }

  /**
   * Reload configuration from SecretStore and restart.
   */
  public async reload(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Parse comma-separated or JSON list of IDs into a Set of strings.
   */
  private parseIdList(raw: string | null): Set<string> {
    const set = new Set<string>();
    if (!raw || !raw.trim()) return set;
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item !== null && item !== undefined) {
              set.add(String(item).trim());
            }
          }
          return set;
        }
      } catch {}
    }
    for (const part of trimmed.split(/[,\s]+/)) {
      const clean = part.trim();
      if (clean) set.add(clean);
    }
    return set;
  }

  /**
   * Load credentials from SecretStore / env.
   */
  public async loadConfig(): Promise<void> {
    try {
      const token = await secretStore.get('telegram.bot_token');
      this.botToken = token && token.trim() ? token.trim() : null;

      const userIds = await secretStore.get('telegram.allowed_user_ids');
      this.allowedUserIds = this.parseIdList(userIds);

      const chatIds = await secretStore.get('telegram.allowed_chat_ids');
      this.allowedChatIds = this.parseIdList(chatIds);

      logger.info('[TelegramAdapter] Loaded configuration:', {
        configured: Boolean(this.botToken),
        allowedUserCount: this.allowedUserIds.size,
        allowedChatCount: this.allowedChatIds.size,
      });
    } catch (err: any) {
      this.lastError = `Config load error: ${err?.message}`;
      logger.error('[TelegramAdapter] Error loading config from SecretStore:', err);
    }
  }

  /**
   * Validate bot token with Telegram getMe.
   */
  private async validateToken(): Promise<boolean> {
    if (!this.botToken) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json() as any;
      if (data?.ok && data?.result) {
        this.botUsername = data.result.username || null;
        this.botId = data.result.id || null;
        this.lastError = null;
        logger.info(`[TelegramAdapter] Bot authenticated successfully as @${this.botUsername} (id: ${this.botId})`);
        return true;
      }

      this.lastError = data?.description || `HTTP ${res.status}: Failed to authenticate`;
      return false;
    } catch (err: any) {
      this.lastError = err?.message || 'Network error connecting to Telegram Bot API';
      return false;
    }
  }

  /**
   * Begin long polling loop with backoff and graceful recovery.
   */
  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    this.abortController = new AbortController();

    logger.info(`[TelegramAdapter] Starting long polling (offset: ${this.pollOffset})...`);

    // Run detached async polling loop
    (async () => {
      while (this.polling) {
        try {
          await this.pollOnce();
          this.backoffMs = 1000; // Reset backoff on successful request
        } catch (err: any) {
          if (!this.polling) break;
          const msg = err?.name === 'AbortError' ? 'Polling aborted' : (err?.message || String(err));
          this.lastError = msg;
          logger.warn(`[TelegramAdapter] Polling error: ${msg}. Retrying in ${this.backoffMs}ms...`);
          await new Promise(r => setTimeout(r, this.backoffMs));
          this.backoffMs = Math.min(30000, this.backoffMs * 2);
        }
      }
    })();
  }

  /**
   * Single long polling request.
   */
  private async pollOnce(): Promise<void> {
    if (!this.botToken || !this.polling) return;

    const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.pollOffset}&timeout=30&allowed_updates=["message","edited_message"]`;
    const res = await fetch(url, {
      signal: this.abortController?.signal || AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`getUpdates HTTP ${res.status}: ${errBody.slice(0, 100)}`);
    }

    const data = await res.json() as any;
    if (!data?.ok || !Array.isArray(data.result)) {
      throw new Error(data?.description || 'Invalid response structure from getUpdates');
    }

    const updates = data.result;
    for (const update of updates) {
      this.lastUpdateAt = new Date().toISOString();
      if (update.update_id >= this.pollOffset) {
        this.pollOffset = update.update_id + 1;
      }

      const msg = update.message || update.edited_message;
      if (msg) {
        this.handleIncomingMessage(msg).catch(err => {
          logger.error('[TelegramAdapter] Error processing incoming message:', err);
        });
      }
    }
  }

  /**
   * Check if a message sender or chat is authorized.
   */
  private isAuthorized(userId: string, chatId: string): boolean {
    if (this.allowedUserIds.size === 0 && this.allowedChatIds.size === 0) {
      return false;
    }
    if (this.allowedUserIds.has(userId)) return true;
    if (this.allowedChatIds.has(chatId)) return true;
    return false;
  }

  /**
   * Process incoming Telegram message.
   */
  private async handleIncomingMessage(msg: any): Promise<void> {
    const text = (msg.text || '').trim();
    if (!text) return;

    const messageId = msg.message_id ? Number(msg.message_id) : undefined;
    const userId = String(msg.from?.id || '');
    const chatId = String(msg.chat?.id || '');
    const senderName = msg.from?.first_name || msg.from?.username || 'User';

    // Record Inbound Telemetry
    this.lastInboundMessageAt = new Date().toISOString();
    this.lastInboundMessageId = messageId || null;
    this.lastInboundChatId = chatId;
    this.lastInboundUserId = userId;
    this.lastInboundTextPreview = text.slice(0, 100);
    this.mappedConversationId = `conv-telegram-${chatId}`;

    logger.info(`[TelegramAdapter] Incoming message from ${senderName} (userId=${userId}, chatId=${chatId}, msgId=${messageId}): "${text.slice(0, 50)}"`);

    // Authorization Guard
    if (!this.isAuthorized(userId, chatId)) {
      logger.warn(`[TelegramAdapter] Unauthorized attempt blocked. userId=${userId}, chatId=${chatId}`);
      const rejection =
        `⛔ *Access Denied*\n\n` +
        `Your Telegram account is not authorized to interact with AgenticOS.\n\n` +
        `👤 *Your User ID:* \`${userId}\`\n` +
        `💬 *This Chat ID:* \`${chatId}\`\n\n` +
        `To authorize, open *AgenticOS Desktop → Settings → Telegram Remote Jarvis* and add your User ID or Chat ID.`;
      await this.sendMessage(chatId, rejection, 'Markdown', messageId);
      return;
    }

    // Command Dispatcher
    const lower = text.toLowerCase();

    if (lower === '/start' || lower === '/help') {
      await this.handleHelpCommand(chatId, messageId);
      return;
    }

    if (lower === '/health') {
      await this.handleHealthCommand(chatId, messageId);
      return;
    }

    if (lower === '/status') {
      await this.handleStatusCommand(chatId, messageId);
      return;
    }

    if (lower === '/tasks') {
      await this.handleTasksCommand(chatId, messageId);
      return;
    }

    if (lower.startsWith('/task ') || lower === '/task') {
      const taskId = text.slice(6).trim();
      await this.handleTaskDetailCommand(chatId, taskId, messageId);
      return;
    }

    if (lower.startsWith('/cancel ') || lower === '/cancel') {
      const taskId = text.slice(8).trim();
      await this.handleCancelCommand(chatId, taskId, messageId);
      return;
    }

    if (lower === '/screenshot') {
      await this.handleScreenshotCommand(chatId, messageId);
      return;
    }

    // Natural Language Turn Integration via CanonicalTurnExecutionService
    await this.handleConversationalTurn(chatId, text, messageId);
  }

  /**
   * /start and /help command handler.
   */
  private async handleHelpCommand(chatId: string, replyToMessageId?: number): Promise<void> {
    const buildId = getBuildIdentity().buildId || 'dev';
    const help =
      `🤖 *AgenticOS Remote Jarvis*\n` +
      `_Build: ${buildId}_\n\n` +
      `*Available Commands:*\n` +
      `• /health — Check AgenticOS backend & desktop health\n` +
      `• /status — View worker pool & supervisor status\n` +
      `• /tasks — List active & recent background tasks\n` +
      `• /task \`<id>\` — Detailed task status, stage & blocker\n` +
      `• /cancel \`<id>\` — Cancel an active task or goal\n` +
      `• /screenshot — Capture fresh desktop screenshot artifact\n\n` +
      `*Conversational Execution:*\n` +
      `Send any prompt (e.g. _"What is AntiGravity doing right now?"_) to interact with Jarvis directly.`;
    await this.sendMessage(chatId, help, 'Markdown', replyToMessageId);
  }

  /**
   * /health command handler.
   */
  private async handleHealthCommand(chatId: string, replyToMessageId?: number): Promise<void> {
    const uptimeSec = Math.floor(process.uptime());
    const buildId = getBuildIdentity().buildId || 'dev';
    const memory = process.memoryUsage();
    const rssMb = (memory.rss / (1024 * 1024)).toFixed(1);

    const activeGoals = goalLifecycleManager.listGoalRuns(20).filter(g =>
      !['COMPLETED', 'FAILED_EXHAUSTED', 'CANCELLED'].includes(g.status)
    ).length;

    const activeBgTasks = backgroundTaskManager.listTasks({ activeOnly: true }).length;

    const reply =
      `🟢 *AgenticOS Health — ONLINE*\n\n` +
      `• *Status:* Operational (HTTP 200 OK)\n` +
      `• *Backend PID:* \`${process.pid}\`\n` +
      `• *Build:* \`${buildId}\`\n` +
      `• *Uptime:* ${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s\n` +
      `• *Memory RSS:* ${rssMb} MB\n` +
      `• *Active Goals:* ${activeGoals}\n` +
      `• *Active Background Tasks:* ${activeBgTasks}\n` +
      `• *Telegram Polling:* Active (@${this.botUsername || 'jarvis'})`;

    await this.sendMessage(chatId, reply, 'Markdown', replyToMessageId);
  }

  /**
   * /status command handler.
   */
  private async handleStatusCommand(chatId: string, replyToMessageId?: number): Promise<void> {
    const sessions = engineeringWorkerRegistry.getSessions();
    const activeTasks = backgroundTaskManager.listTasks({ activeOnly: true });

    let statusText = `📊 *AgenticOS Runtime Status*\n\n`;

    // Active Engineering Sessions
    statusText += `*Engineering Worker Sessions:*\n`;
    if (sessions.length === 0) {
      statusText += `• No active engineering worker sessions\n`;
    } else {
      for (const s of sessions.slice(0, 5)) {
        statusText += `• *[${s.workerId}]* \`${s.taskId}\` — ${s.status} (Stage: ${s.currentStage || 'running'})\n`;
      }
    }

    // Active Background Tasks
    statusText += `\n*Active Background Tasks (${activeTasks.length}):*\n`;
    if (activeTasks.length === 0) {
      statusText += `• None currently executing\n`;
    } else {
      for (const t of activeTasks.slice(0, 5)) {
        statusText += `• *[${t.worker}]* \`${t.taskId}\`: ${t.title} (${t.status})\n`;
      }
    }

    await this.sendMessage(chatId, statusText, 'Markdown', replyToMessageId);
  }

  /**
   * /tasks command handler.
   */
  private async handleTasksCommand(chatId: string, replyToMessageId?: number): Promise<void> {
    const tasks = backgroundTaskManager.listTasks({ limit: 10 });
    const goals = goalLifecycleManager.listGoalRuns(5);

    let text = `📋 *AgenticOS Tasks & Goals*\n\n`;

    text += `*Background Tasks:*\n`;
    if (tasks.length === 0) {
      text += `• None recorded\n`;
    } else {
      for (const t of tasks.slice(0, 7)) {
        const icon = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '⚡';
        text += `${icon} *[${t.worker}]* \`${t.taskId}\`\n   ${t.title} (${t.status})\n`;
      }
    }

    text += `\n*ControlPlane Goals:*\n`;
    if (goals.length === 0) {
      text += `• None recorded\n`;
    } else {
      for (const g of goals.slice(0, 5)) {
        const icon = g.status === 'COMPLETED' ? '✅' : g.status.startsWith('FAILED') ? '❌' : '🔄';
        text += `${icon} \`${g.goalId}\`: ${g.normalizedGoal.slice(0, 40)} (${g.status})\n`;
      }
    }

    await this.sendMessage(chatId, text, 'Markdown', replyToMessageId);
  }

  /**
   * /task <id> details command.
   */
  private async handleTaskDetailCommand(chatId: string, taskId: string, replyToMessageId?: number): Promise<void> {
    if (!taskId) {
      await this.sendMessage(chatId, `⚠️ Please specify a task ID: \`/task <taskId>\``, 'Markdown', replyToMessageId);
      return;
    }

    const bgTask = backgroundTaskManager.resolveTaskRef(taskId);
    if (bgTask) {
      const events = backgroundTaskRepo.getEvents(bgTask.taskId, 0);
      const lastEvent = events[events.length - 1];
      const reply =
        `🔍 *Task Details:* \`${bgTask.taskId}\`\n\n` +
        `• *Title:* ${bgTask.title}\n` +
        `• *Worker:* \`${bgTask.worker}\`\n` +
        `• *Status:* \`${bgTask.status}\`\n` +
        `• *Priority:* ${bgTask.priority || 'normal'}\n` +
        `• *Created:* ${bgTask.createdAt}\n` +
        `• *Last Event:* ${lastEvent ? `${lastEvent.kind}: ${lastEvent.summary || ''}` : 'None'}\n` +
        (bgTask.blocker ? `• *Blocker:* ⚠️ ${bgTask.blocker}\n` : '') +
        (bgTask.resultText ? `• *Result:* ${bgTask.resultText.slice(0, 200)}\n` : '');
      await this.sendMessage(chatId, reply, 'Markdown', replyToMessageId);
      return;
    }

    const goal = goalLifecycleManager.getGoalRun(taskId);
    if (goal) {
      const lastTimeline = goal.timeline[goal.timeline.length - 1];
      const reply =
        `🔍 *Goal Details:* \`${goal.goalId}\`\n\n` +
        `• *Goal:* ${goal.normalizedGoal}\n` +
        `• *Status:* \`${goal.status}\`\n` +
        `• *Current Attempt:* ${goal.currentAttempt}\n` +
        `• *Created:* ${goal.createdAt}\n` +
        `• *Last Event:* ${lastTimeline ? `[${lastTimeline.state}] ${lastTimeline.summary}` : 'None'}\n` +
        (goal.finalResponseText ? `• *Response:* ${goal.finalResponseText.slice(0, 200)}\n` : '');
      await this.sendMessage(chatId, reply, 'Markdown', replyToMessageId);
      return;
    }

    await this.sendMessage(chatId, `❌ Task or goal \`${taskId}\` not found.`, 'Markdown', replyToMessageId);
  }

  /**
   * /cancel <id> command.
   */
  private async handleCancelCommand(chatId: string, taskId: string, replyToMessageId?: number): Promise<void> {
    if (!taskId) {
      await this.sendMessage(chatId, `⚠️ Please specify a task ID to cancel: \`/cancel <taskId>\``, 'Markdown', replyToMessageId);
      return;
    }

    const bgTask = backgroundTaskManager.resolveTaskRef(taskId);
    if (bgTask) {
      const res = backgroundTaskManager.cancelTask(bgTask.taskId, 'Cancelled via Telegram');
      if (res.ok) {
        await this.sendMessage(chatId, `🛑 Successfully cancelled background task \`${bgTask.taskId}\`.`, 'Markdown', replyToMessageId);
      } else {
        await this.sendMessage(chatId, `⚠️ Could not cancel task: ${res.error}`, 'Markdown', replyToMessageId);
      }
      return;
    }

    const goal = goalLifecycleManager.getGoalRun(taskId);
    if (goal) {
      try {
        goalLifecycleManager.transitionState(goal.goalId, 'CANCELLED', {
          actor: 'User',
          summary: 'Cancelled via Telegram command',
        });
        await this.sendMessage(chatId, `🛑 Successfully cancelled goal \`${goal.goalId}\`.`, 'Markdown', replyToMessageId);
      } catch (err: any) {
        await this.sendMessage(chatId, `⚠️ Could not cancel goal: ${err?.message}`, 'Markdown', replyToMessageId);
      }
      return;
    }

    await this.sendMessage(chatId, `❌ Task or goal \`${taskId}\` not found.`, 'Markdown', replyToMessageId);
  }

  /**
   * /screenshot command handler.
   */
  private async handleScreenshotCommand(chatId: string, replyToMessageId?: number): Promise<void> {
    await this.sendChatAction(chatId, 'upload_photo');
    try {
      const perception = DesktopPerceptionService.getInstance();
      const artifact = await perception.captureScreen();

      if (!artifact.success || !artifact.artifactPath || !fs.existsSync(artifact.artifactPath)) {
        await this.sendMessage(chatId, `❌ Screenshot capture failed: Artifact file missing or capture error.`, 'Markdown', replyToMessageId);
        return;
      }

      const caption =
        `📸 *Desktop Screenshot Captured*\n` +
        `• Dimensions: ${artifact.width}×${artifact.height}\n` +
        `• Size: ${(artifact.byteSize / 1024).toFixed(1)} KB\n` +
        `• SHA256: \`${artifact.sha256.slice(0, 16)}...\`\n` +
        `• Timestamp: ${artifact.timestamp}`;

      await this.sendPhoto(chatId, artifact.artifactPath, caption, replyToMessageId);
    } catch (err: any) {
      logger.error('[TelegramAdapter] Screenshot command failed:', err);
      await this.sendMessage(chatId, `❌ Screenshot capture failed: ${err?.message}`, 'Markdown', replyToMessageId);
    }
  }

  /**
   * Canonical Jarvis turn execution wired into CanonicalTurnExecutionService.
   */
  private async handleConversationalTurn(chatId: string, prompt: string, messageId?: number): Promise<void> {
    await this.sendChatAction(chatId, 'typing');
    const conversationId = `conv-telegram-${chatId}`;

    try {
      const { canonicalTurnExecutionService } = await import('../domains/jarvis/canonicalTurnExecutionService.js');
      const turnResult = await canonicalTurnExecutionService.execute({
        conversationId,
        prompt,
        modality: 'telegram',
        telegramContext: {
          chatId,
          userId: this.lastInboundUserId || '',
          messageId,
        },
        onAcknowledgement: async (ackText: string) => {
          await this.sendMessage(chatId, ackText, 'Markdown', messageId);
        },
        onProgress: (progress: any) => {
          if (progress?.goalId) {
            this.goalChatMap.set(progress.goalId, chatId);
          }
        },
      });

      this.lastExecutionStatus = turnResult.status || 'completed';

      if (turnResult.goalRunId) {
        this.goalChatMap.set(turnResult.goalRunId, chatId);
      }

      const replyText = turnResult.assistantText || "I'm here.";
      await this.sendMessage(chatId, replyText, 'Markdown', messageId);
    } catch (err: any) {
      this.lastExecutionStatus = 'error';
      logger.error('[TelegramAdapter] Error executing conversational turn:', err);
      await this.sendMessage(chatId, `⚠️ Execution error: ${err?.message || 'Failed to process prompt'}`, 'Markdown', messageId);
    }
  }

  /**
   * Send text message to Telegram chat.
   */
  public async sendMessage(
    chatId: string,
    text: string,
    parseMode: 'Markdown' | 'HTML' = 'Markdown',
    replyToMessageId?: number
  ): Promise<{ success: boolean; messageId?: number }> {
    if (!this.botToken) return { success: false };
    try {
      const payload: any = {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      };
      if (replyToMessageId) {
        payload.reply_to_message_id = replyToMessageId;
      }

      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // Fallback without parse_mode if Markdown parsing failed
        if (parseMode === 'Markdown') {
          delete payload.parse_mode;
          const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (retryRes.ok) {
            const data = await retryRes.json() as any;
            const outId = data?.result?.message_id;
            this.lastOutboundAt = new Date().toISOString();
            if (outId) this.lastOutboundMessageId = outId;
            return { success: true, messageId: outId };
          }
        }
        const errText = await res.text().catch(() => '');
        logger.warn('[TelegramAdapter] sendMessage failed:', { status: res.status, errText });
        return { success: false };
      }

      const data = await res.json() as any;
      const outId = data?.result?.message_id;
      this.lastOutboundAt = new Date().toISOString();
      if (outId) this.lastOutboundMessageId = outId;
      return { success: true, messageId: outId };
    } catch (err: any) {
      logger.error('[TelegramAdapter] Network error in sendMessage:', err?.message);
      return { success: false };
    }
  }

  /**
   * Send photo to Telegram chat.
   */
  public async sendPhoto(
    chatId: string,
    filePath: string,
    caption?: string,
    replyToMessageId?: number
  ): Promise<{ success: boolean; messageId?: number }> {
    if (!this.botToken || !fs.existsSync(filePath)) return { success: false };
    try {
      const fileBuf = fs.readFileSync(filePath);
      const blob = new Blob([fileBuf], { type: 'image/png' });
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', blob, path.basename(filePath));
      if (replyToMessageId) {
        form.append('reply_to_message_id', String(replyToMessageId));
      }
      if (caption) {
        form.append('caption', caption);
        form.append('parse_mode', 'Markdown');
      }

      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        if (caption) {
          const fallbackForm = new FormData();
          fallbackForm.append('chat_id', chatId);
          fallbackForm.append('photo', blob, path.basename(filePath));
          fallbackForm.append('caption', caption);
          if (replyToMessageId) {
            fallbackForm.append('reply_to_message_id', String(replyToMessageId));
          }
          const fallbackRes = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
            method: 'POST',
            body: fallbackForm,
          });
          if (fallbackRes.ok) {
            const data = await fallbackRes.json() as any;
            const outId = data?.result?.message_id;
            this.lastOutboundAt = new Date().toISOString();
            if (outId) this.lastOutboundMessageId = outId;
            return { success: true, messageId: outId };
          }
        }
        const err = await res.text().catch(() => '');
        logger.warn('[TelegramAdapter] sendPhoto failed:', { status: res.status, err });
        return { success: false };
      }

      const data = await res.json() as any;
      const outId = data?.result?.message_id;
      this.lastOutboundAt = new Date().toISOString();
      if (outId) this.lastOutboundMessageId = outId;
      return { success: true, messageId: outId };
    } catch (err: any) {
      logger.error('[TelegramAdapter] Network error in sendPhoto:', err?.message);
      return { success: false };
    }
  }

  /**
   * Send chat action indicator (typing, upload_photo, etc.).
   */
  public async sendChatAction(chatId: string, action: 'typing' | 'upload_photo' = 'typing'): Promise<void> {
    if (!this.botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch {}
  }

  /**
   * Return safe inbound telemetry for desktop Jarvis introspection.
   */
  public getInboundTelemetry() {
    return {
      lastInboundMessageAt: this.lastInboundMessageAt,
      lastInboundMessageId: this.lastInboundMessageId,
      lastInboundChatId: this.lastInboundChatId,
      lastInboundUserId: this.lastInboundUserId,
      lastInboundTextPreview: this.lastInboundTextPreview,
      mappedConversationId: this.mappedConversationId,
      lastOutboundAt: this.lastOutboundAt,
      lastOutboundMessageId: this.lastOutboundMessageId,
      lastExecutionStatus: this.lastExecutionStatus,
    };
  }

  /**
   * Get safe status representation for status endpoints and UI.
   * NEVER returns plain bot token.
   */
  public getStatus(): TelegramAdapterStatus {
    const statusLabel = !this.configured
      ? 'TELEGRAM_NOT_CONFIGURED'
      : this.connected && this.polling
      ? 'CONNECTED'
      : this.lastError
      ? 'ERROR'
      : 'DISCONNECTED';

    return {
      configured: this.configured,
      connected: this.connected,
      polling: this.polling,
      status: statusLabel,
      botUsername: this.botUsername,
      botId: this.botId,
      authorizedUserCount: this.allowedUserIds.size,
      authorizedChatCount: this.allowedChatIds.size,
      lastUpdateAt: this.lastUpdateAt,
      lastInboundMessageAt: this.lastInboundMessageAt,
      lastInboundMessageId: this.lastInboundMessageId,
      lastInboundChatId: this.lastInboundChatId,
      lastInboundUserId: this.lastInboundUserId,
      lastInboundTextPreview: this.lastInboundTextPreview,
      lastOutboundAt: this.lastOutboundAt,
      lastOutboundMessageId: this.lastOutboundMessageId,
      mappedConversationId: this.mappedConversationId,
      lastExecutionStatus: this.lastExecutionStatus,
      lastError: this.lastError,
    };
  }
}

export const telegramAdapter = TelegramAdapter.getInstance();
