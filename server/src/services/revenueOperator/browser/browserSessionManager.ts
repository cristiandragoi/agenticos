/**
 * browserSessionManager.ts — Playwright persistent profile isolation, locking, and orphan recovery.
 *
 * Requirements:
 * - Unique userDataDir per provider account
 * - Profile locking via .session.lock
 * - Safe orphan lock recovery (dead PID or stale heartbeat)
 * - Controlled launch / shutdown
 * - Configurable headed/headless mode
 * - Navigation and action timeout configuration
 * - Zero credential persistence outside the browser profile / secrets system
 */

import fs from 'fs';
import path from 'path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { logger } from '../../../utils/logger.js';
import type { ProfileLockInfo } from './types.js';

export class ProfileLockedError extends Error {
  constructor(message: string, public readonly lockInfo?: ProfileLockInfo) {
    super(message);
    this.name = 'ProfileLockedError';
  }
}

export interface LaunchSessionOptions {
  workerId: string;
  providerAccountId: string;
  profilePath: string;
  headless?: boolean;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
  lockStaleThresholdMs?: number;
}

export interface ManagedBrowserSession {
  context: BrowserContext;
  page: Page;
  profilePath: string;
  workerId: string;
  providerAccountId: string;
  close: () => Promise<void>;
  updateHeartbeat: () => void;
}

/** Check if an OS process with the given PID is currently active. */
export function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 does not terminate the process; it tests whether the process exists.
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return false;
  }
}

export class BrowserSessionManager {
  private static readonly LOCK_FILENAME = '.session.lock';
  private static readonly DEFAULT_STALE_THRESHOLD_MS = 60_000;
  private static readonly DEFAULT_NAV_TIMEOUT_MS = 15_000;
  private static readonly DEFAULT_ACTION_TIMEOUT_MS = 10_000;

