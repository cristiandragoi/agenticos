import { logger } from '../utils/logger.js';
import type { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  status?: number;
  code?: string;
}

export function errorHandler(
  err: AppError,
  req: Request & { id?: string },
  res: Response,
  _next: NextFunction
): void {
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

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      requestId: (req as any).id || 'unknown',
    },
  });
}
