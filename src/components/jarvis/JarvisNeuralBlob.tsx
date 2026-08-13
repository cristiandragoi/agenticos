/**
 * JarvisNeuralBlob — the organic central Jarvis visualization + live neural
 * nodes. Pure 2D Canvas (no WebGL/GPU dependency, no new packages): soft
 * bezier deformation, internal energy, breathing, glow. ALL visual state
 * comes from real runtime props (state, nodeActivity, provider/model) — the
 * component never fakes activity or timers pretending work.
 */
import { useEffect, useRef } from 'react';
import type { BlobVisualState, NeuralNodeId } from './neuralBlobState';
import { NODE_DIRECTION, NODE_ROUTES, nodePulse, toBlobVisualState, modelLabel } from './neuralBlobState';

export interface JarvisNeuralBlobProps {
  state: string; // existing orb state vocabulary (real runtime derivation)
  inputLevel?: number; // real microphone amplitude 0..1
  outputLevel?: number; // real playback amplitude 0..1
  nodeActivity?: Partial<Record<string, number>>; // real subsystem activity
  provider?: string | null;
  model?: string | null;
  size?: number;
  testIdPrefix?: string;
  onNodeClick?: (node: NeuralNodeId) => void;
}

const NODES: NeuralNodeId[] = ['MEMORY', 'KNOWLEDGE', 'PROJECTS', 'HERMES', 'RUNS', 'ARTIFACTS', 'VISION'];

