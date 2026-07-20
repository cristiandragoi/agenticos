import { teamSheetSchema, TeamSheet } from './teamSheet.js';

describe('TeamSheet Zod Refinements', () => {
  const getValidSheet = (): TeamSheet => ({
    version: '1.0' as const,
    teamName: 'Test',
    objective: 'Test',
    workspaceRoot: '/test',
    agents: [
      {
        id: 'p1', name: 'Planner', role: 'Planner' as const,
        responsibilities: [], instructions: 'p', dependencies: [],
        allowedTools: [], readScopes: [], writeScopes: [], outputArtifacts: []
      },
      {
        id: 'b1', name: 'Builder', role: 'Builder' as const,
        responsibilities: [], instructions: 'b', dependencies: ['p1'],
        allowedTools: [], readScopes: [], writeScopes: ['src/'], outputArtifacts: []
      },
      {
        id: 'v1', name: 'Verifier', role: 'Verifier' as const,
        responsibilities: [], instructions: 'v', dependencies: ['p1', 'b1'],
        allowedTools: [], readScopes: [], writeScopes: [], outputArtifacts: []
      }
    ],
    handoffs: [],
    executionSequence: ['p1', 'b1', 'v1'],
    acceptanceCriteria: [],
    estimatedParallelism: 1,
    approvalRequired: true,
  });

  it('accepts valid team sheet', () => {
    const sheet = getValidSheet();
    expect(teamSheetSchema.parse(sheet)).toBeDefined();
  });

  it('rejects missing verifier', () => {
    const sheet = getValidSheet();
    sheet.agents = sheet.agents.filter(a => a.role !== 'Verifier');
    sheet.executionSequence = ['p1', 'b1'];
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('Exactly one Verifier'))).toBe(true);
    }
  });

  it('rejects unknown dependency', () => {
    const sheet = getValidSheet();
    sheet.agents[1].dependencies.push('unknown');
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('unknown agent unknown'))).toBe(true);
    }
  });

  it('rejects dependency cycle', () => {
    const sheet = getValidSheet();
    // p1 depends on v1, creating cycle p1 -> v1 -> b1 -> p1
    sheet.agents[0].dependencies.push('v1');
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('Dependency cycle detected'))).toBe(true);
    }
  });

  it('rejects absolute artifact path', () => {
    const sheet = getValidSheet();
    sheet.agents[0].outputArtifacts.push('/absolute/path');
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('Absolute path detected'))).toBe(true);
    }
  });

  it('rejects ../ path traversal', () => {
    const sheet = getValidSheet();
    sheet.agents[0].readScopes.push('../out_of_bounds');
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('Path traversal detected'))).toBe(true);
    }
  });

  it('rejects builder without write scope', () => {
    const sheet = getValidSheet();
    sheet.agents[1].writeScopes = [];
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('must have explicit write scopes'))).toBe(true);
    }
  });

  it('rejects verifier with source write access', () => {
    const sheet = getValidSheet();
    sheet.agents[2].writeScopes = ['src/'];
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('cannot have source-code write permissions'))).toBe(true);
    }
  });

  it('rejects executionSequence with duplicates', () => {
    const sheet = getValidSheet();
    sheet.executionSequence = ['p1', 'b1', 'p1'];
    const res = teamSheetSchema.safeParse(sheet);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => i.message.includes('executionSequence contains duplicates'))).toBe(true);
    }
  });
});
