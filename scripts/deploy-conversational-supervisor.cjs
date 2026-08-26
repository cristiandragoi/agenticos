/**
 * Deploy Conversational Supervisor Build to Packaged Runtime
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execSync } = require('child_process');

const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function getHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, o) : o.push(p);
  }
  return o;
}

console.log('=== DEPLOYING CONVERSATIONAL SUPERVISOR TO PACKAGED RUNTIME ===\n');

// 1. Back up packaged resources
console.log('[1/4] Creating backups...');
const serverDistBak = path.join(RES, `backup-server-${ts}`);
if (fs.existsSync(path.join(RES, 'server/dist'))) {
  fs.cpSync(path.join(RES, 'server/dist'), serverDistBak, { recursive: true });
  console.log(`- Backed up server dist to: ${serverDistBak}`);
}

const appDistBak = path.join(RES, `backup-app-${ts}`);
if (fs.existsSync(path.join(RES, 'app/dist'))) {
  fs.cpSync(path.join(RES, 'app/dist'), appDistBak, { recursive: true });
  console.log(`- Backed up app dist to: ${appDistBak}`);
}

// 2. Controlled sync
console.log('\n[2/4] Deploying built artifacts to packaged app...');
fs.cpSync('B:/AgenticOS/server/dist', path.join(RES, 'server/dist'), { recursive: true });
console.log('- Synced server/dist');
fs.cpSync('B:/AgenticOS/dist', path.join(RES, 'app/dist'), { recursive: true });
console.log('- Synced app/dist');
if (fs.existsSync('B:/AgenticOS/dist-electron')) {
  fs.cpSync('B:/AgenticOS/dist-electron', path.join(RES, 'app/dist-electron'), { recursive: true });
  console.log('- Synced app/dist-electron');
}

// 3. Hash verification
console.log('\n[3/4] Verifying deployed artifacts against source build...');
const serverFilesSrc = walk('B:/AgenticOS/server/dist');
let mismatches = 0;
for (const src of serverFilesSrc) {
  const rel = path.relative('B:/AgenticOS/server/dist', src);
  const dst = path.join(RES, 'server/dist', rel);
  if (!fs.existsSync(dst) || getHash(src) !== getHash(dst)) {
    console.error(`Mismatch: ${rel}`);
    mismatches++;
  }
}
if (mismatches > 0) {
  throw new Error(`Deployment failed with ${mismatches} hash mismatches.`);
}
console.log(`✓ All ${serverFilesSrc.length} server/dist files verified matching (SHA-256 100% MATCH).`);

// 4. Restart backend in packaged environment
console.log('\n[4/4] Restarting packaged backend process...');
try {
  const netstat = execSync('powershell "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -Property OwningProcess -Unique"').toString();
  const pidMatches = netstat.match(/\d+/g);
  if (pidMatches) {
    for (const pid of pidMatches) {
      if (parseInt(pid) > 0) {
        console.log(`Terminating process on port 4000: PID ${pid}`);
        try { execSync(`powershell "Stop-Process -Id ${pid} -Force"`); } catch {}
      }
    }
  }
} catch (e) {
  console.log('No existing process or error checking port:', e.message);
}

console.log('\nDeployment completed successfully.');
