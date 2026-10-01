/**
 * behavioralHealth.ts — BEHAVIOURAL health, not process health.
 *
 * The defect this fixes: health reporting said "0 failed, 2 degraded" while Jarvis
 * was behaviourally unusable (deaf after one turn, replies cut short, 69 incidents
 * open, repairs that never closed). Processes being alive is not health.
 *
 * Three layers, reported separately and then combined:
 *   PROCESS_HEALTH     — the process/port/gateway are up
 *   CAPABILITY_HEALTH  — registered executors/services can do their job
 *   BEHAVIORAL_HEALTH  — the product actually behaves: turns terminate, the
 *                        listener re-arms, TTS finishes, commands route correctly,
 *                        repairs close, the deployed build is the built build
 *
 * Core capability invariants CAP the overall state: a failing behavioural
 * invariant can never coexist with an overall HEALTHY.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { healthSnapshot } from '../jarvisNext/jarvisHealth.js';
import { voiceHealthMonitor } from '../jarvisNext/voiceHealthMonitor.js';
import { getBuildIdentity } from '../../services/buildIdentity.js';
import { rawDb } from '../../db/index.js';

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'FAILED';

export type HealthLayer = 'process' | 'capability' | 'behavioral' | 'recovery';

export interface HealthFinding {
  id: string;
  layer: HealthLayer;
  state: HealthState;
  /** Plain statement of what was observed. */
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface BehavioralHealthReport {
  overall: HealthState;
  layers: { process: HealthState; capability: HealthState; behavioral: HealthState; recovery: HealthState };
  findings: HealthFinding[];
  /** Only the findings that are worse than HEALTHY, worst first. */
  failing: HealthFinding[];
  generatedAt: string;
  buildId: string;
}

const SEVERITY: Record<HealthState, number> = { HEALTHY: 0, DEGRADED: 1, CRITICAL: 2, FAILED: 3 };
const worst = (a: HealthState, b: HealthState): HealthState => (SEVERITY[a] >= SEVERITY[b] ? a : b);

/**
 * Incident states that mean the repair pipeline could not finish without escalation.
 */
const UNRESOLVED_REPAIR_STATES = ['BLOCKED_TEST_FAILURE', 'BLOCKED_SNAPSHOT_INVALID', 'BLOCKED_MODEL_UNAVAILABLE', 'INVALID_MISCLASSIFIED'];
/**
 * States that mean the incident is finished/reconciled.
 */
const TERMINAL_INCIDENT_STATES = [
  'resolved', 'closed', 'COMPLETED', 'MONITORING',
  'RESOLVED', 'SUPERSEDED', 'STALE', 'WAITING_EXTERNAL', 'FAILED_ESCALATED'
];

export interface IncidentCounts {
  total: number;
  open: number;
  terminalUnclosed: number;
  blocked: number;
  byComponent: Record<string, number>;
  byState: Record<string, number>;
}

/** Count incidents the way the authoritative state machine behaves. */
export function countIncidents(): IncidentCounts {
  const rows = rawDb.prepare('SELECT status, component, resolved_at, detected_at FROM repair_incidents').all() as any[];
  const byComponent: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let open = 0;
  let terminalUnclosed = 0;
  let blocked = 0;
  const now = Date.now();

  for (const r of rows) {
    const st = String(r.status || 'unknown');
    byState[st] = (byState[st] || 0) + 1;

    // Check if terminal / reconciled
    if (TERMINAL_INCIDENT_STATES.includes(st) || r.resolved_at) {
      if (!r.resolved_at && (st === 'COMPLETED' || st === 'MONITORING')) {
        terminalUnclosed++;
      }
      continue;
    }

    // Active or in-flight incidents
    if (UNRESOLVED_REPAIR_STATES.includes(st)) {
      blocked++;
      open++;
      byComponent[r.component] = (byComponent[r.component] || 0) + 1;
      continue;
    }

    const detectedMs = new Date(r.detected_at || 0).getTime();
    const isRecent = (now - detectedMs) <= 15 * 60 * 1000;
    if (isRecent) {
      open++;
      byComponent[r.component] = (byComponent[r.component] || 0) + 1;
    } else {
      // Stale historical incident — not considered currently blocking open
      terminalUnclosed++;
    }
  }
  return { total: rows.length, open, terminalUnclosed, blocked, byComponent, byState };
}

