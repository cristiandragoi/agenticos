/**
 * HardwareProfiler V1 (Stage 1) — authoritative machine profile for AgenticOS.
 *
 * One normalized contract describing the machine the backend runs on:
 * platform / cpu / memory / gpu / disk / ollama / capabilityTier / warnings.
 *
 * Rules:
 * - Unknown values stay unknown (null) — NOTHING is invented.
 * - Authoritative sources preferred: nvidia-smi for NVIDIA/CUDA, os.* for
 *   cpu/ram, wmic/df for disk. Failure of any probe NEVER fails the profiler;
 *   it produces a partial profile + a warning.
 * - Integrated graphics is never mistaken for CUDA hardware.
 * - No environment variables or secrets are ever included in the profile.
 * - Capability tier is a conservative machine-class statement (NOT a
 *   benchmark, NOT a per-model guarantee).
 *
 * All external probes are injectable for tests (exec + fetch).
 */
import os from 'node:os';
import { execSync } from 'node:child_process';
import { getWorkspaceRoot } from '../workspaceStore.js';

// ── Contract ────────────────────────────────────────────────────────────────

export type CapabilityTier = 'lite' | 'balanced' | 'quality' | 'unknown';
export type TruthValue = 'true' | 'false' | 'unknown';

export interface OllamaModelInfo {
  id: string;
  sizeBytes: number | null;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface HardwareProfile {
  generatedAt: number;
  platform: {
    hostOs: string;          // 'windows' | 'linux' | 'darwin' | os.platform()
    backendOs: string;       // OS the backend process runs on (same host here)
    arch: string;
    wsl: TruthValue;
    wslVersion: string | null;
  };
  cpu: {
    model: string | null;
    logicalCores: number | null;
    physicalCores: number | null;
  };
  memory: { totalBytes: number | null; availableBytes: number | null };
  gpu: {
    available: boolean;
    vendor: string | null;
    model: string | null;
    vramBytes: number | null;
    driver: string | null;
    cudaAvailable: TruthValue;
    source: string | null;   // 'nvidia-smi' | 'wmic' | 'lspci' | null
  };
  disk: { volume: string | null; totalBytes: number | null; freeBytes: number | null };
  ollama: {
    endpoint: string;
    reachable: boolean;      // installed/running: the service answered
    version: string | null;
    models: OllamaModelInfo[];
  };
  capabilityTier: CapabilityTier;
  recommendations: ModelRecommendation[];
  warnings: string[];
}

export interface ModelRecommendation {
  modelId: string;
  verdict: 'recommended-local' | 'usable-with-caution' | 'prefer-cloud' | 'unknown';
  reason: string;
}

// ── Injectable probes ───────────────────────────────────────────────────────

export interface ExecResult { ok: boolean; stdout: string }
export type ExecProbe = (command: string, timeoutMs?: number) => ExecResult;
export interface FetchResult { ok: boolean; status?: number; json?: any }
export type FetchProbe = (url: string, timeoutMs?: number) => Promise<FetchResult>;

const defaultExecProbe: ExecProbe = (command, timeoutMs = 5000) => {
  try {
    const stdout = execSync(command, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { ok: true, stdout: String(stdout) };
  } catch {
    return { ok: false, stdout: '' };
  }
};

const defaultFetchProbe: FetchProbe = async (url, timeoutMs = 2500) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    let json: any;
    try { json = await res.json(); } catch { json = undefined; }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false };
  }
};

// ── Centralized capability thresholds (NOT a benchmark) ────────────────────

export const TIER_THRESHOLDS = {
  qualityRamBytes: 32 * 1024 ** 3,
  balancedRamBytes: 16 * 1024 ** 3,
  balancedLogicalCores: 8,
  qualityVramBytes: 12 * 1024 ** 3,
  qualityVramBytesCuda: 8 * 1024 ** 3,   // with working CUDA, 8GB is enough
  liteMaxRamBytes: 8 * 1024 ** 3,
} as const;

