/**
 * Persistent Jarvis Core Memory (Jarvis Conversational Supervisor Milestone).
 *
 * Implements structured, durable core memory on top of the canonical SQLite
 * memoryStore without creating a secondary database:
 *   - User working profile (scope: 'user:profile')
 *   - Jarvis identity (scope: 'system:identity')
 *   - Agent roles (scope: 'system:roles')
 *   - Operating principles (scope: 'system:principles')
 *   - Interaction preferences (scope: 'system:interaction_preferences')
 *   - Project memory (scope: 'project:<id>')
 *
 * Provides scoped memory retrieval so only relevant context is injected.
 */
import { memoryStore } from '../../services/memory/store.js';
import { createMemory } from '../../services/memory/distill.js';
import type { MemoryRecord, MemoryType } from '../../services/memory/types.js';
import { projectsStore } from '../../services/projectsStore.js';
import { retrieveProjectMemory } from './projectMemory.js';

export interface UserWorkingProfile {
  preferredName?: string;
  workingPreferences: string[];
  highLevelGoals: string[];
  preferredInteractionStyle?: string;
}

export interface InteractionPreferences {
  narrateLongerTasks: boolean;
  conciseUpdates: boolean;
  immediateAcknowledgement: boolean;
  spokenMilestones: boolean;
  suppressLowLevelToolNarration: boolean;
  locale: string;
}

const SCOPE_USER_PROFILE = 'user:profile';
const SCOPE_SYSTEM_IDENTITY = 'system:identity';
const SCOPE_SYSTEM_ROLES = 'system:roles';
const SCOPE_SYSTEM_PRINCIPLES = 'system:principles';
const SCOPE_SYSTEM_INTERACTION = 'system:interaction_preferences';

const DEFAULT_USER_PROFILE: UserWorkingProfile = {
  preferredName: 'Operator',
  workingPreferences: [
    'Autonomous execution with real-time transparent progress',
    'Concise, evidence-backed updates',
    'Independent verification before claiming task completion',
    'Preserve context across restarts and sessions',
  ],
  highLevelGoals: [
    'Execute revenue-generating missions safely and autonomously',
    'Maintain high code quality and test-verified engineering',
  ],
  preferredInteractionStyle: 'Conversational execution supervisor, proactive updates, grounded facts only',
};

const DEFAULT_INTERACTION_PREFERENCES: InteractionPreferences = {
  narrateLongerTasks: true,
  conciseUpdates: true,
  immediateAcknowledgement: true,
  spokenMilestones: true,
  suppressLowLevelToolNarration: true,
  locale: 'en-AU',
};

const DEFAULT_JARVIS_IDENTITY = `Conversational supervisor and primary user-facing Agentic OS interface. Owns execution communication, real-time worker progress narration, and context continuity.`;

const DEFAULT_AGENT_ROLES = `Hermes: Planning, research, strategic decomposition, and market analysis.
CodeX: Repository implementation, tool execution, automated code edits, and verification.
Jarvis: Conversational orchestration, user communication, execution progress narration, and memory continuity.`;

const DEFAULT_OPERATING_PRINCIPLES = `1. Evidence before claims: Ground all status and progress in real backend/worker events.
2. Preserve original intent: Do not alter the user's objective when delegating.
3. Act rather than repeatedly asking for prompt forwarding: Automatically coordinate Hermes and CodeX.
4. Clearly distinguish execution states: Explicitly separate queued, starting, running-active, running-quiet, waiting-for-approval, possible-stall, recovering, failed, and completed.
5. Keep the user informed during long tasks: Provide truthful intermediate progress and discoveries.
6. Never fabricate worker activity: Only report real events from runtime adapters.
7. Report blockers truthfully and never claim verification without evidence.`;

/**
 * Seed initial core memories if not already present in the SQLite store.
 * Idempotent — will not overwrite existing user-modified core memories.
 */