export function JarvisNeuralBlob({
  state, inputLevel = 0, outputLevel = 0, nodeActivity, provider, model,
  size = 280, testIdPrefix = 'jarvis-neural', onNodeClick,
}: JarvisNeuralBlobProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visualState: BlobVisualState = toBlobVisualState(state);
  const pulses = nodePulse(nodeActivity);
  const label = modelLabel(provider, model);
  const testId = testIdPrefix;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = size;
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let t = 0;
    // Traveling-pulse state per node (progress + trail), reset on activity change.
    const pulsesState: Record<NeuralNodeId, number> = {
      MEMORY: 0, KNOWLEDGE: 0, PROJECTS: 0, HERMES: 0, RUNS: 0, ARTIFACTS: 0, VISION: 0,
    };

    // Node orbital positions on an ellipse around the blob center.
    const cx = S / 2, cy = S / 2;
    const rx = S * 0.34, ry = S * 0.30;
    const nodePos = (node: NeuralNodeId, i: number) => {
      const a = -Math.PI / 2 + (i / NODES.length) * Math.PI * 2;
      return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, a };
    };

    const stateParams = (st: BlobVisualState) => {
      switch (st) {
        case 'LISTENING': return { breath: 0.10, energy: 0.35, noiseAmp: 0.06, glow: 0.55, hue: 175 };
        case 'THINKING': return { breath: 0.05, energy: 0.65, noiseAmp: 0.10, glow: 0.70, hue: 195 };
        case 'ACTING': return { breath: 0.12, energy: 0.85, noiseAmp: 0.12, glow: 0.85, hue: 205 };
        case 'SPEAKING': return { breath: 0.08, energy: 0.50, noiseAmp: 0.16, glow: 0.65, hue: 185 };
        case 'COMPLETED': return { breath: 0.06, energy: 0.25, noiseAmp: 0.05, glow: 0.50, hue: 150 };
        case 'ERROR': return { breath: 0.18, energy: 0.55, noiseAmp: 0.22, glow: 0.95, hue: 0 };
        default: return { breath: 0.04, energy: 0.20, noiseAmp: 0.045, glow: 0.38, hue: 170 };
      }
    };

    const schedule = (fn: () => void) => {
      if (typeof requestAnimationFrame === 'undefined') return 0;
      return requestAnimationFrame(fn);
    };
    const cancel = (id: number) => {
      if (typeof cancelAnimationFrame !== 'undefined' && id) cancelAnimationFrame(id);
    };

    const draw = () => {
      t += 0.016;
      const p = stateParams(visualState);
      ctx.clearRect(0, 0, S, S);

      // ── Neural connections (curved filaments) ──
      NODES.forEach((node, i) => {
        const { x, y } = nodePos(node, i);
        const active = pulses[node] > 0.01;
        const midX = cx + (x - cx) * 0.5 + Math.sin(t * 0.7 + i) * 6;
        const midY = cy + (y - cy) * 0.5 + Math.cos(t * 0.6 + i * 2) * 6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(midX, midY, x, y);
        ctx.strokeStyle = active
          ? `rgba(103,232,249,${0.35 + pulses[node] * 0.4})`
          : 'rgba(103,232,249,0.10)';
        ctx.lineWidth = active ? 1.4 : 0.8;
        ctx.stroke();

        // Traveling pulse on an active connection (direction from semantics).
        if (active) {
          pulsesState[node] = (pulsesState[node] + 0.018 * (1 + pulses[node] * 2)) % 1;
          const pr = pulsesState[node];
          const dir = NODE_DIRECTION[node] === 'in' ? pr : 1 - pr;
          const px = cx + (x - cx) * dir + Math.sin(pr * Math.PI) * 8 * Math.sin(t + i);
          const py = cy + (y - cy) * dir + Math.cos(pr * Math.PI) * 6;
          ctx.beginPath();
          ctx.arc(px, py, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(186,230,253,${0.9 * pulses[node]})`;
          ctx.fill();
        } else {
          pulsesState[node] = 0;
        }
      });

      // ── Central blob: organically deforming bezier outline ──
      const mic = visualState === 'LISTENING' ? inputLevel : 0;
      const speak = visualState === 'SPEAKING' ? outputLevel : 0;
      const radius = S * 0.24 * (1 + p.breath * Math.sin(t * 1.2) + p.noiseAmp * Math.sin(t * 2.7 + 1) + mic * 0.08 + speak * 0.06);
      const pts: { x: number; y: number }[] = [];
      const N = 14;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const wob = p.noiseAmp * (0.6 + 0.4 * Math.sin(t * 2.2 + k * 2.1)) + p.energy * 0.015 * Math.sin(t * 3.1 + k * 3.7);
        const r = radius * (1 + wob);
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }

      // Smooth closed curve through the points (catmull-rom → bezier).
      ctx.beginPath();
      for (let k = 0; k < N; k++) {
        const p0 = pts[(k - 1 + N) % N], p1 = pts[k], p2 = pts[(k + 1) % N], p3 = pts[(k + 2) % N];
        const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
        if (k === 0) ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
      }
      ctx.closePath();

      const hue = p.hue;
      const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, radius * 0.1, cx, cy, radius * 1.05);
      grad.addColorStop(0, `hsla(${hue}, 85%, 62%, 0.95)`);
      grad.addColorStop(0.55, `hsla(${hue}, 75%, 34%, 0.85)`);
      grad.addColorStop(1, `hsla(${hue + 20}, 70%, 18%, 0.72)`);
      ctx.fillStyle = grad;
      ctx.shadowColor = `hsla(${hue}, 90%, 60%, ${p.glow})`;
      ctx.shadowBlur = 22 * p.glow + speak * 18;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Internal energy: drifting inner highlight + slow rotating arcs.
      const e1 = ctx.createRadialGradient(cx - radius * 0.28, cy - radius * 0.32, 2, cx - radius * 0.28, cy - radius * 0.32, radius * 0.55);
      e1.addColorStop(0, 'rgba(255,255,255,0.5)');
      e1.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = e1;
      ctx.beginPath();
      ctx.arc(cx - radius * 0.28, cy - radius * 0.32, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 100%, 75%, ${0.25 + p.energy * 0.3})`;
      ctx.lineWidth = 1.2;
      for (let a = 0; a < 2; a++) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * (0.72 + a * 0.2), t * (0.4 + a * 0.25) + a * 2.1, t * (0.4 + a * 0.25) + a * 2.1 + Math.PI * 1.1);
        ctx.stroke();
      }

      // ── Neural nodes ──
      NODES.forEach((node, i) => {
        const { x, y } = nodePos(node, i);
        const act = pulses[node];
        const dim = 0.30 + act * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, 5 + act * 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(147,197,253,${dim})`;
        ctx.shadowColor = act > 0.1 ? 'rgba(147,197,253,0.9)' : 'transparent';
        ctx.shadowBlur = act > 0.1 ? 14 * act : 0;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (act > 0.05) {
          ctx.beginPath();
          ctx.arc(x, y, 9 + act * 6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(191,219,254,${0.5 * act})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = act > 0.1 ? 'rgba(226,232,240,0.95)' : 'rgba(148,163,184,0.55)';
        ctx.fillText(node, x, y + 18);
      });

      raf = schedule(draw);
    };

    raf = schedule(draw);
    return () => {
      cancel(raf);
    };
  }, [size, visualState, pulses, inputLevel, outputLevel]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onNodeClick) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size;
    const y = ((e.clientY - rect.top) / rect.height) * size;
    const cx = size / 2, cy = size / 2;
    const rx = size * 0.34, ry = size * 0.30;
    for (let i = 0; i < NODES.length; i++) {
      const a = -Math.PI / 2 + (i / NODES.length) * Math.PI * 2;
      const nx = cx + Math.cos(a) * rx, ny = cy + Math.sin(a) * ry;
      if (Math.hypot(x - nx, y - ny) < 18) {
        onNodeClick(NODES[i]);
        return;
      }
    }
  };

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <canvas
        ref={canvasRef}
        data-testid={`${testId}-canvas`}
        onClick={handleClick}
        style={{ width: size, height: size, cursor: onNodeClick ? 'pointer' : 'default' }}
        role="img"
        aria-label={`Jarvis neural blob — state ${visualState}`}
      />
      <div data-testid={`${testId}-label`} style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.35 }} aria-label="Jarvis">
        <div data-testid={`${testId}-model`} style={{ fontSize: 11, color: 'rgba(226,232,240,0.9)', fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {label}
        </div>
      </div>
    </div>
  );
}

export { NODE_ROUTES, modelLabel };
