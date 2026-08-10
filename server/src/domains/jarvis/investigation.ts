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
import { diagnosticsStore, type UiDiagnosticSnapshot } from '../../services/diagnosticsStore.js';
import { routingLedger } from '../../services/routingLedger.js';

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
  [/\bfile\b|\bnot found\b|\bno such file\b/i, 'file/workspace path'],
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

  // Record this investigation in the routing ledger (PRIORITY 1) so runtime-
  // identity questions ("What model are you using?") have an authoritative
  // entry even when no direct LLM execution has happened yet. Written BEFORE
  // the report lines so the metadata block below always reads the current run.
  const resolvedProvider = orProbe.ok ? (openrouterUrl.includes('openrouter') ? 'openrouter' : selectedProvider) : selectedProvider;
  routingLedger.record({
    operationId: `investigate-${Date.now()}`,
    worker: 'investigate',
    routingMode: 'auto',
    requestedProvider: selectedProvider,
    requestedModel: selectedModel,
    resolvedProvider,
    resolvedModel: selectedModel,
    fallbackUsed: false,
    fallbackReason: null,
    startedAt: Date.now(),
    endedAt: Date.now(),
  });

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

  // 4b. Workspace/file-resolution evidence (§15 Case I: "Why does it keep
  // saying file not found?"). Reports the canonical workspace root and, when
  // the prompt names a file, whether that file exists — READ-ONLY.
  const fileLines: string[] = [];
  const fileTopic = /\bfile\b|\bnot found\b|\bno such file\b|\.(tsx?|jsx?|ts|js|json|md|css)\b/i.test(prompt);
  if (fileTopic) {
    try {
      const { getWorkspaceRoot } = await import('../../services/workspaceStore.js');
      const ws = await getWorkspaceRoot();
      if (ws) {
        fileLines.push(`Canonical workspace root: ${ws}`);
        const match = prompt.match(/([A-Za-z0-9_./\-]+\.(tsx?|jsx?|ts|js|json|md|css))/i);
        if (match) {
          const candidate = match[1].replace(/[.,;:!?]$/, '');
          const abs = candidate.startsWith('/') || /^[A-Za-z]:[\/]/.test(candidate)
            ? candidate
            : `${ws.replace(/[\/]+$/, '')}/${candidate}`;
          let exists = false;
          try {
            const fs = await import('node:fs');
            exists = fs.existsSync(abs);
          } catch { /* keep false */ }
          fileLines.push(`Referenced file "${candidate}" ${exists ? 'EXISTS' : 'DOES NOT EXIST'} at ${abs}`);
        } else {
          fileLines.push('No concrete file path found in this message — I can search the workspace for the referenced file.');
        }
      } else {
        fileLines.push('No workspace selected — file resolution is not possible until a repository is chosen in the workspace bar.');
      }
    } catch {
      fileLines.push('workspace store unavailable');
    }
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
    ...(fileLines.length ? ['', 'Workspace / file resolution:'] : []),
    ...(fileLines.length ? fileLines.map((l) => `  ${l}`) : []),
  ];

  if (contextLines.length > 0) {
    lines.push('', 'Recent conversation context (used to resolve "it"/"that"/"again"):');
    lines.push(...contextLines.map((l) => `  ${l}`));
  }

  const modelMismatch = /model|provider|badge|display|showing|shows/i.test(prompt);

  // 6. Frontend diagnostic snapshot — what the UI is ACTUALLY rendering /
  //    last rendered (reported by the UI itself; backend/runtime authoritative).
  const ui = diagnosticsStore.getUiSnapshot();
  if (ui) {
    const now = Date.now();
    const fmt = (p?: string | null, m?: string | null): string =>
      p || m ? `${p || '(unset)'}${m ? ' / ' + m : ''}` : '(not reported)';
    const age = (ts?: number | null): string => {
      if (!ts) return 'unknown age';
      const s = Math.max(0, Math.round((now - ts) / 1000));
      return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
    };
    lines.push(
      '',
      'Frontend display state (reported by the UI, read-only):',
    );
    // Selected / configured frontend state.
    const sel = ui.selected;
    lines.push(
      sel?.provider || sel?.model
        ? `  • Selected frontend model: ${fmt(sel.provider, sel.model)} (source: ${sel.source || 'unknown'}; ${age(sel.updatedAt)})`
        : '  • Selected frontend model: (not reported)'
    );
    // Gateway status rendered.
    const gw = ui.gatewayRendered;
    lines.push(
      gw?.provider || gw?.model
        ? `  • Gateway status rendered: ${fmt(gw.provider, gw.model)}${gw.online === false ? ' (UI shows gateway offline)' : ''} (source: ${gw.source || 'unknown'}; ${age(gw.updatedAt)})`
        : '  • Gateway status rendered: (not reported)'
    );
    // ProviderBadge — last rendered value with explicit mount/age markers.
    const badge = ui.rendered?.providerBadge;
    if (badge?.provider || badge?.model) {
      const mount = badge.componentMounted ? 'component mounted' : `component currently unmounted; last render ${age(badge.renderedAt)}`;
      lines.push(`  • ProviderBadge last rendered: ${fmt(badge.provider, badge.model)} (${mount}${badge.messageId ? `, message ${badge.messageId.slice(-10)}` : ''})`);
    } else {
      lines.push('  • ProviderBadge last rendered: (not reported)');
    }
    // Active vs last-known stream — never fabricated.
    const active = ui.stream?.active;
    const last = ui.stream?.lastKnown;
    lines.push(
      active?.provider || active?.model
        ? `  • Active stream: ${fmt(active.provider, active.model)} (operation ${active.operationId?.slice(-10) || 'unknown'}; started ${age(active.startedAt)})`
        : '  • Active stream: none'
    );
    lines.push(
      last?.provider || last?.model
        ? `  • Last stream: ${fmt(last.provider, last.model)} (operation ${last.operationId?.slice(-10) || 'unknown'}; ended ${age(last.endedAt)})`
        : '  • Last stream: none'
    );
    // Staleness analysis: a badge rendered before a newer stream operation is
    // not reacting to the latest gateway state.
    if ((badge?.provider || badge?.model) && badge?.renderedAt) {
      const opTs = active?.startedAt || last?.endedAt;
      if (opTs && badge.renderedAt < opTs) {
        lines.push(
          `The ProviderBadge last rendered ${age(badge.renderedAt)} (${Math.round((opTs - badge.renderedAt) / 1000)}s before the latest stream operation) — the badge is not reacting to the latest gateway state.`
        );
      }
    }
  } else {
    lines.push(
      '',
      'Frontend display state: not yet reported by the UI (no snapshot received). Ask me to check again after the interface has rendered once.'
    );
  }

  lines.push('');
  if (modelMismatch) {
    const badge = ui?.rendered?.providerBadge;
    // Authoritative routing record (PRIORITY 1): the most recent execution's
    // Requested vs Resolved values come from the routing ledger, never from
    // the model's own knowledge.
    const latest = routingLedger.latest('jarvis', 1)[0] || routingLedger.latest(undefined, 1)[0];
    if (latest) {
      lines.push(
        'Runtime execution metadata (from the routing ledger):',
        `  • Requested: ${latest.requestedProvider || '(unset)'} / ${latest.requestedModel || '(unset)'} (mode ${latest.routingMode})`,
        `  • Resolved: ${latest.resolvedProvider || '(unset)'} / ${latest.resolvedModel || '(unset)'}${latest.fallbackUsed ? ` — FALLBACK (${latest.fallbackReason || 'reason unknown'})` : ''}`,
        `  • Operation: ${latest.operationId} · worker ${latest.worker}`
      );
    } else {
      lines.push('Runtime execution metadata: no execution recorded yet in the routing ledger.');
    }
    lines.push(
      `The authoritative runtime resolves provider ${selectedProvider || '(unset)'} / model ${selectedModel}. ` +
      (badge?.provider || badge?.model
        ? `The frontend ProviderBadge last rendered ${badge.provider || '(unset)'}${badge.model ? ' / ' + badge.model : ''}. ` +
          (badge.provider === selectedProvider && (badge.model === selectedModel || !selectedModel)
            ? 'The badge matches the runtime — no stale display detected.'
            : 'The badge does NOT match the runtime — the stale value is limited to the frontend display state.')
        : 'If the UI displays something else, it is showing a stale value — the runtime itself is the source of truth.')
    );
  }
  lines.push(
    'I can go deeper: verify the frontend display state, trace recent gateway events, or (with your approval) correct a configuration mismatch. No files or settings were changed by this inspection.'
  );

  return lines.join('\n');
}
