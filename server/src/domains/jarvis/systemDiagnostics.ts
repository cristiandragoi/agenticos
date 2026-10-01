/**
 * systemDiagnostics.ts — REAL system self-diagnosis for Jarvis.
 *
 * A complete, explicit system command ("run a status check", "see where you can
 * heal yourself", "diagnose yourself") must execute an ACTUAL runtime inspection
 * of AgenticOS — never resolve against a stale active project.
 *
 * Design rules (contract):
 *  1. Every check reads live runtime state (process, HTTP probes, DB, filesystem,
 *     in-process monitors). Nothing is inferred and nothing is invented.
 *  2. A source that cannot be read is reported as `unknown` with the probe error.
 *     Missing telemetry is NOT evidence of health.
 *  3. This route NEVER returns project statistics. A project question is a
 *     different intent; the diagnostic answers about the RUNTIME only.
 *  4. When a genuine, repairable defect is found the EXISTING Self-Heal
 *     architecture is used (Supervisor → FailureDetector → incident → repair).
 *     It never merely tells the user something is broken.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { getBuildIdentity } from '../../services/buildIdentity.js';
import { healthSnapshot } from '../jarvisNext/jarvisHealth.js';
import { voiceHealthMonitor } from '../jarvisNext/voiceHealthMonitor.js';
import { desktopExecutor } from './execution/executors/desktopExecutor.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { rawDb } from '../../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Intent detection ────────────────────────────────────────────────────────

export type SystemCommandKind = 'status_check' | 'self_inspect' | 'self_heal' | 'capability_check';

export interface ExplicitSystemCommand {
  intent: 'system_self_diagnose';
  kind: SystemCommandKind;
  /** The phrase that triggered the match (diagnostic evidence, never spoken raw). */
  matched: string;
  confidence: number;
}

/**
 * Nouns that denote the assistant's OWN runtime rather than a project entity.
 * Deliberately excludes bare `status`, `state` and `voice`: those only identify
 * the runtime when claimed possessively ("your voice"), because "check its
 * status" refers to the conversation entity, not to the runtime.
 */
const SYSTEM_NOUN =
  /\b(?:runtime|system|self|capabilit(?:y|ies)|supervisor|self-?heal|gateway|backend|incidents?|failures?|stt|health|internals?|diagnostics?)\b/i;

/** The assistant named possessively as the owner of a subsystem. */
const SELF_POSSESSIVE = /\b(?:you|your|yourself|your\s+own|my|jarvis)\b/i;

const DIAGNOSTIC_VERB =
  /\b(?:status\s*check|check\s+(?:yourself|itself|your\s+own\s+\w+|your\s+(?:runtime|system|health|status|state|capabilit\w*|voice|routing|router|gateway|backend|supervisor|memory|responses?|replies))|check\s*(?:your|the|its)\s*(?:status|health|state)|diagnos\w*|inspect\s*(?:your|yourself|the\s+system|its)|self[- ]?(?:diagnos\w*|audi\w*|inspect\w*|heal\w*|check\w*)|health\s*check|heal\s*(?:yourself|your\s+runtime|itself)|audit\s*(?:yourself|your)|troubleshoot)\b/i;

