/**
 * cortexTools.ts — Tool definitions for Cortex Suite and Hindsight.
 *
 * Exposes Cortex memory and Quartz symbol lookup to Hermes, OmniRoute,
 * and coding agents via the ToolRegistry.
 */

import type { ToolDefinition } from '../toolRegistry.js';
import { cortexDb } from '../../cortex/cortexDb.js';
import { quartzIndexer } from '../../cortex/quartzIndexer.js';
import { hindsightService } from '../../cortex/hindsightService.js';

export const cortexRecallTool: ToolDefinition = {
  name: 'cortex_recall',
  description: 'Search Cortex shared engineering memory for known patterns, anti-patterns, bug traps, and past decisions.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'The search query or concept (e.g. "email", "stt", "worktree", "turn_lifecycle")',
      required: true,
    },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const query = String(args.query || '').trim();
    if (!query) return 'Error: query is required.';

    const patterns = cortexDb.searchPatterns(query);
    const antiPatterns = cortexDb.getAntiPatterns(query);

    return JSON.stringify(
      {
        query,
        patternsFound: patterns.length,
        patterns,
        antiPatternsFound: antiPatterns.length,
        antiPatterns,
      },
      null,
      2
    );
  },
};

export const cortexAntiPatternsTool: ToolDefinition = {
  name: 'cortex_get_anti_patterns',
  description: 'Retrieve known failure traps, anti-patterns, and how to avoid them.',
  parameters: [
    {
      name: 'tag',
      type: 'string',
      description: 'Optional tag filter (e.g. "voice", "stt", "email", "self_heal")',
      required: false,
    },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const tag = args.tag ? String(args.tag).trim() : undefined;
    const aps = cortexDb.getAntiPatterns(tag);
    return JSON.stringify(aps, null, 2);
  },
};

export const quartzGetApiContextTool: ToolDefinition = {
  name: 'quartz_get_api_context',
  description: 'Retrieve live symbol lookup, signatures, and context for an AgenticOS symbol, class, or function.',
  parameters: [
    {
      name: 'hint',
      type: 'string',
      description: 'The class, function, or symbol name to look up',
      required: true,
    },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const hint = String(args.hint || '').trim();
    if (!hint) return 'Error: hint is required.';
    const context = quartzIndexer.getApiContext(hint);
    if (context.length === 0) {
      return `No symbol matching "${hint}" found in indexed source code.`;
    }
    return context.join('\n');
  },
};

export const quartzSearchSymbolsTool: ToolDefinition = {
  name: 'quartz_search_symbols',
  description: 'Search indexed AST symbols across AgenticOS source code.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query for symbol names',
      required: true,
    },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const query = String(args.query || '').trim();
    if (!query) return 'Error: query is required.';
    const symbols = quartzIndexer.searchSymbols(query);
    return JSON.stringify(symbols, null, 2);
  },
};

export const hindsightLessonsTool: ToolDefinition = {
  name: 'hindsight_get_lessons',
  description: 'Read persistent validated engineering lessons from docs/lessons/MEMORY.md.',
  parameters: [],
  handler: async (): Promise<string> => {
    const text = hindsightService.readLessons();
    return text || 'No lessons recorded yet in MEMORY.md.';
  },
};
