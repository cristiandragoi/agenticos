async function run() {
  const { parseGoal } = await import('../server/dist/domains/jarvis/execution/semanticGoalParser.js');
  const { ConversationalStateManager } = await import('../server/dist/domains/jarvis/conversationalState.js');
  const { classifyReadIntent } = await import('../server/dist/domains/jarvis/projectStateContext.js');

  const phrases = [
    "Jarvis, what's happening with Shopify?",
    "Open Free Cash and tell me where we are.",
    "What are we waiting on?",
    "So what do you suggest we do now?",
    "Okay, carry on.",
    "What else?",
    "Go back to Shopify.",
    "What's stopping us there?",
    "Can you continue that?",
    "Stop.",
    "Jarvis stop.",
    "Shut up.",
    "Open Free Cash again.",
    "What do you see there?"
  ];

  const c = new ConversationalStateManager();
  for (const p of phrases) {
    const goal = parseGoal(p);
    const readIntent = classifyReadIntent(p);
    const stateTurn = await c.turn(p);
    console.log('----------------------------------------------------');
    console.log('Phrase:     ', p);
    console.log('Goal:       ', { category: goal.category, action: goal.action, target: goal.target, subGoals: goal.subGoals?.map(s => ({ action: s.action, target: s.target })) });
    console.log('ReadIntent: ', readIntent);
    console.log('StateTurn:  ', { intent: stateTurn.intent, entity: stateTurn.entity?.name, route: stateTurn.route, confidence: stateTurn.confidence });
  }
}

run().catch(console.error);
