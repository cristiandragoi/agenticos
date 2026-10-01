/**
 * codexBridge.ts
 *
 * Canonical in-process / managed bridge translating OpenAI-compatible HTTP requests
 * into Codex CLI app-server WebSocket JSON-RPC protocol.
 *
 * Exposes:
 *   GET  /v1/models
 *   POST /v1/chat/completions (supports streaming and dynamic tool calls)
 *
 * Uses authenticated ChatGPT Plus session on this machine (~/.codex/auth.json).
 *
 * LIFECYCLE: This module auto-spawns codex app-server on port 20129 if not
 * already running, and restarts it after unexpected exits.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';

export const CODEX_BRIDGE_PORT = 20130;
export const CODEX_APPSERVER_PORT = 20129;
export const CODEX_APPSERVER_WS = `ws://127.0.0.1:${CODEX_APPSERVER_PORT}`;

export interface CodexBridgeErrorPayload {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * Maps upstream errors and failure conditions into standardized OpenAI-compatible HTTP error responses.
 */
export function mapCodexError(
  errorMsg: string,
  codexErrorInfo?: string
): { statusCode: number; payload: CodexBridgeErrorPayload } {
  const rawMsg = errorMsg || 'Unknown upstream failure';
  const msgLower = rawMsg.toLowerCase();

  const isQuota =
    codexErrorInfo === 'usageLimitExceeded' ||
    msgLower.includes('usage limit') ||
    msgLower.includes('credits') ||
    msgLower.includes('quota');

  const isAuth =
    codexErrorInfo === 'authError' ||
    codexErrorInfo === 'unauthorized' ||
    msgLower.includes('unauthorized') ||
    msgLower.includes('authentication') ||
    msgLower.includes('not logged in');

  const isModelUnavailable =
    msgLower.includes('model is not supported') ||
    msgLower.includes('model not found') ||
    msgLower.includes('does not exist');

  if (isQuota) {
    return {
      statusCode: 429,
      payload: {
        error: {
          message: rawMsg,
          type: 'insufficient_quota',
          code: codexErrorInfo || 'usageLimitExceeded',
        },
      },
    };
  }

  if (isAuth) {
    return {
      statusCode: 401,
      payload: {
        error: {
          message: rawMsg,
          type: 'authentication_error',
          code: codexErrorInfo || 'unauthorized',
        },
      },
    };
  }

  if (isModelUnavailable) {
    return {
      statusCode: 404,
      payload: {
        error: {
          message: rawMsg,
          type: 'invalid_request_error',
          code: codexErrorInfo || 'model_not_found',
        },
      },
    };
  }

  return {
    statusCode: 502,
    payload: {
      error: {
        message: rawMsg,
        type: 'upstream_error',
        code: codexErrorInfo || 'upstream_failed',
      },
    },
  };
}

function getTokenFilePath(): string {
  const custom = process.env.OMNIROUTE_CODEX_APPSERVER_WS_TOKEN_FILE;
  if (custom && fs.existsSync(custom)) return custom;
  const standard = path.join(os.homedir(), '.codex', 'ws-token.txt');
  if (!fs.existsSync(standard)) {
    const dir = path.dirname(standard);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const randToken = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    fs.writeFileSync(standard, randToken, 'utf8');
  }
  return standard;
}

export function getCodexCapabilityToken(): string {
  try {
    const p = getTokenFilePath();
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

// ── Codex App-Server Lifecycle Manager ───────────────────────────────────────

let appServerProcess: ChildProcess | null = null;
let appServerRestarting = false;

/**
 * Check if port 20129 is already accepting connections (externally managed or
 * previously spawned instance that survived a bridge restart).
 */
export function isAppServerPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: CODEX_APPSERVER_PORT }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
  });
}

/**
 * Spawn codex app-server as a managed child process.
 * Automatically restarts on unexpected exit (up to 5 times with backoff).
 */
export async function spawnAppServer(attempt = 0): Promise<void> {
  // HARD INVARIANT: CODEX_INVOCATION_DISABLED=true
  logger.info('[CodexBridge] spawnAppServer skipped: CODEX_INVOCATION_DISABLED=true');
  return;

  const tokenFile = getTokenFilePath();

  const [spawnCmd, spawnArgList]: [string, string[]] = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'codex', 'app-server',
        '--listen', `ws://127.0.0.1:${CODEX_APPSERVER_PORT}`,
        '--ws-auth', 'capability-token',
        '--ws-token-file', tokenFile
      ]]
    : ['codex', ['app-server',
        '--listen', `ws://127.0.0.1:${CODEX_APPSERVER_PORT}`,
        '--ws-auth', 'capability-token',
        '--ws-token-file', tokenFile
      ]];

  const child = spawn(spawnCmd, spawnArgList, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true
  });

  appServerProcess = child;

  child.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) logger.info(`[codex-app-server] ${line}`);
  });
  child.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) logger.warn(`[codex-app-server] ${line}`);
  });

  child.on('exit', (code, signal) => {
    if (appServerProcess === child) appServerProcess = null;
    if (code === 0 || appServerRestarting) return;
    const maxRestarts = 5;
    if (attempt < maxRestarts) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      logger.warn(`[CodexBridge] codex app-server exited (code=${code}, signal=${signal}). Restart in ${delay}ms (attempt ${attempt + 1}/${maxRestarts})`);
      setTimeout(() => spawnAppServer(attempt + 1), delay);
    } else {
      logger.error(`[CodexBridge] codex app-server failed ${maxRestarts} times. Will not auto-restart. Jarvis will degrade to fallback provider.`);
    }
  });

  // Wait up to 5s for port to become available
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await isAppServerPortOpen()) {
      logger.info('[CodexBridge] codex app-server is accepting connections');
      return;
    }
  }
  logger.warn('[CodexBridge] codex app-server did not open port 20129 within 5 seconds');
}

