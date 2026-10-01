/**
 * browserSession.ts — Canonical Browser Session Ownership & Window State.
 *
 * Requirements:
 * - Distinguish VISIBLE_USER_BROWSER vs BACKGROUND_BROWSER.
 * - Track canonical session object: sessionId, browserType, visibility, windowHandle,
 *   pageId, currentUrl, currentTitle, foreground status, lastAction, verification state.
 * - Bind follow-up commands (search, click, open the channel, go back) to the active session.
 * - Provide Win32 window focus & restoration to ensure visible browser is brought to front.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { logger } from '../../utils/logger.js';
import type { Page, Browser, BrowserContext } from 'playwright';

export type BrowserMode = 'VISIBLE_USER_BROWSER' | 'BACKGROUND_BROWSER';

export interface CanonicalBrowserSession {
  sessionId: string;
  browserType: 'system_chrome' | 'system_edge' | 'playwright_chromium';
  visibility: 'visible' | 'background';
  windowHandle: number | null;
  activePageId: string;
  currentUrl: string;
  currentTitle: string;
  isForeground: boolean;
  isMinimized: boolean;
  lastAction: string;
  verificationState: 'verified' | 'unverified' | 'failed';
  createdAt: number;
  lastActiveAt: number;
}

export interface WindowInspectionResult {
  windowHandle: number | null;
  title: string;
  isVisible: boolean;
  isMinimized: boolean;
  isForeground: boolean;
}

export interface InspectWindowOptions {
  windowHandle?: number | null;
  processId?: number | null;
  titleKeyword?: string;
}

/**
 * Native Win32 window controller using lightweight PowerShell interop.
 */
