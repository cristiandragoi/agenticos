// Probe: raw FTS5 MATCH behavior for the fixture content.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rawDb } from '../dist/db/index.js';
import { indexWorkspace, normalizeWorkspaceId, clearWorkspaceIndex } from '../dist/services/workspaceIndexer.js';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-probe-'));
fs.writeFileSync(path.join(fixture, 'a.ts'), 'export const duplicate-term = 1;\nconst alpha = 2;\n', 'utf-8');
fs.writeFileSync(path.join(fixture, 'b.ts'), 'export function helper() { return "duplicate-term"; }\n', 'utf-8');
fs.writeFileSync(path.join(fixture, 'c.yaml'), 'name: agenticos\nmode: local\n', 'utf-8');

clearWorkspaceIndex({ rootOverride: fixture });
const stats = indexWorkspace({ rootOverride: fixture });
console.log('indexed:', stats.filesIndexed, 'total:', stats.filesTotal);
const wid = normalizeWorkspaceId(fixture);

const rows = rawDb.prepare('SELECT rel_path, symbols, substr(content,1,60) AS c FROM workspace_index_fts WHERE workspace_id = ?').all(wid);
console.log('FTS rows:', rows.length, rows.map((r) => r.rel_path));

for (const q of ['duplicate', '"duplicate"', '"duplicate-term"', '"duplicate term"', 'term', '"name agenticos"', 'agenticos']) {
  try {
    const r = rawDb.prepare('SELECT COUNT(*) AS n FROM workspace_index_fts WHERE workspace_index_fts MATCH ? AND workspace_id = ?').get(q, wid);
    console.log(`MATCH ${JSON.stringify(q)} → ${r.n}`);
  } catch (e) {
    console.log(`MATCH ${JSON.stringify(q)} → ERROR ${e.message}`);
  }
}

try { fs.rmSync(fixture, { recursive: true, force: true }); } catch {}
try { clearWorkspaceIndex({ rootOverride: fixture }); } catch {}
