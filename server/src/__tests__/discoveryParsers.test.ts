/**
 * discoveryParsers.test.ts — regression guard for idea/company extraction.
 *
 * Guards the overnight-mission fix: Hermes discovery summaries arrive as
 * prose/markdown, and the strict-JSON-only parsers collapsed every batch
 * into ONE experiment. Both parsers must handle JSON, fenced JSON, markdown
 * lists, and ### heading blocks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let dp: any;
let sme: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-parse-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();
  dp = await import('../services/revenueOperator/digitalProductEngine.js');
  sme = await import('../services/revenueOperator/germanSmeEngine.js');
});

afterAll(() => {
  delete process.env.AGENT_TEAMS_DB_PATH;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('extractIdeas (digital products)', () => {
  it('parses strict JSON arrays', () => {
    const ideas = dp.extractIdeas(JSON.stringify([
      { title: 'VAT toolkit', problem: 'VAT pain', price: 29, channel: 'SHOPIFY' },
      { title: 'Cashflow calculator', problem: 'cashflow', price: 19 },
    ]));
    expect(ideas).toHaveLength(2);
    expect(ideas[0].title).toBe('VAT toolkit');
    expect(ideas[0].price).toBe(29);
  });

  it('parses fenced JSON inside prose', () => {
    const ideas = dp.extractIdeas('Here are the ideas:\n```json\n[{"title":"A product for shops","price":39},{"title":"Another tool","problem":"x"}]\n```\nDone.');
    expect(ideas).toHaveLength(2);
    expect(ideas[0].title).toBe('A product for shops');
  });

  it('parses markdown numbered lists (the overnight failure mode)', () => {
    const prose = `Here are 3 opportunities:
1. **Kassen-Nachschau Toolkit** — a compliance checklist for small retail shops. Price €25. Sell via SHOPIFY.
2. DSGVO Website-Audit Checkliste — GDPR self-audit for freelancers, €19.
3. Handwerker Angebots-Template — quote template for tradespeople, €29.`;
    const ideas = dp.extractIdeas(prose);
    expect(ideas.length).toBeGreaterThanOrEqual(3);
    expect(ideas[0].title).toContain('Kassen-Nachschau');
    expect(ideas[0].price).toBe(25);
    expect(ideas[0].channel).toBe('SHOPIFY');
  });

  it('parses ### heading blocks', () => {
    const md = `### Invoice Automation Template for agencies
A Notion-style system. €35.
### SEO Content Calendar
For small publishers. €15.`;
    const ideas = dp.extractIdeas(md);
    expect(ideas.length).toBe(2);
    expect(ideas[1].title).toContain('SEO Content Calendar');
    expect(ideas[1].price).toBe(15);
  });

  it('returns empty for empty/short prose without list structure', () => {
    expect(dp.extractIdeas(null)).toHaveLength(0);
    expect(dp.extractIdeas('just a sentence with no structure')).toHaveLength(0);
  });
});

describe('extractCompanies (german SME)', () => {
  it('parses JSON objects', () => {
    const cs = sme.extractCompanies(JSON.stringify({ companies: [{ name: 'Muster GmbH', website: 'https://muster.de', problem: 'manual invoicing' }] }));
    expect(cs).toHaveLength(1);
    expect(cs[0].name).toBe('Muster GmbH');
  });

  it('parses markdown lists with websites (overnight failure mode)', () => {
    const prose = `Companies found:
- **Bäckerei Sonnenkorn GmbH** (www.sonnenkorn.de) — manual order intake by phone every morning.
- Kanzlei Dr. Meier (https://kanzlei-meier.de) — repetitive document intake for mandates.`;
    const cs = sme.extractCompanies(prose);
    expect(cs.length).toBeGreaterThanOrEqual(2);
    expect(cs[0].name).toContain('Bäckerei Sonnenkorn');
    expect(cs[0].website).toContain('sonnenkorn');
    expect(cs[1].website).toContain('kanzlei-meier');
  });

  it('returns empty for null and unstructured prose', () => {
    expect(sme.extractCompanies(null)).toHaveLength(0);
    expect(sme.extractCompanies('no structure here at all')).toHaveLength(0);
  });
});
