/**
 * Project-scoped memory + continuation (memory continuity milestone).
 *
 * Authoritative memory stays in the SQLite `memoryStore` — this module only
 * adds the PROJECT namespace (`scope: 'project:<id>'`) and the resolution
 * helpers on top of it. No new storage subsystem.
 *
 * - storeProjectMemory()   — explicit durable project memory (P5)
 * - retrieveProjectMemory()— project-scoped retrieval, global only on demand (P6/P10)
 * - resolveContinuation()  — "continue where we left off" (P7/P8)
 * - getProjectContext()    — the authoritative resolved active-project contract (P3)
 * - recordMemoryActivity() — bounded memory.* event ring (P12)
 */
import { memoryStore } from '../../services/memory/store.js';
import { createMemory } from '../../services/memory/distill.js';
import { projectsStore } from '../../services/projectsStore.js';
import { ensureBackgroundTaskTables } from '../../services/backgroundTasks/store.js';
export const PROJECT_SCOPE_PREFIX = 'project:';
export const projectScope = (projectId) => `${PROJECT_SCOPE_PREFIX}${projectId}`;
const MAX_RING = 100;
const activityRing = [];
export function recordMemoryActivity(e) {
    activityRing.push({ ...e, ts: Date.now() });
    if (activityRing.length > MAX_RING)
        activityRing.shift();
}
export function listMemoryActivity(limit = 30) {
    return activityRing.slice(-limit).reverse();
}
// ── P7 — continuation-request detection ─────────────────────────────────────
const CONTINUATION_RE = /\b(continue where we left off|where (were|are) we|what were we (doing|working on)|what should we do next|pick up where we left|what was our (last|next) (task|priority|milestone|step)|what is the next (step|task|priority)|what did (codex|hermes) (do|finish) last)\b/i;
export function isContinuationRequest(prompt) {
    return CONTINUATION_RE.test(prompt.trim());
}
// ── P2 — deterministic active-project answers ───────────────────────────────
// NARROW: only the plain project-state question forms ("What project are we
// working on?", "Which project is active?", "What's the current project?").
// Anything with extra intent falls through to normal routing — this must not
// become a broad keyword interception.
const PROJECT_STATE_RE = /^(?:what('?s| is)\s+(the\s+|our\s+)?(current\s+|active\s+)?project\b|what\s+project\s+(are|is)\b|which\s+(the\s+)?(current\s+|active\s+)?project\b)/i;
export function isDeterministicProjectQuestion(prompt) {
    return PROJECT_STATE_RE.test(prompt.trim());
}
export function formatProjectStateAnswer(activeProjectId) {
    if (!activeProjectId)
        return { reply: 'No project is currently selected.', projectId: null };
    const project = projectsStore.getProject(activeProjectId);
    if (!project)
        return { reply: 'No project is currently selected.', projectId: null };
    return { reply: `We're currently working on ${project.name}.`, projectId: activeProjectId };
}
// ── P5 — explicit project-memory write ──────────────────────────────────────
export function storeProjectMemory(projectId, input) {
    const scope = projectScope(projectId);
    const m = createMemory({
        type: input.type,
        title: input.title.slice(0, 120),
        summary: (input.summary || input.content).slice(0, 300),
        content: input.content,
        scope,
        entities: input.entities || [],
        tags: ['project', ...(input.tags || [])],
        confidence: input.confidence ?? 0.8,
        source: input.source || { sourceType: 'system' },
    });
    return m;
}
// ── P6/P10 — project-scoped retrieval ───────────────────────────────────────
// Cross-project isolation is a HARD filter: the active project's memories are
// preferred; global memories are only included when explicitly requested.
export function retrieveProjectMemory(projectId, query, opts = {}) {
    const q = query.trim();
    if (!q)
        return { hits: [], usedScope: null, globalUsed: false };
    const limit = opts.limit ?? 3;
    const projectHits = projectId
        ? memoryStore.search(q, { status: 'active', limit: 50 })
            .filter((h) => h.memory.scope === projectScope(projectId))
            .slice(0, limit)
        : [];
    if (projectHits.length) {
        recordMemoryActivity({
            kind: 'memory.lookup.completed',
            projectId,
            category: 'project-recall',
            resultCount: projectHits.length,
            memoryIds: projectHits.map((h) => h.memory.id),
        });
        return { hits: projectHits, usedScope: projectId ? projectScope(projectId) : null, globalUsed: false };
    }
    // Global fallback only when explicitly allowed (or no project is active).
    if (opts.includeGlobal || !projectId) {
        const globalHits = memoryStore.search(q, { status: 'active', limit })
            .filter((h) => !h.memory.scope.startsWith(PROJECT_SCOPE_PREFIX));
        recordMemoryActivity({
            kind: 'memory.lookup.completed',
            projectId,
            category: 'recall',
            resultCount: globalHits.length,
            memoryIds: globalHits.map((h) => h.memory.id),
        });
        return { hits: globalHits, usedScope: null, globalUsed: true };
    }
    recordMemoryActivity({ kind: 'memory.lookup.completed', projectId, category: 'project-recall', resultCount: 0, memoryIds: [] });
    return { hits: [], usedScope: projectId ? projectScope(projectId) : null, globalUsed: false };
}
// ── P3 — authoritative resolved project context ─────────────────────────────
export function getProjectContext(projectId) {
    if (!projectId) {
        return { id: null, name: null, description: null, currentGoal: null, currentTask: null, lastMeaningfulActivity: null, relevantMemoryNamespace: null };
    }
    const project = projectsStore.getProject(projectId);
    if (!project) {
        return { id: null, name: null, description: null, currentGoal: null, currentTask: null, lastMeaningfulActivity: null, relevantMemoryNamespace: null };
    }
    const recentMemories = memoryStore.timeline({ limit: 20 }).filter((m) => m.scope === projectScope(projectId));
    const lastMemory = recentMemories[0] || null;
    return {
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        currentGoal: lastMemory?.type === 'decision' ? lastMemory.title : null,
        currentTask: lastMemory?.title ?? null,
        lastMeaningfulActivity: lastMemory ? `${lastMemory.title} (${new Date(lastMemory.createdAt).toISOString()})` : null,
        relevantMemoryNamespace: projectScope(projectId),
    };
}
export function resolveContinuation(projectId) {
    if (!projectId) {
        return { project: null, lastTask: null, lastRun: null, lastMemory: null, insufficient: 'No active project is selected. Select a project first, then I can tell you where we left off.' };
    }
    const project = projectsStore.getProject(projectId);
    if (!project) {
        return { project: null, lastTask: null, lastRun: null, lastMemory: null, insufficient: 'The active project no longer exists. Select a project first.' };
    }
    // 2. latest meaningful task (most recent activity, terminal or in-flight)
    let lastTask = null;
    try {
        ensureBackgroundTaskTables();
        const { backgroundTaskRepo } = awaitImportTaskRepo();
        const all = backgroundTaskRepo.listTasks({ limit: 200 });
        const relevant = (Array.isArray(all) ? all : []).filter((t) => t.updatedAt);
        relevant.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const top = relevant[0];
        if (top) {
            lastTask = {
                taskId: top.taskId,
                title: top.title || top.objective || 'untitled task',
                status: top.status,
                worker: top.worker || null,
                blocker: top.blocker || top.lastError || null,
                updatedAt: top.updatedAt,
            };
        }
    }
    catch { /* tasks unavailable — continue without */ }
    // 3. latest project memory
    const recentMemories = memoryStore.timeline({ limit: 30 }).filter((m) => m.scope === projectScope(projectId));
    const lastMemory = recentMemories[0] || null;
    // 4. latest run (fallback signal if no tasks)
    let lastRun = null;
    try {
        const { runStore } = awaitImportRunStore();
        const runs = runStore.list();
        if (Array.isArray(runs) && runs.length) {
            const sorted = [...runs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
            const top = sorted[0];
            lastRun = { id: top.id, status: top.status || 'unknown', agent: top.agentId || null, updatedAt: top.createdAt || null };
        }
    }
    catch { /* runs unavailable */ }
    return {
        project: { id: project.id, name: project.name, description: project.description ?? null },
        lastTask,
        lastRun,
        lastMemory,
        insufficient: null,
    };
}
// Dynamic imports (kept lazy so the module stays import-safe in tests).
function awaitImportTaskRepo() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return import('../../services/backgroundTasks/store.js');
}
function awaitImportRunStore() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return import('../../services/runStore.js');
}
/** Format a continuation result into a concise, truthful answer. */
export function formatContinuation(r) {
    if (r.insufficient)
        return r.insufficient;
    const lines = [];
    if (r.project)
        lines.push(`Project: ${r.project.name}`);
    if (r.lastTask) {
        if (r.lastTask.status === 'completed') {
            lines.push(`Last completed: ${r.lastTask.title}`);
        }
        else if (r.lastTask.status === 'failed' || r.lastTask.status === 'blocked') {
            lines.push(`Last attempt: ${r.lastTask.title} (${r.lastTask.status})`);
        }
        else {
            lines.push(`Current activity: ${r.lastTask.title} (${r.lastTask.status})`);
        }
        const blocker = r.lastTask.blocker;
        if (blocker)
            lines.push(`Current blocker: ${blocker.slice(0, 200)}`);
    }
    else if (r.lastRun) {
        lines.push(`Last run: ${r.lastRun.agent || 'agent'} finished with status ${r.lastRun.status}`);
    }
    if (r.lastMemory)
        lines.push(`Next recorded priority: ${r.lastMemory.title}`);
    if (!r.lastTask && !r.lastMemory && !r.lastRun) {
        lines.push('No recorded project activity yet. What would you like to start with?');
    }
    else {
        lines.push('No recorded next step beyond this — tell me what to pick up next.');
    }
    return lines.join('\n');
}
