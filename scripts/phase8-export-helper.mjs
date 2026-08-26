import { readFileSync, writeFileSync } from 'node:fs';
const f = 'B:/AgenticOS/server/src/services/backgroundTasks/adapters.ts';
let s = readFileSync(f, 'utf8');
const old = 'function detectsCodexDelegation(objective: string): boolean {';
const neu = 'export function detectsCodexDelegation(objective: string): boolean {';
if (!s.includes(old)) { console.error('not found'); process.exit(1); }
s = s.replace(old, neu);
writeFileSync(f, s);
console.log('exported detectsCodexDelegation');