  private baseDir?: string;
  private activeSessions = new Map<string, ManagedBrowserSession>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir;
  }

  /**
   * Instance method to acquire and track a managed browser session.
   */
  async acquireSession(
    providerAccountId: string,
    profilePath: string,
    workerId: string,
    options: { headless?: boolean } = {}
  ): Promise<ManagedBrowserSession> {
    const fullPath = this.baseDir ? path.resolve(this.baseDir, profilePath) : path.resolve(profilePath);
    const session = await BrowserSessionManager.launchSession({
      workerId,
      providerAccountId,
      profilePath: fullPath,
      headless: options.headless ?? true,
    });
    const key = `${providerAccountId}:::${workerId}`;
    this.activeSessions.set(key, session);
    return session;
  }

  /**
   * Instance method to release and close a managed browser session.
   */
  async releaseSession(providerAccountId: string, workerId: string): Promise<void> {
    const key = `${providerAccountId}:::${workerId}`;
    const session = this.activeSessions.get(key);
    if (session) {
      this.activeSessions.delete(key);
      await session.close();
    }
  }

  /**
   * Checks if an existing lock file in the profile directory is orphaned (owner PID is dead or stale),
   * and if so, safely unlinks it. Returns true if an orphan lock was recovered.
   */
  static recoverOrphanLock(profilePath: string, staleThresholdMs = BrowserSessionManager.DEFAULT_STALE_THRESHOLD_MS): boolean {

    const lockFile = path.join(profilePath, BrowserSessionManager.LOCK_FILENAME);
    if (!fs.existsSync(lockFile)) return false;

    try {
      const content = fs.readFileSync(lockFile, 'utf-8');
      const lockInfo = JSON.parse(content) as ProfileLockInfo;
      const pidAlive = isProcessAlive(lockInfo.pid);
      const isStale = Date.now() - new Date(lockInfo.heartbeatAt || lockInfo.acquiredAt).getTime() > staleThresholdMs;

      if (!pidAlive || isStale) {
        logger.warn(
          `[BrowserSessionManager] Recovering orphan lock on profile '${profilePath}' (owner PID ${lockInfo.pid} alive=${pidAlive}, stale=${isStale})`
        );
        fs.unlinkSync(lockFile);
        return true;
      }
    } catch (err: any) {
      logger.warn(`[BrowserSessionManager] Malformed lock file on profile '${profilePath}'. Removing: ${err.message}`);
      try { fs.unlinkSync(lockFile); return true; } catch {}
    }

    return false;
  }

  /**
   * Acquires a file-based mutex lock for the given profile directory.
   */
  static acquireLock(
    profilePath: string,
    workerId: string,
    providerAccountId: string,
    staleThresholdMs = BrowserSessionManager.DEFAULT_STALE_THRESHOLD_MS
  ): void {
    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }

    const lockFile = path.join(profilePath, BrowserSessionManager.LOCK_FILENAME);

    // Attempt orphan recovery if a lock already exists
    if (fs.existsSync(lockFile)) {
      const recovered = BrowserSessionManager.recoverOrphanLock(profilePath, staleThresholdMs);
      if (!recovered && fs.existsSync(lockFile)) {
        let existingLock: ProfileLockInfo | undefined;
        try {
          existingLock = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
        } catch {}

        throw new ProfileLockedError(
          `Profile directory '${profilePath}' is already locked by worker '${existingLock?.workerId ?? 'unknown'}' (PID: ${existingLock?.pid ?? 'unknown'}).`,
          existingLock
        );
      }
    }

    const now = new Date().toISOString();
    const lockInfo: ProfileLockInfo = {
      pid: process.pid,
      workerId,
      providerAccountId,
      acquiredAt: now,
      heartbeatAt: now,
    };

    // Use wx flag (exclusive create) to prevent race conditions
    try {
      fs.writeFileSync(lockFile, JSON.stringify(lockInfo, null, 2), { flag: 'wx' });
    } catch (err: any) {
      throw new ProfileLockedError(`Failed to acquire lock for profile '${profilePath}': ${err.message}`);
    }
  }

  /**
   * Releases the file-based lock.
   */
  static releaseLock(profilePath: string, workerId: string): void {
    const lockFile = path.join(profilePath, BrowserSessionManager.LOCK_FILENAME);
    if (!fs.existsSync(lockFile)) return;

    try {
      const content = fs.readFileSync(lockFile, 'utf-8');
      const lockInfo = JSON.parse(content) as ProfileLockInfo;
      // Only release if owned by this worker/PID or forced
      if (lockInfo.workerId === workerId || lockInfo.pid === process.pid) {
        fs.unlinkSync(lockFile);
        logger.info(`[BrowserSessionManager] Released lock on profile '${profilePath}' for worker '${workerId}'.`);
      }
    } catch (err: any) {
      logger.warn(`[BrowserSessionManager] Error releasing lock: ${err.message}`);
    }
  }

  /**
   * Launches an isolated Playwright persistent browser context for a provider account.
   */
  static async launchSession(options: LaunchSessionOptions): Promise<ManagedBrowserSession> {
    const {
      workerId,
      providerAccountId,
      profilePath,
      headless = true,
      navigationTimeoutMs = BrowserSessionManager.DEFAULT_NAV_TIMEOUT_MS,
      actionTimeoutMs = BrowserSessionManager.DEFAULT_ACTION_TIMEOUT_MS,
      lockStaleThresholdMs = BrowserSessionManager.DEFAULT_STALE_THRESHOLD_MS,
    } = options;

    const resolvedProfileDir = path.resolve(profilePath);

    // 1. Acquire profile lock (with orphan recovery)
    BrowserSessionManager.acquireLock(resolvedProfileDir, workerId, providerAccountId, lockStaleThresholdMs);

    try {
      // 2. Launch persistent context
      const context = await chromium.launchPersistentContext(resolvedProfileDir, {
        headless,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-default-browser-check',
          '--disable-infobars',
        ],
      });

      // 3. Configure timeouts
      context.setDefaultNavigationTimeout(navigationTimeoutMs);
      context.setDefaultTimeout(actionTimeoutMs);

      // 4. Load persisted storage state (session cookies) if available
      const storageStatePath = path.join(resolvedProfileDir, 'storage_state.json');
      if (fs.existsSync(storageStatePath)) {
        try {
          const raw = fs.readFileSync(storageStatePath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.cookies) && parsed.cookies.length > 0) {
            await context.addCookies(parsed.cookies);
            logger.info(`[BrowserSessionManager] Restored ${parsed.cookies.length} cookies from storage_state.json`);
          }
        } catch (err: any) {
          logger.warn(`[BrowserSessionManager] Failed to load storage_state.json: ${err.message}`);
        }
      }

      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();

      let isClosed = false;

      const session: ManagedBrowserSession = {
        context,
        page,
        profilePath: resolvedProfileDir,
        workerId,
        providerAccountId,
        updateHeartbeat: () => {
          const lockFile = path.join(resolvedProfileDir, BrowserSessionManager.LOCK_FILENAME);
          if (fs.existsSync(lockFile)) {
            try {
              const current = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
              current.heartbeatAt = new Date().toISOString();
              fs.writeFileSync(lockFile, JSON.stringify(current, null, 2));
            } catch {}
          }
        },
        close: async () => {
          if (isClosed) return;
          isClosed = true;
          try {
            try {
              await context.storageState({ path: storageStatePath });
              logger.info(`[BrowserSessionManager] Persisted storage_state.json for ${providerAccountId}`);
            } catch (saveErr: any) {
              logger.warn(`[BrowserSessionManager] Could not persist storageState: ${saveErr.message}`);
            }
            await context.close();
          } catch (err: any) {
            logger.warn(`[BrowserSessionManager] Error closing context: ${err.message}`);
          } finally {
            BrowserSessionManager.releaseLock(resolvedProfileDir, workerId);
          }
        },
      };

      return session;
    } catch (err: any) {
      // If launch fails, clean up lock
      BrowserSessionManager.releaseLock(resolvedProfileDir, workerId);
      throw err;
    }
  }
}

export const browserSessionManager = new BrowserSessionManager();

