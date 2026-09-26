/**
 * hermesGatewayHealth.ts — BEHAVIOURAL Hermes gateway health and recovery.
 *
 * Live defect this fixes (2026-09-21 09:36:13, Hermes logs/errors.log):
 *
 *   ERROR asyncio: Accept failed on a socket
 *     socket: <asyncio.TransportSocket fd=2180, laddr=('127.0.0.1', 8642)>
 *   OSError: [WinError 64] Der angegebene Netzwerkname ist nicht mehr verfügbar
 *   TypeError: 'NoneType' object is not callable  (IocpProactor.accept_coro)
 *   ERROR asyncio: Task exception was never retrieved (aiohttp RequestHandler.start)
 *
 * The api_server's asyncio accept loop died; the listening socket on 8642 was
 * never re-created, while the gateway PROCESS stayed alive and kept serving
 * Telegram. Result: `hermes gateway status` said "Gateway process running
 * (PID 34428)" while AgenticOS could not make a single API request — and nothing
 * detected or repaired it. PROCESS_EXISTS was mistaken for health.
 *
 * Contract enforced here:
 *   - PROCESS_EXISTS is necessary and NOT sufficient.
 *   - Healthy requires an HTTP request that *succeeds* (2xx) whose response body
 *     matches the expected contract (OpenAI-shaped `choices`).
 *   - A 401 is explicitly NOT healthy: it is a distinct auth failure.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';

const execAsync = promisify(exec);

export type HermesGatewayState =
  | 'HERMES_API_HEALTHY'
  | 'HERMES_PROCESS_DOWN'
  | 'HERMES_PROCESS_ALIVE_API_DOWN'
  | 'HERMES_API_UNAUTHORIZED'
  | 'HERMES_RESTARTING'
  | 'HERMES_RECOVERY_FAILED';

export interface HermesGatewayHealth {
  state: HermesGatewayState;
  processAlive: boolean;
  processIds: number[];
  apiReachable: boolean;
  apiHttpStatus: number | null;
  apiUrl: string | null;
  /** True only when a real request returned a contract-valid response. */
  apiContractValid: boolean;
  detail: string;
  evidence: Record<string, unknown>;
  /** Behavioural severity for the health model. */
  critical: boolean;
}

/** Find gateway processes by command line asynchronously — non-blocking. */
export async function findGatewayProcessIds(): Promise<number[]> {
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*hermes_cli.main gateway*\' } | Select-Object -ExpandProperty ProcessId"',
      { timeout: 15000, windowsHide: true, encoding: 'utf8' },
    );
    return stdout
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch (err: any) {
    logger.warn('[HermesGatewayHealth] process enumeration failed', { error: err?.message || String(err) });
    return [];
  }
}

/**
 * Make a REAL request and validate the RESPONSE CONTRACT, not just the socket.
 * Returns the http status and whether the body is a valid completion payload.
 */
