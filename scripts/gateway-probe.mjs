// Probe the COMPILED gateway exactly as the running server uses it, to
// capture the real attemptErrors for a Jarvis direct request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');

// Load server/.env into process.env (same as the server does)
const envText = fs.readFileSync(path.join(serverDir, '.env'), 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

const { llmChat, llmChatStream } = await import(pathToFileURL(path.join(serverDir, 'dist', 'services', 'llmGateway.js')).href);

const systemPrompt = 'You are Jarvis, the core orchestration agent of Agentic OS. Keep answers short and direct.';
const prompt = 'Hello Jarvis. Reply with exactly: Jarvis is working.';

// Non-stream path
try {
  const res = await llmChat({ systemPrompt, prompt, history: [], agentId: 'agent-jarvis' });
  console.log('NONSTREAM_RESULT ' + JSON.stringify({ reply: (res.reply || '').slice(0, 120), provider: res.provider, offline: res.offline, error: res.error ? String(res.error).slice(0, 800) : null }));
} catch (e) {
  console.log('NONSTREAM_THREW ' + String(e && e.message || e).slice(0, 800));
}

// Streaming path — capture every chunk type + the error content
try {
  const chunks = [];
  for await (const c of llmChatStream({ systemPrompt, prompt, history: [], agentId: 'agent-jarvis' })) {
    chunks.push({ type: c.type, content: typeof c.content === 'string' ? c.content.slice(0, 200) : c.content, provider: c.provider, model: c.model });
  }
  console.log('STREAM_CHUNKS ' + JSON.stringify(chunks));
} catch (e) {
  console.log('STREAM_THREW ' + String(e && e.message || e).slice(0, 800));
}
