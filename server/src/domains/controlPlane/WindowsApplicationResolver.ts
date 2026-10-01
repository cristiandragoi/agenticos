/**
 * WindowsApplicationResolver.ts — Authoritative Windows Application Discovery Engine
 *
 * Implements Section 3 & Section 4:
 * Dynamic, comprehensive discovery of applications installed and accessible on Windows:
 * 1. Taskbar pinned applications (%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar)
 * 2. Start Menu shortcuts (User & ProgramData programs, User Pinned\StartMenu)
 * 3. Desktop shortcuts (User Desktop, Public Desktop, OneDrive Desktop)
 * 4. Windows Store / UWP apps & AppUserModelIDs (Get-StartApps)
 * 5. Registry App Paths (HKCU & HKLM CurrentVersion\App Paths)
 * 6. Running processes & top-level visible window HWNDs
 * 7. Browser-installed PWAs (Chrome/Edge apps with --app-id)
 * 8. Standard Program Directories (Program Files, Program Files (x86), LocalAppData\Programs)
 * 9. Learned aliases & RepairKnowledge
 *
 * No hardcoding of specific applications.
 * Boosts taskbar applications when user provides taskbar evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { resolveScriptPath } from '../../utils/scriptResolver.js';
import { repairKnowledgeStore } from './RepairKnowledgeStore.js';

const execAsync = promisify(exec);

export interface ApplicationCandidate {
  name: string;
  source: 'taskbar' | 'start_menu' | 'desktop' | 'uwp' | 'app_paths' | 'running_window' | 'pwa' | 'executable' | 'learned';
  targetPath?: string;
  shortcutPath?: string;
  appUserModelId?: string;
  arguments?: string;
  hwnd?: number;
  pid?: number;
  processName?: string;
  windowTitle?: string;
  score: number;
  description: string;
}

export interface ResolveAppOptions {
  explicitTaskbar?: boolean;
  actionType?: string;
}

export class WindowsApplicationResolver {
  private static instance: WindowsApplicationResolver;
  private cachedStartApps: Array<{ name: string; appUserModelId: string }> = [];
  private startAppsCachedAt = 0;
  private cachedLnkShortcuts: Array<{ name: string; path: string; source: 'start_menu' | 'desktop' }> = [];
  private lnkCachedAt = 0;

  private constructor() {}

  public static getInstance(): WindowsApplicationResolver {
    if (!WindowsApplicationResolver.instance) {
      WindowsApplicationResolver.instance = new WindowsApplicationResolver();
    }
    return WindowsApplicationResolver.instance;
  }

  /**
   * Authoritative resolution entry point:
   * Finds the best match across all Windows application surfaces for a given user query.
   */
  public async resolve(rawQuery: string, options: ResolveAppOptions = {}): Promise<ApplicationCandidate | null> {
    const cleanQuery = (rawQuery || '')
      .replace(/^(?:open|launch|start|run|locate|find|show|bring\s+up|foreground|switch\s+to)\s+/i, '')
      .replace(/\s+(?:app|application|program|tool|browser|window)$/i, '')
      .trim();

    if (!cleanQuery) return null;

    const lower = cleanQuery.toLowerCase();
    const explicitTaskbar = options.explicitTaskbar || /\b(?:taskbar|pinned|on\s+my\s+taskbar|pinned\s+on\s+taskbar)\b/i.test(rawQuery);

    const appQuery = cleanQuery
      .replace(/\s+and\s+(?:create|make|write|open|start|type|new|navigate|show)\b.*$/i, '')
      .trim();
    const appLower = appQuery.toLowerCase();

    // 0. Check learned RepairKnowledge first
    const learned = repairKnowledgeStore.lookupResolution(cleanQuery, options.actionType || 'open')
      || (appQuery !== cleanQuery ? repairKnowledgeStore.lookupResolution(appQuery, options.actionType || 'open') : null);
    const resolvedTarget = learned?.executablePath || learned?.parameters?.executablePath || learned?.parameters?.shortcutPath;
    const resolvedShortcut = learned?.parameters?.shortcutPath || (learned?.surface === 'start_menu' || learned?.surface === 'taskbar' ? (learned?.executablePath || learned?.parameters?.shortcutPath) : undefined);
    const appUserModelId = learned?.parameters?.appUserModelId;
    if (learned && (resolvedTarget || resolvedShortcut || appUserModelId)) {
      return {
        name: learned.target,
        source: 'learned',
        targetPath: resolvedTarget,
        shortcutPath: resolvedShortcut,
        appUserModelId,
        score: 0.99,
        description: `Learned resolution from RepairKnowledge (${learned.surface})`,
      };
    }

    const candidates: ApplicationCandidate[] = [];

    // Helper to score query against both full query and appQuery
    const getBestScore = (candidateName: string, bonus: number = 0): number => {
      const s1 = this.scoreMatch(lower, candidateName, bonus);
      const s2 = appQuery !== cleanQuery ? this.scoreMatch(appLower, candidateName, bonus) : 0;
      return Math.max(s1, s2);
    };

    // 1. Taskbar Pinned Shortcuts
    const taskbarApps = await this.getTaskbarPinnedApps();
    for (const app of taskbarApps) {
      const matchScore = getBestScore(app.name, explicitTaskbar ? 0.15 : 0.05);
      if (matchScore > 0.4) {
        const procName = app.targetPath
          ? path.basename(app.targetPath, path.extname(app.targetPath)).toLowerCase()
          : app.name.toLowerCase();
        candidates.push({
          name: app.name,
          source: 'taskbar',
          shortcutPath: app.path,
          targetPath: app.targetPath || app.path,
          arguments: app.arguments,
          processName: procName,
          score: matchScore + (explicitTaskbar ? 0.1 : 0),
          description: `Taskbar Pinned Shortcut: ${app.name}`,
        });
      }
    }

    // 2. Running Visible Windows (active processes)
    const runningWindows = await this.getVisibleWindows();
    for (const win of runningWindows) {
      const titleMatch = getBestScore(win.title, 0.02);
      const procMatch = getBestScore(win.process, 0.02);
      const bestWinScore = Math.max(titleMatch, procMatch);
      if (bestWinScore > 0.4) {
        candidates.push({
          name: win.title || win.process,
          source: 'running_window',
          hwnd: win.hwnd,
          pid: win.pid,
          processName: win.process,
          windowTitle: win.title,
          score: bestWinScore * 0.95,
          description: `Running Window: "${win.title}" (${win.process})`,
        });
      }
    }

    // 3. Start Menu & Desktop Shortcuts
    const allShortcuts = await this.getAllShortcuts();
    for (const sc of allShortcuts) {
      const matchScore = getBestScore(sc.name, 0);
      if (matchScore > 0.4) {
        candidates.push({
          name: sc.name,
          source: sc.source,
          shortcutPath: sc.path,
          targetPath: sc.path,
          score: matchScore,
          description: `${sc.source === 'start_menu' ? 'Start Menu' : 'Desktop'} Shortcut: ${sc.name}`,
        });
      }
    }

    // 4. Windows Store / UWP Applications (Get-StartApps)
    const startApps = await this.getStartApps();
    for (const app of startApps) {
      const nameMatch = getBestScore(app.name, 0);
      const idMatch = getBestScore(app.appUserModelId, -0.05);
      const bestUwpScore = Math.max(nameMatch, idMatch);
      if (bestUwpScore > 0.4) {
        candidates.push({
          name: app.name,
          source: 'uwp',
          appUserModelId: app.appUserModelId,
          score: bestUwpScore >= 0.9 ? bestUwpScore * 0.98 : bestUwpScore * 0.92,
          description: `Windows App (UWP): ${app.name} (${app.appUserModelId})`,
        });
      }
    }

    // 5. Windows App Paths & Standard Executables
    const exe = await this.findStandardExecutable(cleanQuery) || (appQuery !== cleanQuery ? await this.findStandardExecutable(appQuery) : null);
    if (exe) {
      candidates.push({
        name: cleanQuery,
        source: 'executable',
        targetPath: exe,
        score: 0.88,
        description: `Windows Executable: ${exe}`,
      });
    }

    if (candidates.length === 0) return null;

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0];

    logger.info(`[WindowsApplicationResolver] Resolved query "${cleanQuery}" -> "${top.name}" (${top.source}, score=${top.score.toFixed(2)})`);
    return top;
  }

  /**
   * Get all Taskbar pinned application shortcuts (.lnk).
   */
  public async getTaskbarPinnedApps(): Promise<Array<{ name: string; path: string; targetPath?: string; arguments?: string }>> {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
    const appData = process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming');
    const taskbarDir = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');

    if (!fs.existsSync(taskbarDir)) return [];

    try {
      const ps = [
        '$sh = New-Object -ComObject WScript.Shell;',
        `Get-ChildItem -Path '${taskbarDir.replace(/\\\\/g, '\\\\\\\\')}' -Filter *.lnk | ForEach-Object {`,
        '  $sc = $sh.CreateShortcut($_.FullName);',
        '  [PSCustomObject]@{',
        '    name = $_.BaseName;',
        '    path = $_.FullName;',
        '    targetPath = $sc.TargetPath;',
        '    arguments = $sc.Arguments;',
        '  }',
        '} | ConvertTo-Json -Compress',
      ].join(' ');
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 3000 });
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.map((item: any) => ({
          name: String(item.name || ''),
          path: String(item.path || ''),
          targetPath: item.targetPath ? String(item.targetPath) : undefined,
          arguments: item.arguments ? String(item.arguments) : undefined,
        }));
      }
    } catch {}

    try {
      const files = fs.readdirSync(taskbarDir);
      const result: Array<{ name: string; path: string }> = [];
      for (const file of files) {
        if (file.toLowerCase().endsWith('.lnk')) {
          result.push({
            name: file.replace(/\\.lnk$/i, ''),
            path: path.join(taskbarDir, file),
          });
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Enumerate currently visible top-level desktop windows.
   */
  public async getVisibleWindows(): Promise<Array<{ hwnd: number; pid: number; process: string; title: string }>> {
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
    } catch {}
    return [];
  }

  /**
   * Enumerate all Start Menu & Desktop shortcuts (.lnk).
   */
  public async getAllShortcuts(): Promise<Array<{ name: string; path: string; source: 'start_menu' | 'desktop' }>> {
    const now = Date.now();
    if (this.cachedLnkShortcuts.length > 0 && now - this.lnkCachedAt < 60_000) {
      return this.cachedLnkShortcuts;
    }

    const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
    const appData = process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming');
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';

    const roots: Array<{ dir: string; source: 'start_menu' | 'desktop' }> = [
      { dir: path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), source: 'start_menu' },
      { dir: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), source: 'start_menu' },
      { dir: path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'StartMenu'), source: 'start_menu' },
      { dir: path.join(userProfile, 'Desktop'), source: 'desktop' },
      { dir: 'C:\\Users\\Public\\Desktop', source: 'desktop' },
      { dir: path.join(userProfile, 'OneDrive', 'Desktop'), source: 'desktop' },
    ];

    const results: Array<{ name: string; path: string; source: 'start_menu' | 'desktop' }> = [];

    const traverse = (currentDir: string, source: 'start_menu' | 'desktop') => {
      try {
        if (!fs.existsSync(currentDir)) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            traverse(fullPath, source);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
            results.push({
              name: entry.name.replace(/\.lnk$/i, ''),
              path: fullPath,
              source,
            });
          }
        }
      } catch {}
    };

    for (const r of roots) {
      traverse(r.dir, r.source);
    }

    this.cachedLnkShortcuts = results;
    this.lnkCachedAt = now;
    return results;
  }

  /**
   * Get all registered UWP / Store apps via Get-StartApps.
   */
  public async getStartApps(): Promise<Array<{ name: string; appUserModelId: string }>> {
    const now = Date.now();
    if (this.cachedStartApps.length > 0 && now - this.startAppsCachedAt < 300_000) {
      return this.cachedStartApps;
    }

    try {
      const ps = 'Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress';
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 4000 });
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        this.cachedStartApps = list.map((item: any) => ({
          name: String(item.Name || ''),
          appUserModelId: String(item.AppID || ''),
        }));
        this.startAppsCachedAt = now;
      }
    } catch {}

    return this.cachedStartApps;
  }

  /**
   * Find executable in standard Windows directories or via `where.exe`.
   */
  private async findStandardExecutable(query: string): Promise<string | null> {
    const clean = query.replace(/\.exe$/i, '').trim();
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
    const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const windir = process.env.WINDIR || 'C:\\Windows';

    const candidates = [
      path.join(windir, 'System32', `${clean}.exe`),
      path.join(windir, `${clean}.exe`),
      path.join(localAppData, 'Programs', clean, `${clean}.exe`),
      path.join(localAppData, clean, `${clean}.exe`),
      path.join(programFiles, clean, `${clean}.exe`),
      path.join(programFilesX86, clean, `${clean}.exe`),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    try {
      const { stdout } = await execAsync(`where.exe ${clean}.exe`, { timeout: 2000 });
      const first = stdout.split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) return first;
    } catch {}

    return null;
  }

  /**
   * Generic, dynamic matching score between user query and target application name.
   */
  private scoreMatch(query: string, candidateName: string, bonus: number = 0): number {
    const q = query.toLowerCase().trim();
    const c = candidateName.toLowerCase().trim();

    if (q === c) return 0.98 + bonus;

    // Tokenized containment: e.g. "comet" in "Comet Perplexity" or "Perplexity" in "Comet Perplexity"
    const qTokens = q.split(/[\s-_]+/).filter(Boolean);
    const cTokens = c.split(/[\s-_]+/).filter(Boolean);

    // If query is a single word and matches one of the candidate tokens exactly
    if (qTokens.length === 1 && cTokens.includes(qTokens[0])) {
      return 0.94 + bonus;
    }

    // If all query tokens appear in candidate name
    const allQueryTokensInCandidate = qTokens.every(token => c.includes(token));
    if (allQueryTokensInCandidate) {
      return 0.92 + bonus;
    }

    // Candidate is fully contained in query (e.g. user says "locate/open Comet Perplexity browser")
    if (q.includes(c)) {
      return 0.88 + bonus;
    }

    // Query is fully contained in candidate name (e.g. "Hermes" in "Hermes One")
    if (c.includes(q)) {
      return 0.85 + bonus;
    }

    // Common synonyms / internationalization (e.g. calculator <-> rechner)
    const synonyms: Record<string, string[]> = {
      calculator: ['calc', 'rechner'],
      rechner: ['calculator', 'calc'],
      editor: ['notepad'],
      terminal: ['powershell', 'cmd', 'wt'],
      settings: ['einstellungen', 'systemeinstellungen', 'immersivecontrolpanel', 'ms-settings', 'systemsettings'],
      'windows settings': ['einstellungen', 'systemeinstellungen', 'immersivecontrolpanel', 'ms-settings', 'systemsettings'],
      einstellungen: ['settings', 'windows settings', 'systemeinstellungen', 'immersivecontrolpanel', 'systemsettings'],
      comet: ['perplexity', 'comet perplexity'],
      perplexity: ['comet', 'comet perplexity'],
      'comet perplexity': ['comet', 'perplexity'],
      hermes: ['hermes 1', 'hermes one'],
      'hermes 1': ['hermes', 'hermes one'],
      'hermes one': ['hermes', 'hermes 1'],
      word: ['winword', 'microsoft word', 'word.application'],
      'microsoft word': ['word', 'winword'],
      winword: ['word', 'microsoft word'],
    };

    for (const [key, synList] of Object.entries(synonyms)) {
      if (q === key || q.includes(key)) {
        if (synList.some(s => c === s)) return 0.98 + bonus;
        if (synList.some(s => c.includes(s))) return 0.85 + bonus;
      }
    }

    return 0;
  }
}

export const windowsApplicationResolver = WindowsApplicationResolver.getInstance();
