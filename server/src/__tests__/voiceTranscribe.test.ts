import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Focused transcription contract tests for POST /api/voice/transcribe.
 *
 * The voice router imports the agent loop for /execute, so heavy deps are
 * mocked out — the transcribe handler itself is exercised end-to-end.
 * Global fetch is stubbed to simulate Deepgram responses; process.env is
 * used for the credential path, exactly as the handler reads it.
 */

const mocks = vi.hoisted(() => ({
  fetchImpl: undefined as ((url: any, init: any) => Promise<any>) | undefined,
}));

vi.mock('../services/agent/agentLoop.js', () => ({
  runAgentLoop: vi.fn(async () => ({ text: 'ok', provider: 'test', model: 'test', toolCalls: [] })),
}));

vi.mock('../data.js', () => ({
  mockAgents: [{ id: 'agent-jarvis', name: 'Jarvis' }],
}));

let voiceRouter: ReturnType<typeof express.Router>;

beforeEach(async () => {
  mocks.fetchImpl = undefined;
  (globalThis as any).fetch = (url: any, init: any) => {
    if (!mocks.fetchImpl) throw new Error('fetch not stubbed');
    return mocks.fetchImpl!(url, init);
  };
  process.env.DEEPGRAM_API_KEY = 'test-key';
  if (!voiceRouter) {
    const mod = await import('../routers/voice.js');
    voiceRouter = mod.default;
  }
});

function makeApp() {
  const e = express();
  e.use(express.json());
  e.use('/api/voice', voiceRouter);
  return e;
}

const WEBM_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);

describe('POST /api/voice/transcribe — transcription contract', () => {
  it('transcribes a valid webm upload: 200 + { text }', async () => {
    mocks.fetchImpl = async (url: any) => {
      expect(String(url)).toContain('api.deepgram.com/v1/listen');
      return {
        ok: true,
        json: async () => ({
          results: { channels: [{ alternatives: [{ transcript: 'hello jarvis' }] }] },
        }),
      };
    };

    const res = await request(makeApp())
      .post('/api/voice/transcribe')
      .attach('audio', WEBM_BYTES, { filename: 'audio.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'hello jarvis' });
  });

  it('valid audio but no speech → 400 with noSpeech:true flag', async () => {
    mocks.fetchImpl = async () => ({
      ok: true,
      json: async () => ({ results: { channels: [{ alternatives: [{ transcript: '' }] }] } }),
    });

    const res = await request(makeApp())
      .post('/api/voice/transcribe')
      .attach('audio', WEBM_BYTES, { filename: 'audio.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
    expect(res.body.noSpeech).toBe(true);
    expect(res.body.error).toBe('No speech detected.');
  });

  it('missing audio file → 400 (malformed request)', async () => {
    const res = await request(makeApp()).post('/api/voice/transcribe');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no audio/i);
  });

  it('missing DEEPGRAM_API_KEY → 500 (missing provider configuration)', async () => {
    delete process.env.DEEPGRAM_API_KEY;
    const res = await request(makeApp())
      .post('/api/voice/transcribe')
      .attach('audio', WEBM_BYTES, { filename: 'audio.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/key not configured/i);
  });

  it('forwards the multipart Content-Type to Deepgram (audio/webm)', async () => {
    let seenHeaders: Record<string, string> = {};
    let seenBody: any = null;
    mocks.fetchImpl = async (_url: any, init: any) => {
      seenHeaders = init.headers;
      seenBody = init.body;
      return {
        ok: true,
        json: async () => ({
          results: { channels: [{ alternatives: [{ transcript: 'x' }] }] },
        }),
      };
    };

    await request(makeApp())
      .post('/api/voice/transcribe')
      .attach('audio', WEBM_BYTES, { filename: 'audio.webm', contentType: 'audio/webm' });

    expect(seenHeaders['Content-Type']).toBe('audio/webm');
    expect(String(seenHeaders['Authorization'])).toMatch(/^Token /);
    // Authorization header must never echo the raw key into error responses
    // or logs; here we only assert its presence and scheme.
    expect(Buffer.from(seenBody).equals(WEBM_BYTES)).toBe(true);
  });

  it('Deepgram 401 → 502 upstream failure (not a client contract error)', async () => {
    mocks.fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'Invalid credentials' });
    const res = await request(makeApp())
      .post('/api/voice/transcribe')
      .attach('audio', WEBM_BYTES, { filename: 'audio.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/401/);
  });
});
