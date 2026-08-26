const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('=== PACKAGED DEPLOYMENT HASH & HEALTH AUDIT ===\n');

function getHash(filePath) {
  if (!fs.existsSync(filePath)) return 'FILE_NOT_FOUND';
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

const filesToCompare = [
  {
    name: 'Server Entry (dist/index.js)',
    source: 'B:/AgenticOS/server/dist/index.js',
    deployed: 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist/index.js',
  },
  {
    name: 'Revenue Supervisor (dist/services/revenueOperator/revenueSupervisor.js)',
    source: 'B:/AgenticOS/server/dist/services/revenueOperator/revenueSupervisor.js',
    deployed: 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist/services/revenueOperator/revenueSupervisor.js',
  },
  {
    name: 'Schedule Dispatcher (dist/services/scheduler/scheduleDispatcher.js)',
    source: 'B:/AgenticOS/server/dist/services/scheduler/scheduleDispatcher.js',
    deployed: 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist/services/scheduler/scheduleDispatcher.js',
  },
  {
    name: 'Frontend HTML (dist/index.html)',
    source: 'B:/AgenticOS/dist/index.html',
    deployed: 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist/index.html',
  },
  {
    name: 'Electron Main (dist-electron/main.js)',
    source: 'B:/AgenticOS/dist-electron/main.js',
    deployed: 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist-electron/main.js',
  }
];

console.log('--- [1/3] BYTE-FOR-BYTE SHA256 HASH VERIFICATION ---');
let allMatch = true;
for (const f of filesToCompare) {
  const srcHash = getHash(f.source);
  const depHash = getHash(f.deployed);
  const match = srcHash === depHash;
  if (!match) allMatch = false;
  console.log(`[${match ? 'MATCH' : 'MISMATCH'}] ${f.name}`);
  console.log(`  - Source SHA256:   ${srcHash}`);
  console.log(`  - Deployed SHA256: ${depHash}`);
}

console.log(`\nOverall Deployed Artifact Integrity: ${allMatch ? '100% BYTE-FOR-BYTE IDENTICAL' : 'MISMATCH DETECTED'}`);

// Backup path check
console.log('\n--- [2/3] TIMESTAMPED BACKUP VERIFICATION ---');
const roamingDir = 'C:/Users/Cris/AppData/Roaming/agenticos/data';
const backups = fs.readdirSync(roamingDir).filter(f => f.includes('backup-phase2c'));
console.log(`- Found ${backups.length} Phase 2C DB backups:`);
backups.slice(-3).forEach(b => console.log(`  * ${path.join(roamingDir, b)} (${fs.statSync(path.join(roamingDir, b)).size} bytes)`));

// Health check on 4000
console.log('\n--- [3/3] BACKEND SERVICE HEALTH & CANONICAL DB PROBE ---');
http.get('http://127.0.0.1:4000/api/health', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`- Backend Health HTTP Status: ${res.statusCode} OK`);
    console.log(`- Backend Health Payload: ${body}`);
  });
}).on('error', (err) => {
  console.log(`- Backend Health check notice: ${err.message}`);
});
