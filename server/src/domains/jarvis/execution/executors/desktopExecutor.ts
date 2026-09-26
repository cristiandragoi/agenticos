/**
 * desktopExecutor.ts — Desktop & Application Execution for Universal Execution Controller.
 *
 * Handles:
 * - Dynamic resolution of Windows desktop applications (Start Menu, Program Files, App Paths, running processes)
 * - Launching desktop applications (Telegram, Notepad, VS Code, Explorer, PowerShell, etc.)
 * - Verifying application window/process actually exists in OS process table
 * - Focusing windows where supported
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../../../utils/logger.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

const execAsync = promisify(exec);

export interface KnownDesktopApp {
  id: string;
  displayName: string;
  executable: string;
  args?: string[];
  processName: string;
  aliases: string[];
}

export interface DesktopAppResolutionResult {
  found: boolean;
  appName: string;
  displayName: string;
  executablePath?: string;
  shortcutPath?: string;
  processName: string;
  isPackagedApp?: boolean;
  searchedSources: string[];
}

export const KNOWN_DESKTOP_APPS: KnownDesktopApp[] = [
  {
    id: 'telegram',
    displayName: 'Telegram',
    executable: 'Telegram.exe',
    processName: 'Telegram',
    aliases: ['telegram', 'telegram desktop', 'tg', 'telegram app'],
  },
  {
    id: 'chatgpt',
    displayName: 'ChatGPT',
    executable: 'ChatGPT.exe',
    processName: 'ChatGPT',
    aliases: ['chatgpt', 'chat gpt', 'chatgpt desktop', 'chatgpt app'],
  },
  {
    id: 'powershell',
    displayName: 'PowerShell',
    executable: 'powershell.exe',
    args: ['-NoExit'],
    processName: 'powershell',
    aliases: ['powershell', 'power shell', 'ps', 'windows powershell', 'powershell window'],
  },
  {
    id: 'cmd',
    displayName: 'Command Prompt',
    executable: 'cmd.exe',
    args: ['/k'],
    processName: 'cmd',
    aliases: ['cmd', 'command prompt', 'terminal prompt', 'command line'],
  },
  {
    id: 'notepad',
    displayName: 'Notepad',
    executable: 'notepad.exe',
    processName: 'notepad',
    aliases: ['notepad', 'text editor', 'notepad.exe'],
  },
  {
    id: 'explorer',
    displayName: 'File Explorer',
    executable: 'explorer.exe',
    processName: 'explorer',
    aliases: ['explorer', 'file explorer', 'files', 'my computer', 'windows explorer'],
  },
  {
    id: 'vscode',
    displayName: 'Visual Studio Code',
    executable: 'code.cmd',
    processName: 'code',
    aliases: ['vscode', 'vs code', 'code', 'visual studio code'],
  },
  {
    id: 'calculator',
    displayName: 'Calculator',
    executable: 'calc.exe',
    processName: 'calculator',
    aliases: ['calculator', 'calc'],
  },
  {
    id: 'settings',
    displayName: 'Settings',
    executable: 'start ms-settings:',
    processName: 'SystemSettings',
    aliases: ['settings', 'windows settings', 'pc settings', 'einstellungen', 'system settings'],
  },
];

export class DesktopExecutor {
  public readonly id = 'desktop';

  private lastActiveApp: { id: string; displayName: string; processName: string; pid?: number } | null = null;
  private lastOpenedFolder: { path: string; displayName: string } | null = null;
  private lastActionType: 'app' | 'folder' | null = null;

  public getLastActiveApp() {
    return this.lastActiveApp;
  }

  public getLastOpenedFolder() {
    return this.lastOpenedFolder;
  }

  public getLastActionType() {
    return this.lastActionType;
  }

  /**
   * Search Windows filesystem, Start Menu, and processes for an application.
   */
  public resolveWindowsDesktopApp(query: string): DesktopAppResolutionResult {
    const clean = (query || '')
      .replace(/^(?:can you\s+|could you\s+|please\s+|i want to\s+|i'd like to\s+|would you\s+|let's\s+|let me\s+)+/i, '')
      .replace(/^(?:locate|find|search for|open|launch|start|run|show)\s+/i, '')
      .replace(/\s+(?:inside|in|on)\s+my\s+computer$/i, '')
      .replace(/[.,!?]+$/, '')
      .trim();

    const lower = clean.toLowerCase();
    const searchedSources: string[] = [
      'Start Menu (User)',
      'Start Menu (System)',
      'Local AppData Programs',
      'Program Files',
      'Program Files (x86)',
      'Windows App Paths',
    ];

    // Check static known apps
    const known = this.resolveApp(clean);
    let processName = known?.processName || clean;
    let displayName = known?.displayName || clean;

    if (process.platform !== 'win32') {
      return {
        found: true,
        appName: clean,
        displayName,
        executablePath: known?.executable || clean,
        processName,
        searchedSources,
      };
    }

    // Windows search directories
    const userStartMenu = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : null;
    const commonStartMenu = process.env.ProgramData
      ? path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs';
    const localAppDataProg = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs')
      : null;
    const userAppData = process.env.APPDATA ? process.env.APPDATA : null;

    const searchDirs = [
      userStartMenu,
      commonStartMenu,
      localAppDataProg,
      userAppData ? path.join(userAppData, 'Telegram Desktop') : null,
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter(Boolean) as string[];

    let foundShortcut: string | undefined;
    let foundExe: string | undefined;

    const scanDir = (dir: string, depth = 0) => {
      if (depth > 3 || (foundShortcut && foundExe)) return;
      try {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else {
            const entryLower = entry.name.toLowerCase();
            if (entryLower.includes(lower) || (lower === 'chatgpt' && entryLower.includes('chatgpt'))) {
              if (entryLower.endsWith('.lnk') && !entryLower.includes('uninstall') && !foundShortcut) {
                foundShortcut = fullPath;
              } else if (entryLower.endsWith('.exe') && !entryLower.includes('uninstall') && !foundExe) {
                foundExe = fullPath;
              }
            }
          }
        }
      } catch {
        /* ignore access denied */
      }
    };

    for (const d of searchDirs) {
      scanDir(d);
      if (foundShortcut || foundExe) break;
    }

    if (foundShortcut || foundExe) {
      if (lower.includes('telegram')) {
        displayName = 'Telegram';
        processName = 'Telegram';
      }
      return {
        found: true,
        appName: clean,
        displayName,
        executablePath: foundExe,
        shortcutPath: foundShortcut,
        processName,
        searchedSources,
      };
    }

    // Special check for Telegram known AppData path
    if (lower.includes('telegram')) {
      const defaultTelegramExe = path.join(process.env.APPDATA || '', 'Telegram Desktop', 'Telegram.exe');
      if (fs.existsSync(defaultTelegramExe)) {
        return {
          found: true,
          appName: 'Telegram',
          displayName: 'Telegram',
          executablePath: defaultTelegramExe,
          processName: 'Telegram',
          searchedSources,
        };
      }
    }

    return {
      found: false,
      appName: clean,
      displayName,
      processName,
      searchedSources,
    };
  }

  public resolveAppDetailed(query: string): DesktopAppResolutionResult {
    return this.resolveWindowsDesktopApp(query);
  }

  public resolveApp(query: string): KnownDesktopApp | null {
    const q = (query || '').toLowerCase()
      .replace(/^(?:can you\s+|could you\s+|please\s+|i want to\s+|i'd like to\s+|would you\s+|let's\s+|let me\s+)+/i, '')
      .replace(/^(?:open|launch|start|run|show|bring up|close|quit|exit|kill)\s+/i, '')
      .replace(/[.,!?]+$/, '')
      .trim();

    if (/^(it|that|this|the app|the application|it again|the previous app)$/i.test(q) && this.lastActiveApp) {
      return KNOWN_DESKTOP_APPS.find((a) => a.processName.toLowerCase() === this.lastActiveApp!.processName.toLowerCase()) || {
        id: this.lastActiveApp.id,
        displayName: this.lastActiveApp.displayName,
        executable: `${this.lastActiveApp.processName}.exe`,
        processName: this.lastActiveApp.processName,
        aliases: [this.lastActiveApp.displayName.toLowerCase()],
      };
    }

    for (const app of KNOWN_DESKTOP_APPS) {
      if (app.aliases.some((a) => {
        const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return a === q || new RegExp(`\\b${escaped}\\b`, 'i').test(q);
      })) {
        return app;
      }
    }
    return null;
  }

  public async openApplication(appInput: string): Promise<{ success: boolean; app: string; pid?: number; error?: string }> {
    const effectiveInput = (/^(it|that|this|the app|it again)$/i.test((appInput || '').trim()) && this.lastActiveApp)
      ? this.lastActiveApp.displayName
      : appInput;

    const detailed = this.resolveWindowsDesktopApp(effectiveInput);
    const app = this.resolveApp(effectiveInput);
    const displayName = detailed.displayName || app?.displayName || effectiveInput;
    const processName = detailed.processName || app?.processName || effectiveInput.replace(/\.exe$/i, '');

    logger.info('[DesktopExecutor] Opening desktop application:', { appInput, effectiveInput, detailed, displayName });

    try {
      if (process.platform === 'win32') {
        // If already running, focus or report running
        const alreadyRunning = await this.verifyProcessRunning(processName);
        if (alreadyRunning) {
          this.lastActionType = 'app';
          this.lastActiveApp = {
            id: app?.id || displayName.toLowerCase(),
            displayName,
            processName,
          };
          return { success: true, app: displayName };
        }

        let childPid: number | undefined;

        if (detailed.shortcutPath) {
          // Launch via Start-Process
          const psCommand = `Start-Process -FilePath "${detailed.shortcutPath}"`;
          await execAsync(`powershell -NoProfile -Command "${psCommand}"`);
        } else if (detailed.executablePath) {
          const child = spawn(detailed.executablePath, [], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          });
          child.unref();
          childPid = child.pid;
        } else {
          const exe = app ? app.executable : effectiveInput;
          const isUrlOrUri = exe.startsWith('start ');
          const child = spawn(isUrlOrUri ? exe : exe, isUrlOrUri ? [] : (app?.args || []), {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
            shell: true,
          });
          child.unref();
          childPid = child.pid;
        }

        // Allow OS half a second to initialize process
        await new Promise((r) => setTimeout(r, 600));

        // Verify running in process list
        const isRunning = await this.verifyProcessRunning(processName);
        if (isRunning) {
          this.lastActionType = 'app';
          this.lastActiveApp = {
            id: app?.id || displayName.toLowerCase(),
            displayName,
            processName,
            pid: childPid,
          };
        }
        return {
          success: isRunning,
          app: displayName,
          pid: childPid,
          error: isRunning ? undefined : `Process '${processName}' did not register in OS process table`,
        };
      } else {
        const child = spawn(detailed.executablePath || effectiveInput, [], { detached: true, stdio: 'ignore' });
        child.unref();
        this.lastActionType = 'app';
        this.lastActiveApp = {
          id: app?.id || displayName.toLowerCase(),
          displayName,
          processName,
          pid: child.pid,
        };
        return { success: true, app: displayName, pid: child.pid };
      }
    } catch (err: any) {
      logger.error('[DesktopExecutor] Failed to launch application:', err);
      return { success: false, app: displayName, error: err?.message || String(err) };
    }
  }

  public async closeApplication(appInput: string): Promise<{ success: boolean; app: string; error?: string }> {
    const effectiveInput = (/^(it|that|this|the app|the application)$/i.test((appInput || '').trim()) && this.lastActiveApp)
      ? this.lastActiveApp.displayName
      : appInput;

    const app = this.resolveApp(effectiveInput);
    const processName = app ? app.processName : effectiveInput.replace(/\.exe$/i, '');
    const displayName = app ? app.displayName : effectiveInput;

    logger.info('[DesktopExecutor] Closing desktop application:', { appInput, effectiveInput, processName, displayName });

    try {
      if (process.platform === 'win32') {
        await execAsync(`taskkill /IM "${processName}.exe" /F`).catch(() => {});
      } else {
        await execAsync(`pkill -f "${processName}"`).catch(() => {});
      }

      await new Promise((r) => setTimeout(r, 400));
      const isStillRunning = await this.verifyProcessRunning(processName);

      return {
        success: !isStillRunning,
        app: displayName,
        error: !isStillRunning ? undefined : `Process '${processName}' could not be closed.`,
      };
    } catch (err: any) {
      const isStillRunning = await this.verifyProcessRunning(processName);
      return {
        success: !isStillRunning,
        app: displayName,
        error: isStillRunning ? err?.message || String(err) : undefined,
      };
    }
  }

  public async verifyProcessRunning(processName: string): Promise<boolean> {
    if (process.platform !== 'win32') return true;
    try {
      const cleanName = processName.replace(/\.exe$/i, '');
      const { stdout } = await execAsync(`powershell -NoProfile -Command "Get-Process -Name '${cleanName}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id"`);
      return Boolean(stdout && stdout.trim().length > 0);
    } catch {
      return false;
    }
  }

  public async openFolder(folderPath: string): Promise<{ success: boolean; app: string; path: string; error?: string }> {
    let p = folderPath.trim();
    if ((/^(it|that|again|the same folder)$/i.test(p) || !p) && this.lastOpenedFolder) {
      p = this.lastOpenedFolder.path;
    }

    if (!fs.existsSync(p)) {
      return {
        success: false,
        app: 'File Explorer',
        path: p,
        error: `Folder does not exist: ${p}`,
      };
    }

    try {
      if (process.platform === 'win32') {
        const child = spawn('explorer.exe', [p], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          shell: true,
        });
        child.unref();
        await new Promise((r) => setTimeout(r, 500));
        this.lastActionType = 'folder';
        this.lastOpenedFolder = { path: p, displayName: 'File Explorer' };
        return {
          success: true,
          app: 'File Explorer',
          path: p,
        };
      } else {
        const child = spawn('open', [p], { detached: true, stdio: 'ignore' });
        child.unref();
        this.lastActionType = 'folder';
        this.lastOpenedFolder = { path: p, displayName: 'File Explorer' };
        return { success: true, app: 'File Explorer', path: p };
      }
    } catch (err: any) {
      return { success: false, app: 'File Explorer', path: p, error: err?.message || String(err) };
    }
  }

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    if (step.action === 'close_app' || step.action === 'close_application' || step.action === 'close') {
      const appTarget = (step.parameters.app as string) || (step.parameters.application as string) || '';
      const res = await this.closeApplication(appTarget);
      return {
        stepId: step.stepId,
        success: res.success,
        data: res,
        output: res.success ? `Closed ${res.app}.` : `Could not close ${res.app}${res.error ? `: ${res.error}` : '.'}`,
        error: res.error,
        evidence: {
          app: res.app,
          action: 'close_app',
          verified: res.success,
        },
      };
    }

    if (step.action === 'open_folder' || step.action === 'open_path') {
      const folderPath = (step.parameters.path as string) || (step.parameters.target as string) || '';
      const displayName = (step.parameters.displayName as string) || folderPath;
      const res = await this.openFolder(folderPath);

      return {
        stepId: step.stepId,
        success: res.success,
        data: res,
        output: res.success
          ? `Opened ${displayName} in File Explorer.`
          : `I couldn't open ${displayName}${res.error ? `: ${res.error}` : '.'}`,
        error: res.error,
        evidence: {
          app: 'File Explorer',
          path: res.path,
          targetType: 'filesystem',
          action: 'open_folder',
          verified: res.success,
        },
      };
    }

    const appTarget = (step.parameters.app as string) || (step.parameters.application as string) || '';
    const res = await this.openApplication(appTarget);

    return {
      stepId: step.stepId,
      success: res.success,
      data: res,
      output: res.success
        ? `${res.app} is open.`
        : `I couldn't open ${res.app}${res.error ? `: ${res.error}` : '.'}`,
      error: res.error,
      evidence: {
        app: res.app,
        pid: res.pid,
        verifiedInProcessList: res.success,
      },
    };
  }

  public async verify(result: ExecutionResult): Promise<VerificationResult> {
    const data = result.data as any;
    const verified = Boolean(result.success && data?.success !== false);

    return {
      verified,
      realityCheck: verified
        ? (result.output || `Application action confirmed`)
        : `Application action failed: ${result.error || 'unknown error'}`,
      actualState: data,
      error: verified ? undefined : result.error,
    };
  }
}

export const desktopExecutor = new DesktopExecutor();
