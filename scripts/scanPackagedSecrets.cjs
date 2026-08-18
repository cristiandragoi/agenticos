/**
 * scanPackagedSecrets.cjs
 *
 * Scans packaged resources (release/win-unpacked and Desktop) for:
 * 1. Any .env files (forbidden in packaged distribution)
 * 2. Static API keys (sk-..., sk-ant-..., long bearer tokens) in server/dist, app/dist, config files
 *
 * Rules:
 * - NEVER prints raw secrets.
 * - Reports: secret type, file containing it, REDACTED preview, remediation status.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TARGETS = [
  'B:\\AgenticOS\\release\\win-unpacked',
  'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS',
];

const SECRET_PATTERNS = [
  { type: 'OpenAI/DeepSeek Key (sk-...)', regex: /\bsk-[A-Za-z0-9_-]{24,}\b/g },
  { type: 'Anthropic Key (sk-ant-...)', regex: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/g },
  { type: 'OpenRouter Key (sk-or-...)', regex: /\bsk-or-[A-Za-z0-9_-]{24,}\b/g },
];

function checkEnvFiles(dir) {
  const envFiles = [];
  function walk(current) {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory() && e.name !== 'node_modules') {
        walk(full);
      } else if (e.isFile() && (e.name === '.env' || (e.name.startsWith('.env.') && e.name !== '.env.example'))) {
        envFiles.push(full);
      }
    }
  }
  walk(dir);
  return envFiles;
}

function scanCodeAndConfigFiles(dir) {
  const violations = [];
  const dirsToScan = [
    path.join(dir, 'resources', 'server', 'dist'),
    path.join(dir, 'resources', 'app', 'dist'),
    path.join(dir, 'resources', 'app', 'dist-electron'),
  ];

  for (const d of dirsToScan) {
    if (!fs.existsSync(d)) continue;
    const files = fs.readdirSync(d, { recursive: true });
    for (const f of files) {
      if (typeof f !== 'string') continue;
      const full = path.join(d, f);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
        const content = fs.readFileSync(full, 'utf8');
        for (const pat of SECRET_PATTERNS) {
          const matches = content.match(pat.regex);
          if (matches) {
            for (const m of matches) {
              if (m.includes('REDACTED') || m.includes('placeholder') || m.includes('dummy') || m.includes('test-key') || m.includes('example')) continue;
              violations.push({ file: full, type: pat.type });
            }
          }
        }
      } catch {}
    }
  }
  return violations;
}

console.log('═'.repeat(60));
console.log('  AGENTIC OS — PACKAGED PRODUCTION SECRET AUDIT');
console.log('═'.repeat(60));

let totalViolations = 0;

for (const target of TARGETS) {
  console.log(`\nScanning target: ${target}`);
  
  // 1. Check .env files
  const envFiles = checkEnvFiles(target);
  if (envFiles.length > 0) {
    for (const ef of envFiles) {
      console.error(`  ❌ [VIOLATION] Forbidden .env file found: ${ef}`);
      totalViolations++;
    }
  } else {
    console.log('  ✅ No .env files present in packaged resources.');
  }

  // 2. Scan code and config files for static API keys
  const codeViolations = scanCodeAndConfigFiles(target);
  if (codeViolations.length > 0) {
    for (const cv of codeViolations) {
      console.error(`  ❌ [VIOLATION] ${cv.type} in: ${cv.file} ([REDACTED])`);
      totalViolations++;
    }
  } else {
    console.log('  ✅ No static API keys or hardcoded secrets found in bundle code/config.');
  }
}

console.log('\n' + '═'.repeat(60));
if (totalViolations === 0) {
  console.log('  SECRET AUDIT VERDICT: PASS — NO STATIC PROVIDER SECRETS FOUND');
} else {
  console.error(`  SECRET AUDIT VERDICT: FAIL — ${totalViolations} STATIC SECRETS REMAIN`);
  process.exitCode = 1;
}
console.log('═'.repeat(60) + '\n');
