/**
 * tools/delegationTool.ts
 *
 * Exposes delegate_hermes_task to the agent loop.
 * Enforces the invariant:
 * - CODEX_INVOCATION_DISABLED=true (never invokes codex/OpenAI).
 * - Allows Hermes to spawn independent subtasks (inspection, test analysis, etc.) concurrently.
 */

import { ToolDefinition } from '../toolRegistry.js';
import { logger } from '../../../utils/logger.js';

export const delegateHermesTaskTool: ToolDefinition = {
  name: 'delegate_hermes_task',
  description:
    'Delegate an independent engineering subtask to a local Hermes worker (e.g. source inspection, log analysis, regression risk check). Never uses Codex or OpenAI.',
  parameters: [
    {
      name: 'objective',
      type: 'string',
      description: 'Clear, self-contained objective for the delegated subtask.',
      required: true,
    },
    {
      name: 'context',
      type: 'string',
      description: 'Technical context, constraints, or file paths needed by the worker.',
      required: false,
    },
    {
      name: 'readOnly',
      type: 'boolean',
      description: 'Whether the subtask is purely read-only investigation (recommended for parallel subtasks).',
      required: false,
    },
    {
      name: 'targetFiles',
      type: 'string',
      description: 'Comma-separated target files to inspect or focus on.',
      required: false,
    },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const objective = String(args.objective || '').trim();
    const context = args.context ? String(args.context) : undefined;
    const readOnly = Boolean(args.readOnly ?? true);
    const targetFilesStr = args.targetFiles ? String(args.targetFiles) : '';
    const targetFiles = targetFilesStr
      ? targetFilesStr.split(',').map((f) => f.trim()).filter(Boolean)
      : [];

    if (!objective) {
      return JSON.stringify({ success: false, error: 'objective is required' });
    }

    logger.info('[DelegationTool] Hermes delegating subtask:', { objective, readOnly, targetFiles });

    try {
      const { delegateHermesTask } = await import('../../../domains/jarvis/supervisorTools.js');
      const res = await delegateHermesTask({
        objective,
        context,
        envelope: {
          objective,
          constraints: {
            readOnly,
            fileScope: targetFiles.length ? targetFiles : undefined,
          },
          worker: 'hermes',
        },
      });

      return JSON.stringify({
        success: true,
        taskId: res.taskId,
        worker: 'hermes',
        status: res.status,
        message: res.message,
        note: 'Subtask dispatched to local Hermes worker. Hermes orchestrator must verify results independently.',
      });
    } catch (err: any) {
      logger.error('[DelegationTool] Failed to delegate subtask:', err);
      return JSON.stringify({
        success: false,
        error: err?.message || String(err),
      });
    }
  },
};
