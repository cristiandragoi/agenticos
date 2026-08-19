import { CognitiveMode, NODE_SLOTS, NodePhase, PHASE_MS, MODE_ACCENT_HUE } from './CognitiveState';
import type { NeuralNodeKind } from './BaseAdapt';

export interface RuntimeNode {
  id: string;
  kind: NeuralNodeKind;
  label: string;
  x: number;
  y: number;
  phase: NodePhase;
  phaseT: number;
  accent: number;
  seed: number;
}

/** Runtime node bookkeeping only — no rendering. */
export class CognitiveController {
  mode: CognitiveMode = 'idle';
  modeT = 0;
  nodes: RuntimeNode[] = [];
  private taken = new Set<number>();
  private seq = 0;

  setMode(m: CognitiveMode) {
    this.mode = m;
    this.modeT = 0;
  }

  spawn(kind: NeuralNodeKind, label?: string): string | null {
    let slot = -1;
    for (let i = 0; i < NODE_SLOTS.length; i++) if (!this.taken.has(i)) { slot = i; break; }
    if (slot < 0) return null;
    this.taken.add(slot);
    const id = `${kind}-${this.seq++}`;
    this.nodes.push({
      id, kind, label: label ?? kind.toUpperCase(), ...NODE_SLOTS[slot],
      phase: 'materializing', phaseT: 0, accent: MODE_ACCENT_HUE[this.mode], seed: (this.seq * 97) % 628,
    });
    return id;
  }

  resolve(id: string) {
    const n = this.nodes.find((n) => n.id === id);
    if (n && n.phase === 'active') { n.phase = 'resolved'; n.phaseT = 0; }
  }

  resolveAll() {
    this.nodes.filter((n) => n.phase === 'active').forEach((n) => { n.phase = 'resolved'; n.phaseT = 0; });
  }

  tick(dt: number) {
    this.modeT += dt;
    for (const n of this.nodes) {
      n.phaseT += dt;
      if (n.phase === 'materializing' && n.phaseT >= PHASE_MS.materializing) { n.phase = 'active'; n.phaseT = 0; }
      else if (n.phase === 'resolved' && n.phaseT >= PHASE_MS.resolved) { n.phase = 'fading'; n.phaseT = 0; }
    }
    const dead = this.nodes.filter((n) => n.phase === 'fading' && n.phaseT >= PHASE_MS.fading);
    if (dead.length) {
      const ids = new Set(dead.map((d) => d.id));
      dead.forEach((d) => {
        const i = NODE_SLOTS.findIndex((s) => s.x === d.x && s.y === d.y);
        this.taken.delete(i);
      });
      this.nodes = this.nodes.filter((n) => !ids.has(n.id));
    }
  }
}
