// Replay the exact gateway prompt with two budgets + cloud model comparison.
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('B:/AgenticOS/scripts/tmp-codex-prompt.json', 'utf8'));
const prompt = data.prompt;
console.log('PROMPT_LEN', prompt.length);

async function replay(model, numPredict, think) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    think,
    options: { num_predict: numPredict },
  };
  const t0 = Date.now();
  try {
    const r = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const dur = Date.now() - t0;
    const content = j.message?.content || '';
    const thinking = j.message?.thinking || '';
    console.log('---', model, 'num_predict=' + numPredict, 'think=' + think, '---');
    console.log('STATUS', r.status, 'DUR', dur + 'ms', 'DONE', j.done_reason, 'EVAL', j.eval_count);
    console.log('CONTENT_LEN', content.length);
    console.log('CONTENT_PREVIEW', JSON.stringify(content.slice(0, 160)));
    console.log('THINKING_LEN', thinking.length);
    return { status: r.status, contentLen: content.length, thinkingLen: thinking.length, done: j.done_reason };
  } catch (e) {
    console.log('ERROR', model, String(e).slice(0, 200));
    return { error: String(e).slice(0, 200) };
  }
}

await replay('qwen3.5:4b', 512, false);   // current gateway behavior
await replay('qwen3.5:4b', 2048, false);  // larger planning budget
await replay('qwen3.5:4b', 2048, true);   // larger budget WITH thinking enabled
await replay('qwen3.5:cloud', 2048, false); // cloud escalation
