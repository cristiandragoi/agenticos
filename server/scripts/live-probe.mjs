// LIVE config truth probe — masked, never prints secret VALUES.
// 1. Hermes profile .env: does API_SERVER_KEY exist? (PRESENT/MISSING only)
// 2. Are the api_server candidate ports live? What do they answer?
// 3. Ollama base URL + /api/tags health (no secrets).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadEnvFile } from 'node:process';

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const profileEnv = path.join(localAppData, 'hermes', 'profiles', 'backend-engineer', '.env');
let apiServerKey = 'MISSING';
if (fs.existsSync(profileEnv)) {
  const content = fs.readFileSync(profileEnv, 'utf8');
  const m = content.match(/^API_SERVER_KEY=(.+)$/m);
  apiServerKey = m && m[1] ? 'PRESENT' : 'MISSING (no API_SERVER_KEY line)';
} else {
  apiServerKey = 'MISSING (profile .env file absent)';
}
console.log('HERMES profile .env path:', profileEnv);
console.log('API_SERVER_KEY in profile .env:', apiServerKey);

for (const port of [8642, 8643]) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: ctrl.signal });
    clearTimeout(t);
    console.log(`port ${port}: RESPONDS HTTP ${res.status}`);
  } catch (e) {
    console.log(`port ${port}: unreachable (${e?.name || 'error'})`);
  }
}

// Ollama: same base URL the gateway would use (masked value).
const ollamaBase = process.env.OLLAMA_BASE_URL || '(env not set in this process)';
console.log('OLLAMA_BASE_URL (this process):', typeof ollamaBase === 'string' && ollamaBase.includes('://') ? 'set' : ollamaBase);
try {
  const res = await fetch('http://127.0.0.1:11434/api/tags');
  const data = await res.json();
  const names = (data.models || []).map((m) => m.name);
  console.log('ollama /api/tags:', res.status, '| models:', names.join(', '));
} catch (e) {
  console.log('ollama /api/tags: unreachable', e?.name);
}
