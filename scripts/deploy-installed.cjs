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
 *
 * It does NOT restart anything: restarting the backend belongs to the Electron
 * lifecycle owner (POST /api/health/restart), not to the deploy step.
 *
 * Usage:  npm run deploy:installed
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = path.resolve(__dirname, '..');
const INSTALLED = process.env.AGENTICOS_INSTALLED
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'AgenticOS');
const RESOURCES = path.join(INSTALLED, 'resources');

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

// Deployed server fingerprint — the value the running backend must report.
let deployedBuildId = 'unknown';
try {
  const identity = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'server', 'dist', 'build-identity.json'), 'utf8'));
  deployedBuildId = identity.buildId || 'unknown';
} catch { /* reported as unknown rather than guessed */ }

console.log('');
console.log('[deploy] Summary');
for (const r of results) console.log(`[deploy]   ${r.name}: ${r.files} file(s)`);
console.log(`[deploy]   deployed server buildId: ${deployedBuildId}`);
console.log('[deploy] Next: restart the backend through its lifecycle owner —');
console.log('[deploy]   POST /api/health/restart  (Electron respawns it; do not hand-start node)');
