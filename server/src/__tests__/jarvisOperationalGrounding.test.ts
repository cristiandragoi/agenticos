/**
 * jarvisOperationalGrounding.test.ts
 *
 * Evidence-first architecture tests for Jarvis operational claims.
 *
 * DATABASE ISOLATION PROOF
 * ────────────────────────
 * This test suite uses the database module's assertTestDatabaseIsolation() to
 * prove, before any destructive fixture setup, that:
 *   1. NODE_ENV=test causes db/index.ts to open a fresh temp database.
 *   2. The resolved path is under os.tmpdir().
 *   3. The path is not either protected production database.
 *   4. Production row counts are read before the suite and verified unchanged after.
 *
 * IMPORTANT: NODE_ENV must be "test" before ANY module imports. In Vitest this
 * is guaranteed because Vitest always sets NODE_ENV=test before loading test
 * files. Static ESM imports are hoisted, but the module evaluates AFTER
 * Vitest has set the environment.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import jarvisRouter from '../routers/jarvis.js';
import { OperationalClaimGate, OperationalController } from '../domains/jarvis/operationalEvidence.js';
import { rawDb, db, resolvedDbPath, assertTestDatabaseIsolation, PRODUCTION_DB_PATHS } from '../db/index.js';
import { conversations } from '../db/schema.js';

// ── Mock LLM gateway — keep tests fully local and deterministic ───────────────
vi.mock('../services/llmGateway.js', () => ({
  llmChat: vi.fn(async () => ({
    reply: 'Mocked LLM Supervisor V2 Direct Answer.',
    provider: 'agentic-os',
    model: 'mock-llm',
  })),
  llmChatStream: vi.fn(() => {
    let called = false;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (!called) {
              called = true;
              return {
                done: false,
                value: {
                  type: 'token',
                  content: 'Mocked streaming response.',
                  provider: 'agentic-os',
                  model: 'mock-llm',
                },
              };
            }
            return { done: true };
          },
        };
      },
    };
  }),
}));

const app = express();
app.use(express.json());
app.use('/api/jarvis', jarvisRouter);

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION DATABASE ROW COUNT BASELINE
// Read row counts from both production databases (read-only) so we can assert
// they are unchanged after the test suite.
// ─────────────────────────────────────────────────────────────────────────────
interface ProdCounts {
  path: string;
  tasks: number;
  conversations: number;
}

function readProductionCounts(dbPath: string): ProdCounts | null {
  try {
    const conn = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tasks = (conn.prepare("SELECT COUNT(*) AS n FROM background_tasks").get() as any)?.n ?? -1;
    const convs = (conn.prepare("SELECT COUNT(*) AS n FROM conversations").get() as any)?.n ?? -1;
    conn.close();
    return { path: dbPath, tasks, conversations: convs };
  } catch {
    return null; // DB may not have these tables — not our concern
  }
}

let prodCountsBefore: Array<ProdCounts | null> = [];
let prodCountsAfter: Array<ProdCounts | null> = [];

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE ISOLATION PROOF
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(() => {
  // Step 1: Assert the resolved path is a safe temp database.
  assertTestDatabaseIsolation();

  // Step 2: Log the resolved path for audit.
  const tmpDir = os.tmpdir();
  console.log('[DB ISOLATION PROOF] Resolved test DB path:', resolvedDbPath);
  console.log('[DB ISOLATION PROOF] OS temp dir:', tmpDir);

  // Step 3: Verify the path is under tmpdir.
  const normResolved = resolvedDbPath.toLowerCase().replace(/\//g, '\\');
  const normTmp = tmpDir.toLowerCase().replace(/\//g, '\\');
  expect(normResolved).toMatch(new RegExp('^' + normTmp.replace(/\\/g, '\\\\').replace(/[()[\]{}*+?^$|]/g, '\\$&')));

  // Step 4: Verify it is not either production path.
  for (const prodPath of PRODUCTION_DB_PATHS) {
    const normProd = prodPath.toLowerCase().replace(/\//g, '\\');
    expect(normResolved, `Test DB must not be production path: ${prodPath}`).not.toBe(normProd);
  }

  // Step 5: Record production row counts before the suite.
  prodCountsBefore = PRODUCTION_DB_PATHS.map(readProductionCounts);
  console.log('[DB ISOLATION PROOF] Production counts before suite:', prodCountsBefore);
});

afterAll(() => {
  // Step 6: Verify production databases are unchanged.
  prodCountsAfter = PRODUCTION_DB_PATHS.map(readProductionCounts);
  console.log('[DB ISOLATION PROOF] Production counts after suite:', prodCountsAfter);

  for (let i = 0; i < prodCountsBefore.length; i++) {
    const before = prodCountsBefore[i];
    const after = prodCountsAfter[i];
    if (before === null || after === null) continue; // DB did not exist — no concern
    expect(after.tasks, `Production DB tasks changed at ${before.path}`).toBe(before.tasks);
    expect(after.conversations, `Production DB conversations changed at ${before.path}`).toBe(before.conversations);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE
// ─────────────────────────────────────────────────────────────────────────────
describe('Jarvis Operational Grounding & Evidence-First Architecture', () => {
  const convId = 'conv-grounding-test';

  beforeEach(() => {
    // Reset isolated temp DB task tables.
    backgroundTaskRepo.ensureTables();
    rawDb.exec('DELETE FROM background_task_events');
    rawDb.exec('DELETE FROM background_tasks');

    // Register active test conversation row.
    db.insert(conversations)
      .values({
        id: convId,
        title: 'Operational Grounding Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();

    // Mock global fetch.
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        body: {
          getReader: () => {
            let called = false;
            return {
              read: async () => {
                if (!called) {
                  called = true;
                  return {
                    done: false,
                    value: new TextEncoder().encode(
                      'data: {"choices":[{"delta":{"content":"Mocked fetch response."}}]}\n\n'
                    ),
                  };
                }
                return { done: true };
              },
            };
          },
        },
      } as any;
    });
  });

  // Test both legacy and production routing paths.
  for (const useSupervisorV2 of ['false', 'true']) {
    describe(`Execution Path: JARVIS_SUPERVISOR_V2 = ${useSupervisorV2}`, () => {
      beforeEach(() => {
        process.env.JARVIS_SUPERVISOR_V2 = useSupervisorV2;
      });

      // ── 1. Negative Tests (Empty Database) ─────────────────────────────
      describe('Empty Database — Block Fabricated Claims', () => {
        it('Blocks "I have created the Shopify integration task" when no task exists', () => {
          const reply = 'I have created the Shopify integration task bgtask-1234. It is running.';
          const checked = OperationalClaimGate.verifyClaims(reply, convId);
          expect(checked.ok).toBe(false);
          expect(checked.response).toBe('No matching task exists.');
        });

        it('Blocks awaiting-approval claim when no approval record exists', () => {
          const reply = 'The task is currently awaiting human approval under ID app-555.';
          const checked = OperationalClaimGate.verifyClaims(reply, convId);
          expect(checked.ok).toBe(false);
          expect(checked.response).toBe('No pending approvals exist for this conversation.');
        });

        it('Blocks notification subscription claims (capability absent)', () => {
          const reply = 'You have successfully subscribed to notifications for the Shopify task.';
          const checked = OperationalClaimGate.verifyClaims(reply, convId);
          expect(checked.ok).toBe(false);
          expect(checked.response).toBe(
            'Automatic status notifications are not configured. Ask me for the current status.'
          );
        });

        it('Conversational "yes" returns "No matching task exists" when no pending approval exists', async () => {
          const res = await request(app)
            .post(`/api/jarvis/conversations/${convId}/message/stream`)
            .send({ prompt: 'yes', operationId: `op-yes-empty-${useSupervisorV2}` });
          expect(res.status).toBe(200);
          expect(res.text).toContain('No matching task exists.');
        });

        it('"Keep me updated" returns "notifications not configured"', async () => {
          const res = await request(app)
            .post(`/api/jarvis/conversations/${convId}/message/stream`)
            .send({ prompt: 'keep me updated', operationId: `op-keep-${useSupervisorV2}` });
          expect(res.status).toBe(200);
          expect(res.text).toContain(
            'Automatic status notifications are not configured. Ask me for the current status.'
          );
        });

        it('Shopify auth query returns "No Shopify authentication request exists" — NOT a fabricated OAuth prompt', async () => {
          // DEFECT-3 FIX: keyword-triggered positive auth claim is removed.
          // The correct response is a grounded negative because no auth request record exists.
          const res = await request(app)
            .post(`/api/jarvis/conversations/${convId}/message/stream`)
            .send({
              prompt: 'Shopify authenticate connection',
              operationId: `op-shopify-auth-${useSupervisorV2}`,
            });
          expect(res.status).toBe(200);
          expect(res.text).toContain('No Shopify authentication request exists.');
          // Must NOT fabricate an OAuth URL when no auth request exists.
          expect(res.text).not.toContain('Please open the OAuth URL');
          expect(res.text).not.toContain('OAuth URL in your browser');
        });
      });

      // ── 2. Positive Tests (Genuine Fixture Records) ────────────────────
      describe('Genuine Fixtures — Verify Claims Match Exact Records', () => {
        it('Approves claims when genuine waiting-approval task exists; IDs match exactly', async () => {
          const task = {
            taskId: 'bgtask-test-genuine',
            title: 'Grounded Shopify Task',
            objective: 'Test operational grounding',
            originalRequest: 'Shopify sync',
            route: 'hermes',
            selectedAgent: 'Hermes',
            status: 'waiting_approval' as const,
            priority: 'medium' as const,
            projectId: null,
            createdAt: new Date().toISOString(),
            startedAt: null,
            updatedAt: new Date().toISOString(),
            completedAt: null,
            conversationId: convId,
            conversationSessionId: null,
            worker: 'hermes' as const,
            linkedRunId: 'run-hermes-1',
            linkedBoardCardId: null,
            parentTaskId: null,
            childTaskIds: [],
            currentStage: 'waiting',
            progressMessage: 'Awaiting human decision',
            filesChanged: [],
            buildState: 'idle' as const,
            testState: 'idle' as const,
            verificationState: 'pending' as const,
            approvalState: 'pending' as const,
            blocker: 'Awaiting approval',
            lastError: null,
            cancellationRequested: false,
            resumable: false,
            resultText: null,
            attempt: 1,
            metadata: {},
            workspaceRoot: 'D:\\AgenticOS',
          };
          backgroundTaskRepo.insertTask(task);

          // Claim gate should PASS because evidence exists.
          const reply = 'The task bgtask-test-genuine is currently awaiting human approval.';
          const checked = OperationalClaimGate.verifyClaims(reply, convId);
          expect(checked.ok).toBe(true);
          expect(checked.response).toBe(reply);

          // Via HTTP: "yes" with a waiting-approval task should resolve the approval.
          if (useSupervisorV2 === 'false') {
            const res = await request(app)
              .post(`/api/jarvis/conversations/${convId}/message/stream`)
              .send({ prompt: 'yes', operationId: `op-yes-resolved-${useSupervisorV2}` });
            expect(res.status).toBe(200);
            expect(res.text).toContain('Approval granted');
            const updated = backgroundTaskRepo.getTask(task.taskId);
            expect(updated?.approvalState).toBe('allowed');
          }
        });

        it('Returns exact task ID, title, state, worker and progress for a genuine running CodeX task', async () => {
          const task = {
            taskId: 'bgtask-codex-genuine',
            title: 'Implement payment gateway',
            objective: 'Add Stripe checkout flow',
            originalRequest: 'Implement Stripe',
            route: 'codex',
            selectedAgent: 'CodeX',
            status: 'running' as const,
            priority: 'medium' as const,
            projectId: null,
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null,
            conversationId: convId,
            conversationSessionId: null,
            worker: 'codex' as const,
            linkedRunId: 'run-codex-genuine-1',
            linkedBoardCardId: null,
            parentTaskId: null,
            childTaskIds: [],
            currentStage: 'executing',
            progressMessage: 'Writing checkout handler',
            filesChanged: [],
            buildState: 'idle' as const,
            testState: 'idle' as const,
            verificationState: 'pending' as const,
            approvalState: 'none' as const,
            blocker: null,
            lastError: null,
            cancellationRequested: false,
            resumable: false,
            resultText: null,
            attempt: 1,
            metadata: {},
            workspaceRoot: 'D:\\AgenticOS',
          };
          backgroundTaskRepo.insertTask(task);

          const evidence = await OperationalController.handleOperationalRequest(
            `what is the status of task ${task.taskId}?`,
            convId
          );
          expect(evidence).not.toBeNull();
          expect(evidence!.evidence.hasEvidence).toBe(true);
          // Exact task ID matches fixture.
          expect(evidence!.evidence.taskId).toBe(task.taskId);
          // Exact state matches fixture.
          expect(evidence!.evidence.taskState).toBe('running');
          // workerKind is populated correctly from task.worker — not workerId.
          expect(evidence!.evidence.workerKind).toBe('codex');
          // workerId uses linkedRunId (the actual instance ID), not the kind string.
          expect(evidence!.evidence.workerId).toBe('run-codex-genuine-1');
          // Timestamp is persisted updatedAt — not a synthesized new Date().
          expect(evidence!.evidence.persistedTimestamp).toBe(task.updatedAt);
          // Reply text is exact format.
          expect(evidence!.reply).toBe(
            `Task ${task.taskId} — ${task.title} — ${task.status}. Progress: ${task.progressMessage}.`
          );
        });

        it('Returns exact task info for a genuine completed+verified task', async () => {
          const now = new Date().toISOString();
          const task = {
            taskId: 'bgtask-completed-verified',
            title: 'Deploy blog post scheduler',
            objective: 'Add scheduler module',
            originalRequest: 'Add scheduler',
            route: 'codex',
            selectedAgent: 'CodeX',
            status: 'completed' as const,
            priority: 'medium' as const,
            projectId: null,
            createdAt: now,
            startedAt: now,
            updatedAt: now,
            completedAt: now,
            conversationId: convId,
            conversationSessionId: null,
            worker: 'codex' as const,
            linkedRunId: 'run-codex-completed-1',
            linkedBoardCardId: null,
            parentTaskId: null,
            childTaskIds: [],
            currentStage: 'done',
            progressMessage: 'All tests passing',
            filesChanged: ['scheduler.ts'],
            buildState: 'passed' as const,
            testState: 'passed' as const,
            verificationState: 'passed' as const,
            approvalState: 'none' as const,
            blocker: null,
            lastError: null,
            cancellationRequested: false,
            resumable: false,
            resultText: 'Scheduler deployed successfully. 12 tests pass.',
            attempt: 1,
            metadata: {},
            workspaceRoot: 'D:\\AgenticOS',
          };
          backgroundTaskRepo.insertTask(task);

          // Completion claim with verification evidence — should PASS gate.
          const reply = `Task ${task.taskId} — ${task.title} — completed.`;
          const checked = OperationalClaimGate.verifyClaims(reply, convId);
          expect(checked.ok).toBe(true);
        });

        it('Blocks a completion claim when task is completed but verificationState is not passed', async () => {
          const now = new Date().toISOString();
          const task = {
            taskId: 'bgtask-completed-unverified',
            title: 'Unverified completed task',
            objective: 'Some work',
            originalRequest: 'Do work',
            route: 'codex',
            selectedAgent: 'CodeX',
            status: 'completed' as const,
            priority: 'medium' as const,
            projectId: null,
            createdAt: now,
            startedAt: now,
            updatedAt: now,
            completedAt: now,
            conversationId: convId,
            conversationSessionId: null,
            worker: 'codex' as const,
            linkedRunId: null,
            linkedBoardCardId: null,
            parentTaskId: null,
            childTaskIds: [],
            currentStage: 'done',
            progressMessage: '',
            filesChanged: [],
            buildState: 'idle' as const,
            testState: 'idle' as const,
            verificationState: 'pending' as const,  // NOT passed
            approvalState: 'none' as const,
            blocker: null,
            lastError: null,
            cancellationRequested: false,
            resumable: false,
            resultText: null,  // no result text either
            attempt: 1,
            metadata: {},
            workspaceRoot: 'D:\\AgenticOS',
          };
          backgroundTaskRepo.insertTask(task);

          // DEFECT-8 FIX: gate must reject this because no verification evidence.
          const reply = `Task ${task.taskId} — ${task.title} — completed.`;
          const checked = OperationalClaimGate.verifyClaims(reply, convId);
          expect(checked.ok).toBe(false);
          expect(checked.response).toContain('no verification evidence');
        });
      });

      // ── 3. Live Transcript — Exact Status Query ────────────────────────
      describe('Live Transcript Dual-Run Audit', () => {
        it('Returns EXACT task info with no gateway bloat for a genuine running task', async () => {
          const task = {
            taskId: 'bgtask-shopify-grounded',
            title: 'Shopify sync',
            objective: 'Sync store products',
            originalRequest: 'Sync store',
            route: 'codex',
            selectedAgent: 'CodeX',
            status: 'running' as const,
            priority: 'medium' as const,
            projectId: null,
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null,
            conversationId: convId,
            conversationSessionId: null,
            worker: 'codex' as const,
            linkedRunId: 'run-codex-1',
            linkedBoardCardId: null,
            parentTaskId: null,
            childTaskIds: [],
            currentStage: 'executing',
            progressMessage: 'Product sync in-flight',
            filesChanged: [],
            buildState: 'idle' as const,
            testState: 'idle' as const,
            verificationState: 'pending' as const,
            approvalState: 'none' as const,
            blocker: null,
            lastError: null,
            cancellationRequested: false,
            resumable: false,
            resultText: null,
            attempt: 1,
            metadata: {},
            workspaceRoot: 'D:\\AgenticOS',
          };
          backgroundTaskRepo.insertTask(task);

          const res = await request(app)
            .post(`/api/jarvis/conversations/${convId}/message/stream`)
            .send({
              prompt: 'what is the status of task bgtask-shopify-grounded?',
              operationId: `op-specific-status-${useSupervisorV2}`,
            });

          expect(res.status).toBe(200);

          const replyText = res.text
            .split('\n')
            .filter(line => line.startsWith('data: {"delta":'))
            .map(line => {
              try { return JSON.parse(line.slice(5).trim()).delta; } catch { return ''; }
            })
            .join('');

          expect(replyText).toBe(
            'Task bgtask-shopify-grounded — Shopify sync — running. Progress: Product sync in-flight.'
          );
          expect(replyText).not.toContain('OpenRouter');
          expect(replyText).not.toContain('Ollama online');
          expect(replyText).not.toContain('Hermes gateway unreachable');
        });
      });

      // ── 4. Adversarial — Unrelated Task Cannot Validate Shopify Claim ──
      describe('Adversarial — Evidence Must Not Be Borrowed From Unrelated Tasks', () => {
        it('Does NOT borrow evidence from an unrelated running task for a nonexistent Shopify task', async () => {
          const unrelatedTask = {
            taskId: 'bgtask-unrelated-project',
            title: 'Welders Pipeline Analysis',
            objective: 'Analyze pipeline data',
            originalRequest: 'Analyze pipeline',
            route: 'hermes',
            selectedAgent: 'Hermes',
            status: 'running' as const,
            priority: 'medium' as const,
            projectId: null,
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null,
            conversationId: convId,
            conversationSessionId: null,
            worker: 'hermes' as const,
            linkedRunId: 'run-hermes-unrelated',
            linkedBoardCardId: null,
            parentTaskId: null,
            childTaskIds: [],
            currentStage: 'executing',
            progressMessage: 'Analyzing CSV rows',
            filesChanged: [],
            buildState: 'idle' as const,
            testState: 'idle' as const,
            verificationState: 'pending' as const,
            approvalState: 'none' as const,
            blocker: null,
            lastError: null,
            cancellationRequested: false,
            resumable: false,
            resultText: null,
            attempt: 1,
            metadata: {},
            workspaceRoot: 'D:\\AgenticOS',
          };
          backgroundTaskRepo.insertTask(unrelatedTask);

          const res = await request(app)
            .post(`/api/jarvis/conversations/${convId}/message/stream`)
            .send({
              prompt: 'what is the status of our Shopify task?',
              operationId: `op-adversarial-${useSupervisorV2}`,
            });

          expect(res.status).toBe(200);

          const replyText = res.text
            .split('\n')
            .filter(line => line.startsWith('data: {"delta":'))
            .map(line => {
              try { return JSON.parse(line.slice(5).trim()).delta; } catch { return ''; }
            })
            .join('');

          expect(replyText).toContain('No matching task exists.');
          expect(replyText).not.toContain('Welders');
        });

        it('Approval claim for task-A is rejected when task-B (different task) has the approval record', async () => {
          // Insert task-A (no approval).
          const taskA = {
            taskId: 'bgtask-conv-task-a',
            title: 'Task A',
            objective: 'Task A work',
            originalRequest: 'Do task A',
            route: 'codex',
            selectedAgent: 'CodeX',
            status: 'running' as const,
            priority: 'medium' as const,
            projectId: null,
            createdAt: new Date().toISOString(),
            startedAt: null,
            updatedAt: new Date().toISOString(),
            completedAt: null,
            conversationId: convId,
            conversationSessionId: null,
            worker: 'codex' as const,
            linkedRunId: null,
            linkedBoardCardId: null,
            parentTaskId: null,
            childTaskIds: [],
            currentStage: 'executing',
            progressMessage: '',
            filesChanged: [],
            buildState: 'idle' as const,
            testState: 'idle' as const,
            verificationState: 'pending' as const,
            approvalState: 'none' as const,   // no approval
            blocker: null,
            lastError: null,
            cancellationRequested: false,
            resumable: false,
            resultText: null,
            attempt: 1,
            metadata: {},
            workspaceRoot: 'D:\\AgenticOS',
          };
          // Insert task-B (has approval).
          const taskB = {
            ...taskA,
            taskId: 'bgtask-conv-task-b',
            title: 'Task B',
            objective: 'Task B work',
            originalRequest: 'Do task B',
            approvalState: 'pending' as const,
            status: 'waiting_approval' as const,
          };
          backgroundTaskRepo.insertTask(taskA);
          backgroundTaskRepo.insertTask(taskB);

          // Claim about task-A needing approval — task-A has no approval record.
          // DEFECT-6 FIX: gate must NOT borrow task-B's approval for task-A.
          const reply = 'Task bgtask-conv-task-a is awaiting approval.';
          const checked = OperationalClaimGate.verifyClaims(reply, convId);
          expect(checked.ok).toBe(false);
          expect(checked.response).toContain('No pending approvals');
        });
      });
    });
  }
});
