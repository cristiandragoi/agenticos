/**
 * Semantic intent scoring (PRIORITY 8).
 *
 * Instead of growing endless special-case regexes, deterministic signals are
 * scored into five semantic categories. When deterministic routing confidence
 * is low, the highest-scoring category wins; ties/generic requests resolve
 * inspect-first (A/B) when read-only inspection can safely disambiguate.
 *
 * Categories:
 *   A — asking about live AgenticOS state        → INVESTIGATE
 *   B — reporting unexpected system behavior     → INVESTIGATE
 *   C — explicitly delegating to a worker        → delegation
 *   D — asking for source-code/repository analysis → CODEX
 *   E — informational question                   → DIRECT
 */
import { isLiveSystemInvestigationRequest, isBugReportStatement, isContextualInvestigationRequest } from './intentRouter.js';

export interface CategoryScores {
  liveState: number;
  bugReport: number;
  delegation: number;
  repoAnalysis: number;
  informational: number;
  best: 'liveState' | 'bugReport' | 'delegation' | 'repoAnalysis' | 'informational' | null;
  bestScore: number;
}

const DELEGATION_CUE_RE =
  /\b(ask|tell|have|get|make|delegate|instruct|give this to|send this to|hand this to)\s+(hermes|codex|jarvis|research|teams?|automation)\b/i;
const WORKER_OBJECT_RE = /\b(hermes|codex|jarvis)\b/i;
const REPO_SIGNAL_RE =
  /\b(source|code|codebase|repository|repo|file|component|function|class|module|implementation)\b|\.(tsx?|jsx?|json|md|css)\b/i;
const QUESTION_RE = /^(what|who|how|why|where|when|which|do|does|did|can|could|will|would|is|are|am)\b|^\w+[^.!?]*\?$/i;
const WRITE_SIGNAL_RE = /\b(write|create|patch|delete|remove|refactor|build|implement|change|modify|deploy)\b/i;

export function scoreSemanticIntent(
  prompt: string,
  recentText?: string
): CategoryScores {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const scores: CategoryScores = {
    liveState: 0,
    bugReport: 0,
    delegation: 0,
    repoAnalysis: 0,
    informational: 0,
    best: null,
    bestScore: 0,
  };

  // A — live AgenticOS state.
  if (isLiveSystemInvestigationRequest(prompt)) scores.liveState = 0.9;
  else if (/\b(health|status|online|offline|running|active)\b/.test(p) && WORKER_OBJECT_RE.test(p)) scores.liveState = 0.6;

  // B — unexpected behavior (explicit signals or context-gated).
  if (isBugReportStatement(prompt)) scores.bugReport = 0.85;
  else if (isContextualInvestigationRequest(prompt, recentText)) scores.bugReport = 0.8;

  // C — explicit delegation (worker as TARGET with a task verb).
  if (DELEGATION_CUE_RE.test(p)) scores.delegation = 0.95;
  else if (/^give this to\b|^hand this to\b|^send this to\b/.test(p) && WORKER_OBJECT_RE.test(p)) scores.delegation = 0.9;

  // D — repository/source analysis (code signals + read intent).
  const readVerb = /\b(inspect|analy[sz]e|review|read|trace|find|explain|search)\b/.test(p);
  if (REPO_SIGNAL_RE.test(p) && (readVerb || /read-only|without changing|without modifying/i.test(p))) {
    scores.repoAnalysis = 0.85;
  } else if (REPO_SIGNAL_RE.test(p) && WRITE_SIGNAL_RE.test(p)) {
    scores.repoAnalysis = 0.7; // coding/change request
  }

  // E — informational question.
  if (QUESTION_RE.test(p) && !/\b(still|broken|wrong|not working|failed)\b/.test(p)) scores.informational = 0.6;
  if (/^(what is|who is|how does|how do|what are|explain)\b/.test(p)) scores.informational = 0.75;

  let best: CategoryScores['best'] = null;
  let bestScore = 0;
  const entries: Array<[keyof Omit<CategoryScores, 'best' | 'bestScore'>, number]> = [
    ['delegation', scores.delegation],
    ['liveState', scores.liveState],
    ['bugReport', scores.bugReport],
    ['repoAnalysis', scores.repoAnalysis],
    ['informational', scores.informational],
  ];
  for (const [k, v] of entries) {
    if (v > bestScore) {
      bestScore = v;
      best = k;
    }
  }
  scores.best = best;
  scores.bestScore = bestScore;
  return scores;
}

export function semanticRouteToIntent(scores: CategoryScores, prompt: string) {
  switch (scores.best) {
    case 'liveState':
    case 'bugReport':
      return { route: 'investigate', confidence: Math.max(scores.liveState, scores.bugReport) };
    case 'delegation':
      return { route: 'codex', confidence: scores.delegation }; // refined by worker target upstream
    case 'repoAnalysis':
      return { route: 'codex', confidence: scores.repoAnalysis };
    case 'informational':
      return { route: 'direct', confidence: Math.max(scores.informational, 0.55) };
    default:
      return null;
  }
}
