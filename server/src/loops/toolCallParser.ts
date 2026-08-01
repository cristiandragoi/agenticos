import { z } from 'zod';

export const ToolCallSchema = z.object({
  type: z.literal('tool_call'),
  tool: z.enum(['writeFile', 'readFile', 'runCommand', 'reasoningQuery', 'finish']),
  arguments: z.record(z.string(), z.any())
});

export type ParsedToolCall = z.infer<typeof ToolCallSchema>;

/**
 * Normalize a parsed JSON candidate into the canonical wrapped ToolCall shape.
 * Accepts both the canonical form:
 *   { "type": "tool_call", "tool": "...", "arguments": { ... } }
 * and the flat form the default prompts also instruct:
 *   { "tool": "...", "path": "...", "content": "..." }
 * Anything else is returned unchanged so schema validation can reject it.
 */
export function normalizeToolCallCandidate(candidate: any): any {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  if (Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0) {
    return normalizeToolCallCandidate(candidate.tool_calls[0]);
  }
  if (candidate.function && typeof candidate.function === 'object') {
    const rawArgs = candidate.function.arguments;
    let args = rawArgs;
    if (typeof rawArgs === 'string') {
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }
    }
    return normalizeToolCallCandidate({
      tool: candidate.function.name,
      arguments: args
    });
  }
  if (typeof candidate.name === 'string' && candidate.arguments && typeof candidate.arguments === 'object') {
    return normalizeToolCallCandidate({
      tool: candidate.name,
      arguments: candidate.arguments
    });
  }
  if (candidate.type === 'tool_call') return candidate;
  if (typeof candidate.tool !== 'string') return candidate;
  const { tool, arguments: args, ...rest } = candidate;
  let normalizedArgs = args;
  if (typeof normalizedArgs === 'string') {
    try {
      normalizedArgs = JSON.parse(normalizedArgs);
    } catch {
      normalizedArgs = {};
    }
  }
  const toolAliases: Record<string, ParsedToolCall['tool']> = {
    read_file: 'readFile',
    write_file: 'writeFile',
    run_command: 'runCommand',
    reasoning_query: 'reasoningQuery',
    final: 'finish'
  };
  const normalizedTool = toolAliases[tool] || tool;
  return {
    type: 'tool_call',
    tool: normalizedTool,
    arguments: {
      ...(normalizedArgs && typeof normalizedArgs === 'object' && !Array.isArray(normalizedArgs) ? normalizedArgs : {}),
      ...rest
    }
  };
}

/**
 * Parse a JSON string and validate it against ToolCallSchema.
 * Returns { toolCall, error } where toolCall is null on failure.
 */
export function validateToolCallJson(jsonText: string): { toolCall: ParsedToolCall | null; error: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err: any) {
    return { toolCall: null, error: `JSON parse error: ${err.message}` };
  }
  const result = ToolCallSchema.safeParse(normalizeToolCallCandidate(parsed));
  if (result.success) {
    return { toolCall: result.data, error: '' };
  }
  return { toolCall: null, error: `Schema validation error: ${result.error.message}` };
}

function extractBalancedJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

/**
 * Robustly parse a tool_call from an LLM response.
 * Tries multiple extraction strategies in order:
 * 1. Plain JSON (response trimmed)
 * 2. JSON inside markdown code fences (```json ... ``` or ``` ... ```)
 * 3. Embedded balanced JSON
 * 4. JSON inside <tool_call> tags
 * 5. OpenAI-compatible tool-call structures
 * Returns { toolCall, parseError } where toolCall is null if all strategies fail.
 */
export function parseToolCall(response: string): { toolCall: ParsedToolCall | null; parseError: string } {
  const trimmed = response.trim();
  const errors: string[] = [];

  // Strategy 1: Plain JSON
  const plain = validateToolCallJson(trimmed);
  if (plain.toolCall) return { toolCall: plain.toolCall, parseError: '' };
  errors.push(`plain JSON: ${plain.error}`);

  // Strategy 2: Markdown code fence
  const fenceMatch = trimmed.match(/```(?:json|JSON)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const fenced = validateToolCallJson(fenceMatch[1].trim());
    if (fenced.toolCall) return { toolCall: fenced.toolCall, parseError: '' };
    errors.push(`code fence: ${fenced.error}`);
  }

  // Strategy 3: Embedded balanced JSON
  for (const candidate of extractBalancedJsonCandidates(trimmed)) {
    if (candidate === trimmed || candidate === fenceMatch?.[1]?.trim()) continue;
    const embedded = validateToolCallJson(candidate);
    if (embedded.toolCall) return { toolCall: embedded.toolCall, parseError: '' };
    errors.push(`embedded JSON: ${embedded.error}`);
  }

  // Strategy 4: <tool_call> tags
  const tagMatch = trimmed.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  if (tagMatch) {
    const tagged = validateToolCallJson(tagMatch[1].trim());
    if (tagged.toolCall) return { toolCall: tagged.toolCall, parseError: '' };
    errors.push(`tool_call tags: ${tagged.error}`);
  }

  return { toolCall: null, parseError: errors.join(' | ') || 'No JSON tool call found in response' };
}
