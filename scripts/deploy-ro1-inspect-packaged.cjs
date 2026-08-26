/* RO1 deploy: inspect packaged drizzle dir + dist routers/services + repoServerRoot */
const fs = require('fs');
const path = require('path');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';

console.log('=== packaged drizzle files ===');
console.log(fs.readdirSync(path.join(RES, 'server/drizzle')).join('\n'));

console.log('\n=== packaged dist routers (revenue*) ===');
console.log(fs.readdirSync(path.join(RES, 'server/dist/routers')).filter(f => /revenue/i.test(f)).join('\n') || '(none)');

console.log('\n=== packaged dist services (revenue*) ===');
console.log(fs.readdirSync(path.join(RES, 'server/dist/services')).filter(f => /revenue/i.test(f)).join('\n') || '(none)');

console.log('\n=== packaged revenue.js measurements count ===');
const revJs = path.join(RES, 'server/dist/routers/revenue.js');
if (fs.existsSync(revJs)) {
  console.log((fs.readFileSync(revJs, 'utf-8').match(/measurements/g) || []).length);
} else {
  console.log('revenue.js NOT PRESENT');
}

console.log('\n=== packaged index.js revenueOperator/engine mount? ===');
const idxJs = path.join(RES, 'server/dist/index.js');
const idx = fs.readFileSync(idxJs, 'utf-8');
console.log('revenueOperator mount:', idx.includes('revenueOperator'));
console.log('revenueEngine mount:', idx.includes('revenueEngine'));

console.log('\n=== repoServerRoot resolution ===');
const dbIdx = fs.readFileSync(path.join(RES, 'server/dist/db/index.js'), 'utf-8');
const lines = dbIdx.split('\n');
const li = lines.findIndex(l => l.includes('repoServerRoot'));
console.log(lines.slice(Math.max(0, li - 2), li + 10).join('\n'));

console.log('\n=== packaged build-identity ===');
try { console.log(fs.readFileSync(path.join(RES, 'server/dist/build-identity.json'), 'utf-8')); } catch (e) { console.log('no build-identity.json'); }
console.log('\n=== repo fresh build-identity ===');
try { console.log(fs.readFileSync('B:/AgenticOS/server/dist/build-identity.json', 'utf-8')); } catch (e) { console.log('no build-identity.json in repo'); }
