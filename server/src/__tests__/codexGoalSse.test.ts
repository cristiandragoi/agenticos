import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let tmpRoot: string;
let baseUrl: string;
let server: http.Server;
let goalStore: typeof import('../services/goalStore.js').goalStore;

describe('CodeX goal SSE stream', () => {
  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-sse-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpRoot, 'test.db');

    const { db } = await import('../db/index.js');
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: path.resolve('server/drizzle') });

    goalStore = (await import('../services/goalStore.js')).goalStore;
    const router = (await import('../routers/chat.js')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/chat', router);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30000);

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it('opens with SSE headers and replays only events after the last known sequence', async () => {
    const goalId = 'goal-sse-focused';
    goalStore.create({
      id: goalId,
      originalGoal: 'SSE focused test',
      status: 'queued',
      retryCount: 0,
      providerFallbackCount: 0,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const writer = goalStore.createEventWriter({ goalId });
    writer.push({ state: 'planning', message: 'old event', eventType: 'planning_started' });
    writer.push({ state: 'executing', message: 'new event', eventType: 'tool_started', tool: 'runCommand' });

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/chat/agents/goal/stream/${goalId}?lastEventId=1`, {
      signal: controller.signal
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(response.headers.get('connection')).toContain('keep-alive');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      while (!text.includes('new event')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
      try { await reader.cancel(); } catch {}
    }

    expect(text).toContain('id: 2');
    expect(text).toContain('new event');
    expect(text).not.toContain('old event');
  });
});
