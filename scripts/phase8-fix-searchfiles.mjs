import { readFileSync, writeFileSync } from 'node:fs';
const f = 'B:/AgenticOS/server/src/loops/codexLoop.ts';
let s = readFileSync(f, 'utf8');

// Replace the rgArgs line (no backslashes) — add the nameGlob pushdown.
const aOld = "const rgArgs = ['--files', '--no-follow', ...exclude, ...(glob ? ['-g', String(glob)] : []), searchPath];";
const aNew = "const nameGlob = pattern === '*' ? '*' : `*${pattern}*`;\n              const rgArgs = ['--files', '--no-follow', ...exclude, ...(glob ? ['-g', String(glob)] : []), '-g', nameGlob, searchPath];";
if (s.split(aOld).length - 1 !== 1) { console.error('rgArgs line not unique/found'); process.exit(1); }
s = s.replace(aOld, aNew);

// Replace the filter line (contains \n literal) — drop the JS substring filter.
const bOld = "const matches = stdout.split('\\n').filter((f) => f && (pattern === '*' || f.includes(pattern)));";
const bNew = "const matches = stdout.split('\\n').filter(Boolean);";
if (s.split(bOld).length - 1 !== 1) { console.error('matches line not unique/found'); process.exit(1); }
s = s.replace(bOld, bNew);

writeFileSync(f, s);
console.log('fixed searchFiles files-target (glob pushdown)');
