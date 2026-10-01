/**
 * deploy-installed.cjs — the canonical deploy: repo build artifacts → installed app.
 *
 * Before this script, deploying AgenticOS meant hand-copying directories with
 * shell one-liners (server/dist, dist-electron, dist), which is exactly how the
 * Electron layer silently went stale: nothing tied "what was just built" to
 * "what the installed runtime serves".
 *
 * What it does, in order:
 *   1. verifies the canonical build artifacts exist (fail loudly if not built)
 *   2. backs up every destination it will replace (timestamped, never deleted)
 *   3. replaces destinations completely (no merge — a merge leaves stale files)
 *   4. verifies byte parity of each deployed tree against the repo artifact
 *   5. prints the server buildId so the deployed fingerprint is auditable
 *   6. (Phase 1) breaks any junction/symlink between the installed runtime and the
 *      repository first — without following it — and refuses to finish while one exists
 *   7. (Phase 1) writes resources/server/deployment.json + resources/app/deployment.json:
 *      git commit, dirty/clean, build id, fingerprint, deployment timestamp
 *
 * This is the ONLY supported way to change the installed runtime.
 *
 * It does NOT restart anything: restarting the backend belongs to the Electron
 * lifecycle owner (POST /api/health/restart), not to the deploy step.
 *
 * Usage:  npm run deploy:installed
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { execSync } = require('node:child_process');
const boundary = require('./release-boundary.cjs');
const { computeDistFingerprint } = require('./compute-dist-fingerprint.cjs');

const REPO = boundary.REPO;
const INSTALLED = boundary.INSTALLED;
const RESOURCES = boundary.RESOURCES;
void os;

/**
 * Each entry: repo artifact → installed destination.
 * `required` artifacts abort the deploy when missing (a half-built tree must not
 * be shipped); optional ones are reported and skipped.
 */
const TARGETS = [
  { name: 'server/dist', src: path.join(REPO, 'server', 'dist'), dst: path.join(RESOURCES, 'server', 'dist'), required: true },
  { name: 'server/scripts', src: path.join(REPO, 'server', 'scripts'), dst: path.join(RESOURCES, 'server', 'scripts'), required: false },
  { name: 'app/dist-electron', src: path.join(REPO, 'dist-electron'), dst: path.join(RESOURCES, 'app', 'dist-electron'), required: true },
  { name: 'app/dist (frontend)', src: path.join(REPO, 'dist'), dst: path.join(RESOURCES, 'app', 'dist'), required: true },
];

function fail(message) {
  console.error(`[deploy] FAILED: ${message}`);
  process.exit(1);
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else n++;
    }
  };
  walk(dir);
  return n;
}

/** Byte-compare two trees; returns the first differing relative path, or null. */
function firstDifference(a, b) {
  const walk = (dir, rel, out) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relChild = rel ? path.join(rel, entry.name) : entry.name;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, relChild, out);
      else out.push({ rel: relChild, file: p });
    }
  };
  const listA = [];
  const listB = [];
  walk(a, '', listA);
  walk(b, '', listB);
  if (listA.length !== listB.length) return `file count differs (repo ${listA.length} vs installed ${listB.length})`;
  const setB = new Map(listB.map((e) => [e.rel, e.file]));
  for (const ea of listA) {
    const other = setB.get(ea.rel);
    if (!other) return `missing in installed tree: ${ea.rel}`;
    if (!fs.readFileSync(ea.file).equals(fs.readFileSync(other))) return `content differs: ${ea.rel}`;
  }
  return null;
}

console.log(`[deploy] repo      : ${REPO}`);
console.log(`[deploy] installed : ${INSTALLED}`);

