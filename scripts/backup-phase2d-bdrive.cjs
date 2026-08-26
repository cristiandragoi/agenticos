// backup-phase2d-bdrive.cjs — stage Phase 2D backups + built artifacts on B: drive
// (C: is full). Consistent Roaming DB snapshot via VACUUM INTO + copy of built dist.
const fs = require('fs');
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = `B:/AgenticOS/docs/backups/phase2d-${ts}`;
fs.mkdirSync(BACKUP_DIR, { recursive: true });

console.log('=== PHASE 2D BACKUP ON B: DRIVE ===');
console.log(`Target: ${BACKUP_DIR}\n`);

// 1. Consistent Roaming DB snapshot → B: (VACUUM INTO is WAL-safe).
const ROAMING_DB = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const dbSnapshot = path.join(BACKUP_DIR, 'agentic-os.roaming-snapshot.db');
if (fs.existsSync(ROAMING_DB)) {
  const src = new Database(ROAMING_DB, { readonly: true });
  src.prepare('VACUUM INTO ?').run(dbSnapshot);
  src.close();
  console.log(`- Roaming DB snapshot: ${dbSnapshot} (${fs.statSync(dbSnapshot).size} bytes)`);
} else {
  console.log('- WARNING: Roaming DB not found; skipping snapshot.');
}

// 2. Copy built artifacts (source of truth for the deploy) → B: backup.
const distBackup = path.join(BACKUP_DIR, 'server-dist');
fs.cpSync('B:/AgenticOS/server/dist', distBackup, { recursive: true });
console.log(`- server/dist → ${distBackup}`);

const appBackup = path.join(BACKUP_DIR, 'app-dist');
fs.cpSync('B:/AgenticOS/dist', appBackup, { recursive: true });
console.log(`- app/dist → ${appBackup}`);

if (fs.existsSync('B:/AgenticOS/dist-electron')) {
  const electronBackup = path.join(BACKUP_DIR, 'dist-electron');
  fs.cpSync('B:/AgenticOS/dist-electron', electronBackup, { recursive: true });
  console.log(`- dist-electron → ${electronBackup}`);
}

// 3. Copy the acceptance trace + contract + checkpoint as evidence.
const evidenceDir = path.join(BACKUP_DIR, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
for (const f of [
  'B:/AgenticOS/docs/phase2d-acceptance-trace.json',
  'B:/AgenticOS/docs/argus-contracts/revenue-operator-phase2d.md',
  'B:/AgenticOS/docs/phase2d-checkpoint.md',
]) {
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join(evidenceDir, path.basename(f)));
    console.log(`- evidence: ${path.basename(f)}`);
  }
}

console.log(`\nBACKUP COMPLETE: ${BACKUP_DIR}`);
console.log(`Backup path for report: B:\\AgenticOS\\docs\\backups\\phase2d-${ts}\\`);
