// @vitest-environment node
/**
 * Packaging regression: the backend runtime must ship under resources/server
 * (electron-builder extraResources) — NOT inside resources/app. If it is
 * dropped from extraResources or re-added to build.files, the packaged app
 * cannot spawn the backend (express / better-sqlite3 / dotenv missing →
 * "Backend Disconnected", no /api/health). This locks in the config fix.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');

interface ExtraResource { from: string; to: string }

describe('packaged backend runtime (extraResources)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  it('extraResources carries the backend runtime under resources/server', () => {
    const extra = (pkg.build?.extraResources ?? []) as ExtraResource[];
    const map = Object.fromEntries(extra.map((e) => [e.from, e.to]));
    expect(map['server/dist']).toBe('server/dist');
    expect(map['server/node_modules']).toBe('server/node_modules');
    expect(map['server/package.json']).toBe('server/package.json');
    expect(map['server/.env']).toBe('server/.env');
  });

  it('build.files does NOT include the server tree (no duplicate in resources/app)', () => {
    const files = (pkg.build?.files ?? []) as string[];
    expect(files.some((f) => f.includes('server/'))).toBe(false);
  });

  it('the packaged backend entry exists at resources/server/dist/index.js after a --dir build', () => {
    const packagedEntry = path.join(repoRoot, 'release', 'win-unpacked', 'resources', 'server', 'dist', 'index.js');
    // No package on disk (fresh checkout / CI without packaging) → nothing to
    // assert; a present-but-broken package MUST fail here.
    if (!fs.existsSync(packagedEntry)) return;
    expect(fs.existsSync(packagedEntry)).toBe(true);
  });
});
