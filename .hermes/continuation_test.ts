/**@file continuation_test.ts — Regression test for Hermes continuum defects.**/

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..', 'server');

/** Run a minimal multi-tool sequence to test continuation.**/
export function runContinuationTest(): string[] {
  const logs: string[] = [];
  
  // Step 1: Read file A (codebase inspection)
  const fileAPath = join(serverDir, 'src/domains/codingRuntime/types.ts');
  try {
    const contentA = readFileSync(fileAPath, 'utf8');
    logs.push(`[TOOL] Read ${fileAPath}: ${(contentA.length)} chars`);
  } catch (err: any) {
    logs.push(`[TOOL ERROR] ${fileAPath}: ${err.message}`);
  }

  // Step 2: Read file B (companion context)
  const fileBPath = join(serverDir, 'src/domains/codingRuntime/store.ts');
  try {
    const contentB = readFileSync(fileBPath, 'utf8');
    logs.push(`[TOOL] Read ${fileBPath}: ${(contentB.length)} chars`);
  } catch (err: any) {
    logs.push(`[TOOL ERROR] ${fileBPath}: ${err.message}`);
  }

  // Step 3: Terminal command
  try {
    const { execSync } = await import('child_process');
    const out = execSync(`cd ${serverDir} && git rev-parse --abbrev-ref HEAD`, { encoding: 'utf8' });
    logs.push(`[TOOL] Terminal: current branch=${out.trim()}`);
  } catch (err: any) {
    logs.push(`[TOOL ERROR] Terminal: ${err.message}`);
  }

  // Step 4: Write a marker
  const markerPath = join(serverDir, 'src', 'temp-marker.txt');
  try {
    readFileSync(markerPath, 'utf8');  // Would fail if exists anyway
  } catch {}
  
  await import('fs').then(m => m.mkdirSync(dirname(markerPath), { recursive: true }).catch(() => true));
  await import('fs').then(m => m.writeFileSync(markerPath, 'MARKER', 'utf8'));
  
  try {
    const contentC = readFileSync(markerPath, 'utf8');
    logs.push(`[TOOL] Write verified ${markerPath}: '${contentC}'`);
  } catch (err: any) {
    logs.push(`[TOOL ERROR] marker: ${err.message}`);
  }

  // Step 5: Read again
  try {
    const contentD = readFileSync(markerPath, 'utf8');
    logs.push(`[TOOL] Re-read ${markerPath}: '${contentD}'`);
  } catch (err: any) {
    logs.push(`[TOOL ERROR] re-read marker: ${err.message}`);
  }

  // Step 6: Clean up
  try {
    await import('fs').then(m => m.unlinkSync(markerPath));
    logs.push('[TOOL] Cleaned up marker');
  } catch {}

  return logs;
}

/** Run with instrumentation visible.**/
export async function runWithTrace(): Promise<string[]> {
  const module = await import('./continuation_test.js', { assert: { default: { type: "json" } } });
  
  // Use the exported functions for testing both paths
  console.log('[MODEL] Starting continuation test');
  
  const logs = [];
  
  // Simulate model calls between tool operations
  logs.push('[MODEL] Cycle 1: Before first read');
  const logsA = module.runContinuationTest();
  logs.push(...logsA);
  
  logs.push('[MODEL] Cycle 2: After first read, before second'); 
  const logsB = module.runContinuationTest();
  logs.push(...logsB);
  
  logs.push('[MODEL] Cycle 3: Compression/instrumentation point...');
  // Force context expansion by running with compression boundary test
  
  return logs;
}

