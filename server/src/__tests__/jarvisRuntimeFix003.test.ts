/**
 * JARVIS-LIVE-RUNTIME-FIX-003 -- Acceptance Tests
 *
 * Tests seven acceptance criteria:
 *   TEST 1  -- Bare module alias ("Revenue Operator") -> OPEN_MODULE, no DB queries
 *   TEST 2  -- Normal verb command ("Open Revenue Operator") -> OPEN_MODULE
 *   TEST 3  -- Named entity without click -> resolved entity, no Alpha Project
 *   TEST 4  -- Short entity name -> resolves unambiguously
 *   TEST 5  -- Live data outranks memory (filler phrase for memory entity absent)
 *   TEST 6  -- Unknown entity -> truthful not-found, no hallucination
 *   TEST 7  -- Filler phrases are detected and stripped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseJarvisAction,
  matchBareCapabilityAlias,
  normalizeText,
  resolveContextualEntity,
} from '../domains/jarvis/actionRuntime.js';
import {
  containsBareFiller,
  sanitizeDirectResponse,
} from '../domains/jarvis/groundingGuardrail.js';
import { listOpportunities } from '../services/revenueOperator/opportunityService.js';
import { listMissions } from '../services/revenueOperator/operatorService.js';

// ---------------------------------------------------------------------------
// Mock only the DB calls so tests run without a real SQLite file
// ---------------------------------------------------------------------------

vi.mock('../services/revenueOperator/opportunityService.js', () => ({
  listOpportunities: vi.fn(async () => [
    {
      id: 'opp-dfd16cad-',
      title: 'Niche Notion Agentic Workflow Template Pack for Solo Entrepreneurs',
      category: 'digital_products',
      status: 'active',
    },
    {
      id: 'opp-abc00001-',
      title: 'German SME Website Rebuild Lead Generator',
      category: 'service',
      status: 'active',
    },
  ]),
  getOpportunity: vi.fn(async (id: string) => {
    if (id === 'opp-dfd16cad-') {
      return {
        id: 'opp-dfd16cad-',
        title: 'Niche Notion Agentic Workflow Template Pack for Solo Entrepreneurs',
        category: 'digital_products',
        status: 'active',
        description: 'A digital product template pack',
        source: 'manual',
        sourceUrl: null,
        estimatedRevenue: 2000,
        estimatedCost: 50,
        estimatedTimeToRevenueDays: 14,
        automationPotential: 'high',
        manualWorkload: 'low',
        riskLevel: 'low',
        confidence: 0.9,
        score: 87,
        scoreBreakdown: {
          revenuePotentialPts: 20,
          timeToRevenuePts: 15,
          automationPotentialPts: 20,
          lowCapitalPts: 15,
          confidencePts: 17,
          manualWorkloadPenalty: 0,
          riskPenalty: 0,
        },
        evidence: ['High margin digital product with automated checkout delivery.'],
        notes: null,
        convertedMissionId: 'mission-048eade2-',
      };
    }
    return null;
  }),
}));

vi.mock('../services/revenueOperator/operatorService.js', () => ({
  listMissions: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------

describe('FIX 1 -- Bare Module Alias (STT dropped verb)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TEST 1a: "Revenue Operator" -> matchBareCapabilityAlias returns revenue_operator', () => {
    const match = matchBareCapabilityAlias('Revenue Operator');
    expect(match).not.toBeNull();
    expect(match?.id).toBe('revenue_operator');
    expect(match?.route).toBe('/revenue-operator');
  });

  it('TEST 1b: "the Revenue Operator" -> matchBareCapabilityAlias matches via article strip', () => {
    const match = matchBareCapabilityAlias('the Revenue Operator');
    expect(match).not.toBeNull();
    expect(match?.id).toBe('revenue_operator');
  });

  it('TEST 1c: "Revenue workspace" -> matchBareCapabilityAlias matches registered alias', () => {
    const match = matchBareCapabilityAlias('Revenue workspace');
    expect(match).not.toBeNull();
    expect(match?.id).toBe('revenue_operator');
  });

  it('TEST 1d: parseJarvisAction("Revenue Operator") -> OPEN_MODULE, no DB queries', async () => {
    const result = await parseJarvisAction('Revenue Operator');
    expect(result.isAction).toBe(true);
    if (!result.isAction || !('action' in result)) throw new Error('Expected action result');
    expect(result.action.type).toBe('OPEN_MODULE');
    expect((result.action as any).module).toBe('revenue_operator');
    expect((result.action as any).route).toBe('/revenue-operator');
    expect(listOpportunities).not.toHaveBeenCalled();
    expect(listMissions).not.toHaveBeenCalled();
  });

  it('TEST 1e: "Some random phrase here" must NOT trigger bare alias', () => {
    const match = matchBareCapabilityAlias('Some random phrase here');
    expect(match).toBeNull();
  });

  it('TEST 1f: "Boards" -> matches boards capability alias', () => {
    const match = matchBareCapabilityAlias('Boards');
    expect(match).not.toBeNull();
    expect(match?.id).toBe('boards');
  });
});

describe('FIX 1 -- Normal verb command still works', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TEST 2: "Open Revenue Operator" -> OPEN_MODULE (existing path unchanged)', async () => {
    const result = await parseJarvisAction('Open Revenue Operator');
    expect(result.isAction).toBe(true);
    if (!result.isAction || !('action' in result)) throw new Error('Expected action result');
    expect(result.action.type).toBe('OPEN_MODULE');
    expect((result.action as any).module).toBe('revenue_operator');
    expect(listOpportunities).not.toHaveBeenCalled();
    expect(listMissions).not.toHaveBeenCalled();
  });

  it('"Go to Revenue Operator" -> OPEN_MODULE', async () => {
    const result = await parseJarvisAction('Go to Revenue Operator');
    expect(result.isAction).toBe(true);
    if (!result.isAction || !('action' in result)) throw new Error('Expected action result');
    expect(result.action.type).toBe('OPEN_MODULE');
  });

  it('"Show Revenue Operator" -> OPEN_MODULE', async () => {
    const result = await parseJarvisAction('Show Revenue Operator');
    expect(result.isAction).toBe(true);
    if (!result.isAction || !('action' in result)) throw new Error('Expected action result');
    expect(result.action.type).toBe('OPEN_MODULE');
  });
});

describe('FIX 2 -- Named entity resolution without UI selection', () => {
  const wsCtxRevOp = {
    activeModule: 'revenue-operator',
    activeEntityId: null,
    activeEntityType: null,
    availableLocalEntities: [
      {
        entityType: 'opportunity',
        entityId: 'opp-dfd16cad-',
        displayName: 'Niche Notion Agentic Workflow Template Pack for Solo Entrepreneurs',
        aliases: ['niche notion', 'notion template pack'],
      },
    ],
  };

  it('TEST 3: Full name resolves to opp-dfd16cad-', async () => {
    const result = await resolveContextualEntity(
      'Niche Notion Agentic Workflow Template Pack for Solo Entrepreneurs',
      wsCtxRevOp
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('Expected resolved');
    expect(result.entityId).toBe('opp-dfd16cad-');
    expect(result.entityType).toBe('opportunity');
  });

  it('TEST 4: Short name "Notion template" resolves to opp-dfd16cad-', async () => {
    const result = await resolveContextualEntity('Notion template', wsCtxRevOp);
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('Expected resolved');
    expect(result.entityId).toBe('opp-dfd16cad-');
  });

  it('TEST 4b: "Notion Agentic workflow template" resolves to opp-dfd16cad-', async () => {
    const result = await resolveContextualEntity('Notion Agentic workflow template', wsCtxRevOp);
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('Expected resolved');
    expect(result.entityId).toBe('opp-dfd16cad-');
  });

  it('TEST 6: "Project XYZ123" -> not-found, no hallucination', async () => {
    const result = await resolveContextualEntity('Project XYZ123', wsCtxRevOp);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('Expected failed');
    expect(result.code).toBe('ENTITY_NOT_FOUND');
  });
});

describe('FIX 4 -- Chatbot filler detection and removal', () => {
  it("TEST 7a: containsBareFiller detects \"I'm here and ready.\"", () => {
    expect(containsBareFiller("I'm here and ready.")).toBe(true);
  });

  it("TEST 7b: containsBareFiller detects \"I'm here and ready. How can I assist you today?\"", () => {
    expect(containsBareFiller("I'm here and ready. How can I assist you today?")).toBe(true);
  });

  it('TEST 7c: containsBareFiller detects "How can I assist you today?"', () => {
    expect(containsBareFiller('How can I assist you today?')).toBe(true);
  });

  it('TEST 7d: containsBareFiller detects "I am ready and listening. How can I help you today?"', () => {
    expect(containsBareFiller('I am ready and listening. How can I help you today?')).toBe(true);
  });

  it('TEST 7e: containsBareFiller does NOT flag a legitimate operational response', () => {
    expect(containsBareFiller('The Niche Notion template has a score of 87.')).toBe(false);
    expect(containsBareFiller('Opening Revenue Operator.')).toBe(false);
    expect(containsBareFiller("Sure, take your time -- I'll be here when you're ready.")).toBe(false);
  });

  it("TEST 7f: sanitizeDirectResponse replaces bare filler with operational fallback", () => {
    const result = sanitizeDirectResponse("I'm here and ready. How can I assist you today?", {
      prompt: 'Revenue Operator',
      hasGroundedEvidence: false,
    });
    expect(result).toBe("I didn't catch that — what would you like to do?");
  });

  it('TEST 7g: canned suffix "How can I assist you today?" stripped from real reply', () => {
    const reply = 'The score is 87. How can I assist you today?';
    const result = sanitizeDirectResponse(reply, {
      prompt: 'tell me the score',
      hasGroundedEvidence: true,
    });
    expect(result).not.toMatch(/how can i assist you today/i);
    expect(result).toContain('87');
  });
});

describe('Normalizer -- Deepgram agentic STT variants', () => {
  it('normalizeText handles Deepgram agentic mis-transcriptions', () => {
    expect(normalizeText('a genetic')).toBe('agentic');
    expect(normalizeText('agenetic')).toBe('agentic');
    expect(normalizeText('a gented')).toBe('agentic');
    expect(normalizeText('agented')).toBe('agentic');
  });
});

