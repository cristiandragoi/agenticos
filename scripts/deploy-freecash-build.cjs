/**
 * deploy-freecash-build.cjs — deploy the verified build into the INSTALLED
 * AgenticOS runtime.
 *
 * Follows the repo's established deployment pattern (backup -> complete
 * replacement, never a merge -> per-file sha256 parity verification):
 *   - server/dist      is the ONLY artefact that carries the new FreeCash /
 *                      prerequisite logic (tsc output).
 *   - app/dist         renderer bundle (vite).
 *   - app/dist-electron electron main bundle (tsc -b).
 *
 * Usage:  node scripts/deploy-freecash-build.cjs [--dry-run]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'D:/AgenticOS';
const INSTALLED = 'C:/Users/cd-pr/AppData/Local/Programs/AgenticOS';
const RESOURCES = path.join(INSTALLED, 'resources');

const TARGETS = [
  { name: 'server/dist', src: path.join(REPO, 'server', 'dist'), dst: path.join(RESOURCES, 'server', 'dist'), required: true },
  { name: 'app/dist', src: path.join(REPO, 'dist'), dst: path.join(RESOURCES, 'app', 'dist'), required: false },
  { name: 'app/dist-electron', src: path.join(REPO, 'dist-electron'), dst: path.join(RESOURCES, 'app', 'dist-electron'), required: false },
];

const DRY = process.argv.includes('--dry-run');
const TS = new Date().toISOString().replace(/[:.]/g, '-');

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The FreeCash/prerequisite markers a deployed server/dist MUST contain. */
const MARKERS = [
  { file: 'services/prerequisites/executionGate.js', needles: ['evaluateExecutionGate', 'blocked_waiting_for_auth'] },
  { file: 'services/prerequisites/activeGoalRegistry.js', needles: ['active_operational_goals'] },
  { file: 'services/prerequisites/prerequisiteService.js', needles: ['checkPrerequisites'] },
  { file: 'services/freeCash/freeCashExecutor.js', needles: ['checkAuthenticatedSession', 'inspectAvailableWork', 'resumePendingGoals'] },
  { file: 'services/projectExecution/projectController.js', needles: ['waiting_for_auth', 'workMode', 'freecash_execution'] },
  { file: 'services/backgroundTasks/adapters.js', needles: ['dispatchFreeCashExecutionTask', 'waiting_for_auth'] },
  { file: 'domains/jarvisNext/resultRenderer.js', needles: ['internal_planning', 'external_execution'] },
  { file: 'routers/projects.js', needles: ['freecash/auth'] },
  { file: 'index.js', needles: ['reconcileGoalsOnStartup'] },
];

let failures = 0;
const report = [];

for (const t of TARGETS) {
  if (!fs.existsSync(t.src)) {
    console.log(`${t.name}: SOURCE MISSING (${t.src})${t.required ? ' — ABORT' : ' — skipped'}`);
    if (t.required) failures++;
    continue;
  }
  const srcFiles = walk(t.src).sort();

  // Backup (never overwrite an existing backup; keep history like the repo does).
  if (fs.existsSync(t.dst) && !DRY) {
    const label = t.name.startsWith('server') ? 'dist.bak-server' : `${path.basename(t.dst)}.bak`;
    const bk = path.join(path.dirname(t.dst), `${label}-freecash-${TS}`);
    fs.cpSync(t.dst, bk, { recursive: true });
    console.log(`${t.name}: BACKUP -> ${bk}`);
  }

  if (DRY) {
    console.log(`${t.name}: dry-run — would replace ${fs.existsSync(t.dst) ? walk(t.dst).length : 0} file(s) with ${srcFiles.length}`);
    continue;
  }

  // COMPLETE replacement — no merge (a merged tree would mix two builds).
  fs.rmSync(t.dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(t.dst), { recursive: true });
  fs.cpSync(t.src, t.dst, { recursive: true });

  // Per-file parity verification.
  const dstFiles = walk(t.dst).sort();
  const rel = (arr) => arr.map((f) => path.relative(t.dst === f ? t.dst : t.dst, f));
  void rel;
  let mismatches = 0;
  const missing = [];
  const extra = [];
  const dstMap = new Map(dstFiles.map((f) => [path.relative(t.dst, f), f]));
  for (const f of srcFiles) {
    const r = path.relative(t.src, f);
    const d = dstMap.get(r);
    if (!d) { missing.push(r); continue; }
    dstMap.delete(r);
    if (sha256(f) !== sha256(d)) { mismatches++; console.log(`  HASH DIFF ${r}`); }
  }
  for (const r of dstMap.keys()) extra.push(r);

  const ok = mismatches === 0 && missing.length === 0 && extra.length === 0;
  if (!ok) failures++;
  console.log(
    `${t.name}: ${srcFiles.length} files deployed — ${mismatches} hash mismatch(es), ${missing.length} missing, ${extra.length} extra -> ${ok ? 'MATCH' : 'MISMATCH'}`,
  );
  report.push({ name: t.name, files: srcFiles.length, mismatches, missing: missing.length, extra: extra.length, match: ok });
}

// Marker verification against the DEPLOYED server/dist.
console.log('\n— deployed marker verification —');
const deployedDist = path.join(RESOURCES, 'server', 'dist');
for (const m of MARKERS) {
  const p = path.join(deployedDist, m.file);
  if (!fs.existsSync(p)) { console.log(`  MISSING FILE ${m.file}`); failures++; continue; }
  const text = fs.readFileSync(p, 'utf-8');
  const absent = m.needles.filter((n) => !text.includes(n));
  if (absent.length) { console.log(`  MISSING MARKERS in ${m.file}: ${absent.join(', ')}`); failures++; }
  else console.log(`  ok ${m.file} (${m.needles.length} markers)`);
}

console.log(`\nDEPLOY ${failures === 0 ? 'VERIFIED' : 'FAILED'} (${failures} problem(s))`);
process.exit(failures === 0 ? 0 : 1);