export class WindowsBrowserWindowHelper {
  private static runPowerShell(script: string, timeoutMs = 8000): string {
    const tmpFile = path.join(os.tmpdir(), `agenticos_ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ps1`);
    try {
      fs.writeFileSync(tmpFile, script, 'utf8');
      const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile], {
        encoding: 'utf-8',
        timeout: timeoutMs,
      });
      return out.trim();
    } catch (err: any) {
      logger.debug('[WindowsBrowserWindowHelper] runPowerShell error:', err?.message);
      return '';
    } finally {
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {}
    }
  }

  public static inspectWindow(
    target?: number | InspectWindowOptions | null,
    titleKeyword?: string,
  ): WindowInspectionResult {
    try {
      let windowHandle: number | null = null;
      let processId: number | null = null;
      let kw = titleKeyword || '';

      if (typeof target === 'object' && target !== null) {
        windowHandle = target.windowHandle ?? null;
        processId = target.processId ?? null;
        kw = target.titleKeyword || kw;
      } else if (typeof target === 'number') {
        windowHandle = target;
      }

      const cleanKw = (kw || '').replace(/"/g, '');
      const psScript = `
$csharp = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class NativeBrowserWindowFinder {
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumProc proc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);

    [DllImport("user32.dll")]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenDesktop(string lpszDesktop, int dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    private static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    public static string Inspect(long targetHwnd, uint targetPid, string titleKeyword) {
        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk != IntPtr.Zero) {
            SetThreadDesktop(hDesk);
        }
        IntPtr fg = GetForegroundWindow();

        // 1. Direct HWND lookup
        if (targetHwnd != 0) {
            IntPtr h = (IntPtr)targetHwnd;
            if (IsWindow(h)) {
                StringBuilder sb = new StringBuilder(512);
                GetWindowText(h, sb, 512);
                uint p = 0;
                GetWindowThreadProcessId(h, out p);
                bool vis = IsWindowVisible(h);
                bool min = IsIconic(h);
                bool isFg = (h == fg);
                string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString()));
                return ("{ 'Handle': " + h.ToInt64() + ", 'Pid': " + p + ", 'TitleB64': '" + b64 + "', 'IsVisible': " + (vis ? "true" : "false") + ", 'IsMinimized': " + (min ? "true" : "false") + ", 'IsForeground': " + (isFg ? "true" : "false") + " }").Replace((char)39, (char)34);
            }
        }

        // 2. EnumWindows in pure C#
        string found = null;
        string kw = (titleKeyword ?? "").ToLower();

        EnumProc proc = (hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;

            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            string title = sb.ToString();
            if (string.IsNullOrEmpty(title)) return true;

            StringBuilder clsSb = new StringBuilder(256);
            GetClassName(hWnd, clsSb, 256);
            string cls = clsSb.ToString();

            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);

            string pName = "";
            try {
                pName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLower();
            } catch {}

            if (pName.Contains("antigravity") || pName.Contains("electron") || pName.Contains("code") || title.ToLower().Contains("antigravity")) {
                return true;
            }

            bool matches = false;
            if (targetPid != 0 && pid == targetPid) {
                if (title != "Automatische Untertitel" && title != "Seiten wiederherstellen?" && title != "Restore pages?" && title != "Restore pages") {
                    matches = true;
                }
            }
            if (!matches && targetPid == 0) {
                bool isGeneric = (string.IsNullOrEmpty(kw) || kw == "chrome" || kw == "edge" || kw == "browser");
                if (isGeneric) {
                    if (pName == "chrome" || pName == "msedge") {
                        if (title != "Automatische Untertitel" && title != "Seiten wiederherstellen?" && title != "Restore pages?" && title != "Restore pages") {
                            matches = true;
                        }
                    }
                } else {
                    if ((pName == "chrome" || pName == "msedge") && title.ToLower().Contains(kw)) {
                        matches = true;
                    }
                }
            }

            if (matches) {
                bool min = IsIconic(hWnd);
                string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(title));
                found = ("{ 'Handle': " + hWnd.ToInt64() + ", 'Pid': " + pid + ", 'TitleB64': '" + b64 + "', 'IsVisible': " + (IsWindowVisible(hWnd) ? "true" : "false") + ", 'IsMinimized': " + (min ? "true" : "false") + ", 'IsForeground': " + (GetForegroundWindow() == hWnd ? "true" : "false") + " }").Replace((char)39, (char)34);
                return false; // stop enumeration
            }
            return true;
        };

        EnumWindows(proc, IntPtr.Zero);
        if (found == null && hDesk != IntPtr.Zero) {
            EnumDesktopWindows(hDesk, proc, IntPtr.Zero);
        }

        return found ?? "{}";
    }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'NativeBrowserWindowFinder').Type) {
    Add-Type -TypeDefinition $csharp
}
[NativeBrowserWindowFinder]::Inspect(${windowHandle || 0}, ${processId || 0}, "${cleanKw}")
`;
      const out = this.runPowerShell(psScript);
      const parsed = JSON.parse(out || '{}');
      let title = '';
      if (parsed.TitleB64) {
        title = Buffer.from(parsed.TitleB64, 'base64').toString('utf8');
      }
      return {
        windowHandle: parsed.Handle ?? null,
        title,
        isVisible: Boolean(parsed.IsVisible),
        isMinimized: Boolean(parsed.IsMinimized),
        isForeground: Boolean(parsed.IsForeground),
      };
    } catch (err: any) {
      logger.debug('[WindowsBrowserWindowHelper] inspectWindow error:', err?.message);
      return {
        windowHandle: null,
        title: '',
        isVisible: false,
        isMinimized: false,
        isForeground: false,
      };
    }
  }

  public static bringToForeground(windowHandle?: number | null, titleKeyword?: string, processId?: number | null): boolean {
    try {
      const cleanKw = (titleKeyword || 'Chrome').replace(/"/g, '');
      const psScript = `
$csharp = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class NativeBrowserWindowFocus {
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumProc proc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenDesktop(string lpszDesktop, int dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    private static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    private const int SW_RESTORE = 9;
    private const int SW_SHOW = 5;

    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    public static bool Focus(long targetHwnd, uint targetPid, string titleKeyword) {
        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk != IntPtr.Zero) {
            SetThreadDesktop(hDesk);
        }

        IntPtr h = (IntPtr)targetHwnd;

        if (h == IntPtr.Zero || !IsWindow(h)) {
            string kw = (titleKeyword ?? "chrome").ToLower();
            EnumProc proc = (hWnd, lParam) => {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, 512);
                string title = sb.ToString();
                if (string.IsNullOrEmpty(title)) return true;

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string pName = "";
                try {
                    pName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLower();
                } catch {}

                if (pName.Contains("antigravity") || pName.Contains("electron") || pName.Contains("code") || title.ToLower().Contains("antigravity")) {
                    return true;
                }

                if (title == "Automatische Untertitel" || title == "Seiten wiederherstellen?" || title == "Restore pages") {
                    return true;
                }

                if (targetPid != 0 && pid == targetPid) {
                    h = hWnd;
                    return false;
                }

                if (targetPid == 0 && (pName == "chrome" || pName == "msedge")) {
                    if (string.IsNullOrEmpty(kw) || kw == "chrome" || kw == "edge" || kw == "browser" || title.ToLower().Contains(kw)) {
                        h = hWnd;
                        return false;
                    }
                }
                return true;
            };

            EnumWindows(proc, IntPtr.Zero);
            if ((h == IntPtr.Zero || !IsWindow(h)) && hDesk != IntPtr.Zero) {
                EnumDesktopWindows(hDesk, proc, IntPtr.Zero);
            }
        }

        if (h != IntPtr.Zero && IsWindow(h)) {
            if (IsIconic(h)) {
                ShowWindow(h, SW_RESTORE);
            } else {
                ShowWindow(h, SW_SHOW);
            }
            keybd_event(0x12, 0, 0, 0); // Alt down
            SetForegroundWindow(h);
            keybd_event(0x12, 0, 2, 0); // Alt up
            return true;
        }
        return false;
    }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'NativeBrowserWindowFocus').Type) {
    Add-Type -TypeDefinition $csharp
}
$res = [NativeBrowserWindowFocus]::Focus(${windowHandle || 0}, ${processId || 0}, "${cleanKw}")
if ($res) { "OK" } else { "FAIL" }
`;
      const out = this.runPowerShell(psScript);
      return out.includes('OK');
    } catch (err: any) {
      logger.debug('[WindowsBrowserWindowHelper] bringToForeground error:', err?.message);
      return false;
    }
  }
}

export class BrowserSessionManager {
  private static instance: BrowserSessionManager;
  private activeSession: CanonicalBrowserSession | null = null;
  private activePlaywrightPage: Page | null = null;
  private activePlaywrightBrowser: Browser | null = null;
  private activePlaywrightContext: BrowserContext | null = null;

  public static getInstance(): BrowserSessionManager {
    if (!BrowserSessionManager.instance) {
      BrowserSessionManager.instance = new BrowserSessionManager();
    }
    return BrowserSessionManager.instance;
  }

  public getSession(): CanonicalBrowserSession | null {
    return this.activeSession;
  }

  public getActivePage(): Page | null {
    if (this.activePlaywrightPage && !this.activePlaywrightPage.isClosed()) {
      return this.activePlaywrightPage;
    }
    return null;
  }

  public setSession(
    session: CanonicalBrowserSession,
    page: Page,
    browser?: Browser | null,
    context?: BrowserContext | null
  ): void {
    this.activeSession = { ...session, lastActiveAt: Date.now() };
    this.activePlaywrightPage = page;
    if (browser) this.activePlaywrightBrowser = browser;
    if (context) this.activePlaywrightContext = context;
  }

  public updateSession(patch: Partial<CanonicalBrowserSession>): CanonicalBrowserSession | null {
    if (!this.activeSession) return null;
    this.activeSession = {
      ...this.activeSession,
      ...patch,
      lastActiveAt: Date.now(),
    };
    return this.activeSession;
  }

  public clearSession(): void {
    this.activeSession = null;
    this.activePlaywrightPage = null;
    this.activePlaywrightBrowser = null;
    this.activePlaywrightContext = null;
  }
}

export const browserSessionManager = BrowserSessionManager.getInstance();
