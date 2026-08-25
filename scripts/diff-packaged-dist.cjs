/**
 * diff-packaged-dist.cjs
 *
 * READ-ONLY comparison of the repo compiled server build vs the packaged (live)
 * runtime build. Pure Node — no external `diff` binary, so it works identically
 * in a terminal and under CI/test child processes.
 *
 * Usage:
 *   node scripts/diff-packaged-dist.cjs [repoDist] [packagedDist]
 * Defaults:
 *   repoDist     = B:/AgenticOS/server/dist
 *   packagedDist = C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist
 *
 * Output: IDENTICAL (exit 0) or STALE (exit 1), with the differing/missing/extra
 * files listed and both content fingerprints printed. Never copies, backs up, or
 * restarts anything.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { computeDistFingerprint } = require('./compute-dist-fingerprint.cjs');

const REPO_DEFAULT = 'B:/AgenticOS/server/dist';
const PACKAGED_DEFAULT = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist';

const EXCLUDED_DIR_NAMES = new Set(['node_modules']);
const EXCLUDED_FILE_NAMES = new Set(['build-identity.json']);

function mapDir(root) {
  const map = new Map();
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
        const rel = path.relative(root, full).split(path.sep).join('/');
        const hash = require('crypto').createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        map.set(rel, hash);
      }
    }
  };
  walk(path.resolve(root));
  return map;
}

function main() {
  const repoDist = process.argv[2] || REPO_DEFAULT;
  const packagedDist = process.argv[3] || PACKAGED_DEFAULT;

  if (!fs.existsSync(repoDist) || !fs.existsSync(packagedDist)) {
    console.error(`Missing directory: repo=${repoDist} packaged=${packagedDist}`);
    process.exit(2);
  }

  const repo = mapDir(repoDist);
  const pkg = mapDir(packagedDist);

  const differ = [];
  const missingFromPackaged = [];
  const extraInPackaged = [];

  for (const [rel, hash] of repo) {
    if (!pkg.has(rel)) missingFromPackaged.push(rel);
    else if (pkg.get(rel) !== hash) differ.push(rel);
  }
  for (const rel of pkg.keys()) {
    if (!repo.has(rel)) extraInPackaged.push(rel);
  }

  const repoFp = computeDistFingerprint(repoDist);
  const pkgFp = computeDistFingerprint(packagedDist);

  const identical = differ.length === 0 && missingFromPackaged.length === 0 && extraInPackaged.length === 0;

  if (identical) {
    console.log('IDENTICAL: packaged dist matches repo dist.');
    console.log(`repo fingerprint:      ${repoFp.fingerprint}`);
    console.log(`packaged fingerprint:  ${pkgFp.fingerprint}`);
    console.log(`files: repo=${repoFp.filesCount} packaged=${pkgFp.filesCount}`);
    process.exit(0);
  }

  console.log('STALE PACKAGED BUILD DETECTED.\n');
  if (differ.length) {
    console.log(`${differ.length} file(s) differ:`);
    for (const f of differ.sort()) console.log('  DIFFER   ' + f);
  }
  if (missingFromPackaged.length) {
    console.log(`\n${missingFromPackaged.length} file(s) only in repo (missing from packaged):`);
    for (const f of missingFromPackaged.sort()) console.log('  MISSING  ' + f);
  }
  if (extraInPackaged.length) {
    console.log(`\n${extraInPackaged.length} file(s) only in packaged (not in repo):`);
    for (const f of extraInPackaged.sort()) console.log('  EXTRA    ' + f);
  }
  console.log(`\nrepo fingerprint:      ${repoFp.fingerprint}`);
  console.log(`packaged fingerprint:  ${pkgFp.fingerprint}`);
  process.exit(1);
}

main();
