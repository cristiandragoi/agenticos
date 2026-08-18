/**
 * redact.ts — secret redaction for the Agentic OS MCP bridge.
 *
 * Everything that leaves the MCP server (tool results, errors, diagnostics)
 * passes through these helpers. The goal is defense in depth: even if the
 * backend accidentally echoes a credential, it never reaches ChatGPT/Codex.
 */

const SECRET_PATTERNS: RegExp[] = [
  // OpenAI-style keys and generic sk-* tokens
  /\bsk-[A-Za-z0-9_\-]{8,}\b/g,
  // Bearer tokens in headers or JSON
  /\b(Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{12,}/g,
  // Authorization header values
  /("authorization"\s*:\s*"[^"]{8,}")/gi,
  // API key / password / token / secret assignments (JSON or query style)
  /((?:api[_-]?key|apikey|password|passwd|secret|token|access[_-]?token|client[_-]?secret)\s*[:=]\s*)(["']?[A-Za-z0-9._~+/=-]{8,}["']?)/gi,
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, ...groups) => {
      // Preserve the key name, redact the value.
      if (groups[0] && typeof groups[0] === 'string') {
        return `${groups[0]}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }
  return out;
}

/** Deep-redact a JSON-serializable value (recursively). */
export function redactJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSecrets(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redactJson(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactJson(v);
    }
    return out;
  }
  return String(value);
}

/** Sanitize an error for transport: no stack traces, no env dumps. */
export function sanitizeError(err: unknown, fallback = 'Unknown error'): string {
  const raw = err instanceof Error ? err.message : String(err ?? fallback);
  // Strip any stack-like multi-line content
  const single = raw.split('\n')[0] || fallback;
  return redactSecrets(single).slice(0, 500);
}
