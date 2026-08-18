// Raw OpenRouter with the FULL jarvis-style prompt (FACT + last conversation
// history) — determines whether the model itself generates the scrambled
// text under the real prompt, or whether the router scrambles it.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');

const envPath = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/.env';
const envText = fs.readFileSync(envPath, 'utf8');
const key = (envText.match(/^OPENROUTER_API_KEY=(.*)$/m) || [])[1]?.trim();
const base = (envText.match(/^OPENROUTER_BASE_URL=(.*)$/m) || [])[1]?.trim() || 'https://openrouter.ai/api/v1';
const model = (envText.match(/^OPENROUTER_MODEL=(.*)$/m) || [])[1]?.trim() || 'poolside/laguna-s-2.1:free';

// Replicate the jarvis direct system prompt (identity FACT + concision).
const systemPrompt = [
  'You are Jarvis, a concise, truthful assistant. Answer the user directly in as few sentences as needed.',
  'FACT — your current runtime identity (the ONLY correct answer when asked). You are running Laguna S 2.1 via OpenRouter, with Llama 3.2 available locally as a fallback. When asked what model or provider you use, answer naturally in ONE short sentence using those friendly names (for example: "I\'m running Laguna S 2.1 via OpenRouter, with Llama 3.2 available locally as a fallback."). Truth anchor if ever unsure: raw provider identifier \'openrouter\', raw model identifier \'poolside/laguna-s-2.1:free\', fallback \'llama3.2:3b\' — never invent provider or model names beyond these.',
  'Use the conversation history to keep the subject across turns.',
  'Input channel: typed text.',
].join('\n');

// Last real history from the deployed DB (minus the newest user prompt)
const db = new Database('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db', { readonly: true });
const rows = db.prepare(`
  SELECT role, content FROM conversation_messages
  WHERE conversation_id = 'conv-e41484b4-' AND role IN ('user','agent')
  ORDER BY created_at DESC, rowid DESC LIMIT 6
`).all().reverse();
db.close();
const history = rows.map((r) => ({ role: r.role === 'agent' ? 'assistant' : 'user', content: r.content }));

const messages = [
  { role: 'system', content: systemPrompt },
  ...history,
  { role: 'user', content: 'What model are you using?' },
];
console.log('HISTORY:', JSON.stringify(history.map((h) => `${h.role}:${h.content.slice(0, 60)}`)));

const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
  body: JSON.stringify({ model, messages, stream: true, max_tokens: 1024 }),
  signal: AbortSignal.timeout(90000),
});
console.log('HTTP', res.status);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
const deltas = [];
let seq = 0;
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const raw = t.slice(5).trim();
    if (raw === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    seq += 1;
    const content = ev?.choices?.[0]?.delta?.content;
    if (typeof content === 'string') deltas.push({ seq, content });
  }
}
console.log('DELTAS:', deltas.map((d) => `[${d.seq}]"${d.content}"`).join(' ').slice(0, 1200));
console.log('JOINED:', JSON.stringify(deltas.map((d) => d.content).join('')));
