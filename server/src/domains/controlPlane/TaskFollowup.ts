/** Read-only discourse classification. This never creates or changes task state. */
export type TaskFollowup = 'result' | 'progress' | 'recommendation' | 'recall';
export function classifyTaskFollowup(text: string): TaskFollowup | null {
  // Recover task discourse from ordinary speech fragments before the strict
  // vocabulary guard. These questions refer to prior work, not a new action.
  if (/\bwhat\s+(?:(?:did|have)\s+)?I\s+(?:ask(?:ed)?|said|told)\s+(?:to\s+)?you\b/i.test(text) ||
      /\brepeat\s+(?:word\s+(?:for|with)\s+word\s+)?what\s+I\s+ask(?:ed)?\b/i.test(text) ||
      /\bwhat\s+was\s+the\s+question\b/i.test(text)) return 'recall';
  if (/^(?:(?:okay|so|jarvis)[,\s]+)*what\s+is\s+the\s+statues[.!?]*$/i.test(text.trim())) return 'progress';
  if (/^(?:(?:okay|so|and|jarvis)[,\s]+)*which\s+one[.!?]*$/i.test(text.trim())) return 'recommendation';
  const words: string[] = Array.from(text.toLowerCase().replace(/[’']/g, '').match(/[a-z]+/g) || []);
  // A new subject or operation must not inherit an old task merely because it
  // contains "result" or "recommend". Accept grammatical task-reference words,
  // leaving substantive new requirements to the ordinary interpreter.
  const grammar = new Set(('okay ok well so and then now please jarvis thanks thank you for confirming ' +
    'what whats which how where is are was were has have had did do does can could would should ' +
    'i we me my our your you the a an it its that this those these one kind of about with to ' +
    'tell give show name explain say got get any yet already still there really ' +
    'result results outcome outcomes answer answers finding findings found find learn learned discovered ' +
    'progress status update updates doing working finished finish done complete completed happening going just ' +
    'recommend recommended recommendation recommendations suggest suggested suggestion suggestions candidate candidates ' +
    'repository repositories repo repos github research report reports best choose use selected shortlisted ' +
    'question request task asked requested previous earlier last').split(/\s+/));
  if (!words.length || words.some(w => !grammar.has(w))) return null;
  if (/\bwhat\s+(?:did|have)\s+you\s+(?:just\s+)?(?:do|done)\b/i.test(text)) return 'result';
  if (words.every(w => ['okay','ok','so','and','then','well','now','jarvis'].includes(w)))
    return words.includes('and') ? 'progress' : null;
  if (words.some(w => /^(recommend.*|suggest.*|candidate.*|best|choose)$/.test(w))) return 'recommendation';
  if (words.some(w => /^(question|request|asked|requested)$/.test(w))) return 'recall';
  if (words.some(w => /^(result.*|outcome.*|answer.*|finding.*|found|learned|discovered|report.*)$/.test(w))) return 'result';
  if (words.some(w => /^(progress|status|update.*|doing|working|finished|done|complete.*|happening|going)$/.test(w))) return 'progress';
  return null;
}
