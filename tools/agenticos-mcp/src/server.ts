/**
 * server.ts — Agentic OS MCP STDIO server (Phase 1).
 *
 * Protocol: MCP over stdio (newline-delimited JSON-RPC 2.0).
 *   - stdout: protocol messages ONLY
 *   - stderr: sanitized diagnostics ONLY
 *
 * Tools: agenticos_health, agenticos_get_active_project,
 * agenticos_list_projects, agenticos_get_project_context,
 * agenticos_list_runs, agenticos_get_run, agenticos_get_run_result,
 * agenticos_prepare_task, agenticos_submit_prepared_task,
 * agenticos_cancel_run, agenticos_follow_run
 */

import { createInterface } from 'node:readline';
import { BackendClient, resolveBaseUrl } from './backend.js';
import { TOOLS, callTool } from './tools.js';
import { sanitizeError } from './redact.js';

const SERVER_NAME = 'agenticos';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';

export interface ServerConfig {
  baseUrl?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export class AgenticosMcpServer {
  private backend: BackendClient;
  private out: NodeJS.WritableStream;

  constructor(config: ServerConfig = {}) {
    this.backend = new BackendClient({ baseUrl: config.baseUrl });
    this.out = config.stdout ?? process.stdout;
  }

  private send(msg: unknown): void {
    this.out.write(`${JSON.stringify(msg)}\n`);
  }

  private logDiagnostic(msg: string): void {
    // sanitized diagnostics only — never env dumps or secrets
    try {
      const err = process.stderr;
      err.write(`[agenticos-mcp] ${sanitizeError(msg)}\n`);
    } catch { /* ignore */ }
  }

  async handleMessage(raw: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.logDiagnostic(`invalid JSON-RPC frame: ${raw.slice(0, 200)}`);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;

    if (method === 'initialize') {
      this.send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
      return;
    }

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return; // no response to notifications
    }

    if (method === 'ping') {
      this.send({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (method === 'tools/list') {
      this.send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
      return;
    }

    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const result = await callTool(String(name ?? ''), args, this.backend);
      this.send({ jsonrpc: '2.0', id, result });
      return;
    }

    if (method === 'resources/list' || method === 'prompts/list') {
      this.send({ jsonrpc: '2.0', id, result: { resources: [] } });
      return;
    }

    this.send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }

  start(): void {
    const stdin = process.stdin;
    const rl = createInterface({ input: stdin, terminal: false });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      this.handleMessage(line).catch((err) => {
        this.logDiagnostic(`handler error: ${sanitizeError(err)}`);
      });
    });
    rl.on('close', () => {
      this.logDiagnostic('stdin closed');
    });
  }
}

// Direct execution: `node dist/server.js` (or via bin)
const isMain = process.argv[1] && process.argv[1].endsWith('server.js');
if (isMain) {
  try {
    resolveBaseUrl(process.env.AGENTICOS_MCP_BASE_URL); // fail fast on bad config
  } catch (err: any) {
    process.stderr.write(`[agenticos-mcp] config error: ${sanitizeError(err)}\n`);
    process.exit(1);
  }
  const server = new AgenticosMcpServer();
  server.start();
}
