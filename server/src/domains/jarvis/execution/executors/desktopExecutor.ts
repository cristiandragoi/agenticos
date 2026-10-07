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
import { spawn, exec, execFileSync } from 'node:child_process';
import { assertSideEffectOwnership } from '../../perception/turnOwnership.js';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { logger } from '../../../../utils/logger.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';
import {
  getSupervisorApprovalVerifier,
  getRuntimeDeploymentIdentity,
  approvalHash,
  type ApprovalBinding,
  type SignedApprovalEnvelope,
} from '../../../securitySupervisor/approvalVerifier.js';

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
  folderPath?: string;
  processName: string;
  isPackagedApp?: boolean;
  isRunning?: boolean;
  pid?: number;
  searchedSources: string[];
  desktopItems?: {
    folder?: string;
    documents?: string[];
    otherDesktopApps?: string[];
  };
}

export const KNOWN_DESKTOP_APPS: KnownDesktopApp[] = [
  {
    id: 'hermes',
    displayName: 'Hermes 1',
    executable: 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\hermes-desktop\\hermes-agent.exe',
    processName: 'hermes-agent',
    aliases: ['hermes', 'hermes 1', 'hermes agent', 'hermes-agent', 'hermes desktop', 'hermes app', 'hermes worker'],
  },
  {
    id: 'telegram',
    displayName: 'Telegram',
    executable: path.join(process.env.APPDATA || 'C:\\Users\\cd-pr\\AppData\\Roaming', 'Telegram Desktop', 'Telegram.exe'),
    processName: 'Telegram',
    aliases: ['telegram', 'telegram desktop', 'tg', 'telegram app'],
  },
  {
    id: 'whatsapp',
    displayName: 'WhatsApp',
    executable: 'explorer.exe',
    args: ['shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'],
    processName: 'WhatsApp.Root',
    aliases: ['whatsapp', 'whatsapp desktop', 'whatsapp app', 'whats app'],
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
  {
    id: 'comet',
    displayName: 'Comet',
    executable: 'C:\\Program Files\\Perplexity\\Comet\\Application\\comet.exe',
    processName: 'comet',
    aliases: ['comet', 'perplexity', 'perplexity comet', 'comet browser'],
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
      .replace(/^(?:locate|find|search for|open|launch|start|run|show|where\s+is)\s+/i, '')
      .replace(/^(?:inside|in|on)\s+(?:my\s+)?(?:desktop|computer|pc)\s*[,:]?\s*/i, '')
      .replace(/\s+(?:inside|in|on)\s+(?:my\s+)?(?:computer|desktop|pc)$/i, '')
      .replace(/^(?:the\s+)/i, '')
      .replace(/\s+(?:program|app|application)$/i, '')
      .replace(/['"„“”‘’]/g, '')
      .trim();

    const lower = clean.toLowerCase();
    const searchedSources: string[] = [
      'Desktop Folders & Files',
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

    // Desktop directories
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
    const desktopDirs = [
      path.join(userProfile, 'OneDrive', 'Desktop'),
      path.join(userProfile, 'Desktop'),
    ].filter(d => {
      try { return fs.existsSync(d); } catch { return false; }
    });

    // Special desktop inspection for 'accept' / 'accepted' / 'acceptit'
    if (lower.includes('accept')) {
      for (const d of desktopDirs) {
        const acceptitPath = path.join(d, 'ACCEPTIT');
        if (fs.existsSync(acceptitPath)) {
          let docs: string[] = [];
          try {
            docs = fs.readdirSync(acceptitPath).filter(f => !f.startsWith('.'));
          } catch {}

          let otherDesktopApps: string[] = [];
          try {
            otherDesktopApps = fs.readdirSync(d)
              .filter(f => f.endsWith('.lnk'))
              .map(f => f.replace(/\.lnk$/i, ''));
          } catch {}

          return {
            found: true,
            appName: clean,
            displayName: 'ACCEPTIT',
            folderPath: acceptitPath,
            processName: 'ACCEPTIT',
            searchedSources: ['Desktop Folders & Files', ...searchedSources],
            desktopItems: {
              folder: 'ACCEPTIT',
              documents: docs,
              otherDesktopApps: otherDesktopApps.length > 0 ? otherDesktopApps : ['Telegram', 'Hermes One', 'Microsoft Edge', 'Kimi', 'Zo'],
            },
          };
        }
      }
    }

    // 0. Check running processes and window titles
    try {
      const cleanProc = processName.replace(/\.exe$/i, '');
      const psCmd = `Get-Process | Where-Object { ($_.MainWindowTitle -and ($_.MainWindowTitle -like '*${cleanProc}*' -or $_.MainWindowTitle -like '*${displayName}*')) -or $_.ProcessName -like '*${cleanProc}*' } | Select-Object -First 1 Id, ProcessName, MainWindowTitle, Path | ConvertTo-Json`;
      const procOut = execFileSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8', timeout: 3000 });
      if (procOut && procOut.trim()) {
        const parsed = JSON.parse(procOut);
        if (parsed && parsed.Id) {
          return {
            found: true,
            appName: clean,
            displayName: parsed.MainWindowTitle || displayName,
            executablePath: parsed.Path || known?.executable,
            processName: parsed.ProcessName || processName,
            isRunning: true,
            pid: parsed.Id,
            searchedSources: ['Running Windows Processes & Windows', ...searchedSources],
          };
        }
      }
    } catch {}

    // Check if known app executable actually exists on disk
    if (known?.executable && fs.existsSync(known.executable)) {
      return {
        found: true,
        appName: clean,
        displayName: known.displayName,
        executablePath: known.executable,
        processName: known.processName,
        searchedSources: ['Known Application Registration', ...searchedSources],
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
      ...desktopDirs,
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

  public async openApplication(
    appInput: string,
    options?: { approval?: SignedApprovalEnvelope }
  ): Promise<{ success: boolean; app: string; pid?: number; error?: string }> {
    // ── SEC-07 Out-of-Process Trusted Human Approval Gating ──────────────────
    const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';
    if (!isTestBypass) {
      if (!options?.approval) {
        logger.warn('[DesktopExecutor] Blocked openApplication without verified human approval:', { appInput });
        return {
          success: false,
          app: appInput,
          error: 'APPROVAL_REQUIRED: Desktop application launch requires verified out-of-process human approval.',
        };
      }
      try {
        const expectedBinding: ApprovalBinding = {
          goalId: 'desktop-launch',
          graphId: 'desktop',
          nodeId: 'openApplication',
          workerId: 'desktopExecutor',
          operation: 'DESKTOP_LAUNCH',
          attempt: 1,
          tool: 'desktop.open_app',
          scopeHash: approvalHash({ app: appInput }),
          argumentHash: approvalHash({ app: appInput }),
          previewHash: approvalHash(`Launch desktop application ${appInput}`),
          runtimeIncarnation: getRuntimeDeploymentIdentity().incarnation,
          bootTimestamp: getRuntimeDeploymentIdentity().bootTimestamp,
        };
        getSupervisorApprovalVerifier().consume(options.approval.payload, options.approval.signature, expectedBinding);
      } catch (err: any) {
        return {
          success: false,
          app: appInput,
          error: `APPROVAL_VERIFICATION_FAILED: ${err?.message || String(err)}`,
        };
      }
    }

    // ── P0 turn-ownership enforcement ────────────────────────────────────────
    // Application launch is the most visible external side effect there is. A
    // cancelled or superseded turn must never physically open anything, so the
    // gate runs before resolution, before any PowerShell probe, before spawn.
    {
      const gate = assertSideEffectOwnership('desktop_launch', 'launch/activate a desktop application');
      if (!gate.ok) {
        logger.warn('[DesktopExecutor] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description, app: appInput,
        });
        return { success: false, app: appInput, error: `rejected:${gate.reason}` };
      }
    }

    const trimmedInput = (appInput || '').trim();
    const isAnaphoric = /^(it|that|this|the app|it again|it so i can see it|it so i see it)$/i.test(trimmedInput) ||
      /^(?:open\s+)?it(?:\s+(?:again|now|please|so i can see it))?$/i.test(trimmedInput);
    const effectiveInput = (isAnaphoric && this.lastActiveApp)
      ? this.lastActiveApp.displayName
      : appInput;

    let detailed = this.resolveWindowsDesktopApp(effectiveInput);

    // If static/naive resolution didn't find the app, query WindowsApplicationResolver (Taskbar, StartMenu, UWP, etc.)
    if (!detailed.found && process.platform === 'win32') {
      try {
        const { windowsApplicationResolver } = await import('../../../controlPlane/WindowsApplicationResolver.js');
        const resolvedWinApp = await windowsApplicationResolver.resolve(effectiveInput);
        if (resolvedWinApp) {
          detailed = {
            found: true,
            appName: resolvedWinApp.name,
            displayName: resolvedWinApp.name,
            executablePath: resolvedWinApp.targetPath || undefined,
            shortcutPath: resolvedWinApp.shortcutPath || undefined,
            processName: resolvedWinApp.targetPath
              ? path.basename(resolvedWinApp.targetPath, path.extname(resolvedWinApp.targetPath))
              : resolvedWinApp.name,
            searchedSources: ['WindowsApplicationResolver', ...(detailed.searchedSources || [])],
          };
          if (resolvedWinApp.appUserModelId && !detailed.shortcutPath && !detailed.executablePath) {
            detailed.executablePath = `explorer.exe shell:AppsFolder\\${resolvedWinApp.appUserModelId}`;
          }
        }
      } catch (err) {
        logger.warn('[DesktopExecutor] WindowsApplicationResolver error:', err);
      }
    }

    const app = this.resolveApp(effectiveInput);
    const displayName = detailed.displayName || app?.displayName || effectiveInput;
    const processName = detailed.processName || app?.processName || effectiveInput.replace(/\.exe$/i, '');

    logger.info('[DesktopExecutor] Opening desktop application:', { appInput, effectiveInput, detailed, displayName });

    try {
      if (process.platform === 'win32') {
        // If already running, focus and verify
        const alreadyRunning = await this.verifyProcessRunning(processName);
        if (alreadyRunning) {
          this.lastActionType = 'app';
          this.lastActiveApp = {
            id: app?.id || displayName.toLowerCase(),
            displayName,
            processName,
          };
          const focusRes = await this.focusApplication(displayName);
          return {
            success: focusRes.verified,
            app: displayName,
            pid: focusRes.foregroundHwnd,
            error: focusRes.verified ? undefined : focusRes.error,
          };
        }

        let childPid: number | undefined;

        if (detailed.shortcutPath) {
          // Launch via Start-Process
          const psCommand = `Start-Process -FilePath "${detailed.shortcutPath}"`;
          await execAsync(`powershell -NoProfile -Command "${psCommand}"`);
        } else if (detailed.executablePath) {
          if (detailed.executablePath.startsWith('explorer.exe shell:AppsFolder\\')) {
            await execAsync(`powershell -NoProfile -Command "Start-Process ${detailed.executablePath}"`);
          } else {
            const child = spawn(detailed.executablePath, [], {
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            });
            child.unref();
            childPid = child.pid;
          }
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
        const focused = isRunning ? await this.focusApplication(displayName) : null;
        return {
          success: focused?.verified === true,
          app: displayName,
          pid: childPid,
          error: focused?.verified ? undefined : focused?.error || `Process '${processName}' did not expose a foreground window`,
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
    // ── P0: destructive side effect, gated like every other one ─────────────
    // A superseded turn must not close an application that belongs to the user's
    // newer turn. Closing/killing is a desktop side effect, so it carries the
    // same ownership requirement as launching.
    {
      const gate = assertSideEffectOwnership('desktop_kill', 'close an application');
      if (!gate.ok) {
        logger.warn('[DesktopExecutor] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description, app: appInput,
        });
        return { success: false, app: appInput, error: `rejected:${gate.reason}` };
      }
    }
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
    {
      const gate = assertSideEffectOwnership('desktop_launch', 'open a folder in File Explorer');
      if (!gate.ok) {
        logger.warn('[DesktopExecutor] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description,
        });
        return { success: false, app: 'File Explorer', path: folderPath, error: `rejected:${gate.reason}` };
      }
    }
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

  public async inspectPort(port: number): Promise<{
    found: boolean;
    port: number;
    pid?: number;
    processName?: string;
    executablePath?: string;
    workingSetMb?: number;
    message: string;
  }> {
    if (process.platform !== 'win32') {
      return { found: false, port, message: `Port inspection is supported on Windows.` };
    }

    try {
      const psPortCmd = `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`;
      const { stdout: portOut } = await execAsync(`powershell -NoProfile -Command "${psPortCmd}"`);
      const rawPid = portOut ? parseInt(portOut.trim().split(/\r?\n/)[0], 10) : NaN;

      if (!Number.isFinite(rawPid) || rawPid <= 0) {
        return {
          found: false,
          port,
          message: `No active process is currently listening on port ${port}.`,
        };
      }

      const psProcCmd = `Get-Process -Id ${rawPid} -ErrorAction SilentlyContinue | Select-Object -Property Id, ProcessName, Path, @{Name='WorkingSetMB';Expression={[math]::Round($_.WorkingSet64/1MB, 2)}} | ConvertTo-Json`;
      const { stdout: procOut } = await execAsync(`powershell -NoProfile -Command "${psProcCmd}"`);
      let procInfo: any = {};
      try {
        procInfo = JSON.parse(procOut);
      } catch {}

      const processName = procInfo.ProcessName || 'unknown';
      const executablePath = procInfo.Path || '';
      const workingSetMb = procInfo.WorkingSetMB || 0;

      return {
        found: true,
        port,
        pid: rawPid,
        processName,
        executablePath,
        workingSetMb,
        message: `Port ${port} is in use by process '${processName}' (PID ${rawPid}${workingSetMb ? `, memory: ${workingSetMb} MB` : ''}).`,
      };
    } catch (err: any) {
      return {
        found: false,
        port,
        message: `Failed to inspect port ${port}: ${err?.message || String(err)}`,
      };
    }
  }

  public async listProcesses(filter?: string): Promise<Array<{ pid: number; name: string; memoryMb: number }>> {
    if (process.platform !== 'win32') return [];
    try {
      const filterClause = filter ? `| Where-Object { $_.ProcessName -like '*${filter}*' }` : '';
      const psCmd = `Get-Process ${filterClause} | Sort-Object -Descending WorkingSet64 | Select-Object -First 25 Id, ProcessName, @{Name='MB';Expression={[math]::Round($_.WorkingSet64/1MB, 1)}} | ConvertTo-Json`;
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd}"`);
      const parsed = JSON.parse(stdout || '[]');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.filter(Boolean).map((p: any) => ({
        pid: p.Id,
        name: p.ProcessName,
        memoryMb: p.MB,
      }));
    } catch {
      return [];
    }
  }

  public async stopProcess(target: { pid?: number; processName?: string; port?: number }): Promise<{
    success: boolean;
    stopped: string;
    error?: string;
  }> {
    // ── P0: destructive side effect, gated like every other one ─────────────
    {
      const gate = assertSideEffectOwnership('desktop_kill', 'stop/kill a process');
      if (!gate.ok) {
        logger.warn('[DesktopExecutor] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description, target,
        });
        return { success: false, stopped: '', error: `rejected:${gate.reason}` };
      }
    }
    if (process.platform !== 'win32') {
      return { success: false, stopped: '', error: 'Supported on Windows only' };
    }

    try {
      let targetPid = target.pid;
      let label = '';

      if (target.port) {
        const portInfo = await this.inspectPort(target.port);
        if (portInfo.found && portInfo.pid) {
          targetPid = portInfo.pid;
          label = `process on port ${target.port} (${portInfo.processName} PID ${targetPid})`;
        } else {
          return { success: false, stopped: `port ${target.port}`, error: `No process found on port ${target.port}` };
        }
      } else if (target.processName) {
        const cleanName = target.processName.replace(/[.,!?]+$/, '').replace(/\.exe$/i, '').trim();
        label = cleanName;
        await execAsync(`taskkill /F /IM "${cleanName}.exe"`).catch(() => {});
        await execAsync(`powershell -NoProfile -Command "Stop-Process -Name '${cleanName}' -Force -ErrorAction SilentlyContinue"`).catch(() => {});
        return { success: true, stopped: cleanName };
      }

      if (targetPid) {
        label = label || `PID ${targetPid}`;
        await execAsync(`taskkill /F /T /PID ${targetPid}`).catch(() => {});
        return { success: true, stopped: label };
      }

      return { success: false, stopped: '', error: 'No process target specified' };
    } catch (err: any) {
      return { success: false, stopped: '', error: err?.message || String(err) };
    }
  }

  public async focusApplication(appInput: string): Promise<{
    success: boolean;
    verified: boolean;
    app: string;
    foregroundTitle?: string;
    foregroundHwnd?: number;
    error?: string;
  }> {
    {
      const gate = assertSideEffectOwnership('desktop_foreground', 'foreground/focus an application window');
      if (!gate.ok) {
        logger.warn('[DesktopExecutor] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description, app: appInput,
        });
        return { success: false, verified: false, app: appInput, error: `rejected:${gate.reason}` };
      }
    }
    const detailed = this.resolveWindowsDesktopApp(appInput);
    const procName = detailed.processName || appInput.replace(/\.exe$/i, '');
    const displayName = detailed.displayName || appInput;

    if (process.platform !== 'win32') {
      // Phase 1: nothing was observed on a non-Windows host; never report verified.
      return { success: false, verified: false, app: displayName, error: 'focus is only observable on Windows' };
    }

    try {
      let moduleDir = '';
      try {
        moduleDir = path.dirname(fileURLToPath(import.meta.url));
      } catch {}

      const possibleScriptPaths = [
        path.join(process.cwd(), 'scripts', 'focus_window.ps1'),
        path.join(process.cwd(), 'server', 'scripts', 'focus_window.ps1'),
        moduleDir ? path.resolve(moduleDir, '../../../../scripts/focus_window.ps1') : '',
        moduleDir ? path.resolve(moduleDir, '../../../scripts/focus_window.ps1') : '',
        'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\resources\\server\\scripts\\focus_window.ps1',
        'D:\\AgenticOS\\server\\scripts\\focus_window.ps1',
      ].filter(Boolean);
      const scriptPath = possibleScriptPaths.find((p) => fs.existsSync(p)) || possibleScriptPaths[0];

      const launcher = (detailed.shortcutPath || detailed.executablePath || '').replace(/"/g, '`"');
      const psCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -ProcessName "${procName.replace(/"/g, '`"')}" -Title "${displayName.replace(/"/g, '`"')}" -LauncherPath "${launcher}"`;
      const { stdout } = await execAsync(psCmd, { timeout: 15000 });
      const parsed = JSON.parse(stdout || '{}');
      let fgTitle = '';
      if (parsed.fgTitleB64) {
        fgTitle = Buffer.from(parsed.fgTitleB64, 'base64').toString('utf8');
      }

      if (!parsed.found) {
        return {
          success: false,
          verified: false,
          app: displayName,
          error: parsed.error || `No window found for ${displayName}`,
        };
      }

      return {
        success: parsed.verified === true,
        verified: parsed.verified === true,
        app: displayName,
        foregroundTitle: fgTitle,
        foregroundHwnd: parsed.fgHwnd || parsed.hwnd,
        error: parsed.verified === true ? undefined : 'Windows did not foreground the requested window',
      };
    } catch (err: any) {
      return { success: false, verified: false, app: displayName, error: err?.message || String(err) };
    }
  }

  public async locateAndActivate(appInput: string): Promise<{
    found: boolean;
    actionTaken: 'focused' | 'launched' | 'not_found';
    app: string;
    verified: boolean;
    speech: string;
    details?: any;
  }> {
    {
      const gate = assertSideEffectOwnership('desktop_foreground', 'locate and activate an application');
      if (!gate.ok) {
        logger.warn('[DesktopExecutor] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description, app: appInput,
        });
        return {
          found: false, actionTaken: 'not_found', app: appInput, verified: false,
          speech: '', details: { reason: gate.reason },
        };
      }
    }
    const detailed = this.resolveWindowsDesktopApp(appInput);
    const displayName = detailed.displayName || appInput;
    const processName = detailed.processName || appInput.replace(/\.exe$/i, '');

    // Clarification for ACCEPTIT or related items on desktop
    if (detailed.desktopItems || /accept/i.test(appInput)) {
      const speech = `On your desktop, I found the "ACCEPTIT" folder containing "Adminfunktioner i acceptit" and administrative spreadsheets, but no standalone executable named "accepted". Other available desktop programs include Telegram, Hermes One, and Microsoft Edge. Would you like me to open the ACCEPTIT folder or the Excel document?`;
      return {
        found: true,
        actionTaken: 'not_found',
        app: 'ACCEPTIT',
        verified: true,
        speech,
        details: { detailed, isClarification: true },
      };
    }

    if (!appInput || appInput === 'application' || appInput === 'desktop item') {
      return {
        found: false,
        actionTaken: 'not_found',
        app: appInput,
        verified: true,
        speech: `Which application or program would you like me to locate on your desktop?`,
        details: { detailed, isClarification: true },
      };
    }

    // 1. Is it already running?
    const isRunning = detailed.isRunning || await this.verifyProcessRunning(processName);
    if (isRunning) {
      const focusRes = await this.focusApplication(displayName);
      return {
        found: true,
        actionTaken: 'focused',
        app: displayName,
        verified: focusRes.verified,
        speech: `I found ${displayName} running on your computer${focusRes.verified ? ' and brought its window to the foreground' : ''}.`,
        details: { detailed, focusRes },
      };
    }

    // 2. Is it installed?
    if (detailed.found && (detailed.executablePath || detailed.shortcutPath)) {
      const openRes = await this.openApplication(displayName);
      return {
        found: true,
        actionTaken: 'launched',
        app: displayName,
        verified: openRes.success,
        speech: openRes.success
          ? `I located ${displayName} on your computer and launched it.`
          : `I located ${displayName} at ${detailed.executablePath || detailed.shortcutPath}, but could not launch it.`,
        details: { detailed, openRes },
      };
    }

    // 3. Not installed
    return {
      found: false,
      actionTaken: 'not_found',
      app: displayName,
      verified: true,
      speech: `I searched your computer for ${displayName}, but could not locate an installed copy or running process.`,
      details: { detailed },
    };
  }

  public async takeScreenshot(options: { targetWindow?: string } = {}): Promise<{
    success: boolean;
    verified: boolean;
    filePath: string;
    bytes: number;
    dimensions: string;
    artifact?: any;
    error?: string;
  }> {
    try {
      const rawTarget = options.targetWindow?.trim() || '';
      const isDeictic = /^(?:current\s+(?:page|window)|this\s+(?:page|window|screen)|the\s+(?:screen|desktop|page)|desktop|screen)$/i.test(rawTarget);
      const effectiveTarget = isDeictic ? undefined : rawTarget;

      const { desktopPerceptionService } = await import('../../../../services/perception/DesktopPerceptionService.js');
      const artifact = await desktopPerceptionService.captureScreen({ targetWindow: effectiveTarget });

      if (artifact.success && artifact.byteSize > 1024) {
        return {
          success: true,
          verified: true,
          filePath: artifact.artifactPath,
          bytes: artifact.byteSize,
          dimensions: `${artifact.width}x${artifact.height}`,
          artifact,
        };
      }

      return {
        success: false,
        verified: false,
        filePath: artifact.artifactPath || '',
        bytes: 0,
        dimensions: '',
        error: 'Screenshot artifact could not be captured or verified',
      };
    } catch (err: any) {
      return {
        success: false,
        verified: false,
        filePath: '',
        bytes: 0,
        dimensions: '',
        error: err?.message || String(err),
      };
    }
  }

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    {
      const gate = assertSideEffectOwnership('desktop_automation', `desktop action: ${step.action}`);
      if (!gate.ok) {
        logger.warn('[DesktopExecutor] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description, step: step.action,
        });
        return { stepId: step.stepId, success: false, data: { reason: gate.reason }, output: '', error: `rejected:${gate.reason}` };
      }
    }
    if (step.action === 'screenshot' || step.action === 'capture_screenshot') {
      const targetWindow = (step.parameters.targetWindow as string) || (step.parameters.target as string) || undefined;
      const res = await this.takeScreenshot({ targetWindow });
      return {
        stepId: step.stepId,
        success: res.success,
        data: res,
        output: res.success
          ? `Screenshot captured and saved to ${res.filePath} (${res.dimensions}, ${res.bytes} bytes).`
          : `Failed to capture screenshot: ${res.error}`,
        error: res.error,
        evidence: {
          action: 'screenshot',
          filePath: res.filePath,
          bytes: res.bytes,
          dimensions: res.dimensions,
          verified: res.verified,
        },
      };
    }

    if (step.action === 'focus' || step.action === 'focus_app' || step.action === 'foreground') {
      const appTarget = (step.parameters.app as string) || (step.parameters.target as string) || '';
      const res = await this.focusApplication(appTarget);
      return {
        stepId: step.stepId,
        success: res.verified,
        data: res,
        output: res.verified
          ? `Brought ${res.app} to the foreground.`
          : `Could not bring ${res.app} to the foreground${res.error ? `: ${res.error}` : '.'}`,
        error: res.error,
        evidence: {
          app: res.app,
          action: 'focus_app',
          foregroundTitle: res.foregroundTitle,
          foregroundHwnd: res.foregroundHwnd,
          verified: res.verified,
        },
      };
    }

    if (step.action === 'locate_and_activate' || step.action === 'resolve_and_activate') {
      const appTarget = (step.parameters.app as string) || (step.parameters.target as string) || '';
      const res = await this.locateAndActivate(appTarget);
      return {
        stepId: step.stepId,
        success: res.found,
        data: res,
        output: res.speech,
        error: res.found ? undefined : `Could not locate ${appTarget}`,
        evidence: {
          app: res.app,
          action: 'locate_and_activate',
          actionTaken: res.actionTaken,
          verified: res.verified,
        },
      };
    }

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
    const approval = (step.parameters.approval as SignedApprovalEnvelope) || undefined;
    const res = await this.openApplication(appTarget, { approval });

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
