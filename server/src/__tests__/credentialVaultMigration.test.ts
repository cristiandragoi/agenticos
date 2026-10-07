import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  CanonicalSecretStore,
  secretStore,
  encryptSecret,
  decryptSecret,
  getOrCreateVaultSalt,
  deriveDurableVaultKey,
  setCustomVaultSaltPath,
  resetVaultKeyCache,
  redactSecrets,
  sanitizeDiagnostics,
} from '../services/gateway/secretStore.js';
import { buildSanitizedEnvironment } from '../domains/localWorker/processConfinement.js';
import { rawDb } from '../db/index.js';

describe('Credential Vault Migration & Durable Key Derivation (Item 4)', () => {
  let tempDir: string;
  let customSaltPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-vault-test-'));
    customSaltPath = path.join(tempDir, '.vault_salt');
    setCustomVaultSaltPath(customSaltPath);
    resetVaultKeyCache();
  });

  afterEach(() => {
    setCustomVaultSaltPath(null);
    resetVaultKeyCache();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Durable Key Derivation & Salt Persistence', () => {
    it('generates a 32-byte cryptographic salt and persists it', () => {
      expect(fs.existsSync(customSaltPath)).toBe(false);
      const salt = getOrCreateVaultSalt();
      expect(salt.length).toBe(32);
      expect(fs.existsSync(customSaltPath)).toBe(true);

      const readBack = fs.readFileSync(customSaltPath);
      expect(readBack.subarray(0, 32)).toEqual(salt);
    });

    it('reuses existing salt without regenerating', () => {
      const salt1 = getOrCreateVaultSalt();
      resetVaultKeyCache();
      const salt2 = getOrCreateVaultSalt();
      expect(salt1).toEqual(salt2);
    });

    it('derives a durable 32-byte key via scrypt bound to host and user context', () => {
      const salt = crypto.randomBytes(32);
      const key1 = deriveDurableVaultKey(salt);
      const key2 = deriveDurableVaultKey(salt);
      expect(key1.length).toBe(32);
      expect(key1).toEqual(key2);

      // Different salt produces a completely different derived key
      const keyOther = deriveDurableVaultKey(crypto.randomBytes(32));
      expect(key1).not.toEqual(keyOther);
    });

    it('detects and refuses a symbolic link or junction salt path', () => {
      const realTarget = path.join(tempDir, 'real_salt');
      fs.writeFileSync(realTarget, crypto.randomBytes(32));

      // Create symlink pointing to realTarget
      try {
        fs.symlinkSync(realTarget, customSaltPath, 'file');
      } catch (e: any) {
        // If unprivileged symlink creation is restricted by OS, skip or test junction
        return;
      }

      expect(() => getOrCreateVaultSalt()).toThrow('symbolic link or junction (tamper detected)');
    });
  });

  describe('v2 Encrypted Payload Format', () => {
    it('encrypts into v2 format (v2:<saltId>:<iv>:<tag>:<ciphertext>) and decrypts cleanly', () => {
      const secret = 'sk-antigravity-live-token-secret-12345';
      const encrypted = encryptSecret(secret);

      expect(encrypted.startsWith('v2:')).toBe(true);
      const parts = encrypted.split(':');
      expect(parts.length).toBe(5);
      expect(parts[0]).toBe('v2');
      expect(parts[1]?.length).toBe(16); // saltId hex
      expect(parts[2]?.length).toBe(24); // 12-byte IV hex
      expect(parts[3]?.length).toBe(32); // 16-byte auth tag hex

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('produces distinct ciphertexts for identical plaintext (random IV nonces)', () => {
      const secret = 'identical-secret-payload';
      const enc1 = encryptSecret(secret);
      const enc2 = encryptSecret(secret);

      expect(enc1).not.toBe(enc2);
      expect(decryptSecret(enc1)).toBe(secret);
      expect(decryptSecret(enc2)).toBe(secret);
    });
  });

  describe('Legacy v1 Backward Compatibility & In-Place Migration', () => {
    function createLegacyV1Payload(plaintext: string): string {
      const seed = `${os.hostname()}-${os.userInfo().username}-AgenticOS-LocalMasterKey-Salt-2026`;
      const legacyKey = crypto.createHash('sha256').update(seed).digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', legacyKey, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      return `${iv.toString('hex')}:${tag}:${encrypted}`;
    }

    it('decrypts legacy v1 payloads produced with the legacy machine key', () => {
      const legacySecret = 'legacy-v1-api-key-test-string';
      const legacyPayload = createLegacyV1Payload(legacySecret);

      expect(legacyPayload.startsWith('v2:')).toBe(false);
      expect(legacyPayload.split(':').length).toBe(3);

      const decrypted = decryptSecret(legacyPayload);
      expect(decrypted).toBe(legacySecret);
    });

    it('migrates legacy v1 database records to v2 format on read', async () => {
      const testKey = 'migration_test_secret';
      const legacySecret = 'legacy-secret-to-be-migrated-on-read';
      const legacyPayload = createLegacyV1Payload(legacySecret);
      const now = new Date().toISOString();

      // Insert legacy payload directly into system_secrets table
      rawDb.prepare(`
        INSERT INTO system_secrets (key, encrypted_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = ?
      `).run(testKey, legacyPayload, now, legacyPayload, now);

      // Verify that database currently holds legacy v1 format
      const rowBefore = rawDb.prepare(`SELECT encrypted_value FROM system_secrets WHERE key = ?`).get(testKey) as any;
      expect(rowBefore.encrypted_value.startsWith('v2:')).toBe(false);

      // Read secret through store
      const retrieved = await secretStore.get(testKey);
      expect(retrieved).toBe(legacySecret);

      // Verify that database was transparently migrated to v2 format
      const rowAfter = rawDb.prepare(`SELECT encrypted_value FROM system_secrets WHERE key = ?`).get(testKey) as any;
      expect(rowAfter.encrypted_value.startsWith('v2:')).toBe(true);

      // Clean up
      await secretStore.delete(testKey);
    });

    it('preserves legacy v1 payload completely if v2 migration write fails (rollback test)', async () => {
      const testKey = 'rollback_test_secret';
      const legacySecret = 'legacy-payload-must-survive-abort';
      const legacyPayload = createLegacyV1Payload(legacySecret);
      const now = new Date().toISOString();

      rawDb.prepare(`
        INSERT INTO system_secrets (key, encrypted_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = ?
      `).run(testKey, legacyPayload, now, legacyPayload, now);

      // Temporarily sabotage rawDb.prepare for UPDATE to simulate write failure
      const originalPrepare = rawDb.prepare.bind(rawDb);
      let updateAttempted = false;
      vi.spyOn(rawDb, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('UPDATE system_secrets')) {
          updateAttempted = true;
          throw new Error('SIMULATED_DISK_IO_FAILURE_ON_UPDATE');
        }
        return originalPrepare(sql);
      });

      // Retrieval should still return the plaintext secret safely via v1 decryption
      const retrieved = await secretStore.get(testKey);
      expect(retrieved).toBe(legacySecret);
      expect(updateAttempted).toBe(true);

      // Restore mock
      vi.restoreAllMocks();

      // Verify legacy v1 payload remains completely intact in the database
      const rowAfterFailure = rawDb.prepare(`SELECT encrypted_value FROM system_secrets WHERE key = ?`).get(testKey) as any;
      expect(rowAfterFailure.encrypted_value).toBe(legacyPayload);
      expect(rowAfterFailure.encrypted_value.startsWith('v2:')).toBe(false);

      // Clean up
      await secretStore.delete(testKey);
    });

    it('subsequent retry after failed migration succeeds atomically', async () => {
      const testKey = 'retry_test_secret';
      const legacySecret = 'retry-payload-value';
      const legacyPayload = createLegacyV1Payload(legacySecret);
      const now = new Date().toISOString();

      rawDb.prepare(`
        INSERT INTO system_secrets (key, encrypted_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = ?
      `).run(testKey, legacyPayload, now, legacyPayload, now);

      // First read: simulated failure
      const originalPrepare = rawDb.prepare.bind(rawDb);
      vi.spyOn(rawDb, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('UPDATE system_secrets')) {
          throw new Error('TEMPORARY_LOCKED');
        }
        return originalPrepare(sql);
      });
      await secretStore.get(testKey);
      vi.restoreAllMocks();

      // Second read: normal execution, migration succeeds
      const retried = await secretStore.get(testKey);
      expect(retried).toBe(legacySecret);

      const row = rawDb.prepare(`SELECT encrypted_value FROM system_secrets WHERE key = ?`).get(testKey) as any;
      expect(row.encrypted_value.startsWith('v2:')).toBe(true);

      await secretStore.delete(testKey);
    });
  });

  describe('Anti-Tampering & Authentication Integrity', () => {
    it('rejects tampered ciphertext', () => {
      const secret = 'confidential-unaltered-data';
      const payload = encryptSecret(secret);
      const parts = payload.split(':');

      // Alter last char of ciphertext
      const lastChar = parts[4]?.slice(-1) === 'a' ? 'b' : 'a';
      parts[4] = parts[4]?.slice(0, -1) + lastChar;
      const tampered = parts.join(':');

      expect(decryptSecret(tampered)).toBeNull();
    });

    it('rejects tampered auth tag', () => {
      const payload = encryptSecret('confidential-data');
      const parts = payload.split(':');
      parts[3] = '00'.repeat(16); // corrupted tag
      const tampered = parts.join(':');

      expect(decryptSecret(tampered)).toBeNull();
    });

    it('rejects tampered IV', () => {
      const payload = encryptSecret('confidential-data');
      const parts = payload.split(':');
      parts[2] = 'ff'.repeat(12); // altered IV
      const tampered = parts.join(':');

      expect(decryptSecret(tampered)).toBeNull();
    });

    it('rejects garbage and malformed payload strings', () => {
      expect(decryptSecret('')).toBeNull();
      expect(decryptSecret('not:a:valid:encrypted:payload:format')).toBeNull();
      expect(decryptSecret('v2:corrupted')).toBeNull();
    });
  });

  describe('Worker Process Non-Exposure & Redaction', () => {
    it('never propagates vault secrets into sanitized child process environments', () => {
      const childEnv = buildSanitizedEnvironment({
        SAFE_SETTING: 'ok',
        AGENTICOS_MASTER_KEY: 'sensitive_master_key',
        VAULT_SALT: 'secret_salt_leak',
      });

      expect(childEnv.AGENTICOS_MASTER_KEY).toBeUndefined();
      expect(childEnv.VAULT_SALT).toBeUndefined();
      expect(childEnv.SAFE_SETTING).toBe('ok');
    });

    it('redacts tokens and keys from error reports and diagnostics', () => {
      const sensitiveText = 'Error connecting with Bearer sk-antigravity-998877665544 and AIzaSyFakeApiKey1234567890';
      const redacted = redactSecrets(sensitiveText);

      expect(redacted).not.toContain('sk-antigravity');
      expect(redacted).not.toContain('AIzaSyFakeApiKey');
      expect(redacted).toContain('[REDACTED');

      const diag = sanitizeDiagnostics({
        status: 'failed',
        apiKey: 'secret_key_12345',
        details: { token: 'bearer_token_xyz', safeData: 42 },
      });

      expect(diag.apiKey).toBe('[REDACTED]');
      expect(diag.details.token).toBe('[REDACTED]');
      expect(diag.details.safeData).toBe(42);
    });
  });
});
