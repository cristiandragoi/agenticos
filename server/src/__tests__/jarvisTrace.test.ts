import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import jarvisRouter from '../routers/jarvis.js';

// Mock dependencies
vi.mock('../domains/conversations/service.js', () => ({
  conversationService: {
    appendMessage: vi.fn(async () => ({ id: 'msg-id' })),
    addStreamClient: vi.fn(),
    removeStreamClient: vi.fn(),
    getConversation: vi.fn(async () => ({ id: 'conv-test' }))
  }
}));

vi.mock('../domains/jarvis/intentRouter.js', () => ({
  intentRouter: {
    routeIntent: vi.fn(async () => ({
      route: 'direct',
      category: 'conversation',
      mode: 'direct_conversation',
      confidence: 0.9,
      reason: 'test'
    }))
  }
}));

const app = express();
app.use(express.json());
app.use('/api/jarvis', jarvisRouter);

describe('Jarvis Telemetry Tracing', () => {
  let logSpy: any;
  let warnSpy: any;
  let errorSpy: any;
  
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  it('logs the required telemetry for a successful direct request', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    // Mock fetch for OmniRoute success
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let called = false;
          return {
            read: async () => {
              if (!called) {
                called = true;
                return { done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"test answer"}}]}\n\n') };
              }
              return { done: true };
            }
          };
        }
      }
    });

    const res = await request(app)
      .post('/api/jarvis/conversations/conv-1/message/stream')
      .send({ prompt: 'hello test', operationId: 'test-req-123' })
      .set('referer', '/jarvis');

    expect(res.status).toBe(200);

    const logs = logSpy.mock.calls.map(c => c[0] + (c[1] ? ' ' + c[1] : ''));
    
    // Check request-received
    expect(logs.some(l => l.includes('[JarvisTrace] request-received') && l.includes('test-req-123'))).toBe(true);
    
    // Check intent-result
    expect(logs.some(l => l.includes('[JarvisTrace] intent-result') && l.includes('direct'))).toBe(true);
    
    // Check prompt-built
    expect(logs.some(l => l.includes('[JarvisTrace] prompt-built') && l.includes('test-req-123'))).toBe(true);
    
    // Check provider-attempt
    expect(logs.some(l => l.includes('[JarvisTrace] provider-attempt') && l.includes('omniRoute'))).toBe(true);
    
    // Check provider-response
    expect(logs.some(l => l.includes('[JarvisTrace] provider-response') && l.includes('completed'))).toBe(true);
    
    // Check response-rendered
    expect(logs.some(l => l.includes('[JarvisTrace] response-rendered') && l.includes('test answer'))).toBe(true);

    process.env.NODE_ENV = originalEnv;
  });

  it('logs provider-error and fallback attempts on failure', async () => {
    // Mock fetch for OmniRoute fail, then Ollama success
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    }).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let called = false;
          return {
            read: async () => {
              if (!called) {
                called = true;
                return { done: false, value: new TextEncoder().encode('{"response": "fallback answer"}\n') };
              }
              return { done: true };
            }
          };
        }
      }
    });

    await request(app)
      .post('/api/jarvis/conversations/conv-1/message/stream')
      .send({ prompt: 'hello test', operationId: 'test-req-fail' })
      .set('referer', '/jarvis');

    const logs = logSpy.mock.calls.map(c => c[0] + (c[1] ? ' ' + c[1] : ''));
    
    expect(logs.some(l => l.includes('[JarvisTrace] provider-error') && l.includes('omniRoute') && l.includes('failed'))).toBe(true);
    expect(logs.some(l => l.includes('[JarvisTrace] provider-attempt') && l.includes('ollama') && l.includes('"attempt": 2'))).toBe(true);
    expect(logs.some(l => l.includes('[JarvisTrace] response-rendered') && l.includes('<redacted in production>'))).toBe(true);
  });
});
