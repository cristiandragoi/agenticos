/**
 * contextBuilder.ts — Grounded Context Builder for Jarvis V2.
 *
 * Enforces strict information precedence:
 *   1. Runtime Truth (capabilities, background tasks, worker availability)
 *   2. Authoritative Structured State (activeEntity, pendingAction, currentTask, instructionSets, expectedInput)
 *   3. DB / Project Store / Core Memory
 *   4. Recent Conversation History
 *   5. LLM Inference (lowest authority, cannot contradict layers 1-4)
 */

import { listCapabilities } from './capabilities.js';
import type { JarvisV2State } from './state.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { projectsStore } from '../../services/projectsStore.js';
import { listOpportunities } from '../../services/revenueOperator/opportunityService.js';
import { memoryStore } from '../../services/memory/store.js';

export interface GroundedContext {
  systemGrounding: string;
  runtimeTruth: string;
  stateContext: string;
  domainContext: string;
  memoryContext: string;
}

export async function buildGroundedContext(state: JarvisV2State): Promise<GroundedContext> {
  // Layer 1: Runtime Truth
  const capabilities = listCapabilities();
  const capLines = capabilities.map(c =>
    `- ${c.name} (${c.id}): ${c.available ? 'AVAILABLE' : 'UNAVAILABLE'}. Execution owner: ${c.executionOwner}. ${c.description}`
  );

  const taskSummary = backgroundTaskManager.summary();
  const runtimeTruth = [
    `=== RUNTIME CAPABILITIES (CLOSED-WORLD MODEL) ===`,
    ...capLines,
    `IMPORTANT: Direct browser control and direct terminal execution are UNAVAILABLE for Jarvis. They are executed only through worker delegations (Hermes / CodeX). Never claim tools "failed" if they were not invoked.`,
    `BACKGROUND TASKS: Active=${taskSummary.active}, Queued=${taskSummary.queued}, Blocked/Failed=${taskSummary.failedOrBlocked}.`,
  ].join('\n');

  // Layer 2: Authoritative State
  const stateLines = [
    `=== AUTHORITATIVE SESSION STATE ===`,
    `Conversation ID: ${state.conversationId}`,
    `Active Entity: ${state.activeEntity ? `${state.activeEntity.name} (id: ${state.activeEntity.id}, domain: ${state.activeEntity.domain})` : 'None'}`,
    `Active Project: ${state.activeProject ? `${state.activeProject.name} (priority: ${state.activeProject.priority})` : 'None'}`,
    `Active Goal: ${state.activeGoal || 'None'}`,
    `Expected Input: ${state.expectedInput ? JSON.stringify(state.expectedInput) : 'None'}`,
    `Pending Action: ${state.pendingAction ? `${state.pendingAction.type} (${state.pendingAction.status}) - ${state.pendingAction.objective}` : 'None'}`,
    `Current Task: ${state.currentTask ? `${state.currentTask.title} (${state.currentTask.status}, worker: ${state.currentTask.worker}, id: ${state.currentTask.taskId})` : 'None'}`,
    `Constraints: ${state.constraints.length > 0 ? state.constraints.join('; ') : 'None'}`,
  ];

  const storedKeys = Object.keys(state.instructionSets);
  if (storedKeys.length > 0) {
    stateLines.push(`Stored Instruction Sets:`);
    for (const key of storedKeys) {
      const set = state.instructionSets[key];
      stateLines.push(`  - Target: ${set.targetName} (${set.instructions.length} rules stored)`);
      set.instructions.forEach((inst, i) => stateLines.push(`      ${i + 1}. ${inst}`));
    }
  } else {
    stateLines.push(`Stored Instruction Sets: None`);
  }

  const stateContext = stateLines.join('\n');

  // Layer 3: DB / Projects / Opportunities / Core Memory
  let projectsList: any[] = [];
  try {
    projectsList = projectsStore.listProjects();
  } catch {}

  let opportunitiesList: any[] = [];
  try {
    opportunitiesList = await listOpportunities();
  } catch {}

  const domainLines = [
    `=== DATABASE GROUNDING ===`,
    `Authoritative Projects (ordered by priority):`,
    ...projectsList.slice(0, 5).map(p => `  - [Priority ${p.priority}] ${p.name} (id: ${p.id}, status: ${p.status})`),
    `Authoritative Opportunities:`,
    ...opportunitiesList.slice(0, 5).map(o => `  - [Score ${o.score}] ${o.title} (id: ${o.id}, status: ${o.status})`),
  ];
  const domainContext = domainLines.join('\n');

  // Core Memory
  const memLines: string[] = [`=== CORE MEMORY & PRINCIPLES ===`];
  try {
    const coreMemories = memoryStore.list({ scope: 'system:principles', limit: 5 });
    for (const m of coreMemories.items) {
      memLines.push(`- [Principle] ${m.title}: ${m.summary || m.content}`);
    }
    const userProfileMemories = memoryStore.list({ scope: 'user:profile', limit: 2 });
    for (const m of userProfileMemories.items) {
      memLines.push(`- [User Profile] ${m.title}: ${m.summary || m.content}`);
    }
  } catch {}
  const memoryContext = memLines.join('\n');

  const systemGrounding = [
    `You are Jarvis, the conversational supervisor of AgenticOS.`,
    `You must always speak the absolute truth about system capabilities, task execution, and stored memory.`,
    `You never hallucinate tool failures or execute actions without following the action contract.`,
    `Always adhere to the Grounding Hierarchy: Runtime Truth > Authoritative State > DB/Memory > History > Inferences.`,
  ].join('\n');

  return {
    systemGrounding,
    runtimeTruth,
    stateContext,
    domainContext,
    memoryContext
  };
}
