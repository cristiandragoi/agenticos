import { db } from './src/db/index.js';
import { attribution } from './src/db/schema.js';
import crypto from 'crypto';

async function seed() {
  const data: any[] = [
    { 
      id: crypto.randomUUID(), campaignId: 'c1', assetId: 'a1', agentId: 'agent-codex', 
      promptVersionId: 'v1.0', revenue: 500, cost: 5, profit: 495, roi: 100, confidence: 'high',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    },
    { 
      id: crypto.randomUUID(), campaignId: 'c2', assetId: 'a2', agentId: 'agent-codex', 
      promptVersionId: 'v1.1', revenue: 700, cost: 4, profit: 696, roi: 175, confidence: 'medium',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    },
    { 
      id: crypto.randomUUID(), campaignId: 'c3', assetId: 'a3', agentId: 'agent-hermes', 
      promptVersionId: 'v2.0', revenue: 1500, cost: 10, profit: 1490, roi: 150, confidence: 'low',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    },
    { 
      id: crypto.randomUUID(), campaignId: 'c4', assetId: 'a4', agentId: 'agent-sentinel', 
      promptVersionId: 'v1.0', revenue: 0, cost: 2, profit: -2, roi: 0, confidence: 'high',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
  ];
  
  try {
    await db.insert(attribution).values(data);
    console.log('Successfully seeded attribution data');
  } catch (e) {
    console.log('Failed to seed or already seeded:', e);
  }
  process.exit(0);
}
seed();