const BROKENNESS_VERB =
  /\b(?:what(?:'s| is)?\s*(?:wrong|broken|failing|the\s+problem|the\s+issue)|where\s*(?:the\s+problem|it\s+breaks|you\s*(?:can\s*)?heal)|see\s+where\s+you\s*(?:can\s*)?heal|find\s+what(?:'s)?\s*(?:wrong|broken|failing)|what\s+is\s+broken|what\s+needs\s+(?:repair|fixing)|capabilit(?:y|ies)\s+(?:is|are)\s+broken|why\s+(?:you\s*)?(?:are|you're)\s+not\s+working)\b/i;

/** A bare imperative that opens an unanchored search for the defect. */
const BARE_DEFECT_IMPERATIVE = /^(?:jarvis[,\s]+)?(?:find|see|show\s+me|tell\s+me|figure\s+out|look\s+for)\b/i;

export function detectExplicitSystemCommand(text: string): ExplicitSystemCommand | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const t = raw.replace(/^jarvis[,\s]+/i, '').trim();

  // An imperative command that MUTATES an entity (rename, update, create, delete, etc.)
  // is an action turn, NEVER a system diagnostic command.
  if (/^(?:rename|update|create|add|delete|remove|move|copy|set|archive|prioriti[sz]e)\b/i.test(t)) {
    return null;
  }

  // A question that NAMES a project is a project question, not a system command.
  const namesProject = /\b(?:free\s*cash|freecash|free\s*cache|shopify|tiktok\s*shop|tik\s*tok\s*shop|revenue\s+operator|revenue\s+workspace)\b/i.test(t);

  const diagMatch = t.match(DIAGNOSTIC_VERB);
  const hasDiagVerb = Boolean(diagMatch);
  const hasBrokenness = BROKENNESS_VERB.test(t);
  const sysNounMatch = t.match(SYSTEM_NOUN);
  const hasSystemNoun = Boolean(sysNounMatch);
  const selfMatch = t.match(SELF_POSSESSIVE);
  const referencesSelf = Boolean(selfMatch);

  // "check why your voice keeps cutting me off" — a subsystem of the assistant
  // named possessively, plus an interrogative/diagnostic verb. Covers the voice,
  // routing, gateway, memory and supervisor domains without naming them first.
  const selfSubsystem = /\b(?:your|my|you)\s+(?:voice|audio|hearing|speech|stt|transcri\w*|microphone|mic|router|routing|responses?|replies|listening|backend|gateway|supervisor|memory|brain|runtime|self|system|capabilit(?:y|ies))\b/i;
  const askVerb = /\b(?:check|diagnos\w*|inspect|why|find|see|debug|fix|look\s+at|understand)\b/i;

  // "run a status check", "status check" — an unmistakable standalone form.
  const BARE_STATUS_CHECK_RE = /\b(?:run|do|start|give\s+me|perform)?\s*a?\s*status\s*check\b/i;
  const bareStatusCheck = BARE_STATUS_CHECK_RE.test(t);

  if (namesProject) {
    // Only an explicitly self-directed diagnostic survives a project mention.
    if (hasDiagVerb && /\b(?:yourself|itself|your\s+own|your\s+runtime|your\s+system|your\s+capabilit)\b/i.test(t)) {
      return {
        intent: 'system_self_diagnose',
        kind: /heal/i.test(t) ? 'self_heal' : 'self_inspect',
        matched: (diagMatch?.[0] || t).slice(0, 120),
        confidence: 0.92,
      };
    }
    return null;
  }

  // A diagnostic verb aimed at the system, the assistant, or the runtime.
  if (hasDiagVerb && (hasSystemNoun || referencesSelf)) {
    return {
      intent: 'system_self_diagnose',
      kind: /heal/i.test(t) ? 'self_heal' : /capabilit/i.test(t) ? 'capability_check' : 'self_inspect',
      matched: (diagMatch?.[0] || t).slice(0, 120),
      confidence: 0.97,
    };
  }

  // A question about what is broken. These phrasings are inherently about the
  // speaker's own situation ("find what's wrong"), so a self-reference is not
  // required — but a named project disqualifies them above.
  if (hasBrokenness && (referencesSelf || hasSystemNoun || BARE_DEFECT_IMPERATIVE.test(t))) {
    return {
      intent: 'system_self_diagnose',
      kind: 'self_heal',
      matched: (t.match(BROKENNESS_VERB)?.[0] || t).slice(0, 120),
      confidence: 0.95,
    };
  }

  // A named subsystem of the assistant plus an interrogative verb
  // ("Check why your voice keeps cutting me off.").
  if (selfSubsystem.test(t) && askVerb.test(t)) {
    return {
      intent: 'system_self_diagnose',
      kind: /voice|audio|hearing|speech|stt|transcri|microphone|mic|listening/i.test(t) ? 'capability_check' : 'self_inspect',
      matched: (t.match(selfSubsystem)?.[0] || t).slice(0, 120),
      confidence: 0.94,
    };
  }

  // "run/delegate/do a status check", "see where you can heal yourself".
  if (bareStatusCheck) {
    return {
      intent: 'system_self_diagnose',
      kind: /problem|wrong|broken|heal|failing/i.test(t) ? 'self_heal' : 'status_check',
      matched: (t.match(BARE_STATUS_CHECK_RE)?.[0] || t).slice(0, 120),
      confidence: 0.93,
    };
  }

  return null;
}

// ── Report types ────────────────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'degraded' | 'failed' | 'unknown';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was actually observed. Never a guess. Full detail, for the report. */
  detail: string;
  /**
   * Short, de-identified version for SPEECH. Records (incidents, task titles)
   * routinely embed project names; speaking them verbatim would turn a runtime
   * diagnostic into an answer about the user's projects, and would produce a
   * paragraph too long to say. The renderer prefers this when present.
   */
  spoken?: string;
  evidence?: Record<string, unknown>;
  /** Only true when the existing Self-Heal architecture can act on it. */
  repairable?: boolean;
  incident?: { component: string; symptom: string; domain: string; priority: 'low' | 'medium' | 'high' | 'critical' };
}

