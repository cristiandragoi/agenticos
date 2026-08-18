import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../../config/custom_provider.json');

export interface CustomProviderConfig {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  maxTokens: number;
  temperature: number;
}

export function getCustomProviderConfig(): CustomProviderConfig | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(data) as CustomProviderConfig;
    }
  } catch (err) {
    logger.error('[CustomProvider] Error reading config:', err);
  }
  return null;
}

export async function customProviderChat(prompt: string, systemPrompt?: string, stream: boolean = false) {
  const config = getCustomProviderConfig();
  if (!config) {
    throw new Error('Custom provider config not found');
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.defaultModel,
      messages,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      stream
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Custom provider error (${response.status}): ${errText}`);
  }

  if (stream) {
    return response.body; // Returns a ReadableStream for SSE
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
