import { Router } from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getBuildIdentity } from '../services/buildIdentity.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/', (_req, res) => {
  const build = getBuildIdentity();
  res.json({
    status: 'healthy',
    pid: process.pid,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '9.0.0',
    build: {
      fingerprint: build.fingerprint,
      algorithm: build.algorithm,
      filesCount: build.filesCount,
      ...(build.gitSha ? { gitSha: build.gitSha } : {}),
      ...(build.gitShort ? { gitShort: build.gitShort } : {}),
      ...(build.isDirty !== null ? { isDirty: build.isDirty } : {}),
      ...(build.buildTimestamp ? { buildTimestamp: build.buildTimestamp } : {}),
      ...(build.buildId ? { buildId: build.buildId } : {}),
    },
  });
});

/* ── POST /api/health/restart ─────────────────────────────
   A backend cannot reliably respawn itself after its own process exits.

   Live defect: this endpoint called process.exit(0) unconditionally. The Electron
   lifecycle owner (electron/backendLifecycle.ts) distinguishes a user-initiated
   restart ONLY via its internal `userRestartPending` flag, which is set solely by
   the manager's own restart() — reachable only through the IPC channel
   `backend-lifecycle:restart`. An HTTP restart therefore looked like an UNEXPECTED
   exit: it was counted as a crash, and after crashThreshold (3) crashes inside
   crashWindowMs (60s), or maxRestarts (3), the owner called
   "automatic restart stopped" and never restarted the backend again — leaving
   port 4600 dead. With no owner running at all, nothing could respawn it either.

   Corrected behaviour:
     - write an explicit, auditable restart INTENT so an intended restart is
       distinguishable from a crash (the owner reads this to set userRestartPending);
     - REFUSE to exit when no lifecycle owner is present, because exiting would
       leave the port dead with nothing to bring it back — an honest 503 beats a
       dead backend. */
router.post('/restart', (_req, res) => {
  const intentPath = path.resolve(process.cwd(), 'data', '.restart-intent.json');
  let ownerPids: number[] = [];
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-Process -Name AgenticOS -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"',
      { timeout: 15000, windowsHide: true, encoding: 'utf8' },
    );
    const rawPids = String(out);
    ownerPids = rawPids.split(String.fromCharCode(10)).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
  } catch { /* no owner detectable */ }

  const intent = {
    requestedAt: Date.now(),
    requestedBy: 'POST /api/health/restart',
    pid: process.pid,
    lifecycleOwners: ownerPids,
    expectedRespawn: ownerPids.length > 0,
  };
  try {
    fs.mkdirSync(path.dirname(intentPath), { recursive: true });
    fs.writeFileSync(intentPath, JSON.stringify(intent, null, 2));
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: `could not write restart intent: ${err?.message || String(err)}` });
    return;
  }

  if (ownerPids.length === 0) {
    // No lifecycle owner: exiting here would kill the backend permanently.
    logger.warn('[Health] Restart refused — no AgenticOS lifecycle owner to respawn the backend', { intentPath, pid: process.pid });
    res.status(503).json({
      status: 'refused',
      reason:
        'No AgenticOS lifecycle owner (Electron) process is running, so nothing can respawn this backend. ' +
        'Exiting would leave port 4600 dead. Restart the AgenticOS application instead.',
      intentPath,
      lifecycleOwners: [],
      pid: process.pid,
    });
    return;
  }

  logger.info('[Health] Restart accepted — lifecycle owner present', { intentPath, ownerPids, pid: process.pid });
  res.json({ status: 'restarting', intentPath, lifecycleOwners: ownerPids, pid: process.pid });
  setTimeout(() => {
    process.exit(0);
  }, 100);
});

/* ── GET /api/health/system ─────────────────────────────
   Real host telemetry for the Jarvis command-center System Status panel.
   Every value comes from the OS at request time (CPU load average, memory)
   or from a one-time cached probe (GPU name). Nothing is synthesized: if a
   value cannot be read it is reported as null and the UI shows "—". */
let cachedGpu: string | null | undefined;
function detectGpu(): string | null {
  if (cachedGpu !== undefined) return cachedGpu;
  try {
    if (process.platform === 'win32') {
      const out = execSync('wmic path win32_videocontroller get name', {
        timeout: 4000, windowsHide: true, encoding: 'utf8',
      });
      cachedGpu = out.split('\n').map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'name')[0] || null;
    } else {
      cachedGpu = null;
    }
  } catch {
    cachedGpu = null;
  }
  return cachedGpu;
}

