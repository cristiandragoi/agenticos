#!/usr/bin/env node
/**
 * cortex-mcp-server.mjs — Shared stdio JSON-RPC MCP Server for Cortex Suite & Hindsight.
 *
 * Connects Claude Code, VS Code Copilot, Antigravity, and Codex to the same local Cortex service.
 * Implements MCP stdio protocol (JSON-RPC 2.0).
 */

import readline from 'node:readline';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('D:\\AgenticOS', 'server', 'package.json'));
let Database = null;
try {
  Database = require('better-sqlite3');
} catch (e) {
  // fallback if installed elsewhere
  try { Database = (await import('better-sqlite3')).default; } catch {}
}

const DB_PATH = path.resolve('D:\\AgenticOS', '.cortex', 'memory.db');
const MEMORY_MD_PATH = path.resolve('D:\\AgenticOS', 'docs', 'lessons', 'MEMORY.md');

let db = null;
try {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (Database) {
    db = new Database(DB_PATH, { timeout: 5000 });
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
  }
} catch (e) {
  // Graceful degradation
}

const TOOLS = [
  {
    name: 'cortex_recall',
    description: 'Semantic and keyword search across Cortex engineering patterns, anti-patterns, and past technical decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or concept to search for' }
      },
      required: ['query']
    }
  },
  {
    name: 'cortex_get_anti_patterns',
    description: 'List known bug traps and anti-patterns for AgenticOS development.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Optional tag filter (e.g. voice, stt, email, self_heal)' }
      }
    }
  },
  {
    name: 'quartz_get_api_context',
    description: 'Retrieve AST symbol lookup and API context for a given symbol name or hint from AgenticOS source code.',
    inputSchema: {
      type: 'object',
      properties: {
        hint: { type: 'string', description: 'Symbol, function, or class name to inspect' }
      },
      required: ['hint']
    }
  },
  {
    name: 'quartz_search_symbols',
    description: 'Search indexed symbols across the AgenticOS codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol name query' }
      },
      required: ['query']
    }
  },
  {
    name: 'hindsight_get_lessons',
    description: 'Read persistent, validated engineering lessons from docs/lessons/MEMORY.md.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

function handleCallTool(name, args) {
  if (name === 'cortex_recall') {
    if (!db) return { content: [{ type: 'text', text: 'Cortex database unavailable.' }] };
    const q = `%${(args.query || '').trim()}%`;
    const rows = db.prepare('SELECT name, intent, body, tags FROM patterns WHERE name LIKE ? OR intent LIKE ? OR body LIKE ? LIMIT 10').all(q, q, q);
    const apRows = db.prepare('SELECT description, wrong, correct, tags FROM anti_patterns WHERE description LIKE ? OR wrong LIKE ? OR correct LIKE ? LIMIT 10').all(q, q, q);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ patterns: rows, anti_patterns: apRows }, null, 2)
      }]
    };
  }

  if (name === 'cortex_get_anti_patterns') {
    if (!db) return { content: [{ type: 'text', text: 'Cortex database unavailable.' }] };
    let rows;
    if (args.tag) {
      rows = db.prepare('SELECT id, description, wrong, correct, tags FROM anti_patterns WHERE tags LIKE ?').all(`%${args.tag}%`);
    } else {
      rows = db.prepare('SELECT id, description, wrong, correct, tags FROM anti_patterns').all();
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(rows, null, 2)
      }]
    };
  }

  if (name === 'quartz_get_api_context' || name === 'quartz_search_symbols') {
    if (!db) return { content: [{ type: 'text', text: 'Cortex database unavailable.' }] };
    const q = `%${(args.hint || args.query || '').trim()}%`;
    const rows = db.prepare('SELECT id, kind, name, module_path, summary FROM code_units WHERE name LIKE ? OR module_path LIKE ? OR summary LIKE ? LIMIT 20').all(q, q, q);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(rows, null, 2)
      }]
    };
  }

  if (name === 'hindsight_get_lessons') {
    if (fs.existsSync(MEMORY_MD_PATH)) {
      const text = fs.readFileSync(MEMORY_MD_PATH, 'utf-8');
      return { content: [{ type: 'text', text }] };
    }
    return { content: [{ type: 'text', text: 'No lessons recorded yet in MEMORY.md' }] };
  }

  return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const { id, method, params } = req;

    if (method === 'initialize') {
      const res = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'cortex-suite-agenticos', version: '1.0.0' },
          capabilities: { tools: {} }
        }
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      const res = {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const toolRes = handleCallTool(params?.name, params?.arguments || {});
      const res = {
        jsonrpc: '2.0',
        id,
        result: toolRes
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    // Default response for unhandled methods
    const res = {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    };
    process.stdout.write(JSON.stringify(res) + '\n');
  } catch (err) {
    // Ignore invalid JSON lines
  }
});
