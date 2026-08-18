import { describe, expect, it } from 'vitest';
import { detectShellFileIo } from '../utils/nativeToolGuard.js';

describe('detectShellFileIo', () => {
  it('flags echo/printf as writeFile candidates', () => {
    expect(detectShellFileIo('echo', ['hello', '>', 'f.txt'])?.nativeTool).toBe('writeFile');
    expect(detectShellFileIo('printf', ['x'])?.nativeTool).toBe('writeFile');
  });

  it('flags cat/type/Get-Content as readFile candidates', () => {
    expect(detectShellFileIo('cat', ['f.txt'])?.nativeTool).toBe('readFile');
    expect(detectShellFileIo('type', ['f.txt'])?.nativeTool).toBe('readFile');
    expect(detectShellFileIo('Get-Content', ['f.txt'])?.nativeTool).toBe('readFile');
  });

  it('flags shell wrappers performing file I/O', () => {
    expect(detectShellFileIo('cmd', ['/c', 'echo hello > f.txt'])?.nativeTool).toBe('writeFile');
    expect(detectShellFileIo('powershell', ['-Command', 'Get-Content f.txt'])?.nativeTool).toBe('readFile');
    expect(detectShellFileIo('sh', ['-c', 'cat f.txt'])?.nativeTool).toBe('readFile');
    expect(detectShellFileIo('cmd.exe', ['/c', 'type f.txt > g.txt'])?.nativeTool).toBe('writeFile');
  });

  it('allows commands that genuinely require a process', () => {
    expect(detectShellFileIo('npm', ['run', 'build'])).toBeNull();
    expect(detectShellFileIo('git', ['status'])).toBeNull();
    expect(detectShellFileIo('tsc', ['--noEmit'])).toBeNull();
    expect(detectShellFileIo('node', ['script.js'])).toBeNull();
  });
});
