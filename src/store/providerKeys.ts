import { apiFetch, apiUrl } from '../api/client';

/**
 * LocalStorage-backed API key store for Agentic OS.
 * Keys are stored in localStorage under 'agenticos:provider-keys'.
 * This is intentionally simple — no encryption, no cloud sync.
 * Production apps should use proper secret management.
 */

const STORAGE_KEY = 'agenticos:provider-keys';

export interface ProviderKeyEntry {
  id: string;
  keyValue: string;
  label: string;
  updatedAt: string;
}

export function loadProviderKeys(): Record<string, ProviderKeyEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveProviderKey(id: string, keyValue: string, label: string): ProviderKeyEntry {
  const keys = loadProviderKeys();
  const entry: ProviderKeyEntry = { id, keyValue, label, updatedAt: new Date().toISOString() };
  keys[id] = entry;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  return entry;
}

export function removeProviderKey(id: string): void {
  const keys = loadProviderKeys();
  delete keys[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function providerKeyIsSet(id: string): boolean {
  const keys = loadProviderKeys();
  return !!keys[id] && keys[id].keyValue.length > 0;
}

/**
 * Get a masked version of the key showing only last N chars.
 * Returns "• • • • • • • • X1y2" format.
 */
export function getMaskedKey(id: string): string | null {
  const keys = loadProviderKeys();
  const entry = keys[id];
  if (!entry || !entry.keyValue) return null;
  const key = entry.keyValue;
  if (key.length <= 8) return '•'.repeat(key.length);
  const lastFour = key.slice(-4);
  const masked = '• '.repeat(8).trim();
  return `${masked}${lastFour}`;
}

/**
 * Get the raw key value for a provider (use sparingly, for API calls).
 */
export function getRawKey(id: string): string | null {
  const keys = loadProviderKeys();
  const entry = keys[id];
  return entry?.keyValue || null;
}

/**
 * Check a provider key by making a ping request to the server.
 * Returns true if server reports key is accepted, false otherwise.
 */
export async function testProviderKey(providerId: string): Promise<{
  reachable: boolean;
  latencyMs: number;
  errorMessage?: string;
}> {
  try {
    const start = performance.now();
    const res = await apiFetch(`/api/providers/${providerId}/test`, {
      method: 'POST',
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return { reachable: false, latencyMs, errorMessage: `Server returned ${res.status}` };
    }
    const data = await res.json();
    return {
      reachable: data.reachable,
      latencyMs: data.latencyMs || latencyMs,
      errorMessage: data.errorMessage,
    };
  } catch (err: any) {
    return { reachable: false, latencyMs: 0, errorMessage: err.message || 'Connection failed' };
  }
}