export interface SystemDiagnosisReport {
  generatedAt: string;
  buildId: string;
  pid: number;
  checks: DiagnosticCheck[];
  defects: DiagnosticCheck[];
  overall: 'healthy' | 'degraded' | 'faulty';
}

// ── Individual probes ───────────────────────────────────────────────────────

function probeTimeoutMs(): number {
  return parseInt(process.env.SYSTEM_DIAG_PROBE_TIMEOUT_MS || process.env.GATEWAY_HEALTH_PROBE_TIMEOUT_MS || '2500', 10);
}

async function probeUrl(label: string, url: string): Promise<{ ok: boolean; detail: string; latencyMs?: number }> {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(probeTimeoutMs()) });
    const latencyMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300) return { ok: true, detail: `${label} reachable (HTTP ${res.status}, ${latencyMs}ms)`, latencyMs };
    return { ok: false, detail: `${label} answered HTTP ${res.status}`, latencyMs };
  } catch (err: any) {
    return { ok: false, detail: `${label} unreachable: ${err?.message || 'probe failed'}` };
  }
}

function checkBackend(): DiagnosticCheck {
  let buildId = 'unknown';
  try {
    buildId = getBuildIdentity().buildId || 'unknown';
  } catch { /* identity unavailable — reported as unknown, never guessed */ }
  return {
    id: 'backend',
    label: 'AgenticOS backend',
    status: 'ok',
    detail: `Backend process ${process.pid} running on Node ${process.version}, build ${buildId}, up ${Math.round(process.uptime())}s.`,
    evidence: { pid: process.pid, node: process.version, buildId, uptimeSec: Math.round(process.uptime()), nodeEnv: process.env.NODE_ENV ?? null },
  };
}

async function checkHermesGateway(): Promise<DiagnosticCheck> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const hasOpenrouterKey = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim());
  const openrouterUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const omnirouteUrl = process.env.OMNIROUTE_BASE_URL || process.env.OMNIROOT_BASE_URL || '';

  const probes: Array<{ name: string; url: string }> = [{ name: 'local inference (Ollama)', url: `${ollamaUrl.replace(/\/$/, '')}/api/tags` }];
  if (hasOpenrouterKey) probes.push({ name: 'OpenRouter', url: `${openrouterUrl.replace(/\/$/, '')}/models` });
  if (omnirouteUrl) probes.push({ name: 'OmniRoute', url: `${omnirouteUrl.replace(/\/$/, '')}/models` });

  const results = await Promise.all(probes.map((p) => probeUrl(p.name, p.url)));
  const up = results.filter((r) => r.ok).length;
  const status: CheckStatus = up === probes.length ? 'ok' : up === 0 ? 'failed' : 'degraded';

  return {
    id: 'hermes_gateway',
    label: 'Hermes gateway / model providers',
    status,
    detail: results.map((r) => r.detail).join('; '),
    evidence: { probes: results.map((r, i) => ({ provider: probes[i].name, ok: r.ok, latencyMs: r.latencyMs ?? null })) },
    repairable: status === 'failed',
    incident: status === 'failed'
      ? { component: 'hermes_gateway', symptom: `no model provider reachable (${results.map((r) => r.detail).join('; ')})`, domain: 'backend', priority: 'high' }
      : undefined,
  };
}

