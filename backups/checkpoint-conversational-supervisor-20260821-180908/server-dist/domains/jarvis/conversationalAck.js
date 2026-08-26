export function buildConversationalAcknowledgement(prompt, workerKind, readOnly = false) {
    const p = prompt.trim();
    const lower = p.toLowerCase();
    // 1. Specific Revenue / Business / Strategy goals (e.g. "make our first €100", "find leads", "revenue")
    if (/\b(?:make|earn|first)\s+(?:€|\$|£)?\s*\d+|\b(?:revenue|first \d+|business strategy|make money)\b/i.test(lower)) {
        return `Understood. I'll have Hermes compare realistic options that fit our current capabilities and avoid new upfront spending. If implementation is needed, I'll delegate that part to CodeX. I'll keep you updated as the work progresses.`;
    }
    // 2. Planning, Research, Strategy, or Market Analysis (Hermes)
    if (workerKind === 'hermes' || /\b(?:plan|roadmap|strategy|research|analyze|compare|investigate|find|niche)\b/i.test(lower)) {
        return `Understood. I'll have Hermes analyze the request, research viable options, and formulate the plan. I'll keep you updated as progress unfolds.`;
    }
    // 3. Read-only code inspection
    if (readOnly || /\b(?:inspect|read|check|review|search repo|find in code)\b/i.test(lower)) {
        return `Understood. I'll have CodeX inspect the relevant repository files in read-only mode and report its findings. I'll keep you updated.`;
    }
    // 4. CodeX Implementation / Engineering / Refactor / Bug fix / Tests
    if (workerKind === 'codex' || /\b(?:implement|fix|add|create|refactor|build|test|update|modify|edit)\b/i.test(lower)) {
        return `Understood. I'll have CodeX inspect the repository, apply the required changes, and run targeted verification. I'll keep you updated as the work progresses.`;
    }
    // 5. Agent Teams
    if (workerKind === 'team') {
        return `Understood. I'm assembling the agent team to coordinate and execute this request. I'll keep you updated on team milestones.`;
    }
    // 6. Generic Default
    const workerName = workerKind === 'hermes' ? 'Hermes' : workerKind === 'codex' ? 'CodeX' : 'the worker';
    return `Understood. I'm deploying ${workerName} to handle this task. I'll keep you updated on progress.`;
}
