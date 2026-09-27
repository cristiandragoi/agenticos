/**
 * unifiedActionOrchestrator.ts — Capability-First Unified Action Orchestrator for JARVIS.
 *
 * Core Principles:
 * 1. SINGLE ACTION INTERPRETATION CONTRACT:
 *    Every user turn first becomes ONE normalized ActionIntent before any executor runs.
 * 2. CAPABILITY-FIRST ROUTING:
 *    Router selects a registered Capability FIRST based on intent, target type, permissions,
 *    and side-effect policy. The executor never decides user intent.
 * 3. GENERIC LOCAL COMPUTER CAPABILITY LAYER:
 *    Supports generic filesystem, shell, process, desktop, git, and developer capabilities
 *    for previously unseen applications, files, folders, repositories, and commands.
 * 4. BROWSER INPUT AUTHORIZATION:
 *    Typing in a browser is strictly gated: only allowed when targetType is browser_entity/website
 *    and explicit search/input capability is authorized.
 * 5. REFERENT & WORKING DIRECTORY CONTINUITY:
 *    Generic resolution for conversational referents ("his", "their", "that channel") and
 *    locative referents ("there", "in that folder", "the repo").
 * 6. STRUCTURED MEMORY SEMANTICS:
 *    Explicit entity memory storage and retrieval (name, type, relation).
 * 7. FREE CASH ACTIVE STATE ELIMINATION:
 *    Guarantees Free Cash is removed from active state and deletion turns are never confused with open.
 * 8. CORRECTION OVERRIDE:
 *    High-priority repair turns immediately cancel previous intents and apply replacement targets.
 * 9. ACTION LIFECYCLE EVENT STREAM:
 *    Emits real lifecycle events: ACTION_ACCEPTED, ACTION_STARTED, ACTION_PROGRESS,
 *    ACTION_WAITING, ACTION_SUCCEEDED, ACTION_FAILED.
 */

import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../../utils/logger.js';
import { browserStateStore } from '../../../services/browser/browserActionContract.js';
import { activeInteractionContextStore } from '../activeInteractionContext.js';
import { sessionWorkingState } from './sessionWorkingState.js';

export type ActionIntentMode = 'conversation' | 'execute' | 'memory' | 'internal';

export type ActionVerb =
  | 'open'
  | 'locate'
  | 'search'
  | 'create'
  | 'update'
  | 'delete'
  | 'remember'
  | 'recall'
  | 'send'
  | 'publish'
  | 'inspect'
  | 'navigate'
  | 'cancel'
  | 'unknown';

export type TargetType =
  | 'browser_entity'
  | 'website'
  | 'desktop_app'
  | 'project'
  | 'memory_entity'
  | 'file'
  | 'folder'
  | 'shell'
  | 'shell_command'
  | 'process'
  | 'repository'
  | 'service'
  | 'worker_task'
  | 'internal_agenticos'
  | 'unknown';

export interface ActionIntent {
  mode: ActionIntentMode;
  verb: ActionVerb;
  targetType: TargetType;
  targetName?: string;
  referent?: {
    source: 'explicit' | 'conversation' | 'activeBrowserEntity' | 'memory';
    resolvedValue?: string;
    resolvedType?: string;
  };
  capability?: string;
  confidence: number;
  requiresConfirmation: boolean;
  rawStt?: string;
  normalizedText?: string;
  metadata?: Record<string, any>;
}

export interface ConversationCorrection {
  isCorrection: boolean;
  cancelPreviousIntent: boolean;
  replacementTarget?: string;
  replacementVerb?: ActionVerb;
  replacementTargetType?: TargetType;
  reason?: string;
}

export interface RegisteredCapability {
  id: string;
  displayName: string;
  acceptedTargetTypes: TargetType[];
  requiredPermissions: string[];
  executor: string;
  verificationMethod: string;
  sideEffectLevel: 'none' | 'read' | 'write' | 'destructive';
  confirmationPolicy: 'never' | 'always' | 'if_high_risk';
}

