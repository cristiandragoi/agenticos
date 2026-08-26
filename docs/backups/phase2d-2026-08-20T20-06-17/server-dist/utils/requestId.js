import { randomUUID } from 'crypto';
export function attachRequestId(req, _res, next) {
    req.id = randomUUID();
    next();
}
