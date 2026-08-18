import { describe, it, expect } from 'vitest';
import {
  isAcceptanceArtifactProject,
  humanProjectName,
  toUniverseProjects,
  type ProjectRecordLike,
} from '../lib/universeProjects';

describe('universeProjects — Visual Universe project filtering', () => {
  it('rejects every proven acceptance artifact shape from the live DB', () => {
    const junk: ProjectRecordLike[] = [
      { id: 'proj-36fca648', name: 'Project: example.com/' },
      { id: 'proj-2b051f3c', name: 'Packaged CodeX Acceptance Project' },
      { id: 'proj-c11cfe54', name: 'Packaged Production CodeX Project' },
      { id: 'proj-d95123d8', name: 'Production Memory Proof' },
      { id: 'proj-eacebebf', name: 'Project B Isolation' },
      { id: 'proj-b41b7a3a', name: 'Hermes Smoke 1786906088448' },
      { id: 'proj-41cdab8f', name: 'Hermes Smoke A 1786906429384' },
      { id: 'proj-b5818ed9', name: 'RunNow D 1786906490593' },
      { id: 'proj-ef296058', name: 'Failure I 1786906617489' },
      { id: 'proj-4e8f3e67', name: 'Magnitude B 1786907008290' },
      { id: 'proj-c89100d3', name: 'CodeX C 1786907141045' },
      { id: 'proj-e9b5c01a', name: 'EnableE 1786907206922' },
      { id: 'proj-560b9645', name: 'EnableE test' },
      { id: 'proj-54c83d85', name: 'EnableE 1786907248595' },
      { id: 'proj-94ff100f', name: 'Restart/Misfire 1786907472106' },
      { id: 'proj-2d4eabbb', name: 'Misfire2 1786908706804' },
      { id: 'proj-8c23288c', name: 'CancelJ 1786910383189' },
      { id: 'proj-4cf7abd1', name: 'DiagJ 1786910749170' },
      { id: 'proj-7cd95a68', name: 'DiagJ4 1786910817938' },
      { id: 'proj-522438a3', name: 'MemoryIsoB 1786912077375' },
      { id: 'proj-hermes-79f4a36b', name: 'Hermes Research Acceptance Project' },
      { id: 'proj-plan-8fca32cd', name: 'Affiliate Commerce Strategy Project' },
      { id: 'proj-cancel-413054f7', name: 'Cancellation Test Project' },
      { id: 'proj-dsh-77ea0609', name: 'DSH Read-Only Analysis POC' },
      { id: 'proj-test-348046', name: 'Test' },
      { id: 'proj-truth-3527368d', name: 'Provider Truth Project' },
      { id: 'proj-9ea152db', name: 'Agentic OS Architecture Test' },
      { id: 'proj-8a87d16b', name: 'Overnight Architecture Test Project' },
      { id: 'proj-ea47d5a8', name: 'Verifier Evidence Test Project' },
      { id: 'proj-901c7001', name: 'CodeX Engineering Canonical Project' },
    ];
    for (const p of junk) {
      expect(isAcceptanceArtifactProject(p), `should reject: ${p.name}`).toBe(true);
    }
  });

  it('accepts real persisted user projects (sparse universe stays honest)', () => {
    const real: ProjectRecordLike[] = [
      { id: 'proj-ac4c89f0', name: 'AgenticOS', description: 'The AgenticOS platform itself', tags: ['platform', 'dev'], color: '#00d4ff' },
      { id: 'proj-abc12345', name: 'Recruiting', tags: [] },
      { id: 'proj-def67890', name: 'Jewelry Store' },
      { id: 'proj-11111111', name: 'Shopify' },
      { id: 'proj-22222222', name: 'Affiliate Business' },
      { id: 'proj-33333333', name: 'Organic Growth' },
      { id: 'proj-44444444', name: 'Production' },
      { id: 'proj-55555555', name: 'Website Redesign' },
    ];
    for (const p of real) {
      expect(isAcceptanceArtifactProject(p), `should accept: ${p.name}`).toBe(false);
    }
  });

  it('rejects by acceptance tag even when the name looks like a real project', () => {
    expect(isAcceptanceArtifactProject({ id: 'proj-aaaa1111', name: 'Recruiting', tags: ['acceptance'] })).toBe(true);
    expect(isAcceptanceArtifactProject({ id: 'proj-aaaa1111', name: 'Recruiting', tags: ['fixture'] })).toBe(true);
  });

  it('humanProjectName strips harness timestamps and prefixes', () => {
    expect(humanProjectName({ id: 'x', name: 'Hermes Smoke 1786906088448' })).toBe('Hermes Smoke');
    expect(humanProjectName({ id: 'x', name: 'Project: example.com/' })).toBe('example.com/');
    expect(humanProjectName({ id: 'x', name: '   Website Redesign   ' })).toBe('Website Redesign');
    expect(humanProjectName({ id: 'x', name: 'Recruiting' })).toBe('Recruiting');
  });

  it('toUniverseProjects keeps only real projects with readable names', () => {
    const rows: ProjectRecordLike[] = [
      { id: 'proj-b41b7a3a', name: 'Hermes Smoke 1786906088448' },
      { id: 'proj-abc12345', name: 'Recruiting' },
      { id: 'proj-ac4c89f0', name: 'AgenticOS', color: '#00d4ff' },
    ];
    const universe = toUniverseProjects(rows);
    expect(universe.map((p) => p.name)).toEqual(['Recruiting', 'AgenticOS']);
    expect(universe.find((p) => p.id === 'proj-ac4c89f0')?.color).toBe('#00d4ff');
    // Raw ids are never used as labels.
    expect(universe.every((p) => !p.name.includes('proj-'))).toBe(true);
  });

  it('returns an empty universe when every record is an artifact (no fake stars)', () => {
    const rows: ProjectRecordLike[] = [
      { id: 'proj-8c23288c', name: 'CancelJ 1786910383189' },
      { id: 'proj-test-348046', name: 'Test' },
    ];
    expect(toUniverseProjects(rows)).toEqual([]);
  });
});
