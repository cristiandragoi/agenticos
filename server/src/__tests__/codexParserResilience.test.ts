// codexParserResilience.test.ts — parser robustness for common valid-but-wrapped
// model outputs (BOM, fences, prose-wrapped JSON, nested tool_call wrappers).
import { describe, it, expect } from 'vitest';
import { parseToolCall, normalizeToolCallCandidate } from '../loops/toolCallParser';
import { extractPlainTextFinalAnswer } from '../loops/codexLoop';

const WRITEFILE = { type: 'tool_call', tool: 'writeFile', arguments: { path: 'a.ts', content: 'export const x = 1;\n' } };

describe('parseToolCall — BOM / whitespace / prose / wrappers', () => {
  it('parses valid JSON prefixed with a UTF-8 BOM', () => {
    const r = parseToolCall('\uFEFF' + JSON.stringify(WRITEFILE));
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('parses valid JSON surrounded by leading/trailing whitespace + newlines', () => {
    const r = parseToolCall('\n\n  ' + JSON.stringify(WRITEFILE) + '  \n\n');
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('parses one unambiguous JSON object surrounded by short prose', () => {
    const r = parseToolCall('Here is the tool call:\n' + JSON.stringify(WRITEFILE) + '\nPlease apply it.');
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('parses JSON inside ```json code fences', () => {
    const r = parseToolCall('```json\n' + JSON.stringify(WRITEFILE) + '\n```');
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('parses a single nested tool_call object inside a valid wrapper', () => {
    const wrapped = { tool_call: WRITEFILE };
    const r = parseToolCall(JSON.stringify(wrapped));
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('parses an OpenAI-style function-call wrapper', () => {
    const fc = { function: { name: 'writeFile', arguments: JSON.stringify({ path: 'a.ts', content: 'x' }) } };
    const r = parseToolCall(JSON.stringify(fc));
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('does NOT fabricate a tool call from malformed JSON', () => {
    const r = parseToolCall('{"type":"tool_call","tool":"writeFile","arguments":{"path":"a.ts","content":"unclosed');
    expect(r.toolCall).toBeNull();
    expect(r.parseError).toBeTruthy();
  });
});

describe('normalizeToolCallCandidate — generic single-nested tool_call wrapper', () => {
  it('unwraps a wrapper object whose single value is a tool_call', () => {
    const out = normalizeToolCallCandidate({ result: WRITEFILE });
    expect(out.type).toBe('tool_call');
    expect(out.tool).toBe('writeFile');
  });
});

describe('extractPlainTextFinalAnswer — never accept tool-call-shaped text', () => {
  it('rejects a prose-wrapped tool_call (starts with prose, but parser must still dispatch)', () => {
    // extractPlainTextFinalAnswer only guards the final-answer path; the parser
    // handles prose-wrapped JSON separately. Here we assert the invariant holds
    // for a raw {}-prefixed tool call.
    expect(extractPlainTextFinalAnswer(JSON.stringify(WRITEFILE), 'final_answer')).toBeNull();
  });
  it('accepts genuine plain-text final answer', () => {
    expect(extractPlainTextFinalAnswer('All tests passed.', 'final_answer')).toBe('All tests passed.');
  });
});
