import { logger } from '../utils/logger.js';
export function errorHandler(err, req, res, _next) {
    const status = err.status || 500;
    const code = err.code || 'INTERNAL_ERROR';
    logger.error(`[ERROR] ${req.method} ${req.path} → ${code}: ${err.message}`);
    res.status(status).json({
        error: {
            code,
            message: err.message || 'An unexpected error occurred',
            requestId: req.id || 'unknown',
        },
    });
}
export function notFound(req, res) {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.path} not found`,
            requestId: req.id || 'unknown',
        },
    });
}
