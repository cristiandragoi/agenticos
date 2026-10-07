/**
 * artifacts/types.ts — Canonical Typed Artifact Contract for AgenticOS
 *
 * Implements Section E of Autonomous Jarvis Execution Kernel Bridge:
 * Typed artifact references, metadata, lifecycle, and verification state.
 */

export type ArtifactType =
  | 'IMAGE'
  | 'SCREENSHOT'
  | 'CAMERA_FRAME'
  | 'TEXT'
  | 'DOCUMENT'
  | 'FILE'
  | 'JSON'
  | 'URL';

export interface ArtifactRef {
  /** Globally unique artifact identifier */
  readonly artifactId: string;
  /** Categorical artifact type */
  readonly type: ArtifactType;
  /** Optional standard MIME type */
  readonly mimeType?: string;
  /** Storage location (absolute file path or URL) */
  readonly location: string;
  /** Task or Node ID that created this artifact */
  readonly createdByTaskId: string;
  /** Physical verification status */
  readonly verified: boolean;
  /** Timestamp of creation (epoch ms) */
  readonly createdAt: number;
  /** Content hash / sha256 */
  readonly sha256?: string;
  readonly hash?: string;
  /** Optional metadata (dimensions, hash, size in bytes, prompt, etc.) */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ImageArtifactRef extends ArtifactRef {
  readonly type: 'IMAGE' | 'SCREENSHOT' | 'CAMERA_FRAME';
  readonly dimensions?: {
    readonly width: number;
    readonly height: number;
  };
  readonly sha256?: string;
}
