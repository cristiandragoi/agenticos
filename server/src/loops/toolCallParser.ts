import { z } from 'zod';

export const ToolCallSchema = z.object({
  type: z.literal('tool_call'),
  tool: z.enum(['writeFile', 'readFile', 'listDirectory', 'listFiles', 'runCommand', 'reasoningQuery', 'finish']),
  arguments: z.record(z.string(), z.any())
});

export type ParsedToolCall = z.infer<typeof ToolCallSchema>;
interface ToolCallParseResult {
  toolCall: ParsedToolCall | null;
  parseError?: string;
  rawResponsePreview?: string;
}

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
  if (candidate.tool_call && typeof candidate.tool_call === 'object') {
    return normalizeToolCallCandidate(candidate.tool_call);
  }
  if (Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0) {
    return normalizeToolCallCandidate(candidate.tool_calls[0]);
  }
  if (candidate.function && typeof candidate.function === 'object') {
    const rawArgs = candidate.function.arguments ?? candidate.function.parameters;
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
  if (typeof candidate.name === 'string' && (candidate.arguments || candidate.parameters) && typeof (candidate.arguments || candidate.parameters) === 'object') {
    return normalizeToolCallCandidate({
      tool: candidate.name,
      arguments: candidate.arguments || candidate.parameters
    });
  }
  if (candidate.type === 'tool_call' && typeof candidate.tool === 'string') {
    const rawArgs = candidate.arguments ?? candidate.parameters ?? {};
    let args = rawArgs;
    if (typeof rawArgs === 'string') {
      try { args = JSON.parse(rawArgs); } catch { args = {}; }
    }
    const toolAliases: Record<string, ParsedToolCall['tool']> = {
      read_file: 'readFile',
      write_file: 'writeFile',
      list_directory: 'listDirectory',
      list_files: 'listDirectory',
      listDirectory: 'listDirectory',
      listFiles: 'listDirectory',
      run_command: 'runCommand',
      reasoning_query: 'reasoningQuery',
      final: 'finish'
    };
    return {
      type: 'tool_call',
      tool: toolAliases[candidate.tool] || candidate.tool,
      arguments: typeof args === 'object' && !Array.isArray(args) ? args : {}
    };
  }
  const toolProp = candidate.tool || candidate.action;
  if (typeof toolProp !== 'string') return candidate;
  const { tool, action, arguments: args, parameters, ...rest } = candidate;
  let normalizedArgs = args ?? parameters;
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
    list_directory: 'listDirectory',
    list_files: 'listDirectory',
    listDirectory: 'listDirectory',
    listFiles: 'listDirectory',
    run_command: 'runCommand',
    reasoning_query: 'reasoningQuery',
    final: 'finish'
  };
  const effectiveTool = toolAliases[toolProp] || toolProp;
  return {
    type: 'tool_call',
    tool: effectiveTool,
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
export function validateToolCallJson(jsonText: string): ToolCallParseResult {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
    // Remove any top-level 'thinking' field which is not part of the tool call schema
    if (typeof parsed === 'object' && parsed !== null && 'thinking' in parsed) {
      const { thinking, ...rest } = parsed;
      parsed = rest;
    }
  } catch (err: any) {
    return { toolCall: null, parseError: `JSON parse error: ${err.message}` };
  }
  const result = ToolCallSchema.safeParse(normalizeToolCallCandidate(parsed));
  if (result.success) {
    return { toolCall: result.data, parseError: '' };
  }
  return { toolCall: null, parseError: `Schema validation error: ${result.error.message}` };
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
export function parseToolCall(response: string): ToolCallParseResult {
  const trimmed = response.trim();
  const errors: string[] = [];
  const preview = trimmed.slice(0, 200);

  // Strategy 1: Plain JSON
  const plain = validateToolCallJson(trimmed);
  if (plain.toolCall) return { toolCall: plain.toolCall, parseError: '', rawResponsePreview: preview };
  errors.push(`plain JSON: ${plain.parseError}`);

  // Strategy 2: Markdown code fence
  const fenceMatch = trimmed.match(/```(?:json|JSON)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const fenced = validateToolCallJson(fenceMatch[1].trim());
    if (fenced.toolCall) return { toolCall: fenced.toolCall, parseError: '', rawResponsePreview: preview };
    errors.push(`code fence: ${fenced.parseError}`);
  }

  // Strategy 3: Embedded balanced JSON
  for (const candidate of extractBalancedJsonCandidates(trimmed)) {
    if (candidate === trimmed || candidate === fenceMatch?.[1]?.trim()) continue;
    const embedded = validateToolCallJson(candidate);
    if (embedded.toolCall) return { toolCall: embedded.toolCall, parseError: '', rawResponsePreview: preview };
    errors.push(`embedded JSON: ${embedded.parseError}`);
  }

  // Strategy 4: <tool_call> tags (JSON inside tags)
  const tagMatch = trimmed.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  if (tagMatch) {
    const tagged = validateToolCallJson(tagMatch[1].trim());
    if (tagged.toolCall) return { toolCall: tagged.toolCall, parseError: '', rawResponsePreview: preview };
    errors.push(`tool_call tags: ${tagged.parseError}`);
  }

  // Strategy 5: Laguna/Hermes XML-style tool calls (<arg_key>/<arg_value>)
  const lagunaMatch = trimmed.match(/<tool_call>([a-zA-Z0-9_]+)([\s\S]*?)<\/tool_call>/i);
  if (lagunaMatch) {
    const toolName = lagunaMatch[1].trim();
    const rest = lagunaMatch[2];
    const args: Record<string, any> = {};
    const argRegex = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
    let m: RegExpExecArray | null;
    while ((m = argRegex.exec(rest)) !== null) {
      const k = m[1].trim();
      let v: any = m[2].trim();
      try {
        v = JSON.parse(v);
      } catch {}
      args[k] = v;
    }
    const candidate = normalizeToolCallCandidate({
      tool: toolName,
      arguments: args
    });
    const result = ToolCallSchema.safeParse(candidate);
    if (result.success) {
      return { toolCall: result.data, parseError: '', rawResponsePreview: preview };
    }
    errors.push(`laguna XML tool call: ${result.error.message}`);
  }

  return { toolCall: null, parseError: errors.join(' | ') || 'No JSON tool call found in response', rawResponsePreview: preview };
}