async function checkSupervisor(): Promise<DiagnosticCheck> {
  try {
    const { selfHealSupervisor } = await import('../selfHeal/SelfHealSupervisor.js');
    const status = selfHealSupervisor.getStatus();
    return {
      id: 'supervisor',
      label: 'Self-Heal Supervisor',
      // An idle supervisor that has not been asked to repair anything yet is NOT a
      // defect. Treating initialized=false as degraded produced false incidents, so
      // this reports the fact without raising one.
      status: 'ok',
      detail: `Supervisor ${status.initialized ? 'initialized' : 'idle (not yet asked to repair anything)'}; ${status.activeIncidents} active incident budget(s).`,
      evidence: { initialized: status.initialized, activeIncidents: status.activeIncidents },
    };
  } catch (err: any) {
    return {
      id: 'supervisor',
      label: 'Self-Heal Supervisor',
      status: 'unknown',
      detail: `Supervisor state could not be read: ${err?.message || String(err)}`,
    };
  }
}

function checkOpenIncidents(): DiagnosticCheck {
  try {
    const rows = rawDb.prepare(
      `SELECT id, component, symptom, priority, status, detected_at FROM repair_incidents
       WHERE status NOT IN ('resolved','closed') ORDER BY detected_at DESC LIMIT 25`,
    ).all() as any[];
    if (!rows.length) {
      return {
        id: 'incidents',
        label: 'Active incidents',
        status: 'ok',
        detail: 'No open Self-Heal incidents are recorded.',
        evidence: { open: 0 },
      };
    }
    const breakdown = rows.map((r) => `${r.id} [${r.status}/${r.priority}] ${r.component}: ${String(r.symptom).slice(0, 90)}`);
    // Spoken form names the COUNT and the affected internal components only.
    // Symptoms quote project names verbatim, so they never go into speech.
    const components = [...new Set(rows.map((r) => String(r.component)))];
    return {
      id: 'incidents',
      label: 'Active incidents',
      status: 'degraded',
      detail: `${rows.length} open incident(s): ${breakdown.join(' | ')}`,
      spoken: `${rows.length} open incident(s) in the Self-Heal records, affecting ${components.join(', ')}`,
      evidence: { open: rows.length, components, incidents: breakdown },
    };
  } catch (err: any) {
    return {
      id: 'incidents',
      label: 'Active incidents',
      status: 'unknown',
      detail: `Incident store could not be read: ${err?.message || String(err)}`,
    };
  }
}

function checkFailedCapabilities(): DiagnosticCheck {
  const parts: string[] = [];
  const evidence: Record<string, unknown> = {};
  let worst: CheckStatus = 'ok';

  try {
    const snap = healthSnapshot();
    evidence.jarvisCounters = snap.counters;
    evidence.jarvisRates = snap.rates;
    if (snap.regressions.length) {
      worst = 'degraded';
      parts.push(`router regressions flagged: ${snap.regressions.join('; ')}`);
    } else {
      parts.push(`router counters nominal (${snap.counters.turns || 0} turns observed)`);
    }
  } catch (err: any) {
    worst = 'unknown';
    parts.push(`router counters unreadable (${err?.message || String(err)})`);
  }

  try {
    const turns = voiceHealthMonitor.getRecentTurns();
    const abnormal = turns.filter((t) => t.isAbnormalEarlyEndpoint || t.isBareEntityFallback || (t.isClarification && t.rawDurationMs < 1500));
    evidence.recentVoiceTurns = turns.length;
    evidence.abnormalVoiceTurns = abnormal.length;
    if (abnormal.length >= 3) {
      worst = worst === 'ok' ? 'degraded' : worst;
      parts.push(`${abnormal.length} of the last ${turns.length} voice turns ended abnormally early or produced a premature clarification`);
    } else {
      parts.push(`${abnormal.length} abnormal voice turn(s) in the last ${turns.length}`);
    }
  } catch (err: any) {
    parts.push(`voice turn monitor unreadable (${err?.message || String(err)})`);
  }

  return {
    id: 'failed_capabilities',
    label: 'Failed capabilities',
    status: worst,
    detail: parts.join('; '),
    evidence,
    repairable: worst === 'degraded',
    incident: worst === 'degraded'
      ? { component: 'jarvis_capability_health', symptom: parts.join('; '), domain: 'backend', priority: 'medium' }
      : undefined,
  };
}

