/**
 * scriptResolver.ts — Robust multi-environment script path resolver (ESM compatible)
 *
 * Reliably finds PowerShell and helper scripts whether running from:
 * - Development workspace (D:\AgenticOS or D:\AgenticOS\server)
 * - Installed Electron runtime (C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\resources\server)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveScriptPath(scriptName: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'scripts', scriptName),
    path.resolve(process.cwd(), 'server', 'scripts', scriptName),
    path.resolve(__dirname, '../../../scripts', scriptName),
    path.resolve(__dirname, '../../scripts', scriptName),
    path.resolve(__dirname, '../scripts', scriptName),
    path.resolve('C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\resources\\server\\scripts', scriptName),
    path.resolve('D:\\AgenticOS\\server\\scripts', scriptName),
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return c;
      }
    } catch {}
  }

  // Fallback to first candidate if not found yet
  return candidates[0];
}
