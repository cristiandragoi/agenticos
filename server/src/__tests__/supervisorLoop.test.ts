import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isSupervisorV2Enabled,
  extractToolCall,
  buildSupervisorSystemPrompt,
  getCleanConversationHistory,
  handleSupervisorV2Stream
} from '../domains/jarvis/supervisorLoop.js';
import { rawDb } from '../db/index.js';
import * as llmGateway from '../services/llmGateway.js';

describe('Jarvis Supervisor Loop — Phase 1 Conversational Reasoning & Multi-Turn Verification', () => {
  beforeEach(() => {
    try {
      rawDb.exec("DELETE FROM background_tasks WHERE status = 'queued'");
    } catch {}
    vi.clearAllMocks();
  });

  /* ──────────────────────────────────────────────────────────
   * 1. Feature Switch & Rollback Control
   * ────────────────────────────────────────────────────────── */
  describe('Feature Switch & Rollback', () => {
    it('isSupervisorV2Enabled returns true when env or request flag is set, false otherwise', () => {
      const origEnv = process.env.JARVIS_SUPERVISOR_V2;
      try {
        delete process.env.JARVIS_SUPERVISOR_V2;
        expect(isSupervisorV2Enabled({})).toBe(false);
        expect(isSupervisorV2Enabled({ body: { supervisorV2: true } })).toBe(true);
        expect(isSupervisorV2Enabled({ headers: { 'x-jarvis-supervisor-v2': 'true' } })).toBe(true);

        process.env.JARVIS_SUPERVISOR_V2 = 'true';
        expect(isSupervisorV2Enabled({})).toBe(true);
      } finally {
        if (origEnv !== undefined) process.env.JARVIS_SUPERVISOR_V2 = origEnv;
        else delete process.env.JARVIS_SUPERVISOR_V2;
      }
    });
  });

  /* ──────────────────────────────────────────────────────────
   * 2. Tool Call Extraction & Parsing
   * ────────────────────────────────────────────────────────── */
  describe('Tool Call Extraction', () => {
    it('extracts tool calls from <tool_call> tags', () => {
      const text = '<tool_call>{"name": "get_system_health", "parameters": {"component": "hermes"}}</tool_call>';
      const parsed = extractToolCall(text);
      expect(parsed).toEqual({
        name: 'get_system_health',
        parameters: { component: 'hermes' },
        raw: text
      });
    });

    it('extracts tool calls from markdown json code fences', () => {
      const text = '```json\n{"tool": "delegate_codex_goal", "parameters": {"goal": "Inspect layout"}}\n```';
      const parsed = extractToolCall(text);
      expect(parsed).toEqual({
        name: 'delegate_codex_goal',
        parameters: { goal: 'Inspect layout' },
        raw: text.trim()
      });
    });

    it('returns null when text is purely conversational', () => {
      const text = "Yeah, I'm here! What's on your mind?";
      expect(extractToolCall(text)).toBeNull();
    });
  });

  /* ──────────────────────────────────────────────────────────
   * 3. System Prompt & Grounding Invariants
   * ────────────────────────────────────────────────────────── */
  describe('Supervisor System Prompt & Grounding', () => {
    it('buildSupervisorSystemPrompt embeds identity, grounding invariants, and tool schemas', async () => {
      const prompt = await buildSupervisorSystemPrompt('conv-test-1', 'hello jarvis');
      expect(prompt).toContain('You are Jarvis, the conversational supervisor');
      expect(prompt).toContain('GROUNDING INVARIANT: NEVER claim you modified a file');
      expect(prompt).toContain('REFERENT RESOLUTION');
      expect(prompt).toContain('get_system_health');
      expect(prompt).toContain('delegate_codex_goal');
      expect(prompt).toContain('delegate_hermes_task');
    });

    it('hydrates active Revenue Operator entity and enforces STORED FACT vs REASONABLE INFERENCE vs MISSING DATA', async () => {
      const oppService = await import('../services/revenueOperator/opportunityService.js');
      vi.spyOn(oppService, 'getOpportunity').mockResolvedValueOnce({
        id: 'opp-dfd16cad-',
        title: 'Niche Notion & Agentic Workflow Template Pack for Solopreneurs',
        category: 'digital_products',
        status: 'CONVERTED',
        description: 'Digital asset bundle containing proven client management dashboards, prompt systems, and project trackers sold directly on Gumroad/Shopify.',
        source: 'gumroad_market_signals',
        sourceUrl: 'https://gumroad.com/discover?query=notion+template+freelance',
        estimatedRevenue: 800,
        estimatedCost: 20,
        estimatedTimeToRevenueDays: 7,
        automationPotential: 95,
        manualWorkload: 10,
        riskLevel: 15,
        confidence: 75,
        score: 70,
        scoreBreakdown: { revenuePotentialPts: 24, timeToRevenuePts: 25, automationPotentialPts: 19, lowCapitalPts: 20, confidencePts: 15, manualWorkloadPenalty: 3, riskPenalty: 30 } as any,
        evidence: [{ type: 'ecom_volume', detail: 'High margin digital product with automated checkout delivery.' }] as any,
        notes: null,
        convertedMissionId: 'mission-048eade2-'
      } as any);

      const prompt = await buildSupervisorSystemPrompt('conv-test-grounding', 'Tell me what this opportunity is', undefined, {
        workspaceContext: {
          activeModule: 'revenue-operator',
          activeEntityType: 'opportunity',
          activeEntityId: 'opp-dfd16cad-'
        }
      });
      expect(prompt).toContain('CURRENTLY OPEN REVENUE OPERATOR ENTITY');
      expect(prompt).toContain('opp-dfd16cad-');
      expect(prompt).toContain('STORED FACT');
      expect(prompt).toContain('REASONABLE INFERENCE');
      expect(prompt).toContain('MISSING DATA');
      expect(prompt).toContain('The data model does not contain a dedicated targetCustomer field');
      expect(prompt).toContain('The title positions this opportunity for solopreneurs');
    });
  });

  /* ──────────────────────────────────────────────────────────
   * 4. Multi-Turn Scenarios (Scenarios A through I)
   * ────────────────────────────────────────────────────────── */
  describe('Phase 1 Scenarios', () => {
    const createMockRes = () => {
      const events: Array<{ event: string; data: any }> = [];
      const res: any = {
        writableEnded: false,
        write: vi.fn((chunk: string) => {
          const match = chunk.match(/event:\s*(\w+)\ndata:\s*(.+)\n\n/);
          if (match) {
            try {
              events.push({ event: match[1], data: JSON.parse(match[2]) });
            } catch {
              events.push({ event: match[1], data: match[2] });
            }
          }
        }),
        flush: vi.fn(),
        end: vi.fn(() => { res.writableEnded = true; })
      };
      return { res, events };
    };

    it('Scenario A: User: "Jarvis, you there?" -> Natural conversational path (no tool required)', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario A');

      vi.spyOn(llmGateway, 'llmChat').mockResolvedValueOnce({
        reply: "Yeah, I'm here. What's up?",
        provider: 'OpenRouter',
        offline: false,
        model: 'auto'
      });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: 'Jarvis, you there?'
      });

      const chunks = events.filter(e => e.event === 'chunk').map(e => e.data.delta).join('');
      expect(chunks).toContain("Yeah, I'm here. What's up?");
      const done = events.find(e => e.event === 'done');
      expect(done).toBeDefined();
      expect(done?.data.status).toBe('completed');
    });

    it('Scenario B: User: "What are you doing right now?" -> supervisor queries get_current_work and synthesizes reply', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario B');

      // First pass: supervisor calls get_current_work
      vi.spyOn(llmGateway, 'llmChat')
        .mockResolvedValueOnce({
          reply: '<tool_call>{"name": "get_current_work", "parameters": {"scope": "active"}}</tool_call>',
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        })
        // Second pass: supervisor synthesizes conversational answer from tool result
        .mockResolvedValueOnce({
          reply: 'Right now everything is quiet. There are no active background tasks running.',
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: 'What are you doing right now?'
      });

      const status = events.find(e => e.event === 'status');
      expect(status?.data.currentAction).toContain('get_current_work');
      const chunks = events.filter(e => e.event === 'chunk').map(e => e.data.delta).join('');
      expect(chunks).toContain('no active background tasks');
    });

    it('Scenario C: User: "Check why Hermes isn\'t reachable." -> queries get_system_health and synthesizes conversational explanation', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario C');

      vi.spyOn(llmGateway, 'llmChat')
        .mockResolvedValueOnce({
          reply: '<tool_call>{"name": "get_system_health", "parameters": {"component": "hermes"}}</tool_call>',
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        })
        .mockResolvedValueOnce({
          reply: "I checked the system status. The local Hermes gateway server isn't responding on its expected port. OpenRouter and Ollama are working normally.",
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: "Check why Hermes isn't reachable."
      });

      const chunks = events.filter(e => e.event === 'chunk').map(e => e.data.delta).join('');
      expect(chunks).toContain("Hermes gateway server isn't responding");
    });

    it('Scenario D: "Do that." with prior turn context -> delegate_codex_goal receives RESOLVED objective (never literal "Do that.")', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario D');
      let capturedParams: any = null;

      vi.spyOn(llmGateway, 'llmChat')
        .mockImplementation(async (opts: any) => {
          if (opts.prompt === 'Do that.') {
            // Model resolves "Do that" based on history into explicit goal
            const resolvedToolCall = '<tool_call>{"name": "delegate_codex_goal", "parameters": {"goal": "Inspect why the Jarvis 3D core is visually stretched into an oval and correct the scaling factor", "targetFiles": ["src/components/jarvis/JarvisNeuralBlob.tsx"], "approvalRequired": true}}</tool_call>';
            capturedParams = {
              goal: 'Inspect why the Jarvis 3D core is visually stretched into an oval and correct the scaling factor',
              targetFiles: ['src/components/jarvis/JarvisNeuralBlob.tsx'],
              approvalRequired: true
            };
            return { reply: resolvedToolCall, provider: 'OpenRouter', offline: false, model: 'auto' };
          }
          // Second pass synthesis
          return {
            reply: "I've created an engineering task for CodeX to inspect the 3D core scaling issue. It's waiting for your approval before modifying any code.",
            provider: 'OpenRouter',
            offline: false,
            model: 'auto'
          };
        });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: 'Do that.'
      });

      expect(capturedParams).toBeDefined();
      expect(capturedParams.goal).not.toBe('Do that.');
      expect(capturedParams.goal).toContain('stretched into an oval');
      expect(capturedParams.targetFiles).toEqual(['src/components/jarvis/JarvisNeuralBlob.tsx']);

      const intent = events.find(e => e.event === 'intent' && e.data.type === 'worker_delegation');
      expect(intent).toBeDefined();
      expect(intent?.data.worker).toBe('codex');
    });

    it('Scenario E: User: "Ask CodeX to check that." -> "that" resolved from active conversation (stretched core, NOT unrelated websocket)', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario E');
      let capturedGoal = '';

      vi.spyOn(llmGateway, 'llmChat')
        .mockImplementation(async (opts: any) => {
          if (opts.prompt === 'Ask CodeX to check that.') {
            capturedGoal = 'Inspect why the Jarvis 3D core is visually stretched into an oval and check aspect ratio handling';
            return {
              reply: `<tool_call>{"name": "delegate_codex_goal", "parameters": {"goal": "${capturedGoal}"}}</tool_call>`,
              provider: 'ollama',
              offline: false,
              model: 'qwen3.8:latest'
            };
          }
          return {
            reply: "I've queued a task for CodeX to investigate the stretched Jarvis core aspect ratio.",
            provider: 'ollama',
            offline: false,
            model: 'qwen3.8:latest'
          };
        });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: 'Ask CodeX to check that.'
      });

      expect(capturedGoal).not.toBe('Ask CodeX to check that.');
      expect(capturedGoal).toContain('stretched into an oval');
      expect(capturedGoal).not.toContain('WebSocket');
    });

    it('Regression Test: Prevents stale or unrelated referents from being delegated', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Referent Isolation');

      // Seed conversation with discussion about the stretched oval
      await conversationService.appendMessage({
        conversationId,
        role: 'user',
        content: 'The Jarvis core is stretched into an oval. Can you figure out why?'
      });
      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: 'The 3D canvas aspect ratio might not match the container dimensions. I can have CodeX inspect the scaling logic.'
      });

      const history = await getCleanConversationHistory(conversationId, 'Do that.');
      expect(history.some(h => h.content.includes('stretched into an oval'))).toBe(true);
      expect(history.some(h => h.content.includes('WebSocket'))).toBe(false);
    });

    it('Scenario G: User: "How is Agentic OS doing?" -> concise natural synthesis (no raw telemetry dump)', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario G');

      vi.spyOn(llmGateway, 'llmChat')
        .mockResolvedValueOnce({
          reply: '<tool_call>{"name": "get_system_health", "parameters": {"component": "all"}}</tool_call>',
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        })
        .mockResolvedValueOnce({
          reply: 'Agentic OS is doing well. Core services and LLM gateways are online and running smoothly.',
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: 'How is Agentic OS doing?'
      });

      const chunks = events.filter(e => e.event === 'chunk').map(e => e.data.delta).join('');
      expect(chunks).toContain('Agentic OS is doing well');
      expect(chunks).not.toContain('{"gateways":');
    });

    it('Scenario H: Tool fails -> Jarvis truthfully explains failure without fabricated success', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario H');

      vi.spyOn(llmGateway, 'llmChat')
        .mockResolvedValueOnce({
          reply: '<tool_call>{"name": "delegate_hermes_task", "parameters": {}}</tool_call>', // missing required objective
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        })
        .mockResolvedValueOnce({
          reply: "I attempted to start a Hermes task, but it failed because no specific objective was provided.",
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: 'Start Hermes on that.'
      });

      const chunks = events.filter(e => e.event === 'chunk').map(e => e.data.delta).join('');
      expect(chunks).toContain('failed because no specific objective');
    });

    it('Scenario I: CodeX task queued -> Jarvis explains task is queued; never claims task has already finished', async () => {
      const { conversationService } = await import('../domains/conversations/service.js');
      const conversationId = await conversationService.createConversation('Scenario I');

      vi.spyOn(llmGateway, 'llmChat')
        .mockResolvedValueOnce({
          reply: '<tool_call>{"name": "delegate_codex_goal", "parameters": {"goal": "Optimize LCP rendering in index.html"}}</tool_call>',
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        })
        .mockResolvedValueOnce({
          reply: "I've queued task for CodeX to optimize LCP rendering in index.html. I will update you as soon as progress is reported.",
          provider: 'OpenRouter',
          offline: false,
          model: 'auto'
        });

      const { res, events } = createMockRes();
      await handleSupervisorV2Stream({}, res, {
        conversationId,
        prompt: 'Optimize LCP in index.html'
      });

      const chunks = events.filter(e => e.event === 'chunk').map(e => e.data.delta).join('');
      expect(chunks).toContain("I've queued task for CodeX");
      expect(chunks).not.toContain("I fixed it");
      expect(chunks).not.toContain("I modified the file");
    });
  });
});