async function checkVoiceStt(): Promise<DiagnosticCheck> {
  const evidence: Record<string, unknown> = {};
  const parts: string[] = [];
  let status: CheckStatus = 'ok';

  try {
    const mod: any = await import('../../services/voice/localTranscribe.js');
    const worker = typeof mod.getWarmWorkerStatus === 'function' ? mod.getWarmWorkerStatus() : null;
    evidence.warmWorker = worker;
    if (!worker) {
      status = 'unknown';
      parts.push('speech recognition worker exposes no status');
    } else if (worker.ready) {
      parts.push(`speech recognition ready (model ${worker.model} on ${worker.device})`);
    } else {
      status = 'failed';
      parts.push(`speech recognition worker is NOT ready (model ${worker.model}, device ${worker.device})`);
    }
  } catch (err: any) {
    status = 'unknown';
    parts.push(`speech recognition state unreadable (${err?.message || String(err)})`);
  }

  try {
    const workerScript = path.resolve(__dirname, '..', '..', '..', 'scripts', 'whisper_worker.py');
    const exists = fs.existsSync(workerScript);
    evidence.whisperWorkerScript = { path: workerScript, exists };
    if (!exists) {
      status = status === 'ok' ? 'degraded' : status;
      parts.push('whisper worker script is missing from the deployment');
    } else {
      parts.push('whisper worker script present');
    }
  } catch (err: any) {
    parts.push(`whisper worker script could not be checked (${err?.message || String(err)})`);
  }

  try {
    const captures = fs.readdirSync(path.resolve(__dirname, '..', '..', '..', 'temp')).filter((f) => f.endsWith('.wav'));
    evidence.tempWavFiles = captures.length;
  } catch { /* temp capture dir may not exist — not a defect */ }

  return {
    id: 'voice_stt',
    label: 'Voice capture / speech recognition',
    status,
    detail: parts.join('; '),
    evidence,
    repairable: status === 'failed',
    incident: status === 'failed'
      ? { component: 'voice_stt', symptom: parts.join('; '), domain: 'voice', priority: 'high' }
      : undefined,
  };
}

async function checkBrowser(): Promise<DiagnosticCheck> {
  const evidence: Record<string, unknown> = {};
  try {
    await import('playwright');
    evidence.playwrightImport = 'ok';
  } catch (err: any) {
    return {
      id: 'browser',
      label: 'Browser capability',
      status: 'failed',
      detail: `Playwright cannot be loaded: ${err?.message || String(err)}`,
      evidence: { playwrightImport: 'failed' },
      repairable: true,
      incident: { component: 'browser', symptom: `playwright import failed: ${err?.message || String(err)}`, domain: 'browser', priority: 'high' },
    };
  }

  // Chromium executable presence is real filesystem evidence, not an assumption.
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-*'),
    path.resolve(__dirname, '..', '..', '..', '..', 'node_modules', 'playwright-core', '.local-browsers', 'chromium-*'),
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-*'),
  ].filter(Boolean) as string[];

  let chromiumDir: string | null = null;
  for (const pattern of candidates) {
    try {
      const dir = path.dirname(pattern);
      const base = path.basename(pattern);
      if (!fs.existsSync(dir)) continue;
      const hit = fs.readdirSync(dir).find((n) => n.startsWith(base.replace('*', '')));
      if (hit) { chromiumDir = path.join(dir, hit); break; }
    } catch { /* keep looking */ }
  }

  evidence.chromiumDir = chromiumDir;
  if (!chromiumDir) {
    return {
      id: 'browser',
      label: 'Browser capability',
      status: 'degraded',
      detail: 'Playwright loads, but no Chromium browser directory was found in the known locations.',
      evidence,
      repairable: true,
      incident: { component: 'browser', symptom: 'playwright present but no chromium browser install found', domain: 'browser', priority: 'medium' },
    };
  }

  return {
    id: 'browser',
    label: 'Browser capability',
    status: 'ok',
    detail: `Playwright loads and a Chromium install is present at ${chromiumDir}.`,
    evidence,
  };
}