export function classifyCapabilityTier(p: {
  ramBytes: number | null;
  logicalCores: number | null;
  vramBytes: number | null;
  cudaAvailable: TruthValue;
}): CapabilityTier {
  const { ramBytes, logicalCores, vramBytes, cudaAvailable } = p;
  if (ramBytes == null) return 'unknown'; // insufficient information
  const T = TIER_THRESHOLDS;
  const strongGpu =
    vramBytes != null &&
    (vramBytes >= T.qualityVramBytes || (cudaAvailable === 'true' && vramBytes >= T.qualityVramBytesCuda));
  if (ramBytes >= T.qualityRamBytes && strongGpu) return 'quality';
  if (ramBytes >= T.balancedRamBytes && (logicalCores ?? 0) >= T.balancedLogicalCores) return 'balanced';
  if (ramBytes >= T.balancedRamBytes) return 'balanced'; // enough RAM, cores unknown — still balanced class
  return 'lite';
}

// ── Per-installed-model advisory (V1, advisory only) ───────────────────────

export function parseParameterBillions(parameterSize: string | null): number | null {
  if (!parameterSize) return null;
  const m = parameterSize.match(/([\d.]+)\s*([BbTt])/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toLowerCase() === 't' ? n * 1000 : n; // T → billions
}

export function recommendModels(
  models: OllamaModelInfo[],
  hw: { vramBytes: number | null; cudaAvailable: TruthValue; ramBytes: number | null },
): ModelRecommendation[] {
  return models.map((m) => {
    const params = parseParameterBillions(m.parameterSize);
    const sizeBytes = m.sizeBytes;
    const vram = hw.vramBytes;
    const cuda = hw.cudaAvailable === 'true';
    if (params == null && sizeBytes == null) {
      return { modelId: m.id, verdict: 'unknown', reason: 'Ollama exposes no size or parameter metadata for this model.' };
    }
    if (cuda && vram != null) {
      // Conservative VRAM budget: model size + ~20% runtime overhead must fit
      // inside ~80% of VRAM to be comfortable.
      if (sizeBytes != null) {
        const needed = sizeBytes * 1.2;
        if (needed <= vram * 0.8) return { modelId: m.id, verdict: 'recommended-local', reason: `Fits CUDA VRAM: ~${Math.ceil(needed / 1024 ** 3)}GB needed vs ${Math.floor(vram / 1024 ** 3)}GB available.` };
        if (needed <= vram) return { modelId: m.id, verdict: 'usable-with-caution', reason: `Tight CUDA VRAM fit: ~${Math.ceil(needed / 1024 ** 3)}GB needed vs ${Math.floor(vram / 1024 ** 3)}GB available.` };
        return { modelId: m.id, verdict: 'prefer-cloud', reason: `Exceeds CUDA VRAM: ~${Math.ceil(needed / 1024 ** 3)}GB needed vs ${Math.floor(vram / 1024 ** 3)}GB available.` };
      }
      if (params != null) {
        if (params <= 8) return { modelId: m.id, verdict: 'recommended-local', reason: `~${params}B parameters are practical on this CUDA GPU.` };
        if (params <= 14) return { modelId: m.id, verdict: 'usable-with-caution', reason: `~${params}B parameters may be slow on this CUDA GPU.` };
        return { modelId: m.id, verdict: 'prefer-cloud', reason: `~${params}B parameters exceed practical CUDA capacity here.` };
      }
    }
    // CPU-only path: the ARTIFACT bytes are the honest indicator of what
    // actually loads into RAM (a 3.4GB Q4 artifact runs locally even if its
    // nominal parameter count is 4.7B). Parameter count only guards the
    // extremes: placeholder artifacts (cloud links) and clearly-huge models.
    if (sizeBytes != null && sizeBytes < 10 * 1024 * 1024) {
      // Tiny artifact ⇒ cloud-link placeholder — bytes are meaningless.
      if (params != null && params > 100) {
        return { modelId: m.id, verdict: 'prefer-cloud', reason: `~${params}B parameters exceed practical CPU inference limits on this machine.` };
      }
      return { modelId: m.id, verdict: 'unknown', reason: 'No parameter metadata and artifact is a placeholder (likely a cloud-link model).' };
    }
    if (params != null && params > 30) {
      return { modelId: m.id, verdict: 'prefer-cloud', reason: `~${params}B parameters exceed practical CPU inference limits on this machine.` };
    }
    if (sizeBytes != null && sizeBytes <= 4 * 1024 ** 3 && (hw.ramBytes ?? 0) >= TIER_THRESHOLDS.balancedRamBytes) {
      return { modelId: m.id, verdict: 'usable-with-caution', reason: `~${(sizeBytes / 1024 ** 3).toFixed(1)}GB artifact runs on CPU — expect slow generation.` };
    }
    if (params != null && params <= 4 && (hw.ramBytes ?? 0) >= TIER_THRESHOLDS.balancedRamBytes) {
      return { modelId: m.id, verdict: 'usable-with-caution', reason: `~${params}B parameters run on CPU with ${Math.floor((hw.ramBytes ?? 0) / 1024 ** 3)}GB RAM — expect slow generation.` };
    }
    return { modelId: m.id, verdict: 'prefer-cloud', reason: 'No CUDA GPU and model size exceeds practical CPU inference limits on this machine.' };
  });
}

// ── Detectors (pure over probes) ────────────────────────────────────────────

function detectPlatform(exec: ExecProbe, platform: string): HardwareProfile['platform'] {
  const p = platform;
  const hostOs = p === 'win32' ? 'windows' : p === 'darwin' ? 'darwin' : p;
  const base: HardwareProfile['platform'] = {
    hostOs,
    backendOs: hostOs,
    arch: os.arch(),
    wsl: 'false',
    wslVersion: null,
  };
  if (p === 'linux') {
    // Authoritative WSL signal: /proc/version contains 'microsoft'/'wsl'.
    const procVersion = exec('cat /proc/version', 2000);
    if (procVersion.ok) {
      const v = procVersion.stdout.toLowerCase();
      if (v.includes('microsoft') || v.includes('wsl')) {
        base.wsl = 'true';
        base.wslVersion = v.includes('wsl2') ? '2' : v.includes('microsoft-standard') ? '2' : '1';
      } else {
        base.wsl = 'false';
      }
    } else {
      base.wsl = 'unknown';
    }
  }
  return base;
}

function detectCpu(exec: ExecProbe, platform: string, warnings: string[]): HardwareProfile['cpu'] {
  const cpus = os.cpus();
  const cpu: HardwareProfile['cpu'] = {
    model: cpus[0]?.model?.trim() || null,
    logicalCores: cpus.length || null,
    physicalCores: null,
  };
  try {
    if (platform === 'win32') {
      const r = exec('wmic cpu get NumberOfCores /value', 5000);
      if (r.ok) {
        const m = r.stdout.match(/NumberOfCores=(\d+)/);
        if (m) cpu.physicalCores = parseInt(m[1], 10);
      } else {
        warnings.push('physical-core detection failed (wmic unavailable)');
      }
    } else {
      const r = exec("lscpu 2>/dev/null | awk -F: '/^Core\\(s\\) per socket/{c=$2} /^Socket\\(s\\)/{s=$2} END{gsub(/ /,\"\",c);gsub(/ /,\"\",s); if(c&&s) print c*s}'", 5000);
      if (r.ok && /^\d+$/.test(r.stdout.trim())) {
        cpu.physicalCores = parseInt(r.stdout.trim(), 10);
      } else {
        warnings.push('physical-core detection failed (lscpu unavailable)');
      }
    }
  } catch {
    warnings.push('physical-core detection failed unexpectedly');
  }
  return cpu;
}

function detectMemory(): HardwareProfile['memory'] {
  try {
    return { totalBytes: os.totalmem() || null, availableBytes: os.freemem() || null };
  } catch {
    return { totalBytes: null, availableBytes: null };
  }
}

function detectGpu(exec: ExecProbe, platform: string, warnings: string[]): HardwareProfile['gpu'] {
  const gpu: HardwareProfile['gpu'] = {
    available: false, vendor: null, model: null, vramBytes: null, driver: null, cudaAvailable: 'unknown', source: null,
  };
  // 1. Authoritative NVIDIA/CUDA probe — nvidia-smi.
  const smi = exec('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits', 6000);
  if (smi.ok) {
    const line = smi.stdout.split('\n').map((s) => s.trim()).find((s) => s.length > 0);
    if (line) {
      const parts = line.split(',').map((s) => s.trim());
      gpu.available = true;
      gpu.source = 'nvidia-smi';
      gpu.vendor = 'nvidia';
      gpu.model = parts[0] || null;
      const vramMb = parseFloat(parts[1]);
      gpu.vramBytes = Number.isFinite(vramMb) ? Math.round(vramMb * 1024 * 1024) : null;
      gpu.driver = parts[2] || null;
      gpu.cudaAvailable = 'true'; // working nvidia-smi ⇒ CUDA driver stack present
      return gpu;
    }
  }
  // nvidia-smi missing/failed is NOT fatal — record a partial profile.
  if (platform === 'win32') {
    const r = exec('wmic path win32_videocontroller get name,driverversion /format:list', 5000);
    if (r.ok) {
      const blocks = r.stdout.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
      let picked: { name: string; driver: string | null } | null = null;
      for (const b of blocks) {
        const name = b.match(/Name=(.+)/)?.[1]?.trim();
        if (!name) continue;
        // Never mistake integrated graphics for CUDA hardware: skip iGPUs
        // when ANY block is discrete, and never mark non-NVIDIA as CUDA.
        const lower = name.toLowerCase();
        const integrated = lower.includes('intel') && (lower.includes('uhd') || lower.includes('iris') || lower.includes('hd graphics'));
        if (!picked || (!integrated && (picked.name.toLowerCase().includes('intel')))) {
          picked = { name, driver: b.match(/DriverVersion=(.+)/)?.[1]?.trim() || null };
        }
      }
      if (picked) {
        gpu.available = true;
        gpu.source = 'wmic';
        gpu.model = picked.name;
        gpu.driver = picked.driver;
        const lower = picked.name.toLowerCase();
        gpu.vendor = lower.includes('nvidia') ? 'nvidia' : lower.includes('radeon') || lower.includes('amd') ? 'amd' : lower.includes('intel') ? 'intel' : null;
        // wmic adapterram is unreliable (32-bit cap) — VRAM stays null.
        gpu.cudaAvailable = gpu.vendor === 'nvidia' ? 'unknown' : 'false';
        warnings.push('nvidia-smi unavailable — GPU VRAM/CUDA not authoritatively detected');
        return gpu;
      }
    }
    warnings.push('GPU detection failed (nvidia-smi and wmic unavailable)');
    return gpu;
  }
  const lspci = exec("lspci 2>/dev/null | grep -iE 'vga|3d|display'", 5000);
  if (lspci.ok && lspci.stdout.trim()) {
    gpu.available = true;
    gpu.source = 'lspci';
    const line = lspci.stdout.split('\n')[0];
    gpu.model = line.replace(/^[0-9a-f:.]+\s+/i, '').trim() || null;
    const lower = line.toLowerCase();
    gpu.vendor = lower.includes('nvidia') ? 'nvidia' : lower.includes('amd') || lower.includes('radeon') ? 'amd' : lower.includes('intel') ? 'intel' : null;
    gpu.cudaAvailable = gpu.vendor === 'nvidia' ? 'unknown' : 'false';
    warnings.push('nvidia-smi unavailable — GPU VRAM/CUDA not authoritatively detected');
    return gpu;
  }
  warnings.push('GPU detection failed (nvidia-smi and lspci unavailable)');
  return gpu;
}

function detectDisk(exec: ExecProbe, platform: string, workspaceRoot: string | null, warnings: string[]): HardwareProfile['disk'] {
  const disk: HardwareProfile['disk'] = { volume: null, totalBytes: null, freeBytes: null };
  try {
    if (platform === 'win32') {
      const drive = (workspaceRoot || process.cwd()).slice(0, 1).toUpperCase();
      const r = exec(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace,Size /value`, 5000);
      if (r.ok) {
        disk.volume = `${drive}:`;
        const free = r.stdout.match(/FreeSpace=(\d+)/)?.[1];
        const size = r.stdout.match(/Size=(\d+)/)?.[1];
        disk.freeBytes = free ? parseInt(free, 10) : null;
        disk.totalBytes = size ? parseInt(size, 10) : null;
      } else {
        warnings.push('disk detection failed (wmic unavailable)');
      }
    } else {
      const target = workspaceRoot || '.';
      const r = exec(`df -B1 --output=size,avail "${target}" | tail -1`, 5000);
      if (r.ok) {
        const parts = r.stdout.trim().split(/\s+/);
        if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
          disk.volume = target;
          disk.totalBytes = parseInt(parts[0], 10);
          disk.freeBytes = /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : null;
        }
      } else {
        warnings.push('disk detection failed (df unavailable)');
      }
    }
  } catch {
    warnings.push('disk detection failed unexpectedly');
  }
  return disk;
}

async function detectOllama(fetchProbe: FetchProbe, endpoint: string): Promise<HardwareProfile['ollama']> {
  const out: HardwareProfile['ollama'] = { endpoint, reachable: false, version: null, models: [] };
  try {
    const base = endpoint.replace(/\/$/, '');
    const [ver, tags] = await Promise.all([
      fetchProbe(`${base}/api/version`, 2500),
      fetchProbe(`${base}/api/tags`, 2500),
    ]);
    if (ver.ok && ver.json?.version) out.version = String(ver.json.version);
    if (tags.ok && Array.isArray(tags.json?.models)) {
      out.reachable = true;
      out.models = tags.json.models.map((m: any) => ({
        id: String(m.name || m.model || 'unknown'),
        sizeBytes: typeof m.size === 'number' ? m.size : null,
        family: m.details?.family ? String(m.details.family) : null,
        parameterSize: m.details?.parameter_size ? String(m.details.parameter_size) : null,
        quantization: m.details?.quantization_level ? String(m.details.quantization_level) : null,
      }));
    }
  } catch { /* unreachable stays unreachable */ }
  return out;
}

// ── Profile assembly + cache ────────────────────────────────────────────────

export interface ProfilerOptions {
  exec?: ExecProbe;
  fetchProbe?: FetchProbe;
  ollamaEndpoint?: string;
  workspaceRoot?: string | null;
  platformOverride?: string; // tests only
}

export async function buildHardwareProfile(opts: ProfilerOptions = {}): Promise<HardwareProfile> {
  const exec = opts.exec || defaultExecProbe;
  const fetchProbe = opts.fetchProbe || defaultFetchProbe;
  const platform = opts.platformOverride || os.platform();
  const endpoint = opts.ollamaEndpoint || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const workspaceRoot = opts.workspaceRoot !== undefined ? opts.workspaceRoot : safeWorkspaceRoot();

  const warnings: string[] = [];
  const platformInfo = detectPlatform(exec, platform);
  const cpu = detectCpu(exec, platform, warnings);
  const memory = detectMemory();
  const gpu = detectGpu(exec, platform, warnings);
  const disk = detectDisk(exec, platform, workspaceRoot, warnings);
  const ollama = await detectOllama(fetchProbe, endpoint);

  const capabilityTier = classifyCapabilityTier({
    ramBytes: memory.totalBytes,
    logicalCores: cpu.logicalCores,
    vramBytes: gpu.vramBytes,
    cudaAvailable: gpu.cudaAvailable,
  });

  const recommendations = recommendModels(ollama.models, {
    vramBytes: gpu.vramBytes,
    cudaAvailable: gpu.cudaAvailable,
    ramBytes: memory.totalBytes,
  });

  return {
    generatedAt: Date.now(),
    platform: platformInfo,
    cpu,
    memory,
    gpu,
    disk,
    ollama,
    capabilityTier,
    recommendations,
    warnings,
  };
}

function safeWorkspaceRoot(): string | null {
  try { return getWorkspaceRoot(); } catch { return null; }
}

// TTL cache: hardware detection runs expensive exec probes — never on every
// render. `refresh=true` forces a fresh profile.
const CACHE_TTL_MS = parseInt(process.env.HARDWARE_PROFILE_CACHE_TTL_MS || '60000', 10);
let cached: { at: number; profile: HardwareProfile } | null = null;
let building: Promise<HardwareProfile> | null = null;

export async function getHardwareProfile(refresh = false): Promise<HardwareProfile> {
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.profile;
  if (!building) {
    building = buildHardwareProfile().finally(() => { building = null; });
  }
  const profile = await building;
  cached = { at: Date.now(), profile };
  return profile;
}

export function clearHardwareProfileCache(): void {
  cached = null;
}
