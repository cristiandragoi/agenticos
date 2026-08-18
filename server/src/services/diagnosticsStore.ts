/**
 * UI Diagnostic Snapshot store (backend side).
 *
 * The FRONTEND reports what it is currently rendering (and last rendered) via
 * POST /api/diagnostics/ui-snapshot. This store keeps the LATEST snapshot —
 * read-only observational state; the backend/runtime remains authoritative.
 * Jarvis INVESTIGATE reads it to compare UI-displayed provider/model state
 * against backend runtime state.
 */
export interface UiDiagnosticSnapshot {
  /** Configured/selected frontend state (assignment API + user selection). */
  selected: { provider: string | null; model: string | null; updatedAt: number; source: string | null };
  /** Gateway status the UI renders (health poll / bootstrap). */
  gatewayRendered: { provider: string | null; model: string | null; online: boolean | null; updatedAt: number; source: string | null };
  /** Last rendered transcript ProviderBadge (render confirmation + last-known). */
  rendered: {
    providerBadge: { provider: string | null; model: string | null; renderedAt: number; componentMounted: boolean; messageId: string | null };
  };
  /** Current active stream vs last-known stream (never fabricated). */
  stream: {
    active: { provider: string | null; model: string | null; operationId: string | null; startedAt: number } | null;
    lastKnown: { provider: string | null; model: string | null; operationId: string | null; endedAt: number } | null;
  };
  version: number;
  updatedAt: number;
}

let latest: UiDiagnosticSnapshot | null = null;

export const diagnosticsStore = {
  setUiSnapshot(snapshot: UiDiagnosticSnapshot): void {
    if (!snapshot || typeof snapshot !== 'object') return;
    latest = snapshot;
  },
  getUiSnapshot(): UiDiagnosticSnapshot | null {
    return latest;
  },
  clear(): void {
    latest = null;
  },
};