function checkDesktop(): DiagnosticCheck {
  try {
    const resolved = desktopExecutor.resolveApp('notepad');
    if (!resolved) {
      return {
        id: 'desktop',
        label: 'Desktop capability',
        status: 'degraded',
        detail: 'The desktop application resolver returned no match for a canonical application.',
        repairable: true,
        incident: { component: 'desktop', symptom: 'desktopExecutor.resolveApp(notepad) returned null', domain: 'backend', priority: 'medium' },
      };
    }
    return {
      id: 'desktop',
      label: 'Desktop capability',
      status: 'ok',
      detail: `Desktop executor is wired and resolves canonical applications (probe: Notepad → ${resolved.executable}).`,
      evidence: { probe: 'notepad', executable: resolved.executable, processName: resolved.processName },
    };
  } catch (err: any) {
    return {
      id: 'desktop',
      label: 'Desktop capability',
      status: 'unknown',
      detail: `Desktop capability could not be probed: ${err?.message || String(err)}`,
    };
  }
}

function checkRuntimeState(): DiagnosticCheck {
  try {
    const row = rawDb.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as any;
    const migrations = row?.c;
    return {
      id: 'runtime_state',
      label: 'Project / runtime state store',
      status: 'ok',
      detail: `Runtime database reachable; ${migrations} migration record(s) applied.`,
      evidence: { migrationsApplied: migrations },
    };
  } catch (err: any) {
    return {
      id: 'runtime_state',
      label: 'Project / runtime state store',
      status: 'failed',
      detail: `Runtime database is not readable: ${err?.message || String(err)}`,
      repairable: true,
      incident: { component: 'database', symptom: `runtime database unreadable: ${err?.message || String(err)}`, domain: 'backend', priority: 'critical' },
    };
  }
}

function checkExecutionFailures(): DiagnosticCheck {
  try {
    const failed = backgroundTaskRepo.listTasks({ status: ['failed'] as any, limit: 25 });
    if (!failed.length) {
      return {
        id: 'execution_failures',
        label: 'Recent execution failures',
        status: 'ok',
        detail: 'No failed background tasks are recorded.',
        evidence: { failed: 0 },
      };
    }
    const recent = failed.slice(0, 5).map((t: any) => `${t.id}: ${String(t.title || t.mission || '').slice(0, 70)}`);
    // Task titles carry project names; speech reports the count only.
    return {
      id: 'execution_failures',
      label: 'Recent execution failures',
      status: 'degraded',
      detail: `${failed.length} failed background task(s) recorded; most recent: ${recent.join(' | ')}`,
      spoken: `${failed.length} failed background task(s) recorded`,
      evidence: { failed: failed.length, recent },
    };
  } catch (err: any) {
    return {
      id: 'execution_failures',
      label: 'Recent execution failures',
      status: 'unknown',
      detail: `Execution failure records could not be read: ${err?.message || String(err)}`,
    };
  }
}

// ── Orchestration ───────────────────────────────────────────────────────────

/**
 * Run the full runtime self-diagnosis. Every check is independent: one failing
 * probe can never suppress the others, and no check reports health it did not
 * observe.
 */
