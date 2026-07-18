import { runCoderOrchestrator } from './workflows/workers/coderOrchestrator.js';

async function test() {
  console.log('--- STARTING NORMAL MOCK RUN ---');
  const result1 = await runCoderOrchestrator({
    task: "Create a hello-world text artifact called hello.txt and verify it exists by reading it.",
    workdir: process.cwd()
  });

  console.log('\n\n--- NORMAL RUN RESULT ---');
  console.log(JSON.stringify(result1, null, 2));

  console.log('\n\n--- STARTING MALFORMED JSON TEST RUN ---');
  const result2 = await runCoderOrchestrator({
    task: "MALFORMED_TEST: Create a second text artifact",
    workdir: process.cwd()
  });

  console.log('\n\n--- MALFORMED TEST RESULT ---');
  console.log(JSON.stringify(result2, null, 2));
}

test().catch(console.error);
