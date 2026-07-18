import type { GoalRecord, GoalEvent, RunSummary } from '../../server/src/types';

export function sanitizeExport(data: any): any {
  if (data === null || data === undefined) return data;
  
  if (typeof data === 'string') {
    // Redact Bearer tokens, passwords, keys
    let sanitized = data.replace(/Bearer\s+[A-Za-z0-9\-\._~+\/]+=*/g, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/(api_key|apikey|secret|password|token)["']?\s*[:=]\s*["']?[^"'\s&}]+["']?/gi, '$1: [REDACTED]');
    return sanitized;
  }
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizeExport(item));
  }
  
  if (typeof data === 'object') {
    const sanitizedObj: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (/secret|password|token|api_?key/i.test(key)) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = sanitizeExport(value);
      }
    }
    return sanitizedObj;
  }
  
  return data;
}

export function exportJSON(goal: GoalRecord, summary: RunSummary, events: GoalEvent[]) {
  const envelope = {
    exportSchemaVersion: 1,
    exportedAt: new Date().toISOString(),
    run: goal,
    summary,
    events
  };
  
  const sanitized = sanitizeExport(envelope);
  const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `codex-run-\${goal.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateMarkdownReport(goal: GoalRecord, summary: RunSummary, events: GoalEvent[]): string {
  const sanitizedSummary = sanitizeExport(summary);
  const totalEvents = events.length;
  
  return `# CodeX Run Report
**Run ID:** \${goal.id}
**Status:** \${sanitizedSummary.status}
**Started:** \${new Date(sanitizedSummary.startedAt).toLocaleString()}
**Duration:** \${(sanitizedSummary.durationMs / 1000).toFixed(1)}s
**Model:** \${sanitizedSummary.runtimeModel}
**Provider:** \${sanitizedSummary.provider}

## Diagnostics
- **Total Events:** \${totalEvents}
- **Tool Calls:** \${sanitizedSummary.diagnostics?.totalToolCalls || 0}
- **Retries:** \${sanitizedSummary.diagnostics?.totalRetries || 0}
- **Validation:** \${sanitizedSummary.validationStatus}

## Final Summary
\${sanitizedSummary.summary}
`;
}