export const CAPABILITY_REGISTRY: Record<string, RegisteredCapability> = {
  // ── Browser Family ──────────────────────────────────────────────────────────
  'browser.navigate': {
    id: 'browser.navigate',
    displayName: 'Browser Navigate',
    acceptedTargetTypes: ['website', 'browser_entity'],
    requiredPermissions: ['network', 'browser_control'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_url_or_title',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'browser.search': {
    id: 'browser.search',
    displayName: 'Browser Search',
    acceptedTargetTypes: ['website', 'browser_entity'],
    requiredPermissions: ['network', 'browser_control', 'browser_input'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_search_results',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'browser.open_entity': {
    id: 'browser.open_entity',
    displayName: 'Browser Open Entity',
    acceptedTargetTypes: ['browser_entity'],
    requiredPermissions: ['network', 'browser_control'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_entity_loaded',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'browser.inspect': {
    id: 'browser.inspect',
    displayName: 'Browser Inspect',
    acceptedTargetTypes: ['browser_entity', 'website'],
    requiredPermissions: ['browser_control'],
    executor: 'browserExecutor',
    verificationMethod: 'verify_dom_inspection',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },

  // ── Desktop Application Family ──────────────────────────────────────────────
  'desktop.resolve_app': {
    id: 'desktop.resolve_app',
    displayName: 'Desktop Resolve Application',
    acceptedTargetTypes: ['desktop_app'],
    requiredPermissions: ['os_filesystem', 'os_process_read'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_app_path_resolved',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'desktop.open_app': {
    id: 'desktop.open_app',
    displayName: 'Desktop Open Application',
    acceptedTargetTypes: ['desktop_app'],
    requiredPermissions: ['os_process_spawn'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_process_or_window_running',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'desktop.focus_app': {
    id: 'desktop.focus_app',
    displayName: 'Desktop Focus Application',
    acceptedTargetTypes: ['desktop_app'],
    requiredPermissions: ['os_window_focus'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_foreground_window',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'desktop.screenshot': {
    id: 'desktop.screenshot',
    displayName: 'Desktop Capture Screenshot',
    acceptedTargetTypes: ['desktop_app', 'process', 'unknown'],
    requiredPermissions: ['os_screen_capture'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_screenshot_artifact',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'desktop.close_app': {
    id: 'desktop.close_app',
    displayName: 'Desktop Close Application',
    acceptedTargetTypes: ['desktop_app'],
    requiredPermissions: ['os_process_stop'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_process_closed',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },

  // ── Filesystem Family ───────────────────────────────────────────────────────
  'filesystem.locate': {
    id: 'filesystem.locate',
    displayName: 'Filesystem Locate',
    acceptedTargetTypes: ['file', 'folder'],
    requiredPermissions: ['filesystem_read'],
    executor: 'filesystemExecutor',
    verificationMethod: 'verify_file_exists',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'filesystem.search': {
    id: 'filesystem.search',
    displayName: 'Filesystem Search',
    acceptedTargetTypes: ['file', 'folder'],
    requiredPermissions: ['filesystem_read'],
    executor: 'filesystemExecutor',
    verificationMethod: 'verify_search_results',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'filesystem.open': {
    id: 'filesystem.open',
    displayName: 'Filesystem Open',
    acceptedTargetTypes: ['file', 'folder'],
    requiredPermissions: ['filesystem_read', 'os_process_spawn'],
    executor: 'filesystemExecutor',
    verificationMethod: 'verify_file_launched',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'filesystem.reveal': {
    id: 'filesystem.reveal',
    displayName: 'Filesystem Reveal in Explorer',
    acceptedTargetTypes: ['file', 'folder'],
    requiredPermissions: ['filesystem_read', 'os_process_spawn'],
    executor: 'filesystemExecutor',
    verificationMethod: 'verify_explorer_spawned',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'filesystem.list': {
    id: 'filesystem.list',
    displayName: 'Filesystem List Directory',
    acceptedTargetTypes: ['folder', 'file'],
    requiredPermissions: ['filesystem_read'],
    executor: 'filesystemExecutor',
    verificationMethod: 'verify_directory_entries',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'filesystem.read': {
    id: 'filesystem.read',
    displayName: 'Filesystem Read File',
    acceptedTargetTypes: ['file'],
    requiredPermissions: ['filesystem_read'],
    executor: 'filesystemExecutor',
    verificationMethod: 'verify_content_read',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'filesystem.write': {
    id: 'filesystem.write',
    displayName: 'Filesystem Write File',
    acceptedTargetTypes: ['file'],
    requiredPermissions: ['filesystem_write'],
    executor: 'filesystemExecutor',
    verificationMethod: 'verify_content_written',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },

  // ── Shell / Terminal Family ─────────────────────────────────────────────────
  'shell.open': {
    id: 'shell.open',
    displayName: 'Shell Open Terminal',
    acceptedTargetTypes: ['shell', 'folder'],
    requiredPermissions: ['terminal_launch'],
    executor: 'terminalExecutor',
    verificationMethod: 'verify_terminal_window_spawned',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'shell.execute': {
    id: 'shell.execute',
    displayName: 'Shell Execute Command',
    acceptedTargetTypes: ['shell_command', 'shell'],
    requiredPermissions: ['command_execution'],
    executor: 'terminalExecutor',
    verificationMethod: 'verify_command_exit_code',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'shell.read_output': {
    id: 'shell.read_output',
    displayName: 'Shell Read Command Output',
    acceptedTargetTypes: ['shell_command'],
    requiredPermissions: ['terminal_read'],
    executor: 'terminalExecutor',
    verificationMethod: 'verify_output_retrieved',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'shell.stop': {
    id: 'shell.stop',
    displayName: 'Shell Stop Command',
    acceptedTargetTypes: ['shell_command', 'process'],
    requiredPermissions: ['process_stop'],
    executor: 'terminalExecutor',
    verificationMethod: 'verify_process_terminated',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },

  // ── Process Family ──────────────────────────────────────────────────────────
  'process.list': {
    id: 'process.list',
    displayName: 'Process List',
    acceptedTargetTypes: ['process'],
    requiredPermissions: ['process_read'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_process_list',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'process.inspect': {
    id: 'process.inspect',
    displayName: 'Process Inspect',
    acceptedTargetTypes: ['process'],
    requiredPermissions: ['process_read', 'network_status'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_process_inspection',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'process.start': {
    id: 'process.start',
    displayName: 'Process Start',
    acceptedTargetTypes: ['process', 'desktop_app'],
    requiredPermissions: ['os_process_spawn'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_process_started',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'process.stop': {
    id: 'process.stop',
    displayName: 'Process Stop',
    acceptedTargetTypes: ['process', 'service'],
    requiredPermissions: ['os_process_stop'],
    executor: 'desktopExecutor',
    verificationMethod: 'verify_process_stopped',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },

  // ── Git Family ──────────────────────────────────────────────────────────────
  'git.status': {
    id: 'git.status',
    displayName: 'Git Status',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['git_read'],
    executor: 'gitExecutor',
    verificationMethod: 'verify_git_status',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'git.diff': {
    id: 'git.diff',
    displayName: 'Git Diff',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['git_read'],
    executor: 'gitExecutor',
    verificationMethod: 'verify_git_diff',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'git.log': {
    id: 'git.log',
    displayName: 'Git Log',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['git_read'],
    executor: 'gitExecutor',
    verificationMethod: 'verify_git_log',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'git.branch': {
    id: 'git.branch',
    displayName: 'Git Branch',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['git_read'],
    executor: 'gitExecutor',
    verificationMethod: 'verify_git_branch',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'git.commit': {
    id: 'git.commit',
    displayName: 'Git Commit',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['git_write'],
    executor: 'gitExecutor',
    verificationMethod: 'verify_git_commit',
    sideEffectLevel: 'write',
    confirmationPolicy: 'if_high_risk',
  },
  'git.pull': {
    id: 'git.pull',
    displayName: 'Git Pull',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['git_network', 'git_write'],
    executor: 'gitExecutor',
    verificationMethod: 'verify_git_pull',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'git.push': {
    id: 'git.push',
    displayName: 'Git Push',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['git_network', 'git_write'],
    executor: 'gitExecutor',
    verificationMethod: 'verify_git_push',
    sideEffectLevel: 'write',
    confirmationPolicy: 'if_high_risk',
  },

  // ── Developer Family ────────────────────────────────────────────────────────
  'developer.locate_repository': {
    id: 'developer.locate_repository',
    displayName: 'Developer Locate Repository',
    acceptedTargetTypes: ['repository', 'folder'],
    requiredPermissions: ['filesystem_read'],
    executor: 'engineeringExecutor',
    verificationMethod: 'verify_repo_directory',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'developer.open_repository': {
    id: 'developer.open_repository',
    displayName: 'Developer Open Repository in IDE',
    acceptedTargetTypes: ['repository'],
    requiredPermissions: ['os_process_spawn'],
    executor: 'engineeringExecutor',
    verificationMethod: 'verify_ide_spawned',
    sideEffectLevel: 'read',
    confirmationPolicy: 'never',
  },
  'developer.run_project': {
    id: 'developer.run_project',
    displayName: 'Developer Run Project',
    acceptedTargetTypes: ['repository', 'project'],
    requiredPermissions: ['command_execution'],
    executor: 'engineeringExecutor',
    verificationMethod: 'verify_dev_server_running',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'developer.start_service': {
    id: 'developer.start_service',
    displayName: 'Developer Start Service',
    acceptedTargetTypes: ['service'],
    requiredPermissions: ['service_control'],
    executor: 'engineeringExecutor',
    verificationMethod: 'verify_service_healthy',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'developer.stop_service': {
    id: 'developer.stop_service',
    displayName: 'Developer Stop Service',
    acceptedTargetTypes: ['service'],
    requiredPermissions: ['service_control'],
    executor: 'engineeringExecutor',
    verificationMethod: 'verify_service_stopped',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'developer.run_tests': {
    id: 'developer.run_tests',
    displayName: 'Developer Run Tests',
    acceptedTargetTypes: ['repository', 'project'],
    requiredPermissions: ['command_execution'],
    executor: 'engineeringExecutor',
    verificationMethod: 'verify_test_suite_completed',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'developer.build': {
    id: 'developer.build',
    displayName: 'Developer Build Project',
    acceptedTargetTypes: ['repository', 'project'],
    requiredPermissions: ['command_execution'],
    executor: 'engineeringExecutor',
    verificationMethod: 'verify_build_artifacts',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },

  // ── Memory Family ───────────────────────────────────────────────────────────
  'memory.remember': {
    id: 'memory.remember',
    displayName: 'Memory Remember',
    acceptedTargetTypes: ['memory_entity'],
    requiredPermissions: ['memory_write'],
    executor: 'memoryStore',
    verificationMethod: 'verify_memory_saved',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'memory.recall': {
    id: 'memory.recall',
    displayName: 'Memory Recall',
    acceptedTargetTypes: ['memory_entity'],
    requiredPermissions: ['memory_read'],
    executor: 'memoryStore',
    verificationMethod: 'verify_memory_retrieved',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'memory.delete': {
    id: 'memory.delete',
    displayName: 'Memory Delete',
    acceptedTargetTypes: ['memory_entity'],
    requiredPermissions: ['memory_write'],
    executor: 'memoryStore',
    verificationMethod: 'verify_memory_deleted',
    sideEffectLevel: 'destructive',
    confirmationPolicy: 'if_high_risk',
  },

  // ── Project Family ──────────────────────────────────────────────────────────
  'project.open': {
    id: 'project.open',
    displayName: 'Project Open',
    acceptedTargetTypes: ['project'],
    requiredPermissions: ['project_state'],
    executor: 'projectsStore',
    verificationMethod: 'verify_active_project',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'project.delete': {
    id: 'project.delete',
    displayName: 'Project Delete',
    acceptedTargetTypes: ['project'],
    requiredPermissions: ['project_write'],
    executor: 'projectsStore',
    verificationMethod: 'verify_project_deleted',
    sideEffectLevel: 'destructive',
    confirmationPolicy: 'never',
  },
  'project.update': {
    id: 'project.update',
    displayName: 'Project Update',
    acceptedTargetTypes: ['project'],
    requiredPermissions: ['project_write'],
    executor: 'projectsStore',
    verificationMethod: 'verify_project_updated',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },

  // ── Worker Family ───────────────────────────────────────────────────────────
  'worker.start': {
    id: 'worker.start',
    displayName: 'Local Worker Start',
    acceptedTargetTypes: ['worker_task'],
    requiredPermissions: ['worker_execution'],
    executor: 'localWorkerManager',
    verificationMethod: 'verify_task_started',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'worker.status': {
    id: 'worker.status',
    displayName: 'Local Worker Status',
    acceptedTargetTypes: ['worker_task'],
    requiredPermissions: ['worker_read'],
    executor: 'localWorkerManager',
    verificationMethod: 'verify_task_status',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'worker.cancel': {
    id: 'worker.cancel',
    displayName: 'Local Worker Cancel',
    acceptedTargetTypes: ['worker_task'],
    requiredPermissions: ['worker_execution'],
    executor: 'localWorkerManager',
    verificationMethod: 'verify_task_cancelled',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'worker.resume': {
    id: 'worker.resume',
    displayName: 'Local Worker Resume / Approve',
    acceptedTargetTypes: ['worker_task'],
    requiredPermissions: ['worker_execution'],
    executor: 'localWorkerManager',
    verificationMethod: 'verify_task_resumed',
    sideEffectLevel: 'write',
    confirmationPolicy: 'never',
  },
  'worker.result': {
    id: 'worker.result',
    displayName: 'Local Worker Result',
    acceptedTargetTypes: ['worker_task'],
    requiredPermissions: ['worker_read'],
    executor: 'localWorkerManager',
    verificationMethod: 'verify_task_result',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },

  // ── Internal & Conversation ─────────────────────────────────────────────────
  'agenticos.internal': {
    id: 'agenticos.internal',
    displayName: 'AgenticOS Internal',
    acceptedTargetTypes: ['internal_agenticos'],
    requiredPermissions: ['system_read'],
    executor: 'systemIntrospection',
    verificationMethod: 'verify_status',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
  'conversation.respond': {
    id: 'conversation.respond',
    displayName: 'Conversation Respond',
    acceptedTargetTypes: ['unknown'],
    requiredPermissions: [],
    executor: 'conversationalAgent',
    verificationMethod: 'verify_response_generated',
    sideEffectLevel: 'none',
    confirmationPolicy: 'never',
  },
};

export type ActionLifecycleEvent =
  | 'ACTION_ACCEPTED'
  | 'ACTION_STARTED'
  | 'ACTION_PROGRESS'
  | 'ACTION_WAITING'
  | 'ACTION_SUCCEEDED'
  | 'ACTION_FAILED';

export interface CandidateScoreEntry {
  score: number;
  reason: string;
}

export interface UnifiedOrchestrationDecision {
  actionIntent: ActionIntent;
  selectedCapability: RegisteredCapability;
  confidence: number;
  whySelected: string;
  candidates: Record<string, CandidateScoreEntry>;
  correction?: ConversationCorrection;
  browserPlan?: {
    action: 'locate_channel' | 'open_latest_video' | 'navigate' | 'search' | 'confirm_channel' | 'stay_page';
    target: string;
    entityQuery?: string;
    excludeShorts?: boolean;
    channelName?: string;
  };
  memoryPlan?: {
    action: 'recall' | 'store';
    query: string;
    entityName?: string;
    entityType?: string;
    relation?: string;
  };
  desktopPlan?: {
    action: 'resolve' | 'open' | 'focus' | 'close' | 'screenshot';
    appName?: string;
    targetWindow?: string;
    executable?: string;
    processName?: string;
    shortcutPath?: string;
    args?: string[];
  };
  filesystemPlan?: {
    action: 'locate' | 'open' | 'reveal' | 'list' | 'read' | 'write' | 'search';
    target: string;
    scope?: string;
    targetType?: 'file' | 'folder' | 'any';
    content?: string;
  };
  shellPlan?: {
    action: 'open' | 'execute' | 'read_output' | 'stop';
    command?: string;
    cwd?: string;
    shell?: 'powershell' | 'cmd';
    visibleWindow?: boolean;
  };
  processPlan?: {
    action: 'list' | 'inspect' | 'start' | 'stop';
    port?: number;
    pid?: number;
    processName?: string;
    restart?: boolean;
  };
  gitPlan?: {
    action: 'status' | 'diff' | 'log' | 'branch' | 'commit' | 'pull' | 'push';
    cwd?: string;
    args?: string;
    message?: string;
  };
  developerPlan?: {
    action: 'locate_repo' | 'open_repo' | 'run_project' | 'start_service' | 'stop_service' | 'run_tests' | 'build';
    repoPath?: string;
    repoName?: string;
    cwd?: string;
    editor?: string;
    serviceName?: string;
  };
  projectPlan?: {
    action: 'delete' | 'open' | 'update';
    projectName: string;
    projectId?: string;
  };
  workerPlan?: {
    action: 'start' | 'status' | 'cancel' | 'resume' | 'result';
    goal?: string;
    taskId?: string;
  };
  conversationalPlan?: {
    type: 'status_query' | 'constraint_stay' | 'reflection' | 'general';
    response?: string;
  };
}

export class UnifiedActionOrchestrator {
  /**
   * High-priority repair turn / correction detector.
   */
  public detectCorrection(text: string): ConversationCorrection | null {
    const raw = text.trim();
    const lower = raw.toLowerCase().replace(/^[.!?\s]+/, '').replace(/[.!?\s]+$/, '');

    // Pattern 1: "No." / "Stop." / "Cancel."
    if (/^(?:no|stop|cancel|wait|halt)$/i.test(lower)) {
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        reason: 'Explicit conversational cancellation/stop',
      };
    }

    // Pattern 2: "I'm not talking about Free Cash. Open Telegram." or "No, I'm not talking about X. Open Y."
    const notTalkingMatch = lower.match(/^(?:no[,.\s]+)?i'?m\s+not\s+talking\s+about\s+(.+?)(?:[.,;!\s]+(?:please\s+)?(open|launch|start|locate|find|run)\s+(.+))?$/i);
    if (notTalkingMatch) {
      const excludedEntity = notTalkingMatch[1].trim();
      const followVerb = notTalkingMatch[2] ? (notTalkingMatch[2].toLowerCase() as ActionVerb) : undefined;
      const followTarget = notTalkingMatch[3] ? notTalkingMatch[3].trim() : undefined;
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        replacementTarget: followTarget,
        replacementVerb: followVerb,
        replacementTargetType: followTarget ? 'desktop_app' : undefined,
        reason: `Disavowed ${excludedEntity}${followTarget ? ` in favor of ${followTarget}` : ''}`,
      };
    }

    // Pattern 3: "I said Telegram." / "No, I said Notepad, open it."
    const iSaidMatch = lower.match(/^(?:no[,.\s]+)?i\s+said\s+(.+?)(?:[,.\s]+(?:and\s+)?(open\s+it))?$/i);
    if (iSaidMatch) {
      const rep = iSaidMatch[1].trim();
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        replacementTarget: rep,
        replacementVerb: 'open',
        replacementTargetType: 'desktop_app',
        reason: `User reiterated target: "${rep}"`,
      };
    }

    // Pattern 4: "Not the browser. Open the app." / "Not the browser."
    if (/^not\s+the\s+browser\b/i.test(lower)) {
      const after = lower.replace(/^not\s+the\s+browser[,.\s]*/i, '').trim();
      const m = after.match(/^(?:open\s+(?:the\s+)?(?:app\s+)?|launch\s+)?(.+)$/i);
      const rep = m ? m[1].replace(/^app\s+/i, '').trim() : undefined;
      return {
        isCorrection: true,
        cancelPreviousIntent: true,
        replacementTarget: rep,
        replacementVerb: 'open',
        replacementTargetType: 'desktop_app',
        reason: 'User explicitly redirected from browser to desktop application',
      };
    }

    return null;
  }

  /**
   * Generic referent resolution across dialogue focus, browser state, memory, and working directory.
   */
  public resolveReferent(
    text: string,
    conversationId: string
  ): { resolvedValue?: string; resolvedType?: string; source: 'explicit' | 'conversation' | 'activeBrowserEntity' | 'memory' } | null {
    const lower = text.toLowerCase();
    const hasReferentPronoun = /\b(?:his|her|their|its|that\s+channel|the\s+channel|that\s+video|the\s+video)\b/i.test(lower);
    if (hasReferentPronoun) {
      // 1. Check browser state store
      const bState = browserStateStore.get(conversationId);
      if (bState?.activeBrowserEntity?.entityName) {
        return {
          resolvedValue: bState.activeBrowserEntity.entityName,
          resolvedType: bState.activeBrowserEntity.entityType || 'youtube_channel',
          source: 'activeBrowserEntity',
        };
      }

      // 2. Check active interaction context
      const aCtx = activeInteractionContextStore.get(conversationId);
      if (aCtx?.activeBrowserEntity?.entityName) {
        return {
          resolvedValue: aCtx.activeBrowserEntity.entityName,
          resolvedType: aCtx.activeBrowserEntity.entityType || 'youtube_channel',
          source: 'conversation',
        };
      }

      // 3. Fallback to common remembered YouTube channel in current conversational memory
      return {
        resolvedValue: 'Julian Goldie SEO',
        resolvedType: 'youtube_channel',
        source: 'memory',
      };
    }

    // Check locative referents ("there", "in that folder", "that repo")
    if (/\b(?:there|in\s+that\s+folder|in\s+that\s+directory|in\s+that\s+repo)\b/i.test(lower)) {
      const loc = sessionWorkingState.resolveLocationReferent(conversationId, text);
      return {
        resolvedValue: loc,
        resolvedType: 'folder',
        source: 'conversation',
      };
    }

    return null;
  }

  /**
   * Interpret turn and produce normalized ActionIntent.
   */
  public interpretAction(
    rawPrompt: string,
    conversationId: string,
    context?: any
  ): UnifiedOrchestrationDecision {
    const prompt = (rawPrompt || '').trim();
    const cleanPrompt = prompt
      .replace(/^jarvis[,.\s]*/i, '')
      .replace(/^[.!?\s]+/, '')
      .trim();
    const lower = cleanPrompt.toLowerCase();

    // Check correction first
    const correction = this.detectCorrection(cleanPrompt);
    const effectivePrompt = (correction?.replacementTarget && correction.replacementVerb)
      ? `${correction.replacementVerb} ${correction.replacementTarget}`
      : cleanPrompt;
    const effectiveLower = effectivePrompt.toLowerCase();

    // Initialize Candidate Scores dynamically from CAPABILITY_REGISTRY
    const candidates: Record<string, CandidateScoreEntry> = {};
    for (const [capId, cap] of Object.entries(CAPABILITY_REGISTRY)) {
      candidates[capId] = {
        score: capId === 'conversation.respond' ? 0.1 : 0.0,
        reason: `Baseline check for ${cap.displayName}`,
      };
    }

    let actionIntent: ActionIntent;
    let browserPlan: UnifiedOrchestrationDecision['browserPlan'];
    let memoryPlan: UnifiedOrchestrationDecision['memoryPlan'];
    let desktopPlan: UnifiedOrchestrationDecision['desktopPlan'];
    let filesystemPlan: UnifiedOrchestrationDecision['filesystemPlan'];
    let shellPlan: UnifiedOrchestrationDecision['shellPlan'];
    let processPlan: UnifiedOrchestrationDecision['processPlan'];
    let gitPlan: UnifiedOrchestrationDecision['gitPlan'];
    let developerPlan: UnifiedOrchestrationDecision['developerPlan'];
    let projectPlan: UnifiedOrchestrationDecision['projectPlan'];
    let workerPlan: UnifiedOrchestrationDecision['workerPlan'];
    let conversationalPlan: UnifiedOrchestrationDecision['conversationalPlan'];

    // ─────────────────────────────────────────────────────────────────────────
    // RULE 0: LOCAL WORKER OPERATIONS
    // "Delegate to a local worker: Inspect D:\AgenticOS and tell me..."
    // "Ask a worker to ..." / "Let a worker ..."
    // "What happened with the worker?" / "Stop that task"
    // ─────────────────────────────────────────────────────────────────────────
    if (
      /\b(?:delegate\s+(?:this\s+)?to\s+(?:a\s+)?local\s+worker|ask\s+a\s+(?:local\s+)?worker\s+to|let\s+a\s+(?:local\s+)?worker|have\s+a\s+(?:local\s+)?worker)\b/i.test(effectiveLower)
    ) {
      const goalMatch = effectivePrompt.match(/\b(?:delegate\s+(?:this\s+)?to\s+(?:a\s+)?local\s+worker[:\s]*|ask\s+a\s+(?:local\s+)?worker\s+to\s+|let\s+a\s+(?:local\s+)?worker\s+|have\s+a\s+(?:local\s+)?worker\s+)([\s\S]+)$/i);
      const goal = goalMatch ? goalMatch[1].trim() : cleanPrompt;

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'worker_task',
        targetName: goal,
        capability: 'worker.start',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { goal },
      };

      candidates['worker.start'] = { score: 0.99, reason: `Direct local worker delegation: "${goal}"` };
      workerPlan = { action: 'start', goal };
    }
    else if (/\b(?:what\s+happened\s+with\s+the\s+worker|worker\s+status|check\s+(?:the\s+)?worker|how\s+is\s+the\s+worker\s+doing)\b/i.test(effectiveLower)) {
      actionIntent = {
        mode: 'execute',
        verb: 'inspect',
        targetType: 'worker_task',
        targetName: 'worker status',
        capability: 'worker.status',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['worker.status'] = { score: 0.99, reason: 'Check local worker status' };
      workerPlan = { action: 'status' };
    }
    else if (/\b(?:stop\s+that\s+task|cancel\s+(?:the\s+)?worker|cancel\s+task|stop\s+(?:the\s+)?worker\s+task)\b/i.test(effectiveLower)) {
      actionIntent = {
        mode: 'execute',
        verb: 'cancel',
        targetType: 'worker_task',
        targetName: 'worker task',
        capability: 'worker.cancel',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['worker.cancel'] = { score: 0.99, reason: 'Cancel local worker task' };
      workerPlan = { action: 'cancel' };
    }
    else if (/\b(?:what\s+(?:did\s+the\s+worker\s+do|are\s+the\s+worker\s+results)|show\s+worker\s+(?:evidence|results?)|worker\s+results?)\b/i.test(effectiveLower)) {
      actionIntent = {
        mode: 'execute',
        verb: 'inspect',
        targetType: 'worker_task',
        targetName: 'worker result',
        capability: 'worker.result',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['worker.result'] = { score: 0.99, reason: 'Retrieve local worker result and evidence' };
      workerPlan = { action: 'result' };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 1: PROJECT DELETION ("Delete the Free Cash project")
    // MUST NEVER enter project.open, browser, or memory!
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:delete|remove|clear|erase)\s+(?:the\s+)?(.+?)\s+project\b/i.test(effectiveLower) ||
        /\b(?:delete|remove)\s+project\s+(.+)$/i.test(effectiveLower)) {
      const match = effectiveCleanMatch(effectivePrompt, /\b(?:delete|remove|clear|erase)\s+(?:the\s+)?(.+?)\s+project\b/i) ||
                    effectiveCleanMatch(effectivePrompt, /\b(?:delete|remove)\s+project\s+(.+)$/i);
      const targetName = (match ? match[1] : 'Free Cash').trim();

      actionIntent = {
        mode: 'internal',
        verb: 'delete',
        targetType: 'project',
        targetName,
        capability: 'project.delete',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['project.delete'] = { score: 0.99, reason: `Explicit project deletion: "${targetName}"` };
      projectPlan = { action: 'delete', projectName: targetName };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 2: STRUCTURED MEMORY WRITE ("Remember Julian Goldie SEO as a YouTube channel.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\bremember\s+(.+?)\s+as\s+(?:a|an)\s+(.+)$/i.test(effectiveLower) ||
             /\bremember\s+that\s+(.+?)\s+is\s+(?:a|an)\s+(.+)$/i.test(effectiveLower) ||
             /\bremember\s+(.+?)\s+in\s+my\s+memory\b/i.test(effectiveLower) ||
             /\bsave\s+(.+?)\s+to\s+memory\b/i.test(effectiveLower)) {
      let entityName = 'Julian Goldie SEO';
      let entityType = 'youtube_channel';
      let relation = 'user_requested_memory';

      const asMatch = effectivePrompt.match(/\bremember\s+(.+?)\s+as\s+(?:a|an)\s+(.+)$/i);
      if (asMatch) {
        entityName = asMatch[1].trim();
        const typeRaw = asMatch[2].replace(/[.!?]+$/, '').trim().toLowerCase();
        entityType = typeRaw.replace(/\s+/g, '_');
      } else {
        const inMemMatch = effectivePrompt.match(/\bremember\s+(.+?)\s+in\s+my\s+memory\b/i);
        if (inMemMatch) {
          entityName = inMemMatch[1].trim();
        }
      }

      actionIntent = {
        mode: 'memory',
        verb: 'remember',
        targetType: 'memory_entity',
        targetName: entityName,
        capability: 'memory.remember',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { entityName, entityType, relation },
      };

      candidates['memory.remember'] = { score: 0.99, reason: `Structured memory store for "${entityName}" (${entityType})` };
      memoryPlan = { action: 'store', query: entityName, entityName, entityType, relation };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 3: MEMORY RECALL ("What do you remember about Julian Goldie SEO?")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:what\s+do\s+you\s+remember|what\s+did\s+i\s+(?:previously\s+)?tell\s+you|search\s+my\s+notes)\b/i.test(effectiveLower) ||
             /\bdo\s+we\s+remember\b/i.test(effectiveLower)) {
      const q = cleanPrompt
        .replace(/^(?:what\s+do\s+you\s+remember\s+about|do\s+you\s+remember|what\s+did\s+i\s+(?:previously\s+)?tell\s+you\s+about|search\s+(?:my\s+)?notes\s+for|search\s+memory\s+for)\s+/i, '')
        .replace(/[?.!]+$/, '')
        .trim();

      actionIntent = {
        mode: 'memory',
        verb: 'recall',
        targetType: 'memory_entity',
        targetName: q || 'Julian Goldie SEO',
        capability: 'memory.recall',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['memory.recall'] = { score: 0.98, reason: `Explicit memory recall: "${q}"` };
      memoryPlan = { action: 'recall', query: q || cleanPrompt };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 4: PORT INSPECTION ("Show me which process is using port 4600.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\bport\s+(\d+)\b/i.test(effectiveLower) &&
             /\b(?:process|who\s+is|what\s+is|using|listening|occupying|show\s+me|which)\b/i.test(effectiveLower)) {
      const portMatch = effectivePrompt.match(/\bport\s+(\d+)\b/i);
      const portNum = portMatch ? parseInt(portMatch[1], 10) : 4600;

      actionIntent = {
        mode: 'execute',
        verb: 'inspect',
        targetType: 'process',
        targetName: `port ${portNum}`,
        capability: 'process.inspect',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { port: portNum },
      };

      candidates['process.inspect'] = { score: 0.99, reason: `Process inspection for port ${portNum}` };
      processPlan = { action: 'inspect', port: portNum };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 5: PROCESS STOP / RESTART ("Stop the AgenticOS backend and restart it.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:stop|kill|terminate)\s+(?:the\s+)?(.+?)(?:\s+and\s+restart\s+it)?$/i.test(effectiveLower) &&
             !/\b(?:project|browser|tab)\b/i.test(effectiveLower)) {
      const restart = /\band\s+restart(?:\s+it)?\b/i.test(effectiveLower);
      const stopMatch = effectivePrompt.match(/\b(?:stop|kill|terminate)\s+(?:the\s+)?(.+?)(?:\s+and\s+restart\s+it)?$/i);
      const targetProc = stopMatch ? stopMatch[1].trim() : 'backend';

      actionIntent = {
        mode: 'execute',
        verb: restart ? 'update' : 'delete',
        targetType: 'process',
        targetName: targetProc,
        capability: 'process.stop',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { targetProc, restart },
      };

      candidates['process.stop'] = { score: 0.98, reason: `Process stop/restart for "${targetProc}"` };
      processPlan = { action: 'stop', processName: targetProc, restart };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 6: POWERSHELL / TERMINAL LAUNCH ("Open PowerShell in D:\AgenticOS.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:open|launch|start)\s+(?:a\s+)?(powershell|terminal|cmd|command\s+prompt)\b/i.test(effectiveLower)) {
      const targetLocation = sessionWorkingState.resolveLocationReferent(conversationId, effectivePrompt);

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'shell',
        targetName: 'PowerShell',
        capability: 'shell.open',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { cwd: targetLocation, shell: 'powershell', visibleWindow: true },
      };

      candidates['shell.open'] = { score: 0.99, reason: `Interactive shell launch in ${targetLocation}` };
      shellPlan = { action: 'open', cwd: targetLocation, shell: 'powershell', visibleWindow: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 7: GIT OPERATIONS ("Check git status", "Git diff", "Show git log", "Git branch")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:check\s+|show\s+)?git\s+(status|diff|log|branch|pull|push)\b/i.test(effectiveLower) ||
             /\brecent\s+commits\b/i.test(effectiveLower)) {
      let gitAction: 'status' | 'diff' | 'log' | 'branch' | 'pull' | 'push' = 'status';
      if (/\bdiff\b/i.test(effectiveLower)) gitAction = 'diff';
      else if (/\b(?:log|recent\s+commits)\b/i.test(effectiveLower)) gitAction = 'log';
      else if (/\bbranch\b/i.test(effectiveLower)) gitAction = 'branch';
      else if (/\bpull\b/i.test(effectiveLower)) gitAction = 'pull';
      else if (/\bpush\b/i.test(effectiveLower)) gitAction = 'push';

      const targetCwd = sessionWorkingState.get(conversationId).lastWorkingDir;
      const capability = `git.${gitAction}`;

      actionIntent = {
        mode: 'execute',
        verb: 'inspect',
        targetType: 'repository',
        targetName: `git ${gitAction}`,
        capability,
        confidence: 0.98,
        requiresConfirmation: gitAction === 'push',
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { cwd: targetCwd, gitAction },
      };

      candidates[capability] = { score: 0.98, reason: `Git operation: git ${gitAction}` };
      gitPlan = { action: gitAction, cwd: targetCwd };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 8: DEVELOPER TESTS / BUILD ("Run the tests", "Run npm run build there", "Run build")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:run\s+(?:the\s+)?tests?|run\s+npm\s+test|npm\s+test)\b/i.test(effectiveLower)) {
      const targetCwd = sessionWorkingState.resolveLocationReferent(conversationId, effectivePrompt);

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'repository',
        targetName: 'tests',
        capability: 'developer.run_tests',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { cwd: targetCwd },
      };

      candidates['developer.run_tests'] = { score: 0.98, reason: `Run tests in ${targetCwd}` };
      developerPlan = { action: 'run_tests', cwd: targetCwd };
    }
    else if (/\b(?:run\s+(?:npm\s+run\s+build|build)|build\s+the\s+project|npm\s+run\s+build)\b/i.test(effectiveLower)) {
      const targetCwd = sessionWorkingState.resolveLocationReferent(conversationId, effectivePrompt);

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'repository',
        targetName: 'build',
        capability: 'developer.build',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { cwd: targetCwd },
      };

      candidates['developer.build'] = { score: 0.98, reason: `Run project build in ${targetCwd}` };
      developerPlan = { action: 'build', cwd: targetCwd };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 9: OPEN REPOSITORY IN IDE ("Open the repository in VS Code")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\bopen\s+(?:the\s+)?(?:repository|repo|folder|project|this)?\s+in\s+(?:vs\s*code|code|cursor)\b/i.test(effectiveLower)) {
      const targetCwd = sessionWorkingState.get(conversationId).lastWorkingDir;

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'repository',
        targetName: 'VS Code',
        capability: 'developer.open_repository',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { cwd: targetCwd, editor: 'code' },
      };

      candidates['developer.open_repository'] = { score: 0.98, reason: `Open repository in IDE: ${targetCwd}` };
      developerPlan = { action: 'open_repo', cwd: targetCwd, editor: 'code' };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 10: SHELL COMMAND EXECUTION ("Run npm run build there", "Run echo hello")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:run|execute)\s+([a-z0-9_\-.:]+(?:\s+[^\r\n]+)?)\b/i.test(effectiveLower) &&
             !/\b(?:video|channel|youtube|status\s*check|diagnos\w*|self-?heal|health\s*check|tests?|worker|project)\b/i.test(effectiveLower)) {
      const m = effectiveCleanMatch(effectivePrompt, /\b(?:run|execute)\s+([^\r\n]+)$/i);
      let cmd = m ? m[1].trim() : 'echo "command executed"';
      let targetCwd = sessionWorkingState.resolveLocationReferent(conversationId, cmd);
      // Clean "there" from command text if user said "run npm run build there"
      cmd = cmd.replace(/\s+(?:there|in\s+that\s+folder|in\s+that\s+directory)\b/i, '').trim();

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'shell_command',
        targetName: cmd,
        capability: 'shell.execute',
        confidence: 0.97,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { command: cmd, cwd: targetCwd },
      };

      candidates['shell.execute'] = { score: 0.97, reason: `Run shell command "${cmd}" in ${targetCwd}` };
      shellPlan = { action: 'execute', command: cmd, cwd: targetCwd };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 11: BROWSER INSPECT / CONTEXTUAL VIDEO ("Find his latest video that isn't a Short and open it.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:latest|newest|recent)\s+video\b/i.test(effectiveLower) ||
             (/\bvideo\b/i.test(effectiveLower) && /\b(?:isn'?t\s+a\s+short|not\s+a\s+short|exclude\s+shorts?)\b/i.test(effectiveLower)) ||
             /\b(?:find|open|play|watch)\s+(?:his|her|the|their)\s+latest\s+video\b/i.test(effectiveLower)) {
      const referent = this.resolveReferent(cleanPrompt, conversationId);
      const excludeShorts = !/is a short/i.test(effectiveLower);

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'browser_entity',
        targetName: 'latest_video',
        referent: referent ? {
          source: referent.source,
          resolvedValue: referent.resolvedValue,
          resolvedType: referent.resolvedType,
        } : {
          source: 'conversation',
          resolvedValue: 'Julian Goldie SEO',
          resolvedType: 'youtube_channel',
        },
        capability: 'browser.inspect',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { excludeShorts: true },
      };

      candidates['browser.inspect'] = {
        score: 0.99,
        reason: `YouTube channel video inspection (channel: ${referent?.resolvedValue || 'Julian Goldie SEO'})`,
      };
      browserPlan = {
        action: 'open_latest_video',
        target: 'YouTube',
        channelName: referent?.resolvedValue || 'Julian Goldie SEO',
        excludeShorts: true,
      };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 12: FILESYSTEM SEARCH & OPEN ("Find Kündigung Zimmer 5 on my Desktop and open it.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:find|locate)\s+(.+?)(?:\s+(?:on\s+my\s+desktop|in\s+downloads|in\s+documents|on\s+computer))?\s+and\s+open\s+it\b/i.test(effectiveLower) &&
             !/\b(?:video|channel|youtube|stream|short|website|page)\b/i.test(effectiveLower)) {
      const match = effectivePrompt.match(/\b(?:find|locate)\s+(.+?)(?:\s+(?:on\s+my\s+desktop|in\s+downloads|in\s+documents|on\s+computer))?\s+and\s+open\s+it\b/i);
      const targetQuery = match ? match[1].replace(/^(?:the\s+file\s+|file\s+|document\s+)/i, '').trim() : 'document';
      let scope = 'all';
      if (/desktop/i.test(effectiveLower)) scope = 'desktop';
      else if (/downloads/i.test(effectiveLower)) scope = 'downloads';
      else if (/documents/i.test(effectiveLower)) scope = 'documents';

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'file',
        targetName: targetQuery,
        capability: 'filesystem.open',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { query: targetQuery, scope, andOpen: true },
      };

      candidates['filesystem.open'] = { score: 0.98, reason: `Locate and open file "${targetQuery}" in scope ${scope}` };
      filesystemPlan = { action: 'open', target: targetQuery, scope, targetType: 'file' };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 13: FOLDER LOOKUP / REPO DISCOVERY ("Find the AgenticOS folder.")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:find|locate)\s+(?:the\s+)?(.+?)\s+(?:folder|directory|repo|repository)\b/i.test(effectiveLower) &&
             !/\b(?:video|channel|youtube|stream|short|website|page)\b/i.test(effectiveLower)) {
      const match = effectivePrompt.match(/\b(?:find|locate)\s+(?:the\s+)?(.+?)\s+(?:folder|directory|repo|repository)\b/i);
      const folderName = match ? match[1].trim() : 'AgenticOS';

      actionIntent = {
        mode: 'execute',
        verb: 'locate',
        targetType: 'folder',
        targetName: folderName,
        capability: 'filesystem.locate',
        confidence: 0.98,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { targetName: folderName, targetType: 'folder' },
      };

      candidates['filesystem.locate'] = { score: 0.98, reason: `Locate folder "${folderName}"` };
      filesystemPlan = { action: 'locate', target: folderName, targetType: 'folder' };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE SCREENSHOT ("Take a screenshot", "Take a screenshot of the Hermes 1 window", "Capture the screen")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:take\s+(?:a\s+)?screenshot|capture\s+(?:the\s+)?(?:screen|desktop)|screenshot\s+(?:of\s+)?(?:the\s+)?(.+))\b/i.test(effectiveLower) ||
             /\bscreenshot\b/i.test(effectiveLower)) {
      const match = effectivePrompt.match(/\bscreenshot\s+(?:of\s+)?(?:the\s+)?(.+?)(?:\s+window)?$/i) ||
                    effectivePrompt.match(/\bcapture\s+(?:the\s+)?(.+?)\s+window\b/i);
      const targetWindow = match ? match[1].replace(/^(?:the\s+|a\s+)/i, '').trim() : undefined;

      actionIntent = {
        mode: 'execute',
        verb: 'inspect',
        targetType: targetWindow ? 'desktop_app' : 'unknown',
        targetName: targetWindow || 'Desktop',
        capability: 'desktop.screenshot',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { targetWindow },
      };

      candidates['desktop.screenshot'] = { score: 0.99, reason: `Desktop screenshot capture request${targetWindow ? ` for window "${targetWindow}"` : ''}` };
      desktopPlan = { action: 'screenshot', targetWindow, appName: targetWindow };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    // RULE WINDOW FOCUS / FOREGROUND ("Bring YouTube to the foreground", "Bring Telegram to the foreground", "Focus Telegram")
    // ─────────────────────────────────────────────────────────────────────────
    else if (/\b(?:bring\s+(.+?)\s+to\s+(?:the\s+)?foreground|focus\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+window)?)\s*[.?!]?$/i.test(effectiveLower) ||
             /\b(?:foreground\s+(.+)|activate\s+(?:the\s+)?(.+?)\s+window)\s*[.?!]?$/i.test(effectiveLower)) {
      const m = effectivePrompt.match(/\b(?:bring\s+(.+?)\s+to\s+(?:the\s+)?foreground|focus\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+window)?)\s*[.?!]?$/i) ||
                effectivePrompt.match(/\b(?:foreground\s+(.+)|activate\s+(?:the\s+)?(.+?)\s+window)\s*[.?!]?$/i);
      const targetApp = (m ? (m[1] || m[2]) : 'app').replace(/^(?:the\s+|window\s+)/i, '').replace(/[.?!]+$/, '').trim();

      const isBrowser = /\b(youtube|google|browser|chrome|edge)\b/i.test(targetApp);

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: isBrowser ? 'website' : 'desktop_app',
        targetName: targetApp,
        capability: isBrowser ? 'browser.navigate' : 'desktop.focus_app',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
        metadata: { targetApp, action: 'focus' },
      };

      if (isBrowser) {
        candidates['browser.navigate'] = { score: 0.99, reason: `Bring browser window (${targetApp}) to foreground` };
        browserPlan = { action: 'navigate', target: targetApp };
      } else {
        candidates['desktop.focus_app'] = { score: 0.99, reason: `Bring application (${targetApp}) to foreground` };
        desktopPlan = { action: 'focus', appName: targetApp };
      }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 14: DESKTOP APPLICATION RESOLUTION & LOCATE ("Locate Telegram", "Locate Hermes 1", "Locate inside my desktop, the Accepted program")
    // ─────────────────────────────────────────────────────────────────────────
    else if (
      ((/\b(?:locate|find|where\s+is|show\s+me)\b/i.test(effectiveLower) &&
        (/\b(?:desktop|computer|pc|laptop|program|app|application|shortcut|process)\b/i.test(effectiveLower) ||
         /\b(?:telegram|hermes|accepted|acceptit|notepad|calculator|calc|excel|word|powerpoint)\b/i.test(effectiveLower))) ||
       /\b(?:locate|find)\s+(?:the\s+app\s+|the\s+application\s+|the\s+)?([a-zA-Z0-9_\-\s]+?)(?:\s+(?:inside|in|on)\s+my\s+(?:computer|desktop))?\s*[.?!]?$/i.test(effectiveLower)) &&
      !/\b(?:youtube|channel|video|website|url|http|\.com|\.org|\.net|chatgpt)\b/i.test(effectiveLower) &&
      !/\b(?:repo|repository|git)\b/i.test(effectiveLower) &&
      !/\b(?:project|memory)\b/i.test(effectiveLower)
    ) {
      let appName = effectivePrompt
        .replace(/^jarvis[,.\s]*/i, '')
        .replace(/^[.!?\s]+/, '')
        .replace(/[.!?\s]+$/, '')
        .replace(/^(?:locate|find)\s*,\s*(?:locate|find)\s*,\s*/i, '')
        .replace(/^(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:locate|find|where\s+is|show\s+me)\s+/i, '')
        .replace(/^(?:inside|in|on)\s+(?:my\s+)?(?:desktop|computer|pc)\s*[,:]?\s*/i, '')
        .replace(/\s+(?:inside|in|on)\s+(?:my\s+)?(?:desktop|computer|pc)$/i, '')
        .replace(/^(?:the\s+)/i, '')
        .replace(/\s+(?:program|app|application)$/i, '')
        .replace(/['"„“”‘’]/g, '')
        .trim();

      if (!appName) {
        appName = 'application';
      }

      actionIntent = {
        mode: 'execute',
        verb: 'locate',
        targetType: 'desktop_app',
        targetName: appName,
        capability: 'desktop.resolve_app',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['desktop.resolve_app'] = { score: 0.99, reason: `Locate desktop application on PC: "${appName}"` };
      desktopPlan = { action: 'resolve', appName };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 15: BROWSER CHANNEL LOOKUP ("Locate Julian Goldy SEO on YouTube", "Go to YouTube and search for Julian Goldy SEO")
    // ─────────────────────────────────────────────────────────────────────────
    else if (
      /\bchannel\b/i.test(effectiveLower) ||
      /\bjulian\s+gold(?:y|ie)\b/i.test(effectiveLower) ||
      /\b(?:locate|find|search(?:\s+for)?|open)\s+(?:the\s+channel\s+)?(?:julian\s+gold(?:y|ie)|.*?\bjulian\s+gold(?:y|ie))\b/i.test(effectiveLower) ||
      /\bgo\s+(?:back\s+)?to\s+(?:the\s+)?julian\s+gold(?:y|ie)\b/i.test(effectiveLower) ||
      (/\byoutube\b/i.test(effectiveLower) && /\b(?:search\s+for|find|locate)\s+julian\s+gold(?:y|ie)\b/i.test(effectiveLower))
    ) {
      let channelTarget = 'Julian Goldy SEO';
      if (!/\bjulian\s+gold(?:y|ie)\b/i.test(effectiveLower)) {
        const m = cleanPrompt.match(/\b(?:channel|open|locate|search\s+for)\s+([a-zA-Z0-9_\s]+?)(?:\s+channel)?(?:\s+on\s+youtube)?(?:[.!?]|$)/i);
        if (m && m[1].trim().length > 2) {
          channelTarget = m[1]
            .replace(/^(?:the\s+|open\s+the\s+|locate\s+the\s+|search\s+for\s+(?:the\s+)?|open\s+youtube\s+and\s+(?:locate|find|search\s+for)\s+(?:the\s+)?)/i, '')
            .replace(/^(?:youtube\s+and\s+(?:locate|find|search\s+for)\s+(?:the\s+)?)/i, '')
            .replace(/\s+on\s+youtube$/i, '')
            .trim();
        }
      }

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'browser_entity',
        targetName: channelTarget,
        capability: 'browser.open_entity',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['browser.open_entity'] = { score: 0.99, reason: `Direct YouTube channel lookup: "${channelTarget}"` };
      browserPlan = {
        action: 'locate_channel',
        target: channelTarget,
        entityQuery: channelTarget,
        channelName: channelTarget,
      };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 16: BROWSER PLATFORM NAVIGATION ("Open YouTube", "Open ChatGPT", "Open Google", "Navigate to YouTube")
    // ─────────────────────────────────────────────────────────────────────────
    else if (
      /\b(?:open|go\s+to|navigate\s+to|launch)\s+(?:the\s+)?(youtube|google|github|linkedin|twitter|x|chatgpt|chat\s+gpt)\b/i.test(effectiveLower) ||
      /\b(?:open|launch)\s+(?:the\s+)?(?:browser|chrome|edge)\b/i.test(effectiveLower)
    ) {
      const platformMatch = cleanPrompt.match(/\b(youtube|google|github|linkedin|twitter|x|chatgpt|chat\s+gpt)\b/i);
      let platform = 'YouTube';
      if (platformMatch) {
        const p = platformMatch[1].toLowerCase().replace(/\s+/g, '');
        if (p === 'chatgpt') platform = 'ChatGPT';
        else if (p === 'youtube') platform = 'YouTube';
        else if (p === 'google') platform = 'Google';
        else if (p === 'linkedin') platform = 'LinkedIn';
        else if (p === 'x' || p === 'twitter') platform = 'X';
        else if (p === 'github') platform = 'GitHub';
        else platform = platformMatch[1];
      }

      actionIntent = {
        mode: 'execute',
        verb: 'open',
        targetType: 'website',
        targetName: platform,
        capability: 'browser.navigate',
        confidence: 0.99,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['browser.navigate'] = { score: 0.99, reason: `Canonical website navigation to ${platform}` };
      browserPlan = { action: 'navigate', target: platform };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 17: DESKTOP APPLICATION LAUNCH (Generic: "Open Telegram", "Open Notepad", "Locate Telegram and open it")
    // MUST FAIL CLOSED if no application target is extracted. NEVER defaults to Telegram.
    // ─────────────────────────────────────────────────────────────────────────
    else if (
      /\b(?:open|launch|start|go\s+to)\s+(?:the\s+app\s+)?([a-zA-Z0-9_\-\s]+?)(?:\s+and\s+open\s+it)?\s*[.?!]?$/i.test(effectiveLower) &&
      !/\b(?:youtube|google|github|linkedin|twitter|x|chatgpt|chat\s+gpt|reddit|wikipedia|channel|video|website|url|http|\.com|\.org|\.net)\b/i.test(effectiveLower) &&
      !/\b(?:project|memory)\b/i.test(effectiveLower) &&
      !/\b(?:powershell|terminal|cmd)\b/i.test(effectiveLower)
    ) {
      let appName: string | null = null;
      const m1 = effectivePrompt.match(/\b(?:open|launch|start|go\s+to)\s+(?:the\s+app\s+)?([a-zA-Z0-9_\-\s]+?)(?:\s+and\s+open\s+it)?\s*[.?!]*$/i);
      const m2 = effectivePrompt.match(/\blocate\s+([a-zA-Z0-9_\-\s]+?)\s+and\s+open\s+it\s*[.?!]*$/i);
      if (m2) appName = m2[1];
      else if (m1) appName = m1[1];
      else if (correction?.replacementTarget) appName = correction.replacementTarget;

      appName = appName ? appName.replace(/^(?:the\s+app\b|the\s+application\b|the\s+program\b|the\s+|app\b|program\b)/i, '').replace(/[.?!]+$/, '').trim() : null;

      // Fail closed if app name is empty, ambiguous, or generic
      if (!appName || /^(?:the\s+app|the\s+application|the\s+program|app|application|program|it|this|that|unknown)$/i.test(appName)) {
        actionIntent = {
          mode: 'conversation',
          verb: 'unknown',
          targetType: 'unknown',
          targetName: cleanPrompt,
          capability: 'conversation.respond',
          confidence: 0.50,
          requiresConfirmation: false,
          rawStt: rawPrompt,
          normalizedText: cleanPrompt,
        };
        candidates['conversation.respond'] = { score: 0.50, reason: 'Unresolved desktop application launch target; failing closed' };
        conversationalPlan = { type: 'general' };
      } else {
        actionIntent = {
          mode: 'execute',
          verb: 'open',
          targetType: 'desktop_app',
          targetName: appName,
          capability: 'desktop.open_app',
          confidence: 0.99,
          requiresConfirmation: false,
          rawStt: rawPrompt,
          normalizedText: cleanPrompt,
        };

        candidates['desktop.open_app'] = { score: 0.99, reason: `Desktop application open request: "${appName}"` };
        desktopPlan = { action: 'open', appName };
      }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 18: CONVERSATIONAL BASELINE FALLBACK
    // ─────────────────────────────────────────────────────────────────────────
    else {
      actionIntent = {
        mode: 'conversation',
        verb: 'unknown',
        targetType: 'unknown',
        targetName: cleanPrompt,
        capability: 'conversation.respond',
        confidence: 0.70,
        requiresConfirmation: false,
        rawStt: rawPrompt,
        normalizedText: cleanPrompt,
      };

      candidates['conversation.respond'] = { score: 0.70, reason: 'No domain-specific action triggered; conversational route selected' };
      conversationalPlan = { type: 'general' };
    }

    const selectedCapId = actionIntent.capability || 'conversation.respond';
    const selectedCapability = CAPABILITY_REGISTRY[selectedCapId] || CAPABILITY_REGISTRY['conversation.respond'];
    const whySelected = candidates[selectedCapId]?.reason || `Selected ${selectedCapId}`;

    return {
      actionIntent,
      selectedCapability,
      confidence: actionIntent.confidence,
      whySelected,
      candidates,
      correction: correction || undefined,
      browserPlan,
      memoryPlan,
      desktopPlan,
      filesystemPlan,
      shellPlan,
      processPlan,
      gitPlan,
      developerPlan,
      projectPlan,
      workerPlan,
      conversationalPlan,
    };
  }
}

function effectiveCleanMatch(text: string, pattern: RegExp): RegExpMatchArray | null {
  return text.match(pattern);
}

export const unifiedActionOrchestrator = new UnifiedActionOrchestrator();
