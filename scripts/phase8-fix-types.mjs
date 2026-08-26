import { readFileSync, writeFileSync } from 'node:fs';
const f = 'B:/AgenticOS/server/src/services/backgroundTasks/adapters.ts';
let s = readFileSync(f, 'utf8');

// Fix 1: projectId must be a non-null string.
const a = '    const projectId = (task.projectId as string | null) ?? null;';
const b = "    const projectId = task.projectId ?? ('bg-' + task.taskId);";
if (!s.includes(a)) { console.error('FIX1 old not found'); process.exit(1); }
s = s.replace(a, b);

// Fix 2: goalStateToTaskStatus returns status|null; never feed '' into TERMINAL_STATUSES.
const c = "    if (g && TERMINAL_STATUSES.has(goalStateToTaskStatus(g.status) ?? '')) {";
const d = "    const gMapped = g ? goalStateToTaskStatus(g.status) : null;\n    if (g && gMapped && TERMINAL_STATUSES.has(gMapped)) {";
if (!s.includes(c)) { console.error('FIX2 old not found'); process.exit(1); }
s = s.replace(c, d);

writeFileSync(f, s);
console.log('fixed type errors');