export async function runSystemSelfDiagnosis(): Promise<SystemDiagnosisReport> {
  const settled = await Promise.allSettled([
    Promise.resolve(checkBackend()),
    checkHermesGateway(),
    checkSupervisor(),
    Promise.resolve(checkOpenIncidents()),
    Promise.resolve(checkFailedCapabilities()),
    checkVoiceStt(),
    checkBrowser(),
    Promise.resolve(checkDesktop()),
    Promise.resolve(checkRuntimeState()),
    Promise.resolve(checkExecutionFailures()),
  ]);

  const checks: DiagnosticCheck[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          id: `check_${i}`,
          label: `Diagnostic check ${i}`,
          status: 'unknown' as CheckStatus,
          detail: `check threw: ${String((s as PromiseRejectedResult).reason)}`,
        },
  );

  const defects = checks.filter((c) => c.status === 'failed' || c.status === 'degraded');

  // BEHAVIOURAL LAYER: process health is not behavioural health. A failing
  // behavioural invariant must be able to prevent an overall HEALTHY verdict,
  // otherwise the report says "0 failed, 2 degraded" while Jarvis is unusable.
  let behavioralOverall: 'healthy' | 'degraded' | 'critical' | 'failed' = 'healthy';
  try {
    const mod: any = await import('./behavioralHealth.js');
    const bh = mod.getBehavioralHealth([]);
    behavioralOverall = bh.overall === 'HEALTHY' ? 'healthy' : bh.overall === 'DEGRADED' ? 'degraded' : bh.overall === 'CRITICAL' ? 'critical' : 'failed';
    for (const f of bh.failing) {
      checks.push({
        id: `behavioral:${f.id}`,
        label: `Behavioural — ${f.id}`,
        status: f.state === 'DEGRADED' ? 'degraded' : 'failed',
        detail: f.detail,
        evidence: f.evidence,
      });
    }
  } catch (err: any) {
    checks.push({
      id: 'behavioral:unavailable',
      label: 'Behavioural health',
      status: 'unknown',
      detail: `behavioural health could not be evaluated: ${err?.message || String(err)}`,
    });
  }

  const defectsAll = checks.filter((c) => c.status === 'failed' || c.status === 'degraded');
  const overall: SystemDiagnosisReport['overall'] =
    checks.some((c) => c.status === 'failed') || behavioralOverall === 'critical' || behavioralOverall === 'failed'
      ? 'faulty'
    : defectsAll.length > 0 || behavioralOverall === 'degraded'
      ? 'degraded'
    : 'healthy';

  const report: SystemDiagnosisReport = {
    generatedAt: new Date().toISOString(),
    buildId: (() => { try { return getBuildIdentity().buildId || 'unknown'; } catch { return 'unknown'; } })(),
    pid: process.pid,
    checks,
    defects,
    overall,
  };

  logger.info('[SystemDiagnostics] Self-diagnosis completed', {
    overall,
    checks: checks.map((c) => `${c.id}:${c.status}`),
  });
  console.log(`[JRT] SYSTEM_SELF_DIAGNOSE overall=${overall} checks=${checks.map((c) => `${c.id}:${c.status}`).join(',')}`);

  return report;
}

/**
 * Hand every repairable defect to the EXISTING Self-Heal architecture:
 * FailureDetector → incident → Self-Heal Supervisor → diagnosis/repair pipeline.
 * Returns the incident ids that were actually created.
 */
export async function handRepairableDefectsToSelfHeal(report: SystemDiagnosisReport): Promise<{ incidentIds: string[]; errors: string[] }> {
  const incidentIds: string[] = [];
  const errors: string[] = [];

  const repairable = report.defects.filter((c) => c.repairable && c.incident);
  if (!repairable.length) return { incidentIds, errors };

  try {
    const { failureDetector } = await import('../selfHeal/FailureDetector.js');
    const { selfHealSupervisor } = await import('../selfHeal/SelfHealSupervisor.js');

    for (const defect of repairable) {
      const hint = defect.incident!;
      try {
        const incidentId: string = await failureDetector.createManualIncident(
          hint.component,
          hint.symptom,
          hint.domain as any,
          hint.priority,
          {
            source: 'system_self_diagnose',
            detectedBy: 'jarvis_system_diagnostics',
            checkId: defect.id,
            detail: defect.detail,
            evidence: defect.evidence ?? {},
          },
        );
        incidentIds.push(incidentId);
        logger.info('[SystemDiagnostics] Self-Heal incident created', { incidentId, checkId: defect.id, component: hint.component });
        console.log(`[JRT] SYSTEM_SELF_DIAGNOSE_INCIDENT incidentId=${incidentId} check=${defect.id} component=${hint.component}`);

        // Kick the existing closed-loop diagnosis in the background: never block
        // the spoken turn on a repair pipeline.
        selfHealSupervisor.diagnoseIncident(incidentId).catch((err: any) => {
          logger.warn('[SystemDiagnostics] Supervisor diagnosis error', { incidentId, error: err?.message || String(err) });
        });
      } catch (err: any) {
        errors.push(`${defect.id}: ${err?.message || String(err)}`);
      }
    }
  } catch (err: any) {
    errors.push(`self-heal unavailable: ${err?.message || String(err)}`);
  }

  return { incidentIds, errors };
}

