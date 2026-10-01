/**
 * prerequisiteService.ts — Reusable execution-prerequisite model (PHASE B).
 *
 * A mission that needs an external authenticated service must declare its
 * dependencies and have them CHECKED before anything is dispatched. Creating
 * an internal task is NOT proof of external execution.
 *
 * Ground rules:
 *  - `sessionValid` is only true when a REAL verification happened (FreeCash
 *    browser session probe) within the freshness window — never inferred from
 *    internal project state (PHASE H separation).
 *  - The September-11 credential blocker is REVALIDATED against live evidence
 *    on every check; it is never blindly trusted and never blindly cleared.
 *  - No credential values are ever read, logged, or returned.
 */
import fs from 'fs';
import path from 'path';
import { rawDb, resolvedDbPath } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

export type AuthType = 'browser_account' | 'api_key' | 'credentials' | 'none';

export interface PrerequisiteState {
  service: string;
  authRequired: boolean;
  authType: AuthType;
  credentialAvailable: boolean;
  sessionValid: boolean;
  externalConnected: boolean;
  /** Blocker text when unsatisfied (safe for user speech, no secrets). */
  blocker: string | null;
  checkedAt: string;
  /** True only when this check found live external evidence. */
  satisfied: boolean;
}

/** Static declarations of services that gate execution. */
const SERVICE_DEFINITIONS: Record<string, { authRequired: boolean; authType: AuthType; label: string }> = {
  freecash: { authRequired: true, authType: 'browser_account', label: 'FreeCash' },
};

/** Verification state written by the FreeCash executor after a LIVE probe. */
export interface ExternalSessionEvidence {
  service: string;
  authenticated: boolean;
  verifiedAt: string;
  evidencePath?: string;
  detail?: string;
}

const SESSION_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function dataDir(): string {
  return path.dirname(resolvedDbPath);
}

export function sessionEvidencePath(service: string): string {
  return path.join(dataDir(), service, 'session-evidence.json');
}

