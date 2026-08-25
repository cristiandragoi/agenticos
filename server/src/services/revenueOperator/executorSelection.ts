/**
 * executorSelection.ts — Phase 2D canonical executor selection.
 *
 * Capability-aware selection at the WORKER level (hermes / codex / magnitude),
 * so the selected executor maps directly to the real canonical execution path
 * (executeHermesTask / executeCodexTask / executeMagnitudeTask). This is a
 * separate domain from runtimeRegistry's rt-* host registry: rt-codex there is
 * the deliberately restricted inspector (no process_exec), whereas the `codex`
 * worker here is the real engineering goal loop (file edits + commands).
 *
 * Reuses the canonical capability vocabulary from types/capabilities.ts.
 */

import { logger } from '../../utils/logger.js';

export type RevenueWorkerKind = 'hermes' | 'codex' | 'magnitude';

/**
 * Canonical worker capability profiles — what the REAL execution path provides.
 * codex = engineering goal loop (filesystem + process + node/npm/build/test).
 * hermes = research/planning (read-only research + process + web + sqlite).
 * magnitude = browser navigation/inspection (read-only).
 */
export const WORKER_CAPABILITY_PROFILE: Record<RevenueWorkerKind, string[]> = {
  hermes: [
    'filesystem_read', 'filesystem_write', 'process_exec', 'localhost_http',
    'sqlite_read', 'sqlite_write', 'node', 'npm', 'build', 'test',
    'browser', 'external_web',
  ],
  codex: [
    'filesystem_read', 'filesystem_write', 'process_exec',
    'node', 'npm', 'build', 'test',
    'terminal', 'git', 'repository_workspace',
  ],
  magnitude: ['browser', 'localhost_http'],
};

const ALIAS_MAP: Record<string, string> = {
  'filesystem.read': 'filesystem_read',
  'filesystem.write': 'filesystem_write',
  'process.execute': 'process_exec',
  'process.exec': 'process_exec',
  'network.localhost': 'localhost_http',
  'network.external': 'external_web',
  'database.sqlite.read': 'sqlite_read',
  'database.sqlite.write': 'sqlite_write',
  'tool.node': 'node',
  'tool.npm': 'npm',
  'workflow.build': 'build',
  'workflow.test': 'test',
  'browser.inspect': 'browser',
  'browser.interact': 'browser',
  'electron.runtime': 'electron_runtime',
};

export function normalizeCapability(cap: string): string {
  const c = cap.trim().toLowerCase();
  return ALIAS_MAP[c] || c;
}

export function workerSatisfies(worker: RevenueWorkerKind, requiredCapabilities: string[]): { satisfied: boolean; missing: string[] } {
  if (!requiredCapabilities || requiredCapabilities.length === 0) return { satisfied: true, missing: [] };
  const caps = new Set((WORKER_CAPABILITY_PROFILE[worker] || []).map(normalizeCapability));
  const missing: string[] = [];
  for (const req of requiredCapabilities) {
    if (!caps.has(normalizeCapability(req))) missing.push(req);
  }
  return { satisfied: missing.length === 0, missing };
}

/** Map an rt-* runtime host id (or bare worker kind) to a canonical worker kind. */
export function mapExecutorToWorker(executorId?: string | null): RevenueWorkerKind | null {
  if (!executorId) return null;
  const id = executorId.trim().toLowerCase();
  if (id === 'hermes' || id === 'rt-hermes' || id === 'rt-heavy-gen') return 'hermes';
  if (id === 'codex' || id === 'rt-codex') return 'codex';
  if (id === 'magnitude' || id === 'rt-magnitude') return 'magnitude';
  // rt-jarvis (orchestration) and rt-video (media) have no revenue worker mapping.
  return null;
}

export interface ExecutorSelection {
  worker: RevenueWorkerKind;
  rejectedCandidates: Array<{ id: string; reason: string; missingCapabilities: string[] }>;
  autoRedispatched: boolean;
}

const WORKER_ORDER: RevenueWorkerKind[] = ['hermes', 'codex', 'magnitude'];

/**
 * Select a canonical worker for the required capabilities.
 * Mirrors runtimeRegistry.selectByCapabilities semantics: preferred first,
 * record CAPABILITY_MISMATCH, then next compatible worker.
 */
export function selectExecutor(
  requiredCapabilities: string[],
  opts: { preferredExecutorId?: string | null; excludedExecutorIds?: string[] } = {},
): ExecutorSelection {
  const rejected: ExecutorSelection['rejectedCandidates'] = [];
  const excluded = new Set<string>((opts.excludedExecutorIds || []).map((e) => e.toLowerCase()));
  if (opts.preferredExecutorId) excluded.add(opts.preferredExecutorId.toLowerCase());

  const preferredWorker = mapExecutorToWorker(opts.preferredExecutorId);
  const order: RevenueWorkerKind[] = [];
  if (preferredWorker && !excluded.has(preferredWorker)) {
    order.push(preferredWorker);
  }
  for (const w of WORKER_ORDER) {
    if (!order.includes(w) && !excluded.has(w)) order.push(w);
  }

  let autoRedispatched = false;
  for (const worker of order) {
    const check = workerSatisfies(worker, requiredCapabilities);
    if (check.satisfied) {
      if (autoRedispatched) {
        logger.info(`[ExecutorSelection] Auto-redispatch: ${worker} satisfies [${requiredCapabilities.join(', ')}]`);
      }
      return { worker, rejectedCandidates: rejected, autoRedispatched };
    }
    const reason = `CAPABILITY_MISMATCH: missing [${check.missing.join(', ')}]`;
    rejected.push({ id: worker, reason, missingCapabilities: check.missing });
    if (worker === preferredWorker) autoRedispatched = true;
  }

  throw Object.assign(
    new Error(`NO_CAPABLE_EXECUTOR: none of [${order.join(', ')}] satisfy [${requiredCapabilities.join(', ')}]`),
    { code: 'NO_CAPABLE_RUNTIME' },
  );
}