// ── Human-like rendering (facts fixed, wording natural) ─────────────────────

const CHECK_LABELS_SHORT = 'the backend, the model gateway, the Supervisor, Self-Heal, active incidents, failed capabilities, voice and speech recognition, the browser, the desktop, and recent execution failures';

/** Project names must never be spoken by a runtime diagnostic. */
const PROJECT_NAME_RE = /\b(?:free\s*cash|freecash|free\s*cache|shopify|sharpify|tiktok\s*shop|tik\s*tok\s*shop|revenue\s+operator|revenue\s+workspace)\b/gi;

function speakable(c: DiagnosticCheck, maxLen = 170): string {
  const raw = c.spoken ?? c.detail;
  const redacted = raw.replace(PROJECT_NAME_RE, 'a project').replace(/\s+/g, ' ').trim();
  return redacted.length > maxLen ? `${redacted.slice(0, maxLen - 1).trimEnd()}…` : redacted;
}

/** Spoken answers are bounded: anything longer is unusable for TTS. */
const MAX_SPEECH_CHARS = 900;

/**
 * Render the report as a natural spoken answer. The wording may vary; every
 * number, status and entity is taken verbatim from the report, and no project
 * name ever appears — a runtime diagnostic answers about the runtime.
 *
 * The result is BOUNDED: lowest-priority detail is dropped with an explicit
 * count rather than read out as a wall of text.
 */
export function formatSystemDiagnosisSpeech(
  report: SystemDiagnosisReport,
  opts: { incidentIds?: string[]; selfHealErrors?: string[] } = {},
): string {
  const { incidentIds = [], selfHealErrors = [] } = opts;
  const headline = `I checked my own runtime — ${CHECK_LABELS_SHORT}.`;

  if (report.overall === 'healthy') {
    return `${headline} Everything I depend on is up: no open incidents, no failed capabilities and no failed background tasks.`;
  }

  const failed = report.checks.filter((c) => c.status === 'failed');
  const degraded = report.checks.filter((c) => c.status === 'degraded');
  const unknown = report.checks.filter((c) => c.status === 'unknown');

  // A defect that is listed but missing from `checks` must still be spoken:
  // silently dropping a real defect is the one failure mode this renderer
  // may not have.
  const spokenIds = new Set([...failed, ...degraded, ...unknown].map((c) => c.id));
  const unspoken = report.defects.filter((d) => !spokenIds.has(d.id));

  const repairableCount = report.defects.filter((c) => c.repairable).length;
  const tail = incidentIds.length
    ? `I opened ${incidentIds.length} Self-Heal incident(s) for the repairable defects and handed them to the repair pipeline.`
    : repairableCount > 0
      ? 'The repairable defects could not be handed to Self-Heal, so the repair pipeline did not start.'
      : degraded.length
        ? 'None of these are repairable by the Self-Heal pipeline automatically, so I am reporting them rather than pretending to fix them.'
        : '';
  const selfHealLine = selfHealErrors.length ? 'Self-Heal could not be reached, so no repair was started.' : '';

  // Priority order: hard failures first, then degraded, then unreadable.
  const detailLines: string[] = [
    ...failed.map((c) => `Failed — ${c.label}: ${speakable(c)}.`),
    ...degraded.map((c) => `Degraded — ${c.label}: ${speakable(c)}.`),
    ...unspoken.map((c) => `${c.status} — ${c.label}: ${speakable(c)}.`),
    ...unknown.map((c) => `I could not read ${c.label}.`),
  ];

  const counts = `${failed.length} failed and ${degraded.length} degraded of ${report.checks.length} checks.`;
  const budget = MAX_SPEECH_CHARS - headline.length - counts.length - tail.length - selfHealLine.length - 60;

  const kept: string[] = [];
  let used = 0;
  for (const line of detailLines) {
    if (used + line.length > budget && kept.length > 0) break;
    kept.push(line);
    used += line.length;
  }
  const dropped = detailLines.length - kept.length;

  const parts = [headline, counts, ...kept];
  if (dropped > 0) parts.push(`${dropped} further check(s) are in the full report.`);
  if (tail) parts.push(tail);
  if (selfHealLine) parts.push(selfHealLine);

  return parts.join(' ');
}
