/**
 * IBrowserComputerUseProvider.ts — Authoritative Interface for Browser Intelligence & Automation
 *
 * PHASE 7 ARCHITECTURAL COMPONENT
 *
 * Subordinate interface for autonomous browser navigation using BrowserCode / CDP primitives.
 *
 * Invariants:
 * 1. AgenticOS remains the single supervisory control authority.
 * 2. BrowserComputerUseProvider is subordinate to UniversalCapabilityRuntime.
 * 3. BrowserComputerUseProvider output is a PROPOSAL — it never declares final success.
 * 4. SourceOutcomeVerifier independently verifies resulting state (URL, domain, tab identity).
 * 5. Structured-first hierarchy: 1. Verified CDP tab -> 2. DOM -> 3. Accessibility tree -> 4. Direct JS -> 5. Screenshot fallback.
 * 6. Never expose cookies, session tokens, passwords, or sensitive credentials in observations or evidence.
 */

export interface BrowserGoalRequest {
  readonly goal: string;
  readonly expectedDomain?: string;
  readonly expectedPage?: string;
  readonly currentContext?: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly maxSteps?: number;
}

export interface BrowserObservation {
  step: number;
  url: string;
  title: string;
  activeElement?: string;
  visualTargetFound?: boolean;
  actionProposed?: string;
  confidence?: number;
  timestamp: number;
}

export interface BrowserGoalResult {
  readonly status: 'SUCCESS' | 'FAILED' | 'UNVERIFIED' | 'TIMEOUT';
  readonly activeTab?: string;
  readonly url?: string;
  readonly title?: string;
  readonly observations: readonly BrowserObservation[];
  readonly actions: readonly string[];
  readonly extractedContent?: string;
  readonly screenshots?: readonly string[];
  readonly evidence: Record<string, unknown>;
  readonly durationMs: number;
  readonly stepCount: number;
  readonly error?: string;
}

export interface BrowserTabInfo {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly active: boolean;
}

export interface BrowserMetricsSnapshot {
  readonly cdpConnectMs: number;
  readonly tabResolveMs: number;
  readonly domQueryMs: number;
  readonly accessibilityTreeMs: number;
  readonly jsExecuteMs: number;
  readonly navigationMs: number;
  readonly contentExtractionMs: number;
  readonly verificationMs: number;
  readonly totalBrowserTaskMs: number;
}

export interface IBrowserComputerUseProvider {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  /**
   * Check if persistent Chrome CDP session is healthy and reachable.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a browser goal through structured CDP / DOM / a11y reasoning.
   */
  executeBrowserGoal(request: BrowserGoalRequest): Promise<BrowserGoalResult>;

  /**
   * Simple deterministic navigation (Speed 1).
   */
  navigate(url: string, timeoutMs?: number): Promise<{ success: boolean; url: string; title: string; durationMs: number }>;

  /**
   * Open a new tab with optional URL.
   */
  openNewTab(url?: string): Promise<BrowserTabInfo>;

  /**
   * Tab switching by target URL, domain, or title filter.
   */
  switchTab(target: string): Promise<BrowserTabInfo | null>;

  /**
   * List all currently open tabs.
   */
  listTabs(): Promise<readonly BrowserTabInfo[]>;

  /**
   * Extract structured content and accessibility tree from current active tab.
   */
  extractStructuredContent(): Promise<{ text: string; structuredItems: readonly string[]; a11ySummary: string; durationMs: number }>;

  /**
   * Safe JavaScript execution primitive (browser_execute).
   */
  executeScript<T = any>(script: string): Promise<T>;

  /**
   * Retrieve performance metrics for browser operations.
   */
  getMetrics(): BrowserMetricsSnapshot;
}