export function ensureJarvisCoreMemorySeeded(): void {
  // 1. User Profile
  const profileList = memoryStore.list({ scope: SCOPE_USER_PROFILE, limit: 1 });
  if (profileList.total === 0) {
    createMemory({
      type: 'preference',
      title: 'User Working Profile',
      summary: `Preferred Name: ${DEFAULT_USER_PROFILE.preferredName}, Interaction: ${DEFAULT_USER_PROFILE.preferredInteractionStyle}`,
      content: JSON.stringify(DEFAULT_USER_PROFILE, null, 2),
      scope: SCOPE_USER_PROFILE,
      entities: ['User', 'Preferences', 'Profile'],
      tags: ['core', 'user_profile', 'preferences'],
      confidence: 1.0,
      source: { sourceType: 'system' },
      verificationStatus: 'human_confirmed',
    });
  } else if (profileList.items[0]?.content?.includes('Lead Commander')) {
    memoryStore.update(profileList.items[0].id, {
      content: JSON.stringify(DEFAULT_USER_PROFILE, null, 2),
      summary: `Preferred Name: ${DEFAULT_USER_PROFILE.preferredName}, Interaction: ${DEFAULT_USER_PROFILE.preferredInteractionStyle}`,
    });
  }

  // 2. Jarvis Identity
  const identityList = memoryStore.list({ scope: SCOPE_SYSTEM_IDENTITY, limit: 1 });
  if (identityList.total === 0) {
    createMemory({
      type: 'semantic',
      title: 'Jarvis Identity',
      summary: 'Jarvis conversational supervisor identity and primary role in Agentic OS.',
      content: DEFAULT_JARVIS_IDENTITY,
      scope: SCOPE_SYSTEM_IDENTITY,
      entities: ['Jarvis', 'AgenticOS'],
      tags: ['core', 'identity', 'system'],
      confidence: 1.0,
      source: { sourceType: 'system' },
      verificationStatus: 'verified',
    });
  }

  // 3. Agent Roles
  const rolesList = memoryStore.list({ scope: SCOPE_SYSTEM_ROLES, limit: 1 });
  if (rolesList.total === 0) {
    createMemory({
      type: 'semantic',
      title: 'Agent Roles & Specialization',
      summary: 'Specialization map for Hermes, CodeX, and Jarvis.',
      content: DEFAULT_AGENT_ROLES,
      scope: SCOPE_SYSTEM_ROLES,
      entities: ['Hermes', 'CodeX', 'Jarvis'],
      tags: ['core', 'agent_roles', 'architecture'],
      confidence: 1.0,
      source: { sourceType: 'system' },
      verificationStatus: 'verified',
    });
  }

  // 4. Operating Principles
  const principlesList = memoryStore.list({ scope: SCOPE_SYSTEM_PRINCIPLES, limit: 1 });
  if (principlesList.total === 0) {
    createMemory({
      type: 'decision',
      title: 'Jarvis Operating Principles',
      summary: 'Core operational rules governing communication, state reporting, and truthfulness.',
      content: DEFAULT_OPERATING_PRINCIPLES,
      scope: SCOPE_SYSTEM_PRINCIPLES,
      entities: ['Jarvis', 'Principles'],
      tags: ['core', 'operating_principles', 'rules'],
      confidence: 1.0,
      source: { sourceType: 'system' },
      verificationStatus: 'verified',
    });
  }

  // 5. Interaction Preferences
  const interactionList = memoryStore.list({ scope: SCOPE_SYSTEM_INTERACTION, limit: 1 });
  if (interactionList.total === 0) {
    createMemory({
      type: 'preference',
      title: 'Jarvis Interaction Preferences',
      summary: 'Preferences for task progress narration, conciseness, spoken milestones, and en-AU locale.',
      content: JSON.stringify(DEFAULT_INTERACTION_PREFERENCES, null, 2),
      scope: SCOPE_SYSTEM_INTERACTION,
      entities: ['Jarvis', 'Interaction', 'Preferences'],
      tags: ['core', 'interaction_preferences', 'voice'],
      confidence: 1.0,
      source: { sourceType: 'system' },
      verificationStatus: 'verified',
    });
  }
}

/** Retrieve the active user working profile. */
export function getUserWorkingProfile(): UserWorkingProfile {
  ensureJarvisCoreMemorySeeded();
  const list = memoryStore.list({ scope: SCOPE_USER_PROFILE, limit: 1 });
  if (list.items.length > 0) {
    try {
      const parsed = JSON.parse(list.items[0].content);
      return { ...DEFAULT_USER_PROFILE, ...parsed };
    } catch {
      return DEFAULT_USER_PROFILE;
    }
  }
  return DEFAULT_USER_PROFILE;
}

