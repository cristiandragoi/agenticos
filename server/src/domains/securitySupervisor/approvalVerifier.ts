/**
 * domains/securitySupervisor/approvalVerifier.ts
 *
 * In-job fail-closed trusted approval verifier per APPROVAL-DESIGN.md.
 * Holds public key ONLY; validates canonical signatures, Phase 1 runtime identity,
 * and enforces single-use atomic nonce consumption (zero replay).
 */

import { createHash, randomBytes, verify, type KeyObject } from 'node:crypto';
import Database from 'better-sqlite3';

export interface ApprovalBinding {
  goalId: string;
  graphId: string;
  nodeId: string;
  workerId: string;
  operation: string;
  attempt: number;
  tool: string;
  scopeHash: string;
  argumentHash: string;
  previewHash: string;
  runtimeIncarnation?: string;
  bootTimestamp?: number;
}

export interface ApprovalPayload extends ApprovalBinding {
  version: 1;
  issuer: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  secondConfirmation: true;
}

export interface SignedApprovalEnvelope {
  algorithm: 'ES256' | 'EdDSA';
  payload: ApprovalPayload;
  canonicalPayload: string;
  signature: string;
}

export interface RuntimeIdentity {
  incarnation: string;
  bootTimestamp: number;
}

/**
 * Deterministic canonical JSON serialization.
 * Enforces lexicographical key ordering, rejects non-finite numbers,
 * and rejects unicode bidirectional control characters.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    // Rejection of unicode bidirectional override characters (\u202a-\u202e and \u2066-\u2069)
    if (/[\u202a-\u202e\u2066-\u2069]/.test(value)) {
      throw new Error('APPROVAL_INVALID_PAYLOAD: Unicode bidirectional override characters are forbidden');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('APPROVAL_INVALID_PAYLOAD: Numbers must be finite');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new Error('APPROVAL_INVALID_PAYLOAD');
}

export function approvalHash(value: unknown): string {
  try {
    return createHash('sha256').update(canonical(value)).digest('hex');
  } catch (err: any) {
    if (typeof value === 'string' && err.message?.includes('APPROVAL_INVALID_PAYLOAD')) {
      return createHash('sha256').update(JSON.stringify(value)).digest('hex');
    }
    throw err;
  }
}

const baseFields = [
  'goalId',
  'graphId',
  'nodeId',
  'workerId',
  'operation',
  'tool',
  'scopeHash',
  'argumentHash',
  'previewHash',
];

function validateBinding(binding: ApprovalBinding): void {
  const allowedKeys = new Set([...baseFields, 'attempt', 'runtimeIncarnation', 'bootTimestamp']);
  for (const k of Object.keys(binding)) {
    if (!allowedKeys.has(k)) throw new Error('APPROVAL_INVALID_BINDING');
  }

  for (const k of baseFields) {
    const val = (binding as any)[k];
    if (typeof val !== 'string' || !val || val.length > 4096) {
      throw new Error('APPROVAL_INVALID_BINDING');
    }
  }

  if (!Number.isSafeInteger(binding.attempt) || binding.attempt < 1) {
    throw new Error('APPROVAL_INVALID_BINDING');
  }

  if (binding.runtimeIncarnation !== undefined) {
    if (typeof binding.runtimeIncarnation !== 'string' || !binding.runtimeIncarnation) {
      throw new Error('APPROVAL_INVALID_BINDING');
    }
  }

  if (binding.bootTimestamp !== undefined) {
    if (!Number.isSafeInteger(binding.bootTimestamp)) {
      throw new Error('APPROVAL_INVALID_BINDING');
    }
  }
}

export class ApprovalVerifier {
  constructor(
    private db: Database.Database,
    private publicKey: () => KeyObject | undefined,
    private getRuntimeIdentity?: () => RuntimeIdentity,
  ) {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS supervisor_approval_nonces (
          nonce TEXT PRIMARY KEY,
          binding TEXT NOT NULL,
          deadline INTEGER NOT NULL,
          runtime_incarnation TEXT NOT NULL DEFAULT '',
          consumed INTEGER NOT NULL DEFAULT 0,
          revoked INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_approval_nonce_lookup
          ON supervisor_approval_nonces(nonce, consumed, revoked, deadline);
      `);
    } catch {
      // Ignore if db is closed or invalid
    }
  }

  public challenge(binding: ApprovalBinding, now = Date.now()): { nonce: string; expiresAt: number } {
    validateBinding(binding);
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = now + 60000;
    let incarnation = binding.runtimeIncarnation || '';
    if (!incarnation && this.getRuntimeIdentity) {
      try {
        incarnation = this.getRuntimeIdentity().incarnation;
      } catch {}
    }

    try {
      this.db.prepare(
        'INSERT INTO supervisor_approval_nonces(nonce, binding, deadline, runtime_incarnation, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(nonce, canonical(binding), expiresAt, incarnation, now);
    } catch {
      throw new Error('APPROVAL_SERVICE_UNAVAILABLE');
    }

    return { nonce, expiresAt };
  }

  public revoke(nonce: string): void {
    try {
      this.db.prepare('UPDATE supervisor_approval_nonces SET revoked = 1 WHERE nonce = ?').run(nonce);
    } catch {
      throw new Error('APPROVAL_SERVICE_UNAVAILABLE');
    }
  }

  public consume(
    payload: ApprovalPayload,
    signature: string,
    expected: ApprovalBinding,
    now = Date.now(),
  ): void {
    validateBinding(expected);
    const { version, issuer, nonce, issuedAt, expiresAt, secondConfirmation, ...binding } = payload;
    validateBinding(binding);

    // 1. Runtime Identity check (Phase 1 binding)
    if (this.getRuntimeIdentity) {
      let currentRuntime: RuntimeIdentity;
      try {
        currentRuntime = this.getRuntimeIdentity();
      } catch {
        throw new Error('APPROVAL_RUNTIME_IDENTITY_TAMPERED');
      }
      if (!currentRuntime || typeof currentRuntime.incarnation !== 'string') {
        throw new Error('APPROVAL_RUNTIME_IDENTITY_TAMPERED');
      }
      if (payload.runtimeIncarnation !== undefined && payload.runtimeIncarnation !== currentRuntime.incarnation) {
        throw new Error('APPROVAL_RUNTIME_INCARNATION_MISMATCH');
      }
      if (payload.bootTimestamp !== undefined && payload.bootTimestamp !== currentRuntime.bootTimestamp) {
        throw new Error('APPROVAL_RUNTIME_INCARNATION_MISMATCH');
      }
      if (expected.runtimeIncarnation !== undefined && expected.runtimeIncarnation !== currentRuntime.incarnation) {
        throw new Error('APPROVAL_RUNTIME_INCARNATION_MISMATCH');
      }
    }

    // 2. Validate timing and expiry
    if (
      version !== 1 ||
      issuer !== 'agenticos-interactive-issuer' ||
      secondConfirmation !== true ||
      !/^[0-9a-f]{64}$/.test(nonce) ||
      !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) ||
      issuedAt > now ||
      expiresAt <= now ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > 60000
    ) {
      throw new Error('APPROVAL_INVALID_OR_EXPIRED');
    }

    // 3. Validate binding match
    if (canonical(binding) !== canonical(expected)) {
      throw new Error('APPROVAL_BINDING_MISMATCH');
    }

    // 4. Validate asymmetric key (Public Key Only; private key strictly refused)
    let key: KeyObject | undefined;
    try {
      key = this.publicKey();
    } catch {
      throw new Error('APPROVAL_KEY_UNAVAILABLE');
    }
    if (!key || key.type !== 'public') {
      throw new Error('APPROVAL_KEY_UNAVAILABLE');
    }

    const ed25519 = key.asymmetricKeyType === 'ed25519';
    const es256 = key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
    if (!ed25519 && !es256) {
      throw new Error('APPROVAL_KEY_UNAVAILABLE');
    }

    // 5. Validate cryptographic signature
    let isValid = false;
    try {
      const canonicalBuffer = Buffer.from(canonical(payload));
      const sigBuffer = Buffer.from(signature, 'base64');
      isValid = verify(
        ed25519 ? null : 'sha256',
        canonicalBuffer,
        es256 ? { key, dsaEncoding: 'ieee-p1363' } : key,
        sigBuffer,
      );
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw new Error('APPROVAL_SIGNATURE_INVALID');
    }

    // 6. Atomic Nonce Consumption (Anti-Replay)
    try {
      this.db.transaction(() => {
        const row = this.db.prepare('SELECT * FROM supervisor_approval_nonces WHERE nonce = ?').get(nonce) as any;
        if (!row) throw new Error('APPROVAL_NONCE_REPLAY_REVOKED_OR_EXPIRED');
        if (row.consumed === 1) throw new Error('APPROVAL_NONCE_REPLAY');
        if (row.revoked === 1) throw new Error('APPROVAL_REVOKED');
        if (row.deadline < expiresAt || row.deadline <= now) throw new Error('APPROVAL_NONCE_REPLAY_REVOKED_OR_EXPIRED');
        if (row.binding !== canonical(expected)) throw new Error('APPROVAL_BINDING_MISMATCH');
        if (this.getRuntimeIdentity) {
          const currentRuntime = this.getRuntimeIdentity();
          if (row.runtime_incarnation && row.runtime_incarnation !== currentRuntime.incarnation) {
            throw new Error('APPROVAL_RUNTIME_INCARNATION_MISMATCH');
          }
        }

        const result = this.db.prepare(
          'UPDATE supervisor_approval_nonces SET consumed = 1 WHERE nonce = ? AND consumed = 0 AND revoked = 0'
        ).run(nonce);
        if (result.changes !== 1) throw new Error('APPROVAL_NONCE_REPLAY');
      })();
    } catch (error: any) {
      if (error instanceof Error && error.message.startsWith('APPROVAL_')) throw error;
      throw new Error('APPROVAL_SERVICE_UNAVAILABLE');
    }
  }
}

let supervisorVerifierInstance: ApprovalVerifier | null = null;
let enrolledPublicKey: KeyObject | undefined = undefined;
let bootIncarnation = 'boot-incarnation-' + Date.now();
let bootTimestamp = Date.now();

export function getRuntimeDeploymentIdentity(): RuntimeIdentity {
  return {
    incarnation: bootIncarnation,
    bootTimestamp,
  };
}

export function setRuntimeDeploymentIdentity(identity: RuntimeIdentity): void {
  bootIncarnation = identity.incarnation;
  bootTimestamp = identity.bootTimestamp;
}

export function enrollSupervisorPublicKey(key: KeyObject | undefined): void {
  if (key && key.type !== 'public') {
    throw new Error('ENROLL_KEY_REJECTED: Only public keys may be enrolled in the supervisor verifier');
  }
  enrolledPublicKey = key;
}

export function resetSupervisorVerifierInstance(customVerifier?: ApprovalVerifier | null): void {
  supervisorVerifierInstance = customVerifier ?? null;
}

export function getSupervisorApprovalVerifier(): ApprovalVerifier {
  if (!supervisorVerifierInstance) {
    const DatabaseConstructor = (Database as any).default || Database;
    const db = new DatabaseConstructor(':memory:');
    supervisorVerifierInstance = new ApprovalVerifier(
      db,
      () => enrolledPublicKey,
      () => getRuntimeDeploymentIdentity(),
    );
  }
  return supervisorVerifierInstance;
}

