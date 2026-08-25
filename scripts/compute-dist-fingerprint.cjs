/**
 * compute-dist-fingerprint.cjs
 *
 * Standalone content fingerprint of a server dist directory — the same
 * `content-sha256-v1` algorithm as server/src/services/buildIdentity.ts.
 * Used by CI/tooling to compare repo dist vs packaged dist vs the running
 * backend's /api/health fingerprint.
 *
 * Usage:  node scripts/compute-dist-fingerprint.cjs <distDir>
 * Output: JSON { fingerprint, algorithm, filesCount }
 * Exit:   0 on success, non-zero on error.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALGORITHM = 'content-sha256-v1';
const EXCLUDED_DIR_NAMES = new Set(['node_modules']);
const EXCLUDED_FILE_NAMES = new Set(['build-identity.json']);

function computeDistFingerprint(distDir) {
  const records = [];
  const walk = (dir) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (EXCLUDED_DIR_NAMES.has(name)) continue;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && !EXCLUDED_FILE_NAMES.has(name)) {
        const rel = path.relative(distDir, full).split(path.sep).join('/');
        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        records.push(`${rel}\u0000${fileHash}`);
      }
    }
  };
  walk(path.resolve(distDir));
  records.sort();
  const fingerprint = crypto.createHash('sha256').update(records.join('\n')).digest('hex');
  return { fingerprint, algorithm: ALGORITHM, filesCount: records.length };
}

module.exports = { computeDistFingerprint, ALGORITHM };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/compute-dist-fingerprint.cjs <distDir>');
    process.exit(2);
  }
  const result = computeDistFingerprint(dir);
  console.log(JSON.stringify(result));
}
