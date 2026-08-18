import { logger } from '../utils/logger.js';
import type { Request, Response, NextFunction } from 'express';

const LEGACY_HEADERS = ['x-provider-keys', 'x-max-retries', 'x-degraded-timeout'];

/**
 * Phase 4: Strictly reject legacy configuration headers.
 * Preflight OPTIONS requests are allowed through without inspection.
 */
export function legacyHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') return next();
  const found = LEGACY_HEADERS.filter(h => req.headers[h]);
  if (found.length > 0) {
    logger.warn(`Rejected request with legacy configuration headers: ${found.join(', ')}`);
    res.status(400).json({ error: `Legacy headers not allowed: ${found.join(', ')}` });
    return;
  }
  next();
}
