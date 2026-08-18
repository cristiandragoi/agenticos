// Extract per-operation lifecycle from the backend log: op id, prompt, stages.
import fs from 'node:fs';
const log = fs.readFileSync(process.env.TEMP + '/agenticos_stdout.txt', 'utf8');
const lines = log.split('\n');
// group by operationId
const ops = new Map();
for (const line of lines) {
  if (!line.includes('JarvisTrace') && !line.includes('JarvisStream')) continue;
  let op = null;
  const opm = line.match(/"operationId":"([^"]+)"/);
  if (opm) op = opm[1];
  const msg = line.match(/"message":"([^"]+)"/)?.[1] || '';
  const meta = line.match(/"meta":"([^"]+)"/)?.[1] || (line.match(/"meta":"([^"]*)/)?.[1] || '');
  const raw = line.match(/rawUserText\\":\\"([^\\"]*)/)?.[1] || '';
  if (!ops.has(op)) ops.set(op, { stages: [], raw });
  const s = ops.get(op);
  s.stages.push(meta);
  if (raw) s.raw = raw;
}
for (const [op, v] of ops) {
  if (!op) continue;
  const firstToken = v.stages.find((x) => x.includes('first token'));
  const completed = v.stages.find((x) => x.includes('stream completed'));
  const err = v.stages.find((x) => x.includes('error'));
  console.log(JSON.stringify({ op: op.slice(0, 48), prompt: (v.raw || '').slice(0, 55), firstToken: !!firstToken, completed: !!completed, err: err || null }));
}
