// Live hardware-profile capture for human-readable verification.
const p = await (await fetch('http://localhost:4000/api/system/hardware-profile?refresh=1')).json();
console.log(JSON.stringify({
  platform: p.platform,
  cpu: p.cpu,
  memoryGb: { total: +(p.memory.totalBytes / 1024 ** 3).toFixed(1), available: +(p.memory.availableBytes / 1024 ** 3).toFixed(1) },
  gpu: p.gpu,
  diskGb: { volume: p.disk.volume, total: +(p.disk.totalBytes / 1024 ** 3).toFixed(0), free: +(p.disk.freeBytes / 1024 ** 3).toFixed(0) },
  ollama: { ...p.ollama, models: p.ollama.models.map((m) => m.id) },
  capabilityTier: p.capabilityTier,
  recommendations: p.recommendations.map((r) => `${r.modelId}=${r.verdict}`),
  warnings: p.warnings,
}, null, 1));
