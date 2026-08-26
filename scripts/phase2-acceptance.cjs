// phase2-acceptance.cjs — Phase 2: normal CodeX production-path engineering task.
// Dispatch via POST /api/background-tasks → codexService.createGoal → resumeCodexGoalLoop,
// then verify the full tool-runtime criteria against the isolated DEV DB (goal_events payload).
const http = require('http');
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const fs = require('fs');

const BASE = 'http://127.0.0.1:4001';
const DEV_DB = 'C:/Users/Cris/AppData/Local/Temp/agenticos-devtest/agentic-os.db';
const TMP_TEST_PATH = 'B:/AgenticOS/server/src/__tests__/phase2AcceptanceTmp.test.ts';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('request timeout')));
    if (data) r.write(data);
    r.end();
  });
}

const OBJECTIVE = [
  'You are running an end-to-end repository engineering acceptance test (PHASE2_ACCEPTANCE) against the real workspace. Complete every step below IN ORDER and record evidence for each.',
  '',
  '1. Repository root: run `git rev-parse --show-toplevel`. Report the exact output (it must resolve to B:/AgenticOS).',
  '',
  '2. Read these three substantial TypeScript files with the readFile tool and report the total line count shown in each readFile metadata, plus one distinct exported symbol or function name you observed in each:',
  '   (a) server/src/loops/codexLoop.ts',
  '   (b) server/src/loops/fileRead.ts',
  '   (c) server/src/services/backgroundTasks/adapters.ts',
  '',
  '3. server/src/loops/codexLoop.ts is larger than 1000 lines. Read it in THREE separate ranges using startLine: beginning (startLine 1), middle (startLine 700), end (startLine 1400). Report ONE DISTINCT identifier or string literal you saw in each range (the three must be different from each other).',
  '',
  '4. Search the repository for the symbol `resumeCodexGoalLoop` using the searchFiles tool. Report how many matches and in which files.',
  '',
  '5. Run these four commands and report their exact output:',
  '   (a) git status --short',
  '   (b) node --version',
  '   (c) npm --version',
  '   (d) rg --version',
  '',
  '6. Make a harmless temporary test-only modification: create the file `server/src/__tests__/phase2AcceptanceTmp.test.ts` containing a trivial passing vitest test (a describe/it that asserts expect(true).toBe(true)).',
  '',
  '7. Run that specific test file with: npx vitest run --root server src/__tests__/phase2AcceptanceTmp.test.ts  — report the pass result.',
  '',
  '8. Remove only your temporary file: delete `server/src/__tests__/phase2AcceptanceTmp.test.ts`.',
  '',
  '9. Run `git status --short` again and confirm the temporary file is gone and no unrelated files were changed by you.',
  '',
  '10. Emit the finish tool call with a summary clearly labeling the evidence for steps 1-9.',
].join('\n');

