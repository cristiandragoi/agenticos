// debug-filelines.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-'));
const small = 'line-0001\nline-0002\nline-0003\n';
const smallFile = path.join(tmpDir, 'small.ts');
fs.writeFileSync(smallFile, small, 'utf-8');

const content = fs.readFileSync(smallFile, 'utf-8');
console.log('content length:', content.length);
console.log('content JSON:', JSON.stringify(content));
const rawLines = content.split('\n');
console.log('rawLines length:', rawLines.length);
console.log('rawLines JSON:', JSON.stringify(rawLines));
console.log('last element:', JSON.stringify(rawLines[rawLines.length - 1]));

const totalLines = rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
  ? rawLines.length - 1
  : rawLines.length;
console.log('computed totalLines:', totalLines);
fs.rmSync(tmpDir, { recursive: true, force: true });
