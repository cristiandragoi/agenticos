/**
 * browserPreferencesStore.ts — PERSISTED per-domain cookie-consent preference.
 *
 * Reuses the existing state architecture (`JsonStore` over `server/data/`, the
 * same class `db.ts` uses) rather than inventing a second store. This is NOT
 * secret data, so it does not belong in the credential vault.
 *
 * Model:   domain → cookieConsentPreference (accept_all | reject_optional | ask)
 *
 * Rules enforced here (per the stability mission):
 *   - an explicit CURRENT-turn instruction always overrides the stored value
 *     (that decision lives in `authorizeConsentChoice`; this module only stores)
 *   - a stored preference applies only to its own domain / site FAMILY
 *   - no stored preference → `ask` (never inferred from unrelated behaviour)
 *   - the stored value is only rewritten when the user explicitly asks to change
 *     or save it ("Always accept all on YouTube.")
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { JsonStore } from '../store.js';
import { logger } from '../../utils/logger.js';
import {
  consentPreferences,
  registrableDomainOf,
  type ConsentPreference,
} from './browserActionContract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../../data');

/** Persisted record. `id` is the registrable domain (JsonStore requires it). */
export interface BrowserPreferenceRecord {
  id: string;
  domain: string;
  preference: ConsentPreference;
  /** Sibling domains that legitimately share this preference. */
  aliases: string[];
  source: 'operator';
  updatedAt: number;
}

const store = new JsonStore<BrowserPreferenceRecord>(
  path.join(dataDir, 'browserPreferences.json'),
);

/**
 * Explicit site families. Deliberately small and hard-coded: a consent
 * preference must never leak to unrelated domains, so sharing is opt-in per
 * family rather than derived from any broad TLD heuristic.
 */
const SITE_FAMILIES: Array<{ id: string; domains: string[] }> = [
  {
    id: 'google-youtube',
    domains: ['google.com', 'youtube.com', 'consent.youtube.com', 'accounts.google.com'],
  },
];

export function familyForDomain(domain: string): { id: string; domains: string[] } | null {
  const key = registrableDomainOf(domain);
  for (const family of SITE_FAMILIES) {
    if (family.domains.some((d) => key === d || key.endsWith(`.${d}`))) return family;
  }
  return null;
}

/** Sibling domains (excluding the given one) that may share the preference. */
export function familyAliasesFor(domain: string): string[] {
  const key = registrableDomainOf(domain);
  const family = familyForDomain(domain);
  if (!family) return [];
  return family.domains.filter((d) => registrableDomainOf(d) !== key);
}

export class BrowserPreferencesStore {
  private hydrated = false;

  /**
   * Load persisted preferences into the in-memory registry. Idempotent; safe to
   * call on every turn. If the file is missing or unreadable we simply start
   * with no preferences (= ask), never with an assumed one.
   */
  public hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const records = store.list();
      for (const rec of records) {
        if (rec?.domain && rec?.preference) {
          consentPreferences.set(rec.domain, rec.preference, {
            aliases: rec.aliases ?? [],
            source: 'operator',
          });
        }
      }
      logger.info('[BrowserPreferences] hydrated', { count: records.length });
    } catch (err) {
      logger.warn('[BrowserPreferences] hydrate failed — starting with no preferences', {
        error: String(err),
      });
    }
  }

  /** Persist a preference for a domain, sharing it across its site family. */
  public setPreference(domain: string, preference: ConsentPreference): BrowserPreferenceRecord {
    this.hydrate();
    const key = registrableDomainOf(domain);
    const aliases = familyAliasesFor(key);
    const record: BrowserPreferenceRecord = {
      id: key,
      domain: key,
      preference,
      aliases,
      source: 'operator',
      updatedAt: Date.now(),
    };
    store.upsert(record);
    consentPreferences.set(key, preference, { aliases, source: 'operator' });
    logger.info('[BrowserPreferences] saved', { domain: key, preference, aliases });
    return record;
  }

  /** Remove a stored preference for a domain (back to "ask"). */
  public forget(domain: string): boolean {
    this.hydrate();
    const key = registrableDomainOf(domain);
    const existing = store.list().find((r) => r.domain === key);
    if (!existing) return false;
    // JsonStore has no delete, so persist an explicit "ask" tombstone.
    store.upsert({ ...existing, preference: 'ask', updatedAt: Date.now() });
    consentPreferences.set(key, 'ask', { aliases: familyAliasesFor(key), source: 'operator' });
    logger.info('[BrowserPreferences] forgotten (reset to ask)', { domain: key });
    return true;
  }

  public getPreference(domain: string): ConsentPreference | null {
    this.hydrate();
    const rule = consentPreferences.get(domain);
    return rule ? rule.preference : null;
  }

  public all(): BrowserPreferenceRecord[] {
    this.hydrate();
    try {
      return store.list();
    } catch {
      return [];
    }
  }
}

export const browserPreferences = new BrowserPreferencesStore();
export const browserPreferencesStore = browserPreferences;

// Hydrate at module load so a restarted process has its preferences available
// before the first browser turn.
browserPreferences.hydrate();

// ─────────────────────────────────────────────────────────────────────────────
// Explicit preference commands
// ─────────────────────────────────────────────────────────────────────────────

export interface PreferenceCommand {
  action: 'set' | 'forget';
  domain: string;
  preference?: ConsentPreference;
}

/** Map a spoken site name to a domain. Only named families, no guessing. */
function domainFromUtterance(text: string): string | null {
  const t = text.toLowerCase();
  if (/\byoutube\b/.test(t)) return 'youtube.com';
  if (/\bgoogle\b/.test(t)) return 'google.com';
  return null;
}

/**
 * Parse an EXPLICIT preference command. Returns null for anything that is not a
 * clear instruction to save/change the preference — a one-off "accept all this
 * time" must NOT be persisted.
 */
export function parsePreferenceCommand(utterance: string): PreferenceCommand | null {
  const text = (utterance || '').trim();
  if (!text) return null;

  const domain = domainFromUtterance(text);
  if (!domain) return null;

  // Forget / reset
  if (/\b(forget|clear|reset|remove)\b/i.test(text) && /\b(cookie|consent|preference)\b/i.test(text)) {
    return { action: 'forget', domain };
  }

  // "Ask me every time on Google."
  if (/\b(ask me|always ask|every time)\b/i.test(text)) {
    return { action: 'set', domain, preference: 'ask' };
  }

  // Permanence markers are required before we overwrite a stored preference;
  // "accept all this time" is a one-off and is handled by the turn itself.
  const permanent = /\b(always|from now on|permanently|by default)\b/i.test(text);
  if (!permanent) return null;
  if (/\bthis time\b|\bjust this once\b|\bonce\b/i.test(text)) return null;

  if (/\b(accept|allow)\b/i.test(text) && /\ball\b/i.test(text)) {
    return { action: 'set', domain, preference: 'accept_all' };
  }
  if (/\b(reject|decline|refuse)\b/i.test(text) && /\b(optional|all|non-essential)\b/i.test(text)) {
    return { action: 'set', domain, preference: 'reject_optional' };
  }
  return null;
}
