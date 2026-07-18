import { Router } from 'express';
import { db } from '../services/db.js';

const router = Router();

router.get('/', (_req, res) => res.json(db.tools.list()));

export default router;
