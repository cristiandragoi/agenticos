import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function attachRequestId(req: Request, _res: Response, next: NextFunction): void {
  (req as any).id = randomUUID();
  next();
}
