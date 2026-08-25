// fileRead.ts — deterministic, range-capable file reads for the CodeX loop.
//
// The previous readFile implementation truncated every file to its first 4096
// characters with no way to request more. Large files therefore "failed
// ambiguously": the model could only ever see the head of a file and had no
// continuation contract. This module makes reads explicit and resumable:
//
//   - startLine / endLine (1-indexed, inclusive)  → line-oriented reads
//   - offset / limit      (0-indexed char window) → minified/single-line files
//   - every result exposes: truncated, totalLines, totalBytes, returnedStart,
//     returnedEnd, nextStartLine / nextOffset — so the model can continue
//     reading automatically instead of guessing.
//
// Continuation is char-offset based (nextOffset) because it is always exact,
// including when a window boundary falls mid-line; nextStartLine is provided
// as a convenience hint only.
import fs from 'fs';

export interface ReadWindow {
  content: string;
  returnedStartLine: number;
  returnedEndLine: number;
  totalLines: number;
  totalBytes: number;
  truncated: boolean;
  nextStartLine: number | null;
  nextOffset: number | null;
}

const DEFAULT_READ_CHARS = 4000;
const DEFAULT_READ_LINES = 80;

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function readFileWindowed(absolutePath: string, args: Record<string, unknown>): ReadWindow {
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const totalBytes = Buffer.byteLength(content, 'utf-8');
  const totalChars = content.length;
  const rawLines = content.split('\n');
  // A trailing newline produces a final empty string; don't count it as a
  // line (a file "a\nb\nc\n" has 3 lines, not 4).
  const totalLines = rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
    ? rawLines.length - 1
    : rawLines.length;
  const lines = rawLines;

  // Resolve the requested range into char offsets.
  const explicitOffset = args.offset != null;
  const lineOriented = !explicitOffset && (args.startLine != null || args.offsetLine != null || args.endLine != null);

  let startChar = 0;
  let endChar: number;

  if (explicitOffset) {
    startChar = Math.max(0, toInt(args.offset, 0));
    const limit = Math.max(1, toInt(args.limit, DEFAULT_READ_CHARS));
    endChar = startChar + limit;
  } else if (lineOriented) {
    const s = Math.max(1, toInt(args.startLine ?? args.offsetLine, 1));
    startChar = s > 1 ? lines.slice(0, s - 1).join('\n').length + 1 : 0;
    if (args.endLine != null) {
      const e = Math.max(s, toInt(args.endLine, s));
      endChar = e >= totalLines ? totalChars : lines.slice(0, e).join('\n').length;
    } else {
      const e = Math.min(totalLines, s + DEFAULT_READ_LINES - 1);
      endChar = e >= totalLines ? totalChars : lines.slice(0, e).join('\n').length;
    }
  } else {
    // Default: the first window.
    startChar = 0;
    endChar = DEFAULT_READ_CHARS;
  }

  startChar = Math.max(0, Math.min(startChar, totalChars));
  endChar = Math.max(startChar, Math.min(endChar, totalChars));

  // For line-oriented reads, trim the window back to the previous newline so a
  // window never ends mid-line (the model can continue cleanly with
  // nextStartLine). Explicit char-offset reads stay exact (precise resume).
  if (!explicitOffset && endChar < totalChars) {
    const lastNl = content.lastIndexOf('\n', endChar - 1);
    if (lastNl >= startChar) endChar = lastNl;
  }

  const window = content.substring(startChar, endChar);
  const truncated = endChar < totalChars;
  const before = content.substring(0, startChar);

  // 1-indexed line numbers. A trailing newline in `before` or `window` yields
  // a trailing empty split element; clamp so the reported range stays within
  // [1, totalLines]. These are orientation hints — the authoritative resume
  // point is nextOffset.
  let startLine = Math.max(1, before.split('\n').length);
  let endLine = Math.max(startLine, (before + window).split('\n').length);
  if (startLine > totalLines) startLine = totalLines;
  if (endLine > totalLines) endLine = totalLines;

  return {
    content: window,
    returnedStartLine: startLine,
    returnedEndLine: endLine,
    totalLines,
    totalBytes,
    truncated,
    nextStartLine: truncated ? endLine + 1 : null,
    nextOffset: truncated ? endChar : null,
  };
}

export function formatReadResult(displayPath: string, w: ReadWindow): string {
  const range = `[lines ${w.returnedStartLine}-${w.returnedEndLine} of ${w.totalLines}] [${w.totalBytes} bytes]`;
  let out = `=== readFile: ${displayPath} ===\n${range}\n`;
  if (w.truncated) {
    out += `[TRUNCATED: ${w.totalLines - w.returnedEndLine} more line(s) remain. To continue reading, emit:\n` +
      `{ "type": "tool_call", "tool": "readFile", "arguments": { "path": "${displayPath}", "offset": ${w.nextOffset} } }]\n`;
  }
  out += w.content;
  if (w.truncated) {
    out += `\n\n[END OF WINDOW — continue reading with offset=${w.nextOffset} (or startLine=${w.nextStartLine})]`;
  }
  return out;
}
