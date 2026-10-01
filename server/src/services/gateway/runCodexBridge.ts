#!/usr/bin/env node
/**
 * Standalone runner for the canonical AgenticOS Codex Bridge.
 * Usage: npx tsx src/services/gateway/runCodexBridge.ts
 */

import { startCodexBridgeServer, CODEX_BRIDGE_PORT } from './codexBridge.js';
import { logger } from '../../utils/logger.js';

async function main() {
  logger.info(`[CodexBridge:Runner] Starting canonical Codex Bridge on port ${CODEX_BRIDGE_PORT}...`);
  const started = await startCodexBridgeServer();
  if (started) {
    logger.info(`[CodexBridge:Runner] Canonical bridge running.`);
  } else {
    logger.error('[CodexBridge:Runner] Failed to start canonical bridge.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
