import React from 'react';
import { makeRand } from './JarvisNeuralMesh';
import { CHANNELS_V2 } from './JarvisStateV2';

interface Props {
  color: string;
  layer: 'bg' | 'fg';
}

/** Ambient neural dust: soft background points + sparse foreground sparkles. */
export const JarvisParticles: React.FC<Props> = ({ color, layer }) => {
  const rand = makeRand(layer === 'bg' ? 90210 : 31337);
  const n = layer === 'bg' ? 92 : 26;
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      x: 60 + rand() * 880,
      y: 120 + rand() * 1050,
      r: layer === 'bg' ? 0.7 + rand() * 1.4 : 1.2 + rand() * 1.8,
      o: layer === 'bg' ? 0.06 + rand() * 0.2 : 0.2 + rand() * 0.4,
    });
  }
  return (
    <g className={`jv2-particles-${layer}`} fill={color} stroke="none">
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} opacity={p.o} />
      ))}
      {layer === 'fg' && (
        <circle cx={500} cy={1130} r={2.2} fill={CHANNELS_V2.white} opacity={0.7} />
      )}
    </g>
  );
};

export default JarvisParticles;
