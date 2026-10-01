import { semanticGoalParser } from '../src/domains/jarvis/execution/semanticGoalParser.js';

const res = semanticGoalParser.parseGoal('Open YouTube, find the C Adler channel and start it.', { conversationId: 'test-c-adler' });
console.log('Goal:', res.goalDescription);
console.log('Steps count:', res.steps.length);
console.log('Steps:', JSON.stringify(res.steps.map(s => ({ stepId: s.stepId, action: s.action, target: s.parameters.target, name: s.parameters.name, query: s.parameters.query })), null, 2));
console.log('Confidence:', res.confidence);
console.log('Clarification required:', res.clarificationRequired);
