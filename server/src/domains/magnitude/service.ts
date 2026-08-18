import { EventEmitter } from 'events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  MagnitudeRunRecord,
  MagnitudeEvent,
  MagnitudeEventType,
  MagnitudeInspectResult,
  MagnitudeRunStatus,
  MagnitudeApprovalRequest,
  RiskLevel
} from './types.js';

// Screenshot evidence directory: <data dir>/magnitude-screenshots/<projectId-or-global>/<runId>.png
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = process.env.AGENTICOS_DATA_DIR
  ? path.resolve(process.env.AGENTICOS_DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');
export const MAGNITUDE_SCREENSHOT_DIR = process.env.AGENTICOS_MAGNITUDE_SCREENSHOT_DIR
  ? path.resolve(process.env.AGENTICOS_MAGNITUDE_SCREENSHOT_DIR)
  : path.join(DEFAULT_DATA_DIR, 'magnitude-screenshots');
fs.mkdirSync(MAGNITUDE_SCREENSHOT_DIR, { recursive: true });

/**
 * Initialize Magnitude SQLite tables idempotently.
 */
function initMagnitudeTables() {
  try {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS magnitude_runs (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        requested_url TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        result TEXT,
        error TEXT,
        approval TEXT,
        conversation_id TEXT,
        project_id TEXT,
        project_task_id TEXT,
        execution_run_id TEXT,
        schedule_execution_id TEXT
      );

      CREATE TABLE IF NOT EXISTS magnitude_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        FOREIGN KEY (run_id) REFERENCES magnitude_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_magnitude_events_run ON magnitude_events(run_id, sequence);
    `);

    // Ensure newer columns exist if table was previously created without them.
    // NOTE: this MUST run before creating idx_magnitude_runs_project — on a
    // legacy table (created without project_id) the index statement would
    // throw, aborting the whole exec and silently skipping these ALTERs
    // (live-deploy bug found 2026-08-17).
    for (const col of ['project_id', 'project_task_id', 'execution_run_id', 'schedule_execution_id']) {
      try {
        rawDb.exec(`ALTER TABLE magnitude_runs ADD COLUMN ${col} TEXT;`);
      } catch {}
    }
    try {
      rawDb.exec(`ALTER TABLE magnitude_runs ADD COLUMN approval TEXT;`);
    } catch {}
    // Indexes that depend on the added columns must be created AFTER the
    // ALTERs, in their own try/catch, so a legacy-table migration cannot
    // abort the sequence.
    try {
      rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_magnitude_runs_project ON magnitude_runs(project_id);`);
    } catch {}
  } catch (err: any) {
    logger.warn('[Magnitude] Failed to init tables:', err.message);
  }
}

initMagnitudeTables();

export class MagnitudeService extends EventEmitter {
  private activeRuns = new Map<string, {
    abortController: AbortController;
    cleanup: () => Promise<void>;
    approvalResolver?: (approved: boolean) => void;
  }>();

