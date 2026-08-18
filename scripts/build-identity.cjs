/**
 * build-identity.cjs
 *
 * Generates a build-identity.json file in server/src/ (and server/dist/ post-build)
 * containing:
 *   - gitSha: full HEAD commit SHA (or "unknown" if git unavailable)
 *   - gitShort: 8-char abbreviated SHA
 *   - buildTimestamp: ISO 8601 UTC timestamp
 *   - buildId: "<gitShort>-<yyyyMMdd-HHmmss>" — human-readable unique build ID
 *   - version: from root package.json
 *
 * This file is consumed at runtime by runtimeDiagnostics.ts to expose build
 * identity through GET /api/diagnostics/runtime without executing git at runtime.
 *
 * Usage:
 *   node scripts/build-identity.cjs
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_SRC = path.join(ROOT, 'server', 'src');
const OUTPUT_PATH = path.join(SERVER_SRC, 'build-identity.json');

function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function getVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const now = new Date();
const gitSha = getGitSha();
const gitShort = gitSha === 'unknown' ? 'unknown' : gitSha.slice(0, 8);
const version = getVersion();

// Format: yyyyMMdd-HHmmss
const pad = (n) => String(n).padStart(2, '0');
const buildTimestamp = now.toISOString();
const datePart = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
const timePart = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
const buildId = `${gitShort}-${datePart}-${timePart}`;

const identity = {
  gitSha,
  gitShort,
  buildTimestamp,
  buildId,
  version,
};

fs.mkdirSync(SERVER_SRC, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(identity, null, 2) + '\n', 'utf8');

console.log('[build-identity] Generated:', OUTPUT_PATH);
console.log('[build-identity] Identity:', JSON.stringify(identity));
