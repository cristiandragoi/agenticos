import type { TaskGraph, TaskNode } from './types.js';
import { AuthoritativeIntentCompiler } from '../AuthoritativeIntentCompiler.js';

/** Only controlled capability words leave the machine, never the original goal. */
export function recoveryResearchRequirement(goal: string): string | undefined {
  if (/\b(camera|image|video|cinematic|advertisement)\b/i.test(goal)) return;
  if (/\b(whatsapp|telegram|chat|messages?)\b/i.test(goal)) {
    return 'Find open-source Windows desktop chat navigation and visible message extraction tools';
  }
  if (/\b(files?|pdf|excel|documents?)\b/i.test(goal)) {
    return 'Find open-source local file search and document text extraction libraries';
  }
  if (/\b(browser|website|webpage|youtube)\b/i.test(goal)) {
    return 'Find open-source browser navigation and webpage content extraction tools';
  }
  if (/\b(desktop|application|apps?|notepad|word|acrobat)\b/i.test(goal)) {
    return 'Find open-source Windows desktop application navigation and visible content extraction tools';
  }
}
export interface RecoveryContext {
  graph: TaskGraph;
  node: TaskNode;
  signal: AbortSignal;
  conversationId: string;
  progress: (message: string) => void;
}
export interface RecoveryCandidate {
  id: string;
  /** Tests must validate the operation contract, not a README or an import alone. */
  test(context: RecoveryContext): Promise<boolean>;
  activate(context: RecoveryContext): Promise<() => Promise<void>>;
}
export interface RecoveryDependencies {
  discover(context: RecoveryContext): Promise<RecoveryCandidate[]>;
  resume(context: RecoveryContext): Promise<boolean>;
}

/** Bounded recovery inside the original graph; no second goal or success receipt. */
export async function recoverGoalStep(context: RecoveryContext, dependencies: RecoveryDependencies) {
  const { signal, progress } = context;
  signal.throwIfAborted();
  const candidates = await dependencies.discover(context);
  signal.throwIfAborted();
  for (const candidate of candidates.slice(0, 2)) {
    progress('I am checking an alternative execution path for your original request.');
    if (!await candidate.test(context)) continue;
    signal.throwIfAborted();
    const rollback = await candidate.activate(context);
    try {
      signal.throwIfAborted();
      progress('The alternative is ready. I am retrying your original request and verifying the result.');
      if (await dependencies.resume(context)) {
        signal.throwIfAborted();
        return true;
      }
    } finally {
      // Activation is goal-local; release it even on cancellation or failed verification.
      await rollback();
    }
  }
  return false;
}

/** Reuse compiled, already integrated adapters before researching new software. */
export function existingAdapterCandidate(context: RecoveryContext): RecoveryCandidate | undefined {
  if (context.node.operation !== 'UNSUPPORTED_GOAL') return;
  const plan = AuthoritativeIntentCompiler.compilePlan(context.graph.userGoal, { conversationId: context.conversationId });
  const supported = new Set(['OPEN_APPLICATION', 'OPEN_CHAT', 'READ_MESSAGES']);
  if (!plan.steps.length || plan.steps.some(s => !supported.has(s.action) || !s.application || !s.target)) return;
  const replacement = plan.steps.map((step, index): TaskNode => ({
    id: `${context.node.id}-recovery-${index}`, capability: step.action === 'OPEN_APPLICATION' ? 'app' : 'chat',
    operation: step.action, inputs: { application: step.application, chat: step.target, count: step.count },
    outputs: {}, dependsOn: index ? [`${context.node.id}-recovery-${index - 1}`] : context.node.dependsOn,
    status: 'PENDING', retryPolicy: { maxRetries: 0, backoffMs: 0 }, verificationPolicy: { required: true },
  }));
  // Only replace an unsupported leaf. Never invalidate verified upstream work.
  if ([...context.graph.nodes.values()].some(n => n.dependsOn.includes(context.node.id))) return;
  return {
    id: 'existing-authoritative-adapters',
    async test() {
      return replacement.every(n => supported.has(n.operation) && n.verificationPolicy?.required === true);
    },
    async activate() {
      const original = context.node;
      context.graph.nodes.delete(original.id);
      replacement.forEach(n => context.graph.nodes.set(n.id, n));
      const presentId = `${original.id}-recovery-present`;
      context.graph.nodes.set(presentId, { id: presentId, capability: 'conversation', operation: 'PRESENT_RESULT',
        inputs: {}, outputs: {}, dependsOn: [replacement.at(-1)!.id], status: 'PENDING' });
      return async () => {
        if (context.graph.status === 'COMPLETED' && !context.signal.aborted) return;
        replacement.forEach(n => context.graph.nodes.delete(n.id));
        context.graph.nodes.delete(presentId);
        context.graph.nodes.set(original.id, original);
      };
    },
  };
}
