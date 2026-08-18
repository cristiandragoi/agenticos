import { Router } from 'express';
import os from 'node:os';
import { execSync } from 'node:child_process';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '9.0.0',
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
  const openrouterUrl = process.env.OPENROUTER_BASE_URL
    || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : '');
  const omnirootUrl = process.env.OMNIROUTE_BASE_URL || '';
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const configured = openrouterUrl.length > 0;
  const omnirootConfigured = omnirootUrl.length > 0;
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';

  try {
    let status: 'online' | 'degraded' | 'offline' | 'error' = 'offline';
    let reachable = false;
    let latencyMs: number | undefined;
    let models: number | undefined;
    let error: string | undefined;
    let fallbackReachable = false;
    let omnirootReachable = false;

    if (!configured) {
      status = 'error';
      error = 'no primary gateway configured';
    } else {
      // Probe the effective primary (OpenRouter), the Ollama fallback, and
      // the legacy OmniRoot relay ALL in parallel. OmniRoot is optional
      // metadata only — it never determines global health. Parallel probes
      // keep worst-case latency at one timeout interval, so the UI health
      // poll never hangs, and fallback.reachable is always truthful.
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
    }

    // HTTP 200 for every valid health response — including degraded/offline —
    // so the UI poll keeps working and can read the honest status.
    res.status(200).json({
      gateway: 'OpenRouter',
      status,
      reachable,
      url: openrouterUrl,
      configured,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(models !== undefined ? { models } : {}),
      ...(error ? { error } : {}),
      omniroot: {
        configured: omnirootConfigured,
        reachable: omnirootReachable
      },
      fallback: {
        provider: 'ollama',
        reachable: fallbackReachable,
        active: status === 'degraded',
        currentModel: status === 'degraded' ? fallbackModel : null
      }
    });
  } catch (err: any) {
    // Unexpected failure inside the endpoint itself: report it honestly
    // instead of crashing the poll. Never leak secrets — exception text only.
    res.status(200).json({
      gateway: 'OpenRouter',
      status: 'error',
      reachable: false,
      url: openrouterUrl,
      configured,
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
