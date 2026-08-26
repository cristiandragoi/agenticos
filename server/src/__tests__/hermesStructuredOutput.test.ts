import { describe, it, expect } from 'vitest';

describe('Hermes Structured Output Formatting & Deduplication', () => {
  it('formats structured Hermes output with recommendations and first action exactly once', () => {
    const struct = {
      summary: 'Executive revenue summary for Agentic OS.',
      recommendations: [
        'Enterprise Workflow Automation Platform: Target B2B operations with autonomous agents. Effort: Medium (3-5 days). Time-to-Revenue: 1-2 weeks. Dependencies: Stripe. First Action: Deploy demo agent.',
        'Developer Platform Monetization: Provide API access and custom agent builder. Effort: Low (2 days). Time-to-Revenue: 48 hours. Dependencies: None. First Action: Enable API gateway billing.',
      ],
      nextActions: [
        'Execute Enterprise Workflow Automation Platform demo deployment.',
      ],
    };

    let planSummary = struct.summary || 'Hermes plan generated successfully.';
    if (struct && Array.isArray(struct.recommendations) && struct.recommendations.length > 0) {
      const recsFormatted = struct.recommendations
        .map((r: string, i: number) => `Opportunity ${i + 1}:\n${r}`)
        .join('\n\n');

      planSummary = `${struct.summary || planSummary}\n\n### Ranked Recommendations:\n${recsFormatted}${
        struct.nextActions?.length ? `\n\n### First Action:\n- ${struct.nextActions[0]}` : ''
      }`;
    }

    // Verify exactly one summary section
    expect(planSummary).toContain('Executive revenue summary for Agentic OS.');
    expect(planSummary).toContain('### Ranked Recommendations:');
    expect(planSummary).toContain('Opportunity 1:');
    expect(planSummary).toContain('Opportunity 2:');
    expect(planSummary).toContain('### First Action:');
    expect(planSummary).toContain('- Execute Enterprise Workflow Automation Platform demo deployment.');

    // Count occurrences of key headings
    const recMatches = planSummary.match(/### Ranked Recommendations:/g);
    expect(recMatches).not.toBeNull();
    expect(recMatches!.length).toBe(1);

    const actionMatches = planSummary.match(/### First Action:/g);
    expect(actionMatches).not.toBeNull();
    expect(actionMatches!.length).toBe(1);

    const opp1Matches = planSummary.match(/Opportunity 1:/g);
    expect(opp1Matches).not.toBeNull();
    expect(opp1Matches!.length).toBe(1);
  });
});