async function main() {
  console.log('[dispatch] POST /api/background-tasks worker=codex (auto-approve, isolated DEV)');
  const task = await req('POST', '/api/background-tasks', {
    title: 'PHASE2_ACCEPTANCE — CodeX end-to-end engineering acceptance',
    objective: OBJECTIVE,
    worker: 'codex',
    workspacePath: 'B:\\AgenticOS',
    metadata: { approvalPolicy: 'auto' },
  });

  const taskId = task.taskId || task.id;
  console.log('[dispatch] taskId=', taskId);
  if (!taskId) { console.error('NO TASK ID:', JSON.stringify(task).slice(0, 400)); process.exit(2); }

  const deadline = Date.now() + 420000; // 7 min
  let st = task;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    st = await req('GET', `/api/background-tasks/${taskId}`);
    const s = st.status || st.state || st.lifecycleState;
    console.log('[poll]', s, '|', (st.summary || st.resultSummary || '').toString().slice(0, 90));
    if (['completed', 'failed', 'cancelled', 'error', 'blocked', 'terminated'].includes(s)) break;
  }

  const goalId = st.linkedRunId || st.goalId;
  console.log('=== task status=', st.status, '| goalId=', goalId, '===');

  // Query tool calls from goal_events (state=tool_started → payload = toolCall).
  const db = new Database(DEV_DB, { readonly: true });
  const goal = goalId ? db.prepare('SELECT id, status, run_summary FROM goals WHERE id = ?').get(goalId) : null;
  const events = goalId ? db.prepare("SELECT state, tool, payload FROM goal_events WHERE goal_id = ? AND state = 'tool_started' ORDER BY sequence").all(goalId) : [];
  db.close();

  const toolCalls = events.map(e => { try { return typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload; } catch { return null; } }).filter(Boolean);

  const readFiles = toolCalls.filter(t => t.tool === 'readFile' || t.tool === 'read_file');
  const readFilePaths = readFiles.map(t => (t.arguments && (t.arguments.path || t.path)) || '').filter(Boolean);
  const readFileStartLines = readFiles.map(t => t.arguments && t.arguments.startLine).filter(v => v != null);
  const searchFiles = toolCalls.filter(t => t.tool === 'searchFiles' || t.tool === 'search_files');
  const runCommands = toolCalls.filter(t => t.tool === 'runCommand' || t.tool === 'run_command');
  const runCmdTexts = runCommands.map(t => `${t.arguments && t.arguments.cmd || ''} ${(t.arguments && t.arguments.args || []).join(' ')}`).join(' | ');
  const writeFiles = toolCalls.filter(t => t.tool === 'writeFile' || t.tool === 'write_file');
  const wroteTemp = writeFiles.some(t => String(t.arguments && t.arguments.path || '').includes('phase2AcceptanceTmp'));

  let finalAnswer = '';
  if (goal && goal.run_summary) { try { const s = JSON.parse(goal.run_summary); finalAnswer = s.finalAnswer || s.message || ''; } catch {} }

  const tmpStillExists = fs.existsSync(TMP_TEST_PATH);

  const checks = {
    goalStatus: goal ? goal.status : 'MISSING',
    '1_repoRoot': /B:[\\/]AgenticOS/i.test(finalAnswer + ' ' + runCmdTexts),
    '2_readThreeFiles': ['codexLoop.ts', 'fileRead.ts', 'adapters.ts'].every(f => readFilePaths.some(p => String(p).includes(f))),
    '3_threeRanges': [1, 700, 1400].every(line => readFileStartLines.includes(line)),
    '4_searchFiles': searchFiles.length > 0,
    '5_commands': ['git', 'node', 'npm', 'rg'].every(cmd => runCmdTexts.includes(cmd)),
    '6_wroteTempFile': wroteTemp,
    '7_ranVitest': /vitest/i.test(runCmdTexts),
    '8_tempRemoved': !tmpStillExists,
    '10_completedNaturally': goal ? goal.status === 'completed' : false,
  };

  console.log('\n=== EVIDENCE ===');
  console.log('toolCalls total:', toolCalls.length);
  console.log('readFile count:', readFiles.length, '| paths:', [...new Set(readFilePaths)].slice(0, 10).join(', '));
  console.log('readFile startLines:', [...new Set(readFileStartLines)].sort((a, b) => a - b).join(', '));
  console.log('searchFiles count:', searchFiles.length);
  console.log('runCommands:', runCmdTexts.slice(0, 350));
  console.log('wroteTemp:', wroteTemp, '| tmpStillExists:', tmpStillExists);

  console.log('\n=== CHECKS ===', JSON.stringify(checks, null, 2));

  const failures = Object.entries(checks).filter(([k, v]) => k !== 'goalStatus' && v !== true);
  const pass = failures.length === 0 && checks.goalStatus === 'completed';
  console.log(`\n=== PHASE 2 ${pass ? 'PASS' : 'FAIL'} ===  (failures: ${failures.map(f => f[0]).join(', ') || 'none'})`);
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
