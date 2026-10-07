import { researchStore } from './store.js';
import { classifyTaskFollowup } from '../controlPlane/TaskFollowup.js';
import { authoritativeInteractionContext } from '../controlPlane/AuthoritativeInteractionContext.js';

export function isResearchResultRequest(text: string, conversationId?: string): boolean {
  const explicit = /\b(?:name|show|give|tell|which|what|explain)\b/i.test(text) && (
    /\b(?:recommended|selected|chosen|shortlisted)\s+(?:github\s+)?(?:repository|repo|candidate)\b/i.test(text) ||
    /\b(?:research|repository)\s+(?:results?|status|progress)\b/i.test(text) ||
    /\b(?:its|the)\s+github\s+link\b/i.test(text));
  if (explicit) return true;
  // Task discourse is resolved before keyword-based new-work routing. In
  // particular, quoting an earlier request is not permission to restart it.
  if (!conversationId) return false;
  const record = researchStore.latestForConversation(conversationId);
  if (!record) return false;
  // All implicit follow-ups, including "I said it", must honor a subject
  // change. Previously only the small grammar-classified subset did so.
  if (!/\b(?:github|repo|repository|repositories|research)\b/i.test(text)) {
    const history=authoritativeInteractionContext.getContext(conversationId).dialogueHistory || [];
    for (const turn of [...history].reverse()) {
      if (turn.role!=='user'||turn.at<=Date.parse(record.created_at))continue;
      if (/\b(?:github|repositor(?:y|ies)|research|repo)\b/i.test(turn.text))break;
      if (/^(?:(?:I said|okay|ok|so|jarvis|please)[,\s]+)*(?:open|launch|navigate|send|read|write|create|delete|search|find|play)\b/i.test(turn.text.trim()))return false;
    }
  }
  const discourse = classifyTaskFollowup(text);
  if (discourse) {
    if (/\b(?:github|repo|repository|repositories|research)\b/i.test(text)) return true;
    // Existing persisted dialogue supplies focus; no parallel lifecycle store.
    // A newer explicit command changes the subject. Small talk, status queries
    // and user interruptions do not erase the task's saved evidence.
    const history = authoritativeInteractionContext.getContext(conversationId).dialogueHistory || [];
    for (const turn of [...history].reverse()) {
      if (turn.role !== 'user' || turn.at <= Date.parse(record.created_at)) continue;
      if (/\b(?:github|repositor(?:y|ies)|research|repo)\b/i.test(turn.text)) return true;
      if (/^(?:(?:okay|ok|jarvis|please)[,\s]+)*(?:open|launch|navigate|send|read|write|create|delete|search|find|play)\b/i.test(turn.text.trim())) return false;
    }
    return true;
  }
  if (/\b(?:start|run|do|research|search)\s+(?:it\s+)?(?:again|anew|a new|another)\b|\brestart\b/i.test(text)) return false;
  if (/\b(?:telegram|whatsapp|camera|notepad|excel|acrobat|word document)\b/i.test(text)) return false;
  if (/\b(?:open|navigate|send|read)\b/i.test(text) && !/\b(?:research|repository|repo)\b/i.test(text)) return false;
  const followup = text.trim().replace(/^(?:(?:okay|ok|so|well|jarvis)[,\s]+)+/i, '').replace(/[.!?]+$/, '').trim();
  if (/^(?:(?:what|which(?:\s+one)?)\s+(?:(?:do|would)\s+you\s+)?(?:recommend|suggest)(?:\s+(?:then|now|for this|for that))?|(?:what(?:'s| is)|give me|tell me)\s+your\s+recommendation|which\s+(?:one\s+)?(?:should\s+(?:I|we)\s+(?:use|choose)|is\s+best))$/i.test(followup)) return true;
  return /\bwhat\s+(?:(?:have|did)\s+you\s+(?:find|found|learn|discover)|(?:was|is)\s+(?:the|my)\s+(?:question|request|answer|task))\b/i.test(text) ||
    /\b(?:what (?:are you doing|should I do (?:now )?next)|(?:provide|give|send|want|need).{0,40}(?:updates|feedback|progress)|are you still (?:there|working))\b/i.test(text) ||
    // Tolerate omitted/merged auxiliary words from speech recognition, but only
    // with a saved research task and after the explicit new-action exclusions.
    /\bwhat(?:\s+[a-z]+){0,4}\s+(?:found|find|discovered|learned)\b/i.test(text) ||
    /\b(?:any\s+(?:results|updates)|research\s+(?:done|finished)|how\s+is\s+(?:it|the research)\s+going)\b/i.test(text) ||
    /\b(?:I\s+(?:already\s+|just\s+)?(?:said|asked|told)|you\s+(?:already\s+)?said|half an hour|nothing\s+(?:happens|happened)|has not been completed|hasn't been completed)\b/i.test(text);
}

/** Read saved evidence in this conversation; never start a goal or call GitHub. */
export function presentResearchResult(conversationId: string, question = ''): string {
  const record = researchStore.latestForConversation(conversationId);
  if (!record) return 'There is no saved repository research in this conversation yet.';
  if (classifyTaskFollowup(question)==='recall' || /\bwhat\s+(?:was|is)\s+(?:the|my)\s+(?:question|request|task)\b/i.test(question))
    return `Your request was: ${record.originalRequest || record.goal}`;
  const report = record.report;
  if (report?.evaluation) return report.evaluation.report?.presentationText || `The last recorded evaluation update is: ${report.evaluation.lastEvent}`;
  const stopped = record.status === 'CANCELLED' || Boolean(record.error);
  if (!report) {
    if (stopped) return `That research stopped after ${record.assessed} saved assessments. It did not produce a recommendation. I have not restarted it.`;
    if (record.status === 'RECOVERABLE' || record.status === 'FAILED_EXHAUSTED' || record.status === 'BLOCKED_EXTERNAL')
      return `The research is currently blocked with ${record.assessed} saved assessments. There is no completed recommendation yet.`;
    const leading = record.leading?.repository;
    return leading && /^[\w.-]+\/[\w.-]+$/.test(leading)
      ? `So far, ${leading} is the provisional leader among ${record.assessed} saved assessments. There is no final recommendation yet. The review is still in progress; its capabilities remain untested.`
      : `The research has ${record.assessed} saved assessments and no final recommendation yet. ${record.assessed ? 'None of the assessed candidates has qualified so far.' : 'I am still collecting evidence.'} I have not started another search.`;
  }
  const candidate = report.top?.[0];
  if (!candidate || !/^[\w.-]+\/[\w.-]+$/.test(candidate.repository || ''))
    return `The saved research assessed ${report.assessed ?? record.assessed} repositories, but none qualified for the shortlist. I cannot name a supported recommendation from that report.`;
  const source = report.sourceReview?.reviews?.find((r: any) => r.repository === candidate.repository);
  if(classifyTaskFollowup(question)==='progress')return `The research ${stopped?'stopped':report.incomplete?'is incomplete':'is complete'}. ${report.assessed ?? record.assessed} repositories were assessed. The provisional leader is ${candidate.repository}. Nothing was installed by this research.`;
  if(classifyTaskFollowup(question)==='recommendation')return `The provisional candidate is ${candidate.repository}: https://github.com/${candidate.repository}. Its source evidence was reviewed; execution and compatibility remain untested by this research.`;
  return `${stopped ? 'Before the research stopped, the' : report.incomplete ? 'The partial report’s' : 'The saved report’s'} provisional leading candidate is ${candidate.repository}. ` +
    `GitHub link: https://github.com/${candidate.repository}. ` +
    `Checked: saved GitHub metadata and README evidence pinned to a commit${source ? ', plus a bounded source-file review' : ''}. ` +
    'Those are documented claims, not verified browser actions. Installation, clicking, completed-action verification, AgenticOS integration and response latency have not been demonstrated by this research report.';
}
