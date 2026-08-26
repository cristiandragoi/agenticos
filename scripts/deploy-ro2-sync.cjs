/* RO2 deploy: backup (DB + dists) + controlled sync (server dist + frontend dist) */
const fs = require('fs');
const path = require('path');
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const DATA = 'C:/Users/Cris/AppData/Roaming/agenticos/data';

// 1. Backups — never overwrite existing ones
for (const [src, dst] of [
  [`${DATA}/agentic-os.db`, `${DATA}/agentic-os.db.backup-ro2-${ts}`],
]) {
  fs.copyFileSync(src, dst);
  console.log('backup:', dst, fs.statSync(dst).size, 'bytes');
}
try { fs.copyFileSync(`${DATA}/agentic-os.db-wal`, `${DATA}/agentic-os.db.backup-ro2-${ts}-wal`); } catch {}
try { fs.copyFileSync(`${DATA}/agentic-os.db-shm`, `${DATA}/agentic-os.db.backup-ro2-${ts}-shm`); } catch {}
fs.cpSync(path.join(RES, 'server/dist'), path.join(RES, `server/dist.bak-ro2-${ts}`), { recursive: true });
console.log('backup: server/dist.bak-ro2-' + ts);
fs.cpSync(path.join(RES, 'app/dist'), path.join(RES, `app/dist.bak-ro2-${ts}`), { recursive: true });
console.log('backup: app/dist.bak-ro2-' + ts);

// 2. Controlled sync (no drizzle changes this milestone)
fs.cpSync('B:/AgenticOS/server/dist', path.join(RES, 'server/dist'), { recursive: true });
console.log('synced server dist');
fs.cpSync('B:/AgenticOS/dist', path.join(RES, 'app/dist'), { recursive: true });
console.log('synced frontend dist');
console.log('RO2 SYNC COMPLETE ts=' + ts);
