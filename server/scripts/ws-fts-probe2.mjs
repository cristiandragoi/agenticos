// Probe 2: call searchWorkspace through the compiled service exactly like the test.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { indexWorkspace, clearWorkspaceIndex, searchWorkspace, getIndexStatus } from '../dist/services/workspaceIndexer.js';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-probe2-'));
fs.mkdirSync(path.join(fixture, 'src/utils'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'src/index.ts'), 'export function renderThing() {\n  return "duplicate-term";\n}\n', 'utf-8');
fs.writeFileSync(path.join(fixture, 'src/utils/helpers.ts'), 'export const helper = () => "duplicate-term";\n', 'utf-8');
fs.mkdirSync(path.join(fixture, 'config'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'config/app.yaml'), 'name: agenticos\nmode: local\n', 'utf-8');

clearWorkspaceIndex({ rootOverride: fixture });
const stats = indexWorkspace({ rootOverride: fixture });
console.log('indexed:', stats.filesIndexed, 'total:', stats.filesTotal);
console.log('status:', JSON.stringify(getIndexStatus({ rootOverride: fixture })));

const exact = searchWorkspace({ rootOverride: fixture, query: 'duplicate-term', mode: 'exact' });
console.log('EXACT total:', exact.total, exact.results.map((r) => r.relPath));

const text = searchWorkspace({ rootOverride: fixture, query: 'duplicate-term', mode: 'text' });
console.log('TEXT total:', text.total, 'error:', text.error, text.results.map((r) => r.relPath + ':' + r.line));

const phrase = searchWorkspace({ rootOverride: fixture, query: 'name agenticos', mode: 'text' });
console.log('PHRASE total:', phrase.total, 'error:', phrase.error);

try { fs.rmSync(fixture, { recursive: true, force: true }); } catch {}
try { clearWorkspaceIndex({ rootOverride: fixture }); } catch {}
