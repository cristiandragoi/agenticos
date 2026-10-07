import { GitHubResearchClient } from './github.js';
import { specification, searchQueries } from './specification.js';
import { assess, type Snapshot } from './scoring.js';
import { researchStore } from './store.js';

export async function runRepositoryResearch(input: { goalId: string; goal: string; candidateLimit?: number; depth?: 'metadata' | 'source'; budgetMs?: number; sourceReviewLimit?: number; signal?: AbortSignal; onProgress?: (message: string) => void }, client = new GitHubResearchClient()) {
  input.signal?.throwIfAborted();
  const spec = specification(input.goal, input.candidateLimit);
  const id = researchStore.begin(input.goalId, spec);
  const previous = researchStore.get(id);
  const budgetMs = input.budgetMs ?? 15 * 60_000;
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 15 * 60_000) throw new Error('Invalid research time budget');
  const budget = AbortSignal.timeout(budgetMs);
  const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), budget]);
  const progress = (s: string) => { try { input.onProgress?.(s); } catch { /* speech observers cannot cancel research */ } };
  try {
    if (previous?.report) {
      if(input.depth==='source') return await (await import('./deepResearch.js')).deepenResearchReport(id,client,signal,input.onProgress,input.sourceReviewLimit);
      return previous.report;
    }
    const candidates = new Map<number, any>();
    const queries = searchQueries(spec);
    const discovery: any[] = [];
    const firstPages: any[][] = [];
    for (const query of queries) {
      signal.throwIfAborted();
      // Diversify query families before filling the remaining budget.
      const result = await client.get(`/search/repositories?q=${encodeURIComponent(query)}&per_page=30&page=1`, signal, 15 * 60_000);
      if (!result?.items) throw new Error('GitHub repository search returned no usable response');
      const evidence = { url: `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`, returned: result.items.length, total: result.total_count, incomplete: Boolean(result.incomplete_results), page: 1 };
      researchStore.query(id, query, evidence); discovery.push(evidence);
      firstPages.push(result.items);
    }
    // Round-robin all query families; an early broad query cannot consume the
    // candidate budget before later capability-specific results are considered.
    for (let rank = 0; rank < 30 && candidates.size < spec.candidateLimit; rank++) {
      for (const page of firstPages) {
        const repo = page[rank];
        if (repo && !repo.private) candidates.set(repo.id, repo);
        if (candidates.size >= spec.candidateLimit) break;
      }
    }
    // Bounded pagination when overlapping first pages cannot fill the target.
    for (let page = 2; page <= 4 && candidates.size < spec.candidateLimit; page++) {
      let returned = 0;
      for (const query of queries) {
        signal.throwIfAborted();
        const result = await client.get(`/search/repositories?q=${encodeURIComponent(query)}&per_page=30&page=${page}`, signal, 15 * 60_000);
        if (!Array.isArray(result?.items)) throw new Error('GitHub repository search returned no usable response');
        returned += result.items.length;
        const evidence = { url: `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=30&page=${page}`, returned: result.items.length, total: result.total_count, incomplete: Boolean(result.incomplete_results), page };
        researchStore.query(id, query, evidence); discovery.push(evidence);
        for (const repo of result.items) { if (candidates.size >= spec.candidateLimit) break; if (!repo.private) candidates.set(repo.id, repo); }
        if (candidates.size >= spec.candidateLimit) break;
      }
      if (!returned) break;
    }
    const selected = [...candidates.values()].slice(0, spec.candidateLimit);
    progress(`I found ${selected.length} unique repositories. I am collecting their evidence and checking the fit.`);
    const assessments: ReturnType<typeof assess>[] = [];
    const collectionErrors: { repository: string; error: string }[] = [];
    for (const metadata of selected) {
      signal.throwIfAborted();
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(metadata.full_name)) continue;
      const base = `/repos/${metadata.full_name}`;
      try {
        const commit = await client.get(`${base}/commits?per_page=1`, signal);
        const sha = commit?.[0]?.sha;
        if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Cannot pin repository evidence to a commit');
        const readme = await client.get(`${base}/readme?ref=${sha}`, signal, 7 * 86400000);
        const files = await client.get(`${base}/contents?ref=${sha}`, signal, 7 * 86400000);
        const releases = await client.get(`${base}/releases?per_page=5`, signal);
        const issues = await client.get(`${base}/issues?state=all&sort=updated&per_page=10`, signal);
        const snapshot: Snapshot = { metadata, commitSha: sha, collectedAt: new Date().toISOString(),
          readme: readme?.encoding === 'base64' ? Buffer.from(readme.content || '', 'base64').toString('utf8').slice(0, 100000) : '',
          readmePath: readme?.path || 'README.md', rootFiles: Array.isArray(files) ? files.map((f:any)=>f.name) : [],
          releases: Array.isArray(releases) ? releases : [], issues: Array.isArray(issues) ? issues : [], warnings: [
            ...(!files ? ['files unavailable'] : []), ...(!releases ? ['releases unavailable'] : []), ...(!issues ? ['issues unavailable'] : []),
          ] };
        const assessment = assess(snapshot, spec);
        researchStore.candidate(id, snapshot, assessment); assessments.push(assessment);
        researchStore.decision(id,metadata.full_name,'initial-screen',{eligible:assessment.eligible,reasons:assessment.rejected,score:assessment.score,rubricVersion:assessment.rubricVersion});
      } catch (error) {
        signal.throwIfAborted();
        if (/rate limit|budget|HTTP 40[13]/i.test(String(error))) throw error;
        collectionErrors.push({ repository: metadata.full_name, error: error instanceof Error ? error.message : 'Collection failed' });
      }
      if (assessments.length && assessments.length % 10 === 0) progress(`I have assessed ${assessments.length} repositories. Recommendations will distinguish documented capabilities from untested claims.`);
    }
    if (!assessments.length) throw new Error('No repository evidence could be assessed. No recommendation was created.');
    const ranked = assessments.filter(a=>a.eligible).sort((a,b)=>b.score-a.score || a.repository.localeCompare(b.repository));
    const top = ranked.slice(0,3);
    const incomplete = collectionErrors.length > 0 || discovery.some(q=>q.incomplete) || assessments.length < spec.candidateLimit;
    const completion = incomplete ? 'Partial research results are available' : 'Research is complete';
    const report = { id, goalId: input.goalId, goal: spec.goal, createdAt: new Date().toISOString(), rubricVersion: 'phase1-v1',
      scope: 'Public GitHub research only; no clones, installs, benchmarks or production changes',
      discovery, discovered: selected.length, assessed: assessments.length, requested: spec.candidateLimit, incomplete,
      collectionErrors, top, rejected: assessments.filter(a=>!a.eligible).map(a=>({ repository:a.repository,url:a.url,reasons:a.rejected })),
      api: { requests: client.requests, cacheHits: client.cacheHits },
      nextAction: 'Review the evidence. Any installation, benchmark or integration requires a later authorized phase.',
      presentationText: top.length ? `${completion}: ${assessments.length} repositories assessed. The provisional leader is ${top[0].repository}, with ${top[0].score} out of 100 earned points and ${top[0].coverage}% evidence coverage. Installation, performance and security remain unvalidated. The ${top.length} shortlisted repositories and their evidence are saved in research history.` : `${completion}: ${assessments.length} repositories assessed, but none passed the initial filters. No repository is recommended. Rejection reasons are saved in research history.` };
    signal.throwIfAborted(); researchStore.finish(id, report);
    if(input.depth==='source') return await (await import('./deepResearch.js')).deepenResearchReport(id,client,signal,input.onProgress,input.sourceReviewLimit);
    return report;
  } catch (error) {
    if (budget.aborted && !input.signal?.aborted) {
      const saved = researchStore.get(id);
      const assessments = saved?.candidates.map((c: any) => c.assessment) || [];
      const top = assessments.filter((a: any) => a.eligible).sort((a: any,b: any) => b.score-a.score).slice(0, 1);
      const report = { ...(saved?.report || {}), id, goalId: input.goalId, goal: spec.goal,
        assessed: assessments.length, requested: spec.candidateLimit, incomplete: true, top,
        budgetExpired: true, api: { requests: client.requests, cacheHits: client.cacheHits },
        presentationText: top.length
          ? `The time-bounded review assessed ${assessments.length} repositories. The provisional leading candidate is ${top[0].repository}: ${top[0].url}. This is a partial evidence review. Browser actions, installation, integration and latency remain untested.`
          : `The time-bounded review ended with ${assessments.length} saved assessments and no qualifying recommendation yet. I have saved the partial evidence; I have not installed anything.` };
      researchStore.finish(id, report);
      return report;
    }
    researchStore.fail(id, input.signal?.aborted ? 'Cancelled by user' : error instanceof Error ? error.message : 'Research failed');
    throw error;
  }
}