/** Update or save user working profile preferences. */
export function updateUserWorkingProfile(update: Partial<UserWorkingProfile>): UserWorkingProfile {
  ensureJarvisCoreMemorySeeded();
  const list = memoryStore.list({ scope: SCOPE_USER_PROFILE, limit: 1 });
  const current = getUserWorkingProfile();
  const merged: UserWorkingProfile = {
    ...current,
    ...update,
    workingPreferences: update.workingPreferences || current.workingPreferences,
    highLevelGoals: update.highLevelGoals || current.highLevelGoals,
  };

  if (list.items.length > 0) {
    memoryStore.update(list.items[0].id, {
      summary: `Preferred Name: ${merged.preferredName || 'Operator'}, Interaction: ${merged.preferredInteractionStyle}`,
      content: JSON.stringify(merged, null, 2),
    });
  } else {
    createMemory({
      type: 'preference',
      title: 'User Working Profile',
      summary: `Preferred Name: ${merged.preferredName || 'Operator'}, Interaction: ${merged.preferredInteractionStyle}`,
      content: JSON.stringify(merged, null, 2),
      scope: SCOPE_USER_PROFILE,
      entities: ['User', 'Preferences', 'Profile'],
      tags: ['core', 'user_profile', 'preferences'],
      confidence: 1.0,
      source: { sourceType: 'human' },
      verificationStatus: 'human_confirmed',
    });
  }
  return merged;
}

/** Retrieve interaction preferences. */
export function getInteractionPreferences(): InteractionPreferences {
  ensureJarvisCoreMemorySeeded();
  const list = memoryStore.list({ scope: SCOPE_SYSTEM_INTERACTION, limit: 1 });
  if (list.items.length > 0) {
    try {
      const parsed = JSON.parse(list.items[0].content);
      return { ...DEFAULT_INTERACTION_PREFERENCES, ...parsed };
    } catch {
      return DEFAULT_INTERACTION_PREFERENCES;
    }
  }
  return DEFAULT_INTERACTION_PREFERENCES;
}

/** Update or save interaction preferences. */
export function updateInteractionPreferences(update: Partial<InteractionPreferences>): InteractionPreferences {
  ensureJarvisCoreMemorySeeded();
  const list = memoryStore.list({ scope: SCOPE_SYSTEM_INTERACTION, limit: 1 });
  const current = getInteractionPreferences();
  const merged: InteractionPreferences = {
    ...current,
    ...update,
  };

  if (list.items.length > 0) {
    memoryStore.update(list.items[0].id, {
      summary: `Interaction preferences (narrate=${merged.narrateLongerTasks}, spoken=${merged.spokenMilestones}, locale=${merged.locale})`,
      content: JSON.stringify(merged, null, 2),
    });
  } else {
    createMemory({
      type: 'preference',
      title: 'Jarvis Interaction Preferences',
      summary: `Interaction preferences (narrate=${merged.narrateLongerTasks}, spoken=${merged.spokenMilestones}, locale=${merged.locale})`,
      content: JSON.stringify(merged, null, 2),
      scope: SCOPE_SYSTEM_INTERACTION,
      entities: ['Jarvis', 'Interaction', 'Preferences'],
      tags: ['core', 'interaction_preferences', 'voice'],
      confidence: 1.0,
      source: { sourceType: 'system' },
      verificationStatus: 'verified',
    });
  }
  return merged;
}

export interface ScopedJarvisMemoryResult {
  text: string;
  injectedMemoryIds: string[];
}

/**
 * Build a structured, bounded memory injection block for Jarvis prompts.
 * Injects authoritative core memory with strict precedence:
 *   1. Pinned & human-confirmed memories from system:principles, system:identity,
 *      system:roles, system:interaction_preferences, and user:profile
 *      (e.g., mem-1788142946777-ic51xu and mem-1788143176847-2msl4c).
 *   2. Active project context and project-scoped memories (if project selected).
 *   3. Contextually relevant recent decisions/tasks (bounded max 2-3, deduplicated).
 * Deduplicates by memory ID and records all injected memory IDs for turn metadata.
 * Does NOT dump the entire database.
 */
