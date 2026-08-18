// P12 spike v2 — capture full error shape, longer timeout, more diagnostics.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-spike2-'));
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-spike2-wd-'));
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

const npmPrefix = process.env.npm_config_prefix || path.join(process.env.APPDATA || process.env.USERPROFILE || '', 'npm');
const codexJs = path.join(npmPrefix, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
console.log('CODEX_JS_EXISTS', fs.existsSync(codexJs), codexJs);
const codexArgs = [codexJs, 'exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'workspace-write', '-C', workdir, 'Reply with exactly: OK'];
try {
  const out = execFileSync(process.execPath, codexArgs, {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: codexHome, DEEPSEEK_API_KEY: 'sk-throwaway-notreal-0000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('SUCCESS_OUT', out.slice(0, 2000));
} catch (e) {
  console.log('ERR_NAME', e.name);
  console.log('ERR_MESSAGE', String(e.message).slice(0, 500));
  console.log('ERR_STATUS', e.status);
  console.log('ERR_SIGNAL', e.signal);
  if (e.stdout) console.log('STDOUT', String(e.stdout).slice(-2000));
  if (e.stderr) console.log('STDERR', String(e.stderr).slice(-2000));
}
try { fs.rmSync(codexHome, { recursive: true, force: true }); } catch {}
try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
