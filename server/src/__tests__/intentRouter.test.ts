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

describe('IntentRouter — Magnitude browser routing (A7/M9)', () => {
  it('routes explicit-URL browser inspection to magnitude', async () => {
    const result = await router.routeIntent('Inspect https://example.com and tell me the page title');
    expect(result.route).toBe('magnitude');
    expect(result.selectedCapability).toBe('magnitude');
  });
  it('routes bare-domain browser inspection to magnitude (A7)', async () => {
    const result = await router.routeIntent('Jarvis, inspect example.com and tell me the page title');
    expect(result.route).toBe('magnitude');
    expect(result.selectedCapability).toBe('magnitude');
  });
  it('routes explicit magnitude delegation to magnitude', async () => {
    const result = await router.routeIntent('use magnitude to open github.com');
    expect(result.route).toBe('magnitude');
  });
  it('does NOT route non-browser page talk to magnitude', async () => {
    const result = await router.routeIntent('What is the capital of France?');
    expect(result.route).not.toBe('magnitude');
  });
  it('respects prohibited magnitude (do not use magnitude)', async () => {
    const result = await router.routeIntent('without magnitude, inspect https://example.com');
    expect(result.route).not.toBe('magnitude');
  });
});

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

  it('does NOT route a conversational project mention to Hermes (no unnecessary delegation)', async () => {
    const result = await router.routeIntent('My project codename is Atlas.');
    expect(result.route).not.toBe('hermes');
    expect(result.route).toBe('direct');
    expect(result.mode).toBe('direct_conversation');
  });

  it('does NOT route a bare goal statement to Hermes (conversation, not orchestration)', async () => {
    const result = await router.routeIntent('My goal is to ship the dashboard this quarter.');
    expect(result.route).toBe('direct');
  });

  it('still routes ACTIONABLE project commands to Hermes', async () => {
    const r1 = await router.routeIntent('Create a plan for the AgenticOS project');
    expect(r1.route).toBe('hermes');
    const r2 = await router.routeIntent('Track execution of the Q3 milestone');
    expect(r2.route).toBe('hermes');
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

  it('does NOT route a bare "remember" context statement to memory (runtime fix)', async () => {
    const result = await router.routeIntent('My favorite color is teal. Please remember that for this conversation.');
    expect(result.route).not.toBe('memory');
    expect(result.route).toBe('direct');
  });

  it('still routes genuine memory queries to memory', async () => {
    const result = await router.routeIntent('Do you remember what model we chose?');
    expect(result.route).toBe('memory');
    const result2 = await router.routeIntent('What happened in our last Berlin roofing search?');
    expect(result2.route).toBe('memory');
  });

  it('STORE-memory requests are never routed as RECALL (runtime semantics fix)', async () => {
    const storeForms = [
      'Please remember that my favorite color is teal',
      'Please remember my favorite color is teal',
      'Remember that I prefer dark mode',
      'From now on remember my email is x@example.com',
    ];
    for (const s of storeForms) {
      const result = await router.routeIntent(s);
      expect(result.route).not.toBe('memory');
    }
  });

  it('RECALL-memory requests still route to memory', async () => {
    const recallForms = [
      'What do you remember about Kadabau?',
      'What happened in our last Berlin roofing search?',
      'Do you remember what model we chose?',
    ];
    for (const s of recallForms) {
      const result = await router.routeIntent(s);
      expect(result.route).toBe('memory');
    }
  });

  it('project/task STATE questions route to direct/investigate, never Hermes delegation (runtime fix)', async () => {
    const qs = [
      'What project are we currently working on?',
      'What is the current project?',
      'Which task is active right now?',
      'What is the status of the plan?',
    ];
    for (const s of qs) {
      const result = await router.routeIntent(s);
      expect(result.route).not.toBe('hermes');
      // informational answer paths: direct chat (history+state) or the
      // read-only investigate pipeline for runtime-state questions
      expect(['direct', 'investigate']).toContain(result.route);
    }
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

    it('routes "what model are you using" DIRECT (conversational runtime-identity question)', async () => {
      for (const input of ['What model are you using?', 'What model and provider are you actually using for this reply?', 'What model are you running?']) {
        const result = await router.routeIntent(input);
        expect(result.route, input).toBe('direct');
      }
    });

    it('routes worker-as-OBJECT checks to INVESTIGATE and explicit delegation to the worker', async () => {
      expect((await router.routeIntent('Check Hermes health.')).route).toBe('investigate');
      expect((await router.routeIntent('Check Hermes, Ollama and OpenRouter.')).route).toBe('investigate');
      const del = await router.routeIntent('Give this to Hermes.');
      expect(del.route).toBe('hermes');
    });

    it('read-only health inspection is INVESTIGATE, read-only file analysis is CODEX', async () => {
      expect((await router.routeIntent('Perform a read-only AgenticOS health inspection.')).route).toBe('investigate');
      expect((await router.routeIntent('Perform a read-only analysis of intentRouter.ts.')).route).toBe('codex');
    });

    it('"read-only" alone does NOT imply repository analysis without a code signal', async () => {
      const result = await router.routeIntent('Perform a read-only health inspection of the gateway.');
      expect(result.route).toBe('investigate');
    });
  });

  describe('voice-aware continuations (conversation-state milestone)', () => {
    it('detects repeated-fragment transcription corruption and asks to repeat (no reset)', async () => {
      const result = await router.routeIntent('the the the and then what');
      expect(result.route).toBe('clarification_required');
      expect(result.reason).toBe('voice_transcription');
      expect(result.voiceIssue).toBeTruthy();
    });

    it('detects impossible consonant-run words', async () => {
      const result = await router.routeIntent('xxxqzzfrt btw check it');
      expect(result.route).toBe('clarification_required');
      expect(result.voiceIssue).toBe('impossible word fragment detected');
    });

    it('detects abrupt truncation (final bare letter fragment)', async () => {
      const result = await router.routeIntent('tell me a story ab');
      expect(result.route).toBe('clarification_required');
      expect(result.voiceIssue).toBe('abrupt truncation detected');
    });

    it('keeps clean speech unblocked', async () => {
      const result = await router.routeIntent('tell me a story about a roofer in Berlin');
      expect(result.voiceIssue).toBeUndefined();
      expect(result.route).not.toBe('clarification_required');
    });

    it('continuation cue with malfunction context routes INVESTIGATE (never DIRECT reset)', async () => {
      const recent = 'The execution bar still shows the wrong provider and the task is stuck.';
      const result = await router.routeIntent('So right now, Jarvis is still not showing the model.', { recentText: recent });
      expect(result.route).toBe('investigate');
    });

    it('continuation cue without any context does not invent a problem', async () => {
      const result = await router.routeIntent('So right now, what do you think about that?', { recentText: '' });
      expect(result.route).toBe('direct');
    });
  });

  // ── §8/§9/§11 (stabilization freeze): conservative corruption detection,
  //    complaint understanding, clarification budget ────────────────────
  describe('stabilization: valid complaints are never corrupted speech', () => {
    const validComplaints = [
      'You are not able to work fine. I don\'t know what to do anymore.',
      'You are still not working properly.',
      'I don\'t know what you\'re doing anymore.',
      'This still doesn\'t work.',
      'Why are you asking me again?',
      'You keep misunderstanding me.',
      'What the hell is going on?',
      'You are not working fine.',
      'I don\'t know what to do anymore.',
    ];

    it.each(validComplaints)('is NOT corrupted speech: %s', async (utterance) => {
      const result = await router.routeIntent(utterance, { recentText: 'Earlier: the backend reconnected.' });
      expect(result.voiceIssue).toBeUndefined();
      expect(result.route).not.toBe('clarification_required');
    });

    it.each(validComplaints)('complaint about Jarvis routes INVESTIGATE: %s', async (utterance) => {
      const result = await router.routeIntent(utterance, { recentText: '' });
      expect(result.route).toBe('investigate');
    });
  });

  describe('stabilization: conservative corruption detection (§9)', () => {
    it('real words at sentence end never classify as truncation', async () => {
      for (const s of ['tell me what to do', 'what is going on', 'why do you keep doing this']) {
        const result = await router.routeIntent(s, { recentText: 'context here' });
        expect(result.voiceIssue).toBeUndefined();
      }
    });

    it('punctuated sentences are complete even with short final tokens', async () => {
      const result = await router.routeIntent('What the hell is going on?', { recentText: 'x' });
      expect(result.voiceIssue).toBeUndefined();
      expect(result.route).not.toBe('clarification_required');
    });

    it('strong corruption still detected: repeated fragments', async () => {
      const result = await router.routeIntent('the the the roof search');
      expect(result.voiceIssue).toBe('repeated fragment detected');
    });

    it('strong corruption still detected: bare-letter truncation', async () => {
      const result = await router.routeIntent('tell me a story ab');
      expect(result.voiceIssue).toBe('abrupt truncation detected');
    });
  });

  describe('stabilization: short commands + clarification budget (§11)', () => {
    it('short imperative commands go to direct conversation, never clarification', async () => {
      // NOTE: "show status" deliberately excluded — it is a legitimate
      // live-state inspection and routes INVESTIGATE (correct behavior).
      for (const s of ['say hello', 'repeat that', 'play it', 'Jarvis, say hello.']) {
        const result = await router.routeIntent(s, { recentText: '' });
        expect(result.route).toBe('direct');
        expect(result.reason).toContain('imperative');
      }
    });

    it('short vague prompt WITH context is interpreted, not clarified', async () => {
      // §9/§4 milestone: "try again" after a failure is now an operational
      // RETRY (routes INVESTIGATE to retry the prior goal). The generic
      // "interpret with context" behavior is asserted with a short phrase —
      // route must be DIRECT (never clarification); the reason may be either
      // the imperative-command path or the interpret-with-context path.
      const result = await router.routeIntent('tell me more', { recentText: 'I ran the task and it failed.' });
      expect(result.route).toBe('direct');
      expect(result.reason).toMatch(/interpret|imperative/);
    });

    it('short vague prompt AFTER a prior clarification may ask once more (budget)', async () => {
      const result = await router.routeIntent('hmm', { recentText: 'I didn\'t quite understand your request. Could you rephrase it?' });
      expect(result.route).toBe('clarification_required');
    });

    it('short vague prompt with NO context still clarifies (first ask)', async () => {
      const result = await router.routeIntent('hmm', { recentText: '' });
      expect(result.route).toBe('clarification_required');
    });
  });

  describe('stabilization: UI/interface/layout change requests are OPERATIONAL (§ runtime investigation)', () => {
    const uiChangeCases = [
      'Change the chat interface.',
      'Fix the layout.',
      'Why does the UI still look wrong?',
      'Investigate this.',
      'The chat interface is wrong.',
      'The layout is broken.',
      'Why is this panel still here?',
      'Move this section down.',
      'Why does the transcript overlap?',
      'The transcript is overlapping the controls.',
      'Move this section down.',
    ];
    for (const input of uiChangeCases) {
      it(`routes ${JSON.stringify(input)} to INVESTIGATE (operational, never generic chat)`, async () => {
        const recentText = input === 'Move this section down.' ? 'the transcript is overlapping the composer' : '';
        const result = await router.routeIntent(input, { recentText });
        expect(result.route, input).toBe('investigate');
        expect(result.category).toBe('investigation');
        expect(result.mode).toBe('operational_execution');
        expect(result.plan && result.plan.some(p => /engineering task|affected UI component|frontend/i.test(p))).toBe(true);
      });
    }

    it('routes deictic UI change with recent UI context to INVESTIGATE', async () => {
      const result = await router.routeIntent('Can you change that?', { recentText: 'the chat interface is wrong and I want it fixed' });
      expect(result.route).toBe('investigate');
    });

    it('keeps informational UI questions DIRECT, never investigate', async () => {
      for (const s of ['What is the transcript panel?', 'How does the layout system work?', 'What does the Memory tab do?']) {
        const result = await router.routeIntent(s);
        expect(result.route, s).toBe('direct');
      }
    });

    it('deictic change without UI context is not force-investigated', async () => {
      const result = await router.routeIntent('Can you change that?', { recentText: '' });
      // Genuinely ambiguous — must NOT claim UI change intent without context.
      expect(result.route).not.toBe('investigate');
    });
  });

  describe('§15/§16: multi-turn conversational coherence (context resolves follow-ups)', () => {
    // Simulates the recentText the orchestrator builds from prior turns.
    const uiProblemContext =
      'user: The chat interface is still wrong.\nagent: I inspected the active AgenticOS state instead of guessing what you meant by "chat interface".';
    const complaintContext =
      'user: You keep misunderstanding what I am asking.\nagent: I inspected the active AgenticOS state instead of guessing what you meant.';
    const investigationContext =
      'user: Why does the UI still look wrong?\nagent: I inspected the active AgenticOS state (runtime, gateway, frontend).';
    const delegatedContext =
      'user: Ask CodeX to fix the transcript overlap.\nagent: I started task ab12cd34. CodeX is working on it in the background.';
    const simpleContext = 'user: Jarvis, say hello.\nagent: Hello! How can I assist you today?';
    const failureContext =
      'user: The gateway is offline.\nagent: I inspected and found OpenRouter unreachable — the request failed.';

    it('CASE A: "Can you change that?" resolves to prior UI problem → INVESTIGATE (no clarification)', async () => {
      const result = await router.routeIntent('Can you change that?', { recentText: uiProblemContext });
      expect(result.route).toBe('investigate');
    });

    it('CASE A2: "Fix it." after a UI problem → INVESTIGATE (no clarification)', async () => {
      const result = await router.routeIntent('Fix it.', { recentText: uiProblemContext });
      expect(result.route).toBe('investigate');
    });

    it('CASE B: correction changes subject (repository bar) — still investigated as UI problem', async () => {
      const result = await router.routeIntent('No, I mean the repository bar.', { recentText: uiProblemContext });
      // The correction names a UI element explicitly → operational investigation.
      expect(result.route).toBe('investigate');
    });

    it('CASE C: "Continue." after an investigation → continues the same goal (INVESTIGATE)', async () => {
      const result = await router.routeIntent('Continue.', { recentText: investigationContext });
      expect(result.route).toBe('investigate');
      // The continuation may resolve as "prior investigation" or, when the
      // investigation context itself names UI problems, "prior UI problem" —
      // both are evidence-based continuations, never generic chat.
      expect(result.reason).toMatch(/prior (investigation|UI problem)/);
    });

    it('CASE C2: "Continue." after a delegation → continues the delegated task (INVESTIGATE/operational, not generic)', async () => {
      const result = await router.routeIntent('Continue.', { recentText: delegatedContext });
      expect(result.route).toBe('investigate');
    });

    it('CASE D: complaint about Jarvis behavior → INVESTIGATE, not generic capabilities reply', async () => {
      const result = await router.routeIntent('You keep misunderstanding what I am asking.', { recentText: '' });
      expect(result.route).toBe('investigate');
      expect(result.reason).not.toMatch(/capabilit/i);
    });

    it('CASE D2: "Continue." after a complaint → continues the complaint investigation', async () => {
      const result = await router.routeIntent('Continue.', { recentText: complaintContext });
      expect(result.route).toBe('investigate');
    });

    it('CASE E: "Jarvis, say hello." → DIRECT, no clarification, no engineering task', async () => {
      const result = await router.routeIntent('Jarvis, say hello.', { recentText: '' });
      expect(result.route).toBe('direct');
    });

    it('CASE F: destructive ambiguous "Delete it." with two plausible objects → clarification ALLOWED', async () => {
      const result = await router.routeIntent('Delete it.', {
        recentText: 'user: the transcript panel and the composer both look wrong\nagent: I inspected both.',
      });
      expect(result.route).toBe('clarification_required');
    });

    it('CASE F2: destructive with a single clear referent → NOT clarified', async () => {
      const result = await router.routeIntent('Delete it.', {
        recentText: 'user: the stale log entry is wrong\nagent: I inspected it.',
      });
      expect(result.route).not.toBe('clarification_required');
    });

    it('CASE I: "Why does it keep saying file not found?" → operational investigation (file evidence)', async () => {
      const result = await router.routeIntent('Why does it keep saying file not found?', { recentText: '' });
      expect(result.route).toBe('investigate');
    });

    it('CASE J: "Is Hermes finished?" → task-state question (operational), not generic chat', async () => {
      const result = await router.routeIntent('Is Hermes finished?', { recentText: '' });
      // Task-state questions must not be a generic direct answer; they are
      // routed operationally so the run state is inspected.
      expect(result.route).toBe('investigate');
    });

    it('CASE J2: "What happened?" after a failure → continues/retries the prior goal', async () => {
      const result = await router.routeIntent('What happened?', { recentText: failureContext });
      expect(result.route).toBe('investigate');
    });

    it('retry: "try again" after a failure → RETRY the prior goal (operational)', async () => {
      const result = await router.routeIntent('try again', { recentText: failureContext });
      expect(result.route).toBe('investigate');
    });

    it('affirmative follow-up with recent context → direct, subject retained (not clarification)', async () => {
      const result = await router.routeIntent('yes', { recentText: simpleContext });
      expect(result.route).toBe('direct');
    });

    it('"Why?" after a Jarvis statement → continues the prior subject', async () => {
      const result = await router.routeIntent('why?', { recentText: investigationContext });
      expect(result.route).toBe('investigate');
    });

    it('standalone "Continue." with NO context → may clarify (genuinely ambiguous)', async () => {
      const result = await router.routeIntent('Continue.', { recentText: '' });
      expect(result.route).toBe('clarification_required');
    });

    it('golden: "Why is the chat interface like this?" → investigate', async () => {
      const result = await router.routeIntent('Why is the chat interface like this?', { recentText: '' });
      expect(result.route).toBe('investigate');
    });

    it('golden: "I asked you to change this already." → investigate (prior change intent)', async () => {
      const result = await router.routeIntent('I asked you to change this already.', { recentText: uiProblemContext });
      expect(result.route).toBe('investigate');
    });

    it('golden: "It\'s still not working." → investigate (problem report)', async () => {
      const result = await router.routeIntent('It\'s still not working.', { recentText: '' });
      expect(result.route).toBe('investigate');
    });

    it('golden: "You are not understanding what I\'m asking." → investigate (complaint)', async () => {
      const result = await router.routeIntent('You are not understanding what I\'m asking.', { recentText: '' });
      expect(result.route).toBe('investigate');
    });

    it('golden: "What is the transcript panel?" → DIRECT (informational, never investigate)', async () => {
      const result = await router.routeIntent('What is the transcript panel?', { recentText: '' });
      expect(result.route).toBe('direct');
    });
  });
});
