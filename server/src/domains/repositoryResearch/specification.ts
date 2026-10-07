export const featurePatterns: Record<string, RegExp> = {
  browser_automation: /\b(?:browser|websites?|web\s+pages?|clicking)\b/i,
  content_extraction: /\b(?:extract(?:ion|ing)?|reading)\b/i,
  local: /\b(?:self[- ]host(?:ed|able|ing)?|local[- ]first|local models?|ollama)\b/i,
  ollama: /\bollama\b/i,
  openai_compatible: /openai[- ]compatible|openai.{0,25}(?:base.?url|endpoint)/i,
  mcp: /\bmcp\b|model context protocol/i,
  streaming: /\bstream(?:ing)?\b/i,
  parallel: /\bparallel\b|\bconcurren(?:t|cy)\b|fan[- ]out/i,
  docker: /\bdocker\b|\bcontainer(?:ized)?\b/i,
};
export interface ResearchSpec { goal: string; candidateLimit: number; features: string[]; terms: string[]; languages: string[]; }
export function isRepositoryResearchRequest(text: string): boolean {
  const request = text.trim().replace(/^(?:jarvis[, ]+|please\s+)+/i, '');
  return !/^(?:don't|do not|stop|cancel)\b/i.test(request) && /\b(?:find|research|compare|evaluate|recommend|search|pull\s+up|look\s+up)\b/i.test(request) &&
    /\b(?:github|open[- ]source|repositor(?:y|ies)|frameworks?|libraries|local[- ]first solution)\b/i.test(request);
}
export function specification(goal: string, candidateLimit = 50): ResearchSpec {
  if (typeof goal !== 'string' || goal.trim().length < 10 || goal.length > 6000) throw new Error('Provide a research requirement between 10 and 6000 characters.');
  if (!Number.isInteger(candidateLimit) || candidateLimit < 20 || candidateLimit > 100) throw new Error('Candidate limit must be between 20 and 100.');
  // Negated clauses must not become positive requirements/search terms.
  const positive = goal.split(/[.\n;]/).filter(s => !/^\s*(?:avoid|exclude|without|do not|don't|must not)\b/i.test(s)).join(' ');
  const stop = new Set('find best open source solution tool tools framework frameworks library libraries github repository repositories research evaluate compare recommend search agenticos jarvis must should support supports with that this our for the and local first please reduce improve improving reducing using need want response can could would some public pull look make faster fast able allow allows possibility perform performing useful kind task tasks additional requirement'.split(' '));
  for (const word of ['one', 'single', 'exact', 'needed', 'action', 'actions', 'information', 'specific', 'best', 'matching']) stop.add(word);
  const terms = [...new Set(positive.toLowerCase().replace(/\bopen[- ]source\b/g, ' ').match(/[a-z][a-z0-9-]{2,}/g) || [])].filter(t => !stop.has(t)).slice(0, 8);
  if (!terms.length) throw new Error('What problem should the repository solve? Include the desired capability.');
  return { goal: goal.trim(), candidateLimit, features: Object.entries(featurePatterns).filter(([, p]) => p.test(positive)).map(([k]) => k), terms,
    languages: ['Python','TypeScript','JavaScript','Rust','Go','Java'].filter(l => new RegExp(`\\b${l}\\b`, 'i').test(positive)) };
}
export function searchQueries(spec: ResearchSpec): string[] {
  // Preserve the problem domain in every query. Single-word searches such as
  // "agent", "models" or "latency" retrieve unrelated, popular projects.
  const agentDomain = /\b(?:ai[- ]agents?|agents?|llm|latency)\b/i.test(spec.goal);
  const browserDomain = spec.features.includes('browser_automation');
  const anchor = browserDomain ? 'browser' : agentDomain ? 'agent' : spec.terms[0];
  const featureTerms: Record<string,string> = { browser_automation: '"browser automation"', content_extraction: '"content extraction"', local: '"local models"', openai_compatible: '"OpenAI compatible"' };
  const queries = browserDomain ? ['browser automation', 'browser playwright'] : agentDomain ? ['agent llm', 'agent latency'] : [spec.terms.slice(0,2).join(' ')];
  for (const feature of spec.features) queries.push(`${anchor} ${featureTerms[feature] || feature}`);
  for (const term of spec.terms.filter(t=>t !== anchor && !/^(?:models?|python|typescript|javascript)$/.test(t))) queries.push(`${anchor} ${term}`);
  // A single remaining problem term is searched as a phrase with the requested
  // component class rather than silently dropping all context.
  if (!agentDomain && spec.terms.length === 1) queries[0] = `${anchor} library`;
  return [...new Set(queries)].slice(0, 8).map(q => `${q} in:name,description,readme is:public fork:false archived:false`);
}
