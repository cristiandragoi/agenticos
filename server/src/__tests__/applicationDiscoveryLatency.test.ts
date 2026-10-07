import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const shell = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ exec: (command: string, options: unknown, callback: Function) => shell(command, options, callback) }));
import { windowsApplicationResolver as resolver } from '../domains/controlPlane/WindowsApplicationResolver.js';
import { repairKnowledgeStore } from '../domains/controlPlane/RepairKnowledgeStore.js';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-cache-test-'));
let index = 0;
function fixture() {
  const shortcut = path.join(directory, `${++index}.lnk`), target = path.join(directory, `${index}.exe`);
  fs.writeFileSync(shortcut, 'shortcut'); fs.writeFileSync(target, 'fixture');
  shell.mockImplementation((_cmd, _options, cb) => cb(null, { stdout: JSON.stringify({ target, arguments: '' }), stderr: '' }));
  return { shortcut, target, candidate: { name: 'Word', source: 'start_menu' as const, shortcutPath: shortcut, score: .98, description: 'fixture' } };
}
afterEach(() => { vi.restoreAllMocks(); shell.mockReset(); (resolver as any).launcherMetadata.clear(); });
describe('application discovery latency invariants', () => {
  it('reuses unchanged launcher metadata without reusing query scores or windows', async () => {
    const { candidate } = fixture();
    await resolver.launcherIdentity(candidate);
    const second = await resolver.launcherIdentity({ ...candidate, score: .6, name: 'Other query' });
    expect(shell).toHaveBeenCalledTimes(1); expect(second.score).toBe(.6); expect(second.name).toBe('Other query'); expect(second.hwnd).toBeUndefined();
  });
  it('rereads changed shortcuts and expired entries', async () => {
    const { candidate, shortcut } = fixture(); await resolver.launcherIdentity(candidate);
    fs.appendFileSync(shortcut, 'changed'); await resolver.launcherIdentity(candidate);
    expect(shell).toHaveBeenCalledTimes(2);
    for (const entry of (resolver as any).launcherMetadata.values()) entry.expiresAt = 0;
    await resolver.launcherIdentity(candidate); expect(shell).toHaveBeenCalledTimes(3);
  });
  it('does not reuse a deleted executable or cache a failed shell lookup', async () => {
    const { candidate, target } = fixture(); await resolver.launcherIdentity(candidate); fs.unlinkSync(target);
    shell.mockImplementationOnce((_cmd, _options, cb) => cb(new Error('lookup failed')));
    await expect(resolver.launcherIdentity(candidate)).rejects.toThrow('lookup failed');
    expect((resolver as any).launcherMetadata.size).toBe(0);
    await resolver.launcherIdentity(candidate); expect(shell).toHaveBeenCalledTimes(3);
  });
  it('shares simultaneous reads of the same unchanged shortcut', async () => {
    const { candidate, target } = fixture(); let done: Function;
    shell.mockImplementation((_cmd, _options, cb) => { done = cb; });
    const first = resolver.launcherIdentity(candidate), second = resolver.launcherIdentity(candidate);
    done!(null, { stdout: JSON.stringify({ target }), stderr: '' }); await Promise.all([first, second]);
    expect(shell).toHaveBeenCalledTimes(1);
  });
  it('starts independent discovery together and always refreshes visible windows', async () => {
    vi.spyOn(repairKnowledgeStore, 'lookupResolution').mockReturnValue(null);
    const release: Function[] = [];
    for (const name of ['getTaskbarPinnedApps', 'getVisibleWindows', 'getAllShortcuts', 'getStartApps', 'findStandardExecutable']) {
      vi.spyOn(resolver as any, name).mockImplementation(() => new Promise(resolve => release.push(() => resolve(name === 'findStandardExecutable' ? null : []))));
    }
    const first = (resolver as any).discoverCandidates('Word');
    expect(release).toHaveLength(5); release.splice(0).forEach(r => r()); await first;
    const second = (resolver as any).discoverCandidates('Word');
    expect(release).toHaveLength(5); release.forEach(r => r()); await second;
    expect(resolver.getVisibleWindows).toHaveBeenCalledTimes(2);
  });
});

