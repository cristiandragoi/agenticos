/**
 * build-identity.cjs
 *
 * Generates authoritative build-identity.json in:
 *   - server/src/build-identity.json (for backend runtime)
 *   - src/build-identity.json (for renderer bundle)
 *
 * Contains:
 *   - gitSha: full HEAD commit SHA
 *   - gitShort: 8-char abbreviated SHA
 *   - isDirty: boolean indicating uncommitted modifications
 *   - buildTimestamp: ISO 8601 UTC timestamp
 *   - buildId: "<gitShort>-<yyyyMMdd-HHmmss>"
 *   - version: root package.json version
 *   - component: 'agenticos'
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { computeDistFingerprint } = require('./compute-dist-fingerprint.cjs');

const ROOT = path.resolve(__dirname, '..');
const SERVER_SRC = path.join(ROOT, 'server', 'src');
const RENDERER_SRC = path.join(ROOT, 'src');
const SERVER_DIST = path.join(ROOT, 'server', 'dist');

function getGitSha(cwd = ROOT) {
  try {
    return execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Deterministic dirty-state calculation.
 * dirtyState represents uncommitted changes to tracked or untracked source files
 * relevant to the build being verified. Transient artifacts (build-identity.json,
 * evidence logs, disposable test probes) are placed in .gitignore so they do not
 * falsely mutate the repository source state.
 */
function getIsDirty(cwd = ROOT) {
  try {
    const raw = execSync('git status --porcelain', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (!raw) return false;
    const lines = raw
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    return lines.length > 0;
  } catch {
    return false;
  }
}

function getVersion(cwd = ROOT) {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version ?? '0.0.0';
    }
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function generateBuildIdentity(cwd = ROOT) {
  const now = new Date();
  const gitSha = getGitSha(cwd);
  const gitShort = gitSha === 'unknown' ? 'unknown' : gitSha.slice(0, 8);
  const isDirty = getIsDirty(cwd);
  const version = getVersion(cwd);

  // Format: yyyyMMdd-HHmmss
  const pad = (n) => String(n).padStart(2, '0');
  const buildTimestamp = now.toISOString();
  const datePart = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const timePart = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const buildId = `${gitShort}${isDirty ? '-dirty' : ''}-${datePart}-${timePart}`;

  // Content fingerprint of the server dist (the authority for "which code is
  // actually executing"). Computed over the dist AFTER tsc (server build is
  // `tsc && node ../scripts/build-identity.cjs`), excluding this metadata file
  // so the fingerprint is stable and non-circular.
  let fingerprint = null;
  let algorithm = null;
  let filesCount = 0;
  const serverDistDir = path.join(cwd, 'server', 'dist');
  if (fs.existsSync(serverDistDir)) {
    const fp = computeDistFingerprint(serverDistDir);
    fingerprint = fp.fingerprint;
    algorithm = fp.algorithm;
    filesCount = fp.filesCount;
  }

  const identity = {
    gitSha,
    gitShort,
    isDirty,
    buildTimestamp,
    buildId,
    version,
    component: 'agenticos',
    fingerprint,
    algorithm,
    filesCount,
  };

  const jsonStr = JSON.stringify(identity, null, 2) + '\n';

  // Write to server/src
  const serverSrc = path.join(cwd, 'server', 'src');
  if (fs.existsSync(serverSrc) || cwd === ROOT) {
    fs.mkdirSync(serverSrc, { recursive: true });
    fs.writeFileSync(path.join(serverSrc, 'build-identity.json'), jsonStr, 'utf8');
  }

  // Write to src/ (renderer)
  const rendererSrc = path.join(cwd, 'src');
  if (fs.existsSync(rendererSrc) || cwd === ROOT) {
    fs.mkdirSync(rendererSrc, { recursive: true });
    fs.writeFileSync(path.join(rendererSrc, 'build-identity.json'), jsonStr, 'utf8');
  }

  // Write to server/dist if it exists
  const serverDist = path.join(cwd, 'server', 'dist');
  if (fs.existsSync(serverDist)) {
    try {
      fs.writeFileSync(path.join(serverDist, 'build-identity.json'), jsonStr, 'utf8');
    } catch { /* best effort */ }
  }

  return identity;
}

if (require.main === module) {
  const identity = generateBuildIdentity(ROOT);
  console.log(`[build-identity] Generated ${identity.buildId} (git=${identity.gitShort}, dirty=${identity.isDirty})`);
}

module.exports = {
  getGitSha,
  getIsDirty,
  getVersion,
  generateBuildIdentity,
};
