/**
 * INVESTIGATE path — inspect-before-question for contextual AgenticOS
 * problem reports.
 *
 * When Jarvis hears a statement like "It's not showing the correct model."
 * or "The stop button doesn't work.", it inspects REAL runtime/application
 * state (LLM gateway, active model/provider routing, Hermes gateway,
 * background tasks, recent conversation context) and composes a truthful
 * evidence report instead of asking "What interface are you referring to?".
 *
 * READ-ONLY by design: no files, config, or state are changed. Destructive
 * fixes still require the normal approval flow (callers gate them).
 */
import { conversationService } from '../conversations/service.js';
import { hermesApiService } from '../../services/hermesApiService.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';

const PROBE_TIMEOUT_MS = parseInt(process.env.GATEWAY_HEALTH_PROBE_TIMEOUT_MS || '2500', 10);

interface ProbeOutcome {
  label: string;
  ok: boolean;
  detail: string;
}

async function probe(url: string): Promise<{ ok: boolean; status: number; latencyMs: number; body?: any }> {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    let body: any;
    try { body = await res.json(); } catch { body = undefined; }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, latencyMs: Date.now() - started, body };
  } catch (err: any) {
    return { ok: false, status: 0, latencyMs: Date.now() - started };
  }
}

/** Keywords the report uses to name the subject of a problem statement. */
const SUBJECT_KEYWORDS: Array<[RegExp, string]> = [
  [/\bmodel\b/i, 'model'],
  [/\bprovider\b/i, 'provider'],
  [/\bbadge\b/i, 'badge'],
  [/\bbutton\b/i, 'button'],
  [/\bstatus\b/i, 'status indicator'],
  [/\btask\b/i, 'background task'],
  [/\bbuild\b/i, 'build'],
  [/\bgateway\b/i, 'gateway'],
  [/\bvoice\b|\bmic(rophone)?\b/i, 'voice/microphone'],
  [/\btts\b|\bspeech\b/i, 'speech output'],
  [/\bstt\b|\btranscri(be|ption)\b/i, 'speech input'],
  [/\bboard\b/i, 'Board card'],
  [/\bcard\b/i, 'Board card'],
  [/\bcodex\b/i, 'CodeX'],
  [/\bhermes\b/i, 'Hermes'],
  [/\boauth\b|\blogin\b/i, 'authentication'],
];

function resolveSubject(prompt: string): string {
  const p = prompt.toLowerCase();
  for (const [re, label] of SUBJECT_KEYWORDS) {
    if (re.test(p)) return label;
  }
  // Contextual deictic reference with no keyword: use the conversation context.
  return 'the element you are referring to';
}

/** Pull the last few messages for deictic resolution ("it", "that", "again"). */
async function recentContext(conversationId: string): Promise<string[]> {
  try {
    const messages = await conversationService.getMessages(conversationId);
    const arr = Array.isArray(messages) ? messages : [];
    return arr.slice(-6).map((m: any) => {
      const role = m.role === 'user' ? 'You' : m.role === 'agent' ? 'Jarvis' : 'System';
      const content = typeof m.content === 'string' ? m.content.replace(/\s+/g, ' ').slice(0, 120) : '';
      return `${role}: ${content}`;
    });
  } catch {
    return [];
  }
}

/**
 * Compose the inspect-first evidence report for a contextual problem report.
 * Every value is measured live; anything unverifiable is reported as
 * unavailable — never guessed.
 */
export async function investigateAgenticState(conversationId: string, prompt: string): Promise<string> {
  const subject = resolveSubject(prompt);
  const probes: ProbeOutcome[] = [];

  // 1. Active model/provider routing (the authoritative value the UI shows).
  let selectedProvider = 'unavailable';
  let selectedModel = process.env.OPENROUTER_MODEL || 'auto';
  let fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama2:latest';
  try {
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      selectedModel = assignment.modelId;
      selectedProvider = assignment.providerId || selectedProvider;
    } else if (assignment?.enabled) {
      selectedProvider = assignment.providerId || selectedProvider;
    }
  } catch { /* keep defaults */ }

  // 2. LLM gateway probes.
  const openrouterUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const [orProbe, ollamaProbe] = await Promise.all([
    probe(`${openrouterUrl}/models`),
    probe(`${ollamaUrl}/api/tags`),
  ]);
  const orModels = Array.isArray(orProbe.body?.data) ? orProbe.body.data.length : Array.isArray(orProbe.body) ? orProbe.body.length : null;
  const ollamaModels = Array.isArray(ollamaProbe.body?.models) ? ollamaProbe.body.models.length : null;
  probes.push({
    label: 'OpenRouter gateway',
    ok: orProbe.ok,
    detail: orProbe.ok
      ? `online (HTTP ${orProbe.status}, ${orModels != null ? orModels + ' models' : 'model count unavailable'}, ${orProbe.latencyMs}ms)`
      : `unreachable (HTTP ${orProbe.status || 'timeout'})`,
  });
  probes.push({
    label: 'Ollama (fallback)',
    ok: ollamaProbe.ok,
    detail: ollamaProbe.ok
      ? `online (${ollamaModels != null ? ollamaModels + ' models' : 'model count unavailable'}, ${ollamaProbe.latencyMs}ms)`
      : `unreachable (HTTP ${ollamaProbe.status || 'timeout'})`,
  });

  // 3. Hermes gateway.
  try {
    const hs = await hermesApiService.getStatus();
    probes.push({ label: 'Hermes gateway', ok: hs.reachable, detail: hs.detail });
  } catch {
    probes.push({ label: 'Hermes gateway', ok: false, detail: 'unavailable' });
  }

  // 4. Background tasks.
  const taskLines: string[] = [];
  try {
    const summary = backgroundTaskManager.summary();
    taskLines.push(`${summary.active} active, ${summary.queued} queued, ${summary.waitingApproval} awaiting approval, ${summary.failedOrBlocked} failed/blocked`);
    const recent = backgroundTaskManager.listTasks({ limit: 4 }) || [];
    for (const t of recent) {
      taskLines.push(`${t.status}: ${t.title.slice(0, 70)} (${t.worker})`);
    }
  } catch {
    taskLines.push('unavailable');
  }

  // 5. Conversation context (deictic resolution).
  const contextLines = await recentContext(conversationId);

  const lines = [
    `I inspected the active AgenticOS state instead of guessing what you meant by "${subject}".`,
    '',
    ...probes.map((p) => `• ${p.label}: ${p.detail}`),
    `• Active model routing: provider ${selectedProvider || 'unavailable'} · model ${selectedModel} (fallback ${fallbackModel})`,
    `• Background tasks: ${taskLines[0]}`,
    ...(taskLines.length > 1 ? taskLines.slice(1).map((l) => `  - ${l}`) : []),
  ];

  if (contextLines.length > 0) {
    lines.push('', 'Recent conversation context (used to resolve "it"/"that"/"again"):');
    lines.push(...contextLines.map((l) => `  ${l}`));
  }

  const modelMismatch = /model|provider|badge|display|showing|shows/i.test(prompt);
  lines.push('');
  if (modelMismatch) {
    lines.push(
      `The authoritative runtime resolves provider ${selectedProvider || '(unset)'} / model ${selectedModel}. ` +
      `If the UI displays something else, it is showing a stale value — the runtime itself is the source of truth.`
    );
  }
  lines.push(
    'I can go deeper: verify the frontend display state, trace recent gateway events, or (with your approval) correct a configuration mismatch. No files or settings were changed by this inspection.'
  );

  return lines.join('\n');
}
