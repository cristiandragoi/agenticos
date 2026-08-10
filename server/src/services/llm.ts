import { logger } from '../utils/logger.js';
export async function executeWithFailover(systemPrompt: string, userPrompt: string, contextName: string, runId?: string): Promise<{ text: string, provider: string }> {
  const isHeavy = systemPrompt.toLowerCase().includes('code') || 
                  systemPrompt.toLowerCase().includes('fugu') || 
                  systemPrompt.toLowerCase().includes('fusion') ||
                  systemPrompt.toLowerCase().includes('reasoning') ||
                  systemPrompt.toLowerCase().includes('pipeline') ||
                  userPrompt.toLowerCase().includes('code');

  let providers = [
    { name: 'Fugu Ultra', url: 'https://api.sakana.ai/v1/chat/completions', model: 'fugu-ultra-20260615', key: process.env.FUGU_API_KEY },
    { name: 'Fusion', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/fusion-large', key: process.env.FUSION_API_KEY },
    { name: 'Qwable Coder', url: 'http://localhost:8642/v1/chat/completions', model: 'qwable-27b-coder', key: process.env.QWABLE_API_KEY || 'qwable' },
    { name: 'Qwythos 9B', url: 'http://localhost:11434/v1/chat/completions', model: 'qwythos:9b', key: process.env.QWYTHOS_API_KEY || 'qwythos' },
    { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', key: process.env.DEEPSEEK_API_KEY },
    { name: 'Qwen 3.5', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen3-5-72b-instruct', key: process.env.QWEN_API_KEY },
    { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', key: process.env.OPENROUTER_API_KEY },
    { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', key: process.env.GROQ_API_KEY },
    { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash', key: process.env.GOOGLE_API_KEY },
    { name: 'xAI Grok', url: 'https://api.x.ai/v1/chat/completions', model: 'grok-3', key: process.env.XAI_API_KEY },
    { name: 'Perplexity', url: 'https://api.perplexity.ai/chat/completions', model: 'sonar-pro', key: process.env.PERPLEXITY_API_KEY },
    { name: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-large-latest', key: process.env.MISTRAL_API_KEY },
  ];

  if (!isHeavy) {
    // For light tasks, prefer Groq then others
    providers = providers.sort((a, b) => (a.name === 'Groq' ? -1 : b.name === 'Groq' ? 1 : 0));
  }

  let lastError = '';

  for (const p of providers) {
    if (!p.key) continue;
    
    try {
      if (runId) logger.info(`[${contextName}] Trying provider: ${p.name}`);
      
      const res = await fetch(p.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${p.key}`
        },
        body: JSON.stringify({
          model: p.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (res.ok) {
        const data: any = await res.json();
        const text = data.choices[0].message.content;
        return { text, provider: `${p.name} (${p.model})` };
      } else {
        const errText = await res.text();
        logger.warn(`[${contextName}] Provider ${p.name} failed with status ${res.status}: ${errText}`);
        lastError = errText;
      }
    } catch (err: any) {
      logger.warn(`[${contextName}] Provider ${p.name} network error: ${err.message}`);
      lastError = err.message;
    }
  }

  throw new Error(`All configured providers failed; check keys/quotas. Last error: ${lastError}`);
}

export async function generateResponse(prompt: string, agentName: string): Promise<string> {
  const pipelineContext = `
WELDERS PIPELINE TOOLS (use these when asked about the welders pipeline):
- To check status: call GET http://localhost:4000/api/pipeline/welders/status
- To start pipeline: call POST http://localhost:4000/api/pipeline/welders/run
- Status response includes: loopDefinition.status, currentRun.stepStatuses[].{name,status,startedAt,completedAt}

When the user asks "what is my welders pipeline doing?" or "welders pipeline status":
1. Fetch http://localhost:4000/api/pipeline/welders/status internally (you know this is available)
2. Report: pipeline status, each step's name+status, last run time, any errors
3. Example answer: "The Welders Lead Pipeline is currently IDLE (last run: 2026-06-24). Steps: Research=COMPLETED, Leads & Templates=COMPLETED, Briefing & Log=COMPLETED. Obsidian files are up to date."

When the user says "run the welders pipeline" or "start the pipeline":
1. Confirm you are triggering it: "Triggering the Welders Lead Pipeline now..."
2. Output a trigger block exactly like this: {"action": "trigger_welders_pipeline"}
3. Then say: "Run started. The pipeline will execute 3 steps: Research → Leads & Templates → Briefing & Log. I'll update you when it completes."

When the user says "pipeline is stuck" or "restart the pipeline":
1. Output: {"action": "trigger_welders_pipeline"}
2. Say: "I've restarted the Welders Lead Pipeline. It will re-run all 3 steps and update your Obsidian vault."
`;

  const systemPrompt = `You are ${agentName}, an AI agent in Agentic OS. Keep your responses concise and action-oriented.
${pipelineContext}
If the user asks you to run, build, or trigger a heavy generation project or plan using Fugu or Fusion, you MUST output a JSON block exactly like this somewhere in your response:
{"action": "trigger_fugu", "projectName": "name of project", "brief": "detailed brief"} OR {"action": "trigger_fusion", "projectName": "name of project", "brief": "detailed brief"}.
You can deduce the project name and brief from the user's prompt.`;

  try {
    const result = await executeWithFailover(systemPrompt, prompt, 'LLM Service');
    return result.text;
  } catch (err: any) {
    logger.error('[LLM Service] Failover exhausted:', err);
    return err.message || `(Local Fallback Mode) Error connecting to AI provider.`;
  }
}