if (!fs.existsSync(RESOURCES)) fail(`installed resources dir not found: ${RESOURCES} (set AGENTICOS_INSTALLED to override)`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const results = [];

// ── Phase 1: break every link between the installed runtime and the repository ──
// Outer links (e.g. resources/server) are materialized into real copies so the
// non-deployed content (node_modules, data) keeps working; nothing is deleted
// through a link.
const linkReport = { before: boundary.inspectInstalled(), actions: [] };
if (linkReport.before.length) {
  console.log('[deploy] RELEASE BOUNDARY: installed runtime shares storage with another tree:');
  for (const f of linkReport.before) console.log(`[deploy]   ${f.kind} ${f.path} -> ${f.target}${f.intoRepo ? '  (INTO REPO)' : ''}`);
}
for (let pass = 0; pass < 6; pass++) {
  const links = boundary.inspectInstalled().filter((f) => f.kind === 'link');
  if (!links.length) break;
  const l = links[0]; // outermost first
  const isTargetDir = TARGETS.some((t) => path.resolve(t.dst).toLowerCase() === path.resolve(l.path).toLowerCase());
  if (isTargetDir) {
    // About to be replaced anyway: back up what it shows, then remove the link entry only.
    const backup = `${l.path}.backup-${stamp}`;
    fs.cpSync(l.target, backup, { recursive: true });
    const target = boundary.removeLinkOnly(l.path);
    linkReport.actions.push({ action: 'unlinked', path: l.path, target, backup });
    console.log(`[deploy] unlinked ${l.path} (was -> ${target}); backup ${path.basename(backup)}`);
  } else {
    const target = boundary.materializeLink(l.path);
    linkReport.actions.push({ action: 'materialized', path: l.path, target });
    console.log(`[deploy] materialized ${l.path} (was -> ${target}) into an independent copy`);
  }
}
const stillShared = boundary.inspectInstalled();
if (stillShared.length) fail(`installed runtime still shares storage: ${JSON.stringify(stillShared)}`);

for (const t of TARGETS) {
  if (!fs.existsSync(t.src)) {
    if (t.required) fail(`${t.name} not built — run the canonical build first (npm run build)`);
    console.log(`[deploy] SKIP ${t.name} (not built)`);
    continue;
  }

  const files = countFiles(t.src);
  if (files === 0) {
    if (t.required) fail(`${t.name} is empty — refusing to deploy an empty tree`);
    console.log(`[deploy] SKIP ${t.name} (empty)`);
    continue;
  }

  if (boundary.isLinkEntry(t.dst) || boundary.resolvesIntoRepo(t.dst)) fail(`${t.dst} is linked to the repo; refusing to delete through it`);
  if (fs.existsSync(t.dst)) {
    const backup = `${t.dst}.backup-${stamp}`;
    fs.cpSync(t.dst, backup, { recursive: true });
    console.log(`[deploy] backup ${t.name} -> ${path.basename(backup)}`);
    // Complete replacement, never a merge.
    fs.rmSync(t.dst, { recursive: true, force: true });
  } else {
    fs.mkdirSync(path.dirname(t.dst), { recursive: true });
  }

  fs.cpSync(t.src, t.dst, { recursive: true });
  const diff = firstDifference(t.src, t.dst);
  if (diff) fail(`${t.name} parity check failed after copy: ${diff}`);

  console.log(`[deploy] OK ${t.name}: ${files} file(s), parity verified`);
  results.push({ name: t.name, files });
}

// ── Phase 1: deployment record (persisted beside the deployed code) ──────────
function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
}
let builtIdentity = {};
try { builtIdentity = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'server', 'dist', 'build-identity.json'), 'utf8')); } catch { /* unknown */ }
const headSha = git('rev-parse HEAD');
const porcelain = git('status --porcelain -uno');
const deployedFp = computeDistFingerprint(path.join(RESOURCES, 'server', 'dist'));
const record = {
  deployedAt: new Date().toISOString(),
  deployedBy: 'deploy-installed.cjs',
  sourceRepo: REPO,
  // Code identity = what was BUILT (stamped at build time), not merely the current HEAD.
  gitSha: builtIdentity.gitSha || null,
  isDirty: typeof builtIdentity.isDirty === 'boolean' ? builtIdentity.isDirty : null,
  buildId: builtIdentity.buildId || null,
  buildTimestamp: builtIdentity.buildTimestamp || null,
  fingerprint: deployedFp.fingerprint,
  fingerprintAlgorithm: deployedFp.algorithm,
  filesCount: deployedFp.filesCount,
  repoHeadAtDeploy: headSha,
  repoDirtyAtDeploy: porcelain === null ? null : porcelain.length > 0,
  builtFromCurrentHead: builtIdentity.gitSha && headSha ? builtIdentity.gitSha === headSha : null,
  buildFingerprintMatchesDeployed: builtIdentity.fingerprint ? builtIdentity.fingerprint === deployedFp.fingerprint : null,
  releaseBoundary: { linksFound: linkReport.before, actions: linkReport.actions, linksAfter: [] },
  targets: results,
};
fs.writeFileSync(path.join(RESOURCES, 'server', 'deployment.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(RESOURCES, 'app', 'deployment.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
if (record.buildFingerprintMatchesDeployed === false) console.warn('[deploy] WARNING: build-identity fingerprint != deployed dist fingerprint');
if (record.builtFromCurrentHead === false) console.warn(`[deploy] WARNING: dist was built from ${record.gitSha}, repo HEAD is ${headSha}`);

console.log('');
console.log('[deploy] Summary');
for (const r of results) console.log(`[deploy]   ${r.name}: ${r.files} file(s)`);
console.log(`[deploy]   buildId     : ${record.buildId}`);
console.log(`[deploy]   gitSha      : ${record.gitSha} (dirty=${record.isDirty})`);
console.log(`[deploy]   fingerprint : ${record.fingerprint}`);
console.log(`[deploy]   deployedAt  : ${record.deployedAt}`);
console.log(`[deploy]   links broken: ${linkReport.actions.length}`);
console.log('[deploy] Next: restart the backend through its lifecycle owner —');
console.log('[deploy]   POST /api/health/restart  (Electron respawns it; do not hand-start node)');
