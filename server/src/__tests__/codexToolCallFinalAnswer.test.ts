// codexToolCallFinalAnswer.test.ts — synthetic-completion invariant:
// a model response that IS (or looks like) a tool call must NEVER be
// accepted as a plain-text final answer. It must be dispatched or failed
// truthfully. Regression for goal-26ef99f2- (writeFile JSON surfaced as
// finalAnswer, goal completed without executing the tool).
import { describe, it, expect } from 'vitest';
import { extractPlainTextFinalAnswer } from '../loops/codexLoop';
import { parseToolCall } from '../loops/toolCallParser';

const VALID_WRITEFILE = JSON.stringify({
  type: 'tool_call',
  tool: 'writeFile',
  arguments: { path: 'src/x.test.ts', content: 'import { it } from "vitest";\nit("a", () => { expect(1).toBe(1); });\n' },
});

const VALID_RUNCOMMAND = JSON.stringify({
  type: 'tool_call',
  tool: 'runCommand',
  arguments: { cmd: 'npx', args: ['vitest', 'run', 'src/x.test.ts'] },
});

describe('extractPlainTextFinalAnswer — synthetic-completion invariant', () => {
  it('rejects a valid terminal writeFile tool call (must dispatch, never final)', () => {
    expect(extractPlainTextFinalAnswer(VALID_WRITEFILE, 'final_answer')).toBeNull();
  });

  it('rejects a valid terminal runCommand tool call', () => {
    expect(extractPlainTextFinalAnswer(VALID_RUNCOMMAND, 'final_answer')).toBeNull();
  });

  it('rejects a TRUNCATED tool-call JSON (starts with "{", malformed)', () => {
    const truncated = '{"type":"tool_call","tool":"writeFile","arguments":{"path":"a.ts","content":"import { describe, it } from';
    expect(extractPlainTextFinalAnswer(truncated, 'final_answer')).toBeNull();
  });

  it('rejects a tool call wrapped in markdown code fences', () => {
    expect(extractPlainTextFinalAnswer('```json\n' + VALID_WRITEFILE + '\n```', 'final_answer')).toBeNull();
  });

  it('returns null for non-final_answer expectation', () => {
    expect(extractPlainTextFinalAnswer('just text', 'tool_decision')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(extractPlainTextFinalAnswer('   ', 'final_answer')).toBeNull();
  });

  it('accepts genuine plain-text final answer', () => {
    expect(extractPlainTextFinalAnswer('All tests passed. The edit is complete.', 'final_answer'))
      .toBe('All tests passed. The edit is complete.');
  });

  it('strips HTML tags from a genuine plain-text answer', () => {
    expect(extractPlainTextFinalAnswer('<p>Done</p>', 'final_answer')).toBe('Done');
  });
});

describe('parseToolCall — extraction edge cases', () => {
  it('parses a valid writeFile tool call', () => {
    const r = parseToolCall(VALID_WRITEFILE);
    expect(r.toolCall?.tool).toBe('writeFile');
    expect(r.toolCall?.arguments?.path).toBe('src/x.test.ts');
  });

  it('parses a valid runCommand tool call', () => {
    const r = parseToolCall(VALID_RUNCOMMAND);
    expect(r.toolCall?.tool).toBe('runCommand');
    expect(r.toolCall?.arguments?.cmd).toBe('npx');
  });

  it('parses a tool call wrapped in code fences', () => {
    const r = parseToolCall('```json\n' + VALID_WRITEFILE + '\n```');
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('parses a tool call preceded/followed by short explanatory text', () => {
    const r = parseToolCall('Here is the change:\n' + VALID_WRITEFILE + '\nPlease run the tests after.');
    expect(r.toolCall?.tool).toBe('writeFile');
  });

  it('returns null + parseError for truncated/malformed JSON (no fabrication)', () => {
    const r = parseToolCall('{"type":"tool_call","tool":"writeFile","arguments":{"path":"a.ts","content":"unclosed');
    expect(r.toolCall).toBeNull();
    expect(r.parseError).toBeTruthy();
  });

  it('rejects an unsupported tool via schema validation', () => {
    const r = parseToolCall(JSON.stringify({ type: 'tool_call', tool: 'sudo', arguments: { cmd: 'rm -rf /' } }));
    expect(r.toolCall).toBeNull();
  });

  it('returns null for genuine plain text (no tool call)', () => {
    const r = parseToolCall('The build is green and all checks pass.');
    expect(r.toolCall).toBeNull();
  });
});
