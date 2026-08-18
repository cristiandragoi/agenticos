/**
 * secretStore.ts
 *
 * Authoritative Canonical Secret Storage interface for Agentic OS.
 *
 * Storage hierarchy:
 * 1. OS-backed Credential Manager (keytar / wincred on Windows)
 * 2. Encrypted local SQLite storage table `system_secrets` (fallback)
 * 3. Environment variables (development fallback only)
 *
 * NEVER exposes plain secrets through diagnostics, logs, or responses.
 */

import * as keytar from 'keytar';
import crypto from 'crypto';
import os from 'os';
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

const SERVICE_NAME = 'AgenticOS.Secrets';

export interface ISecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  listConfigured(): Promise<string[]>;
}

// ── Normalize provider/secret keys ──────────────────────────────────────────
const KEY_ALIASES: Record<string, string[]> = {
  openrouter: ['openrouter', 'OPENROUTER_API_KEY', 'omniroot', 'OMNIROOT_API_KEY'],
  deepseek: ['deepseek', 'DEEPSEEK_API_KEY', 'DeepSeek'],
  openai: ['openai', 'OPENAI_API_KEY'],
  anthropic: ['anthropic', 'ANTHROPIC_API_KEY', 'ninerouter', 'NINEROUTER_API_KEY'],
  google: ['google', 'GOOGLE_API_KEY', 'gemini', 'GEMINI_API_KEY'],
  groq: ['groq', 'GROQ_API_KEY'],
  perplexity: ['perplexity', 'PERPLEXITY_API_KEY'],
  together: ['together', 'TOGETHER_API_KEY'],
  xai: ['xai', 'XAI_API_KEY'],
  qwen: ['qwen', 'QWEN_API_KEY'],
  kimi: ['kimi', 'KIMI_API_KEY'],
  minimax: ['minimax', 'MINIMAX_API_KEY'],
  fugu: ['fugu', 'FUGU_API_KEY'],
  fusion: ['fusion', 'FUSION_API_KEY'],
  apify: ['apify', 'APIFY_API_KEY'],
  firecrawl: ['firecrawl', 'FIRECRAWL_API_KEY'],
  brave: ['brave', 'BRAVE_API_KEY'],
  deepgram: ['deepgram', 'DEEPGRAM_API_KEY'],
  resend: ['resend', 'RESEND_API_KEY'],
};

function normalizeKey(key: string): string {
  const lower = key.toLowerCase().replace(/_api_key$/, '').replace(/_key$/, '');
  for (const [canonical, aliases] of Object.entries(KEY_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === lower || a.toLowerCase() === key.toLowerCase())) {
      return canonical;
    }
  }
  return key;
}

function getEnvFallback(key: string): string | null {
  const norm = normalizeKey(key);
  const aliases = KEY_ALIASES[norm] || [key];
  for (const alias of aliases) {
    if (process.env[alias]) return process.env[alias]!;
    const envUpper = alias.toUpperCase();
    if (process.env[envUpper]) return process.env[envUpper]!;
    if (process.env[`${envUpper}_API_KEY`]) return process.env[`${envUpper}_API_KEY`]!;
  }
  return null;
}

// ── Machine-derived encryption key for fallback SQLite store ────────────────
function getMachineKey(): Buffer {
  const seed = `${os.hostname()}-${os.userInfo().username}-AgenticOS-LocalMasterKey-Salt-2026`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMachineKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getMachineKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

// Ensure the fallback system_secrets table exists
try {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS system_secrets (
      key TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
} catch (e) {
  // Table creation best-effort
}

export class CanonicalSecretStore implements ISecretStore {
  private static instance: CanonicalSecretStore;

  public static getInstance(): CanonicalSecretStore {
    if (!CanonicalSecretStore.instance) {
      CanonicalSecretStore.instance = new CanonicalSecretStore();
    }
    return CanonicalSecretStore.instance;
  }

  public async get(key: string): Promise<string | null> {
    const norm = normalizeKey(key);

    // 1. Try OS Credential Manager (keytar)
    try {
      const val = await keytar.getPassword(SERVICE_NAME, norm);
      if (val && val.trim().length > 0) return val.trim();
    } catch (err) {
      logger.debug?.(`[SecretStore] keytar lookup failed for ${norm}, trying fallback store.`);
    }

    // 2. Try encrypted SQLite store
    try {
      const row = rawDb.prepare(`SELECT encrypted_value FROM system_secrets WHERE key = ?`).get(norm) as any;
      if (row?.encrypted_value) {
        const decrypted = decryptSecret(row.encrypted_value);
        if (decrypted) return decrypted;
      }
    } catch (err) {
      logger.debug?.(`[SecretStore] sqlite lookup failed for ${norm}`);
    }

    // 3. Fallback to environment variables
    const envVal = getEnvFallback(key);
    if (envVal && envVal.trim().length > 0) return envVal.trim();

    return null;
  }

  public async set(key: string, value: string): Promise<void> {
    const norm = normalizeKey(key);
    let osSaved = false;

    // 1. Save to OS Credential Manager
    try {
      await keytar.setPassword(SERVICE_NAME, norm, value);
      osSaved = true;
    } catch (err) {
      logger.warn(`[SecretStore] keytar setPassword failed for ${norm}, falling back to encrypted DB.`, { error: String(err) });
    }

    // 2. Save encrypted backup in system_secrets
    try {
      const encrypted = encryptSecret(value);
      const now = new Date().toISOString();
      rawDb.prepare(`
        INSERT INTO system_secrets (key, encrypted_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = ?
      `).run(norm, encrypted, now, encrypted, now);
    } catch (err: any) {
      if (!osSaved) {
        throw new Error(`Failed to store secret in both OS vault and encrypted storage: ${err.message}`);
      }
    }
  }

  public async delete(key: string): Promise<void> {
    const norm = normalizeKey(key);
    try {
      await keytar.deletePassword(SERVICE_NAME, norm);
    } catch {}

    try {
      rawDb.prepare(`DELETE FROM system_secrets WHERE key = ?`).run(norm);
    } catch {}
  }

  public async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return Boolean(val && val.length > 0);
  }

  public async listConfigured(): Promise<string[]> {
    const configured = new Set<string>();

    // List from SQLite
    try {
      const rows = rawDb.prepare(`SELECT key FROM system_secrets`).all() as any[];
      for (const r of rows) {
        if (r.key) configured.add(r.key);
      }
    } catch {}

    // Check standard keys in keytar & env
    for (const canonical of Object.keys(KEY_ALIASES)) {
      if (!configured.has(canonical)) {
        const val = await this.get(canonical);
        if (val) configured.add(canonical);
      }
    }

    return Array.from(configured);
  }
}

export const secretStore = CanonicalSecretStore.getInstance();

// ── Central Secret Redaction Helper ─────────────────────────────────────────
export function redactSecrets(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\b/g, '[REDACTED_JWT]')
    .replace(/([A-Za-z0-9_\-]*(?:api[_-]?key|secret|password|auth[_-]?token)\s*[:=]\s*)([^\s'",]+)/gi, '$1[REDACTED]');
}

export function sanitizeDiagnostics(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactSecrets(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDiagnostics);

  const sanitized: Record<string, any> = {};
  const secretKeyRegex = /(?:key|secret|token|password|auth|credential|jwt|bearer)/i;

  for (const [k, v] of Object.entries(obj)) {
    if (secretKeyRegex.test(k) && typeof v === 'string' && v.length > 0) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = sanitizeDiagnostics(v);
    }
  }
  return sanitized;
}
