// Regression tests for Canonical Codex Bridge Adapter
// Tests TEST A (success), TEST B (quota failure), TEST C (turn failure), TEST D (empty upstream)
// Usage: npx tsx src/__tests__/codexBridgeAdapter.test.ts

import http from 'http';
import { EventEmitter } from 'events';
import { createBridgeRequestHandler, mapCodexError } from '../services/gateway/codexBridge.js';
import type WebSocket from 'ws';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ❌ ${name}: ${err?.message}`);
    failed++;
  }
}

/**
 * Creates a mock WebSocket client that mimics Codex app-server JSON-RPC session.
 */
function createMockWsClient(behavior: (ws: EventEmitter) => void): () => Promise<WebSocket> {
  return () => {
    return new Promise((resolve) => {
      const mockWs = new EventEmitter() as any;
      mockWs.off = mockWs.removeListener;
      mockWs.close = () => { mockWs.emit('close'); };

      mockWs.send = (dataStr: string) => {
        const msg = JSON.parse(dataStr);
        // Reply to JSON-RPC request methods
        if (msg.method === 'initialize') {
          setTimeout(() => {
            mockWs.emit('message', Buffer.from(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { userAgent: 'mock-codex', codexHome: '/mock' }
            })));
          }, 5);
        } else if (msg.method === 'thread/start') {
          setTimeout(() => {
            mockWs.emit('message', Buffer.from(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { thread: { id: 'mock-thread-1' } }
            })));
          }, 5);
        } else if (msg.method === 'turn/start') {
          setTimeout(() => {
            // Acknowledge turn/start response
            mockWs.emit('message', Buffer.from(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { turn: { id: 'mock-turn-1', status: 'inProgress' } }
            })));
            // Trigger test scenario behavior
            behavior(mockWs);
          }, 10);
        }
      };

      resolve(mockWs);
    });
  };
}

/**
 * Helper to perform an HTTP POST request to a running test server.
 */
function sendTestRequest(serverPort: number, body: any): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; json: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = raw ? JSON.parse(raw) : null;
          resolve({ statusCode: res.statusCode || 500, headers: res.headers, json });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

console.log('\n══════════════════════════════════════════════════');
console.log('  CODEX BRIDGE REGRESSION TEST SUITE');
console.log('══════════════════════════════════════════════════\n');

// ── TEST A: Upstream Success ──────────────────────────────────
await runTest('TEST A — Upstream Success (returns HTTP 200 + ASTRA_OK)', async () => {
  const wsFactory = createMockWsClient((ws) => {
    // Upstream emits delta and completed turn
    ws.emit('message', Buffer.from(JSON.stringify({
      method: 'item/agentMessage/delta',
      params: { delta: 'ASTRA_OK' }
    })));
    ws.emit('message', Buffer.from(JSON.stringify({
      method: 'turn/completed',
      params: { turn: { id: 'mock-turn-1', status: 'completed' } }
    })));
  });

  const handler = createBridgeRequestHandler(wsFactory);
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  try {
    const res = await sendTestRequest(port, {
      model: 'gpt-6-astra',
      messages: [{ role: 'user', content: 'Reply with exactly ASTRA_OK' }]
    });

    assert(res.statusCode === 200, `Expected HTTP 200, got ${res.statusCode}`);
    assert(res.json?.choices?.[0]?.message?.content === 'ASTRA_OK', `Expected content 'ASTRA_OK', got ${res.json?.choices?.[0]?.message?.content}`);
    assert(res.json?.model === 'gpt-6-astra', `Expected model 'gpt-6-astra', got ${res.json?.model}`);
  } finally {
    server.close();
  }
});

// ── TEST B: Quota Failure ─────────────────────────────────────
await runTest('TEST B — Quota Failure (returns HTTP 429 + usageLimitExceeded)', async () => {
  const wsFactory = createMockWsClient((ws) => {
    // Upstream emits error notification and failed turn
    ws.emit('message', Buffer.from(JSON.stringify({
      method: 'error',
      params: {
        error: {
          message: "You've hit your usage limit. Upgrade to Pro, visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
          codexErrorInfo: 'usageLimitExceeded'
        }
      }
    })));
    ws.emit('message', Buffer.from(JSON.stringify({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'mock-turn-1',
          status: 'failed',
          error: {
            message: "You've hit your usage limit. Upgrade to Pro, visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
            codexErrorInfo: 'usageLimitExceeded'
          }
        }
      }
    })));
  });

  const handler = createBridgeRequestHandler(wsFactory);
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  try {
    const res = await sendTestRequest(port, {
      model: 'gpt-6-astra',
      messages: [{ role: 'user', content: 'Reply with exactly ASTRA_OK' }]
    });

    assert(res.statusCode === 429, `Expected HTTP 429, got ${res.statusCode}`);
    assert(res.json?.error?.type === 'insufficient_quota', `Expected error.type 'insufficient_quota', got ${res.json?.error?.type}`);
    assert(res.json?.error?.code === 'usageLimitExceeded', `Expected error.code 'usageLimitExceeded', got ${res.json?.error?.code}`);
    assert(res.json?.error?.message?.includes('usage limit'), `Expected message to mention usage limit, got ${res.json?.error?.message}`);
    assert(!res.json?.choices, 'Must NOT contain choices');
  } finally {
    server.close();
  }
});

// ── TEST C: Upstream Turn Failure ─────────────────────────────
await runTest('TEST C — Upstream Turn Failure (returns non-200, no fabricated assistant response)', async () => {
  const wsFactory = createMockWsClient((ws) => {
    // Upstream turn fails with generic error
    ws.emit('message', Buffer.from(JSON.stringify({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'mock-turn-1',
          status: 'failed',
          error: { message: 'Internal upstream execution error' }
        }
      }
    })));
  });

  const handler = createBridgeRequestHandler(wsFactory);
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  try {
    const res = await sendTestRequest(port, {
      model: 'gpt-6-astra',
      messages: [{ role: 'user', content: 'Reply with exactly ASTRA_OK' }]
    });

    assert(res.statusCode !== 200, `Expected non-200 status, got ${res.statusCode}`);
    assert(!res.json?.choices, 'Must NOT fabricate choices or assistant message on failure');
    assert(Boolean(res.json?.error), 'Must return structured error object');
  } finally {
    server.close();
  }
});

// ── TEST D: Empty Upstream Completion ─────────────────────────
await runTest('TEST D — Empty Upstream Completion (returns non-200, NOT HTTP 200 + content:null)', async () => {
  const wsFactory = createMockWsClient((ws) => {
    // Upstream marks turn completed, but produces zero content and zero tool calls
    ws.emit('message', Buffer.from(JSON.stringify({
      method: 'turn/completed',
      params: { turn: { id: 'mock-turn-1', status: 'completed' } }
    })));
  });

  const handler = createBridgeRequestHandler(wsFactory);
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  try {
    const res = await sendTestRequest(port, {
      model: 'gpt-6-astra',
      messages: [{ role: 'user', content: 'Reply with exactly ASTRA_OK' }]
    });

    assert(res.statusCode !== 200, `Expected non-200 status, got ${res.statusCode}`);
    assert(!(res.statusCode === 200 && res.json?.choices?.[0]?.message?.content === null), 'Must NEVER return HTTP 200 + content:null');
    assert(Boolean(res.json?.error), 'Must return structured error payload');
  } finally {
    server.close();
  }
});

console.log('\n══════════════════════════════════════════════════');
console.log(`  TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log(`  RESULT: ${failed === 0 ? '✅ PASS' : '❌ FAIL'}`);
console.log('══════════════════════════════════════════════════\n');

process.exit(failed === 0 ? 0 : 1);
