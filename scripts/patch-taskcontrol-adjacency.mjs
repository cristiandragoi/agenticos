// Surgical fix: reject compound words ("task-queue") in the verb-adjacency regex.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'B:/AgenticOS/server/src/services/backgroundTasks/taskControl.ts';
let s = readFileSync(f, 'utf8');
const old = 'tasks?\\b/i;';
const neu = 'tasks?(?![-\u005cw])/i;';
if (!s.includes(old)) { console.error('OLD NOT FOUND'); process.exit(1); }
if (s.split(old).length - 1 !== 1) { console.error('OLD NOT UNIQUE'); process.exit(1); }
s = s.replace(old, neu);
writeFileSync(f, s);
console.log('patched: tasks?\\b -> tasks?(?![-\u005cw])');
