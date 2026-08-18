/**
 * conversationContext.test.ts — §12/§3: the ONE conversation context object.
 *
 * Verifies the context assembler produces a bounded, truthful, complete
 * per-turn context: recent turns, previous-clarification state, workspace,
 * active + historical task, provider truth, capability truth, approval mode —
 * and that the current message always has highest priority.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMessages: any[] = [];
let mockWorkspaceRoot: string | null = null;
let mockCurrentExecution: any = null;
const mockTasks: any[] = [];
const mockSummary = { active: 0, queued: 0, waitingApproval: 0, failedOrBlocked: 0 };

vi.mock('../domains/conversations/service.js', () => ({
  conversationService: {
    getMessages: vi.fn(async () => mockMessages),
  },
}));
vi.mock('../services/workspaceStore.js', () => ({
  getWorkspaceRoot: vi.fn(async () => mockWorkspaceRoot),
}));
vi.mock('../services/executionState.js', () => ({
  getCurrent: vi.fn(() => mockCurrentExecution),
}));
vi.mock('../services/backgroundTasks/manager.js', () => ({
  backgroundTaskManager: {
    summary: vi.fn(() => mockSummary),
    listTasks: vi.fn(() => mockTasks),
  },
}));
vi.mock('../services/agent/assignments.js', () => ({
  AgentProviderAssignmentService: {
    getAssignment: vi.fn(async () => ({ enabled: true, providerId: 'openrouter', modelId: 'gpt-4o' })),
  },
}));
vi.mock('../domains/jarvis/capabilityRegistry.js', () => ({
  CAPABILITY_REGISTRY: [{ id: 'codex', displayName: 'CodeX', responsibilities: 'engineering delegation' }],
  capabilitySummaryList: vi.fn(() => 'CodeX: engineering delegation'),
}));

import { assembleConversationContext, contextToSystemPrompt } from '../domains/jarvis/conversationContext';

describe('conversationContext (ONE context object per turn)', () => {
  beforeEach(() => {
    mockMessages.length = 0;
    mockWorkspaceRoot = null;
    mockCurrentExecution = null;
    mockTasks.length = 0;
  });

  it('bounded recent turns + excludes current prompt + system rows', async () => {
    mockMessages.push(
      { role: 'system', messageType: 'routing_event', content: 'Intent routed to DIRECT' },
      { role: 'user', content: 'first turn' },
      { role: 'agent', content: 'Jarvis reply one' },
      { role: 'user', content: 'second turn' },
      { role: 'user', content: 'CURRENT PROMPT' }, // current
    );
    const ctx = await assembleConversationContext('conv-1', 'CURRENT PROMPT');
    expect(ctx.recentTurns.length).toBe(3); // first, reply, second
    expect(ctx.recentTurns.every((t) => t.content !== 'CURRENT PROMPT')).toBe(true);
    expect(ctx.recentTurns.some((t) => t.content.includes('Intent routed'))).toBe(false);
    expect(ctx.previousUserMessage).toBe('second turn');
    expect(ctx.previousAssistantMessage).toBe('Jarvis reply one');
  });

  it('detects a previous clarification turn (previousWasClarification)', async () => {
    mockMessages.push(
      { role: 'user', content: 'vague thing' },
      { role: 'agent', content: 'I didn\'t quite understand your request. Could you rephrase it?' },
    );
    const ctx = await assembleConversationContext('conv-2', 'now with detail');
    expect(ctx.previousWasClarification).toBe(true);
  });

  it('does NOT flag a normal reply as clarification', async () => {
    mockMessages.push(
      { role: 'user', content: 'hello' },
      { role: 'agent', content: 'Hello! How can I help?' },
    );
    const ctx = await assembleConversationContext('conv-3', 'hello again');
    expect(ctx.previousWasClarification).toBe(false);
  });

  it('includes provider truth from the assignment', async () => {
    const ctx = await assembleConversationContext('conv-4', 'x');
    expect(ctx.providers.model).toBe('gpt-4o');
    expect(ctx.providers.provider).toBe('openrouter');
    expect(ctx.providers.fallbackProvider).toBe('ollama');
  });

  it('includes capability truth', async () => {
    const ctx = await assembleConversationContext('conv-5', 'x');
    expect(ctx.capabilities).toContain('CodeX');
  });

  it('approval mode is carried through', async () => {
    const ctx = await assembleConversationContext('conv-6', 'x', { approvalMode: 'auto' });
    expect(ctx.approvalMode).toBe('auto');
  });

  it('contextToSystemPrompt mentions workspace, task, provider, approval when present', async () => {
    mockMessages.push({ role: 'user', content: 'hi' });
    mockWorkspaceRoot = 'B:/Repo';
    mockTasks.push(
      { taskId: 'task-abc', worker: 'hermes', status: 'running', title: 'Fix the overlap' },
      { taskId: 'task-old', worker: 'codex', status: 'completed', title: 'Old analysis' },
    );
    mockCurrentExecution = { operationId: 'op-live', worker: 'jarvis', status: 'RUNNING', currentAction: 'Streaming reply' };
    const ctx = await assembleConversationContext('conv-7', 'hi', { approvalMode: 'manual' });
    const prompt = contextToSystemPrompt(ctx);
    expect(prompt).toContain('B:/Repo');
    expect(prompt).toContain('Active task');
    // The background-task active record takes precedence over the execution
    // state fallback (correct precedence — a real task is more specific).
    expect(prompt).toContain('task-abc');
    expect(prompt).toContain('hermes running');
    expect(prompt).toContain('gpt-4o');
    expect(prompt).toContain('manual');
  });

  it('current message is never injected into recent turns (highest priority)', async () => {
    mockMessages.push({ role: 'user', content: 'the actual current message' });
    const ctx = await assembleConversationContext('conv-8', 'the actual current message');
    expect(ctx.recentTurns.length).toBe(0);
  });
});
