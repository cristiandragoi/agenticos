/**
 * CapabilityPermissionStore.ts — Authoritative Persistent Permission Store
 *
 * Implements Section 1 & Section 14:
 * Manages user-granted persistent authorization for local computer control & perception capabilities.
 * Permissions are stored durably in SQLite and survive AgenticOS restarts.
 */

import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

export type CapabilityName =
  | 'desktop.control'
  | 'desktop.observe'
  | 'screen.capture'
  | 'browser.read'
  | 'browser.navigate'
  | 'browser.input'
  | 'browser.click'
  | 'browser.download'
  | 'browser.upload'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'shell.execute'
  | 'camera.perceive'
  | 'location.read';

export type PermissionState = 'allowed' | 'denied' | 'prompt';

export const DEFAULT_PERMISSIONS: Record<CapabilityName, PermissionState> = {
  'desktop.control': 'allowed',
  'desktop.observe': 'allowed',
  'screen.capture': 'allowed',
  'browser.read': 'allowed',
  'browser.navigate': 'allowed',
  'browser.input': 'allowed',
  'browser.click': 'allowed',
  'browser.download': 'allowed',
  'browser.upload': 'allowed',
  'filesystem.read': 'allowed',
  'filesystem.write': 'allowed',
  'shell.execute': 'allowed',
  'camera.perceive': 'allowed',
  'location.read': 'allowed',
};

export class CapabilityPermissionStore {
  private static instance: CapabilityPermissionStore;
  private cache: Map<CapabilityName, PermissionState> = new Map();

  private constructor() {
    this.ensureTable();
    this.loadPermissions();
  }

  public static getInstance(): CapabilityPermissionStore {
    if (!CapabilityPermissionStore.instance) {
      CapabilityPermissionStore.instance = new CapabilityPermissionStore();
    }
    return CapabilityPermissionStore.instance;
  }

  private ensureTable(): void {
    try {
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS capability_permissions (
          capability TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    } catch (err: any) {
      logger.warn(`[CapabilityPermissionStore] Table initialization warning: ${err?.message}`);
    }
  }

  private loadPermissions(): void {
    try {
      const rows: any[] = rawDb.prepare('SELECT capability, state FROM capability_permissions').all();
      const dbMap = new Map<string, PermissionState>();
      for (const row of rows) {
        dbMap.set(row.capability, row.state as PermissionState);
      }

      // Initialize defaults if not present
      const insertStmt = rawDb.prepare(`
        INSERT INTO capability_permissions (capability, state, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(capability) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
      `);

      const now = new Date().toISOString();
      for (const [cap, defState] of Object.entries(DEFAULT_PERMISSIONS)) {
        const capability = cap as CapabilityName;
        if (!dbMap.has(capability)) {
          insertStmt.run(capability, defState, now);
          this.cache.set(capability, defState);
        } else {
          this.cache.set(capability, dbMap.get(capability)!);
        }
      }
    } catch (err: any) {
      logger.error(`[CapabilityPermissionStore] Failed to load permissions from DB: ${err?.message}`);
      // Fall back to memory defaults
      for (const [cap, defState] of Object.entries(DEFAULT_PERMISSIONS)) {
        this.cache.set(cap as CapabilityName, defState);
      }
    }
  }

  public isAllowed(capability: CapabilityName | string): boolean {
    const state = this.cache.get(capability as CapabilityName);
    if (state !== undefined) {
      return state === 'allowed';
    }
    // Check if db has it
    try {
      const row: any = rawDb.prepare('SELECT state FROM capability_permissions WHERE capability = ?').get(capability);
      if (row?.state) {
        this.cache.set(capability as CapabilityName, row.state as PermissionState);
        return row.state === 'allowed';
      }
    } catch {}

    // Default to allowed for granted local capabilities
    return DEFAULT_PERMISSIONS[capability as CapabilityName] !== 'denied';
  }

  public getPermission(capability: CapabilityName | string): PermissionState {
    if (this.cache.has(capability as CapabilityName)) {
      return this.cache.get(capability as CapabilityName)!;
    }
    return DEFAULT_PERMISSIONS[capability as CapabilityName] || 'prompt';
  }

  public setPermission(capability: CapabilityName, state: PermissionState): void {
    this.cache.set(capability, state);
    try {
      rawDb.prepare(`
        INSERT INTO capability_permissions (capability, state, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(capability) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
      `).run(capability, state, new Date().toISOString());
      logger.info(`[CapabilityPermissionStore] Permission updated: ${capability}=${state}`);
    } catch (err: any) {
      logger.error(`[CapabilityPermissionStore] Failed to persist permission ${capability}: ${err?.message}`);
    }
  }

  public getAllPermissions(): Record<CapabilityName, PermissionState> {
    const result: Partial<Record<CapabilityName, PermissionState>> = {};
    for (const key of Object.keys(DEFAULT_PERMISSIONS)) {
      const cap = key as CapabilityName;
      result[cap] = this.cache.get(cap) || DEFAULT_PERMISSIONS[cap];
    }
    return result as Record<CapabilityName, PermissionState>;
  }

  /**
   * Reconcile any capability state inconsistency automatically.
   */
  public reconcileConsistency(): { reconciled: boolean; issuesFixed: string[] } {
    const issuesFixed: string[] = [];
    for (const [key, expected] of Object.entries(DEFAULT_PERMISSIONS)) {
      const cap = key as CapabilityName;
      const current = this.cache.get(cap);
      if (!current) {
        this.setPermission(cap, expected);
        issuesFixed.push(`Restored default '${expected}' for missing capability '${cap}'`);
      }
    }
    return { reconciled: issuesFixed.length > 0, issuesFixed };
  }
}

export const capabilityPermissionStore = CapabilityPermissionStore.getInstance();
