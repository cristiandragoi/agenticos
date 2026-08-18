// P4 — intent routing matrix probe (real IntentRouter, dist build).
import { IntentRouter } from '../dist/domains/jarvis/intentRouter.js';
const router = new IntentRouter();
const cases = [
  ['A1 normal', 'What model are you using?'],
  ['A2 normal', 'Explain what AgenticOS is based on our conversation.'],
  ['A3 normal', 'What did I just tell you?'],
  ['B discussion', "I am thinking about adding a recruiting agent. What do you think?"],
  ['B2 discussion', "Don't implement it. Just explain your reasoning."],
  ['C explicit', 'Create a task for Hermes to inspect the backend tests.'],
  ['C2 explicit', 'Use CodeX to inspect the backend tests.'],
  ['P1 turn2', 'What is my project called?'],
  ['P1 turn3', 'What did I ask you immediately before this?'],
  ['P1 turn4', 'Summarize what we have discussed so far.'],
];
for (const [label, prompt] of cases) {
  const r = await router.routeIntent(prompt, { conversationText: '' }).catch((e) => ({ error: String(e) }));
  const i = r && !r.error ? r : null;
  console.log(`${label} | ${prompt.slice(0, 45)}`);
  console.log(`   → route=${i?.route} cat=${i?.category} mode=${i?.mode} conf=${i?.confidence ? i.confidence.toFixed(2) : '?'} reason=${i?.reason || r?.error}`);
}
