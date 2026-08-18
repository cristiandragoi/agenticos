// Raw OpenAI-compatible chat test against OpenRouter with the same model the
// gateway selects. No secrets printed. Mirrors the gateway adapter's request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', 'server', '.env');
const envText = fs.readFileSync(envPath, 'utf8');
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
};
const key = get('OPENROUTER_API_KEY');
const base = get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
const model = get('OPENROUTER_MODEL') || 'auto';

const out = { base, model, keyLen: key ? key.length : 0 };

// non-stream attempt
try {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are Jarvis. Keep answers short.' },
        { role: 'user', content: 'Reply with exactly: Jarvis is working.' },
      ],
      max_tokens: 50,
      stream: false,
    }),
    signal: AbortSignal.timeout(30000),
  });
  out.nonStreamStatus = r.status;
  const text = await r.text();
  out.nonStreamBody = text.slice(0, 600);
} catch (e) {
  out.nonStreamError = String(e.message || e);
}

// streaming attempt (SSE)
try {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are Jarvis. Keep answers short.' },
        { role: 'user', content: 'Reply with exactly: Jarvis is working.' },
      ],
      max_tokens: 50,
      stream: true,
    }),
    signal: AbortSignal.timeout(30000),
  });
  out.streamStatus = r.status;
  const text = await r.text();
  out.streamBodyPreview = text.slice(0, 400);
} catch (e) {
  out.streamError = String(e.message || e);
}

console.log('CHAT_TEST ' + JSON.stringify(out));