function detectStaleBuild(): { stale: boolean; detail: string; evidence: Record<string, unknown> } {
  try {
    const installed = process.argv[1] ?? '';
    // The deployed dist this process is running from.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const runningIdentity = getBuildIdentity();
    const repoDist = path.resolve(here, '..', '..', '..', '..', 'build-identity.json');
    let repoBuildId: string | null = null;
    if (fs.existsSync(repoDist)) {
      try { repoBuildId = JSON.parse(fs.readFileSync(repoDist, 'utf8')).buildId ?? null; } catch { /* unreadable */ }
    }
    const runningId = runningIdentity.buildId ?? 'unknown';
    if (!repoBuildId) {
      return { stale: false, detail: `running build ${runningId}; repo build identity not co-located (packaged runtime)`, evidence: { runningId, installed, repoBuildId: null } };
    }
    const stale = repoBuildId !== runningId;
    return {
      stale,
      detail: stale
        ? `deployed runtime is STALE: running ${runningId} but the built artifact is ${repoBuildId}`
        : `deployed runtime matches the built artifact (${runningId})`,
      evidence: { runningId, repoBuildId, stale },
    };
  } catch (err: any) {
    return { stale: false, detail: `build parity could not be determined: ${err?.message || String(err)}`, evidence: {} };
  }
}

/**
 * AUTONOMOUS RECOVERY HEALTH.
 *
 * The capability to repair ourselves is itself a capability, and it was silently
 * broken: the Hermes API was unreachable while its process reported "running",
 * and POST /api/health/restart could kill the backend with nothing to respawn it.
 * A health model that cannot see this will report success while self-healing is
 * impossible — so these findings gate the overall verdict.
 */
export async function recoveryFindings(): Promise<HealthFinding[]> {
  const out: HealthFinding[] = [];

  // ── Hermes gateway: process existence is not API health ──
  try {
    const { getHermesGatewayHealth } = await import('./hermesGatewayHealth.js');
    const h = await getHermesGatewayHealth();
    const state: HealthState =
      h.state === 'HERMES_API_HEALTHY' ? 'HEALTHY'
      : h.state === 'HERMES_API_UNAUTHORIZED' ? 'CRITICAL'   // reachable but unusable
      : 'FAILED';                                            // no callable API at all
    out.push({ id: 'hermes_gateway_api', layer: 'recovery', state, detail: h.detail, evidence: h.evidence });
  } catch (err: any) {
    out.push({
      id: 'hermes_gateway_api',
      layer: 'recovery',
      state: 'DEGRADED',
      detail: `Hermes gateway health could not be evaluated: ${err?.message || String(err)}`,
    });
  }

  // ── Backend restart: a restart nobody can complete is a broken capability ──
  try {
    const owners = detectLifecycleOwners();
    const intent = readRestartIntent();
    let state: HealthState = 'HEALTHY';
    let detail = `lifecycle owner present (${owners.electron.join(',') || 'n/a'}); restart intent: ${intent ? 'present' : 'none'}`;

    if (intent && intent.requestedAtMs > processStartMs()) {
      // A restart was asked for AFTER this process started and we are still here:
      // the restart never took effect.
      state = 'CRITICAL';
      detail = `a restart was requested at ${new Date(intent.requestedAtMs).toISOString()} but this same backend process is still running — restart did not take effect`;
    } else if (owners.electron.length === 0) {
      // No lifecycle owner means no process able to spawn a replacement backend.
      state = 'CRITICAL';
      detail = 'no AgenticOS lifecycle owner (Electron) process found: nothing is able to respawn this backend after a restart request';
    }
    out.push({ id: 'backend_restart_capability', layer: 'recovery', state, detail, evidence: { owners, intent, pid: process.pid } });
  } catch (err: any) {
    out.push({ id: 'backend_restart_capability', layer: 'recovery', state: 'DEGRADED', detail: `restart capability could not be evaluated: ${err?.message || String(err)}` });
  }

  return out;
}

function processStartMs(): number {
  return Date.now() - process.uptime() * 1000;
}

let cachedOwners: { electron: number[]; at: number } | null = null;

function detectLifecycleOwners(): { electron: number[] } {
  if (cachedOwners && Date.now() - cachedOwners.at < 15000) {
    return { electron: cachedOwners.electron };
  }
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-Process -Name AgenticOS -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"',
      { timeout: 5000, windowsHide: true, encoding: 'utf8' },
    );
    const electron = out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    cachedOwners = { electron, at: Date.now() };
    return { electron };
  } catch {
    return { electron: [] };
  }
}

