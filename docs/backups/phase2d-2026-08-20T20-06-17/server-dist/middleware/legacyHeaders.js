import { logger } from '../utils/logger.js';
const LEGACY_HEADERS = ['x-provider-keys', 'x-max-retries', 'x-degraded-timeout'];
/**
 * Phase 4: Strictly reject legacy configuration headers.
 * Preflight OPTIONS requests are allowed through without inspection.
 */
export function legacyHeadersMiddleware(req, res, next) {
    if (req.method === 'OPTIONS')
        return next();
    const found = LEGACY_HEADERS.filter(h => req.headers[h]);
    if (found.length > 0) {
        logger.warn(`Rejected request with legacy configuration headers: ${found.join(', ')}`);
        res.status(400).json({ error: `Legacy headers not allowed: ${found.join(', ')}` });
        return;
    }
    next();
}
