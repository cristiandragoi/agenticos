import { Router } from 'express';
import { db } from '../services/db.js';

const router = Router();

router.get('/', (_req, res) => res.json(db.runtimes.list()));
router.get('/:id', (req, res) => {
  const rt = db.runtimes.get(req.params.id);
  if (!rt) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Runtime not found' } }); return; }
  res.json(rt);
});

export default router;
