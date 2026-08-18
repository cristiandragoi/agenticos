// Inspect legacy memoryEntries.json (shape + count + sample).
import fs from 'fs';
const p = 'B:/AgenticOS/server/data/memoryEntries.json';
try {
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (Array.isArray(d)) {
    console.log('array len', d.length);
    console.log(JSON.stringify(d.slice(0, 3), null, 1).slice(0, 500));
  } else {
    const keys = Object.keys(d);
    console.log('object keys', keys.length, 'sample', keys.slice(0, 5));
    const first = d[keys[0]];
    console.log(JSON.stringify(first, null, 1).slice(0, 400));
  }
} catch (e) {
  console.log('ERR', String(e).slice(0, 200));
}
