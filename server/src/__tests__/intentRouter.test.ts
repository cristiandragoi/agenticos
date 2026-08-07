/**
 * IntentRouter unit tests
 * Tests all required routing cases from the spec:
 * - direct conversation
 * - clear CodeX request
 * - clear Hermes request
 * - clear Memory request
 * - ambiguous request
 * - unsupported/unknown request
 */
import { IntentRouter } from '../domains/jarvis/intentRouter.js';

const router = new IntentRouter();

describe('IntentRouter — required routing cases', () => {
  it('routes direct conversation (casual question)', async () => {
    const result = await router.routeIntent('What is the capital of France?');
    expect(result.route).toBe('direct');
    expect(result.category).toBe('conversation');
    expect(result.mode).toBe('direct_conversation');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('routes clear CodeX request (build)', async () => {
    const result = await router.routeIntent('Build a React dashboard component');
    expect(result.route).toBe('codex');
    expect(result.category).toBe('repository_change');
    expect(result.mode).toBe('operational_execution');
    expect(result.requiresApproval).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('routes clear CodeX request (refactor)', async () => {
    const result = await router.routeIntent('Refactor the authentication module');
    expect(result.route).toBe('codex');
    expect(result.category).toBe('repository_change');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('routes clear Hermes request (project)', async () => {
    const result = await router.routeIntent('Show me the current project status');
    expect(result.route).toBe('hermes');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes clear Hermes request (milestone)', async () => {
    const result = await router.routeIntent('Create a milestone for the Q3 release');
    expect(result.route).toBe('hermes');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes clear Hermes request (task tracking)', async () => {
    const result = await router.routeIntent('List all tasks in the current sprint');
    expect(result.route).toBe('hermes');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes clear Memory request', async () => {
    const result = await router.routeIntent('Remember my preferences for dark mode');
    expect(result.route).toBe('memory');
    expect(result.mode).toBe('operational_execution');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes memory recall correctly', async () => {
    const result = await router.routeIntent('What did I say about the database design?');
    expect(result.route).toBe('memory');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns clarification_required for ambiguous short prompt', async () => {
    const result = await router.routeIntent('do it');
    expect(result.route).toBe('clarification_required');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('does NOT return clarification for simple hello (hi)', async () => {
    const result = await router.routeIntent('hi');
    // "hi" contains "hi" so it is NOT short-ambiguous; falls through to direct
    expect(result.route).toBe('direct');
  });

  it('routes single-word unknown prompt to clarification_required', async () => {
    const result = await router.routeIntent('analyze');
    expect(result.route).toBe('clarification_required');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('CodeX confidence is strictly higher than direct confidence', async () => {
    const codex = await router.routeIntent('Build a login page');
    const direct = await router.routeIntent('How does OAuth work?');
    expect(codex.confidence).toBeGreaterThan(direct.confidence);
  });

  // --- Agent Teams Tests ---
  it('does NOT route ordinary use of team to agent_teams', async () => {
    const result = await router.routeIntent('Write a message to my team.');
    expect(result.route).not.toBe('agent_teams');
  });

  it('does NOT route ordinary questions about agents to agent_teams', async () => {
    const result1 = await router.routeIntent('What is an AI agent?');
    expect(result1.route).not.toBe('agent_teams');

    const result2 = await router.routeIntent('Explain multi-agent systems.');
    expect(result2.route).not.toBe('agent_teams');
  });

  it('does NOT route arbitrary questions about teams', async () => {
    const result = await router.routeIntent('Which football team won?');
    expect(result.route).not.toBe('agent_teams');
  });

  it('routes explicit multi-agent execution request to agent_teams', async () => {
    const result1 = await router.routeIntent('Assemble an agent team to investigate this issue');
    expect(result1.route).toBe('agent_teams');
    expect(result1.category).toBe('agent_team_execution');
    
    const result2 = await router.routeIntent('Build a team to analyze this code');
    expect(result2.route).toBe('agent_teams');
  });

  it('classifies read-only repository inspection as repository_analysis without approval', async () => {
    const result = await router.routeIntent('Inspect the Jarvis streaming implementation');
    expect(result.route).toBe('codex');
    expect(result.category).toBe('repository_analysis');
    expect(result.requiresWorkspace).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.selectedAgent).toBe('CodeX');
  });

  it('classifies explicit CodeX delegation', async () => {
    const result = await router.routeIntent('Ask CodeX to inspect the backend');
    expect(result.route).toBe('codex');
    expect(result.category).toBe('repository_analysis');
    expect(result.selectedAgent).toBe('CodeX');
    expect(result.requiresApproval).toBe(false);
  });

  it('does not require approval for explicit read-only CodeX inspection constraints', async () => {
    const result = await router.routeIntent('Ask CodeX to inspect the Jarvis router. Do not modify files.');
    expect(result.route).toBe('codex');
    expect(result.category).toBe('repository_analysis');
    expect(result.requiresWorkspace).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('requires approval for explicit CodeX repository changes', async () => {
    const result = await router.routeIntent('Ask CodeX to patch the Jarvis router');
    expect(result.route).toBe('codex');
    expect(result.requiresApproval).toBe(true);
  });

  it('classifies destructive file operations as approval_required', async () => {
    const result = await router.routeIntent('Delete this component file');
    expect(result.route).toBe('codex');
    expect(result.category).toBe('approval_required');
    expect(result.requiresApproval).toBe(true);
  });

  it('classifies live capability questions as system_status', async () => {
    const result = await router.routeIntent('What can you do right now?');
    expect(result.route).toBe('direct');
    expect(result.category).toBe('system_status');
  });

  describe('implicit BUG_REPORT / INVESTIGATE (contextual AgenticOS statements)', () => {
    const investigateCases = [
      'It\u2019s not showing the correct model.',
      'It still shows Qwen but I switched to DeepSeek.',
      'The provider badge is wrong.',
      'The stop button doesn\u2019t work.',
      'The status is stuck on processing.',
      'It didn\u2019t switch to DeepSeek.',
      'The model name is not updating.',
      'This is broken.',
      'That didn\u2019t work.',
      'The provider is wrong.',
      'This button doesn\u2019t work.',
      'It failed again.',
      'That\u2019s wrong.',
    ];
    for (const input of investigateCases) {
      it(`routes ${JSON.stringify(input)} to investigate`, async () => {
        const result = await router.routeIntent(input);
        expect(result.route, input).toBe('investigate');
        expect(result.category).toBe('investigation');
        expect(result.mode).toBe('operational_execution');
      });
    }

    const directCases = [
      'Why does the provider badge exist?',
      'What is DeepSeek?',
      'What model is Jarvis using?',
      'How does the gateway work?',
    ];
    for (const input of directCases) {
      it(`keeps ${JSON.stringify(input)} direct/informational`, async () => {
        const result = await router.routeIntent(input);
        expect(result.route, input).toBe('direct');
      });
    }

    it('the detector is pattern-based, not a hardcoded phrase list', async () => {
      // Slightly different wording of the same problem still triggers.
      const result = await router.routeIntent('The runtime is showing the incorrect provider now');
      expect(result.route).toBe('investigate');
    });
  });

  describe('context-aware INVESTIGATE (recent conversation context)', () => {
    const appContext = 'You: the model switched to DeepSeek\nJarvis: I updated the agent assignment to DeepSeek/deepseek-v4\nSystem: operation abc123 completed';
    const cases: Array<[string, string]> = [
      ['That value shouldn\u2019t be there anymore.', appContext],
      ['This isn\u2019t what we configured.', appContext],
      ['Why is Laguna still there?', appContext],
      ['That\u2019s not what I selected.', appContext],
      ['It changed back.', appContext],
      ['The old one is there again.', appContext],
    ];
    for (const [input, context] of cases) {
      it(`routes ${JSON.stringify(input)} to investigate when recent context is AgenticOS state`, async () => {
        const result = await router.routeIntent(input, { recentText: context });
        expect(result.route, input).toBe('investigate');
      });
    }

    it('does NOT investigate the same vague statement without app context', async () => {
      const result = await router.routeIntent('That value shouldn\u2019t be there anymore.');
      expect(result.route).toBe('direct');
    });

    it('does NOT globally classify vague negatives as investigate', async () => {
      for (const input of ['I don\u2019t like this.', 'The weather is bad today.', 'That movie was long.']) {
        const result = await router.routeIntent(input, { recentText: 'You: hello\nJarvis: hi there' });
        expect(result.route, input).toBe('direct');
      }
    });

    it('keeps informational questions direct even with app context', async () => {
      const result = await router.routeIntent('Why is the sky blue?', { recentText: appContext });
      expect(result.route).toBe('direct');
    });

    it('routes idiomatic intensifier variants of "why is X still there?" to investigate', async () => {
      for (const input of [
        'The hell is Laguna still there?',
        'Why the hell is Laguna still there?',
        'How the hell is it still there?',
        'What the hell is this model still doing here?',
      ]) {
        const result = await router.routeIntent(input, { recentText: appContext });
        expect(result.route, input).toBe('investigate');
      }
    });

    it('does NOT route non-app "the hell is" questions as investigate', async () => {
      for (const input of ['The hell is this weather?', 'The hell is going on?']) {
        const result = await router.routeIntent(input, { recentText: appContext });
        expect(result.route, input).toBe('direct');
      }
    });
  });

  describe('LIVE AgenticOS state inspection vs repository analysis', () => {
    const liveCases = [
      'Jarvis, check which model you are actually using right now and tell me whether the UI is showing the same model.',
      'Perform a read-only AgenticOS health inspection.',
      'Check Hermes, Ollama, and OpenRouter health.',
      'Verify whether the frontend provider matches the runtime provider.',
      'Check recent failed operations.',
      'Inspect the current AgenticOS runtime state.',
      'Tell me whether the selected model is actually being used.',
      'Check which model you are using.',
      'Inspect the current provider.',
      'Check whether the frontend and backend agree.',
      'Tell me whether Hermes is online.',
      'Find out which provider is active.',
      'Compare the selected model with the runtime model.',
      'Are Ollama and OpenRouter working?',
      'Which model is actually active?',
      'Check backend errors.',
    ];
    for (const input of liveCases) {
      it(`routes ${JSON.stringify(input)} to INVESTIGATE`, async () => {
        const result = await router.routeIntent(input);
        expect(result.route, input).toBe('investigate');
        expect(result.category).toBe('investigation');
        expect(result.mode).toBe('operational_execution');
      });
    }

    const codexCases = [
      'Inspect server/src/domains/jarvis/intentRouter.ts.',
      'Perform a read-only analysis of the Jarvis source code.',
      'Review the repository and find where ProviderBadge gets its value.',
      'Analyze JarvisCore.tsx without changing files.',
      'Inspect intentRouter.ts.',
      'Read JarvisCore.tsx and explain it.',
      'Inspect the Jarvis router implementation.',
    ];
    for (const input of codexCases) {
      it(`routes ${JSON.stringify(input)} to CODEX/repository analysis`, async () => {
        const result = await router.routeIntent(input);
        expect(result.route, input).toBe('codex');
        expect(result.category, input).toBe('repository_analysis');
      });
    }

    const directCases = [
      'What is OpenRouter?',
      'How does Ollama work?',
      'What is a provider?',
    ];
    for (const input of directCases) {
      it(`keeps ${JSON.stringify(input)} DIRECT/informational`, async () => {
        const result = await router.routeIntent(input);
        expect(result.route, input).toBe('direct');
      });
    }

    it('"read-only" alone does NOT imply repository analysis without a code signal', async () => {
      const result = await router.routeIntent('Perform a read-only health inspection of the gateway.');
      expect(result.route).toBe('investigate');
    });
  });
});
