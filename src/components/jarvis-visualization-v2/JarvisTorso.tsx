import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, type JarvisStateV2 } from './JarvisStateV2';
import { NeuralField, scatterEllipse, buildConnections, makeRand, type MeshPoint } from './JarvisNeuralMesh';

interface Props {
  state: JarvisStateV2;
  color?: string;
}

/** Torso interior anchored to the MEASURED shoulder row (REF.shoulders.y):
 *  clavicle lines, sternum, deltoid shading — plus a shoulder neural band so
 *  the figure reads as one connected nervous system (head → neck → shoulders
 *  → chest). The outer bust silhouette is the traced reference path
 *  (JarvisHead). */
export const JarvisTorso: React.FC<Props> = ({ state, color }) => {
  const main = color || regionColor(state, 'torso');
  const sy = REF.shoulders.y;
  const hw = REF.head.width;

  // deterministic shoulder-band neural mesh (static SVG — no per-frame churn)
  const rand = makeRand(5150);
  const pts: MeshPoint[] = [
    { x: 500, y: sy + 6, r: 3.0, o: 0.72, hub: true },
    { x: 500 - hw * 0.5, y: sy - 8, r: 2.6, o: 0.65, hub: true },
    { x: 500 + hw * 0.5, y: sy - 8, r: 2.6, o: 0.65, hub: true },
    { x: 500 - hw * 0.3, y: sy + 70, r: 2.2, o: 0.6, hub: true },
    { x: 500 + hw * 0.3, y: sy + 70, r: 2.2, o: 0.6, hub: true },
  ];
  pts.push(...scatterEllipse(500, sy + 24, hw * 0.58, 30, 30, rand, 0.2));
  pts.push(...scatterEllipse(500, sy + 74, hw * 0.44, 26, 22, rand, 0.22));
  const connections = buildConnections(pts, rand, 68, 6, 6);
  const bright = new Set([0, 1, 2]);

  return (
    <g id="torso" className="jv2-region" fill="none" stroke={main}>
      <NeuralField points={pts} connections={connections} color={main} bright={bright} />
      {/* clavicle lines */}
      <path d={`M 500 ${sy + 6} C ${500 - hw * 0.2} ${sy} ${500 - hw * 0.45} ${sy - 14} ${500 - hw * 0.62} ${sy - 30}`} strokeWidth="0.9" opacity="0.5" />
      <path d={`M 500 ${sy + 6} C ${500 + hw * 0.2} ${sy} ${500 + hw * 0.45} ${sy - 14} ${500 + hw * 0.62} ${sy - 30}`} strokeWidth="0.9" opacity="0.5" />
      {/* sternum / chest midline */}
      <path d={`M 500 ${sy + 10} C 500 ${sy + 30} 500 ${sy + 54} 500 ${sy + 80}`} strokeWidth="0.7" opacity="0.45" />
      {/* deltoid shading */}
      <path d={`M ${500 + hw * 0.5} ${sy + 10} C ${500 + hw * 0.62} ${sy - 8} ${500 + hw * 0.72} ${sy - 26} ${500 + hw * 0.78} ${sy - 46}`} strokeWidth="0.6" opacity="0.3" />
      <path d={`M ${500 - hw * 0.5} ${sy + 10} C ${500 - hw * 0.62} ${sy - 8} ${500 - hw * 0.72} ${sy - 26} ${500 - hw * 0.78} ${sy - 46}`} strokeWidth="0.6" opacity="0.3" />
      {/* upper chest neural hints */}
      <path d={`M ${500 - hw * 0.28} ${sy + 16} C ${500 - hw * 0.32} ${sy + 40} ${500 - hw * 0.34} ${sy + 66} ${500 - hw * 0.3} ${sy + 90}`} strokeWidth="0.5" opacity="0.3" />
      <path d={`M ${500 + hw * 0.28} ${sy + 16} C ${500 + hw * 0.32} ${sy + 40} ${500 + hw * 0.34} ${sy + 66} ${500 + hw * 0.3} ${sy + 90}`} strokeWidth="0.5" opacity="0.3" />
    </g>
  );
};

export default JarvisTorso;
