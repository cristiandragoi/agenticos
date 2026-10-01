/**
 * jarvisConversationCorpus.test.ts — the permanent regression corpus.
 *
 * Every chain runs as consecutive turns under ONE conversation id through the
 * PRODUCTION state writer (applyTurnResultToFocus), so the corpus measures real
 * behaviour, not a parallel test double. Corpus data lives in
 * .hermes/plans/jarvis-conversation-corpus.json so new real-world failures get
 * appended as data, not as more test code.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the corpus seeds focus
   fields structurally (wider than the production result type). */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { applyTurnResultToFocus, getFocus } from '../domains/jarvisNext/turnRouter.js';

interface CorpusTurn {
  prompt: string;
  confidence?: number;
  expect?: {
    mustMatch?: string[];
    mustNotMatch?: string[];
    exact?: string;
    mustNotRepeatPrevious?: boolean;
  };
}
interface CorpusChain {
  id: string;
  defect?: string;
  seed?: Record<string, unknown>;
  turns: CorpusTurn[];
}

const CORPUS_PATH = path.resolve(process.cwd(), '../.hermes/plans/jarvis-conversation-corpus.json');
const corpus: { chains: CorpusChain[] } = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

/** The corpus is JSON, so relative timestamps are written as the sentinel "now". */
function resolveSentinels<T>(value: T): T {
  if (typeof value === 'string') return (value === 'now' ? Date.now() : value) as unknown as T;
  if (Array.isArray(value)) return value.map(resolveSentinels) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveSentinels(v)]),
    ) as T;
  }
  return value;
}

/** What the turn actually SAID (falls back to structured fields when silent). */
const said = (r: any) =>
  (r?.spokenText || '').trim() ||
  `${r?.plan?.goalDescription || ''} ${r?.entityName || r?.lastResolvedEntityName || ''}`.trim();

describe('Jarvis conversational regression corpus', () => {
  it('corpus file is present and non-trivial', () => {
    expect(corpus.chains.length).toBeGreaterThanOrEqual(10);
  });

  for (const chain of corpus.chains) {
    it(`${chain.id}${chain.defect ? ` — ${chain.defect}` : ''}`, async () => {
      const convId = `corpus-${chain.id}-${Date.now()}`;
      const focus: any = getFocus(convId);
      if (chain.seed) Object.assign(focus, resolveSentinels(chain.seed));

      const observed: string[] = [];
      for (const turn of chain.turns) {
        const res = await universalExecutionController.handleUserTurn({
          prompt: turn.prompt,
          conversationId: convId,
          sttConfidence: turn.confidence ?? 1.0,
          rawStt: turn.prompt,
          activeProjectId: focus.activeProjectId,
          activeProjectName: focus.activeProjectName,
          context: { ...focus },
        });
        applyTurnResultToFocus(focus, res); // exactly what the router does
        const text = said(res);
        observed.push(text);

        const exp = turn.expect;
        if (!exp) continue;
        if (exp.exact !== undefined) {
          expect(res.spokenText, `turn "${turn.prompt}"`).toBe(exp.exact);
        }
        for (const pattern of exp.mustMatch || []) {
          expect(text, `turn "${turn.prompt}" must match ${pattern}`).toMatch(new RegExp(pattern, 'i'));
        }
        for (const pattern of exp.mustNotMatch || []) {
          expect(text, `turn "${turn.prompt}" must NOT match ${pattern}`).not.toMatch(new RegExp(pattern, 'i'));
        }
        if (exp.mustNotRepeatPrevious) {
          expect(text, `turn "${turn.prompt}" repeated the previous answer verbatim`).not.toBe(observed[observed.length - 2]);
        }
      }
    });
  }
});