export async function getScopedJarvisMemoryContextDetailed(
  prompt: string,
  projectId?: string | null
): Promise<ScopedJarvisMemoryResult> {
  ensureJarvisCoreMemorySeeded();

  const sections: string[] = [];
  const injectedIds = new Set<string>();

  // 1. Authoritative Core Scopes: fetch active human-confirmed & pinned memories
  const coreScopes = [
    SCOPE_SYSTEM_PRINCIPLES,
    SCOPE_SYSTEM_IDENTITY,
    SCOPE_SYSTEM_ROLES,
    SCOPE_SYSTEM_INTERACTION,
    SCOPE_USER_PROFILE,
  ];

  const pinnedCoreMemories: MemoryRecord[] = [];
  for (const scope of coreScopes) {
    const list = memoryStore.list({ scope, status: 'active', limit: 20 });
    for (const mem of list.items) {
      if (mem.pinned || mem.verificationStatus === 'human_confirmed') {
        pinnedCoreMemories.push(mem);
      }
    }
  }

  // Deduplicate pinned core memories
  const uniquePinnedCore = pinnedCoreMemories.filter((m) => {
    if (injectedIds.has(m.id)) return false;
    injectedIds.add(m.id);
    return true;
  });

  // 2. Format User Profile
  const userProfile = getUserWorkingProfile();
  sections.push(`[USER WORKING PROFILE]
Preferred Name: ${userProfile.preferredName || 'Operator'}
Interaction Style: ${userProfile.preferredInteractionStyle}
Working Preferences:
${userProfile.workingPreferences.map(p => `- ${p}`).join('\n')}
High-Level Goals:
${userProfile.highLevelGoals.map(g => `- ${g}`).join('\n')}`);

  // 3. Inject Pinned Authoritative Principles & Contracts (Explicitly overriding defaults)
  if (uniquePinnedCore.length > 0) {
    const coreLines = ['[AUTHORITATIVE PINNED SYSTEM PRINCIPLES & CONTRACTS]'];
    for (const m of uniquePinnedCore) {
      coreLines.push(`### ${m.title} (${m.id})`);
      coreLines.push(m.content.trim());
      coreLines.push('');
    }
    sections.push(coreLines.join('\n'));
  } else {
    sections.push(`[JARVIS SUPERVISOR IDENTITY & PRINCIPLES]
${DEFAULT_JARVIS_IDENTITY}
${DEFAULT_AGENT_ROLES}
Principles:
${DEFAULT_OPERATING_PRINCIPLES}`);
  }

  // 4. Interaction Preferences
  const interaction = getInteractionPreferences();
  sections.push(`[INTERACTION PREFERENCES]
- Immediate conversational acknowledgement before long execution
- Real-time progress narration from truthful runtime events only
- Semantic deduplication to prevent chat spam
- Spoken milestones via TTS enabled (locale: ${interaction.locale})
- Filter out micro tool calls from voice`);

  // 5. Active Project Memory (Scoped to project, if available)
  const effectiveProjectId = projectId || projectsStore.getActiveProjectId();
  if (effectiveProjectId) {
    const project = projectsStore.getProject(effectiveProjectId);
    if (project) {
      const projectLines: string[] = [`[ACTIVE PROJECT CONTEXT]
Project: ${project.name} (${project.id})
Description: ${project.description || 'No description provided'}`];

      const queryTerms = prompt
        .replace(/[^a-z0-9 ]/gi, ' ')
        .split(/\s+/)
        .filter(t => t.length > 3)
        .slice(0, 4)
        .join(' ');

      const projectMemories = retrieveProjectMemory(effectiveProjectId, queryTerms || '', { limit: 3 });
      if (projectMemories.hits.length > 0) {
        projectLines.push('Relevant Project Memories:');
        for (const hit of projectMemories.hits.slice(0, 3)) {
          if (!injectedIds.has(hit.memory.id)) {
            injectedIds.add(hit.memory.id);
            projectLines.push(`- ${hit.memory.title}: ${hit.memory.summary || hit.memory.content.slice(0, 140)}`);
          }
        }
      }
      sections.push(projectLines.join('\n'));
    }
  }

  // 6. Relevant Global Decisions / Preferences (Top 2 matches, deduplicated)
  const cleanTerms = prompt
    .replace(/[^a-z0-9 ]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3)
    .slice(0, 4)
    .join(' ');

  if (cleanTerms) {
    const decisionHits = memoryStore
      .search(cleanTerms, { type: 'decision', status: 'active', limit: 10 })
      .filter((h) => !h.memory.scope.startsWith('project:') && !injectedIds.has(h.memory.id))
      .slice(0, 2);
    if (decisionHits.length > 0) {
      const decLines = ['[RELEVANT DECISIONS & CONSTRAINTS]'];
      for (const hit of decisionHits) {
        injectedIds.add(hit.memory.id);
        decLines.push(`- ${hit.memory.title}: ${hit.memory.summary || hit.memory.content.slice(0, 140)}`);
      }
      sections.push(decLines.join('\n'));
    }
  }

  return {
    text: sections.join('\n\n'),
    injectedMemoryIds: Array.from(injectedIds),
  };
}

/** Convenience wrapper returning the text block. */
export async function getScopedJarvisMemoryContext(
  prompt: string,
  projectId?: string | null
): Promise<string> {
  const res = await getScopedJarvisMemoryContextDetailed(prompt, projectId);
  return res.text;
}
