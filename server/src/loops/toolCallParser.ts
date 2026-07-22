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
  if (candidate.type === 'tool_call') return candidate;
  if (typeof candidate.tool !== 'string') return candidate;
  const { tool, arguments: args, ...rest } = candidate;
  return {
    type: 'tool_call',
    tool,
    arguments: {
      ...(args && typeof args === 'object' && !Array.isArray(args) ? args : {}),
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

/**
 * Robustly parse a tool_call from an LLM response.
 * Tries multiple extraction strategies in order:
 * 1. Plain JSON (response trimmed)
 * 2. JSON inside markdown code fences (```json ... ``` or ``` ... ```)
 * 3. JSON inside <tool_call> tags
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
  const fenceMatch = trimmed.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const fenced = validateToolCallJson(fenceMatch[1].trim());
    if (fenced.toolCall) return { toolCall: fenced.toolCall, parseError: '' };
    errors.push(`code fence: ${fenced.error}`);
  }

  // Strategy 3: <tool_call> tags
  const tagMatch = trimmed.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  if (tagMatch) {
    const tagged = validateToolCallJson(tagMatch[1].trim());
    if (tagged.toolCall) return { toolCall: tagged.toolCall, parseError: '' };
    errors.push(`tool_call tags: ${tagged.error}`);
  }

  return { toolCall: null, parseError: errors.join(' | ') || 'No JSON tool call found in response' };
}
