import { expect } from 'expect';
import * as path from 'path';
import * as url from 'url';

// Mock jest globals
const tests: { name: string, fn: () => void | Promise<void> }[] = [];
(global as any).describe = (name: string, fn: () => void) => fn();
(global as any).it = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn });
(global as any).expect = expect;

async function run() {
  await import('./src/__tests__/goalMode.test.js').catch(async e => {
    // try ts if running via ts-node
    await import('./src/__tests__/goalMode.test.ts');
  });

  let passed = 0;
  for (const test of tests) {
    try {
      await test.fn();
      console.log(`PASS ${test.name}`);
      passed++;
    } catch (err: any) {
      console.error(`FAIL ${test.name}`);
      console.error(err);
    }
  }
  console.log(`\nTests: ${passed} passed, ${tests.length} total`);
}

run().catch(console.error);