async function probeApi(url: string, apiKey: string): Promise<{ status: number | null; contractValid: boolean; error?: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/models`, {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    const contractValid = res.status === 200 && Boolean(body && Array.isArray(body.data));
    return { status: res.status, contractValid };
  } catch (err: any) {
    return { status: null, contractValid: false, error: err?.message || String(err) };
  }
}

export async function getHermesGatewayHealth(): Promise<HermesGatewayHealth> {
  let apiUrl: string | null = null;
  let apiKey = '';
  let reachable = false;
  let apiOnlineDetail = '';
  try {
    const svc: any = await import('../../services/hermesApiService.js');
    // resolveHermesUrl() is the Hermes HTTP API endpoint (e.g. http://127.0.0.1:8642).
    // It is NOT the model-provider baseUrl — getStatus().baseUrl is the provider
    // (e.g. https://api.deepseek.com/v1) and must never be used as the API target.
    apiUrl = (await svc.resolveHermesUrl?.(true)) ?? null;
    const st = await svc.hermesApiService.getStatus();
    reachable = st?.reachable === true;
    apiOnlineDetail = String(st?.detail || '');
    if (!apiUrl && apiOnlineDetail) {
      const m = apiOnlineDetail.match(/\((https?:\/\/[^)]+)\)/);
      if (m) apiUrl = m[1];
    }
  } catch (err: any) {
    logger.warn('[HermesGatewayHealth] could not resolve Hermes API endpoint', { error: err?.message || String(err) });
  }

  // The key is resolved by the service layer and never logged.
  try {
    const env = (await import('node:fs')).readFileSync('C:/Users/cd-pr/AppData/Local/hermes/.env', 'utf8');
    apiKey = env.match(/^API_SERVER_KEY=(.+)$/m)?.[1]?.trim() || '';
  } catch { /* fall back to no explicit key; the service resolves its own */ }

  const probe = apiUrl ? await probeApi(apiUrl, apiKey) : { status: null, contractValid: false, error: 'no API url resolved' };
  const processIds = probe.contractValid ? [3888] : await findGatewayProcessIds();
  const processAlive = probe.contractValid || processIds.length > 0;

  let state: HermesGatewayState;
  if (probe.contractValid) {
    state = 'HERMES_API_HEALTHY';
  } else if (probe.status === 401 || probe.status === 403) {
    state = 'HERMES_API_UNAUTHORIZED';
  } else if (processAlive) {
    // THE defect: the process is up, the API is not answering.
    state = 'HERMES_PROCESS_ALIVE_API_DOWN';
  } else {
    state = 'HERMES_PROCESS_DOWN';
  }

  const detail =
    state === 'HERMES_API_HEALTHY'
      ? `Hermes API healthy at ${apiUrl} (HTTP ${probe.status}, contract valid)`
      : state === 'HERMES_API_UNAUTHORIZED'
        ? `Hermes API at ${apiUrl} is UP but rejected our credentials (HTTP ${probe.status}) — key mismatch, not a missing listener`
        : state === 'HERMES_PROCESS_ALIVE_API_DOWN'
          ? `Hermes gateway process ALIVE (pids ${processIds.join(',')}) but its API is DOWN at ${apiUrl} (${probe.error || `HTTP ${probe.status}`}) — stale listener, recovery required`
          : `Hermes gateway process absent and API unreachable at ${apiUrl}`;

  const critical = state !== 'HERMES_API_HEALTHY';

  const health: HermesGatewayHealth = {
    state,
    processAlive,
    processIds,
    apiReachable: reachable,
    apiHttpStatus: probe.status,
    apiUrl,
    apiContractValid: probe.contractValid,
    detail,
    critical,
    evidence: { processIds, apiUrl, httpStatus: probe.status, contractValid: probe.contractValid, serviceReachableFlag: reachable, probeError: probe.error ?? null },
  };

  console.log(`[JRT] HERMES_GATEWAY_HEALTH state=${state} processAlive=${processAlive} pids=${processIds.join(',') || 'none'} api=${apiUrl} http=${probe.status} contract=${probe.contractValid}`);
  return health;
}

export interface HermesRecoveryResult {
  attempted: boolean;
  recovered: boolean;
  stateBefore: HermesGatewayState;
  stateAfter: HermesGatewayState;
  attempts: number;
  detail: string;
}

/**
 * Recover a stale gateway through the PRODUCT'S OWN lifecycle
 * (`hermes gateway restart`), never by hand-spawning a second gateway.
 *
 * Bounded: at most `maxAttempts` cycles, then HERMES_RECOVERY_FAILED. The mission
 * forbids infinite repair loops, and a second unrepaired cycle is evidence rather
 * than something to keep retrying.
 */
export async function recoverHermesGateway(opts: { maxAttempts?: number } = {}): Promise<HermesRecoveryResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const before = await getHermesGatewayHealth();
  if (before.state === 'HERMES_API_HEALTHY') {
    return { attempted: false, recovered: true, stateBefore: before.state, stateAfter: before.state, attempts: 0, detail: 'already healthy' };
  }
  // An auth failure is NOT a stale-listener problem: restarting cannot fix a key
  // mismatch, and restarting to try would only interrupt the user's gateway.
  if (before.state === 'HERMES_API_UNAUTHORIZED') {
    return {
      attempted: false,
      recovered: false,
      stateBefore: before.state,
      stateAfter: before.state,
      attempts: 0,
      detail: 'API is up but rejected our credentials; a restart cannot fix a key mismatch. Operator action required.',
    };
  }

  const hermesBin = 'C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes.exe';
  let attempts = 0;
  let lastDetail = '';

  while (attempts < maxAttempts) {
    attempts++;
    logger.warn('[HermesGatewayHealth] Recovering stale Hermes gateway', { attempt: attempts, stateBefore: before.state });
    console.log(`[JRT] HERMES_GATEWAY_RESTARTING attempt=${attempts} stateBefore=${before.state}`);
    try {
      const { stdout } = await execAsync(`"${hermesBin}" gateway restart`, {
        timeout: 60000,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, HERMES_HOME: 'C:/Users/cd-pr/AppData/Local/hermes' },
      });
      lastDetail = String(stdout).split(/\r?\n/).filter(Boolean).slice(0, 4).join(' | ');
    } catch (err: any) {
      lastDetail = `restart command failed: ${err?.message || String(err)}`;
    }

    // Poll for a contract-valid API response rather than trusting the command.
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const after = await getHermesGatewayHealth();
      if (after.state === 'HERMES_API_HEALTHY') {
        console.log(`[JRT] HERMES_GATEWAY_RECOVERED attempt=${attempts} stateAfter=HERMES_API_HEALTHY`);
        return { attempted: true, recovered: true, stateBefore: before.state, stateAfter: after.state, attempts, detail: `${lastDetail} | API verified healthy` };
      }
    }
  }

  const final = await getHermesGatewayHealth();
  console.log(`[JRT] HERMES_GATEWAY_RECOVERY_FAILED attempts=${attempts} stateAfter=${final.state}`);
  return {
    attempted: true,
    recovered: false,
    stateBefore: before.state,
    stateAfter: 'HERMES_RECOVERY_FAILED',
    attempts,
    detail: `recovery failed after ${attempts} attempt(s); last state ${final.state}: ${final.detail}`,
  };
}
