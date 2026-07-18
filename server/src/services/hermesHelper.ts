export async function runHermesTask(prompt: string, contextMessage: string): Promise<{ reply: string, metadata: any }> {
  const omniBase = process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128/v1';
  const omniKey  = process.env.OMNIROUTE_API_KEY  || '';
  
  let reply = '';
  let metadata = {
    modelUsed: 'OmniRoute',
    fallbackApplied: false,
    fallbackReason: ''
  };

  try {
    const llmRes = await fetch(`${omniBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(omniKey ? { Authorization: `Bearer ${omniKey}` } : {}),
      },
      body: JSON.stringify({
        model: 'auto',
        messages: [
          { role: 'system', content: contextMessage },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(10_000), // Shorter timeout for OmniRoute so we can failover quickly
    });

    if (!llmRes.ok) {
      throw new Error(`OmniRoute ${llmRes.status}`);
    }

    // Parse OmniRoute SSE stream
    const raw = await llmRes.text();
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') break;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) reply += delta;
      } catch { /* skip */ }
    }

    if (!reply) {
      try {
        const json = JSON.parse(raw);
        reply = json.choices?.[0]?.message?.content || '';
      } catch { /* no-op */ }
    }
  } catch (err: any) {
    console.warn(`[runHermesTask] OmniRoute failed: ${err.message}. Initiating fallback to Ollama qwythos:9b.`);
    metadata.fallbackApplied = true;
    metadata.fallbackReason = err.message;
    metadata.modelUsed = 'qwythos:9b (Ollama)';

    try {
      const ollamaRes = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwythos:9b',
          prompt: `${contextMessage}\n\nUser: ${prompt}\nAssistant:`,
          stream: false,
        })
      });

      if (!ollamaRes.ok) {
        throw new Error(`Ollama failed with ${ollamaRes.status}`);
      }

      const ollamaData = await ollamaRes.json();
      reply = ollamaData.response;
    } catch (fallbackErr: any) {
      console.error(`[runHermesTask] Fallback also failed: ${fallbackErr.message}`);
      metadata.modelUsed = 'None (offline)';
      metadata.fallbackReason = `Primary: ${err.message}. Fallback: ${fallbackErr.message}`;
      reply = 'I am running in offline mode. No external model is reachable. Please check your API keys in server/.env or start OmniRoute (`omniroute` in a terminal).';
    }
  }

  return { reply: reply || '(no response)', metadata };
}
