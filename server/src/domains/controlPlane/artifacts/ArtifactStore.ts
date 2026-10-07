/**
 * artifacts/ArtifactStore.ts — Centralized Typed Artifact Registry & Storage
 *
 * Implements Section E:
 * - Persists and indexes artifacts without passing huge binary blobs across conversation turns.
 * - Supports verified artifact commitment and retrieval by ID.
 * - Manages artifact lifecycle and cleanup.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../../../utils/logger.js';
import type { ArtifactRef, ImageArtifactRef } from './types.js';

export class ArtifactStore {
  private static instance: ArtifactStore;
  private artifacts = new Map<string, ArtifactRef>();
  private readonly baseStorageDir: string;

  private constructor() {
    this.baseStorageDir = path.resolve(process.cwd(), 'data', 'artifacts', 'managed');
    try {
      if (!fs.existsSync(this.baseStorageDir)) {
        fs.mkdirSync(this.baseStorageDir, { recursive: true });
      }
    } catch (err: any) {
      logger.warn('[ArtifactStore] Failed to create base storage directory:', err?.message);
    }
  }

  public static getInstance(): ArtifactStore {
    if (!ArtifactStore.instance) {
      ArtifactStore.instance = new ArtifactStore();
    }
    return ArtifactStore.instance;
  }

  public getBaseDir(): string {
    return this.baseStorageDir;
  }

  /**
   * Register an existing artifact file into the store.
   */
  public registerArtifact(ref: ArtifactRef): ArtifactRef {
    const frozen = Object.freeze({ ...ref });
    this.artifacts.set(ref.artifactId, frozen);
    logger.info(`[ArtifactStore] Registered artifact [id=${ref.artifactId}, type=${ref.type}, verified=${ref.verified}]`);
    return frozen;
  }

  /**
   * Store binary or string data as a managed file artifact.
   */
  public async storeFile(opts: {
    type: ArtifactRef['type'];
    data: Buffer | string;
    extension?: string;
    mimeType?: string;
    createdByTaskId: string;
    metadata?: Record<string, unknown>;
    verified?: boolean;
  }): Promise<ArtifactRef> {
    const artifactId = `art-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const ext = opts.extension ? (opts.extension.startsWith('.') ? opts.extension : `.${opts.extension}`) : '.bin';
    const filename = `${artifactId}${ext}`;
    const filepath = path.join(this.baseStorageDir, filename);

    if (typeof opts.data === 'string') {
      await fs.promises.writeFile(filepath, opts.data, 'utf8');
    } else {
      await fs.promises.writeFile(filepath, opts.data);
    }

    const stat = await fs.promises.stat(filepath);
    const hash = crypto.createHash('sha256').update(opts.data).digest('hex');

    const meta: Record<string, unknown> = {
      ...(opts.metadata || {}),
      byteSize: stat.size,
      sha256: hash,
    };

    const ref: ArtifactRef = {
      artifactId,
      type: opts.type,
      mimeType: opts.mimeType,
      location: filepath,
      createdByTaskId: opts.createdByTaskId,
      verified: opts.verified ?? true,
      createdAt: Date.now(),
      metadata: Object.freeze(meta),
    };

    return this.registerArtifact(ref);
  }

  /**
   * Retrieve artifact by ID.
   */
  public getArtifact(artifactId: string): ArtifactRef | undefined {
    return this.artifacts.get(artifactId);
  }

  /**
   * Retrieve and verify that artifact exists physically on disk.
   */
  public verifyArtifactOnDisk(artifactId: string): { verified: boolean; artifact?: ArtifactRef; error?: string } {
    const art = this.artifacts.get(artifactId);
    if (!art) {
      return { verified: false, error: `Artifact ${artifactId} not found in store.` };
    }
    if (!fs.existsSync(art.location)) {
      return { verified: false, artifact: art, error: `Artifact file at ${art.location} does not exist.` };
    }
    const stat = fs.statSync(art.location);
    if (stat.size === 0) {
      return { verified: false, artifact: art, error: `Artifact file at ${art.location} is empty (0 bytes).` };
    }
    return { verified: true, artifact: art };
  }

  /**
   * List all artifacts created by a task.
   */
  public listByTaskId(taskId: string): ArtifactRef[] {
    return Array.from(this.artifacts.values()).filter(a => a.createdByTaskId === taskId);
  }

  /**
   * Clear in-memory references (useful for tests).
   */
  public clear(): void {
    this.artifacts.clear();
  }
}

export const artifactStore = ArtifactStore.getInstance();
