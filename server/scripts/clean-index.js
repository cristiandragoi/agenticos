#!/usr/bin/env node
// Clean up duplicate entries in AgenticOS server
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'D:/AgenticOS/server/src/index.ts';
console.log(`[Cleaner] Reading ${path}...`);

const original = readFileSync(path, 'utf8');

// Step 1: Remove duplicate import at line 112 (humanGatesRouter)
let fixed = original;
const humanGateImportMatch = fixed.match(/^(import healthRouter from|import systemRouter from)/m);
const nextImportIndex = humanGateImportMatch ? fixed.indexOf(humanGateImportMatch[0]) - 1 : -1;
if (nextImportIndex < 0) {
  // Find the first line starting with 'import' after healthRouter
  const lines = fixed.split('\n');
  for (let i = 68; i < lines.length - 5; i++) {
    if (lines[i].startsWith('import ') && lines[i].includes('from')) {
      if (!lines[i-1] || !lines[i-1].endsWith('from \'./routers/health.js\'');) {
        // Check if it's the duplicate humanGates import by seeing what follows
        const nextLine = lines[i+1];
        if (nextLine && nextLine.includes('humanGatesRouter')) {
          console.log(`[Cleaner] Found duplicate at line ${i+1}, removing...`);
          fixed = fixed.slice(0, i) + '\n' + fixed.slice(i + 3); // skip the duplicate line and its blank line
        } else if (nextLine && nextLine.trim().startsWith('const')) {
          console.log(`[Cleaner] Found declaration at line ${i+1}, skipping this area entirely...`);
          fixed = original.replace(/^import humanGatesRouter/, '').replace(/^[ \t]*import[^m]/m, 'import'); // crude strip
          break;
        } else {
          console.log(`[Cleaner] Next line is not duplicate: ${lines[i]}, keeping.`);
          break;
        }
      }
    }
  }
}

// Remove duplicate import at line 271 (humanGatesRouter again)
const dupHumanLines = fixed.split('\n').map((l, i) => ({ line: i+1, content: l })).filter(x => x.content.includes('import humanGatesRouter') && x.line > 100);
if (fixed.includes('app.get(\'/api/background-tasks/human-gates/open')) {
  console.log(`[Cleaner] Found delegated route section around the second duplicate, removing entire block...`);
  fixed = fixed.replace(/import humanGatesRouter from ['"].*human\.js['"];[\s\S]*?(app\.get.*\/open.*?)};?/, '$1');
}

// Remove second background-tasks use at lines 269-270
fixed = fixed.replace(/app\.use\(['"]\/api\/background-tasks['"][^,]*,\s*backgroundTasksRouter[\);]?\)/m, '');

console.log(`[Cleaner] Writing cleaned file...`);
writeFileSync(path, fixed);

console.log('[Cleaner] Done.');
