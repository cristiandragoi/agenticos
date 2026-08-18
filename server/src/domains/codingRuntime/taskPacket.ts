/**
 * domains/codingRuntime/taskPacket.ts — bounded repository instruction packet
 * (Phase 4).
 *
 * Assembles a BOUNDED task packet from project context + repository-level
 * instructions. Never injects huge duplicated prompts. The packet is
 * hashed and persisted with the run.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';

export interface TaskPacketInput {
  objective: string;
  projectContext?: string;
  constraints?: string[];
  acceptanceCriteria?: string;
  relevantFiles?: string[];
  allowedCommands?: string[];
  testCommands?: string[];
  securityRestrictions?: string[];
  workspacePath: string;
}

export interface TaskPacket {
  version: number;
  objective: string;
  projectContext: string;
  constraints: string[];
  acceptanceCriteria: string;
  relevantFiles: string[];
  allowedCommands: string[];
  testCommands: string[];
  securityRestrictions: string[];
  definitionOfDone: string;
  hash: string;
  assembledAt: string;
}

/** Read bounded repository instructions (AGENTS.md / CLAUDE.md, capped). */
function readRepoInstructions(workspacePath: string): string {
  const candidates = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'CONTRIBUTING.md'];
  let out = '';
  for (const name of candidates) {
    const p = path.join(workspacePath, name);
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8').slice(0, 8000);
        out += `\n--- ${name} (excerpt) ---\n${content}\n`;
      }
    } catch (err: any) {
      logger.warn(`[TaskPacket] failed to read ${name}: ${err.message}`);
    }
  }
  return out.slice(0, 24000);
}

export function buildTaskPacket(input: TaskPacketInput): TaskPacket {
  const repoInstr = readRepoInstructions(input.workspacePath);
  const constraints = [
    'Work ONLY inside the provided isolated worktree.',
    'Do not modify the parent/protected repository.',
    'Do not touch production credentials, .env secrets, deployment tokens.',
    'Do not push, merge protected branches, deploy, send messages, or make purchases.',
    'Run only approved development commands.',
    ...(input.constraints || []),
  ];
  const definitionOfDone = [
    'Acceptance criteria satisfied.',
    'Tests run with real process exit status.',
    'Diff produced for review.',
    'No secrets leaked; no protected branch modified.',
  ].join(' ');
  const packet: TaskPacket = {
    version: 1,
    objective: input.objective,
    projectContext: input.projectContext || '',
    constraints,
    acceptanceCriteria: input.acceptanceCriteria || '',
    relevantFiles: input.relevantFiles || [],
    allowedCommands: input.allowedCommands || ['git', 'npm', 'npx', 'node', 'tsc', 'vitest'],
    testCommands: input.testCommands || [],
    securityRestrictions: input.securityRestrictions || [],
    definitionOfDone,
    hash: '',
    assembledAt: new Date().toISOString(),
  };
  packet.hash = createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0, 16);
  return packet;
}

/** Render the packet as the bounded prompt handed to the coding worker. */
export function renderTaskPrompt(packet: TaskPacket): string {
  const parts = [
    `# Task\n${packet.objective}`,
  ];
  if (packet.projectContext) parts.push(`# Project context\n${packet.projectContext.slice(0, 4000)}`);
  if (packet.acceptanceCriteria) parts.push(`# Acceptance criteria\n${packet.acceptanceCriteria}`);
  if (packet.relevantFiles.length) parts.push(`# Relevant files\n${packet.relevantFiles.join('\n')}`);
  if (packet.allowedCommands.length) parts.push(`# Allowed commands\n${packet.allowedCommands.join(', ')}`);
  if (packet.testCommands.length) parts.push(`# Test commands (must run, real exit status)\n${packet.testCommands.join('\n')}`);
  parts.push(`# Constraints\n${packet.constraints.map((c) => `- ${c}`).join('\n')}`);
  if (packet.securityRestrictions.length) parts.push(`# Security restrictions\n${packet.securityRestrictions.map((c) => `- ${c}`).join('\n')}`);
  parts.push(`# Definition of done\n${packet.definitionOfDone}`);
  return parts.join('\n\n');
}
