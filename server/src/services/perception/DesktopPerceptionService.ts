/**
 * DesktopPerceptionService.ts — Desktop Observation & Screen Perception Service
 *
 * Implements Section 5, 6, 7 & 10 of AgenticOS Production Specification:
 * - desktop.observe capability: perceives visible desktop state and applications.
 * - inspectWindow: native UIA accessibility tree + Electron/Chromium child element extraction.
 * - captureScreen / captureWindow: verifiable screenshot artifact production with SHA256, byte size, dimensions.
 * - getForegroundWindow & listVisibleWindows.
 * - Honest grounded perception: answers "Can you read what is inside [app]?", "What is on my screen?".
 * - Auditable screenshot artifact storage at server/data/artifacts/screenshots/.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { resolveScriptPath } from '../../utils/scriptResolver.js';
import { capabilityPermissionStore } from '../../domains/controlPlane/CapabilityPermissionStore.js';

const execAsync = promisify(exec);

export interface ScreenshotArtifact {
  success: boolean;
  source: 'desktop' | 'window';
  hwnd?: number;
  windowTitle?: string;
  width: number;
  height: number;
  timestamp: string;
  artifactPath: string;
  fileName: string;
  url: string;
  sha256: string;
  byteSize: number;
}

export interface WindowInspectionResult {
  success: boolean;
  windowTitle: string;
  process: string;
  hwnd: number;
  method: 'uia' | 'dom' | 'vision' | 'ocr' | 'ipc';
  text: string;
  controls: Array<{ name: string; type: string; value?: string }>;
  screenshotArtifact?: ScreenshotArtifact;
  confidence: number;
  summary: string;
  error?: string;
}

export class DesktopPerceptionService {
  private static instance: DesktopPerceptionService;
  private screenshotDir: string;

  private constructor() {
    this.screenshotDir = path.resolve(process.cwd(), 'data', 'artifacts', 'screenshots');
    try {
      if (!fs.existsSync(this.screenshotDir)) {
        fs.mkdirSync(this.screenshotDir, { recursive: true });
      }
    } catch {}
  }

  public static getInstance(): DesktopPerceptionService {
    if (!DesktopPerceptionService.instance) {
      DesktopPerceptionService.instance = new DesktopPerceptionService();
    }
    return DesktopPerceptionService.instance;
  }

  public getScreenshotDir(): string {
    return this.screenshotDir;
  }

  /**
   * Capture a real verifiable screenshot of the active desktop or window.
   */
  public async captureScreen(options: { targetWindow?: string; hwnd?: number } = {}): Promise<ScreenshotArtifact> {
    if (!capabilityPermissionStore.isAllowed('screen.capture')) {
      throw new Error('screen.capture permission is not allowed');
    }

    const timestamp = new Date().toISOString();
    const fileName = `screenshot-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.png`;
    const artifactPath = path.join(this.screenshotDir, fileName);

    const scriptPath = resolveScriptPath('desktop_perception.ps1');
    const targetQuery = (options.targetWindow || '').trim();
    const hwndArg = options.hwnd || 0;

    let targetQueryArg = '';
    if (targetQuery && targetQuery.toLowerCase() !== 'desktop' && targetQuery.toLowerCase() !== 'screen') {
      targetQueryArg = ` -TargetQuery "${targetQuery.replace(/"/g, '`"')}"`;
    }
    const hwndFlag = hwndArg > 0 ? ` -Hwnd ${hwndArg}` : '';

    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action "capture"${targetQueryArg}${hwndFlag} -OutScreenshotPath "${artifactPath}"`;

    try {
      const { stdout } = await execAsync(cmd, { timeout: 10000 });
      let parsed: any = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {}

      if (fs.existsSync(artifactPath)) {
        const stats = fs.statSync(artifactPath);
        if (stats.size > 1024) {
          const fileBuf = fs.readFileSync(artifactPath);
          const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');

          return {
            success: true,
            source: 'window',
            hwnd: parsed?.hwnd || options.hwnd,
            windowTitle: parsed?.windowTitle,
            width: parsed?.screenshot?.width || 1920,
            height: parsed?.screenshot?.height || 1080,
            timestamp,
            artifactPath,
            fileName,
            url: `/api/control-plane/artifacts/screenshots/${fileName}`,
            sha256,
            byteSize: stats.size,
          };
        }
      }

      throw new Error('Screenshot artifact verification failed: file empty or missing');
    } catch (err: any) {
      logger.error(`[DesktopPerceptionService] Screen capture failed: ${err?.message}`);
      return {
        success: false,
        source: 'desktop',
        width: 0,
        height: 0,
        timestamp,
        artifactPath: '',
        fileName: '',
        url: '',
        sha256: '',
        byteSize: 0,
      };
    }
  }

  /**
   * Inspect content and controls of a visible desktop window.
   */
  public async inspectWindow(queryOrHwnd?: string | number): Promise<WindowInspectionResult> {
    if (!capabilityPermissionStore.isAllowed('desktop.observe')) {
      return {
        success: false,
        windowTitle: '',
        process: '',
        hwnd: 0,
        method: 'uia',
        text: '',
        controls: [],
        confidence: 0,
        summary: 'desktop.observe permission is disabled in settings.',
        error: 'desktop.observe permission disabled',
      };
    }

    const scriptPath = resolveScriptPath('desktop_perception.ps1');
    const fileName = `inspect-${Date.now()}.png`;
    const artifactPath = path.join(this.screenshotDir, fileName);

    let targetQuery = '';
    let hwnd = 0;
    if (typeof queryOrHwnd === 'number') {
      hwnd = queryOrHwnd;
    } else if (typeof queryOrHwnd === 'string') {
      targetQuery = queryOrHwnd.replace(/^(?:read|what is inside|inspect|examine)\s+(?:the\s+)?/i, '').trim();
    }

    let targetQueryArg = '';
    if (targetQuery && targetQuery.toLowerCase() !== 'desktop' && targetQuery.toLowerCase() !== 'screen') {
      targetQueryArg = ` -TargetQuery "${targetQuery.replace(/"/g, '`"')}"`;
    }
    const hwndFlag = hwnd > 0 ? ` -Hwnd ${hwnd}` : '';

    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action "inspect"${targetQueryArg}${hwndFlag} -OutScreenshotPath "${artifactPath}"`;

    try {
      const { stdout } = await execAsync(cmd, { timeout: 12000 });
      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (err: any) {
        try {
          const firstBrace = stdout.indexOf('{');
          const lastBrace = stdout.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            const rawSlice = stdout.substring(firstBrace, lastBrace + 1);
            const sanitized = rawSlice.replace(/[\u0000-\u001F]/g, ' ');
            parsed = JSON.parse(sanitized);
          } else {
            throw err;
          }
        } catch {
          throw new Error(`Failed to parse desktop perception output: ${err?.message}`);
        }
      }

      if (!parsed.success) {
        return {
          success: false,
          windowTitle: '',
          process: '',
          hwnd: 0,
          method: 'uia',
          text: '',
          controls: [],
          confidence: 0,
          summary: parsed.error || `Could not find window matching "${targetQuery}".`,
          error: parsed.error,
        };
      }

      let screenshotArtifact: ScreenshotArtifact | undefined;
      if (fs.existsSync(artifactPath)) {
        const stats = fs.statSync(artifactPath);
        if (stats.size > 1024) {
          const fileBuf = fs.readFileSync(artifactPath);
          const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
          screenshotArtifact = {
            success: true,
            source: 'window',
            hwnd: parsed.hwnd,
            windowTitle: parsed.windowTitle,
            width: parsed.screenshot?.width || 1920,
            height: parsed.screenshot?.height || 1080,
            timestamp: new Date().toISOString(),
            artifactPath,
            fileName,
            url: `/api/control-plane/artifacts/screenshots/${fileName}`,
            sha256,
            byteSize: stats.size,
          };
        }
      }

      const text = parsed.text || '';
      let summary = '';
      if (text.length > 0) {
        const lines = text.split('\n').filter(Boolean);
        const preview = lines.slice(0, 5).join('; ');
        summary = `Inside ${parsed.windowTitle || parsed.process}: ${preview}${lines.length > 5 ? '...' : ''}`;
      } else {
        summary = `${parsed.windowTitle || parsed.process} is open, but contains no accessible text elements.`;
      }

      return {
        success: true,
        windowTitle: parsed.windowTitle,
        process: parsed.process,
        hwnd: parsed.hwnd,
        method: parsed.method || 'uia',
        text,
        controls: parsed.controls || [],
        screenshotArtifact,
        confidence: parsed.confidence || 0.9,
        summary,
      };
    } catch (err: any) {
      logger.error(`[DesktopPerceptionService] Window inspection error: ${err?.message}`);
      return {
        success: false,
        windowTitle: '',
        process: '',
        hwnd: 0,
        method: 'uia',
        text: '',
        controls: [],
        confidence: 0,
        summary: `Failed to inspect window: ${err?.message}`,
        error: err?.message,
      };
    }
  }

  /**
   * Perceive and understand visible application state for a spoken inquiry:
   * e.g. "Can you read what is inside Hermes 1?", "What is on my screen?", "What error do you see?".
   */
  public async perceive(userInquiry: string): Promise<string> {
    const clean = userInquiry.trim();

    // Extract target app if mentioned
    const appMatch = clean.match(/\b(?:inside|in|on|of)\s+([A-Za-z0-9_\-\s]+?)(?:\?|\.|$)/i);
    const target = appMatch ? appMatch[1].trim() : '';

    const inspection = await this.inspectWindow(target);
    if (!inspection.success || !inspection.text) {
      return inspection.summary || 'I could not read the visible contents of the active window.';
    }

    const lines = inspection.text.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const topLines = lines.slice(0, 10).join('\n');

    return `Inside ${inspection.windowTitle || inspection.process}, I see:\n${topLines}`;
  }

  /**
   * List all visible top-level windows currently open on the desktop.
   */
  public async listVisibleWindows(): Promise<Array<{ hwnd: number; pid: number; process: string; title: string }>> {
    try {
      const scriptPath = resolveScriptPath('list_desktop_windows.ps1');
      if (fs.existsSync(scriptPath)) {
        const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { timeout: 10000 });
        const trimmed = stdout.trim();
        const jsonStart = trimmed.indexOf('[');
        const jsonEnd = trimmed.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          return JSON.parse(trimmed.substring(jsonStart, jsonEnd + 1));
        }
      }
    } catch (e: any) {
      logger.warn(`[DesktopPerceptionService] listVisibleWindows error: ${e?.message}`);
    }
    return [];
  }
}

export const desktopPerceptionService = DesktopPerceptionService.getInstance();
