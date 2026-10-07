import { goalLifecycleManager } from './GoalLifecycle.js';
import { authoritativeInteractionContext } from './AuthoritativeInteractionContext.js';
import { classifyTaskFollowup } from './TaskFollowup.js';
import { humanizeAction } from './UserFacingResponseGuard.js';
import { readGoalVerificationCorrection } from './taskGraph/TaskGraphJournal.js';

/** Present existing evidence only. No execution, retries, new goals or model calls. */
export function presentTaskState(conversationId: string, question: string): string {
  const context = authoritativeInteractionContext.getContext(conversationId);
  const goal = goalLifecycleManager.getLatestGoalForConversation(conversationId);
  const success = context.lastSuccessfulAction;
  const failure = context.lastFailedAction;
  const action = (failure?.at || 0) > (success?.at || 0) ? failure : success;
  if (goal && Date.parse(goal.updatedAt) >= (action?.at || 0)) {
    const correction = readGoalVerificationCorrection(goal.goalId);
    if (correction && classifyTaskFollowup(question) !== 'recall')
      return 'The operation succeeded, but its earlier VERIFIED label was corrected: no independent verification was performed. Original journal entries remain preserved.';
    if (classifyTaskFollowup(question) === 'recall') return `Your task was: ${goal.originalUserInput}`;
    if (goal.status === 'CANCELLED') return 'Your task was cancelled. I have not restarted it.';
    if (goal.status === 'SUCCEEDED') return `${goal.finalResponseText || 'The operation succeeded.'} Independent verification was not performed.`;
    if (goal.status === 'COMPLETED') return goal.finalResponseText || goal.finalVerification?.summary || 'The task is recorded as completed, but no final result text was saved.';
    if (['BLOCKED_EXTERNAL','FAILED_EXHAUSTED','RECOVERABLE'].includes(goal.status))
      return goal.finalResponseText || `Your task is blocked. ${goal.timeline.at(-1)?.summary || 'No verified completion was recorded.'}`;
    if (goal.status.startsWith('AWAITING_')) return `Your task is waiting. ${goal.timeline.at(-1)?.summary || 'User input is required.'}`;
    return `Your task is still in progress. ${goal.timeline.at(-1)?.summary || 'No verified final result is available yet.'}`;
  }
  if (action) {
    if (classifyTaskFollowup(question) === 'recall') return `The last recorded action was to ${humanizeAction(action.action)}${action.target ? ` for ${action.target}` : ''}.`;
    if (action === failure) return `The last requested action did not complete.${failure?.reason ? ` ${failure.reason}` : ''} I have not restarted it.`;
    return success?.summary || `The last action to ${humanizeAction(action.action)} was verified${action.target ? ` for ${action.target}` : ''}.`;
  }
  return 'I do not have a recorded task result in this conversation. Which task are you referring to?';
}