export let bridgeServer: http.Server | null = null;

export function createWsClient(customWsUrl?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const token = getCodexCapabilityToken();
    const targetUrl = customWsUrl || CODEX_APPSERVER_WS;
    const ws = new WebSocket(targetUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

export function extractPrompt(messages: any[]): string {
  if (!Array.isArray(messages)) return '';
  return messages.map(m => `${m.role ? m.role.toUpperCase() : 'USER'}: ${m.content || ''}`).join('\n\n');
}

export function mapToolsToDynamic(tools: any[]): any[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter(t => t.type === 'function' && t.function).map(t => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description || '',
    inputSchema: t.function.parameters || { type: 'object', properties: {} }
  }));
}

/**
 * Creates the HTTP request handler for the OpenAI-compatible bridge.
 */
export function createBridgeRequestHandler(wsFactory: (url?: string) => Promise<WebSocket> = createWsClient) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-6-astra', object: 'model', owned_by: 'openai' },
          { id: 'codex-chatgpt', object: 'model', owned_by: 'openai' }
        ]
      }));
      return;
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let bodyText = '';
      req.on('data', chunk => { bodyText += chunk; });
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyText);
          const stream = !!body.stream;
          const prompt = extractPrompt(body.messages);
          const dynamicTools = mapToolsToDynamic(body.tools);
          const hasTools = dynamicTools.length > 0;
          const requestedModel = body.model || 'gpt-6-astra';

          logger.info(`[CodexBridge] Handling ${requestedModel} completion request (stream=${stream})`);

          const ws = await wsFactory();
          let nextId = 1;

          const sendReq = (method: string, params: any): Promise<any> => {
            return new Promise((resReq, rejReq) => {
              const id = nextId++;
              const handler = (data: WebSocket.Data) => {
                const msg = JSON.parse(data.toString());
                if (msg.id === id) {
                  ws.off('message', handler);
                  if (msg.error) rejReq(new Error(msg.error.message || JSON.stringify(msg.error)));
                  else resReq(msg.result);
                }
              };
              ws.on('message', handler);
              ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
            });
          };

          await sendReq('initialize', {
            clientInfo: { name: 'agenticos-bridge', title: null, version: '1.0' },
            capabilities: hasTools ? { experimentalApi: true } : null
          });

          const threadRes = await sendReq('thread/start', {
            cwd: process.env.WORKSPACE_ROOT || 'D:\\AgenticOS',
            approvalPolicy: 'never',
            sandbox: 'workspace-write',
            ...(hasTools ? { dynamicTools } : {})
          });
          const threadId = threadRes?.thread?.id || threadRes?.threadId;

          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });

            ws.on('message', (data) => {
              try {
                const msg = JSON.parse(data.toString());
                if (msg.method === 'item/agentMessage/delta') {
                  const delta = msg.params?.delta || '';
                  const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: requestedModel,
                    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                  };
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                } else if (msg.method === 'item/tool/call') {
                  const toolParams = msg.params || {};
                  const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: requestedModel,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: 0,
                          id: toolParams.callId || `call_${Date.now()}`,
                          type: 'function',
                          function: {
                            name: toolParams.tool,
                            arguments: typeof toolParams.arguments === 'string' ? toolParams.arguments : JSON.stringify(toolParams.arguments || {})
                          }
                        }]
                      },
                      finish_reason: 'tool_calls'
                    }]
                  };
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                  ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: { content: 'tool call forwarded' }
                  }));
                } else if (msg.method === 'error') {
                  const errObj = msg.params?.error;
                  const errMsg = errObj?.message || 'Upstream error';
                  const { payload } = mapCodexError(errMsg, errObj?.codexErrorInfo);
                  logger.warn(`[CodexBridge:Stream] Forwarding upstream error: ${errMsg}`);
                  res.write(`data: ${JSON.stringify(payload)}\n\n`);
                  res.end();
                  ws.close();
                } else if (msg.method === 'turn/completed') {
                  const turn = msg.params?.turn;
                  if (turn?.status === 'failed' || turn?.error) {
                    const errMsg = turn?.error?.message || 'Turn execution failed';
                    const { payload } = mapCodexError(errMsg, turn?.error?.codexErrorInfo);
                    logger.warn(`[CodexBridge:Stream] Forwarding turn failure: ${errMsg}`);
                    res.write(`data: ${JSON.stringify(payload)}\n\n`);
                    res.end();
                    ws.close();
                    return;
                  }
                  const finishChunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: requestedModel,
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                  };
                  res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
                  res.write('data: [DONE]\n\n');
                  res.end();
                  ws.close();
                }
              } catch {
                // Frame parse error
              }
            });

            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: nextId++,
              method: 'turn/start',
              params: {
                threadId,
                input: [{ type: 'text', text: prompt, text_elements: [] }],
                model: requestedModel
              }
            }));
          } else {
            // Non-streaming
            let fullContent = '';
            const toolCalls: any[] = [];
            let lastError: { message: string; codexErrorInfo?: string } | null = null;

            ws.on('message', (data) => {
              try {
                const msg = JSON.parse(data.toString());

                if (msg.method === 'item/agentMessage/delta') {
                  fullContent += (msg.params?.delta || '');
                } else if (msg.method === 'item/completed' && msg.params?.item?.type === 'agentMessage') {
                  const contents = msg.params?.item?.content;
                  if (Array.isArray(contents)) {
                    for (const part of contents) {
                      if (part.type === 'text' && typeof part.text === 'string' && !fullContent.includes(part.text)) {
                        fullContent += part.text;
                      }
                    }
                  }
                } else if (msg.method === 'item/tool/call') {
                  const tp = msg.params || {};
                  toolCalls.push({
                    id: tp.callId || `call_${Date.now()}`,
                    type: 'function',
                    function: {
                      name: tp.tool,
                      arguments: typeof tp.arguments === 'string' ? tp.arguments : JSON.stringify(tp.arguments || {})
                    }
                  });
                  ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: { content: 'tool call forwarded' }
                  }));
                } else if (msg.method === 'error') {
                  const errObj = msg.params?.error;
                  const errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || JSON.stringify(errObj || 'Codex error'));
                  lastError = { message: errMsg, codexErrorInfo: errObj?.codexErrorInfo };
                  logger.warn(`[CodexBridge] Upstream error notification: ${errMsg}`);
                } else if (msg.method === 'turn/completed') {
                  const turn = msg.params?.turn;
                  const isFailed = turn?.status === 'failed';
                  const turnErr = turn?.error;

                  // Handle upstream failure
                  if (isFailed || turnErr || lastError) {
                    const errorMsg = turnErr?.message || lastError?.message || 'Turn execution failed upstream';
                    const codexCode = turnErr?.codexErrorInfo || lastError?.codexErrorInfo;
                    const { statusCode, payload } = mapCodexError(errorMsg, codexCode);

                    logger.warn(`[CodexBridge] Emitting HTTP ${statusCode} for upstream error: ${errorMsg}`);
                    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(payload));
                    ws.close();
                    return;
                  }

                  // Handle empty output without error (never emit HTTP 200 with content: null)
                  if (!fullContent && toolCalls.length === 0) {
                    logger.warn('[CodexBridge] Upstream turn completed with empty output');
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      error: {
                        message: 'Upstream model returned empty output without completion',
                        type: 'upstream_empty_response',
                        code: 'empty_response',
                      },
                    }));
                    ws.close();
                    return;
                  }

                  // Successful completion
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  const choice = {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: fullContent,
                      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
                    },
                    finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
                  };
                  res.end(JSON.stringify({
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: requestedModel,
                    choices: [choice],
                    usage: {
                      prompt_tokens: prompt.length,
                      completion_tokens: fullContent.length,
                      total_tokens: prompt.length + fullContent.length
                    }
                  }));
                  ws.close();
                }
              } catch (parseErr) {
                logger.error('[CodexBridge] Message parsing error:', parseErr);
              }
            });

            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: nextId++,
              method: 'turn/start',
              params: {
                threadId,
                input: [{ type: 'text', text: prompt, text_elements: [] }],
                model: requestedModel
              }
            }));
          }
        } catch (err: any) {
          logger.error(`[CodexBridge] Handler error: ${err?.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message, type: 'bridge_internal_error', code: 'internal_error' } }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  };
}

/**
 * Starts the HTTP-to-WebSocket bridge server on CODEX_BRIDGE_PORT if not already running.
 * Also ensures codex app-server is spawned and managed.
 */
export async function startCodexBridgeServer(): Promise<boolean> {
  // HARD INVARIANT: CODEX_INVOCATION_DISABLED=true
  logger.info('[CodexBridge] startCodexBridgeServer disabled: CODEX_INVOCATION_DISABLED=true');
  return false;
}

export function stopCodexBridgeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (bridgeServer) {
      bridgeServer.close(() => {
        bridgeServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
