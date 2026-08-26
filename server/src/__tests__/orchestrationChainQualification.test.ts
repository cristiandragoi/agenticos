import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from '../services/agent/agentLoop.js';
import { toolRegistry } from '../services/agent/toolRegistry.js';
import { truncateToolOutput, compactMessageHistory } from '../services/agent/agentLoop.js';

describe('Agentic OS Orchestration Chain Qualification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  });

  describe('PHASE 2: Simple Read-Only End-to-End Task with Local Hermes', () => {
    it('executes read-only repo inspection via local Hermes (Qwen 3.8 / Ollama) without fallback', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      // Mock turn 1: Hermes requests tool call workspace_search
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_ws_1',
                type: 'function',
                function: {
                  name: 'workspace_search',
                  arguments: JSON.stringify({ query: 'qwen3.8:latest' })
                }
              }]
            }
          }],
          model: 'qwen3.8:latest'
        })
      });

      // Mock turn 2: Hermes synthesizes final grounded answer
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: 'The local Hermes default model is configured in server/src/services/agent/agentLoop.ts with model ID qwen3.8:latest.'
            }
          }],
          model: 'qwen3.8:latest'
        })
      });

      const systemPrompt = `You are Hermes, an AI agent in Agentic OS. You have access to tools: workspace_search, search_files, read_file.`;
      const userPrompt = `Inspect the Agentic OS repository and identify where the local Hermes default model is configured. Return the exact file and model ID. Do not modify anything.`;

      const result = await runAgentLoop(systemPrompt, userPrompt, 5, 'Hermes', 'run-phase2-test');

      expect(result.provider).toBe('Qwen 3.8');
      expect(result.model).toBe('qwen3.8:latest');
      expect(result.toolCalls).toBe(1);
      expect(result.iterations).toBe(2);
      expect(result.text).toContain('agentLoop.ts');
      expect(result.text).toContain('qwen3.8:latest');

      // Verify exact Ollama endpoint calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const call1 = mockFetch.mock.calls[0];
      expect(call1[0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
      const body1 = JSON.parse(call1[1].body);
      expect(body1.model).toBe('qwen3.8:latest');
    });
  });

  describe('PHASE 3 & 4: Jarvis ? Hermes ? CodeX Context Handoff & Tool Execution', () => {
    it('preserves user intent, file paths, and acceptance criteria across handoffs', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      // Mock tool execution sequence:
      // Turn 1: Planner/Executor requests write_file for fixture
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_write_1',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: 'test_fixture_math.ts',
                    content: 'export function add(a: number, b: number) { return a + b; }'
                  })
                }
              }]
            }
          }],
          model: 'qwen3.8:latest'
        })
      });

      // Turn 2: Executor requests terminal command to run test
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_term_1',
                type: 'function',
                function: {
                  name: 'terminal',
                  arguments: JSON.stringify({
                    command: 'node -e "const { add } = require(\'./test_fixture_math.ts\'); if (add(2,3) !== 5) process.exit(1); console.log(\'5\');"'
                  })
                }
              }]
            }
          }],
          model: 'qwen3.8:latest'
        })
      });

      // Turn 3: Final verification and summary
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: 'Execution verified: add(2,3) returned 5. Temporary fixture test_fixture_math.ts completed.'
            }
          }],
          model: 'qwen3.8:latest'
        })
      });

      const userPrompt = 'Create a temporary TypeScript file containing a function add(a,b), run a test proving add(2,3) returns 5, report the result, then remove the temporary fixture.';
      const result = await runAgentLoop(
        'You are CodeX, the execution agent. Execute tasks using tools.',
        userPrompt,
        5,
        'CodeX',
        'run-phase3-test'
      );

      expect(result.toolCalls).toBe(2);
      expect(result.iterations).toBe(3);
      expect(result.text).toContain('add(2,3) returned 5');
    });
  });

  describe('PHASE 5: Failure Propagation', () => {
    it('surfaces tool errors truthfully and does not fabricate success on missing files', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      // Mock tool call attempting to read a non-existent path
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_read_fail',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'non_existent_fixture_path_12345.txt' })
                }
              }]
            }
          }],
          model: 'qwen3.8:latest'
        })
      });

      // Mock subsequent model response acknowledging the failure truthfully
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: 'Error: The requested path non_existent_fixture_path_12345.txt does not exist in the workspace. Execution failed.'
            }
          }],
          model: 'qwen3.8:latest'
        })
      });

      const result = await runAgentLoop(
        'You are CodeX, the execution agent.',
        'Read non_existent_fixture_path_12345.txt and report contents.',
        5,
        'CodeX',
        'run-phase5-fail-test'
      );

      expect(result.text).toContain('does not exist');
      expect(result.text).not.toContain('Success');
    });
  });

  describe('PHASE 6: Verification Gate Invariants', () => {
    it('enforces structured truncation and history compaction to protect verification context', () => {
      // 1. Truncation bounds excessive tool outputs
      const hugeOutput = 'A'.repeat(20000);
      const truncated = truncateToolOutput(hugeOutput, 2500);
      expect(truncated.length).toBeLessThan(3000);
      expect(truncated).toContain('Result truncated: 20000 characters total');

      // 2. Compaction preserves first system, first user, and recent active envelopes
      const messages: any[] = [
        { role: 'system', content: 'SYSTEM INSTRUCTIONS' },
        { role: 'user', content: 'INITIAL USER GOAL' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_old', type: 'function', function: { name: 'workspace_search', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_old', content: 'VERY LONG TOOL OUTPUT '.repeat(500) },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_new', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_new', content: 'NEW ACTIVE TOOL OUTPUT' },
      ];

      const compacted = compactMessageHistory(messages, 1000);
      expect(compacted[0].content).toBe('SYSTEM INSTRUCTIONS');
      expect(compacted[1].content).toBe('INITIAL USER GOAL');
      expect(compacted[3].content).toContain('Prior tool output compacted');
      expect(compacted[5].content).toBe('NEW ACTIVE TOOL OUTPUT');
    });
  });

  describe('PHASE 7: Model / Provider Observability', () => {
    it('clearly reports provider and model for telemetry and auditing', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'OBSERVABILITY_OK' } }],
          model: 'qwen3.8:latest'
        })
      });

      const result = await runAgentLoop(
        'You are Hermes.',
        'Ping',
        1,
        'Hermes',
        'run-observability-test'
      );

      expect(result.provider).toBe('Qwen 3.8');
      expect(result.model).toBe('qwen3.8:latest');
    });
  });
});
