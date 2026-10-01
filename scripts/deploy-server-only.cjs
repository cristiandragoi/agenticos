// Phase 1 release boundary: retired. scripts/deploy-installed.cjs is the ONLY deploy path
// (it breaks repo<->installed links, verifies parity and writes deployment.json).
// The original implementation is kept below for reference but is unreachable.
console.error('[deploy] ' + require('path').basename(__filename) + ' is retired. Use: node scripts/deploy-installed.cjs');
process.exit(1);
// deploy-server-only.cjs — sync ONLY server/dist (server-only change), backup + hash-verify
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PKG = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const SRC = 'B:/AgenticOS/server/dist';
const DST = path.join(PKG, 'server/dist');
function sha256(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p,o):o.push(p)}return o;}
const ts=new Date().toISOString().replace(/[:.]/g,'-');
const bk=path.join(PKG,`backup-server-${ts}`);
fs.cpSync(DST, bk, {recursive:true});
console.log('BACKUP ->', bk);
fs.rmSync(DST,{recursive:true,force:true});
fs.cpSync(SRC, DST, {recursive:true});
const a=walk(SRC).sort(), b=walk(DST).sort();
const ar=a.map(f=>path.relative(SRC,f)), br=b.map(f=>path.relative(DST,f));
let mm=0;
if(ar.length!==br.length){console.log('COUNT MISMATCH',ar.length,br.length);process.exit(1);}
for(let i=0;i<a.length;i++){if(sha256(a[i])!==sha256(b[i])){mm++;console.log('DIFF',ar[i]);}}
console.log(`server/dist: ${a.length} files, ${mm} mismatches -> ${mm?'MISMATCH':'MATCH'}`);
process.exit(mm?1:0);
