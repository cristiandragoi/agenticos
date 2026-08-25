/**
 * verify-runtime-identity.cjs
 *
 * DEV-side runtime gate. Proves the code the packaged Electron backend is
 * actually running is the code we built and deployed — by comparing three
 * fingerprints that must all be equal:
 *
 *   1. repo `server/dist` content fingerprint
 *   2. packaged `resources/server/dist` content fingerprint
 *   3. the running backend's `/api/health` build.fingerprint
 *
 * READ-ONLY. No production dependency on the dev repo is introduced — this
 * script is a development/CI tool only; the packaged app exposes its identity
 * through /api/health regardless.
 *
 * Exit 0 = all three match; exit 1 = mismatch (stale/deployed divergence);
 * exit 2 = usage/IO error.
 */
'use strict';
const http = require('http');
const { computeDistFingerprint } = require('./compute-dist-fingerprint.cjs');

const REPO = 'B:/AgenticOS/server/dist';
const PACKAGED = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist';
const HEALTH_URL = process.env.AGENTICOS_HEALTH_URL || 'http://127.0.0.1:4000/api/health';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const r = http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.setTimeout(5000, () => { r.destroy(new Error('health request timeout')); });
  });
}

(async () => {
  const repo = computeDistFingerprint(REPO);
  const pkg = computeDistFingerprint(PACKAGED);

  let runningFp = null;
  let runningFiles = null;
  try {
    const health = await getJson(HEALTH_URL);
    runningFp = health?.build?.fingerprint ?? null;
    runningFiles = health?.build?.filesCount ?? null;
  } catch (e) {
    console.error('Could not read /api/health:', e.message);
    process.exit(2);
  }

  console.log('=== RUNTIME IDENTITY ===');
  console.log('repo dist fingerprint:     ', repo.fingerprint, `(${repo.filesCount} files)`);
  console.log('packaged dist fingerprint: ', pkg.fingerprint, `(${pkg.filesCount} files)`);
  console.log('running /api/health:       ', runningFp ?? '(missing)', runningFiles != null ? `(${runningFiles} files)` : '');

  if (!runningFp) {
    console.log('\nFAIL: /api/health did not expose a build fingerprint.');
    process.exit(1);
  }
  if (repo.fingerprint === pkg.fingerprint && pkg.fingerprint === runningFp) {
    console.log('\nMATCH: repo == packaged == running. The packaged backend is executing the intended build.');
    process.exit(0);
  }
  console.log('\nMISMATCH detected — a stale or divergent backend build is running.');
  process.exit(1);
})();
