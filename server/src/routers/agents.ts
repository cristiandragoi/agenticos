import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../services/db.js';

const router = Router();

router.get('/', (_req, res) => {
  let agents = db.agents.list();
  
  if (process.env.DEFAULT_PROVIDER === 'omniRoute') {
    agents = agents.map(agent => {
      // If DEFAULT_PROVIDER is omniRoute, ensure 'prov-openrouter' is in their providerIds,
      // and maybe put it first so computeAgentActiveModel prioritizes it,
      // or we just replace the ones that are likely to fail.
      const hasOmni = agent.providerIds?.includes('prov-openrouter');
      if (!hasOmni) {
        return {
          ...agent,
          providerIds: [...(agent.providerIds || []), 'prov-openrouter']
        };
      }
      return agent;
    });
  }
  
  res.json(agents);
});

router.get('/:id', (req, res) => {
  const agent = db.agents.get(req.params.id);
  if (!agent) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }); return; }
  res.json(agent);
});

router.post('/', (req, res) => {
  const {
    name,
    description,
    slug,
    avatar,
    color,
    runtimeId = 'rt-hermes',
    kind = 'first-class',
    capabilities = [],
    toolIds = [],
    memoryScopes = ['mem-global'],
    providerIds = [],
    defaultBoardId = 'board-mission-control',
  } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'name is required' } });
    return;
  }

  const id = `agent-${slug || name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${randomUUID().slice(0, 4)}`;

  const newAgent = {
    id,
    name: name.trim(),
    slug: slug || name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    avatar: avatar || name[0].toUpperCase(),
    color: color || '#94a3b8',
    runtimeId,
    kind,
    status: 'active' as 'active' | 'inactive' | 'error',
    capabilities: capabilities || [],
    toolIds: toolIds || [],
    memoryScopes: memoryScopes || ['mem-global'],
    providerIds: providerIds || [],
    defaultBoardId: defaultBoardId || 'board-mission-control',
    visibility: 'public' as 'public' | 'private',
    description: description || '',
    recentActivity: 'Created just now',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.agents.upsert(newAgent);
  res.status(201).json(newAgent);
});

export default router;
