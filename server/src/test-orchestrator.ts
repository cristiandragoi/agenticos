import { logger } from './utils/logger.js';
import { runCoderOrchestrator } from './workflows/workers/coderOrchestrator.js';

async function test() {
  logger.info('--- STARTING NORMAL MOCK RUN ---');
  const result1 = await runCoderOrchestrator({
    task: "Create a hello-world text artifact called hello.txt and verify it exists by reading it.",
    workdir: process.cwd()
  });

  logger.info('\n\n--- NORMAL RUN RESULT ---');
  logger.info(JSON.stringify(result1, null, 2));

  logger.info('\n\n--- STARTING MALFORMED JSON TEST RUN ---');
  const result2 = await runCoderOrchestrator({
    task: "MALFORMED_TEST: Create a second text artifact",
    workdir: process.cwd()
  });

  logger.info('\n\n--- MALFORMED TEST RESULT ---');
  logger.info(JSON.stringify(result2, null, 2));
}

test().catch(logger.error);
