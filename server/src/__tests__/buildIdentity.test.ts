import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeDistFingerprint, FINGERPRINT_ALGORITHM } from '../services/buildIdentity.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-bi-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

const HEX64 = /^[0-9a-f]{64}$/;

describe('computeDistFingerprint', () => {
  it('A. generates a 64-hex content fingerprint over the dist', () => {
    writeFile('index.js', 'console.log("a")');
    writeFile('routers/health.js', 'export {}');
    const { fingerprint, algorithm, filesCount } = computeDistFingerprint(tmp);
    expect(fingerprint).toMatch(HEX64);
    expect(algorithm).toBe(FINGERPRINT_ALGORITHM);
    expect(filesCount).toBe(2);
  });

  it('B. fingerprint changes when executable content changes', () => {
    writeFile('index.js', 'console.log("before")');
    const before = computeDistFingerprint(tmp).fingerprint;
    writeFile('index.js', 'console.log("after")');
    const after = computeDistFingerprint(tmp).fingerprint;
    expect(after).not.toBe(before);
  });

  it('is deterministic for identical content regardless of write order', () => {
    writeFile('index.js', 'const x = 1;');
    writeFile('nested/a.js', 'x');
    const a = computeDistFingerprint(tmp).fingerprint;
    const b = computeDistFingerprint(tmp).fingerprint;
    expect(a).toBe(b);
  });

  it('excludes build-identity.json from the fingerprint', () => {
    writeFile('index.js', 'console.log(1)');
    const without = computeDistFingerprint(tmp).fingerprint;
    writeFile('build-identity.json', JSON.stringify({ fingerprint: 'x'.repeat(64), gitSha: 'abc' }));
    const withMeta = computeDistFingerprint(tmp).fingerprint;
    expect(withMeta).toBe(without);
  });
});
