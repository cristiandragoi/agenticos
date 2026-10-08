/**
 * qa/human-simulator/desktopObserver.ts
 *
 * Independent Windows desktop observer.
 * Inspects foreground windows, running processes, browser state, and captures screenshots.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { DesktopObservation } from './types.js';

export class DesktopObserver {
  private screenshotDir: string;
  private scriptPath: string;

  constructor(
    screenshotDir = 'D:\\AgenticOS\\qa\\evidence\\screenshots',
    scriptPath = 'D:\\AgenticOS\\qa\\human-simulator\\get-desktop-state.ps1'
  ) {
    this.screenshotDir = screenshotDir;
    this.scriptPath = scriptPath;
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  }

  /**
   * Get the current desktop state (foreground window, running processes, and optional screenshot).
   */
  observe(label = 'snapshot'): DesktopObservation {
    const filename = `${label}_${Date.now()}.png`;
    const screenshotPath = path.join(this.screenshotDir, filename);

    try {
      const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${this.scriptPath}" -ScreenshotPath "${screenshotPath}"`;
      const out = execSync(cmd, { encoding: 'utf8', timeout: 8000 }).trim();
      const parsed = JSON.parse(out);

      const hasShot = fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 1000;

      return {
        foregroundWindowTitle: parsed.ForegroundTitle || '',
        foregroundProcessName: parsed.ForegroundProcess || '',
        runningProcesses: Array.isArray(parsed.RunningProcesses) ? parsed.RunningProcesses : [],
        screenshotPath: hasShot ? screenshotPath : '',
        observedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn('[DesktopObserver] Error querying desktop state:', err);
      return {
        foregroundWindowTitle: 'Unknown',
        foregroundProcessName: 'Unknown',
        runningProcesses: [],
        screenshotPath: '',
        observedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Quick check for running processes.
   */
  getRunningProcesses(): string[] {
    return this.observe().runningProcesses;
  }

  /**
   * Quick capture of screenshot.
   */
  captureScreenshot(filenamePrefix = 'desktop'): string {
    return this.observe(filenamePrefix).screenshotPath;
  }
}

