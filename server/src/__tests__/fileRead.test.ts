import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFileWindowed, formatReadResult } from '../loops/fileRead.js';

let tmpDir: string;
let bigFile: string;
let smallFile: string;
let singleLineFile: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileRead-test-'));
  // A large multi-line file: 1500 lines, each uniquely identifiable.
  const big = Array.from({ length: 1500 }, (_, i) => `line-${String(i + 1).padStart(4, '0')} payload-${i + 1}`).join('\n') + '\n';
  bigFile = path.join(tmpDir, 'big.ts');
  fs.writeFileSync(bigFile, big, 'utf-8');

  // A small file (fits in one window).
  const small = 'line-0001\nline-0002\nline-0003\n';
  smallFile = path.join(tmpDir, 'small.ts');
  fs.writeFileSync(smallFile, small, 'utf-8');

  // A single giant line (minified-like) — exercises the char-offset path.
  const single = 'X'.repeat(20000) + '\n';
  singleLineFile = path.join(tmpDir, 'minified.js');
  fs.writeFileSync(singleLineFile, single, 'utf-8');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readFileWindowed', () => {
  it('returns the whole small file without truncation', () => {
    const w = readFileWindowed(smallFile, { path: 'small.ts' });
    expect(w.truncated).toBe(false);
    expect(w.totalLines).toBe(3);
    expect(w.returnedStartLine).toBe(1);
    expect(w.returnedEndLine).toBe(3);
    expect(w.nextOffset).toBeNull();
    expect(w.nextStartLine).toBeNull();
    expect(w.content).toContain('line-0003');
  });

  it('truncates a large file and exposes continuation metadata', () => {
    const w = readFileWindowed(bigFile, { path: 'big.ts' });
    expect(w.truncated).toBe(true);
    expect(w.totalLines).toBe(1500);
    expect(w.returnedStartLine).toBe(1);
    expect(w.returnedEndLine).toBeGreaterThan(1);
    expect(w.returnedEndLine).toBeLessThan(1500);
    expect(w.nextStartLine).toBe(w.returnedEndLine + 1);
    expect(typeof w.nextOffset).toBe('number');
    expect(w.content).toContain('line-0001');
    expect(w.content).not.toContain('line-1500');
  });

  it('reads the middle via startLine and returns a distinct window', () => {
    const w = readFileWindowed(bigFile, { path: 'big.ts', startLine: 700, limit: 40 });
    expect(w.returnedStartLine).toBe(700);
    expect(w.content).toContain('line-0700');
    expect(w.content).not.toContain('line-0001');
  });

  it('reads the end via startLine and is NOT truncated at EOF', () => {
    const w = readFileWindowed(bigFile, { path: 'big.ts', startLine: 1450 });
    expect(w.content).toContain('line-1450');
    expect(w.content).toContain('line-1500');
    expect(w.truncated).toBe(false);
    expect(w.nextOffset).toBeNull();
  });

  it('supports char-offset reads for a single giant line', () => {
    const w = readFileWindowed(singleLineFile, { path: 'minified.js' });
    expect(w.totalLines).toBe(1); // one giant line; trailing newline not a line
    expect(w.truncated).toBe(true);
    expect(typeof w.nextOffset).toBe('number');
    // Continuation resumes exactly where the first window ended.
    const w2 = readFileWindowed(singleLineFile, { path: 'minified.js', offset: w.nextOffset! });
    expect(w2.content.length).toBeGreaterThan(0);
  });

  it('formatReadResult embeds continuation instruction when truncated', () => {
    const w = readFileWindowed(bigFile, { path: 'big.ts' });
    const s = formatReadResult('big.ts', w);
    expect(s).toContain('TRUNCATED');
    expect(s).toContain('"offset"');
    expect(s).toContain(`of ${w.totalLines}`);
  });

  it('never loses content: sequential windows tile the file exactly', () => {
    const full = fs.readFileSync(bigFile, 'utf-8');
    let offset = 0;
    let assembled = '';
    const chunks: string[] = [];
    for (let i = 0; i < 200; i++) {
      const w = readFileWindowed(bigFile, { path: 'big.ts', offset });
      chunks.push(w.content);
      assembled += w.content;
      if (!w.truncated) break;
      offset = w.nextOffset!;
    }
    expect(assembled).toBe(full);
  });
});
