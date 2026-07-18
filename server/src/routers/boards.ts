import { Router } from 'express';
import { db } from '../services/db.js';

const router = Router();

router.get('/', (_req, res) => res.json(db.boards.list()));
router.get('/:id', (req, res) => {
  const board = db.boards.get(req.params.id);
  if (!board) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found' } }); return; }
  res.json(board);
});

export default router;
