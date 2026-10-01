/**
 * clean-server-dist.cjs — runs before `tsc` in the server build (Phase 1).
 *
 * 1. Refuses to build while ANY installed-runtime path resolves into this repo
 *    (junction/symlink): a repository build must never silently change the
 *    installed runtime. Fix: run `node scripts/deploy-installed.cjs` once; it
 *    breaks the link without following it.
 * 2. Removes server/dist so files whose sources were deleted (orphans) are not
 *    carried forward into the fingerprint or the next deploy.
 *
 * Escape hatch for machines with no installed copy: none needed — missing
 * install paths are simply skipped.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const boundary = require('./release-boundary.cjs');

const DIST = path.join(boundary.REPO, 'server', 'dist');

const shared = boundary.inspectInstalled().filter((f) => f.intoRepo);
if (shared.length) {
  console.error('[clean-server-dist] REFUSING TO BUILD: the installed runtime shares storage with this repository:');
  for (const f of shared) console.error(`  ${f.kind} ${f.path} -> ${f.target}`);
  console.error('  Run `node scripts/deploy-installed.cjs` (with AgenticOS stopped) to break the link first.');
  process.exit(3);
}
if (boundary.isLinkEntry(DIST)) {
  console.error(`[clean-server-dist] REFUSING: ${DIST} is itself a link/junction (${boundary.realpathOrNull(DIST)}).`);
  process.exit(3);
}
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
  console.log(`[clean-server-dist] removed ${DIST}`);
}
