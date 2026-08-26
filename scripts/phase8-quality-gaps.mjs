import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, pairs) {
  let s = readFileSync(path, 'utf8');
  for (const [old, neu] of pairs) {
    const n = s.split(old).length - 1;
    if (n === 0) { console.error(`NOT FOUND in ${path}: ${old.slice(0, 60)}`); process.exit(1); }
    s = s.split(old).join(neu);
    console.log(`replaced ${n}x in ${path}: ${old.slice(0, 50)}…`);
  }
  writeFileSync(path, s);
}

// 1. Surface the CodeX goal's real finalAnswer into the background task resultText.
const adapters = 'B:/AgenticOS/server/src/services/backgroundTasks/adapters.ts';
patch(adapters, [
  [
    "resultText: goal.runSummary?.summary || 'CodeX goal completed.',",
    "resultText: (goal.runSummary as any)?.finalAnswer || (goal.runSummary as any)?.summary || (goal.runSummary as any)?.message || 'CodeX goal completed.',",
  ],
  [
    "resultText: (goal.runSummary as any)?.summary || (goal.runSummary as any)?.finalAnswer || 'CodeX goal completed.',",
    "resultText: (goal.runSummary as any)?.finalAnswer || (goal.runSummary as any)?.summary || (goal.runSummary as any)?.message || 'CodeX goal completed.',",
  ],
  [
    "resultText: (cur as any).runSummary?.summary || (cur as any).runSummary?.finalAnswer || 'CodeX goal completed.',",
    "resultText: (cur as any).runSummary?.finalAnswer || (cur as any).runSummary?.summary || (cur as any).runSummary?.message || 'CodeX goal completed.',",
  ],
]);

// 2. Require CodeX to run the targeted test/build after editing, and report the result.
const codexLoop = 'B:/AgenticOS/server/src/loops/codexLoop.ts';
patch(codexLoop, [
  [
    '- NEVER use echo, printf, cat, type, Get-Content, PowerShell redirection, or shell redirection for normal file reads/writes. They are blocked by the sandbox.',
    '- NEVER use echo, printf, cat, type, Get-Content, PowerShell redirection, or shell redirection for normal file reads/writes. They are blocked by the sandbox.\n- After you edit or create a file, RUN the relevant targeted test (e.g. \"npx vitest run <path>\" or \"npm test\") or build, and report the ACTUAL pass/fail result in your finish message. Do not claim a test passed without running it.',
  ],
]);

console.log('\nAll Phase-8 quality-gap patches applied.');
