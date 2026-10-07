import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Genuinely read-only health & liveness endpoints permitted without authentication.
 * All mutating routes and all other endpoints require authentication.
 */
export const PUBLIC_READ_ONLY_HEALTH_ENDPOINTS = [
  '/health',
  '/health/system',
  '/health/gateway',
  '/health/behavioral',
  '/health/hermes-gateway',
  '/health/incidents',
  '/health/production-readiness',
  '/runtime',
  '/runtime/identity',
  '/runtime/health',
] as const;

/**
 * Checks whether an incoming HTTP request targets a genuinely read-only health endpoint.
 * Strictly enforces that only GET, HEAD, and OPTIONS methods are eligible.
 */
export function isPublicReadOnlyHealthEndpoint(method: string, path: string): boolean {
  const normMethod = (method || '').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(normMethod)) {
    return false;
  }
  const normPath = path.replace(/\/+$/, '') || '/';
  return PUBLIC_READ_ONLY_HEALTH_ENDPOINTS.some(
    (allowed) => normPath === allowed || normPath === `/api${allowed}`
  );
}

/**
 * Constant-time string comparison to prevent timing oracle attacks.
 */
export function timingSafeTokenCompare(provided: string, expected: string): boolean {
  const bufProvided = Buffer.from(provided, 'utf8');
  const bufExpected = Buffer.from(expected, 'utf8');
  if (bufProvided.length !== bufExpected.length) {
    // Perform dummy timingSafeEqual on matching lengths to mitigate length timing variance
    timingSafeEqual(bufExpected, bufExpected);
    return false;
  }
  return timingSafeEqual(bufProvided, bufExpected);
}

/**
 * Authoritative API Authentication Middleware.
 * Fails closed in every environment:
 * - If AGENTOS_API_TOKEN is unset: server refuses mutating requests with HTTP 503 and logs why.
 * - If AGENTOS_API_TOKEN is set: all protected requests require a matching Bearer token (HTTP 401 if missing/invalid).
 * - Dev/test bypass exists ONLY when AGENTICOS_AUTH_TEST_BYPASS === 'true' is explicitly set by test harness.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Explicit test-only harness bypass: NEVER enabled by default
  if (process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true') {
    return next();
  }

  const token = process.env.AGENTOS_API_TOKEN;
  const method = (req.method || 'POST').toUpperCase();
  const isMutating = req.method ? !['GET', 'HEAD', 'OPTIONS'].includes(method) : true;

  if (!token) {
    if (isMutating) {
      logger.warn(`[AUTH] AGENTOS_API_TOKEN is not set — server refuses mutating request (${method} ${req.originalUrl || req.url || ''})`);
      res.status(503).json({
        error: {
          code: 'AUTH_TOKEN_NOT_CONFIGURED',
          message: 'AGENTOS_API_TOKEN is not configured; server refuses mutating requests',
          requestId: (req as any).id || 'unknown',
        },
      });
      return;
    }
    // Read-only requests when token is unconfigured locally
    return next();
  }

  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Bearer token',
        requestId: (req as any).id || 'unknown',
      },
    });
    return;
  }

  const provided = authHeader.slice(7);
  if (!provided || !timingSafeTokenCompare(provided, token)) {
    res.status(401).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid token',
        requestId: (req as any).id || 'unknown',
      },
    });
    return;
  }

  next();
}
