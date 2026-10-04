/**
 * BrowserCodeSession.ts — Persistent Chrome CDP Session Manager
 *
 * PHASE 7 ARCHITECTURAL COMPONENT
 *
 * Manages persistent CDP connection to Christian's real Chrome session.
 * Exposes core BrowserCode primitives:
 * - Persistent connection lifecycle (health check, auto-reconnect, no stale session reuse)
 * - Tab and page management (listTabs, switchTab, getActivePage)
 * - browser_execute primitive (safe in-page JS evaluation)
 * - Structured DOM & Accessibility Tree extraction (CDP Accessibility.getFullAXTree)
 * - Security redaction of passwords, tokens, cookies, authorization headers
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../../../utils/logger.js';

export interface TabDescriptor {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

export interface ExtractedDOMStructure {
  url: string;
  title: string;
  bodyText: string;
  headings: string[];
  links: { text: string; href: string }[];
  buttons: { text: string; id?: string; ariaLabel?: string }[];
  inputs: { name?: string; placeholder?: string; type?: string; value?: string; id?: string }[];
  interactiveElements: { role: string; name: string; tag: string; selector?: string }[];
}

export class BrowserCodeSession {
  private static instance: BrowserCodeSession;

  private cdpPort: number = 9222;
  private chromeProcess: ChildProcess | null = null;
  private playwrightBrowser: any = null;
  private playwrightContext: any = null;
  private activePage: any = null;
  private cdpClient: any = null;
  private isConnecting: boolean = false;
  private lastHealthCheck: number = 0;

  // Performance telemetry
  public metrics = {
    cdpConnectMs: 0,
    tabResolveMs: 0,
    domQueryMs: 0,
    accessibilityTreeMs: 0,
    jsExecuteMs: 0,
    navigationMs: 0,
    contentExtractionMs: 0,
    verificationMs: 0,
    totalBrowserTaskMs: 0,
  };

  private constructor() {}

  public static getInstance(): BrowserCodeSession {
    if (!BrowserCodeSession.instance) {
      BrowserCodeSession.instance = new BrowserCodeSession();
    }
    return BrowserCodeSession.instance;
  }

  /**
   * Redact sensitive credentials, passwords, session tokens from any object or text.
   */
  public redactSensitive(input: any): any {
    if (typeof input === 'string') {
      return input
        .replace(/(password|secret|bearer\s+[a-zA-Z0-9_\-\.]+)/gi, '[REDACTED]')
        .replace(/([a-zA-Z0-9_\-\.]{24,})/g, (match) => {
          if (match.startsWith('http') || match.startsWith('chrome')) return match;
          return '[REDACTED_TOKEN]';
        });
    }
    if (typeof input === 'object' && input !== null) {
      if (Array.isArray(input)) {
        return input.map((item) => this.redactSensitive(item));
      }
      const redacted: Record<string, any> = {};
      for (const [key, val] of Object.entries(input)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('pass') ||
          lowerKey.includes('token') ||
          lowerKey.includes('cookie') ||
          lowerKey.includes('auth') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('key')
        ) {
          redacted[key] = '[REDACTED]';
        } else {
          redacted[key] = this.redactSensitive(val);
        }
      }
      return redacted;
    }
    return input;
  }

  /**
   * Check if Chrome CDP port is listening.
   */
  public async isPortListening(port: number = this.cdpPort): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Discovers the running real Chrome instance using supported DevTools discovery mechanisms:
   * 1. Inspects DevToolsActivePort in Christian's real Chromium user data directory.
   * 2. Probes active CDP ports (9222, 9223, 9229).
   *
   * STRICT PHASE 7.1 INVARIANTS:
   * - ZERO profile cloning.
   * - ZERO copying of cookies, Login Data, Network files, Local State, or credentials.
   * - ZERO launching with --user-data-dir pointing to default or copied profile.
   */
  public async discoverRealChromeEndpoint(): Promise<{ endpoint: string; port: number } | null> {
    const candidateUserDataDirs = [
      'C:\\Users\\cd-pr\\AppData\\Local\\Google\\Chrome\\User Data',
      'C:\\Users\\cd-pr\\AppData\\Local\\Perplexity\\Comet\\User Data',
    ];

    for (const udir of candidateUserDataDirs) {
      const portFile = path.join(udir, 'DevToolsActivePort');
      if (fs.existsSync(portFile)) {
        try {
          const content = fs.readFileSync(portFile, 'utf8');
          const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length >= 1) {
            const port = parseInt(lines[0], 10);
            if (!isNaN(port) && port > 0 && port <= 65535) {
              if (await this.isPortListening(port)) {
                const wsPath = lines[1] || '';
                const endpoint = wsPath ? `ws://127.0.0.1:${port}${wsPath}` : `http://127.0.0.1:${port}`;
                logger.info(`[BrowserCodeSession] Discovered real Chrome via DevToolsActivePort in ${udir} on port ${port}`);
                return { endpoint, port };
              }
            }
          }
        } catch (err) {
          logger.warn(`[BrowserCodeSession] Error reading DevToolsActivePort in ${udir}:`, err);
        }
      }
    }

    // Probe standard ports
    const portsToProbe = [9222, 9223, 9229];
    for (const port of portsToProbe) {
      if (await this.isPortListening(port)) {
        logger.info(`[BrowserCodeSession] Discovered listening Chrome CDP on port ${port}`);
        return { endpoint: `http://127.0.0.1:${port}`, port };
      }
    }

    return null;
  }

  /**
   * Ensures real Chrome instance is reachable via CDP discovery.
   * STRICT: NEVER spawns Chrome with custom user-data-dir or cloned profiles.
   */
  public async ensureChromeRunning(): Promise<boolean> {
    const discovered = await this.discoverRealChromeEndpoint();
    if (discovered) {
      this.cdpPort = discovered.port;
      return true;
    }
    return false;
  }

  /**
   * Connect or retrieve the persistent Playwright CDP session to Christian's real Chrome instance.
   */
  public async getSession(): Promise<{ browser: any; context: any; page: any }> {
    const t0 = Date.now();

    // Fast check: Is existing activePage valid and open?
    if (this.playwrightBrowser && this.playwrightContext && this.activePage && !this.activePage.isClosed()) {
      try {
        await this.activePage.evaluate('1+1');
        return {
          browser: this.playwrightBrowser,
          context: this.playwrightContext,
          page: this.activePage,
        };
      } catch {
        logger.warn('[BrowserCodeSession] Active page unresponsive, resetting session...');
        await this.resetSession();
      }
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      let attempts = 0;
      while (this.isConnecting && attempts < 20) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      if (this.playwrightBrowser && this.activePage && !this.activePage.isClosed()) {
        return {
          browser: this.playwrightBrowser,
          context: this.playwrightContext,
          page: this.activePage,
        };
      }
    }

    this.isConnecting = true;
    try {
      const discovery = await this.discoverRealChromeEndpoint();
      if (!discovery) {
        throw new Error(
          'Real Chrome remote debugging session not found. Please ensure Chrome is running and remote debugging is enabled at chrome://inspect/#remote-debugging.'
        );
      }

      this.cdpPort = discovery.port;
      const pw = await import('playwright');

      // Connect with 120s timeout to allow Christian comfortable time to click "Zulassen" on the Chrome dialog
      let browser: any = null;
      let lastErr: any = null;
      const connectStart = Date.now();
      logger.info(`[BrowserCodeSession] Connecting over CDP to real Chrome at ${discovery.endpoint}...`);

      try {
        browser = await pw.chromium.connectOverCDP(discovery.endpoint, { timeout: 120000 });
      } catch (err: any) {
        lastErr = err;
      }

      if (!browser) {
        throw new Error(`Failed to connect over CDP to ${discovery.endpoint}: ${lastErr?.message || 'timeout waiting for approval'}`);
      }

      this.playwrightBrowser = browser;
      const contexts = this.playwrightBrowser.contexts();
      this.playwrightContext = contexts[0] || (await this.playwrightBrowser.newContext());

      const pages = this.playwrightContext.pages().filter((p: any) => !p.isClosed());

      // Select active/visible page if possible, otherwise first available
      let frontPage = pages[0];
      for (const p of pages) {
        try {
          const isVisible = await p.evaluate(() => document.visibilityState === 'visible');
          if (isVisible) {
            frontPage = p;
            break;
          }
        } catch {}
      }

      this.activePage = frontPage || (await this.playwrightContext.newPage());
      this.metrics.cdpConnectMs = Date.now() - t0;
      logger.info(
        `[BrowserCodeSession] Attached to real Chrome session at ${discovery.endpoint} (${pages.length} tabs open) in ${this.metrics.cdpConnectMs}ms.`
      );

      return {
        browser: this.playwrightBrowser,
        context: this.playwrightContext,
        page: this.activePage,
      };
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Get low-level CDP client session for active page.
   */
  public async getCDPClient(): Promise<any> {
    const { page } = await this.getSession();
    if (!this.cdpClient || this.cdpClient._closed) {
      this.cdpClient = await page.context().newCDPSession(page);
    }
    return this.cdpClient;
  }

  /**
   * Open a new browser tab with optional URL.
   */
  public async openNewTab(url: string = 'about:blank'): Promise<TabDescriptor> {
    const { context } = await this.getSession();
    const page = await context.newPage();
    if (url && url !== 'about:blank') {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch (err: any) {
        logger.warn('[BrowserCodeSession] openNewTab navigation error:', err?.message);
      }
    }
    this.activePage = page;
    this.cdpClient = null;
    const title = (await page.title()) || 'New Tab';
    return {
      id: `tab-${context.pages().indexOf(page)}`,
      title,
      url: page.url(),
      active: true,
    };
  }

  /**
   * List all open browser tabs.
   */
  public async listTabs(): Promise<readonly TabDescriptor[]> {
    const t0 = Date.now();
    try {
      const { context } = await this.getSession();
      const pages = context.pages().filter((p: any) => !p.isClosed());
      const tabs: TabDescriptor[] = [];

      // Check which page is currently visible to ensure live continuity
      let activeVisiblePage = this.activePage;
      for (const page of pages) {
        try {
          const isVisible = await page.evaluate(() => document.visibilityState === 'visible');
          if (isVisible) {
            activeVisiblePage = page;
            this.activePage = page;
            break;
          }
        } catch {}
      }

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        let title = '';
        let url = '';
        try {
          title = await page.title();
          url = page.url();
        } catch {}
        tabs.push({
          id: `tab-${i}`,
          title: title || 'Untitled Tab',
          url: url || 'about:blank',
          active: page === activeVisiblePage,
        });
      }

      this.metrics.tabResolveMs = Date.now() - t0;
      return tabs;
    } catch (err) {
      logger.error('[BrowserCodeSession] listTabs error:', err);
      return [];
    }
  }

  /**
   * Switch to a tab matching the target filter (URL, domain, or title).
   */
  public async switchTab(target: string): Promise<TabDescriptor | null> {
    const t0 = Date.now();
    const cleanTarget = target.toLowerCase().trim();
    const { context } = await this.getSession();
    const pages = context.pages().filter((p: any) => !p.isClosed());

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let title = '';
      let url = '';
      try {
        title = await page.title();
        url = page.url();
      } catch {}

      const match =
        url.toLowerCase().includes(cleanTarget) ||
        title.toLowerCase().includes(cleanTarget) ||
        cleanTarget.includes(url.toLowerCase());

      if (match) {
        await page.bringToFront();
        this.activePage = page;
        this.cdpClient = null; // Rebind CDP client for new active page
        this.metrics.tabResolveMs = Date.now() - t0;
        logger.info(`[BrowserCodeSession] Switched active tab to ${title} (${url}) in ${this.metrics.tabResolveMs}ms.`);
        return {
          id: `tab-${i}`,
          title,
          url,
          active: true,
        };
      }
    }

    this.metrics.tabResolveMs = Date.now() - t0;
    logger.warn(`[BrowserCodeSession] Could not find tab matching target '${target}'.`);
    return null;
  }

  /**
   * Direct simple navigation (Speed 1).
   */
  public async navigate(url: string, timeoutMs: number = 10000): Promise<{ success: boolean; url: string; title: string; durationMs: number }> {
    const t0 = Date.now();
    const { page } = await this.getSession();

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      const currentUrl = page.url();
      const title = await page.title();
      const durationMs = Date.now() - t0;
      this.metrics.navigationMs = durationMs;

      logger.info(`[BrowserCodeSession] Navigated to ${currentUrl} ('${title}') in ${durationMs}ms.`);
      return {
        success: true,
        url: currentUrl,
        title,
        durationMs,
      };
    } catch (navErr: any) {
      const durationMs = Date.now() - t0;
      this.metrics.navigationMs = durationMs;
      logger.error('[BrowserCodeSession] Navigation error:', navErr);
      return {
        success: false,
        url: page.url(),
        title: '',
        durationMs,
      };
    }
  }

  /**
   * browser_execute primitive: Safe JavaScript evaluation in active page.
   */
  public async executeScript<T = any>(script: string, timeoutMs: number = 5000): Promise<T> {
    const t0 = Date.now();
    const { page } = await this.getSession();

    try {
      const result = await Promise.race([
        page.evaluate(script),
        new Promise((_, reject) => setTimeout(() => reject(new Error('browser_execute timeout')), timeoutMs)),
      ]);
      this.metrics.jsExecuteMs = Date.now() - t0;
      return result as T;
    } catch (err: any) {
      this.metrics.jsExecuteMs = Date.now() - t0;
      logger.error('[BrowserCodeSession] browser_execute error:', err);
      throw err;
    }
  }

  /**
   * Extract Accessibility Tree via CDP Accessibility.getFullAXTree.
   */
  public async getAccessibilityTree(): Promise<{ nodes: any[]; summary: string }> {
    const t0 = Date.now();
    try {
      const client = await this.getCDPClient();
      const result = await client.send('Accessibility.getFullAXTree');
      const nodes = result?.nodes || [];

      // Build concise semantic summary from high-level nodes
      const semanticSummary = nodes
        .filter((n: any) => n.role?.value && ['heading', 'link', 'button', 'textbox', 'main', 'article'].includes(n.role.value))
        .slice(0, 30)
        .map((n: any) => `[${n.role.value}] ${n.name?.value || ''}`)
        .filter((s: string) => s.length > 3)
        .join(' | ');

      this.metrics.accessibilityTreeMs = Date.now() - t0;
      return {
        nodes,
        summary: semanticSummary,
      };
    } catch (err: any) {
      this.metrics.accessibilityTreeMs = Date.now() - t0;
      logger.warn('[BrowserCodeSession] getAccessibilityTree error:', err?.message);
      return { nodes: [], summary: '' };
    }
  }

  /**
   * Structured DOM Query: Extracts clean, readable text and interactive elements.
   */
  public async extractStructuredDOM(): Promise<ExtractedDOMStructure> {
    const t0 = Date.now();
    const { page } = await this.getSession();

    const result = await page.evaluate(() => {
      const url = window.location.href;
      const title = document.title;

      // Extract main readable content
      const contentEl = document.querySelector('main, article, #content, [role="main"]') || document.body;
      const bodyText = (contentEl?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);

      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => (h.textContent || '').trim())
        .filter((t) => t.length > 0)
        .slice(0, 10);

      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((a: any) => ({ text: (a.textContent || '').trim(), href: a.href }))
        .filter((l) => l.text.length > 0 && !l.href.startsWith('javascript:'))
        .slice(0, 20);

      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
        .map((b: any) => ({
          text: (b.textContent || b.value || b.getAttribute('aria-label') || '').trim(),
          id: b.id || undefined,
          ariaLabel: b.getAttribute('aria-label') || undefined,
        }))
        .filter((b) => b.text.length > 0)
        .slice(0, 20);

      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
        .map((inp: any) => {
          const type = (inp.type || '').toLowerCase();
          return {
            name: inp.name || undefined,
            placeholder: inp.placeholder || undefined,
            type: inp.type || undefined,
            value: type === 'password' ? '[REDACTED]' : inp.value ? String(inp.value).slice(0, 100) : undefined,
            id: inp.id || undefined,
          };
        })
        .slice(0, 15);

      const interactiveElements = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]'))
        .map((el: any) => ({
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: (el.textContent || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 80),
          tag: el.tagName.toLowerCase(),
        }))
        .filter((el) => el.name.length > 0)
        .slice(0, 30);

      return {
        url,
        title,
        bodyText,
        headings,
        links,
        buttons,
        inputs,
        interactiveElements,
      };
    });

    this.metrics.domQueryMs = Date.now() - t0;
    return this.redactSensitive(result);
  }

  /**
   * Capture screenshot of current active page.
   */
  public async captureScreenshot(): Promise<string> {
    const { page } = await this.getSession();
    const buffer = await page.screenshot({ type: 'png' });
    return buffer.toString('base64');
  }

  /**
   * Reset or refresh session state.
   */
  public async resetSession(): Promise<void> {
    this.cdpClient = null;
    this.activePage = null;
    this.playwrightContext = null;
    if (this.playwrightBrowser) {
      try {
        await this.playwrightBrowser.close();
      } catch {}
      this.playwrightBrowser = null;
    }
  }
}

export const browserCodeSession = BrowserCodeSession.getInstance();
