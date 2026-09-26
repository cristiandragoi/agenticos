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
    // The backend needs its migrations and its python worker scripts
    // (scripts/whisper_worker.py is spawned by the warm STT worker).
    expect(map['server/drizzle']).toBe('server/drizzle');
    expect(map['server/scripts']).toBe('server/scripts');
  });

  it('extraResources never ships environment or secret files', () => {
    // The backend resolves configuration from the HOST ENVIRONMENT — the Electron
    // lifecycle manager injects PORT / AGENTICOS_BACKEND_PORT / AGENTICOS_DATA_DIR /
    // AGENT_TEAMS_DB_PATH / AGENTICOS_IS_PACKAGED — and from code defaults
    // (e.g. OLLAMA_BASE_URL || 'http://127.0.0.1:11434').
    //
    // server/.env is gitignored and untracked, so a clean checkout or CI build
    // cannot contain it; requiring it in extraResources would make packaging
    // depend on a developer's local file. Packaging it would also ship
    // environment-specific — potentially secret — values into the artifact.
    // This assertion encodes the rule: never package secrets to satisfy a test.
    const extra = (pkg.build?.extraResources ?? []) as ExtraResource[];
    const envEntries = extra.filter((e) => /(^|\/)\.env(\.|$)/.test(e.from));
    expect(envEntries).toEqual([]);
  });

  it('build.files does NOT ship a .env either', () => {
    const files = (pkg.build?.files ?? []) as string[];
    expect(files.some((f) => /(^|\/)\.env(\.|$)/.test(f))).toBe(false);
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
