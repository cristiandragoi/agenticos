import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseJarvisAction,
  resolveContextualEntity,
  recordAction,
  getLatestAction,
  type AgenticActionRecord
} from '../domains/jarvis/actionRuntime.js';

describe('Jarvis Action Runtime & Entity Resolution', () => {
  it('detects OPEN_MODULE intent for top-level capability', async () => {
    const res = await parseJarvisAction('Open Revenue Operator');
    expect(res.isAction).toBe(true);
    if ('action' in res) {
      expect(res.action.type).toBe('OPEN_MODULE');
      expect(res.action.module).toBe('revenue_operator');
      expect(res.action.route).toBe('/revenue-operator');
    }
  });

  it('opens the persisted Free Cash project instead of treating it as an unknown entity', async () => {
    const res = await parseJarvisAction('Open the Free Cash project.');
    expect(res.isAction).toBe(true);
    if ('action' in res) {
      expect(res.action.type).toBe('OPEN_ENTITY');
      expect(res.action.entityType).toBe('project');
      expect(res.action.displayName).toBe('Free Cash');
      expect(res.action.destination).toBe('/projects?project=proj-free-cash');
    }
  });

  it('resolves exact nested entity in Revenue Operator', async () => {
    const res = await parseJarvisAction('Open the Notion and Agentic workflow template', {
      activeModule: 'revenue-operator'
    });
    expect(res.isAction).toBe(true);
    if ('action' in res) {
      expect(res.action.type).toBe('OPEN_ENTITY');
      expect(res.action.module).toBe('revenue-operator');
      expect(res.action.entityType).toBe('opportunity');
      expect(res.action.displayName).toContain('Notion');
      expect(res.action.destination).toContain('/revenue-operator?opportunity=');
    }
  });

  it('resolves shortened alias entity name in Revenue Operator', async () => {
    const res = await parseJarvisAction('Open the Notion template', {
      activeModule: 'revenue-operator'
    });
    expect(res.isAction).toBe(true);
    if ('action' in res) {
      expect(res.action.type).toBe('OPEN_ENTITY');
      expect(res.action.displayName).toContain('Notion');
      expect(res.action.destination).toContain('/revenue-operator?opportunity=');
    }
  });

  it('returns ENTITY_NOT_FOUND for non-existent entity without generic filler', async () => {
    const res = await parseJarvisAction('Open Project XYZ123', {
      activeModule: 'revenue-operator'
    });
    expect(res.isAction).toBe(true);
    if ('failure' in res) {
      expect(res.failure.code).toBe('ENTITY_NOT_FOUND');
      expect(res.failure.message).toContain('No matching entity found');
    }
  });

  it('detects ambiguous matches when multiple entities share identical scores', async () => {
    const context = {
      activeModule: 'revenue-operator',
      availableLocalEntities: [
        {
          entityType: 'template',
          entityId: 'tmpl-1',
          displayName: 'Marketing Workflow Automation Template'
        },
        {
          entityType: 'template',
          entityId: 'tmpl-2',
          displayName: 'Sales Workflow Automation Template'
        }
      ]
    };
    const res = await resolveContextualEntity('workflow automation template', context);
    expect(res.status).toBe('ambiguous');
    if (res.status === 'ambiguous') {
      expect(res.code).toBe('ENTITY_AMBIGUOUS');
      expect(res.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('records and returns recent action for "Show me what you did"', async () => {
    const mockRecord: AgenticActionRecord = {
      id: 'act-test-1',
      ownerAgent: 'jarvis',
      module: 'revenue-operator',
      command: 'Open the Notion template',
      actionType: 'OPEN_ENTITY',
      displayName: 'Niche Notion & Agentic Workflow Template Pack',
      status: 'completed',
      startedAt: new Date().toISOString(),
      destination: '/revenue-operator?opportunity=opp-dfd16cad-'
    };
    recordAction(mockRecord);
    expect(getLatestAction()?.id).toBe('act-test-1');

    const res = await parseJarvisAction('Show me what you did');
    expect(res.isAction).toBe(true);
    if ('action' in res) {
      expect(res.action.type).toBe('SHOW_ACTIVITY');
      expect(res.explanation).toContain('Open the Notion template');
    }
  });

  it('returns isAction: false for non-action conversational query', async () => {
    const res = await parseJarvisAction('What is the weather today in Berlin?');
    expect(res.isAction).toBe(false);
  });
});
