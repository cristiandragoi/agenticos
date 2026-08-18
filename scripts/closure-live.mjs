// Live closure acceptance: (1) human memory via API, (2) promote Hermes candidates via the
// service module directly against the production DB (read-write), (3) worker retrieval.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SERVER_NM = 'B:/AgenticOS/server/node_modules/';
const Database = require(path.join(SERVER_NM, 'better-sqlite3'));

// Load the compiled service modules directly (they use the production DB).
const { memoryStore, ensureMemoryTables } = await import('../server/dist/services/memory/store.js');
const { createMemory } = await import('../server/dist/services/memory/distill.js');
const { promoteHermesCandidates, retrieveWorkerMemory } = await import('../server/dist/services/memory/workerMemory.js');

ensureMemoryTables();
const PROJ = 'proj-closure-live';

// 1. Human-confirmed memory semantics
const human = createMemory({
  type: 'preference',
  title: 'Live human preference',
  summary: 'Human-stated fact via API path.',
  content: 'The human operator confirmed this preference directly.',
  scope: `project:${PROJ}`,
  entities: [PROJ],
  tags: ['human', 'project'],
  confidence: 0.99,
  source: { sourceType: 'human' },
  verificationStatus: 'human_confirmed',
});
console.log('HUMAN:', human.id, 'verificationStatus=', human.verificationStatus, 'sourceType=', human.source.sourceType);

// 2. Hermes candidate promotion — PASS promotes
const chain = await promoteHermesCandidates({
  projectId: PROJ,
  sourceRunId: 'hr-live-run-1',
  sourceResultId: 'exr-live-result-1',
  verificationId: 'ver-live-1',
  verificationVerdict: 'PASS',
  candidates: [
    { key: 'Verified research: market is Germany', value: 'Verified research shows the primary market is Germany.', category: 'research' },
    { key: 'Constraint: no cold outreach', value: 'Project constraint: no automated outreach without human approval.', category: 'constraint' },
  ],
  scope: `project:${PROJ}`,
});
console.log('PROMOTED:', JSON.stringify(chain.candidates));

// 3. FAIL / NOT_PROVEN never promote, never discard
const failChain = await promoteHermesCandidates({
  projectId: PROJ,
  sourceRunId: 'hr-live-run-2',
  sourceResultId: 'exr-live-result-2',
  verificationId: 'ver-live-2',
  verificationVerdict: 'FAIL',
  candidates: [{ key: 'Unverified claim', value: 'Should not promote.' }],
  scope: `project:${PROJ}`,
});
console.log('FAIL-CHAIN:', JSON.stringify(failChain.candidates));
const notProven = await promoteHermesCandidates({
  projectId: PROJ,
  sourceRunId: 'hr-live-run-3',
  sourceResultId: 'exr-live-result-3',
  verificationId: 'ver-live-3',
  verificationVerdict: 'NOT_PROVEN',
  candidates: [{ key: 'Pending fact', value: 'Not proven yet.' }],
  scope: `project:${PROJ}`,
});
console.log('NOTPROVEN-CHAIN:', JSON.stringify(notProven.candidates));

// 4. Candidate store shows all (never discarded)
const candidates = memoryStore.listCandidates({ projectId: PROJ, limit: 20 });
console.log('CANDIDATE-COUNT:', candidates.length, candidates.map((c) => `${c.key}:${c.status}`).join(' | '));

// 5. Retrieval — engineering vs research
const eng = await retrieveWorkerMemory({ projectId: PROJ, worker: 'codex', query: 'production market constraint', budget: { maxItems: 6, maxChars: 3000 } });
console.log('ENGINEERING-PACKET:', JSON.stringify({ ids: eng.memoryIds, count: eng.count, truncated: eng.truncated, titles: eng.items.map((i) => i.title) }));

const research = await retrieveWorkerMemory({ projectId: PROJ, worker: 'hermes', query: 'market research', budget: { maxItems: 6, maxChars: 3000 } });
console.log('RESEARCH-PACKET:', JSON.stringify({ ids: research.memoryIds, count: research.count, titles: research.items.map((i) => i.title) }));
