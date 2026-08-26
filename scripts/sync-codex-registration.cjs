const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = 'B:/AgenticOS/server/dist';
const DST = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist';

function hash(f) {
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
}

// Sync server/dist -> packaged resources/server/dist (targeted, code-only)
fs.cpSync(SRC, DST, { recursive: true });
console.log('Synced server/dist -> packaged resources/server/dist');

// Verify index.js byte-identical
const src = path.join(SRC, 'index.js');
const dst = path.join(DST, 'index.js');
const hs = hash(src), hd = hash(dst);
console.log(`index.js  source sha256: ${hs}`);
console.log(`index.js deployed sha256: ${hd}`);
console.log(`MATCH: ${hs === hd}`);

// Confirm rt-codex registration present in deployed dist
const deployedContent = fs.readFileSync(dst, 'utf8');
const hasCodex = deployedContent.includes('runtimeRegistry.register(new CodexAdapter())');
console.log(`deployed index.js contains CodexAdapter registration: ${hasCodex}`);
if (!hasCodex || hs !== hd) process.exit(1);