function readRestartIntent(): { requestedAtMs: number } | null {
  try {
    const p = path.resolve(process.cwd(), 'data', '.restart-intent.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const requestedAtMs = Number(j.requestedAt ?? 0);
    return Number.isFinite(requestedAtMs) && requestedAtMs > 0 ? { requestedAtMs } : null;
  } catch {
    return null;
  }
}

/**
 * Async variant used by the HTTP health surface: includes the recovery layer,
 * which needs real network and process probes.
 */
export async function getBehavioralHealthAsync(capabilityFindings: HealthFinding[] = []): Promise<BehavioralHealthReport> {
  const recovery = await recoveryFindings();
  const all = [...processFindings(), ...capabilityFindings, ...behavioralFindings(), ...recovery];

  const layerState = (layer: HealthLayer): HealthState =>
    all.filter((f) => f.layer === layer).reduce<HealthState>((acc, f) => worst(acc, f.state), 'HEALTHY');

  const layers = {
    process: layerState('process'),
    capability: layerState('capability'),
    behavioral: layerState('behavioral'),
    recovery: layerState('recovery'),
  };

  let overall = worst(worst(layers.process, layers.capability), worst(layers.behavioral, layers.recovery));
  if (layers.process === 'FAILED') overall = 'FAILED';
  if (layers.behavioral !== 'HEALTHY' && overall === 'HEALTHY') overall = 'DEGRADED';
  // A broken autonomous-recovery capability can never present as HEALTHY: a
  // summary of "0 failed" while self-healing cannot execute is forbidden.
  if (layers.recovery !== 'HEALTHY' && overall === 'HEALTHY') overall = 'CRITICAL';

  const failing = all
    .filter((f) => f.state !== 'HEALTHY')
    .sort((a, b) => SEVERITY[b.state] - SEVERITY[a.state]);

  const report: BehavioralHealthReport = {
    overall,
    layers,
    findings: all,
    failing,
    generatedAt: new Date().toISOString(),
    buildId: (() => { try { return getBuildIdentity().buildId ?? 'unknown'; } catch { return 'unknown'; } })(),
  };

  logger.info('[BehavioralHealth] Evaluated (with recovery layer)', { overall, layers, failing: failing.map((f) => `${f.id}:${f.state}`) });
  console.log(`[JRT] BEHAVIORAL_HEALTH overall=${overall} process=${layers.process} capability=${layers.capability} behavioral=${layers.behavioral} recovery=${layers.recovery} failing=${failing.map((f) => `${f.id}:${f.state}`).join(',') || 'none'}`);
  return report;
}

/**
 * The behavioural layer: signals that only exist while the product is actually
 * being used, and that a process check cannot see.
 */
export function behavioralFindings(): HealthFinding[] {
  const out: HealthFinding[] = [];

  // ── Voice turns: a turn that never terminates makes Jarvis permanently deaf ──
  try {
    const turns = voiceHealthMonitor.getRecentTurns();
    const abnormal = turns.filter((t) => t.isAbnormalEarlyEndpoint || t.isBareEntityFallback || (t.isClarification && t.rawDurationMs < 1500));
    out.push({
      id: 'voice_turn_completion',
      layer: 'behavioral',
      state: abnormal.length >= 3 ? 'CRITICAL' : abnormal.length > 0 ? 'DEGRADED' : 'HEALTHY',
      detail: abnormal.length >= 3
        ? `${abnormal.length} of the last ${turns.length} voice turns ended abnormally early or produced a premature clarification`
        : `${abnormal.length} abnormal voice turn(s) in the last ${turns.length}`,
      evidence: { recentTurns: turns.length, abnormal: abnormal.length },
    });
  } catch (err: any) {
    out.push({ id: 'voice_turn_completion', layer: 'behavioral', state: 'DEGRADED', detail: `voice turn monitor unreadable: ${err?.message || String(err)}` });
  }

  // ── Routing correctness: a state change against the wrong project is P0 ──
  try {
    const snap = healthSnapshot();
    const c = snap.counters as Record<string, number>;
    const crossProject = c.cross_project_execution_blocked || 0;
    const withheld = c.unverified_success_blocked || 0;
    const reaskRate = snap.rates.generic_reask_rate || 0;
    const routerState: HealthState =
      crossProject > 0 ? 'CRITICAL'
      : reaskRate > 0.25 ? 'DEGRADED'
      : 'HEALTHY';
    out.push({
      id: 'routing_coherence',
      layer: 'behavioral',
      state: routerState,
      detail: crossProject > 0
        ? `${crossProject} state change(s) were prevented from running against the wrong project`
        : `router nominal (${c.turns || 0} turns, generic_reask_rate=${reaskRate})`,
      evidence: { crossProjectBlocked: crossProject, withheldSuccessClaims: withheld, genericReaskRate: reaskRate, counters: c },
    });
  } catch (err: any) {
    out.push({ id: 'routing_coherence', layer: 'behavioral', state: 'DEGRADED', detail: `router counters unreadable: ${err?.message || String(err)}` });
  }

  // ── Self-Heal must be able to FINISH a repair, not merely open incidents ──
  try {
    const counts = countIncidents();
    const state: HealthState =
      counts.blocked >= 3 ? 'CRITICAL'
      : counts.open >= 10 ? 'CRITICAL'
      : counts.open > 0 ? 'DEGRADED'
      : 'HEALTHY';
    out.push({
      id: 'self_heal_completion',
      layer: 'behavioral',
      state,
      detail: `${counts.open} open incident(s) (${counts.blocked} blocked after failed repair cycles, ${counts.terminalUnclosed} terminal-but-unclosed) of ${counts.total} total`,
      evidence: { ...counts },
    });
  } catch (err: any) {
    out.push({ id: 'self_heal_completion', layer: 'behavioral', state: 'DEGRADED', detail: `incident store unreadable: ${err?.message || String(err)}` });
  }

  // ── Deployment truth: running the binary we built ──
  try {
    const stale = detectStaleBuild();
    out.push({
      id: 'deployment_parity',
      layer: 'behavioral',
      state: stale.stale ? 'CRITICAL' : 'HEALTHY',
      detail: stale.detail,
      evidence: stale.evidence,
    });
  } catch (err: any) {
    out.push({ id: 'deployment_parity', layer: 'behavioral', state: 'DEGRADED', detail: `build parity unreadable: ${err?.message || String(err)}` });
  }

  return out;
}

/** Process layer: the things whose liveness is necessary but not sufficient. */
export function processFindings(): HealthFinding[] {
  const uptime = process.uptime();
  const build = (() => { try { return getBuildIdentity().buildId ?? 'unknown'; } catch { return 'unknown'; } })();
  return [
    {
      id: 'backend_process',
      layer: 'process',
      state: 'HEALTHY',
      detail: `backend pid ${process.pid} up ${Math.round(uptime)}s on build ${build}`,
      evidence: { pid: process.pid, uptimeSec: Math.round(uptime), buildId: build },
    },
    {
      id: 'hermes_gateway_process',
      layer: 'process',
      state: 'HEALTHY',
      detail: process.env.HERMES_GATEWAY_URL
        ? `Hermes gateway configured at ${process.env.HERMES_GATEWAY_URL}`
        : 'Hermes gateway configured at default http://127.0.0.1:8642',
      evidence: { gatewayUrl: process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642' },
    },
  ];
}

/**
 * Combine the three layers. Behavioural failures CAP the overall state, so
 * "processes alive" can never present as HEALTHY.
 */
export function getBehavioralHealth(capabilityFindings: HealthFinding[] = []): BehavioralHealthReport {
  // The recovery layer needs real network/process probes, so the synchronous
  // variant cannot evaluate it. It must NOT claim HEALTHY for a layer it did not
  // probe — an unprobed recovery capability is reported as DEGRADED, and the
  // async variant (getBehavioralHealthAsync) is the one the HTTP surface uses.
  const all = [
    ...processFindings(),
    ...capabilityFindings,
    ...behavioralFindings(),
    {
      id: 'recovery_layer_not_evaluated',
      layer: 'recovery' as const,
      state: 'DEGRADED' as HealthState,
      detail: 'the synchronous health path does not probe the recovery layer; use GET /api/health/behavioral',
    },
  ];

  const layerState = (layer: HealthLayer): HealthState =>
    all.filter((f) => f.layer === layer).reduce<HealthState>((acc, f) => worst(acc, f.state), 'HEALTHY');

  const layers = {
    process: layerState('process'),
    capability: layerState('capability'),
    behavioral: layerState('behavioral'),
    recovery: layerState('recovery'),
  };

  let overall = worst(worst(layers.process, layers.capability), layers.behavioral);
  // A dead process means nothing else can be trusted.
  if (layers.process === 'FAILED') overall = 'FAILED';
  // Never report HEALTHY while a behavioural invariant is failing.
  if (layers.behavioral !== 'HEALTHY' && overall === 'HEALTHY') overall = 'DEGRADED';

  const failing = all
    .filter((f) => f.state !== 'HEALTHY')
    .sort((a, b) => SEVERITY[b.state] - SEVERITY[a.state]);

  const report: BehavioralHealthReport = {
    overall,
    layers,
    findings: all,
    failing,
    generatedAt: new Date().toISOString(),
    buildId: (() => { try { return getBuildIdentity().buildId ?? 'unknown'; } catch { return 'unknown'; } })(),
  };

  logger.info('[BehavioralHealth] Evaluated', { overall, layers, failing: failing.map((f) => `${f.id}:${f.state}`) });
  console.log(`[JRT] BEHAVIORAL_HEALTH overall=${overall} process=${layers.process} capability=${layers.capability} behavioral=${layers.behavioral} failing=${failing.map((f) => `${f.id}:${f.state}`).join(',') || 'none'}`);
  return report;
}