export function readSessionEvidence(service: string): ExternalSessionEvidence | null {
  try {
    const p = sessionEvidencePath(service);
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as ExternalSessionEvidence;
    if (!parsed || typeof parsed.authenticated !== 'boolean' || !parsed.verifiedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist LIVE verification evidence. Only the executor (which actually saw
 *  the external state) may call this. */
export function writeSessionEvidence(ev: ExternalSessionEvidence): void {
  const p = sessionEvidencePath(ev.service);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ev, null, 2), 'utf-8');
}

export function clearSessionEvidence(service: string): void {
  try {
    const p = sessionEvidencePath(service);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* best effort */ }
}

/** Credential availability WITHOUT ever touching secret values. */
export function hasCredentialConfigured(service: string): boolean {
  try {
    const row = rawDb
      .prepare("SELECT configured FROM provider_credentials WHERE provider_id = ? LIMIT 1")
      .get(service) as { configured: number | null } | undefined;
    if (row?.configured) return true;
    const secret = rawDb
      .prepare("SELECT key FROM system_secrets WHERE key = ? LIMIT 1")
      .get(service) as { key: string } | undefined;
    return Boolean(secret);
  } catch {
    return false;
  }
}

/** Canonical managed-browser profile directory name. The FreeCash executor and
 *  the revenue-operator worker supervisor both create profiles under
 *  `data/browser_profiles/<accountId>`; the legacy `browser-profiles` spelling
 *  is still honoured so an older profile is not reported as missing. */
export const BROWSER_PROFILE_DIRS = ['browser_profiles', 'browser-profiles'] as const;

/** Resolve the on-disk profile directory for an account, preferring the
 *  canonical spelling that the executor actually creates. */
export function browserProfileDir(accountId: string): string {
  for (const dir of BROWSER_PROFILE_DIRS) {
    const candidate = path.join(dataDir(), dir, accountId);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(dataDir(), BROWSER_PROFILE_DIRS[0], accountId);
}

/** True when the browser profile directory for the account exists (the user
 *  may have logged into it) — existence only, contents are never read here. */
export function hasBrowserProfile(accountId: string): boolean {
  try {
    for (const dir of BROWSER_PROFILE_DIRS) {
      const candidate = path.join(dataDir(), dir, accountId);
      if (fs.existsSync(candidate) && fs.readdirSync(candidate).length > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** True when the account's browser profile holds a persisted storage-state
 *  cookie jar — the strongest non-live credential signal available offline.
 *  Cookie VALUES are never read; only the count and names are inspected. */
export function hasPersistedStorageState(accountId: string): boolean {
  try {
    const p = path.join(browserProfileDir(accountId), 'storage_state.json');
    if (!fs.existsSync(p)) return false;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as { cookies?: unknown[] };
    return Array.isArray(parsed?.cookies) && parsed.cookies.length > 0;
  } catch {
    return false;
  }
}

function isEvidenceFresh(ev: ExternalSessionEvidence | null): boolean {
  if (!ev || !ev.authenticated) return false;
  const at = new Date(ev.verifiedAt).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at <= SESSION_EVIDENCE_MAX_AGE_MS;
}

/**
 * Check the prerequisites for a service. `revalidate: true` re-checks LIVE
 * session evidence (the caller may pass an async live probe result); the
 * September-11 style credential blockers are surfaced as prerequisites, not
 * just displayed statistics.
 */
export function checkPrerequisites(service: string): PrerequisiteState {
  const def = SERVICE_DEFINITIONS[service];
  const checkedAt = new Date().toISOString();
  if (!def) {
    return {
      service, authRequired: false, authType: 'none', credentialAvailable: false,
      sessionValid: false, externalConnected: false, blocker: null, checkedAt, satisfied: true,
    };
  }
  const evidence = readSessionEvidence(service);
  const sessionValid = isEvidenceFresh(evidence);
  const credentialAvailable =
    hasCredentialConfigured(service) ||
    hasBrowserProfile(`${service}-main`) ||
    hasPersistedStorageState(`${service}-main`) ||
    Boolean(evidence?.evidencePath);
  const externalConnected = sessionValid || Boolean(evidence);

  let blocker: string | null = null;
  if (def.authRequired && !sessionValid) {
    blocker =
      evidence && !evidence.authenticated
        ? `${def.label} account is not authenticated (last live check ${evidence.verifiedAt}).`
        : evidence && !isEvidenceFresh(evidence)
          ? `${def.label} session evidence is stale (last live check ${evidence.verifiedAt}).`
          : `${def.label} requires an authenticated ${def.authType.replace('_', ' ')} session before work can start. No live session verification exists.`;
  }

  return {
    service,
    authRequired: def.authRequired,
    authType: def.authType,
    credentialAvailable,
    sessionValid,
    externalConnected,
    blocker,
    checkedAt,
    satisfied: !def.authRequired || sessionValid,
  };
}

/**
 * PHASE C — revalidate the stored credential blocker task(s) for a project
 * against LIVE evidence. Never blindly trusted, never blindly cleared:
 * a blocked credential-setup task is only resolved when an authenticated
 * external session has actually been verified.
 */
export async function revalidateCredentialBlockers(
  projectId: string,
  service: string,
): Promise<{ resolvedTaskIds: string[]; stillBlocked: boolean; state: PrerequisiteState }> {
  const state = checkPrerequisites(service);
  const resolvedTaskIds: string[] = [];
  try {
    const { backgroundTaskManager } = await import('../backgroundTasks/manager.js');
    const blocked = backgroundTaskManager
      .listTasks({ projectId, limit: 50 })
      .filter((t) => t.status === 'blocked')
      .filter((t) =>
        /\b(credential|credentials|api key|api keys|login|password|auth token)\b/i.test(t.blocker || '') ||
        /\b(credential|credentials|api key|api keys)\b/i.test(t.title || ''),
      );
    if (state.satisfied) {
      for (const t of blocked) {
        try {
          const verified = backgroundTaskManager.verifyCompletion(t.taskId, {
            resultText: `Credential prerequisite revalidated: live ${service} session verified at ${state.checkedAt}.`,
            readOnly: true,
            verificationNote: `Prerequisite revalidation against live external session evidence (${service}).`,
          });
          if (verified) resolvedTaskIds.push(t.taskId);
        } catch (err: any) {
          logger.warn(`[prerequisites] failed to resolve credential task ${t.taskId}: ${err?.message}`);
        }
      }
    } else if (blocked.length > 0) {
      // Refresh the age/staleness: touch the records so the blocker is
      // presented as revalidated-and-still-open, not as an old ignored note.
      for (const t of blocked) {
        try {
          backgroundTaskManager.appendEvent(
            t.taskId,
            'task.progress',
            `Prerequisite rechecked at ${state.checkedAt}: still no live ${service} session.`,
            {},
          );
        } catch { /* non-critical */ }
      }
    }
    return {
      resolvedTaskIds,
      stillBlocked: !state.satisfied,
      state,
    };
  } catch (err: any) {
    logger.warn(`[prerequisites] revalidation failed: ${err?.message}`);
    return { resolvedTaskIds, stillBlocked: !state.satisfied, state };
  }
}

export function describeService(service: string): string {
  return SERVICE_DEFINITIONS[service]?.label || service;
}
