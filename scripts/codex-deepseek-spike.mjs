// P12 spike: does Codex 0.145.0 accept a custom model_providers entry with
// wire_api="chat" pointing at DeepSeek? Uses a THROWAWAY key (never the real
// one) to test config validation + wire behavior only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-spike-home-'));
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-spike-wd-'));
fs.writeFileSync(path.join(workdir, 'probe.txt'), 'hello\n');

const config = `
model = "deepseek-v4-flash"
model_provider = "deepseek"
[model_providers.deepseek]
name = "DeepSeek V4"
base_url = "https://api.deepseek.com/v1"
env_key = "DEEPSEEK_API_KEY"
wire_api = "chat"
`;
fs.writeFileSync(path.join(codexHome, 'config.toml'), config);

console.log('CODEX_HOME', codexHome);
console.log('CONFIG_WRITTEN', JSON.stringify(config));

// Run a trivial probe with a throwaway key. We expect either:
//  - a wire-level 401 from DeepSeek (config ACCEPTED, protocol reached), or
//  - a config validation error (contract mismatch).
try {
  const out = execFileSync('codex', ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'workspace-write', '-C', workdir, 'Reply with exactly: OK'], {
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: codexHome, DEEPSEEK_API_KEY: 'sk-throwaway-notreal-0000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('OUT', out.slice(0, 2000));
} catch (e) {
  const err = e;
  const stdout = err.stdout || '';
  const stderr = err.stderr || '';
  const code = err.status;
  console.log('EXIT', code);
  console.log('STDOUT_TAIL', stdout.slice(-1500));
  console.log('STDERR_TAIL', stderr.slice(-1500));
}
try { fs.rmSync(codexHome, { recursive: true, force: true }); } catch {}
try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
