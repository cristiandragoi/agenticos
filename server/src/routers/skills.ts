import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { listSkills, getSkill, createSkill, updateSkill, deleteSkill } from '../services/agent/skillRegistry.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const allSkills = await listSkills();
    const publicSkills = allSkills.filter(s => s.active && s.isPublic !== false);
    res.json(publicSkills);
  } catch (err: any) {
    logger.error('[Skills API] Failed to list skills:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const skill = await getSkill(req.params.id);
    if (!skill) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } });
      return;
    }
    res.json(skill);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

router.post('/', async (req, res) => {
  try {
    const skill = await createSkill(req.body);
    res.status(201).json(skill);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const skill = await updateSkill(req.params.id, req.body);
    res.json(skill);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteSkill(req.params.id);
    res.json({ id: req.params.id, status: 'deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

export default router;