  /**
   * Extract or validate an HTTP/HTTPS URL from a goal prompt or URL input.
   */
  public extractAndValidateUrl(input: string): { url: string; error?: string } {
    const trimmed = input.trim();
    if (!trimmed) {
      return { url: '', error: 'No URL or goal provided.' };
    }

    // Match http or https URLs in prompt
    const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
    let candidate = urlMatch ? urlMatch[0] : trimmed;

    // If no scheme was given, accept a bare domain token (e.g. "example.com"
    // in "inspect example.com and tell me the title") so natural-language
    // browser requests route correctly (A7/M9). Common TLDs + co.uk style.
    if (!urlMatch) {
      const domainMatch = trimmed.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|dev|ai|gov|edu|co|uk|app|me|info|xyz|site)\b/i);
      if (domainMatch) candidate = domainMatch[0];
    }

    // Strip trailing natural language punctuation (e.g. "https://example.com," -> "https://example.com")
    candidate = candidate.replace(/[.,;:!?)]+$/, '');

    // Reject dangerous/unsupported schemes
    if (/^(file|javascript|data|chrome|chrome-extension|about|blob):/i.test(candidate)) {
      return { url: '', error: 'Forbidden URL scheme. Only HTTP and HTTPS are permitted.' };
    }

    if (!/^https?:\/\//i.test(candidate)) {
      // Try adding https://
      candidate = `https://${candidate}`;
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { url: '', error: 'Invalid URL protocol. Must be http:// or https://' };
      }
      return { url: parsed.href };
    } catch {
      return { url: '', error: `Invalid URL: "${trimmed}"` };
    }
  }

  /**
   * Create a new Magnitude run record.
   */
  public createRun(
    goal: string,
    actionType: 'inspect' | 'click' | 'search' = 'inspect',
    conversationId?: string,
    provenance?: { projectId?: string; projectTaskId?: string; executionRunId?: string; scheduleExecutionId?: string },
  ): MagnitudeRunRecord {
    const runId = `mag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const { url } = this.extractAndValidateUrl(goal);
    const initialStatus: MagnitudeRunStatus = 'queued';

    const stmt = rawDb.prepare(`
      INSERT INTO magnitude_runs (id, goal, requested_url, action_type, status, created_at, updated_at, conversation_id, project_id, project_task_id, execution_run_id, schedule_execution_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      runId, goal, url || goal, actionType, initialStatus, now, now,
      conversationId || null,
      provenance?.projectId || null,
      provenance?.projectTaskId || null,
      provenance?.executionRunId || null,
      provenance?.scheduleExecutionId || null,
    );

    const record: MagnitudeRunRecord = {
      id: runId,
      goal,
      requestedUrl: url || goal,
      actionType,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
      events: [],
      conversationId,
      projectId: provenance?.projectId,
      projectTaskId: provenance?.projectTaskId,
      executionRunId: provenance?.executionRunId,
      scheduleExecutionId: provenance?.scheduleExecutionId,
    };

    this.appendEvent(runId, 1, 'magnitude_started', `Magnitude task queued: ${goal}`);
    return record;
  }

  /**
   * Append an event to a run and emit it for live listeners.
   */
  public appendEvent(runId: string, sequence: number, type: MagnitudeEventType, message: string, details?: any): MagnitudeEvent {
    const now = new Date().toISOString();
    const eventId = `magevt-${runId}-${sequence}`;

    const stmt = rawDb.prepare(`
      INSERT INTO magnitude_events (id, run_id, sequence, timestamp, event_type, message, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(eventId, runId, sequence, now, type, message, details ? JSON.stringify(details) : null);

    const event: MagnitudeEvent = {
      id: eventId,
      runId,
      sequence,
      timestamp: now,
      type,
      message,
      details
    };

    this.emit('event', event);
    this.emit(`event:${runId}`, event);
    return event;
  }

  /**
   * Request human approval for a risky action (Phase 5).
   */
  public async requestApproval(
    runId: string,
    actionType: 'click' | 'fill' | 'navigate' | 'download' | 'submit',
    targetUrl: string,
    description: string,
    riskLevel: RiskLevel = 'medium'
  ): Promise<boolean> {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const approvalId = `appr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const approvalRequest: MagnitudeApprovalRequest = {
      id: approvalId,
      runId,
      targetUrl,
      actionType,
      description,
      riskLevel,
      status: 'pending',
      createdAt: now
    };

    rawDb.prepare(`UPDATE magnitude_runs SET status = 'waiting_for_approval', approval = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(approvalRequest), now, runId);

    const seq = (run.events?.length || 0) + 1;
    this.appendEvent(runId, seq, 'approval_requested', `Approval required for ${actionType.toUpperCase()}: ${description} (${riskLevel} risk)`, {
      approvalRequest
    });

    return new Promise<boolean>((resolve) => {
      const active = this.activeRuns.get(runId);
      if (active) {
        active.approvalResolver = resolve;
      } else {
        resolve(false);
      }
    });
  }

  /**
   * Respond to an approval request (approve / reject).
   */
  public async respondApproval(runId: string, approved: boolean, reason?: string, responder = 'user'): Promise<boolean> {
    const run = this.getRun(runId);
    if (!run || !run.approval || run.approval.status !== 'pending') {
      return false;
    }

    const now = new Date().toISOString();
    const updatedApproval: MagnitudeApprovalRequest = {
      ...run.approval,
      status: approved ? 'approved' : 'rejected',
      respondedAt: now,
      responder,
      reason
    };

    const nextStatus: MagnitudeRunStatus = approved ? 'running' : 'stopped';
    rawDb.prepare(`UPDATE magnitude_runs SET status = ?, approval = ?, updated_at = ? WHERE id = ?`)
      .run(nextStatus, JSON.stringify(updatedApproval), now, runId);

    const seq = (run.events?.length || 0) + 1;
    const eventType: MagnitudeEventType = approved ? 'approval_granted' : 'approval_rejected';
    this.appendEvent(runId, seq, eventType, approved ? 'Approval granted. Continuing execution.' : `Approval rejected: ${reason || 'Denied by user'}`, {
      approval: updatedApproval
    });

    const active = this.activeRuns.get(runId);
    if (active?.approvalResolver) {
      active.approvalResolver(approved);
      delete active.approvalResolver;
    }

    return true;
  }

  /**
   * Get full details for a run including all historical events and approval payload.
   */
  public getRun(runId: string): MagnitudeRunRecord | null {
    const row: any = rawDb.prepare(`SELECT * FROM magnitude_runs WHERE id = ?`).get(runId);
    if (!row) return null;

    const eventRows: any[] = rawDb.prepare(`SELECT * FROM magnitude_events WHERE run_id = ? ORDER BY sequence ASC`).all(runId);
    const events: MagnitudeEvent[] = eventRows.map(r => ({
      id: r.id,
      runId: r.run_id,
      sequence: r.sequence,
      timestamp: r.timestamp,
      type: r.event_type as MagnitudeEventType,
      message: r.message,
      details: r.details ? JSON.parse(r.details) : undefined
    }));

    return {
      id: row.id,
      goal: row.goal,
      requestedUrl: row.requested_url,
      actionType: row.action_type,
      status: row.status as MagnitudeRunStatus,
      approval: row.approval ? JSON.parse(row.approval) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
      events,
      conversationId: row.conversation_id,
      projectId: row.project_id,
      projectTaskId: row.project_task_id,
      executionRunId: row.execution_run_id,
      scheduleExecutionId: row.schedule_execution_id,
    };
  }

  /**
   * Get all runs for history/hydration, optionally scoped to a project
   * (A5 — project isolation: evidence can never bleed between projects).
   */
  public getAllRuns(limit = 50, projectId?: string): MagnitudeRunRecord[] {
    const rows: any[] = projectId
      ? rawDb.prepare(`SELECT * FROM magnitude_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`).all(projectId, limit)
      : rawDb.prepare(`SELECT * FROM magnitude_runs ORDER BY created_at DESC LIMIT ?`).all(limit);
    return rows.map(row => ({
      id: row.id,
      goal: row.goal,
      requestedUrl: row.requested_url,
      actionType: row.action_type,
      status: row.status as MagnitudeRunStatus,
      approval: row.approval ? JSON.parse(row.approval) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
      events: [],
      conversationId: row.conversation_id,
      projectId: row.project_id,
      projectTaskId: row.project_task_id,
      executionRunId: row.execution_run_id,
      scheduleExecutionId: row.schedule_execution_id,
    }));
  }

  /**
   * Cancel / abort an active Magnitude run.
   */
  public async cancelRun(runId: string): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      const run = this.getRun(runId);
      if (run && (run.status === 'running' || run.status === 'waiting_for_approval' || run.status === 'queued')) {
        this.updateRunStatus(runId, 'stopped', undefined, 'Run stopped by user.');
        this.appendEvent(runId, 999, 'magnitude_stopped', 'Execution stopped.');
        return true;
      }
      return false;
    }

    if (active.approvalResolver) {
      active.approvalResolver(false);
    }

    active.abortController.abort();
    await active.cleanup().catch(() => {});
    this.activeRuns.delete(runId);

    this.updateRunStatus(runId, 'stopped', undefined, 'Execution stopped by user.');
    this.appendEvent(runId, 999, 'magnitude_stopped', 'Execution stopped by user.');
    return true;
  }

  private updateRunStatus(runId: string, status: MagnitudeRunStatus, result?: MagnitudeInspectResult, error?: string) {
    const now = new Date().toISOString();
    const run = this.getRun(runId);
    const startedAtMs = run?.startedAt ? new Date(run.startedAt).getTime() : Date.now();
    const durationMs = Date.now() - startedAtMs;

    const stmt = rawDb.prepare(`
      UPDATE magnitude_runs
      SET status = ?, result = ?, error = ?, completed_at = ?, duration_ms = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      status,
      result ? JSON.stringify(result) : null,
      error || null,
      now,
      durationMs,
      now,
      runId
    );
  }

  /**
   * Execute a browser inspect task with complete error bounding, timeouts, and process cleanup.
   */
  public async executeInspect(runId: string): Promise<MagnitudeInspectResult> {
    const startTime = Date.now();
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found.`);

    const { url, error: urlError } = this.extractAndValidateUrl(run.requestedUrl);
    if (urlError || !url) {
      this.updateRunStatus(runId, 'failed', undefined, urlError || 'Invalid URL');
      this.appendEvent(runId, 2, 'magnitude_failed', `URL Validation Failed: ${urlError}`);
      throw new Error(urlError || 'Invalid URL');
    }

    // Set status = running
    rawDb.prepare(`UPDATE magnitude_runs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), new Date().toISOString(), runId);

    const abortController = new AbortController();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    let cleanupDone = false;
    const cleanup = async () => {
      if (cleanupDone) return;
      cleanupDone = true;
      try { if (page) await page.close().catch(() => {}); } catch {}
      try { if (context) await context.close().catch(() => {}); } catch {}
      try { if (browser) await browser.close().catch(() => {}); } catch {}
    };

    this.activeRuns.set(runId, { abortController, cleanup });

    let seq = 2;
    try {
      if (abortController.signal.aborted) throw new Error('Run aborted before start');

      // 1. Launch Browser
      this.appendEvent(runId, seq++, 'browser_launch_started', 'Launching Chromium browser...');
      browser = await chromium.launch({
        headless: true,
        timeout: 15000
      });
      this.appendEvent(runId, seq++, 'browser_launched', 'Chromium browser launched successfully.');

      if (abortController.signal.aborted) throw new Error('Run aborted after browser launch');

      // 2. Create Context & Page
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AgenticOS/1.0',
        viewport: { width: 1280, height: 800 }
      });
      page = await context.newPage();
      page.setDefaultNavigationTimeout(20000);
      page.setDefaultTimeout(15000);

      if (abortController.signal.aborted) throw new Error('Run aborted before navigation');

      // 3. Navigate
      this.appendEvent(runId, seq++, 'navigation_started', `Navigating to ${url}...`, { url });
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const finalUrl = page.url();
      const httpStatus = response?.status() || 200;
      this.appendEvent(runId, seq++, 'navigation_completed', `Navigation complete (HTTP ${httpStatus}) -> ${finalUrl}`, { finalUrl, httpStatus });

      if (abortController.signal.aborted) throw new Error('Run aborted after navigation');

      // 4. Inspect Page
      this.appendEvent(runId, seq++, 'inspection_started', 'Inspecting page title, metadata, and visible content...');
      const title = await page.title();

      // Extract visible text cleanly
      const textContent = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script, style, noscript, svg, nav, footer, header');
        scripts.forEach(s => s.remove());
        const bodyText = document.body ? document.body.innerText : '';
        return bodyText.replace(/\s+/g, ' ').trim().slice(0, 4000);
      }).catch(() => '');

      const metaDescription = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
        return meta ? meta.getAttribute('content') || '' : '';
      }).catch(() => '');

      const linksCount = await page.evaluate(() => document.querySelectorAll('a[href]').length).catch(() => 0);

      this.appendEvent(runId, seq++, 'inspection_completed', `Inspected: "${title}" (${textContent.length} chars text, ${linksCount} links)`, {
        title,
        textLength: textContent.length,
        linksCount
      });

      // 4b. Screenshot evidence (M7) — captured into the run's own file so
      // evidence is associated with the exact run/project.
      let screenshotPath: string | undefined;
      let screenshotBytes: number | undefined;
      try {
        const projectDir = run.projectId
          ? path.join(MAGNITUDE_SCREENSHOT_DIR, run.projectId.replace(/[^a-zA-Z0-9_-]/g, '_'))
          : path.join(MAGNITUDE_SCREENSHOT_DIR, 'global');
        fs.mkdirSync(projectDir, { recursive: true });
        const filePath = path.join(projectDir, `${runId}.png`);
        await page.screenshot({ path: filePath, fullPage: false });
        const stat = fs.statSync(filePath);
        screenshotPath = filePath;
        screenshotBytes = stat.size;
        this.appendEvent(runId, seq++, 'screenshot_captured', `Screenshot captured (${(stat.size / 1024).toFixed(1)} KB)`, { screenshotPath, screenshotBytes: stat.size });
      } catch (screenshotErr: any) {
        this.appendEvent(runId, seq++, 'screenshot_failed', `Screenshot capture failed: ${screenshotErr?.message || 'unknown'}`, {});
      }

      const durationMs = Date.now() - startTime;
      const result: MagnitudeInspectResult = {
        url,
        finalUrl,
        title: title || 'Untitled Page',
        text: textContent,
        metaDescription: metaDescription || undefined,
        linksCount,
        durationMs,
        actionSummary: `Successfully inspected ${finalUrl}: "${title}"`,
        screenshotPath,
        screenshotBytes,
      };

      // 5. Complete
      this.updateRunStatus(runId, 'completed', result);
      this.appendEvent(runId, seq++, 'magnitude_completed', `Task completed in ${(durationMs / 1000).toFixed(1)}s: ${title}`, { result });

      return result;
    } catch (err: any) {
      const isAborted = abortController.signal.aborted || err.message?.includes('aborted') || err.message?.includes('Target closed');
      const errorMsg = isAborted ? 'Execution stopped by user.' : (err.message || 'Browser inspection failed.');
      const status: MagnitudeRunStatus = isAborted ? 'stopped' : 'failed';
      const eventType: MagnitudeEventType = isAborted ? 'magnitude_stopped' : 'magnitude_failed';

      this.updateRunStatus(runId, status, undefined, errorMsg);
      this.appendEvent(runId, seq++, eventType, `Task ${status}: ${errorMsg}`, { error: errorMsg });
      throw new Error(errorMsg);
    } finally {
      await cleanup();
      this.activeRuns.delete(runId);
    }
  }
}

export const magnitudeService = new MagnitudeService();
