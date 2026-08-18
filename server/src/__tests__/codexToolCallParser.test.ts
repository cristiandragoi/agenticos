import { describe, expect, it } from 'vitest';
import { parseToolCall } from '../loops/toolCallParser.js';

describe('CodeX tool-call parser', () => {
  it('accepts fenced JSON tool calls', () => {
    const result = parseToolCall('```json\n{"tool":"readFile","path":"server/src/routers/jarvis.ts"}\n```');

    expect(result.toolCall).toMatchObject({
      type: 'tool_call',
      tool: 'readFile',
      arguments: { path: 'server/src/routers/jarvis.ts' }
    });
    expect(result.parseError).toBe('');
  });

  it('accepts common snake_case tool aliases and string arguments', () => {
    const result = parseToolCall(JSON.stringify({
      tool: 'read_file',
      arguments: JSON.stringify({ path: 'server/src/routers/jarvis.ts' })
    }));

    expect(result.toolCall).toMatchObject({
      type: 'tool_call',
      tool: 'readFile',
      arguments: { path: 'server/src/routers/jarvis.ts' }
    });
  });

  it('fails invalid JSON cleanly with a parse error', () => {
    const result = parseToolCall('I inspected the file and found the issue.');

    expect(result.toolCall).toBeNull();
    expect(result.parseError).toContain('plain JSON');
  });
});
