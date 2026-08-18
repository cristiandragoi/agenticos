import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { legacyHeadersMiddleware } from '../middleware/legacyHeaders.js';

// Minimal setup to test the middleware
const app = express();
app.use(express.json());
app.use(legacyHeadersMiddleware);
app.post('/api/chat', (req, res) => res.json({ success: true }));

describe('Legacy Headers Middleware', () => {
  it('allows requests without legacy headers', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects requests with x-provider-keys', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('x-provider-keys', 'base64blob')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Legacy headers not allowed: x-provider-keys');
  });

  it('rejects requests with x-max-retries and x-degraded-timeout', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('x-max-retries', '5')
      .set('x-degraded-timeout', '1000')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('x-max-retries');
    expect(res.body.error).toContain('x-degraded-timeout');
  });
});
