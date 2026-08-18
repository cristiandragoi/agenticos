import { logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';
import type { LoopDefinition, LoopRun, LoopStep, AgentInvocation } from '../types.js';
import { runtimeRegistry } from './runtimeRegistry.js';
import { runStore } from './runStore.js';
import { db } from './db.js';

/* ══════════════════════════════════════════════════════
   Loop Engine — executes multi-step, multi-agent plans
   Steps are ordered via topological sort on dependsOn[].
   Parallel steps fire concurrently (Promise.all with a
   default concurrency of 4 — safe default per plan).
   ══════════════════════════════════════════════════════ */

const CONCURRENCY_LIMIT = 4;

function topoSort(steps: LoopStep[]): LoopStep[][] {
  const remaining = new Set(steps.map(s => s.id));
  const completed = new Set<string>();
  const waves: LoopStep[][] = [];

  while (remaining.size > 0) {
    const wave = steps.filter(s =>
      remaining.has(s.id) &&
      (s.dependsOn ?? []).every(dep => completed.has(dep))
    );
    if (wave.length === 0) throw new Error('Circular dependency detected in loop steps');
    for (const s of wave) {
      remaining.delete(s.id);
      completed.add(s.id);
    }
    waves.push(wave);
  }
  return waves;
}

async function executeStep(
  step: LoopStep,
  loopRunId: string,
  priorOutputs: Record<string, string>
): Promise<string> {
  const agent = db.agents.get(step.agentId);
  const runtimeId = agent?.runtimeId ?? 'rt-hermes';
  const adapter = runtimeRegistry.getAdapter(runtimeId);

  if (!adapter) {
    logger.warn(`[LoopEngine] No adapter for runtime ${runtimeId}, using simulation`);
    const runId = `run-${randomUUID().slice(0, 9)}`;
    const now = new Date().toISOString();
    runStore.create({
      id: runId,
      agentId: step.agentId,
      sessionId: loopRunId,
      workspaceId: 'default',
      mode: step.mode,
      status: 'completed',
      input: step.prompt,
      output: `[Simulated] Step "${step.id}" completed.`,
      logs: [],
      events: [],
      linkedArtifacts: [],
      createdAt: now,
      updatedAt: now,
    });
    return runId;
  }

  // Enrich prompt with prior step outputs
  const context = Object.entries(priorOutputs)
    .map(([key, val]) => `[Context: ${key}] ${val}`)
    .join('\n');
  const enrichedPrompt = context ? `${context}\n\n${step.prompt}` : step.prompt;

  const invocation: AgentInvocation = {
    runId: `run-${randomUUID().slice(0, 9)}`,
    agentId: step.agentId,
    sessionId: loopRunId,
    workspaceId: 'default',
    mode: step.mode,
    prompt: enrichedPrompt,
  };

  const ack = await adapter.invoke(invocation);
  return ack.runId;
}

export async function executeLoop(def: LoopDefinition): Promise<LoopRun> {
  const loopRunId = `lrun-${randomUUID().slice(0, 9)}`;
  const loopRun: LoopRun = {
    id: loopRunId,
    loopId: def.id,
    stepResults: {},
    stepStatuses: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    iteration: 1,
    score: 0,
  };

  loopRuns.upsert(loopRun);
  loopDefinitions.upsert({ ...def, status: 'running' });

  logger.info(`[LoopEngine] Starting loop "${def.name}" (${def.id}) with ${def.steps.length} steps`);

  try {
    const waves = topoSort(def.steps);
    const priorOutputs: Record<string, string> = {};

    for (const wave of waves) {
      // Chunk into concurrency-limited batches
      for (let i = 0; i < wave.length; i += CONCURRENCY_LIMIT) {
        const batch = wave.slice(i, i + CONCURRENCY_LIMIT);
        const runIds = await Promise.all(
          batch.map(step => executeStep(step, loopRunId, priorOutputs))
        );
        for (let j = 0; j < batch.length; j++) {
          const step = batch[j];
          const runId = runIds[j];
          loopRun.stepResults[step.id] = runId;
          if (step.outputKey) {
            // Wait briefly for run to complete and capture output
            await new Promise(r => setTimeout(r, 200));
            const run = runStore.get(runId);
            if (run?.output) priorOutputs[step.outputKey] = run.output;
          }
        }
      }
    }

    // Simulate iterative feedback cycle if configured
    if (def.maxIterations && def.maxIterations > 1) {
      logger.info(`[LoopEngine] Running feedback cycle for loop "${def.name}"...`);
      for (let i = 2; i <= def.maxIterations; i++) {
        loopRun.iteration = i;
        loopRun.score = Math.floor(Math.random() * 50) + 50; // Simulate improving score
        loopRuns.upsert(loopRun);
        await new Promise(r => setTimeout(r, 800)); // Simulate work
        if (def.stopCondition && loopRun.score > 90) {
          loopRun.stopReason = def.stopCondition;
          break;
        }
      }
      if (!loopRun.stopReason) {
         loopRun.stopReason = 'Max iterations reached';
      }
    }

    loopRun.status = 'completed';
    loopRun.completedAt = new Date().toISOString();
    loopDefinitions.upsert({ ...def, status: 'completed' });
    logger.info(`[LoopEngine] Loop "${def.name}" completed successfully`);
  } catch (err: any) {
    loopRun.status = 'failed';
    loopRun.errorMessage = err.message;
    loopDefinitions.upsert({ ...def, status: 'failed' });
    logger.error(`[LoopEngine] Loop "${def.name}" failed:`, err.message);
  }

  loopRuns.upsert(loopRun);
  return loopRun;
}

import path from 'path';
import { fileURLToPath } from 'url';
import { JsonStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');

/* ─── Persistent stores for loops ─── */
export const loopDefinitions = new JsonStore<LoopDefinition>(path.join(dataDir, 'loopDefinitions.json'));
export const loopRuns = new JsonStore<LoopRun>(path.join(dataDir, 'loopRuns.json'));
