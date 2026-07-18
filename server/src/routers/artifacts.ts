import { Router } from 'express';
import { db } from '../services/db.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const artifactsRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_12345';

// GET endpoint to list all artifacts
artifactsRouter.get('/', async (req, res) => {
  const artifacts = await db.artifacts.list();
  res.json(artifacts);
});


// POST endpoint to exchange the one-time token for a session JWT
artifactsRouter.post('/:id/exchange', async (req, res) => {
  const { id } = req.params;
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const artifact = await db.artifacts.get(id);
  if (!artifact) {
    // Return generic error to prevent artifact enumeration
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const incomingHash = crypto.createHash('sha256').update(token).digest('hex');

  // Validate the token
  if (
    artifact.accessTokenHash !== incomingHash ||
    artifact.tokenUsed === true ||
    (artifact.accessTokenExpiresAt && new Date(artifact.accessTokenExpiresAt).getTime() < Date.now())
  ) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  // Mark token as used to prevent replay attacks
  artifact.tokenUsed = true;
  await db.artifacts.upsert(artifact);

  // Issue a JWT valid for 30 days
  const sessionToken = jwt.sign({ artifactId: artifact.id }, JWT_SECRET, { expiresIn: '30d' });

  return res.json({ success: true, sessionToken });
});

// Secure endpoint to fetch a single artifact with a JWT
artifactsRouter.get('/secure/:id', async (req, res) => {
  const { id } = req.params;
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.artifactId !== id) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const artifact = await db.artifacts.get(id);

  if (!artifact) {
    return res.status(404).json({ success: false, error: 'Artifact not found.' });
  }

  return res.json({ success: true, artifact });
});
