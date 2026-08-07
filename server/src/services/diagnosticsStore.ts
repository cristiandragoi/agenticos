/**
 * UI Diagnostic Snapshot store (backend side).
 *
 * The FRONTEND reports what it is currently rendering via
 * POST /api/diagnostics/ui-snapshot. This store keeps the LATEST snapshot
 * (read-only reporting — the backend/runtime remains authoritative).
 * Jarvis INVESTIGATE reads it to compare UI-displayed provider/model state
 * against backend runtime state.
 */
export interface UiSnapshotPart {
  provider: string | null;
  model: string | null;
  updatedAt: number;
}

export interface UiDiagnosticSnapshot {
  selected: UiSnapshotPart;
  gatewayResolved: UiSnapshotPart & { online: boolean | null };
  activeStream: UiSnapshotPart & { operationId: string | null };
  frontendBadge: UiSnapshotPart & { messageId: string | null };
  hermes: UiSnapshotPart;
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
