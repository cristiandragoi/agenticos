/**
 * File-reference pre-resolution for Jarvis delegations (§5, §6, §7).
 *
 * Before Jarvis delegates a file/repository task to a worker, it resolves
 * every file reference in the prompt against the canonical workspace:
 *  - extension-bearing tokens are resolved via resolveFileReference
 *  - unique matches are injected into the delegated prompt so the worker
 *    receives exact relative paths
 *  - when NO referenced file exists, Jarvis answers with the truthful
 *    searched-path report instead of starting a worker that would fail
 */
import { resolveFileReference, getWorkspaceRoot } from '../../services/workspaceStore.js';
/** Extension-bearing file tokens — the gate for pre-resolution. Natural
 *  language names ("look at JarvisChat") are handled by the worker's
 *  readFile repository search (stem matching), so we don't over-gate here. */
const FILE_TOKEN_RE = /[A-Za-z0-9_./\\-]+\.(?:tsx?|jsx?|mjs|cjs|py|md|json|ya?ml|css|html?|sh|sql|toml|env(?:\.[A-Za-z0-9]+)?)\b/g;
export function extractFileTokens(prompt) {
    const matches = (prompt || '').match(FILE_TOKEN_RE) || [];
    const seen = new Set();
    const out = [];
    for (const m of matches) {
        const key = m.toLowerCase().replace(/\\/g, '/');
        if (!seen.has(key)) {
            seen.add(key);
            out.push(m);
        }
    }
    return out;
}
/**
 * Resolve every file token in the prompt against the workspace.
 * Pass workspaceRoot explicitly to honor a task's captured root (§9).
 */
export function resolvePromptFileReferences(prompt, workspaceRoot) {
    const root = workspaceRoot ?? getWorkspaceRoot();
    const fileTokens = extractFileTokens(prompt);
    const outcome = {
        fileTokens,
        resolved: [],
        ambiguous: [],
        unresolvedReports: [],
        workspaceRoot: root,
    };
    for (const token of fileTokens) {
        const result = resolveFileReference(token, root);
        if (result.status === 'found')
            outcome.resolved.push({ token, relativePath: result.relativePath });
        else if (result.status === 'ambiguous')
            outcome.ambiguous.push({ token, matches: result.matches });
        else
            outcome.unresolvedReports.push({ token, report: result.report });
    }
    return outcome;
}
/**
 * Enrich a delegation prompt with resolved paths so the worker never has to
 * guess. Only touches the prompt when at least one token resolved.
 */
export function enrichPromptWithResolvedFiles(prompt, outcome) {
    if (outcome.resolved.length === 0)
        return prompt;
    const lines = outcome.resolved
        .map((r) => `  • "${r.token}" → ${r.relativePath}`)
        .join('\n');
    return `${prompt}\n\nResolved file references (repository ${outcome.workspaceRoot}):\n${lines}`;
}
/**
 * Truthful pre-delegation report (§7): when file tokens exist but NONE
 * resolved, Jarvis reports exactly what was searched instead of delegating
 * a doomed task. Returns null when delegation should proceed.
 */
export function buildFileNotFoundReply(outcome) {
    const hasTokens = outcome.fileTokens.length > 0;
    const noneResolved = outcome.resolved.length === 0 && outcome.ambiguous.length === 0;
    if (!hasTokens || !noneResolved)
        return null;
    const parts = outcome.unresolvedReports.map((u) => u.report);
    return [
        'I could not locate the requested file(s) before delegating, so I did not start a worker for this.',
        '',
        ...parts,
    ].join('\n\n');
}
