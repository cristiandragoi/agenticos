const { execSync, writeFileSync, unlinkSync } = require('child_process');
const fs = require('fs');

const models = [
  'qwen3.5:9b-hermes-64k',
  'qwen2.5:7b-64k'
];

const sys = `You are Jarvis, the conversational supervisor and AI partner in Agentic OS.
1. Answer immediately in short, natural, conversational sentences. Do NOT repeat the user question back to them.
2. STRICT ACTION-DRIVEN BEHAVIOR: NEVER begin your response with "Understood", "Acknowledged", "Got it", or the user's name/title. Do NOT repeat or paraphrase the user's instruction.
3. The user's preferred title/form of address is "Master". Use this title naturally and sparingly—never in every sentence. Do not call them Christian unless explicitly asked. Never address the user with military or subordinate titles. Never start responses with boilerplate monitoring jargon.
4. REFERENT RESOLUTION: When the user says "Do that", "Fix it", "Check that", "Continue", "Proceed with it", or "Ask CodeX to check that", resolve the pronoun from the previous conversation turns into an EXPLICIT, DETAILED objective before delegating.`;

const prompts = [
  "You don't have to repeat understood a hundred times. Proceed with the implementation and keep me updated.",
  "Don't call me Master anymore. Just speak normally."
];

function queryOllama(model, prompt) {
  const payload = {
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: prompt }
    ],
    stream: false,
    options: { temperature: 0.1 }
  };
  
  fs.writeFileSync('temp_payload.json', JSON.stringify(payload, null, 2));
  const start = Date.now();
  try {
    const result = execSync(`curl -s -X POST http://127.0.0.1:11434/api/chat -H "Content-Type: application/json" -d @temp_payload.json`);
    const elapsed = Date.now() - start;
    const responseObj = JSON.parse(result.toString());
    const reply = responseObj.message.content;
    try { fs.unlinkSync('temp_payload.json'); } catch {}
    return { reply, elapsed, success: true };
  } catch (err) {
    try { fs.unlinkSync('temp_payload.json'); } catch {}
    return { reply: '', elapsed: Date.now() - start, success: false, error: err.message };
  }
}

console.log('========================================================================');
console.log('                  JARVIS OLLAMA MODEL BENCHMARK REPORT                  ');
console.log('========================================================================\n');

for (const model of models) {
  console.log(`>>> MODEL: ${model}`);
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    console.log(`\n  Prompt ${i + 1}: "${p}"`);
    const res = queryOllama(model, p);
    if (res.success) {
      console.log(`  Latency: ${res.elapsed} ms`);
      console.log(`  Reply:   "${res.reply.trim().replace(/\n/g, ' ')}"`);
      
      const containsBoilerplate = /^(?:understood|acknowledged|got it|okay|ok|master|christian)/i.test(res.reply.trim());
      console.log(`  Boilerplate-free: ${!containsBoilerplate ? 'YES ✓' : 'NO ✗'}`);
    } else {
      console.log(`  Failed:  ${res.error}`);
    }
  }
  console.log('\n------------------------------------------------------------------------\n');
}
