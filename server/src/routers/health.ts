import { Router } from 'express';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { getBuildIdentity } from '../services/buildIdentity.js';

const router = Router();

router.get('/', (_req, res) => {
  const build = getBuildIdentity();
  res.json({
    status: 'healthy',
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

router.post('/restart', (_req, res) => {
  res.json({ status: 'restarting' });
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
export function setHealthFetchForTesting(fn: typeof fetch): void {
  healthFetch = fn;
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

function describeProbeFailure(p: ProbeResult): string {
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

  const openrouterUrl = process.env.OPENROUTER_BASE_URL
    || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : '');
  const omnirootUrl = process.env.OMNIROUTE_BASE_URL || process.env.OMNIROOT_BASE_URL || '';
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const openrouterConfigured = openrouterUrl.length > 0;
  const omnirootConfigured = omnirootUrl.length > 0;
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || process.env.DEFAULT_LLM_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b';

  const isOllamaPrimary = defaultProvider === 'ollama' || (providerOrder.length > 0 && providerOrder[0] === 'ollama');

  try {
    let gateway = 'OpenRouter';
    let status: 'online' | 'degraded' | 'offline' | 'error' = 'offline';
    let reachable = false;
    let url = openrouterUrl;
    let configured = openrouterConfigured;
    let latencyMs: number | undefined;
    let models: number | undefined;
    let error: string | undefined;
    let fallbackReachable = false;
    let omnirootReachable = false;
    let fallbackInfo = {
      provider: 'ollama',
      reachable: false,
      active: false,
      currentModel: null as string | null
    };

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
        error = 'no primary gateway configured';
      } else {
        const [primary, fallback, omniroot] = await Promise.all([
          probe(`${openrouterUrl.replace(/\/$/, '')}/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
          probe(`${ollamaUrl.replace(/\/$/, '')}/api/tags`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS),
          omnirootConfigured
            ? probe(`${omnirootUrl.replace(/\/$/, '')}/models`, GATEWAY_HEALTH_PROBE_TIMEOUT_MS)
            : Promise.resolve(null)
        ]);
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

        fallbackInfo = {
          provider: 'ollama',
          reachable: fallbackReachable,
          active: status === 'degraded',
          currentModel: status === 'degraded' ? fallbackModel : null
        };
      }
    }

    res.status(200).json({
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
      fallback: fallbackInfo
    });
  } catch (err: any) {
    res.status(200).json({
      gateway: isOllamaPrimary ? 'ollama' : 'OpenRouter',
      status: 'error',
      reachable: false,
      url: isOllamaPrimary ? ollamaUrl : openrouterUrl,
      configured: isOllamaPrimary ? true : openrouterConfigured,
      error: err?.message || 'unexpected health check failure',
      omniroot: {
        configured: omnirootConfigured,
        reachable: false
      },
      fallback: {
        provider: 'ollama',
        reachable: false,
        active: false,
        currentModel: null
      }
    });
  }
});

export default router;
