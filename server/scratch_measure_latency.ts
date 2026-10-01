import { isFastConversationRequest } from './src/domains/jarvis/fastConversationLane.js';
import { hydrateActiveEntityContext } from './src/domains/jarvis/supervisorLoop.js';
import { resolveContextualEntity } from './src/domains/jarvis/actionRuntime.js';

async function run() {
  const query = "Tell me about the Notion template.";
  const context = { activeModule: "revenue-operator" };
  
  let start = performance.now();
  await isFastConversationRequest(query);
  console.log('isFastConversationRequest:', performance.now() - start);

  start = performance.now();
  await hydrateActiveEntityContext(query, context);
  console.log('hydrateActiveEntityContext:', performance.now() - start);
  
  start = performance.now();
  await resolveContextualEntity(query, context);
  console.log('resolveContextualEntity:', performance.now() - start);
}
run();
