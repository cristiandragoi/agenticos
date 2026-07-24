import { describe, expect, it } from 'vitest';
import { parseToolCall } from '../loops/toolCallParser.js';

describe('CodeX tool-call parser', () => {
  it('parses valid canonical tool JSON', () => {
    const result = parseToolCall('{"type":"tool_call","tool":"readFile","arguments":{"path":"server/src/routers/jarvis.ts"}}');

    expect(result.toolCall).toEqual({
      type: 'tool_call',
      tool: 'readFile',
      arguments: { path: 'server/src/routers/jarvis.ts' }
    });
  });

  it('parses fenced flat tool JSON', () => {
    const result = parseToolCall('```json\n{"tool":"readFile","path":"server/src/routers/jarvis.ts"}\n```');

    expect(result.toolCall).toEqual({
      type: 'tool_call',
      tool: 'readFile',
      arguments: { path: 'server/src/routers/jarvis.ts' }
    });
  });

  it('parses prose around embedded balanced tool JSON', () => {
    const result = parseToolCall('Use this next:\n{"type":"tool_call","tool":"finish","arguments":{"message":"done"}}\nThen stop.');

    expect(result.toolCall).toEqual({
      type: 'tool_call',
      tool: 'finish',
      arguments: { message: 'done' }
    });
  });

  it('parses supported OpenAI-style tool-call structures', () => {
    const result = parseToolCall(JSON.stringify({
      tool_calls: [{
        function: {
          name: 'readFile',
          arguments: '{"path":"server/src/routers/jarvis.ts"}'
        }
      }]
    }));

    expect(result.toolCall).toEqual({
      type: 'tool_call',
      tool: 'readFile',
      arguments: { path: 'server/src/routers/jarvis.ts' }
    });
  });
});