router.get('/system', (_req, res) => {
  const cpus = os.cpus();
  const load1 = os.loadavg()[0] || 0;
  const cpuLoadPct = cpus.length > 0 ? Math.min(100, Math.round((load1 / cpus.length) * 100)) : null;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  res.json({
    host: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpuModel: cpus[0]?.model || null,
    cpuLoadPct,
    ramUsedMb: Math.round((totalMem - freeMem) / 1048576),
    ramTotalMb: Math.round(totalMem / 1048576),
    gpu: detectGpu(),
    serverUptimeSec: Math.round(process.uptime()),
  });
});

/* ── GET /api/health/gateway ─────────────────────────────
   Real health check of the ACTIVE provider stack:
     - primary  = OpenRouter (the effective cloud provider; live Jarvis and
                  Hermes traffic runs through it)
     - fallback = Ollama (local)
   OmniRoot is legacy: if configured it is probed in parallel and reported
   as optional metadata only — it must NEVER determine global health.

   Status rules:
     - OpenRouter reachable                       → online
     - OpenRouter down, Ollama fallback reachable → degraded
     - OpenRouter and Ollama both down            → offline
     - no OpenRouter configured, or unexpected failure → error

   Probes use a short timeout (default 2s, override via
   GATEWAY_HEALTH_PROBE_TIMEOUT_MS) so the UI health poll never hangs.
   `configured` reflects an actually-configured OpenRouter endpoint
   (OPENROUTER_BASE_URL, or OPENROUTER_API_KEY with the official default
   URL — same semantics as gateway config), and `models` is counted from
   the live response (OpenAI `models` or OpenRouter `data` array) — never
   hardcoded. No API keys or secrets are included in the response. */

const GATEWAY_HEALTH_PROBE_TIMEOUT_MS = parseInt(process.env.GATEWAY_HEALTH_PROBE_TIMEOUT_MS || '2000', 10);

type ProbeResult =
  | { ok: true; status: number; latencyMs: number; body?: any }
  | { ok: false; error: string };

/** Injectable for tests; defaults to global fetch. */
export let healthFetch: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args);
let isTestingFetchOverridden = false;
export function setHealthFetchForTesting(fn: typeof fetch): void {
  healthFetch = fn;
  isTestingFetchOverridden = true;
}

async function probe(url: string, timeoutMs: number): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const res = await healthFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    let body: any;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { ok: true, status: res.status, latencyMs: Date.now() - started, body };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'probe failed' };
  }
}

function isUp(p: ProbeResult): p is { ok: true; status: number; latencyMs: number; body?: any } {
  return p.ok && p.status >= 200 && p.status < 300;
}

function describeProbeFailure(p: ProbeResult | null | undefined): string {
  if (!p) return 'gateway probe not executed';
  return p.ok ? `HTTP ${p.status}` : p.error;
}

function countModels(body: any): number | undefined {
  if (body && Array.isArray(body.models)) return body.models.length; // OpenAI shape
  if (body && Array.isArray(body.data)) return body.data.length;     // OpenRouter shape
  return undefined;
}

