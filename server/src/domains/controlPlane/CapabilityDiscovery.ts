/**
 * CapabilityDiscovery.ts — General Capability Discovery Layer
 *
 * Implements Section 3 & Section 9:
 * Searches across available execution surfaces to discover how to complete an arbitrary goal:
 * - Internal AgenticOS capabilities (projects, tools, memory, system)
 * - Start Menu shortcuts & Desktop shortcuts (.lnk)
 * - Windows executables & Program Files / AppData
 * - AppUserModelIDs (Windows Store / UWP apps)
 * - Running processes and active windows
 * - Browser URLs, PWAs, and web entities
 * - Shell / PowerShell commands & protocol handlers
 * - Reusable RepairKnowledge
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { repairKnowledgeStore } from './RepairKnowledgeStore.js';
import { projectsStore } from '../../services/projectsStore.js';
import { windowsApplicationResolver } from './WindowsApplicationResolver.js';
import type { DiscoveredCapability } from './types.js';

const execAsync = promisify(exec);

export class CapabilityDiscovery {
  private static instance: CapabilityDiscovery;
  private startAppsCache: Array<{ name: string; appUserModelId: string }> = [];
  private startAppsCachedAt: number = 0;
  private lnkCache: Array<{ name: string; path: string }> = [];
  private lnkCachedAt: number = 0;

  private constructor() {}

  public static getInstance(): CapabilityDiscovery {
    if (!CapabilityDiscovery.instance) {
      CapabilityDiscovery.instance = new CapabilityDiscovery();
    }
    return CapabilityDiscovery.instance;
  }

  /**
   * Main entry point: Discover how to execute a target or action across all execution surfaces.
   */
  public async discover(target: string, actionType: string = 'open'): Promise<DiscoveredCapability[]> {
    const cleanTarget = (target || '')
      .replace(/^(?:open|launch|start|run|locate|find|show|search\s+for)\s+/i, '')
      .replace(/\s+(?:app|application|program|tool)$/i, '')
      .trim();

    if (!cleanTarget) return [];

    const candidates: DiscoveredCapability[] = [];
    const lower = cleanTarget.toLowerCase();

    // 0. Check learned RepairKnowledge first (Section 10)
    const learned = repairKnowledgeStore.lookupResolution(cleanTarget, actionType);
    if (learned) {
      candidates.push({
        id: `learned-${learned.target}`,
        name: learned.target,
        surface: 'learned',
        target: learned.executablePath || learned.url || learned.resolvedCommand || learned.target,
        executablePath: learned.executablePath,
        url: learned.url,
        score: 0.99,
        description: `Learned resolution from previous successful recovery (${learned.surface})`,
        parameters: learned.parameters,
      });
    }

    // 0b. Check Camera Perception Capability (Section 13)
    if (lower.includes('camera') || lower.includes('see me') || lower.includes('holding') || actionType === 'perceive') {
      candidates.push({
        id: 'cap-camera-perceive',
        name: 'Camera Perception',
        surface: 'camera',
        target: 'camera.perceive',
        score: 0.98,
        description: 'Jarvis Camera Visual Perception: inspects active camera frame, grounded visual answers',
        parameters: { capability: 'camera.perceive', prompt: cleanTarget },
      });
    }

    // 0c. Check Location Capability (Section 14)
    if (lower.includes('location') || lower.includes('where am i') || lower.includes('coordinates') || actionType === 'read_location') {
      candidates.push({
        id: 'cap-location-read',
        name: 'Location Access',
        surface: 'location',
        target: 'location.read',
        score: 0.98,
        description: 'Jarvis Location Capability: reads current verified geographic coordinates & city',
        parameters: { capability: 'location.read' },
      });
    }

    // 0d. Check Desktop Observation Capability (desktop.observe)
    if (actionType === 'observe' || lower.includes('what is inside') || lower.includes('inside') || lower.includes('on my screen') || lower.includes('read what is inside') || lower.includes('inspect window')) {
      candidates.push({
        id: 'cap-desktop-observe',
        name: 'Desktop Perception',
        surface: 'desktop_observe',
        target: cleanTarget,
        score: 0.99,
        description: 'Jarvis Desktop Perception: inspects active window and desktop content via UI Automation',
        parameters: { capability: 'desktop.observe', targetWindow: cleanTarget },
      });
    }

    // 0e. Check Screen Capture Capability (screen.capture)
    if (actionType === 'capture_screenshot' || lower.includes('screenshot') || lower.includes('snapshot') || lower.includes('capture screen')) {
      candidates.push({
        id: 'cap-screen-capture',
        name: 'Screen Capture',
        surface: 'screenshot',
        target: cleanTarget,
        score: 0.99,
        description: 'Jarvis Screen Capture: produces real verifiable image artifact of window or desktop',
        parameters: { capability: 'screen.capture', targetWindow: cleanTarget },
      });
    }

    // 0f. Authoritative Windows Application Resolution (Taskbar, Start Menu, Desktop, UWP, Executables)
    try {
      const appMatch = await windowsApplicationResolver.resolve(cleanTarget, { actionType });
      if (appMatch) {
        const surfaceName = appMatch.source === 'taskbar' ? 'taskbar' : (appMatch.source === 'uwp' ? 'app_user_model_id' : (appMatch.source === 'executable' ? 'executable' : (appMatch.source === 'running_window' ? 'process' : 'start_menu')));
        candidates.push({
          id: `win-app-${appMatch.source}-${appMatch.name}`,
          name: appMatch.name,
          surface: surfaceName,
          target: appMatch.targetPath || appMatch.shortcutPath || appMatch.appUserModelId || appMatch.processName || appMatch.name,
          shortcutPath: appMatch.shortcutPath,
          executablePath: appMatch.targetPath,
          appUserModelId: appMatch.appUserModelId,
          processName: appMatch.processName,
          score: appMatch.score,
          description: appMatch.description,
          parameters: {
            appUserModelId: appMatch.appUserModelId,
            shortcutPath: appMatch.shortcutPath,
            executablePath: appMatch.targetPath,
            pid: appMatch.pid,
            processName: appMatch.processName,
          },
        });
      }
    } catch {}

    // 1. Check Internal AgenticOS Capabilities (Projects, etc.)
    try {
      const allProjects = projectsStore.listProjects();
      for (const p of allProjects) {
        if (p.name.toLowerCase() === lower || p.id.toLowerCase() === lower || p.name.toLowerCase().includes(lower)) {
          candidates.push({
            id: `proj-${p.id}`,
            name: p.name,
            surface: 'internal',
            target: p.id,
            score: p.name.toLowerCase() === lower ? 0.95 : 0.85,
            description: `AgenticOS Internal Project: ${p.name}`,
            parameters: { entityType: 'project', entityId: p.id, entityName: p.name },
          });
        }
      }
    } catch {}

    // 2. Check running processes & active windows
    if (process.platform === 'win32') {
      try {
        const running = await this.findRunningProcesses(lower);
        for (const proc of running) {
          candidates.push({
            id: `proc-${proc.pid}`,
            name: proc.processName,
            surface: 'process',
            target: proc.processName,
            processName: proc.processName,
            score: 0.92,
            description: `Active running process: ${proc.processName} (${proc.windowTitle || 'background'})`,
            parameters: { pid: proc.pid, windowTitle: proc.windowTitle },
          });
        }
      } catch {}
    }

    // 3. Check Start Menu & Desktop Shortcuts (.lnk)
    if (process.platform === 'win32') {
      const shortcuts = await this.findShortcuts(lower);
      for (const sc of shortcuts) {
        candidates.push({
          id: `lnk-${path.basename(sc.path)}`,
          name: sc.name,
          surface: 'start_menu',
          target: sc.path,
          shortcutPath: sc.path,
          score: sc.name.toLowerCase() === lower ? 0.90 : 0.80,
          description: `Windows Shortcut: ${sc.name} (${sc.path})`,
        });
      }
    }

    // 4. Check Windows AppUserModelIDs (Store / UWP Apps like Calculator, Camera, etc.)
    if (process.platform === 'win32') {
      const startApps = await this.findStartApps(lower);
      for (const app of startApps) {
        candidates.push({
          id: `uwp-${app.appUserModelId}`,
          name: app.name,
          surface: 'app_user_model_id',
          target: app.appUserModelId,
          appUserModelId: app.appUserModelId,
          score: app.name.toLowerCase() === lower ? 0.88 : 0.78,
          description: `Windows App (AppUserModelID): ${app.name}`,
        });
      }
    }

    // 5. Check Known/Installed Windows Executables (AppData, Program Files, PATH)
    if (process.platform === 'win32') {
      const exe = await this.findExecutable(lower);
      if (exe) {
        candidates.push({
          id: `exe-${path.basename(exe)}`,
          name: cleanTarget,
          surface: 'executable',
          target: exe,
          executablePath: exe,
          score: 0.85,
          description: `Windows Executable: ${exe}`,
        });
      }
    }

    // 6. Check Web / Browser Surfaces (Websites, search queries, web apps)
    const webCandidate = this.resolveBrowserCandidate(cleanTarget);
    if (webCandidate) {
      candidates.push(webCandidate);
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  private resolveBrowserCandidate(target: string): DiscoveredCapability | null {
    const lower = target.toLowerCase().trim();

    // Check specific known browser targets or URLs
    if (/^https?:\/\//i.test(target)) {
      return {
        id: `web-url-${target}`,
        name: target,
        surface: 'browser',
        target,
        url: target,
        score: 0.95,
        description: `Direct Browser URL: ${target}`,
      };
    }

    if (lower === 'youtube' || lower.startsWith('youtube')) {
      const queryMatch = target.match(/youtube\s+(?:for|search\s+for|locate\s+)?(.+)/i);
      const url = queryMatch && queryMatch[1].trim()
        ? `https://youtube.com/results?search_query=${encodeURIComponent(queryMatch[1].trim())}`
        : 'https://youtube.com';
      return {
        id: 'web-youtube',
        name: 'YouTube',
        surface: 'browser',
        target: url,
        url,
        score: 0.89,
        description: `YouTube Web Application: ${url}`,
      };
    }

    // Generalized platform search: "<query> on/in <platform>"
    const platformSearchMatch = target.match(/^(.+?)\s+(?:on|in)\s+(youtube|google|github|reddit|amazon|wikipedia|bing)$/i);
    if (platformSearchMatch) {
      const query = platformSearchMatch[1].replace(/^(?:search|locate|find|look up)\s+(?:for\s+)?/i, '').trim();
      const platform = platformSearchMatch[2].toLowerCase();
      let url = '';
      if (platform === 'youtube') url = `https://youtube.com/results?search_query=${encodeURIComponent(query)}`;
      else if (platform === 'google') url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      else if (platform === 'github') url = `https://github.com/search?q=${encodeURIComponent(query)}`;
      else if (platform === 'reddit') url = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
      else if (platform === 'amazon') url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
      else if (platform === 'wikipedia') url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`;
      else if (platform === 'bing') url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      if (url) {
        return {
          id: `web-${platform}-${encodeURIComponent(query)}`,
          name: `${query} on ${platformSearchMatch[2]}`,
          surface: 'browser',
          target: url,
          url,
          score: 0.98,
          description: `${platformSearchMatch[2]} Search for ${query}`,
        };
      }
    }

    if (lower === 'chatgpt' || lower === 'chat gpt') {
      return {
        id: 'web-chatgpt',
        name: 'ChatGPT',
        surface: 'browser',
        target: 'https://chatgpt.com',
        url: 'https://chatgpt.com',
        score: 0.89,
        description: 'ChatGPT Web Application (chatgpt.com)',
      };
    }

    if (lower === 'perplexity' || lower === 'perplexity ai') {
      return {
        id: 'web-perplexity',
        name: 'Perplexity',
        surface: 'browser',
        target: 'https://perplexity.ai',
        url: 'https://perplexity.ai',
        score: 0.82,
        description: 'Perplexity AI Web Search',
      };
    }

    if (/\.(com|org|io|ai|net|gov|edu|co)\b/i.test(target)) {
      const url = target.startsWith('http') ? target : `https://${target}`;
      return {
        id: `web-domain-${target}`,
        name: target,
        surface: 'browser',
        target: url,
        url,
        score: 0.85,
        description: `Web Target: ${url}`,
      };
    }

    return null;
  }

  private async findRunningProcesses(query: string): Promise<Array<{ pid: number; processName: string; windowTitle: string }>> {
    try {
      const ps = `Get-Process | Where-Object { $_.MainWindowTitle -or $_.ProcessName } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json`;
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 3000 });
      if (!stdout.trim()) return [];
      const data = JSON.parse(stdout);
      const list = Array.isArray(data) ? data : [data];
      const results: Array<{ pid: number; processName: string; windowTitle: string }> = [];

      for (const item of list) {
        const procName = String(item.ProcessName || '').toLowerCase();
        const title = String(item.MainWindowTitle || '').toLowerCase();
        if (procName.includes(query) || title.includes(query)) {
          results.push({
            pid: Number(item.Id),
            processName: item.ProcessName,
            windowTitle: item.MainWindowTitle || '',
          });
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  private async findShortcuts(query: string): Promise<Array<{ name: string; path: string }>> {
    const now = Date.now();
    if (this.lnkCache.length === 0 || now - this.lnkCachedAt > 60_000) {
      this.lnkCache = [];
      const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
      const roots = [
        path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
        path.join(process.env.APPDATA || path.join(userProfile, 'AppData\\Roaming'), 'Microsoft\\Windows\\Start Menu\\Programs'),
        path.join(userProfile, 'Desktop'),
        path.join(userProfile, 'OneDrive\\Desktop'),
      ];

      for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        try {
          const collect = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              const full = path.join(dir, e.name);
              if (e.isDirectory()) {
                collect(full);
              } else if (e.isFile() && e.name.toLowerCase().endsWith('.lnk')) {
                const name = e.name.replace(/\.lnk$/i, '');
                this.lnkCache.push({ name, path: full });
              }
            }
          };
          collect(root);
        } catch {}
      }
      this.lnkCachedAt = now;
    }

    return this.lnkCache.filter(item => item.name.toLowerCase().includes(query));
  }

  private getAliases(query: string): string[] {
    const q = query.toLowerCase().trim();
    const map: Record<string, string[]> = {
      calculator: ['calc', 'rechner', 'calculator'],
      rechner: ['calc', 'calculator', 'rechner'],
      paint: ['mspaint', 'paint'],
      notepad: ['notepad', 'editor'],
      terminal: ['wt', 'windowsterminal', 'powershell', 'cmd'],
      cmd: ['cmd', 'powershell', 'wt'],
      explorer: ['explorer', 'fileexplorer'],
      browser: ['chrome', 'msedge', 'edge', 'firefox'],
      settings: ['ms-settings', 'control'],
    };
    const aliases = map[q] || [];
    return Array.from(new Set([q, ...aliases]));
  }

  private async findStartApps(query: string): Promise<Array<{ name: string; appUserModelId: string }>> {
    const now = Date.now();
    if (this.startAppsCache.length === 0 || now - this.startAppsCachedAt > 300_000) {
      try {
        const ps = `Get-StartApps | Select-Object Name, AppID | ConvertTo-Json`;
        const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 4000 });
        if (stdout.trim()) {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          this.startAppsCache = list.map((item: any) => ({
            name: String(item.Name || ''),
            appUserModelId: String(item.AppID || ''),
          }));
          this.startAppsCachedAt = now;
        }
      } catch {
        this.startAppsCache = [];
      }
    }

    const terms = this.getAliases(query);
    return this.startAppsCache.filter(app => {
      const name = app.name.toLowerCase();
      const id = app.appUserModelId.toLowerCase();
      return terms.some(t => name.includes(t) || id.includes(t));
    });
  }

  private async findExecutable(query: string): Promise<string | null> {
    const terms = this.getAliases(query.replace(/\.exe$/i, ''));
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
    const windir = process.env.WINDIR || 'C:\\Windows';

    for (const clean of terms) {
      const testPaths = [
        path.join(windir, 'System32', `${clean}.exe`),
        path.join(windir, `${clean}.exe`),
        path.join(userProfile, 'AppData\\Local\\Programs', clean, `${clean}.exe`),
        path.join(userProfile, 'AppData\\Local', clean, `${clean}.exe`),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', clean, `${clean}.exe`),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', clean, `${clean}.exe`),
      ];

      for (const p of testPaths) {
        if (fs.existsSync(p)) return p;
      }

      // Try `where.exe`
      try {
        const { stdout } = await execAsync(`where.exe ${clean}.exe`, { timeout: 2000 });
        const first = stdout.split(/\r?\n/)[0]?.trim();
        if (first && fs.existsSync(first)) return first;
      } catch {}
    }

    return null;
  }
}

export const capabilityDiscovery = CapabilityDiscovery.getInstance();
