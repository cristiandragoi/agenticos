import { isRepositoryResearchRequest } from './specification.js';

/** Requirements attach only to active research, never to an old chat target. */
export function researchFollowup(text: string, active?: { originalUserInput: string; status: string } | null): string | null {
  if (!active || !['EXECUTING', 'DISCOVERING', 'PLANNING', 'RECOVERING'].includes(active.status) ||
      !isRepositoryResearchRequest(active.originalUserInput)) return null;
  const raw = text.trim();
  if (/\b(?:stop|cancel|don't|do not)\b/i.test(raw)) return null;
  const requirement = /^(?:and\b|also\b|to\s+make\b|make\s+(?:the|it)\b)/i.test(raw) &&
    /\b(?:latency|faster|tools?|websites?|web\s+pages?|browser|clicking|reading|response)\b/i.test(raw);
  const reference = isRepositoryResearchRequest(raw) && /\b(?:this|that|these|those|same)\b/i.test(raw);
  const selectOne = /^(?:please\s+)?(?:search|find|choose|select)\s+(?:for\s+)?one(?:\s+(?:repository|repo))?[.!?]*$/i.test(raw);
  if (!requirement && !reference && !selectOne) return null;
  if (selectOne) return `${active.originalUserInput.slice(0, 3500)}\nAdditional requirement: Recommend the single best matching repository.`;
  return `${active.originalUserInput.slice(0, 3500)}\nAdditional requirement: ${raw.slice(0, 1500)}`;
}
