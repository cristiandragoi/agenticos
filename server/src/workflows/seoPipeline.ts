import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const VAULT_PATH = 'C:\\Users\\Cris\\obsidian-vault';

// Lightweight LLM client to replace the mock
async function executeAgent(role: string, prompt: string): Promise<{ output: string }> {
  logger.info(`[Agent] Spawning ${role}...`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { output: `[Mock output for ${role} because OPENAI_API_KEY is not set]\n\nProcessed: ${prompt.substring(0, 50)}...` };
  }

  const completion = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are an expert ${role}. Provide highly professional, structured markdown output.` },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!completion.ok) {
    throw new Error(`Agent ${role} failed: ${await completion.text()}`);
  }

  const data = await completion.json();
  return { output: data.choices[0].message.content };
}

export async function runSeoPipeline(topic: string, domain: string) {
  logger.info(`Starting SEO pipeline for ${topic} on ${domain}`);
  
  // Parallel Sub-agents (Keyword Research & Outlining concurrently)
  const [research, outline] = await Promise.all([
    executeAgent('SEO Researcher', `Perform extensive keyword research on "${topic}" for the domain ${domain}. Return a markdown list of primary, secondary, and long-tail keywords.`),
    executeAgent('SEO Outliner', `Create a comprehensive article outline for the topic "${topic}". Ensure it has an H1, multiple H2s, and H3s.`)
  ]);

  // Sequential Sub-agent (Heavy Gen using previous results)
  const draft = await executeAgent(
    'SEO Writer', 
    `Write a complete, highly-engaging SEO optimized article using this exact outline:\n\n${outline.output}\n\nMake sure to naturally include the following keywords:\n\n${research.output}` 
  );

  // Save to Memory Galaxy (Obsidian)
  const sitePath = path.join(VAULT_PATH, 'projects', 'seo', domain);
  await fs.mkdir(sitePath, { recursive: true });
  
  const filePath = path.join(sitePath, `${topic.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`);
  const content = `# SEO Draft: ${topic}\n\n## Research\n${research.output}\n\n## Outline\n${outline.output}\n\n## Draft\n${draft.output}`;
  
  await fs.writeFile(filePath, content, 'utf8');
  logger.info(`SEO Pipeline complete. Saved to ${filePath}`);
  return { success: true, file: filePath };
}
