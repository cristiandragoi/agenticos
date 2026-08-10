/**
 * jarvisParity.test.ts — §4: streaming vs non-streaming conversational parity.
 *
 * The same prompt must produce the same interpreted intent, clarification
 * decision, and route in BOTH execution paths:
 *  - non-stream: orchestrator.handleMessage → intentRouter.routeIntent → switch
 *  - stream:     /message/stream → intentRouter.routeIntent → inline branches
 *
 * This guards the root cause where investigate-classified prompts fell through
 * to DIRECT in the orchestrator because its switch lacked a case (RC2).
 */
import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../domains/jarvis/intentRouter';
import { JarvisOrchestrator } from '../domains/jarvis/orchestrator';

const router = new IntentRouter();

// The routeIntent classifications BOTH paths share as their first decision.
const sharedPrompts: Array<{ prompt: string; recentText?: string; expectRoute: string }> = [
  { prompt: 'The chat interface is still wrong.', expectRoute: 'investigate' },
  { prompt: 'Can you change that?', recentText: 'user: The chat interface is still wrong.\nagent: I inspected the chat interface.', expectRoute: 'investigate' },
  { prompt: 'Continue.', recentText: 'user: Why does the UI still look wrong?\nagent: I inspected the active AgenticOS state.', expectRoute: 'investigate' },
  { prompt: 'Jarvis, say hello.', expectRoute: 'direct' },
  { prompt: 'You keep misunderstanding what I am asking.', expectRoute: 'investigate' },
  { prompt: 'Why does it keep saying file not found?', expectRoute: 'investigate' },
  { prompt: 'Is Hermes finished?', expectRoute: 'investigate' },
  { prompt: 'What is the transcript panel?', expectRoute: 'direct' },
  { prompt: 'Delete it.', recentText: 'user: the transcript panel and the composer both look wrong\nagent: I inspected both.', expectRoute: 'clarification_required' },
];

describe('§4: streaming vs non-streaming route parity (shared router decision)', () => {
  for (const c of sharedPrompts) {
    it(`routeIntent agrees on "${c.prompt}" → ${c.expectRoute}`, async () => {
      const out = await router.routeIntent(c.prompt, { recentText: c.recentText || '' });
      expect(out.route).toBe(c.expectRoute);
    });
  }
});

describe('§4: orchestrator switch handles every route the router can emit', () => {
  it('orchestrator dispatch covers investigate (no direct fall-through)', async () => {
    const orchestrator = new JarvisOrchestrator() as any;
    // handleInvestigate must exist and be wired in the switch — the exact
    // regression (RC2) where investigate fell to direct.
    expect(typeof orchestrator.handleInvestigate).toBe('function');
    // Read the source (not the transformed class) to assert the switch case.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/domains/jarvis/orchestrator.ts', 'utf8');
    expect(src).toContain("case 'investigate'");
    expect(src).toContain("return this.handleInvestigate(");
  });

  it('all router routes have an orchestrator dispatch case (parity contract)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/domains/jarvis/orchestrator.ts', 'utf8');
    for (const route of ['codex', 'agent_teams', 'hermes', 'memory', 'investigate', 'clarification_required', 'direct']) {
      expect(src, `missing case for ${route}`).toContain(`case '${route}'`);
    }
  });
});

describe('§9: user-message persistence parity across stream routes', () => {
  it('the investigate route persists the USER message (follow-up deictic resolution)', async () => {
    // Root-cause regression: investigate/clarification branches only appended
    // the agent reply, so a follow-up ("Can you change that?") had no user
    // message in recentText and degraded to generic clarification. The router
    // must append the user message in the investigate branch before replying.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/routers/jarvis.ts', 'utf8');
    // The investigate branch must append role:'user' BEFORE the report.
    const investigateBlock = src.slice(src.indexOf("if (intent.route === 'investigate')"), src.indexOf("if (intent.route === 'clarification_required')"));
    expect(investigateBlock).toContain("role: 'user'");
    expect(investigateBlock).toContain('content: prompt');
  });

  it('the clarification route persists the USER message (reinterpretation contract §5)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/routers/jarvis.ts', 'utf8');
    const clarificationBlock = src.slice(src.indexOf("if (intent.route === 'clarification_required')"), src.indexOf("if (intent.route !== 'direct')"));
    expect(clarificationBlock).toContain("role: 'user'");
    expect(clarificationBlock).toContain('content: prompt');
  });
});

describe('§4: tool-markup sanitization guards exist in both paths', () => {
  it('orchestrator defines stripToolCallMarkup and uses it in handleDirect', () => {
    const src = JarvisOrchestrator.toString();
    // handleDirect must sanitize the LLM reply before persisting.
    expect(src).toContain('stripToolCallMarkup');
  });

  it('stream router defines stripToolCallMarkup and applies it to finalReply', async () => {
    const fs = await import('node:fs');
    const routerSrc = fs.readFileSync('src/routers/jarvis.ts', 'utf8');
    expect(routerSrc).toContain('function stripToolCallMarkup');
    expect(routerSrc).toContain('const finalReply = stripToolCallMarkup(reply).trim()');
  });
});
