const http = require('http');
const fs = require('fs');
const path = require('path');

const vaultPath = path.join(process.cwd(), 'TestVault');
if (!fs.existsSync(vaultPath)) {
  fs.mkdirSync(vaultPath);
}

const memoryEntry = {
  id: 'mem-test-999',
  scopeId: 'agent',
  kind: 'note',
  title: 'Test Verification Memory',
  content: 'This memory was generated to prove the Obsidian sync works.',
  sourceType: 'run',
  sourceId: 'run-12345',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  syncStatus: 'pending'
};

const config = {
  vaultPath,
  folderMapping: {
    'agent': 'Agents',
    'global': 'Global'
  }
};

const agentDir = path.join(vaultPath, 'Agents');
if (!fs.existsSync(agentDir)) {
  fs.mkdirSync(agentDir);
}

// 1. Queue it
const req1 = http.request({
  hostname: 'localhost',
  port: 4000,
  path: '/api/sync/queue',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res1) => {
  res1.on('data', () => {});
  res1.on('end', () => {
    console.log('[1] Queued memory entry mem-test-999');
    
    // 2. Sync now
    const req2 = http.request({
      hostname: 'localhost',
      port: 4000,
      path: '/api/sync/now',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res2) => {
      res2.on('data', () => {});
      res2.on('end', () => {
        console.log('[2] Triggered sync now');
        
        // 3. Verify file
        const expectedFile = path.join(agentDir, 'Test Verification Memory.md');
        if (fs.existsSync(expectedFile)) {
          console.log('[3] File written successfully:', expectedFile);
          console.log('--- File Content ---');
          console.log(fs.readFileSync(expectedFile, 'utf8'));
        } else {
          console.log('[3] Error: File not found at', expectedFile);
        }
      });
    });
    req2.write(JSON.stringify({ config }));
    req2.end();
  });
});

req1.write(JSON.stringify({ memoryEntry, config }));
req1.end();
