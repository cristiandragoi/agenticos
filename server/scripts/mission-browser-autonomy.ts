/**
 * mission-browser-autonomy.ts
 *
 * Creates / updates the REAL persistent AgenticOS mission record for
 *
 *   JARVIS_BROWSER_AUTONOMY_STABILIZATION
 *
 * It writes a canonical BackgroundTaskRecord through the existing
 * `backgroundTaskRepo` (services/backgroundTasks) — the same contract, table and
 * manager the rest of the platform uses. No new orchestration framework.
 *
 * Idempotent: re-running updates the existing mission instead of duplicating it.
 *
 *   npx tsx scripts/mission-browser-autonomy.ts [--status <TaskStatus>]
 */

import { backgroundTaskRepo } from '../src/services/backgroundTasks/store.js';
import type { BackgroundTaskRecord, TaskStatus } from '../src/services/backgroundTasks/types.js';

export const MISSION_ID = 'JARVIS_BROWSER_AUTONOMY_STABILIZATION';
export const MISSION_TASK_ID = 'mission-jarvis-browser-autonomy';
export const PROJECT_ID = 'agenticos';
export const WORKSPACE = 'D:/AgenticOS';

export const ACCEPTANCE_CRITERIA = [
  '1. intermittent focused-suite flake classified and either fixed or proven unrelated',
  '2. focused browser/conversation suites stable across repeated runs',
  '3. Jarvis canonical turn path executes: Accept it / Search for Seeadler TV / Open the channel / Go back / Open it again / That\'s wrong / Scroll down',
  '4. no generic "What would you like me to do with browser?" when browser context exists',
  '5. cookie consent preference survives AgenticOS restart',
  '6. browser action success requires actual verification',
  '7. no repeated navigation when a click was requested',
  '8. stability metrics remain clean',
  '9. deployed build healthy',
  '10. live acceptance passes',
];

export const CONSTRAINTS = [
  'reuse current BrowserExecutor',
  'no second browser subsystem',
  'no assertion weakening',
  'no fake success',
  'no unrelated production changes to make legacy tests green',
  'preserve existing truthful execution gates',
  'no automated earning actions on Freecash (ToS §17) — account ACCESS only, never offers/clicks/tasks',
];

export const OBJECTIVE =
  'Complete and stabilize the canonical Jarvis browser-action loop so conversational ' +
  'browser commands are executed through the real Jarvis turn path with persisted ' +
  'browser context and verified actions.';

export function buildMissionRecord(
  status: TaskStatus,
  attempt: number,
  prior?: BackgroundTaskRecord,
): BackgroundTaskRecord {
  const now = new Date().toISOString();
  return {
    taskId: MISSION_TASK_ID,
    title: 'Jarvis Browser Autonomy — Canonical Integration and Stability',
    objective: OBJECTIVE,
    originalRequest:
      'Run the Jarvis browser-autonomy stabilization as a persistent AgenticOS mission. ' +
      'Supervisor: Hermes 1. Worker: Codex. Independent verification: Argus. ' +
      'Recovery: existing Self-Heal / BackgroundTaskManager bounded retry.',
    route: 'browser_autonomy',
    selectedAgent: 'codex',
    status,
    priority: 'high',
    projectId: PROJECT_ID,
    createdAt: prior?.createdAt ?? now,
    startedAt: prior?.startedAt ?? now,
    updatedAt: now,
    completedAt: null,
    conversationId: prior?.conversationId ?? null,
    conversationSessionId: prior?.conversationSessionId ?? null,
    worker: 'codex',
    linkedRunId: prior?.linkedRunId ?? null,
    linkedBoardCardId: prior?.linkedBoardCardId ?? null,
    parentTaskId: null,
    childTaskIds: prior?.childTaskIds ?? [],
    currentStage: prior?.currentStage ?? 'flake_triage',
    progressMessage: prior?.progressMessage ?? 'Mission created; dispatching Codex on flake triage',
    filesChanged: prior?.filesChanged ?? [],
    buildState: prior?.buildState ?? 'passed',
    testState: prior?.testState ?? 'running',
    verificationState: prior?.verificationState ?? 'pending',
    approvalState: 'none',
    blocker: null,
    lastError: null,
    cancellationRequested: false,
    resumable: true,
    resultText: null,
    attempt,
    metadata: {
      missionId: MISSION_ID,
      supervisor: 'hermes-1',
      worker: 'codex',
      independentVerification: 'argus',
      recovery: 'self-heal/BackgroundTaskManager bounded retry (max 3 attempts)',
      // Continuation chain registered with the mission so it does not depend on
      // a human pasting another prompt.
      missionChain: [
        MISSION_ID,
        'CREDENTIAL_ACCOUNT_ACCESS_MANAGER',
        'FREE_CASH_ACCOUNT_ACCESS',
        'SHOPIFY_ACCOUNT_ACCESS',
        'TIKTOK_SHOP_ACCOUNT_ACCESS',
        'INTERNAL_AGENTICOS_BROWSER',
        'AUTHENTICATED_SESSION_REUSE',
      ],
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
      constraints: CONSTRAINTS,
      // Human-only stop conditions — accounts access missions will hit these.
      humanOnlyStopConditions: [
        'login credentials',
        'MFA',
        'CAPTCHA',
        'identity verification',
        'security consent',
        'destructive action',
        'physical microphone acceptance',
        'subjective UX judgement',
      ],
      knownTruth:
        'Account-access missions (FREE_CASH/SHOPIFY/TIKTOK_SHOP) inherently require ' +
        'human credential entry; they cannot be completed autonomously end-to-end. ' +
        'Freecash earning automation stays refused (ToS §17).',
    },
    workspaceRoot: WORKSPACE,
  };
}

function main(): void {
  backgroundTaskRepo.ensureTables();

  const statusArgIdx = process.argv.indexOf('--status');
  const status: TaskStatus =
    statusArgIdx > -1 ? (process.argv[statusArgIdx + 1] as TaskStatus) : 'running';

  const existing = backgroundTaskRepo.getTask(MISSION_TASK_ID);
  if (existing) {
    const updated = backgroundTaskRepo.updateTask(MISSION_TASK_ID, {
      status,
      ...(() => {
        const rec = buildMissionRecord(status, existing.attempt || 1, existing);
        return {
          objective: rec.objective,
          metadata: rec.metadata,
          selectedAgent: rec.selectedAgent,
          worker: rec.worker,
          resumable: rec.resumable,
        };
      })(),
    });
    console.log(JSON.stringify({ action: 'updated', task: updated }, null, 2));
    return;
  }

  const record = buildMissionRecord(status, 1);
  backgroundTaskRepo.insertTask(record);
  const stored = backgroundTaskRepo.getTask(MISSION_TASK_ID);
  console.log(JSON.stringify({ action: 'inserted', task: stored }, null, 2));
}

main();
