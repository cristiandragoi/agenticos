import { Router } from 'express';
import { db } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

// GET /api/tasks
router.get('/', async (req, res) => {
  try {
    const allTasks = await db.query.tasks.findMany({
      orderBy: [desc(tasks.createdAt)]
    });
    
    // Map to HermesTask format
    const formatted = allTasks.map(t => ({
      ...t,
      // Status mapping if needed, assuming tasks.status matches
      status: t.status === 'draft' ? 'backlog' : t.status,
      agent: t.assignedAgentId || 'Hermes',
      model: 'Qwable Coder', // Mock model
      skillId: Array.isArray(t.skillIds) && t.skillIds.length > 0 ? t.skillIds[0] : 'daily-briefing',
    }));
    
    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (status) {
      await db.update(tasks).set({ status, updatedAt: new Date().toISOString() }).where(eq(tasks.id, id));
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
