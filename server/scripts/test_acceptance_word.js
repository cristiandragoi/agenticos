import { routeTurn } from '../dist/domains/jarvisNext/turnRouter.js';
import { speechArbiter } from '../dist/domains/jarvisNext/speechArbiter.js';
import { goalLifecycleManager } from '../dist/domains/controlPlane/GoalLifecycle.js';

async function runAcceptanceTest() {
  console.log('[AcceptanceTest] Starting autonomous self-healing test for: "Jarvis, open Word and create a blank document"');

  const speechEvents = [];
  speechArbiter.register({
    speakFn: async (text, turnId) => {
      console.log(`[LIFECYCLE SPEECH] "${text}"`);
      speechEvents.push(text);
    },
    getCurrentTurnId: () => 1,
    isUserTurnActive: () => true,
  });

  const convId = `test-word-${Date.now()}`;
  const result = await routeTurn({
    prompt: 'Jarvis, open Word and create a blank document',
    conversationId: convId,
    onActionProgress: (progress) => {
      console.log(`[ACTION PROGRESS] Stage=${progress.stage} Status=${progress.status} Step="${progress.currentStep}"`);
    },
  });

  console.log('\n[AcceptanceTest] Turn Result:', JSON.stringify(result, null, 2));
  console.log('\n[AcceptanceTest] Spoken Lifecycle Events:', speechEvents);

  const goal = goalLifecycleManager.getActiveGoalForConversation(convId)
    || goalLifecycleManager.listGoalRuns(5).find(g => g.conversationId === convId);

  console.log('\n[AcceptanceTest] Persisted GoalRun:', JSON.stringify({
    goalId: goal?.goalId,
    status: goal?.status,
    originalUserInput: goal?.originalUserInput,
    verified: goal?.finalVerification?.verified,
    summary: goal?.finalVerification?.summary,
    evidence: goal?.evidence?.map(e => e.label),
  }, null, 2));
}

runAcceptanceTest().catch(err => {
  console.error('[AcceptanceTest] Error:', err);
  process.exit(1);
});
