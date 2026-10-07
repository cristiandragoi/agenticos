/**
 * runtimeIdentity.ts (Renderer & Shared Build Identity Inspector)
 *
 * Provides build identity tracking and mismatch detection between
 * the Electron renderer bundle and the active backend process.
 */
import { apiFetch } from '../api/client';
import embeddedIdentity from '../build-identity.json';

export type BuildMismatchType =
  | 'MATCH'
  | 'STALE_RENDERER'
  | 'STALE_BACKEND'
  | 'BUILD_MISMATCH'
  | 'UNKNOWN_RUNTIME';

export interface BuildIdentity {
  gitSha: string;
  gitShort: string;
  isDirty?: boolean;
  buildTimestamp: string;
  buildId: string;
  version: string;
  component?: string;
}

export interface BackendProcessInfo {
  pid: number;
  startedAt: string;
  uptimeSeconds: number;
  nodeVersion: string;
  port: number;
  mode: 'packaged' | 'development';
  cwd: string;
  nodeEnv?: string;
}

export interface BackendRuntimeIdentityResponse {
  status: string;
  component: string;
  buildIdentity: BuildIdentity;
  process: BackendProcessInfo;
  database?: {
    path: string;
    exists: boolean;
    sizeBytes: number | null;
    migrationVersion: string;
  };
  health?: {
    ready: boolean;
    databaseOpen: boolean;
    apiResponding: boolean;
  };
}

export interface BuildComparisonResult {
  status: BuildMismatchType;
  rendererIdentity: BuildIdentity;
  backendIdentity: BuildIdentity | null;
  backendProcess: BackendProcessInfo | null;
  message: string;
  timestampDiffSeconds: number | null;
  isCompatible: boolean;
}

export function getRendererBuildIdentity(): BuildIdentity {
  return embeddedIdentity as BuildIdentity;
}

/**
 * Compare renderer and backend build identities with deterministic classification.
 */
export function compareBuildIdentities(
  renderer: BuildIdentity | null | undefined,
  backend: BuildIdentity | null | undefined,
  backendProcess: BackendProcessInfo | null = null
): BuildComparisonResult {
  const rend: BuildIdentity = renderer || {
    gitSha: 'unknown',
    gitShort: 'unknown',
    isDirty: false,
    buildTimestamp: new Date(0).toISOString(),
    buildId: 'unknown',
    version: '0.0.0',
  };

  if (!backend || !backend.gitSha || backend.gitSha === 'unknown') {
    return {
      status: 'UNKNOWN_RUNTIME',
      rendererIdentity: rend,
      backendIdentity: backend || null,
      backendProcess,
      message: 'Backend build identity is unreachable or unknown.',
      timestampDiffSeconds: null,
      isCompatible: false,
    };
  }

  // 1. Commit SHA Mismatch Check
  if (rend.gitSha !== 'unknown' && backend.gitSha !== 'unknown' && rend.gitSha !== backend.gitSha) {
    return {
      status: 'BUILD_MISMATCH',
      rendererIdentity: rend,
      backendIdentity: backend,
      backendProcess,
      message: `Build mismatch: renderer is on commit ${rend.gitShort}, but backend is on ${backend.gitShort}.`,
      timestampDiffSeconds: null,
      isCompatible: false,
    };
  }

  // 2. Timestamp delta comparison
  const rendTime = new Date(rend.buildTimestamp).getTime();
  const backTime = new Date(backend.buildTimestamp).getTime();
  const diffSec = Math.round((rendTime - backTime) / 1000);

  // If backend was built significantly later than renderer (e.g. > 15s)
  if (backTime - rendTime > 15000) {
    return {
      status: 'STALE_RENDERER',
      rendererIdentity: rend,
      backendIdentity: backend,
      backendProcess,
      message: `Stale renderer: backend build (${backend.buildId}) is newer than loaded renderer (${rend.buildId}). Please reload window.`,
      timestampDiffSeconds: diffSec,
      isCompatible: false,
    };
  }

  // If renderer was built significantly later than running backend (e.g. > 15s)
  if (rendTime - backTime > 15000) {
    return {
      status: 'STALE_BACKEND',
      rendererIdentity: rend,
      backendIdentity: backend,
      backendProcess,
      message: `Stale backend: running backend (${backend.buildId}) is older than renderer build (${rend.buildId}). Restart backend server.`,
      timestampDiffSeconds: diffSec,
      isCompatible: false,
    };
  }

  return {
    status: 'MATCH',
    rendererIdentity: rend,
    backendIdentity: backend,
    backendProcess,
    message: 'Renderer and backend builds match.',
    timestampDiffSeconds: diffSec,
    isCompatible: true,
  };
}

/**
 * Query backend identity over HTTP/API and compare with local renderer identity.
 */
export async function checkRuntimeIdentityMatch(apiUrlPrefix = ''): Promise<BuildComparisonResult> {
  const rend = getRendererBuildIdentity();
  try {
    const res = await apiFetch(`${apiUrlPrefix}/api/runtime/identity`);
    if (!res.ok) {
      return {
        status: 'UNKNOWN_RUNTIME',
        rendererIdentity: rend,
        backendIdentity: null,
        backendProcess: null,
        message: `HTTP ${res.status} received from /api/runtime/identity`,
        timestampDiffSeconds: null,
        isCompatible: false,
      };
    }
    const data: BackendRuntimeIdentityResponse = await res.json();
    return compareBuildIdentities(rend, data.buildIdentity, data.process);
  } catch (err: any) {
    return {
      status: 'UNKNOWN_RUNTIME',
      rendererIdentity: rend,
      backendIdentity: null,
      backendProcess: null,
      message: `Failed to fetch backend identity: ${err?.message || err}`,
      timestampDiffSeconds: null,
      isCompatible: false,
    };
  }
}
