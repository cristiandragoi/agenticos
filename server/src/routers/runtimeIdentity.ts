/**
 * runtimeIdentity.ts
 *
 * GET /api/runtime/identity
 * GET /api/runtime/health
 *
 * Authoritative, hardened runtime identity and health router for Agentic OS backend.
 * Provides process and build truth for renderer and automated acceptance runners.
 * Never exposes secrets, API keys, credentials, full environment, or sensitive filesystem paths.
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sqliteDbPath, rawDb, getDbLocationType } from '../db/index.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROCESS_START_MS = Date.now();
const PROCESS_START_ISO = new Date(PROCESS_START_MS).toISOString();

export interface BuildIdentity {
  gitSha: string;
  gitShort: string;
  isDirty?: boolean;
  buildTimestamp: string;
  buildId: string;
  version: string;
  component?: string;
}

export function loadBuildIdentity(): BuildIdentity {
  const candidates = [
    path.resolve(__dirname, '..', 'build-identity.json'),
    path.resolve(__dirname, '..', '..', 'src', 'build-identity.json'),
    path.resolve(process.cwd(), 'server', 'dist', 'build-identity.json'),
    path.resolve(process.cwd(), 'server', 'src', 'build-identity.json'),
    path.resolve(process.cwd(), 'build-identity.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf8')) as BuildIdentity;
      }
    } catch { /* continue */ }
  }

  return {
    gitSha: 'unknown',
    gitShort: 'unknown',
    isDirty: false,
    buildTimestamp: new Date(0).toISOString(),
    buildId: 'unknown-00000000-000000',
    version: '0.0.0',
    component: 'backend',
  };
}

const STATIC_BUILD_IDENTITY = loadBuildIdentity();

function detectMode(): 'packaged' | 'development' {
  if ((process as any).resourcesPath && (process as any).resourcesPath !== process.cwd()) {
    return 'packaged';
  }
  if (process.env.ELECTRON_IS_PACKAGED === 'true' || process.env.IS_PACKAGED === 'true' || process.env.AGENTICOS_IS_PACKAGED === 'true') {
    return 'packaged';
  }
  return 'development';
}

function getDatabaseStatus(includeDebugDetails = false) {
  const dbPath = sqliteDbPath;
  let exists = false;
  let sizeBytes: number | null = null;

  try {
    const stat = fs.statSync(dbPath);
    exists = true;
    sizeBytes = stat.size;
  } catch {
    exists = false;
  }

  let migrationCount = 0;
  try {
    const row = rawDb.prepare(`SELECT COUNT(*) as c FROM __drizzle_migrations`).get() as any;
    migrationCount = row?.c || 0;
  } catch {
    migrationCount = 0;
  }

  const safeInfo: Record<string, any> = {
    engine: 'sqlite',
    migrationVersion: String(migrationCount),
    status: exists ? 'ready' : 'missing',
  };

  if (includeDebugDetails) {
    safeInfo.path = dbPath;
    safeInfo.sizeBytes = sizeBytes;
    safeInfo.locationType = getDbLocationType();
  }

  return safeInfo;
}

/* -- GET /api/runtime/identity ------------------------------ */
router.get('/identity', (req: Request, res: Response) => {
  const now = Date.now();
  const uptimeSeconds = Math.round((now - PROCESS_START_MS) / 1000);
  const isDevDebug = process.env.NODE_ENV === 'development' && req.query.debug === 'true';
  const dbStatus = getDatabaseStatus(isDevDebug);

  const responsePayload = {
    status: 'ok',
    component: 'backend',
    buildIdentity: STATIC_BUILD_IDENTITY,
    process: {
      pid: process.pid,
      startedAt: PROCESS_START_ISO,
      uptimeSeconds,
      nodeVersion: process.version,
      port: parseInt(process.env.PORT || '4000', 10) || 4000,
      mode: detectMode(),
      nodeEnv: process.env.NODE_ENV || 'production',
      ...(isDevDebug ? { cwd: process.cwd() } : {}),
    },
    database: dbStatus,
    health: {
      ready: true,
      databaseOpen: dbStatus.status === 'ready',
      apiResponding: true,
    },
  };

  res.json(responsePayload);
});

/* -- GET /api/runtime/health -------------------------------- */
router.get('/health', (_req: Request, res: Response) => {
  const dbStatus = getDatabaseStatus(false);
  res.json({
    status: 'healthy',
    ready: true,
    databaseOpen: dbStatus.status === 'ready',
    uptimeSeconds: Math.round((Date.now() - PROCESS_START_MS) / 1000),
    pid: process.pid,
    buildId: STATIC_BUILD_IDENTITY.buildId,
  });
});

export default router;
