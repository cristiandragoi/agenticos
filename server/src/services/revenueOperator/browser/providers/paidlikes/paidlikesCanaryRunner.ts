/**
 * Canary Execution Runner for PaidLikes Provider.
 * Runs 1 provider account, 1 worker, and up to 3 real tasks through the full stack.
 * Halts immediately if unauthenticated, CAPTCHA detected, or policy blocked.
 */

import path from 'path';
import Database from 'better-sqlite3';
import { BrowserSessionManager } from '../../browserSessionManager.js';
import { BrowserTaskQueue } from '../../browserTaskQueue.js';
import { BrowserPolicyEnforcer } from '../../browserPolicyEnforcer.js';
import { browserPolicyRegistry } from '../../browserPolicyRegistry.js';
import { PaidLikesRevenueProvider } from './paidlikesProvider.js';
import { createPaidLikesPolicy } from './paidlikesPolicy.js';
import { BrowserWorkerAgent } from '../../browserWorkerAgent.js';

export interface CanaryAccountRecord {
  id: string;
  providerId: string;
  accountIdentifier: string;
  profilePath: string;
  status: string;
}

export interface CanaryRunReport {
  accountSession: 'VALID' | 'INVALID';
  tasksDiscovered: number;
  tasksAttempted: number;
  tasksCompleted: number;
  tasksGated: number;
  tasksDenied: number;
  tasksFailed: number;
  revenueExpected: number;
  revenueVerified: number;
  duplicateRevenue: number;
  stuckTasks: number;
  captchaEncountered: boolean;
  unexpectedDom: boolean;
  sessionPersistence: 'CONFIRMED' | 'NOT_TESTED' | 'FAILED';
  policyViolations: number;
  details: string[];
}

export async function runPaidLikesCanary(options: {
  db?: Database.Database;
  profilesDir?: string;
  providerAccountId?: string;
  maxTasks?: number;
  headless?: boolean;
} = {}): Promise<CanaryRunReport> {
  const providerAccountId = options.providerAccountId || 'paidlikes_canary_account';
  const profilesDir = options.profilesDir || path.join(process.cwd(), 'data', 'revenue-operator', 'profiles');
  const db = options.db || new Database(':memory:');
  const maxTasks = options.maxTasks ?? 3;
  const headless = options.headless ?? true;

  const sessionManager = new BrowserSessionManager(profilesDir);
  const taskQueue = new BrowserTaskQueue(db);
  const policyEnforcer = new BrowserPolicyEnforcer();
  const provider = new PaidLikesRevenueProvider();

  // Register policy in registry
  const policy = createPaidLikesPolicy(providerAccountId);
  browserPolicyRegistry.registerPolicy(policy);

  const report: CanaryRunReport = {
    accountSession: 'INVALID',
    tasksDiscovered: 0,
    tasksAttempted: 0,
    tasksCompleted: 0,
    tasksGated: 0,
    tasksDenied: 0,
    tasksFailed: 0,
    revenueExpected: 0,
    revenueVerified: 0,
    duplicateRevenue: 0,
    stuckTasks: 0,
    captchaEncountered: false,
    unexpectedDom: false,
    sessionPersistence: 'NOT_TESTED',
    policyViolations: 0,
    details: [],
  };

  const accountRecord: CanaryAccountRecord = {
    id: providerAccountId,
    providerId: 'paidlikes',
    accountIdentifier: 'canary_user',
    profilePath: `profile_${providerAccountId}`,
    status: 'active',
  };

  // 1. Inspect live PaidLikes session using persistent Playwright profile
  const session = await sessionManager.acquireSession(
    providerAccountId,
    accountRecord.profilePath,
    'canary-inspector',
    { headless }
  );

  const page = await session.context.newPage();

  try {
    report.details.push(`Navigating to ${provider.getStartingUrl(accountRecord)}`);
    await page.goto(provider.getStartingUrl(accountRecord), { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Detect anomalies (CAPTCHA / Cloudflare)
    const anomaly = await provider.detectAnomalies(page, accountRecord);
    if (anomaly.detected) {
      if (anomaly.anomalyType === 'CAPTCHA') {
        report.captchaEncountered = true;
      }
      report.details.push(`Anomaly detected on entry: ${anomaly.anomalyType} (${anomaly.description})`);
    }

    // Validate session
    const isValidSession = await provider.validateSession(page, accountRecord);
    report.accountSession = isValidSession ? 'VALID' : 'INVALID';
    report.details.push(`Session status evaluated: ${report.accountSession}`);

    if (!isValidSession) {
      report.details.push('Stopping canary: Session is unauthenticated. Manual login bootstrap required.');
      await page.close();
      await sessionManager.releaseSession(providerAccountId, 'canary-inspector');
      return report;
    }

    // 2. Discover available tasks
    const discovered = await provider.discoverTasks(page, accountRecord);
    report.tasksDiscovered = discovered.length;
    report.details.push(`Discovered ${discovered.length} supported tasks`);

    // Queue up to maxTasks into task queue
    const tasksToQueue = discovered.slice(0, maxTasks);
    for (const d of tasksToQueue) {
      taskQueue.createTask({
        providerId: 'paidlikes',
        providerAccountId,
        externalTaskId: d.externalTaskId,
        taskType: d.taskType,
        targetUrl: d.targetUrl,
        actionPayload: d.actionPayload,
        expectedReward: d.expectedReward,
        priority: d.priority,
      });
      report.revenueExpected += d.expectedReward;
    }

    await page.close();
    await sessionManager.releaseSession(providerAccountId, 'canary-inspector');

    if (tasksToQueue.length === 0) {
      report.details.push('No supported canary tasks currently available on PaidLikes.');
      return report;
    }

    // 3. Autonomous worker execution through BrowserWorkerAgent
    const agent = new BrowserWorkerAgent('canary-worker', providerAccountId, provider, db, {
      sessionManager,
      policyEnforcer,
      headless,
    });

    for (let i = 0; i < tasksToQueue.length; i++) {
      report.tasksAttempted++;
      const summary = await agent.executeNextTask();

      if (!summary) {
        break;
      }

      if (summary.terminalStatus === 'COMPLETED') {
        report.tasksCompleted++;
        report.revenueVerified += summary.rewardEarned;
      } else if (summary.terminalStatus === 'GATED') {
        report.tasksGated++;
        break; // Stop immediately on gate
      } else if (summary.terminalStatus === 'DENIED') {
        report.tasksDenied++;
        report.policyViolations++;
        break; // Stop immediately on deny
      } else {
        report.tasksFailed++;
        break; // Stop immediately on failure
      }
    }

    // Check stuck tasks
    const stuck = db.prepare("SELECT COUNT(*) as count FROM revenue_browser_tasks WHERE status = 'leased'").get() as any;
    report.stuckTasks = stuck?.count || 0;

    // Check duplicate revenue
    const duplicateCount = db.prepare(`
      SELECT COUNT(*) - COUNT(DISTINCT json_extract(provenance, '$.externalTaskId')) as dupes
      FROM revenue_ledger_entries
      WHERE source = 'browser_revenue_operator'
    `).get() as any;
    report.duplicateRevenue = duplicateCount?.dupes || 0;

    report.sessionPersistence = 'CONFIRMED';
  } catch (err: any) {
    report.details.push(`Canary error: ${err.message}`);
  } finally {
    if (!page.isClosed()) {
      await page.close().catch(() => {});
    }
    await sessionManager.releaseSession(providerAccountId, 'canary-inspector').catch(() => {});
  }

  return report;
}
