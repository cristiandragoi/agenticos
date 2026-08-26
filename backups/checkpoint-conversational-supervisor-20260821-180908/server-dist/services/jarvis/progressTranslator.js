/**
 * Canonical Jarvis Progress Translator (Jarvis Conversational Supervisor Milestone).
 *
 * Translates raw low-level backend, worker, queue, and verification events into
 * concise, truthful, human-level conversational narration.
 *
 * CRITICAL RULE: Zero fabrication. Every translation statement MUST map directly
 * to real persisted/runtime events from background tasks, Hermes runs, CodeX goals,
 * verifiers, or heartbeat timers.
 */
export class JarvisProgressTranslator {
    /**
     * Translate a runtime execution event into a concise conversational statement.
     */
    translate(input) {
        const workerTitle = input.worker === 'hermes' ? 'Hermes'
            : input.worker === 'codex' ? 'CodeX'
                : input.worker === 'revenue' ? 'Revenue Operator'
                    : input.worker === 'team' ? 'Agent Teams'
                        : 'Worker';
        switch (input.eventKind) {
            case 'task_created':
                return `I have it. ${workerTitle} is starting now.`;
            case 'task_queued': {
                const pos = input.queuePosition || 1;
                const ahead = Math.max(0, pos - 1);
                if (ahead > 0) {
                    return `The task is queued, position ${pos}. ${ahead} worker${ahead > 1 ? 's are' : ' is'} ahead of it.`;
                }
                return `The task is queued, position ${pos}.`;
            }
            case 'task_started':
                if (input.worker === 'hermes') {
                    return 'Hermes is analyzing the request and deciding what should be delegated.';
                }
                if (input.worker === 'codex') {
                    return 'CodeX has begun working on the implementation.';
                }
                return `${workerTitle} is active and processing the task.`;
            case 'planning':
                if (input.worker === 'hermes') {
                    return 'Hermes is analyzing the request and formulating the plan.';
                }
                return `${workerTitle} is generating the execution plan.`;
            case 'delegation_dispatched':
                return 'Hermes has delegated the implementation to CodeX.';
            case 'inspecting_files':
                if (input.files && input.files.length > 0) {
                    const filePreview = input.files.slice(0, 2).join(', ');
                    return `CodeX is inspecting the relevant repository files (${filePreview}${input.files.length > 2 ? '…' : ''}).`;
                }
                return 'CodeX is inspecting the relevant repository files.';
            case 'applying_changes':
                if (input.files && input.files.length > 0) {
                    const filePreview = input.files.slice(0, 2).join(', ');
                    return `CodeX is applying changes to ${filePreview}${input.files.length > 2 ? '…' : ''}.`;
                }
                return 'CodeX is applying the change now.';
            case 'running_tests':
                return 'CodeX is running the targeted verification.';
            case 'tool_started':
                if (input.toolName) {
                    if (/grep|find|search|glob|read/i.test(input.toolName)) {
                        return `CodeX is inspecting the repository (${input.toolName}).`;
                    }
                    if (/edit|write|replace|patch/i.test(input.toolName)) {
                        return `CodeX is applying edits with ${input.toolName}.`;
                    }
                    if (/test|vitest|jest|pytest|build|check/i.test(input.toolName)) {
                        return `CodeX is running targeted checks (${input.toolName}).`;
                    }
                    return `${workerTitle} is running tool: ${input.toolName}.`;
                }
                return `${workerTitle} is executing a tool step.`;
            case 'tool_completed':
                if (input.summary) {
                    return input.summary;
                }
                return `${workerTitle} tool step completed.`;
            case 'tool_failed':
                return `${workerTitle} tool step failed${input.failureReason ? `: ${input.failureReason}` : '.'}`;
            case 'approval_required':
                if (input.summary) {
                    return `I need your approval before the next step: ${input.summary}`;
                }
                return 'I need your approval before the next step.';
            case 'verification_started':
                return 'Independent verification is running.';
            case 'verification_passed':
                return 'Verification passed.';
            case 'verification_failed':
                return `Verification did not pass${input.failureReason ? `: ${input.failureReason}` : '.'}`;
            case 'intermediate_finding':
                if (input.summary) {
                    return input.summary;
                }
                return `${workerTitle} produced an intermediate finding.`;
            case 'possible_stall': {
                const secs = input.idleSeconds ?? 45;
                return `There has been no worker activity for ${secs} seconds. The task is still marked running; I am checking its health.`;
            }
            case 'stalled':
                return `${workerTitle} appears stalled. Attempting safe recovery.`;
            case 'recovering':
                return `Attempting safe automated recovery for ${workerTitle}.`;
            case 'failed': {
                const reason = input.failureReason || input.summary || 'Unknown worker error';
                return `The worker failed. The actual reason is: ${reason}.`;
            }
            case 'completed': {
                if (input.resultSummary) {
                    return input.resultSummary;
                }
                return `${workerTitle} task completed successfully.`;
            }
            default:
                return input.summary || `${workerTitle} status updated.`;
        }
    }
    /**
     * Determine if a translated event is significant enough to speak via TTS.
     * Filters out low-level tool noise and speaks only human-level milestones.
     */
    isSpokenMilestone(eventKind) {
        switch (eventKind) {
            case 'task_created':
            case 'task_queued':
            case 'task_started':
            case 'delegation_dispatched':
            case 'approval_required':
            case 'verification_passed':
            case 'intermediate_finding':
            case 'possible_stall':
            case 'failed':
            case 'completed':
                return true;
            case 'inspecting_files':
            case 'applying_changes':
            case 'running_tests':
            case 'tool_started':
            case 'tool_completed':
            case 'tool_failed':
            case 'planning':
            case 'verification_started':
            case 'verification_failed':
            case 'stalled':
            case 'recovering':
            default:
                return false;
        }
    }
}
export const progressTranslator = new JarvisProgressTranslator();
