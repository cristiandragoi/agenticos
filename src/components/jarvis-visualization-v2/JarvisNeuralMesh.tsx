import React from 'react';
import { mulberry32 } from './JarvisStateV2';

export interface MeshPoint {
  x: number;
  y: number;
  r: number;
  o: number;
  hub?: boolean;
}

/** Scatter n points along an ellipse with radial jitter (anatomical bands). */
export function scatterEllipse(
  cx: number, cy: number, rx: number, ry: number, n: number,
  rand: () => number, jitter = 0.18,
): MeshPoint[] {
  const pts: MeshPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    const jr = 1 + (rand() - 0.5) * jitter * 2;
    const jx = (rand() - 0.5) * jitter * rx * 2;
    const jy = (rand() - 0.5) * jitter * ry * 2;
    pts.push({
      x: cx + Math.cos(a) * rx * jr + jx,
      y: cy + Math.sin(a) * ry * jr + jy,
      r: 1.7 + rand() * 2.4,
      o: 0.45 + rand() * 0.5,
    });
  }
  return pts;
}

/** Build a meaningful local mesh: nearest-neighbor edges (bounded degree),
 *  plus edges from hubs. Avoids random spaghetti. */
export function buildConnections(
  points: MeshPoint[],
  rand: () => number,
  maxDist: number,
  hubDegree = 6,
  randEdges = 0,
): [number, number][] {
  const conns = new Set<string>();
  const deg = new Array(points.length).fill(0);
  const dist = (i: number, j: number) => {
    const dx = points[i].x - points[j].x;
    const dy = points[i].y - points[j].y;
    return Math.hypot(dx, dy);
  };
  // hub spokes first
  for (let i = 0; i < points.length; i++) {
    if (!points[i].hub) continue;
    const sorted = points
      .map((_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => dist(i, a) - dist(i, b));
    for (let k = 0; k < Math.min(hubDegree, sorted.length); k++) {
      const j = sorted[k];
      if (dist(i, j) <= maxDist * 1.6) {
        conns.add(i < j ? `${i}-${j}` : `${j}-${i}`);
        deg[i]++; deg[j]++;
      }
    }
  }
  // nearest-neighbor mesh (each point connects to its 2 closest)
  for (let i = 0; i < points.length; i++) {
    const sorted = points
      .map((_, j) => j)
      .filter((j) => j !== i && deg[j] < 8)
      .sort((a, b) => dist(i, a) - dist(i, b));
    let added = 0;
    for (let k = 0; k < sorted.length && added < 2; k++) {
      const j = sorted[k];
      if (dist(i, j) <= maxDist && deg[i] < 8) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!conns.has(key)) {
          conns.add(key);
          deg[i]++; deg[j]++; added++;
        }
      }
    }
  }
  // sparse random long edges for depth (optional)
  for (let e = 0; e < randEdges; e++) {
    const i = Math.floor(rand() * points.length);
    const j = Math.floor(rand() * points.length);
    if (i !== j && dist(i, j) < maxDist * 2.2) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      conns.add(key);
    }
  }
  return [...conns].map((s) => s.split('-').map(Number) as [number, number]);
}

interface NeuralFieldProps {
  points: MeshPoint[];
  connections: [number, number][];
  color: string;
  pulse?: number;
  bright?: Set<number>;
}

/** Renders a deterministic neural field (lines then points). */
export const NeuralField: React.FC<NeuralFieldProps> = ({ points, connections, color, pulse = 0, bright }) => (
  <g className="jv2-neural-field" fill="none" stroke={color}>
    {connections.map(([a, b], i) => (
      <line
        key={i}
        x1={points[a].x} y1={points[a].y}
        x2={points[b].x} y2={points[b].y}
        strokeWidth={1.0 + (points[a].hub || points[b].hub ? 1.0 : 0)}
        opacity={0.35 + (i % 5) * 0.06 + (pulse * 0.12)}
      />
    ))}
    {points.map((p, i) => (
      <circle
        key={i}
        cx={p.x} cy={p.y}
        r={p.r + (p.hub ? 1.8 : 0) + (bright?.has(i) ? pulse * 2.0 : 0)}
        fill={color}
        stroke="none"
        opacity={Math.min(1, p.o + (p.hub ? 0.3 : 0) + (bright?.has(i) ? pulse * 0.4 : 0))}
      />
    ))}
  </g>
);

export const makeRand = (seed: number) => mulberry32(seed);
