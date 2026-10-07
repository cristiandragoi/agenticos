import { GitHubResearchClient } from './github.js';
import { researchStore } from './store.js';
import { reviewRepositorySource } from './sourceReview.js';
import type { Snapshot } from './scoring.js';

/** Enriches saved evidence only. Goal identity/state remain with the caller. */
export async function deepenResearchReport(recordId:string, client=new GitHubResearchClient(), signal?:AbortSignal, onProgress?:(message:string)=>void, reviewLimit = 3) {
  signal?.throwIfAborted();
  const record=researchStore.get(recordId);
  if(!record?.report) throw new Error('A completed discovery report is required before source review');
  const report=record.report;
  const reviews:Awaited<ReturnType<typeof reviewRepositorySource>>[]=[];
  const errors:{repository:string;error:string}[]=[];
  const progress=(message:string)=>{try{onProgress?.(message);}catch{/* observers do not own execution */}};
  for(const candidate of report.top.slice(0, Math.max(1, Math.min(3, reviewLimit)))) {
    signal?.throwIfAborted();
    progress(`I am inspecting source files, dependencies and examples for ${candidate.repository}. I am not running repository code.`);
    const snapshot=record.candidates.find((c:{snapshot:Snapshot})=>c.snapshot.metadata.full_name===candidate.repository)?.snapshot;
    try {
      if(!snapshot?.commitSha || snapshot.metadata.private) throw new Error('No pinned public repository snapshot is available');
      const review=await reviewRepositorySource(candidate.repository,snapshot.commitSha,record.specification,client,signal);
      reviews.push(review);
      researchStore.decision(recordId,candidate.repository,'source-review',{decision:review.decision,reasons:review.decisionReasons,fingerprint:review.fingerprint,reused:review.reused,incomplete:review.incomplete});
    } catch(error) {
      signal?.throwIfAborted();
      if(/rate limit|budget|HTTP 40[13]/i.test(String(error))) throw error;
      const message=error instanceof Error?error.message:'Source review failed';
      errors.push({repository:candidate.repository,error:message});
      researchStore.decision(recordId,candidate.repository,'source-review',{decision:'EVIDENCE_UNAVAILABLE',reasons:[message]});
    }
  }
  signal?.throwIfAborted();
  const incomplete=errors.length>0||reviews.some(r=>r.incomplete)||!reviews.length;
  const sourceReview={version:'source-review-v1',createdAt:new Date().toISOString(),reviews,errors,incomplete,
    comparison:reviews.map(r=>({repository:r.repository,roles:r.roleIndicators,summary:r.summary,unresolvedFeatures:r.unresolvedFeatures,decision:r.decision,reasons:r.decisionReasons})),
    nextAction:'Review integration fit and unresolved requirements. Installation, execution and benchmarks require a later authorized phase.'};
  const enriched={...report,sourceReview,
    presentationText: report.presentationText + (reviews.length
      ? ` ${incomplete?'Partial source review is available':'Source review is complete for the selected file samples'} for ${reviews.length} shortlisted repositories. Architecture indicators, dependency declarations, unresolved requirements and review decisions are saved. No repository has been installed, tested or benchmarked.`
      : ' Source review could not establish implementation evidence for a shortlist. No integration recommendation is verified.')};
  // Repeated reviews replace the summary, while append-only decisions preserve history.
  if(report.sourceReview) enriched.presentationText=report.presentationText.split(' Source review')[0].split(' Partial source review')[0]
    + ` Source review ${incomplete?'is partial':'is complete for the selected file samples'} for ${reviews.length} repositories. Findings and decisions are saved; installation and performance remain untested.`;
  researchStore.finish(recordId,enriched);
  return enriched;
}
