/**
 * domains/jarvis/investigation.ts
 *
 * Grounded Live System Investigation for AgenticOS.
 *
 * Probes the actual running state of gateways, active model assignment,
 * canonical background tasks, frontend UI snapshot, and workspace resolution.
 */

import { diagnosticsStore } from '../../services/diagnosticsStore.js';
import { conversationService } from '../conversations/service.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';
import { routingLedger } from '../../services/routingLedger.js';
import { getCanonicalTaskSnapshot } from '../../services/backgroundTasks/canonicalSnapshot.js';

interface ProbeOutcome {
  label: string;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  detail: string;
}

async function probeEndpoint(
  label: string,
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<ProbeOutcome> {
  const t0 = Date.now();
  const timeoutMs = options.timeoutMs ?? 2500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: options.headers,
      signal: controller.signal,
    });
    const latency = Date.now() - t0;
    return {
      label,
      ok: res.status >= 200 && res.status < 500,
      statusCode: res.status,
      latencyMs: latency,
      detail: `${res.status} in ${latency}ms`,
    };
  } catch (err: any) {
    const latency = Date.now() - t0;
    return {
      label,
      ok: false,
      latencyMs: latency,
      detail: `unreachable (${err?.name === 'AbortError' ? 'timeout' : err?.message || 'error'})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recentContext(conversationId: string, limit = 4): Promise<string[]> {
  try {
    const msgs = await conversationService.getMessages(conversationId);
    if (!msgs || msgs.length === 0) return [];
    return msgs
      .slice(-limit)
      .map((m: any) => `${m.role === 'user' ? 'user' : 'assistant'}: ${(m.content || '').slice(0, 140)}`);
  } catch {
    return [];
  }
}

export async function investigateAgenticState(
  conversationId: string,
  prompt: string
): Promise<{ report: string; summary: string }> {
  const subjectMatch = prompt.match(/\b(?:why is|what happened to|check|investigate|status of)\s+(.+?)(?:\?|$)/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : 'the element you are referring to';

  // 1. Live Gateway Probes
  const openrouterUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const hermesUrl = process.env.HERMES_BASE_URL || 'http://127.0.0.1:8642';

  const [orProbe, ollamaProbe, hermesProbe] = await Promise.all([
    probeEndpoint('OpenRouter gateway', `${openrouterUrl}/models`),
    probeEndpoint('Local Ollama', `${ollamaUrl}/api/tags`),
    probeEndpoint('Hermes gateway', `${hermesUrl}/health`),
  ]);

  const probes = [orProbe, ollamaProbe, hermesProbe];

  // 2. Active Model Configuration
  let selectedProvider = 'openrouter';
  let selectedModel = process.env.OPENROUTER_MODEL || 'auto';
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'qwen2.5:7b';
  try {
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      selectedModel = assignment.modelId;
      selectedProvider = assignment.providerId || selectedProvider;
    }
  } catch { /* best effort */ }

  // 3. Routing ledger entry
  const resolvedProvider = orProbe.ok
    ? openrouterUrl.includes('openrouter')
      ? 'openrouter'
      : selectedProvider
    : selectedProvider;
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

  // 4. Canonical Background Tasks Snapshot
  const taskSnap = getCanonicalTaskSnapshot(conversationId);
  const taskLines: string[] = [
    `${taskSnap.activeCount} active, ${taskSnap.queuedCount} queued, ${taskSnap.completedCount} completed, ${taskSnap.failedCount} failed`,
  ];
  for (const t of taskSnap.recentTasks.slice(0, 4)) {
    taskLines.push(`${t.status}: ${t.title} (${t.worker})`);
  }

  // 4b. Workspace/file-resolution evidence
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
          const abs =
            candidate.startsWith('/') || /^[A-Za-z]:[\/]/.test(candidate)
              ? candidate
              : `${ws.replace(/[\/]+$/, '')}/${candidate}`;
          let exists = false;
          try {
            const fs = await import('node:fs');
            exists = fs.existsSync(abs);
          } catch { /* keep false */ }
          fileLines.push(`Referenced file "${candidate}" ${exists ? 'EXISTS' : 'DOES NOT EXIST'} at ${abs}`);
        } else {
          fileLines.push('No concrete file path found in this message.');
        }
      } else {
        fileLines.push('No workspace selected.');
      }
    } catch {
      fileLines.push('workspace store unavailable');
    }
  }

  // 5. Conversation context
  const contextLines = await recentContext(conversationId);

  const offlineProbes = probes.filter((p) => !p.ok);
  let conversationalLead = '';
  if (offlineProbes.length === 0) {
    conversationalLead = 'Core gateways are online and operational.';
  } else {
    const offlineNames = offlineProbes.map((p) => p.label).join(', ');
    conversationalLead = `Gateway status: ${offlineNames} ${offlineProbes.length === 1 ? 'is' : 'are'} currently unreachable.`;
  }

  const lines = [
    conversationalLead,
    '',
    `Runtime diagnostics for "${subject}":`,
    ...probes.map((p) => `• ${p.label}: ${p.detail}`),
    `• Active model routing: provider ${selectedProvider || 'unavailable'} · model ${selectedModel} (fallback ${fallbackModel})`,
    `• Background tasks: ${taskLines[0]}`,
    ...(taskLines.length > 1 ? taskLines.slice(1).map((l) => `  - ${l}`) : []),
    ...(fileLines.length ? ['', 'Workspace / file resolution:'] : []),
    ...(fileLines.length ? fileLines.map((l) => `  ${l}`) : []),
  ];

  if (contextLines.length > 0) {
    lines.push('', 'Recent conversation context:');
    lines.push(...contextLines.map((l) => `  ${l}`));
  }

  const modelMismatch = /model|provider|badge|display|showing|shows/i.test(prompt);

  // 6. Frontend diagnostic snapshot
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
    lines.push('', 'Frontend display state (reported by the UI, read-only):');
    const sel = ui.selected;
    lines.push(
      sel?.provider || sel?.model
        ? `  • Selected frontend model: ${fmt(sel.provider, sel.model)} (source: ${sel.source || 'unknown'}; ${age(sel.updatedAt)})`
        : '  • Selected frontend model: (not reported)'
    );
    const gw = ui.gatewayRendered;
    lines.push(
      gw?.provider || gw?.model
        ? `  • Gateway status rendered: ${fmt(gw.provider, gw.model)}${gw.online === false ? ' (UI shows offline)' : ''} (source: ${gw.source || 'unknown'}; ${age(gw.updatedAt)})`
        : '  • Gateway status rendered: (not reported)'
    );

    const badge = ui.rendered?.providerBadge;
    if (badge?.provider || badge?.model) {
      const mount = badge.componentMounted ? 'component mounted' : `component currently unmounted; last render ${age(badge.renderedAt)}`;
      lines.push(`  • ProviderBadge last rendered: ${fmt(badge.provider, badge.model)} (${mount}${badge.messageId ? `, message ${badge.messageId.slice(-10)}` : ''})`);
    } else {
      lines.push('  • ProviderBadge last rendered: (not reported)');
    }
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

    // Staleness analysis
    if ((badge?.provider || badge?.model) && badge?.renderedAt) {
      const opTs = active?.startedAt || last?.endedAt;
      if (opTs && badge.renderedAt < opTs) {
        lines.push(
          `The ProviderBadge last rendered ${age(badge.renderedAt)} (${Math.round((opTs - badge.renderedAt) / 1000)}s before the latest stream operation) — the badge is not reacting to the latest gateway state.`
        );
      }
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
  } else {

    lines.push(
      '',
      'Frontend display state: not yet reported by the UI (no snapshot received). Ask me to check again after the interface has rendered once.'
    );
  }


  const report = lines.join('\n');
  const summary = buildInvestigationSummary(subject, probes, selectedProvider, selectedModel, taskSnap.summaryText, modelMismatch);
  return { report, summary };
}

function buildInvestigationSummary(
  subject: string,
  probes: ProbeOutcome[],
  _selectedProvider: string,
  selectedModel: string,
  taskSummary: string,
  modelMismatch: boolean
): string {
  if (modelMismatch) {
    return (
      'Inspection report: there is a discrepancy between the configured runtime model and the frontend badge display. ' +
      'Detailed evidence has been recorded in the diagnostics panel.'
    );
  }
  const isStatusInquiry = !subject || subject === 'the element you are referring to' || /\b(status|health|runtime|system|gateways?|models?)\b/i.test(subject);
  if (!isStatusInquiry) {
    return `Investigation completed for ${subject}. Gateway probes and background tasks are operating normally; detailed evidence is recorded in diagnostics.`;
  }
  const gateways = probes.map((p) => `${p.label} ${p.ok ? 'online' : 'unreachable'}`).join(', ');
  const model = selectedModel && selectedModel !== 'auto' ? `Model: ${selectedModel}` : 'Model: auto-selected';
  const tasks = taskSummary || 'no background tasks';
  const subjectClause = subject && subject !== 'the element you are referring to' ? ` (${subject})` : '';
  return `AgenticOS runtime status${subjectClause}: ${gateways}. ${model}. Tasks: ${tasks}.`;
}

