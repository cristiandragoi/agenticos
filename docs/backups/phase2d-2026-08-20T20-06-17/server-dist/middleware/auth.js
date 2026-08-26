import { logger } from '../utils/logger.js';
export function authMiddleware(req, res, next) {
    const token = process.env.AGENTOS_API_TOKEN;
    if (!token || process.env.NODE_ENV !== 'production') {
        // Dev bypass — log warning once
        if (process.env.NODE_ENV === 'production') {
            logger.warn('[AUTH] AGENTOS_API_TOKEN is not set — all requests are unauthenticated');
        }
        return next();
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token', requestId: req.id || 'unknown' } });
        return;
    }
    const provided = authHeader.slice(7);
    if (provided !== token) {
        res.status(401).json({ error: { code: 'FORBIDDEN', message: 'Invalid token', requestId: req.id || 'unknown' } });
        return;
    }
    next();
}
