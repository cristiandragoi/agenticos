/**
 * evaluation/cases.ts — the small representative Agentic OS suite (C3).
 * E1–E8 categories; a handful of cases each, not hundreds.
 */
import type { EvalCase } from './types.js';

export const DEFAULT_EVAL_CASES: EvalCase[] = [
  // E1 — Direct factual/local explanation
  {
    id: 'E1-hermes-explanation',
    category: 'direct_factual',
    prompt: 'In one or two sentences, what does Hermes do in Agentic OS?',
    assertions: [
      { kind: 'contains', value: 'Hermes', description: 'names Hermes' },
      { kind: 'not_contains', value: 'undefined', description: 'no undefined' },
    ],
    maxTokens: 120,
  },
  {
    id: 'E1-agentic-os-description',
    category: 'direct_factual',
    prompt: 'In one sentence, what is Agentic OS?',
    assertions: [
      { kind: 'contains', value: 'Agentic', description: 'names Agentic OS' },
    ],
    maxTokens: 100,
  },

  // E2 — Agentic OS architecture reasoning (grounded local context)
  {
    id: 'E2-architecture-orchestrator',
    category: 'architecture_reasoning',
    systemPrompt:
      'Agentic OS has Jarvis as the conversational commander, Hermes for research, CodeX for engineering, Magnitude for browser inspection, and a scheduler that dispatches routines. Answer using only this context.',
    prompt: 'Which worker would you use to inspect a website and why?',
    assertions: [
      { kind: 'contains', value: 'Magnitude', description: 'selects Magnitude' },
      { kind: 'not_contains', value: 'CodeX', description: 'does not pick CodeX for browsing' },
    ],
    maxTokens: 150,
  },

  // E3 — Coding/repository reasoning (deterministic small question)
  {
    id: 'E3-repo-reasoning',
    category: 'coding_reasoning',
    prompt:
      'In the file src/api/client.ts, the apiFetch helper returns fetch(apiUrl(input), init). If apiUrl(input) returns a relative URL and fetch is called from a browser, what is the likely problem in one sentence?',
    assertions: [
      { kind: 'contains', value: 'relative', description: 'identifies relative URL issue' },
    ],
    maxTokens: 150,
  },

  // E4 — Structured JSON (schema compliance)
  {
    id: 'E4-json-schema',
    category: 'structured_json',
    jsonSchema: '{ "name": string, "count": number, "tags": string[] }',
    prompt:
      'Return a JSON object with exactly the fields: name (string), count (number), tags (array of strings). Use {"name":"test","count":3,"tags":["a","b"]} as the shape. Output only the JSON.',
    assertions: [
      { kind: 'valid_json', value: 'true', description: 'valid JSON' },
      { kind: 'exact_field', value: 'name', description: 'has name field' },
      { kind: 'exact_field', value: 'count', description: 'has count field' },
      { kind: 'exact_field', value: 'tags', description: 'has tags field' },
    ],
    maxTokens: 200,
  },

  // E5 — Tool selection (choose an allowed tool)
  {
    id: 'E5-tool-selection',
    category: 'tool_selection',
    allowedTools: ['magnitude.inspect', 'memory.save', 'schedule.create'],
    prompt:
      'You have tools: magnitude.inspect (browser inspection), memory.save (persist a note), schedule.create (create a routine). Which tool should you call to check the current title of https://example.com? Answer with the tool name only.',
    assertions: [
      { kind: 'tool_selected', value: 'magnitude.inspect', description: 'selects magnitude.inspect' },
    ],
    maxTokens: 60,
  },

  // E6 — Browser task planning (safe Magnitude inspection)
  {
    id: 'E6-browser-plan',
    category: 'browser_planning',
    prompt:
      'Plan a safe read-only Magnitude inspection of https://example.com. List 3 steps. Do not mention purchasing or submitting anything.',
    assertions: [
      { kind: 'contains', value: 'navigate', description: 'includes navigation' },
      { kind: 'not_contains', value: 'purchase', description: 'no purchase' },
    ],
    maxTokens: 180,
  },

  // E7 — Project/current-work synthesis (supplied runtime context)
  {
    id: 'E7-current-work',
    category: 'current_work_synthesis',
    context:
      'CURRENT WORK CONTEXT: activeProject=agentic-os, activeTask="Magnitude browser inspection", latestCompletedTask="Voice closure" by hermes, latestFailure="Routine: Smoke Test I" (failed), nextPlannedAction="DeepSeek provider evaluation".',
    prompt: 'Based on the supplied context, what are we currently working on? Answer in one sentence.',
    assertions: [
      { kind: 'contains', value: 'Magnitude', description: 'reflects active task' },
    ],
    maxTokens: 100,
  },

  // E8 — Long-context synthesis (controlled larger context)
  {
    id: 'E8-long-context',
    category: 'long_context',
    longContext:
      'Section 1: Agentic OS is a local AI-operations platform.\n' +
      'Section 2: Jarvis is the commander and conversational interface.\n' +
      'Section 3: Hermes performs research and inspection.\n' +
      'Section 4: CodeX performs engineering work.\n' +
      'Section 5: Magnitude performs browser inspection.\n' +
      'Section 6: The scheduler dispatches routines to workers.\n' +
      'Section 7: Verification is independent of execution.\n' +
      'Section 8: Memory is stored per-profile.\n' +
      'Section 9: Approvals gate consequential actions.\n' +
      'Section 10: Results persist in canonical execution runs.\n'.repeat(3),
    prompt:
      'Using the provided context, list the five workers mentioned and one sentence on what each does.',
    assertions: [
      { kind: 'contains', value: 'Jarvis', description: 'mentions Jarvis' },
      { kind: 'contains', value: 'Hermes', description: 'mentions Hermes' },
      { kind: 'contains', value: 'CodeX', description: 'mentions CodeX' },
      { kind: 'contains', value: 'Magnitude', description: 'mentions Magnitude' },
    ],
    maxTokens: 300,
  },

  // ── Coding-specific cases (Phase 31 / C19) ────────────────────────────
  {
    id: 'C-EVAL-1-type-bugfix',
    category: 'coding_reasoning',
    systemPrompt:
      'You are reviewing a code snippet. The function below has a bug: it claims to double a number but returns the input unchanged.\n```ts\nfunction double(n: number): number {\n  return n;\n}\n```',
    prompt:
      'Identify the bug in one sentence and state the correct implementation line.',
    assertions: [
      { kind: 'contains', value: '2', description: 'proposes multiplying by 2' },
      { kind: 'not_contains', value: 'return n;', description: 'does not keep the buggy line' },
    ],
    maxTokens: 120,
  },
  {
    id: 'C-EVAL-2-util-function',
    category: 'coding_reasoning',
    systemPrompt:
      'A repository needs a utility function that sums an array of numbers.',
    prompt:
      'Write the body of a TypeScript function `sum(values: number[]): number`. Return only the function body lines.',
    assertions: [
      { kind: 'contains', value: 'reduce', description: 'uses reduce or an accumulator' },
      { kind: 'contains', value: '0', description: 'has an initial value' },
    ],
    maxTokens: 150,
  },
  {
    id: 'C-EVAL-3-repo-question',
    category: 'coding_reasoning',
    systemPrompt:
      'In the repo, the file src/api/client.ts defines `apiFetch`; tests live under src/__tests__; the test runner is vitest.',
    prompt:
      'Which command would run only the tests in src/__tests__/client.test.ts? Answer with the command only.',
    assertions: [
      { kind: 'contains', value: 'vitest', description: 'uses vitest' },
      { kind: 'contains', value: 'client.test', description: 'targets the file' },
    ],
    maxTokens: 60,
  },
  {
    id: 'C-EVAL-4-react-component',
    category: 'coding_reasoning',
    systemPrompt:
      'A React component currently renders a hardcoded label. It must accept a `label` prop.',
    prompt:
      'Describe in one sentence what must change in the component signature.',
    assertions: [
      { kind: 'contains', value: 'label', description: 'mentions the prop' },
      { kind: 'contains', value: 'props', description: 'mentions props' },
    ],
    maxTokens: 100,
  },
  {
    id: 'C-EVAL-5-failing-test',
    category: 'coding_reasoning',
    systemPrompt:
      'A test asserts `add(2, 2) === 5` and fails. The implementation is correct; the test is wrong.',
    prompt:
      'What is the minimal correct change? Answer in one sentence.',
    assertions: [
      { kind: 'contains', value: '5', description: 'identifies the assertion value' },
      { kind: 'contains', value: '4', description: 'states the correct value' },
    ],
    maxTokens: 100,
  },
];
