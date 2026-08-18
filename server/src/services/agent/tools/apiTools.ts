/**
 * Internal API tools for Jarvis/Hermes — call existing backend endpoints.
 * These are simple, well-defined actions that return clear results.
 * They do NOT loop, retry, or make autonomous decisions.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const BACKEND = 'http://localhost:4000/api';
const OBSIDIAN_VAULT = 'C:\\Users\\Cris\\obsidian-vault';

/* ─── getPipelineStatus ─── */

export const getPipelineStatusTool = {
  name: 'getPipelineStatus',
  description: 'Get the current status of a pipeline by its pipelineId. Returns the pipeline definition, last run details, step statuses, and Obsidian file info. Call this when the user asks "what is my pipeline status" or "check the pipeline".',
  parameters: [
    { name: 'pipelineId', type: 'string', description: 'The pipeline ID to check (e.g. "loop-welders-pipeline")', required: true },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const pipelineId = args.pipelineId as string;
    if (!pipelineId) return JSON.stringify({ error: 'No pipelineId provided' });

    try {
      // Map known pipeline IDs to their status endpoint
      const endpointMap: Record<string, string> = {
        'loop-welders-pipeline': `${BACKEND}/pipeline/welders/status`,
        'welders': `${BACKEND}/pipeline/welders/status`,
      };

      const url = endpointMap[pipelineId];
      if (!url) {
        return JSON.stringify({ error: `Unknown pipeline ID: "${pipelineId}". Known pipelines: loop-welders-pipeline` });
      }

      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        return JSON.stringify({ error: `Cannot access pipeline: HTTP ${res.status}` });
      }

      const data = await res.json();
      return JSON.stringify({ success: true, data });
    } catch (err: any) {
      return JSON.stringify({ error: `Cannot access that pipeline right now: ${err.message}` });
    }
  },
};

/* ─── runPipeline ─── */

export const runPipelineTool = {
  name: 'runPipeline',
  description: 'Trigger a pipeline to start running. Returns immediately with a run ID — does NOT wait for the pipeline to finish. Call this ONLY when the user explicitly says "run" or "start" a pipeline. Do NOT call this on your own initiative.',
  parameters: [
    { name: 'pipelineId', type: 'string', description: 'The pipeline ID to trigger (e.g. "loop-welders-pipeline")', required: true },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const pipelineId = args.pipelineId as string;
    if (!pipelineId) return JSON.stringify({ error: 'No pipelineId provided' });

    try {
      const endpointMap: Record<string, string> = {
        'loop-welders-pipeline': `${BACKEND}/pipeline/welders/run`,
        'welders': `${BACKEND}/pipeline/welders/run`,
      };

      const url = endpointMap[pipelineId];
      if (!url) {
        return JSON.stringify({ error: `Unknown pipeline ID: "${pipelineId}". Known pipelines: loop-welders-pipeline` });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 409) {
        return JSON.stringify({ error: 'Pipeline is already running. Wait for it to complete before starting another run.' });
      }

      if (!res.ok) {
        return JSON.stringify({ error: `Cannot start pipeline: HTTP ${res.status}` });
      }

      const data = await res.json();
      return JSON.stringify({ success: true, data, message: `Pipeline started. Run ID: ${data.runId || 'unknown'}` });
    } catch (err: any) {
      return JSON.stringify({ error: `Cannot start that pipeline right now: ${err.message}` });
    }
  },
};

/* ─── readObsidianFile ─── */

export const readObsidianFileTool = {
  name: 'readObsidianFile',
  description: 'Read the content of a file from the Obsidian vault. Use this to read leads files, status files, research reports, or any markdown file in the vault. Returns the full file content with metadata.',
  parameters: [
    { name: 'filePath', type: 'string', description: 'Relative path from the Obsidian vault root, e.g. "projects/welders-de-nl/leads.md" or "projects/welders-de-nl/status.md". Do NOT include the full Windows path.', required: true },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const filePath = args.filePath as string;
    if (!filePath) return JSON.stringify({ error: 'No filePath provided' });

    // Security: prevent path traversal
    const normalized = path.normalize(filePath).replace(/^[/\\]/, '');
    if (normalized.includes('..')) {
      return JSON.stringify({ error: 'Invalid file path: directory traversal is not allowed' });
    }

    const fullPath = path.join(OBSIDIAN_VAULT, normalized);

    try {
      await fsp.access(fullPath, fs.constants.R_OK);
    } catch {
      return JSON.stringify({ error: `Cannot read that file: it does not exist or is not accessible at ${fullPath}` });
    }

    try {
      const content = await fsp.readFile(fullPath, 'utf-8');
      const stat = await fsp.stat(fullPath);
      return JSON.stringify({
        success: true,
        data: {
          path: fullPath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          content: content.slice(0, 20000), // cap at 20KB
        },
      });
    } catch (err: any) {
      return JSON.stringify({ error: `Cannot read that file: ${err.message}` });
    }
  },
};
