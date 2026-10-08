/**
 * qa/human-simulator/desktopObserver.ts
 *
 * Independent Windows desktop observer.
 * Inspects foreground windows, running processes, browser state, and captures live screenshots.
 * Uses high-reliability WinSta0 attachment via capture_desktop.py.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { DesktopObservation } from './types.js';
import { notifyDesktopObserved } from './monitor/monitorServer.js';

export class DesktopObserver {
  private screenshotDir: string;
  private scriptPath: string;
  private observationInterval: NodeJS.Timeout | null = null;
  private lastObs: DesktopObservation | null = null;

  constructor(
    screenshotDir = 'D:\\AgenticOS\\qa\\evidence\\screenshots',
    scriptPath = 'D:\\AgenticOS\\qa\\human-simulator\\capture_desktop.py'
  ) {
    this.screenshotDir = screenshotDir;
    this.scriptPath = scriptPath;
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  }

  /**
   * Get the current desktop state (foreground window, running processes, and live screenshot).
   */
  observe(label = 'snapshot'): DesktopObservation {
    const filename = `${label}_${Date.now()}.jpg`;
    const screenshotPath = path.join(this.screenshotDir, filename);

    try {
      const cmd = `python "${this.scriptPath}" "${screenshotPath}"`;
      const out = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
      const parsed = JSON.parse(out);
      const actualPath = parsed.ScreenshotPath || screenshotPath;
      const hasShot = fs.existsSync(actualPath) && fs.statSync(actualPath).size > 1000;

      const obs: DesktopObservation = {
        foregroundWindowTitle: parsed.ForegroundTitle || '',
        foregroundProcessName: parsed.ForegroundProcess || '',
        runningProcesses: Array.isArray(parsed.RunningProcesses) ? parsed.RunningProcesses : [],
        screenshotPath: hasShot ? actualPath : '',
        observedAt: new Date().toISOString(),
      };

      this.lastObs = obs;

      try {
        notifyDesktopObserved(obs);
      } catch (e) {
        console.warn('[DesktopObserver] Error notifying monitor:', e);
      }

      return obs;
    } catch (err) {
      console.warn('[DesktopObserver] Error querying desktop state:', err);
      const fallback: DesktopObservation = {
        foregroundWindowTitle: this.lastObs?.foregroundWindowTitle || 'Desktop',
        foregroundProcessName: this.lastObs?.foregroundProcessName || 'Desktop',
        runningProcesses: this.lastObs?.runningProcesses || [],
        screenshotPath: this.lastObs?.screenshotPath || '',
        observedAt: new Date().toISOString(),
      };
      return fallback;
    }
  }

  /**
   * Starts a continuous background desktop observation loop to keep live monitor frames updating.
   */
  startContinuousObservation(intervalMs = 1500): void {
    if (this.observationInterval) return;
    this.observe('stream_init');
    this.observationInterval = setInterval(() => {
      try {
        this.observe('stream');
      } catch {}
    }, intervalMs);
  }

  /**
   * Stops continuous background observation.
   */
  stopContinuousObservation(): void {
    if (this.observationInterval) {
      clearInterval(this.observationInterval);
      this.observationInterval = null;
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