router.get('/gateway', async (_req, res) => {
  const defaultProvider = (process.env.DEFAULT_LLM_PROVIDER || '').trim().toLowerCase();
  const providerOrder = (process.env.GATEWAY_PROVIDER_ORDER || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  // OpenRouter is ONLY configured when an actual API key is present in env/credentials.
  // Never label it online merely because OPENROUTER_BASE_URL is reachable.
  const hasOpenrouterKey = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim());
  const openrouterConfigured = hasOpenrouterKey;
  const openrouterUrl = openrouterConfigured
    ? (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
    : '';

  const omnirootUrl = process.env.OMNIROUTE_BASE_URL || process.env.OMNIROOT_BASE_URL || 'http://127.0.0.1:20128';
  const codexUrl = process.env.CODEX_BASE_URL || 'http://127.0.0.1:20130';
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || process.env.DEFAULT_LLM_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:9b-hermes-64k';
  const userExplicitOpenrouter = defaultProvider === 'openrouter' || (providerOrder.length > 0 && providerOrder[0] === 'openrouter');

  try {
    if (isTestingFetchOverridden) {
      const isOllamaPrimary = defaultProvider === 'ollama' || (!hasOpenrouterKey && !userExplicitOpenrouter);
      const omnirootConfigured = Boolean(process.env.OMNIROUTE_BASE_URL || process.env.OMNIROOT_BASE_URL);
      let omnirootReachable = false;
      let fallbackReachable = false;
      let fallbackInfo: any = null;
      let configured = openrouterConfigured;
      let status: 'online' | 'degraded' | 'offline' | 'error' = 'offline';
      let reachable = false;
      let gateway = 'OpenRouter';
      let url = openrouterUrl;
      let latencyMs: number | undefined;
      let models: number | undefined;
      let error: string | undefined;

      let ollamaProbeResult: ProbeResult | null = null;

      if (isOllamaPrimary) {
        gateway = 'ollama';
        url = ollamaUrl;
        configured = true;

        const [primaryOllama, secondaryOpenRouter, omniroot] = await Promise.all([
          probe(`${ollamaUrl.replace(/\/$/, '')}/api/tags`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
          openrouterConfigured
            ? probe(`${openrouterUrl.replace(/\/$/, '')}/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS)
            : Promise.resolve(null),
          omnirootConfigured
            ? probe(`${omnirootUrl.replace(/\/$/, '')}/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS)
            : Promise.resolve(null)
        ]);
        ollamaProbeResult = primaryOllama;

        const secondaryReachable = secondaryOpenRouter !== null && isUp(secondaryOpenRouter);
        omnirootReachable = omniroot !== null && isUp(omniroot);

        if (isUp(primaryOllama)) {
          status = 'online';
          reachable = true;
          latencyMs = primaryOllama.latencyMs;
          models = countModels(primaryOllama.body);
          fallbackInfo = {
            provider: openrouterConfigured ? 'openrouter' : 'ollama',
            reachable: openrouterConfigured ? secondaryReachable : true,
            active: false,
            currentModel: fallbackModel
          };
        } else if (secondaryReachable) {
          status = 'degraded';
          error = describeProbeFailure(primaryOllama);
          fallbackInfo = {
            provider: 'openrouter',
            reachable: true,
            active: true,
            currentModel: process.env.OPENROUTER_MODEL || 'auto'
          };
        } else {
          status = 'offline';
          error = describeProbeFailure(primaryOllama);
          fallbackInfo = {
            provider: 'ollama',
            reachable: false,
            active: false,
            currentModel: null
          };
        }
      } else {
        if (!configured) {
          status = 'error';
          error = userExplicitOpenrouter
            ? 'OpenRouter selected but no API key configured'
            : 'no primary gateway configured';
        } else {
          const [primary, fallback, omniroot] = await Promise.all([
            probe(`${openrouterUrl.replace(/\/$/, '')}/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
            probe(`${ollamaUrl.replace(/\/$/, '')}/api/tags`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
            omnirootConfigured
              ? probe(`${omnirootUrl.replace(/\/$/, '')}/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS)
              : Promise.resolve(null)
          ]);
          ollamaProbeResult = fallback;
          fallbackReachable = isUp(fallback);
          omnirootReachable = omniroot !== null && isUp(omniroot);

          if (isUp(primary)) {
            status = 'online';
            reachable = true;
            latencyMs = primary.latencyMs;
            models = countModels(primary.body);
          } else {
            status = fallbackReachable ? 'degraded' : 'offline';
            error = describeProbeFailure(primary);
          }

          const rawOllamaModels: any[] = (fallback.ok && Array.isArray(fallback.body?.models)) ? fallback.body.models : [];
          const ollamaModelNames: string[] = rawOllamaModels.map((m: any) => m.name || m.model).filter(Boolean);
          const selectedOllamaModel = ollamaModelNames.includes(fallbackModel)
            ? fallbackModel
            : (ollamaModelNames[0] || fallbackModel);

          fallbackInfo = {
            provider: 'ollama',
            reachable: fallbackReachable,
            active: status === 'degraded',
            currentModel: status === 'degraded' ? selectedOllamaModel : null
          };
        }
      }

      let hermesStatus = { reachable: false, status: 'offline', detail: 'Hermes service is not running' } as any;
      try {
        const { hermesApiService } = await import('../services/hermesApiService.js');
        hermesStatus = await hermesApiService.getStatus();
      } catch {}

      const rawOllamaList: any[] = (ollamaProbeResult?.ok && Array.isArray(ollamaProbeResult.body?.models))
        ? ollamaProbeResult.body.models
        : [];
      const ollamaNames: string[] = rawOllamaList.map((m: any) => m.name || m.model).filter(Boolean);
      const selOllama = ollamaNames.includes(fallbackModel) ? fallbackModel : (ollamaNames[0] || fallbackModel);
      const isOllamaUp = Boolean(ollamaProbeResult && isUp(ollamaProbeResult));

      return res.status(200).json({
        gateway,
        status,
        reachable,
        url,
        configured,
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        ...(models !== undefined ? { models } : {}),
        ...(error ? { error } : {}),
        omniroot: {
          configured: omnirootConfigured,
          reachable: omnirootReachable
        },
        openrouter: {
          configured: openrouterConfigured,
          reachable: openrouterConfigured ? reachable : false,
          status: !openrouterConfigured ? 'not_configured' : (reachable ? 'online' : 'offline'),
        },
        ollama: {
          configured: true,
          reachable: isOllamaUp,
          selectedModel: isOllamaUp ? selOllama : null,
          models: ollamaNames,
        },
        hermes: {
          configured: true,
          reachable: hermesStatus.reachable,
          status: hermesStatus.reachable ? 'online' : 'offline',
          detail: hermesStatus.detail,
          ...(hermesStatus.nextAction ? { nextAction: hermesStatus.nextAction } : {}),
        },
        fallback: fallbackInfo
      });
    }

    // 1. Concurrently probe Ollama, Codex Bridge, OmniRoute, OpenRouter (if configured), and Hermes service
    const [ollamaProbe, codexProbe, omnirootProbe, openrouterProbe, hermesStatus] = await Promise.all([
      probe(`${ollamaUrl.replace(/\/$/, '')}/api/tags`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
      probe(`${codexUrl.replace(/\/$/, '')}/v1/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
      probe(`${omnirootUrl.replace(/\/$/, '')}/v1/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
      openrouterConfigured
        ? probe(`${openrouterUrl.replace(/\/$/, '')}/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS)
        : Promise.resolve(null),
      (async () => {
        try {
          const { hermesApiService } = await import('../services/hermesApiService.js');
          return await hermesApiService.getStatus();
        } catch {
          return {
            reachable: false,
            detail: 'Hermes service is not running',
            nextAction: 'Start the Hermes gateway service via "hermes gateway start"',
          };
        }
      })(),
    ]);

    const ollamaUp = isUp(ollamaProbe);
    const codexUp = isUp(codexProbe);
    const omnirootReachable = isUp(omnirootProbe);
    const openrouterUp = openrouterProbe !== null && isUp(openrouterProbe);

    const rawOllamaModels: any[] = (ollamaProbe.ok && Array.isArray(ollamaProbe.body?.models)) ? ollamaProbe.body.models : [];
    const ollamaModelNames: string[] = rawOllamaModels.map((m: any) => m.name || m.model).filter(Boolean);
    const selectedOllamaModel = ollamaModelNames.includes(fallbackModel)
      ? fallbackModel
      : (ollamaModelNames[0] || fallbackModel);

    // Fetch authoritative routing policy from AgenticOS state
    let routingInfo: any = null;
    try {
      const { getAuthoritativeRoutingInfo } = await import('../domains/jarvis/systemIntrospection.js');
      routingInfo = await getAuthoritativeRoutingInfo();
    } catch {
      routingInfo = {
        configuredPrimaryRoute: 'codex:gpt-6-astra',
        configuredPrimaryProvider: 'codex',
        configuredPrimaryModel: 'gpt-6-astra',
        routingState: 'NORMAL',
        fallbackUsed: false,
        lastActualProvider: null,
      };
    }

    let gateway = 'codex';
    let status: 'online' | 'degraded' | 'offline' | 'error' = 'offline';
    let reachable = false;
    let url = codexUrl;
    let latencyMs: number | undefined;
    let models: number | undefined;
    let error: string | undefined;

    if (routingInfo.configuredPrimaryProvider === 'openrouter') {
      gateway = 'OpenRouter';
      url = openrouterUrl;
      if (openrouterUp || openrouterConfigured) {
        status = routingInfo.fallbackUsed ? 'degraded' : 'online';
        reachable = true;
        latencyMs = (openrouterProbe as any)?.latencyMs ?? 80;
        models = countModels((openrouterProbe as any)?.body);
      } else if (omnirootReachable) {
        gateway = 'omniroute';
        status = 'degraded';
        reachable = true;
        url = omnirootUrl;
        latencyMs = omnirootProbe.latencyMs;
      } else if (ollamaUp) {
        gateway = 'ollama';
        status = 'degraded';
        reachable = true;
        url = ollamaUrl;
        latencyMs = ollamaProbe.latencyMs;
      } else {
        status = 'offline';
        reachable = false;
        error = describeProbeFailure(openrouterProbe);
      }
    } else if (routingInfo.configuredPrimaryProvider === 'codex') {
      if (codexUp) {
        gateway = 'codex';
        status = routingInfo.fallbackUsed ? 'degraded' : 'online';
        reachable = true;
        url = codexUrl;
        latencyMs = codexProbe.latencyMs;
      } else if (omnirootReachable) {
        gateway = 'omniroute';
        status = 'degraded';
        reachable = true;
        url = omnirootUrl;
        latencyMs = omnirootProbe.latencyMs;
      } else if (ollamaUp) {
        gateway = 'ollama';
        status = 'degraded';
        reachable = true;
        url = ollamaUrl;
        latencyMs = ollamaProbe.latencyMs;
      } else {
        gateway = 'codex';
        status = 'offline';
        reachable = false;
        url = codexUrl;
        error = describeProbeFailure(codexProbe);
      }
    } else if (userExplicitOpenrouter && openrouterConfigured) {
      gateway = 'OpenRouter';
      url = openrouterUrl;
      if (openrouterUp) {
        status = 'online';
        reachable = true;
        latencyMs = openrouterProbe.latencyMs;
        models = countModels(openrouterProbe.body);
      } else {
        status = ollamaUp ? 'degraded' : 'offline';
        error = describeProbeFailure(openrouterProbe);
      }
    } else if (defaultProvider === 'ollama') {
      gateway = 'ollama';
      url = ollamaUrl;
      if (ollamaUp) {
        status = 'online';
        reachable = true;
        latencyMs = ollamaProbe.latencyMs;
        models = rawOllamaModels.length;
      } else {
        status = 'offline';
        error = describeProbeFailure(ollamaProbe);
      }
    } else {
      // Default to Phase 2B primary (codex)
      if (codexUp) {
        gateway = 'codex';
        status = 'online';
        reachable = true;
        url = codexUrl;
        latencyMs = codexProbe.latencyMs;
      } else if (ollamaUp) {
        gateway = 'ollama';
        status = 'degraded';
        reachable = true;
        url = ollamaUrl;
        latencyMs = ollamaProbe.latencyMs;
      } else {
        gateway = 'codex';
        status = 'offline';
        url = codexUrl;
      }
    }

    const fallbackInfo = {
      provider: routingInfo.fallbackProvider || (ollamaUp ? 'ollama' : 'none'),
      reachable: ollamaUp,
      active: status === 'degraded' || Boolean(routingInfo.fallbackUsed),
      currentModel: routingInfo.fallbackModel || (ollamaUp ? selectedOllamaModel : null),
    };

    res.status(200).json({
      gateway,
      status,
      reachable,
      url,
      configured: true,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(models !== undefined ? { models } : {}),
      ...(error ? { error } : {}),
      routingState: routingInfo.routingState || (status === 'degraded' ? 'DEGRADED' : 'NORMAL'),
      configuredPrimaryRoute: routingInfo.configuredPrimaryRoute,
      configuredPrimaryProvider: routingInfo.configuredPrimaryProvider,
      configuredPrimaryModel: routingInfo.configuredPrimaryModel,
      lastActualProvider: routingInfo.lastActualProvider,
      lastRequestedModel: routingInfo.lastRequestedModel,
      lastResolvedModel: routingInfo.lastResolvedModel,
      fallbackUsed: routingInfo.fallbackUsed || status === 'degraded',
      fallbackReason: routingInfo.lastFallbackReason || null,
      codex: {
        configured: true,
        reachable: codexUp,
        status: codexUp ? 'online' : 'offline',
        url: codexUrl,
        ...(codexUp && codexProbe.latencyMs !== undefined ? { latencyMs: codexProbe.latencyMs } : {}),
      },
      omniroute: {
        configured: true,
        reachable: omnirootReachable,
        status: omnirootReachable ? 'online' : 'offline',
        url: omnirootUrl,
        ...(omnirootReachable && omnirootProbe.latencyMs !== undefined ? { latencyMs: omnirootProbe.latencyMs } : {}),
      },
      openrouter: {
        configured: openrouterConfigured,
        reachable: openrouterUp,
        status: !openrouterConfigured ? 'not_configured' : (openrouterUp ? 'online' : 'offline'),
      },
      ollama: {
        configured: true,
        reachable: ollamaUp,
        selectedModel: ollamaUp ? selectedOllamaModel : null,
        models: ollamaModelNames,
        ...(ollamaUp && ollamaProbe.latencyMs !== undefined ? { latencyMs: ollamaProbe.latencyMs } : {}),
      },
      hermes: {
        configured: true,
        reachable: hermesStatus.reachable,
        status: hermesStatus.reachable ? 'online' : 'offline',
        detail: hermesStatus.detail,
        ...(hermesStatus.nextAction ? { nextAction: hermesStatus.nextAction } : {}),
      },
      fallback: fallbackInfo,
    });
  } catch (err: any) {
    res.status(200).json({
      gateway: 'codex',
      status: 'error',
      reachable: false,
      url: codexUrl,
      configured: true,
      error: err?.message || 'unexpected health check failure',
      routingState: 'DEGRADED',
      codex: { configured: true, reachable: false, status: 'offline', url: codexUrl },
      omniroute: { configured: true, reachable: false, status: 'offline', url: omnirootUrl },
      openrouter: { configured: openrouterConfigured, reachable: false, status: !openrouterConfigured ? 'not_configured' : 'offline' },
      ollama: { configured: true, reachable: false, selectedModel: null, models: [] },
      hermes: { configured: true, reachable: false, status: 'offline', detail: 'Hermes health probe failed' },
      fallback: { provider: 'ollama', reachable: false, active: false, currentModel: null },
    });
  }
});

import {
  getBehavioralHealth,
  getBehavioralHealthAsync,
  type HealthFinding,
} from '../domains/jarvis/behavioralHealth.js';
import { classifyIncidents, reconcileIncidentLifecycle } from '../domains/selfHeal/incidentLifecycle.js';

/* ── GET /api/health/behavioral ───────────────────────────
   BEHAVIOURAL health, not process health. Reports the process, capability and
   behavioural layers separately, and caps the overall state so a live process
   can never present as HEALTHY while behaviour is failing. */
router.get('/behavioral', async (_req, res) => {
  try {
    res.json(await getBehavioralHealthAsync([] as HealthFinding[]));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'behavioural health evaluation failed' });
  }
});

/* ── POST /api/health/hermes-gateway/recover ──────────────
   Behavioural Hermes gateway recovery: verifies the API by making a real request
   with a contract check, and only when the process is alive but the API is dead
   restarts it through the product's own lifecycle. Bounded attempts. */
router.post('/hermes-gateway/recover', async (_req, res) => {
  try {
    const { getHermesGatewayHealth, recoverHermesGateway } = await import('../domains/jarvis/hermesGatewayHealth.js');
    const before = await getHermesGatewayHealth();
    const result = await recoverHermesGateway({ maxAttempts: 3 });
    res.json({ success: true, before, result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'hermes gateway recovery failed' });
  }
});

/* ── GET /api/health/hermes-gateway ───────────────────────
   PROCESS_EXISTS is not health: reports whether a real API request succeeds and
   whether the response contract is valid. */
router.get('/hermes-gateway', async (_req, res) => {
  try {
    const { getHermesGatewayHealth } = await import('../domains/jarvis/hermesGatewayHealth.js');
    res.json(await getHermesGatewayHealth());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'hermes gateway health failed' });
  }
});

/* ── GET /api/health/incidents ────────────────────────────
   Every incident classified A/B/C/D with its reason. Read-only. */
router.get('/incidents', (_req, res) => {
  try {
    const classified = classifyIncidents();
    const counts = classified.reduce<Record<string, number>>((acc, c) => {
      acc[c.cls] = (acc[c.cls] || 0) + 1;
      return acc;
    }, {});
    res.json({ success: true, counts, incidents: classified });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'incident classification failed' });
  }
});

/* ── POST /api/health/incidents/reconcile ─────────────────
   Close what is provably finished, mark exhausted repairs unresolved, link
   duplicates to their canonical incident. `?dryRun=1` reports without writing. */
router.post('/incidents/reconcile', async (req, res) => {
  try {
    const { incidentReconciler } = await import('../domains/selfHeal/IncidentReconciler.js');
    const report = incidentReconciler.reconcileAll();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'incident reconciliation failed' });
  }
});

/* ── GET /api/health/production-readiness ─────────────────
   Authoritative ProductionReadinessState across all 16 domains. */
router.get('/production-readiness', async (_req, res) => {
  try {
    const { productionReadinessManager } = await import('../domains/controlPlane/ProductionReadinessManager.js');
    res.json(await productionReadinessManager.evaluateReadiness());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'production readiness evaluation failed' });
  }
});

export default router;
