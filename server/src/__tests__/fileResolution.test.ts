/**
 * Jarvis file pre-resolution at the delegation gate (§5–§7).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let repoDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileres-'));
  repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(path.join(repoDir, 'server/src/domains/jarvis'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src/components/jarvis'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'server/src/domains/jarvis/intentRouter.ts'), '// router\n');
  fs.writeFileSync(path.join(repoDir, 'src/components/jarvis/JarvisChat.tsx'), '// chat\n');
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('file-token extraction (§6)', () => {
  it('extracts extension-bearing tokens without duplicates', async () => {
    const { extractFileTokens } = await import('../domains/jarvis/fileResolution.js');
    const tokens = extractFileTokens('Inspect intentRouter.ts and then re-read intentRouter.ts again. Also check JarvisChat.tsx');
    expect(tokens).toContain('intentRouter.ts');
    expect(tokens).toContain('JarvisChat.tsx');
    expect(tokens.filter((t: string) => t === 'intentRouter.ts')).toHaveLength(1);
  });

  it('natural-language prompts carry no file tokens (worker search handles them)', async () => {
    const { extractFileTokens } = await import('../domains/jarvis/fileResolution.js');
    expect(extractFileTokens('look at JarvisChat')).toHaveLength(0);
    expect(extractFileTokens('check the routing file')).toHaveLength(0);
  });
});

describe('delegation enrichment (§5)', () => {
  it('injects resolved relative paths into the delegated objective', async () => {
    const { resolvePromptFileReferences, enrichPromptWithResolvedFiles } = await import('../domains/jarvis/fileResolution.js');
    const outcome = resolvePromptFileReferences('Inspect intentRouter.ts and report what it does.', repoDir);
    expect(outcome.resolved).toHaveLength(1);
    expect(outcome.resolved[0].relativePath.replace(/\\/g, '/')).toBe('server/src/domains/jarvis/intentRouter.ts');
    const enriched = enrichPromptWithResolvedFiles('Inspect intentRouter.ts', outcome);
    expect(enriched).toContain('server/src/domains/jarvis/intentRouter.ts');
    expect(enriched).toContain(repoDir);
  });

  it('leaves the prompt untouched when nothing resolved', async () => {
    const { resolvePromptFileReferences, enrichPromptWithResolvedFiles } = await import('../domains/jarvis/fileResolution.js');
    const outcome = resolvePromptFileReferences('Summarize the architecture', repoDir);
    expect(enrichPromptWithResolvedFiles('Summarize the architecture', outcome)).toBe('Summarize the architecture');
  });
});

describe('truthful pre-delegation not-found (§7)', () => {
  it('blocks delegation with a searched-path report when no referenced file exists', async () => {
    const { resolvePromptFileReferences, buildFileNotFoundReply } = await import('../domains/jarvis/fileResolution.js');
    const outcome = resolvePromptFileReferences('Inspect nonexistent-widget.ts', repoDir);
    const reply = buildFileNotFoundReply(outcome);
    expect(reply).not.toBeNull();
    expect(reply).toContain('File not found in selected repository');
    expect(reply).toContain(repoDir);
    expect(reply).toContain('Search attempted');
  });

  it('allows delegation when at least one referenced file resolved', async () => {
    const { resolvePromptFileReferences, buildFileNotFoundReply } = await import('../domains/jarvis/fileResolution.js');
    const outcome = resolvePromptFileReferences('Inspect intentRouter.ts and also missing-file.ts', repoDir);
    expect(buildFileNotFoundReply(outcome)).toBeNull();
  });

  it('allows delegation for prompts with no file tokens', async () => {
    const { resolvePromptFileReferences, buildFileNotFoundReply } = await import('../domains/jarvis/fileResolution.js');
    const outcome = resolvePromptFileReferences('Give me feedback regarding CodeX', repoDir);
    expect(buildFileNotFoundReply(outcome)).toBeNull();
  });
});
