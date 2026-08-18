/**
 * backend.ts — loopback HTTP client for the Agentic OS backend.
 *
 * Safety rules:
 *   - default base URL http://127.0.0.1:4000 (configurable via
 *     AGENTICOS_MCP_BASE_URL)
 *   - only loopback destinations accepted (127.0.0.1, localhost, ::1);
 *     anything else is rejected before any network I/O
 *   - bounded request timeout (AbortSignal.timeout)
 *   - bounded response size
 *   - no direct SQLite access — this client is the ONLY way the bridge
 *     touches Agentic OS state
 */

import { redactJson, sanitizeError } from './redact.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:4000';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KiB

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface BackendClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export function resolveBaseUrl(raw?: string): string {
  const candidate = (raw || process.env.AGENTICOS_MCP_BASE_URL || DEFAULT_BASE_URL).trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid backend base URL: ${candidate}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Non-HTTP backend base URL rejected: ${candidate}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOOPBACK_HOSTNAMES.has(host)) {
    throw new Error(`Non-loopback backend URL rejected: ${candidate}`);
  }
  return candidate.replace(/\/+$/, '');
}

export interface BackendResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

export class BackendClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(opts: BackendClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async rawFetch(path: string, init: RequestInit = {}): Promise<BackendResponse> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      const bounded = text.slice(0, MAX_RESPONSE_BYTES);
      let data: unknown = null;
      try {
        data = bounded ? JSON.parse(bounded) : null;
      } catch {
        data = { raw: bounded.slice(0, 2000) };
      }
      if (!res.ok) {
        const message = (data as any)?.error?.message || (data as any)?.error || `HTTP ${res.status}`;
        throw new Error(`Backend error (${res.status}): ${String(message).slice(0, 300)}`);
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Backend request timed out after ${this.timeoutMs}ms: ${path}`);
      }
      throw new Error(`Backend unreachable (${sanitizeError(err)}): ${path}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async get(path: string): Promise<unknown> {
    const res = await this.rawFetch(path, { method: 'GET' });
    return redactJson(res.data);
  }

  async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.rawFetch(path, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
    return redactJson(res.data);
  }
}
