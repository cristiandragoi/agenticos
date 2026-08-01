import { logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { runStore } from '../services/runStore.js';
import { db } from '../services/db.js';

export async function executeFuguProjectWorkflow(projectName: string, brief: string) {
  const runId = `run-fugu-${Date.now()}`;
  const vaultPath = 'C:\\Users\\Cris\\obsidian-vault';
  const projectDir = path.join(vaultPath, 'projects', 'fugu', projectName.replace(/[^a-zA-Z0-9_-]/g, '-'));
  const logFile = path.join(vaultPath, 'agents', 'hermes', 'logs.md');

  runStore.create({
    id: runId,
    agentId: 'agent-fugu-ultra',
    sessionId: 'default',
    workspaceId: 'default',
    mode: 'workflow',
    status: 'running',
    input: `Build project: ${projectName}\nBrief: ${brief}`,
    logs: [`[Fugu] Starting Heavy Generation Project Builder for ${projectName}`],
    events: [],
    linkedArtifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const apiKey = process.env.OPENAI_API_KEY;

  try {
    let output = '';

    const { executeWithFailover } = await import('../services/llm.js');
    const systemPrompt = 'You are Fugu Ultra, a heavy project builder. Output comprehensive project files and structures based on the brief.';
    const userPrompt = `Project Name: ${projectName}\nBrief: ${brief}`;

    try {
      const result = await executeWithFailover(systemPrompt, userPrompt, 'Fugu Workflow', runId);
      output = result.text;
      runStore.appendLog(runId, `[Fugu] successfully generated project using provider: ${result.provider}`);
    } catch (err: any) {
      runStore.appendLog(runId, `[Fugu] Generation failed: ${err.message}`);
      throw new Error(`Upstream API failed: ${err.message}`);
    }

    // Save to Obsidian Vault
    await fs.mkdir(projectDir, { recursive: true });
    const outputFilePath = path.join(projectDir, 'build.md');
    await fs.writeFile(outputFilePath, output, 'utf8');

    runStore.appendLog(runId, `[Fugu] Project saved to ${outputFilePath}`);

    // Log to Hermes logs
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    const logEntry = `\n\n## [${new Date().toISOString()}] Fugu Workflow Execution\n**Project:** ${projectName}\n**Model Used:** Fugu Ultra\n**Output Location:** ${outputFilePath}\n**Brief:** ${brief.substring(0, 100)}...\n`;
    await fs.appendFile(logFile, logEntry, 'utf8');

    runStore.update(runId, {
      status: 'completed',
      output: `Project successfully built and saved to ${outputFilePath}`,
      updatedAt: new Date().toISOString()
    });

    return { success: true, runId, outputFilePath };
  } catch (err: any) {
    logger.error('[Fugu Workflow Error]', err);
    runStore.update(runId, {
      status: 'failed',
      errorMessage: err.message,
      updatedAt: new Date().toISOString()
    });
    return { success: false, runId, error: err.message };
  }
}
