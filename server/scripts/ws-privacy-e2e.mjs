// P16 privacy E2E — localOnly project: index + retrieval generate ZERO
// cloud/network calls (captured with real runtime spies, not inference).
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import { indexWorkspace, searchWorkspace } from '../dist/services/workspaceIndexer.js';
import { policyStore } from '../dist/services/policy/policyStore.js';
import { mayLeaveMachine } from '../dist/services/policy/policyService.js';
import { projectsStore } from '../dist/services/projectsStore.js';

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-priv-'));
fs.mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(fixtureRoot, 'src/a.ts'), 'export const privateLocal = "sensitive-local-content";\n', 'utf-8');
fs.writeFileSync(path.join(fixtureRoot, 'notes.md'), '# Local notes\n\nprivateLocal marker here.\n', 'utf-8');

const projectId = `proj-priv-e2e-${Date.now()}`;

// ── Real network spies ─────────────────────────────────────────
let fetchCalls = 0;
let httpCalls = 0;
let httpsCalls = 0;
const origFetch = globalThis.fetch;
const origHttpReq = http.request;
const origHttpsReq = https.request;
globalThis.fetch = function (...args) { fetchCalls += 1; return origFetch ? origFetch(...args) : Promise.reject(new Error('fetch disabled')); };
http.request = function (...args) { httpCalls += 1; return origHttpReq(...args); };
https.request = function (...args) { httpsCalls += 1; return origHttpsReq(...args); };

async function main() {
  // Create a REAL project with a localOnly policy.
  projectsStore.createProject({ id: projectId, name: 'Privacy E2E', workspacePath: fixtureRoot });
  const policy = policyStore.setPolicy(projectId, {
    privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden',
  });

  console.log('policy:', JSON.stringify(policy));
  console.log('mayLeaveMachine(localOnly):', mayLeaveMachine(policy));

  // Index + search THROUGH the project context.
  const stats = indexWorkspace({ projectId });
  console.log('index stats:', JSON.stringify({ filesIndexed: stats.filesIndexed, filesTotal: stats.filesTotal, durationMs: stats.durationMs, error: stats.error ?? null }));

  const resp = searchWorkspace({ projectId, query: 'privateLocal', mode: 'exact' });
  console.log('search:', JSON.stringify({ chosenMode: resp.chosenMode, total: resp.total, error: resp.error ?? null, paths: resp.results.map((r) => r.relPath) }));

  const textResp = searchWorkspace({ projectId, query: 'local notes', mode: 'text' });
  console.log('text search:', JSON.stringify({ chosenMode: textResp.chosenMode, total: textResp.total, error: textResp.error ?? null }));

  // ── Network evidence ──────────────────────────────────────────
  console.log('\nNETWORK EVIDENCE (real spies during index + both searches):');
  console.log('fetch calls:', fetchCalls);
  console.log('http.request calls:', httpCalls);
  console.log('https.request calls:', httpsCalls);
  const zeroCloudCalls = fetchCalls === 0 && httpCalls === 0 && httpsCalls === 0;
  console.log('ZERO cloud/network calls:', zeroCloudCalls);

  const pass = zeroCloudCalls && !stats.error && resp.total >= 1 && textResp.total >= 1 && !mayLeaveMachine(policy);
  console.log('\nP16 RESULT:', pass ? 'PASS' : 'FAIL');

  projectsStore.deleteProject(projectId);
  globalThis.fetch = origFetch;
  http.request = origHttpReq;
  https.request = origHttpsReq;
  try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error('P16 ERROR', e); process.exitCode = 1; });
