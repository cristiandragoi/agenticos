// Probe the Hermes api_server on :8643 using the real API_SERVER_KEY,
// WITHOUT ever printing the key. Prints only the HTTP status + body.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const localAppData = process.env.LOCALAPPDATA || '';
const envPath = join(localAppData, 'hermes', 'profiles', 'backend-engineer', '.env');
const content = readFileSync(envPath, 'utf8');
const m = content.match(/^API_SERVER_KEY=(.+)$/m);
if (!m) { console.log('NO_KEY_FOUND'); process.exit(2); }
const key = m[1].trim();

async function probe(path) {
  const res = await fetch(`http://127.0.0.1:8643${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 1200) };
}

const models = await probe('/v1/models');
console.log('GET /v1/models ->', models.status, '\n', models.body);
