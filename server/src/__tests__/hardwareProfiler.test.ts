/**
 * HardwareProfiler V1 tests — all hardware access mocked via injectable
 * exec/fetch probes. Covers: Windows, Linux/WSL, no GPU, NVIDIA GPU,
 * missing nvidia-smi, Ollama running/stopped, partial profile, capability
 * classifier, model recommendations, cache behavior, no secret leakage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildHardwareProfile,
  classifyCapabilityTier,
  recommendModels,
  parseParameterBillions,
  getHardwareProfile,
  clearHardwareProfileCache,
  TIER_THRESHOLDS,
  type ExecResult,
  type FetchResult,
  type OllamaModelInfo,
} from '../services/system/hardwareProfiler.js';

// ── Probe builders ──────────────────────────────────────────────────────────

function makeExec(responses: Record<string, ExecResult>) {
  return vi.fn((command: string): ExecResult => {
    for (const [prefix, result] of Object.entries(responses)) {
      if (command.includes(prefix)) return result;
    }
    return { ok: false, stdout: '' };
  });
}

function makeFetch(responses: Record<string, FetchResult>) {
  return vi.fn(async (url: string): Promise<FetchResult> => {
    for (const [substr, result] of Object.entries(responses)) {
      if (url.includes(substr)) return result;
    }
    return { ok: false };
  });
}

const OLLAMA_MODELS_JSON = {
  models: [
    { name: 'qwen3.5:4b', size: 2_700_000_000, modified_at: 'x', details: { family: 'qwen3', parameter_size: '4B', quantization_level: 'Q4_K_M' } },
    { name: 'qwen3.5:cloud', size: 12_000_000_000, details: { family: 'qwen3', parameter_size: '14B', quantization_level: 'Q4_K_M' } },
  ],
};

const OLLAMA_UP = {
  '/api/version': { ok: true, status: 200, json: { version: '0.11.0' } },
  '/api/tags': { ok: true, status: 200, json: OLLAMA_MODELS_JSON },
} as Record<string, FetchResult>;

const OLLAMA_DOWN = {} as Record<string, FetchResult>;

const GB = 1024 ** 3;

describe('hardwareProfiler — platform detection', () => {
  it('detects Linux with WSL2 from /proc/version', async () => {
    const exec = makeExec({
      '/proc/version': { ok: true, stdout: 'Linux version 5.15.153.1-microsoft-standard-WSL2 (oe-user@oe-host)' },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'linux', workspaceRoot: '/repo' });
    expect(p.platform.wsl).toBe('true');
    expect(p.platform.wslVersion).toBe('2');
    expect(p.platform.hostOs).toBe('linux');
    expect(p.platform.backendOs).toBe('linux');
  });

  it('detects plain Linux (no WSL)', async () => {
    const exec = makeExec({
      '/proc/version': { ok: true, stdout: 'Linux version 6.8.0-40-generic (buildd@lcy02-amd64)' },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'linux', workspaceRoot: '/repo' });
    expect(p.platform.wsl).toBe('false');
    expect(p.platform.wslVersion).toBeNull();
  });

  it('WSL unknown when /proc/version unreadable (never invents)', async () => {
    const exec = makeExec({});
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'linux', workspaceRoot: '/repo' });
    expect(p.platform.wsl).toBe('unknown');
  });

  it('detects Windows host OS and arch', async () => {
    const p = await buildHardwareProfile({ exec: makeExec({}), fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'win32', workspaceRoot: 'B:/AgenticOS' });
    expect(p.platform.hostOs).toBe('windows');
    expect(p.platform.wsl).toBe('false'); // WSL only applies to linux backend
    expect(typeof p.platform.arch).toBe('string');
  });
});

describe('hardwareProfiler — GPU detection', () => {
  it('uses nvidia-smi as authoritative source (VRAM + CUDA)', async () => {
    const exec = makeExec({
      'nvidia-smi': { ok: true, stdout: 'NVIDIA GeForce RTX 4090, 24576, 546.33\n' },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'win32', workspaceRoot: 'B:/x' });
    expect(p.gpu.available).toBe(true);
    expect(p.gpu.vendor).toBe('nvidia');
    expect(p.gpu.model).toBe('NVIDIA GeForce RTX 4090');
    expect(p.gpu.vramBytes).toBe(Math.round(24576 * 1024 * 1024));
    expect(p.gpu.driver).toBe('546.33');
    expect(p.gpu.cudaAvailable).toBe('true');
    expect(p.gpu.source).toBe('nvidia-smi');
    expect(p.warnings.some((w) => w.includes('nvidia-smi unavailable'))).toBe(false);
  });

  it('missing nvidia-smi → falls back to wmic, records warning, VRAM stays null', async () => {
    const exec = makeExec({
      'win32_videocontroller': { ok: true, stdout: '\nName=NVIDIA GeForce RTX 3060\nDriverVersion=31.0.15.3179\n\n' },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'win32', workspaceRoot: 'B:/x' });
    expect(p.gpu.available).toBe(true);
    expect(p.gpu.source).toBe('wmic');
    expect(p.gpu.model).toBe('NVIDIA GeForce RTX 3060');
    expect(p.gpu.vramBytes).toBeNull(); // wmic adapterram unreliable — never guess
    expect(p.gpu.cudaAvailable).toBe('unknown'); // no nvidia-smi ⇒ not authoritative
    expect(p.warnings.some((w) => w.includes('nvidia-smi unavailable'))).toBe(true);
  });

  it('prefers discrete GPU over integrated (never mistakes iGPU for CUDA)', async () => {
    const exec = makeExec({
      'win32_videocontroller': {
        ok: true,
        stdout: '\nName=Intel(R) UHD Graphics 630\nDriverVersion=1.0\n\nName=NVIDIA GeForce RTX 3060 Laptop GPU\nDriverVersion=2.0\n\n',
      },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'win32', workspaceRoot: 'B:/x' });
    expect(p.gpu.model).toContain('RTX 3060');
    expect(p.gpu.vendor).toBe('nvidia');
  });

  it('no GPU detected anywhere → available:false + warning, profiler does not fail', async () => {
    const exec = makeExec({});
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'linux', workspaceRoot: '/repo' });
    expect(p.gpu.available).toBe(false);
    expect(p.gpu.model).toBeNull();
    expect(p.gpu.vramBytes).toBeNull();
    expect(p.warnings.some((w) => w.toLowerCase().includes('gpu'))).toBe(true);
  });

  it('linux lspci fallback without nvidia-smi', async () => {
    const exec = makeExec({
      'lspci': { ok: true, stdout: '00:02.0 VGA compatible controller: Intel Corporation Device 9a49\n' },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'linux', workspaceRoot: '/repo' });
    expect(p.gpu.available).toBe(true);
    expect(p.gpu.vendor).toBe('intel');
    expect(p.gpu.cudaAvailable).toBe('false'); // Intel iGPU is never CUDA
    expect(p.gpu.source).toBe('lspci');
  });
});

describe('hardwareProfiler — Ollama inventory', () => {
  it('Ollama running → reachable, version, real model metadata', async () => {
    const p = await buildHardwareProfile({ exec: makeExec({}), fetchProbe: makeFetch(OLLAMA_UP), platformOverride: 'win32', workspaceRoot: 'B:/x' });
    expect(p.ollama.reachable).toBe(true);
    expect(p.ollama.version).toBe('0.11.0');
    expect(p.ollama.models).toHaveLength(2);
    expect(p.ollama.models[0]).toMatchObject({ id: 'qwen3.5:4b', parameterSize: '4B', quantization: 'Q4_K_M', family: 'qwen3' });
    expect(p.ollama.models[0].sizeBytes).toBe(2_700_000_000);
  });

  it('Ollama stopped → reachable:false, empty models, no crash', async () => {
    const p = await buildHardwareProfile({ exec: makeExec({}), fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'win32', workspaceRoot: 'B:/x' });
    expect(p.ollama.reachable).toBe(false);
    expect(p.ollama.version).toBeNull();
    expect(p.ollama.models).toEqual([]);
  });

  it('does not guess missing metadata', async () => {
    const fetch = makeFetch({
      '/api/version': { ok: true, status: 200, json: { version: '0.9.9' } },
      '/api/tags': { ok: true, status: 200, json: { models: [{ name: 'mystery' }] } },
    });
    const p = await buildHardwareProfile({ exec: makeExec({}), fetchProbe: fetch, platformOverride: 'win32', workspaceRoot: 'B:/x' });
    expect(p.ollama.models[0]).toMatchObject({ id: 'mystery', sizeBytes: null, family: null, parameterSize: null, quantization: null });
  });
});

describe('hardwareProfiler — capability tier (conservative rules)', () => {
  it('unknown when RAM unknown (insufficient info)', () => {
    expect(classifyCapabilityTier({ ramBytes: null, logicalCores: 8, vramBytes: 24 * GB, cudaAvailable: 'true' })).toBe('unknown');
  });

  it('quality: high RAM + strong CUDA GPU', () => {
    expect(classifyCapabilityTier({ ramBytes: 64 * GB, logicalCores: 16, vramBytes: 24 * GB, cudaAvailable: 'true' })).toBe('quality');
  });

  it('quality at 8GB VRAM when CUDA confirmed (threshold)', () => {
    expect(classifyCapabilityTier({ ramBytes: 32 * GB, logicalCores: 16, vramBytes: 8 * GB, cudaAvailable: 'true' })).toBe('quality');
  });

  it('balanced: 16GB RAM + 8 cores, no GPU', () => {
    expect(classifyCapabilityTier({ ramBytes: 16 * GB, logicalCores: 8, vramBytes: null, cudaAvailable: 'unknown' })).toBe('balanced');
  });

  it('lite: small RAM machine', () => {
    expect(classifyCapabilityTier({ ramBytes: 6 * GB, logicalCores: 4, vramBytes: null, cudaAvailable: 'false' })).toBe('lite');
  });

  it('big RAM alone never claims quality without GPU class', () => {
    expect(classifyCapabilityTier({ ramBytes: 128 * GB, logicalCores: 16, vramBytes: null, cudaAvailable: 'unknown' })).toBe('balanced');
  });
});

describe('hardwareProfiler — model recommendations (advisory only)', () => {
  // recommendModels consumes OllamaModelInfo (id), not raw /api/tags JSON.
  const RECS_FIXTURE: OllamaModelInfo[] = [
    { id: 'qwen3.5:4b', sizeBytes: 2_700_000_000, family: 'qwen3', parameterSize: '4B', quantization: 'Q4_K_M' },
    // 22GB artifact: 22e9*1.2 = 26.4e9 > 24GB VRAM → prefer-cloud
    { id: 'big-model:22b', sizeBytes: 22_000_000_000, family: 'qwen3', parameterSize: '32B', quantization: 'Q4_K_M' },
  ];

  it('parses parameter sizes', () => {
    expect(parseParameterBillions('4B')).toBe(4);
    expect(parseParameterBillions('14B')).toBe(14);
    expect(parseParameterBillions('70b')).toBe(70);
    expect(parseParameterBillions(null)).toBeNull();
  });

  it('CUDA GPU: small model recommended, oversized prefer-cloud', () => {
    const recs = recommendModels(RECS_FIXTURE, { vramBytes: 24 * GB, cudaAvailable: 'true', ramBytes: 64 * GB });
    const small = recs.find((r) => r.modelId === 'qwen3.5:4b')!;
    const big = recs.find((r) => r.modelId === 'big-model:22b')!;
    expect(small.verdict).toBe('recommended-local');
    expect(big.verdict).toBe('prefer-cloud'); // 22GB artifact +20% = 26.4GB > 24GB VRAM
    expect(small.reason.length).toBeGreaterThan(0);
  });

  it('no CUDA: small models usable-with-caution on CPU, big prefer-cloud', () => {
    const recs = recommendModels(RECS_FIXTURE, { vramBytes: null, cudaAvailable: 'unknown', ramBytes: 32 * GB });
    const small = recs.find((r) => r.modelId === 'qwen3.5:4b')!;
    const big = recs.find((r) => r.modelId === 'big-model:22b')!;
    expect(small.verdict).toBe('usable-with-caution');
    expect(big.verdict).toBe('prefer-cloud');
  });

  it('unknown metadata → unknown verdict', () => {
    const recs = recommendModels([{ id: 'mystery', sizeBytes: null, family: null, parameterSize: null, quantization: null }], { vramBytes: 24 * GB, cudaAvailable: 'true', ramBytes: 32 * GB });
    expect(recs[0].verdict).toBe('unknown');
  });

  it('cloud-link placeholder models are never misjudged by artifact bytes', () => {
    // Real-world shape observed live: Ollama exposes cloud-link models with a
    // tiny placeholder artifact (hundreds of bytes) and a huge parameter count
    // (2.81T) — or no parameter metadata at all. Bytes must never drive the
    // verdict for these.
    const recs = recommendModels([
      { id: 'kimi-k3:cloud', sizeBytes: 308, family: null, parameterSize: '2.81T', quantization: 'MXFP4' },
      { id: 'mystery:cloud', sizeBytes: 346, family: null, parameterSize: null, quantization: null },
    ], { vramBytes: null, cudaAvailable: 'false', ramBytes: 32 * GB });
    expect(recs.find((r) => r.modelId === 'kimi-k3:cloud')!.verdict).toBe('prefer-cloud');
    expect(recs.find((r) => r.modelId === 'mystery:cloud')!.verdict).toBe('unknown');
  });
});

describe('hardwareProfiler — full profile, cache, safety', () => {
  beforeEach(() => clearHardwareProfileCache());
  afterEach(() => clearHardwareProfileCache());

  it('partial profile still returns every section with nulls + warnings', async () => {
    const p = await buildHardwareProfile({ exec: makeExec({}), fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'linux', workspaceRoot: '/repo' });
    expect(p.platform).toBeDefined();
    expect(p.cpu).toBeDefined();
    expect(p.memory).toBeDefined();
    expect(p.gpu).toBeDefined();
    expect(p.disk).toBeDefined();
    expect(p.ollama).toBeDefined();
    expect(['lite', 'balanced', 'quality', 'unknown']).toContain(p.capabilityTier);
    expect(Array.isArray(p.warnings)).toBe(true);
    expect(p.warnings.length).toBeGreaterThan(0); // nothing detectable → warnings
  });

  it('disk detection via wmic (Windows)', async () => {
    const exec = makeExec({
      'logicaldisk': { ok: true, stdout: '\nFreeSpace=100000000\nSize=500000000\n' },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'win32', workspaceRoot: 'B:/AgenticOS' });
    expect(p.disk.volume).toBe('B:');
    expect(p.disk.totalBytes).toBe(500000000);
    expect(p.disk.freeBytes).toBe(100000000);
  });

  it('disk detection via df (Linux)', async () => {
    const exec = makeExec({
      'df -B1': { ok: true, stdout: ' 1000000000 400000000\n' },
    });
    const p = await buildHardwareProfile({ exec, fetchProbe: makeFetch(OLLAMA_DOWN), platformOverride: 'linux', workspaceRoot: '/repo' });
    expect(p.disk.totalBytes).toBe(1000000000);
    expect(p.disk.freeBytes).toBe(400000000);
  });

  it('buildHardwareProfile is deterministic for identical probes (no hidden state)', async () => {
    const exec = makeExec({ 'nvidia-smi': { ok: true, stdout: 'NVIDIA GeForce RTX 4090, 24576, 546.33\n' } });
    const fetchProbe = makeFetch(OLLAMA_UP);
    const p1 = await buildHardwareProfile({ exec, fetchProbe, platformOverride: 'win32', workspaceRoot: 'B:/x' });
    const p2 = await buildHardwareProfile({ exec, fetchProbe, platformOverride: 'win32', workspaceRoot: 'B:/x' });
    expect(p1.gpu.model).toBe('NVIDIA GeForce RTX 4090');
    expect(p2.gpu.model).toBe('NVIDIA GeForce RTX 4090');
    expect(p1.capabilityTier).toBe(p2.capabilityTier);
  });

  it('no environment variable names or secret values leak into the profile', async () => {
    const p = await buildHardwareProfile({ exec: makeExec({}), fetchProbe: makeFetch(OLLAMA_UP), platformOverride: 'win32', workspaceRoot: 'B:/x' });
    const serialized = JSON.stringify(p);
    for (const forbidden of ['API_KEY', 'TOKEN', 'SECRET', 'PASSWORD', '_KEY=', 'sk-', process.env.OPENROUTER_API_KEY || 'NO_KEY_SET']) {
      expect(serialized).not.toContain(forbidden);
    }
    // Endpoint is allowed (it is not a secret), but no env values.
    expect(typeof p.ollama.endpoint).toBe('string');
  });
});

describe('hardwareProfiler — getHardwareProfile cache contract', () => {
  beforeEach(() => clearHardwareProfileCache());
  afterEach(() => clearHardwareProfileCache());

  it('serves cached profile within TTL and refreshes on demand', async () => {
    const p1 = await getHardwareProfile();
    const p2 = await getHardwareProfile(); // cached
    expect(p2.generatedAt).toBe(p1.generatedAt);
    const p3 = await getHardwareProfile(true); // forced refresh
    expect(p3.generatedAt).toBeGreaterThanOrEqual(p1.generatedAt);
  }, 60000); // real exec probes (nvidia-smi/wmic) can take seconds
});
