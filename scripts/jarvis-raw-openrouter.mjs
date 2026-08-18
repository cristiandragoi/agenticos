// RAW OpenRouter stream for the same prompt/system — capture the exact
// SSE delta order from the provider itself (key from deployed .env, never
// printed). Separates provider behavior from gateway/router behavior.
import fs from 'node:fs';

const envPath = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/.env';
const envText = fs.readFileSync(envPath, 'utf8');
const key = (envText.match(/^OPENROUTER_API_KEY=(.*)$/m) || [])[1]?.trim();
const base = (envText.match(/^OPENROUTER_BASE_URL=(.*)$/m) || [])[1]?.trim() || 'https://openrouter.ai/api/v1';
const model = (envText.match(/^OPENROUTER_MODEL=(.*)$/m) || [])[1]?.trim() || 'poolside/laguna-s-2.1:free';
if (!key) { console.log('NO KEY'); process.exit(1); }

const systemPrompt = 'You are Jarvis, a concise, truthful assistant. Answer the user directly in as few sentences as needed.';
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: 'What model are you using?' },
];

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
    const usage = ev?.usage;
    if (typeof content === 'string') deltas.push({ seq, content });
    if (usage) console.log('USAGE_SEEN:', JSON.stringify(usage).slice(0, 120));
  }
}
console.log('DELTAS:', deltas.map((d) => `[${d.seq}]"${d.content}"`).join(' ').slice(0, 1500));
console.log('JOINED:', JSON.stringify(deltas.map((d) => d.content).join('')));
