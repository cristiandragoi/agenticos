import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, type JarvisStateV2 } from './JarvisStateV2';
import { NeuralField, scatterEllipse, buildConnections, makeRand, type MeshPoint } from './JarvisNeuralMesh';

interface Props {
  state: JarvisStateV2;
  pulse: number;
}

/** Dense neural network INSIDE the skull: the reference's own head points
 *  (REF.headNeurons in the brain band) + augmentation around the measured
 *  brain core. ~150 connections. */
export const JarvisBrainNeurons: React.FC<Props> = ({ state, pulse }) => {
  const color = regionColor(state, 'brainNeurons');
  const rand = makeRand(1337);
  const eyeY = REF.eyes.left.y;

  const hubs: MeshPoint[] = [
    { x: REF.brainCore.x, y: REF.brainCore.y, r: 4.5, o: 0.95, hub: true },
    { x: REF.brainCore.x - 52, y: REF.brainCore.y - 24, r: 3.0, o: 0.8, hub: true },
    { x: REF.brainCore.x + 52, y: REF.brainCore.y - 24, r: 3.0, o: 0.8, hub: true },
    { x: 500, y: REF.head.crownY + 10, r: 2.6, o: 0.75, hub: true },
    { x: 500, y: REF.brainCore.y + 70, r: 2.4, o: 0.7, hub: true },
  ];
  // real reference points in the brain band
  const pts: MeshPoint[] = [...hubs];
  for (const p of REF.headNeurons) {
    if (p.y < eyeY - 30) pts.push({ x: p.x, y: p.y, r: 1.2 + (p.lum % 18) / 18, o: 0.3 + (p.lum % 30) / 100 });
  }
  // dense augmentation around the measured brain core
  pts.push(...scatterEllipse(REF.brainCore.x, REF.brainCore.y, 60, 44, 30, rand, 0.22));
  pts.push(...scatterEllipse(REF.brainCore.x, REF.brainCore.y, 86, 52, 26, rand, 0.24));

  const bright = new Set([0, 1, 2, 3, 4]);
  const connections = buildConnections(pts, rand, 62, 8, 8);

  return (
    <g id="brainNeurons" className="jv2-region">
      <NeuralField points={pts} connections={connections} color={color} pulse={pulse} bright={bright} />
    </g>
  );
};

export default JarvisBrainNeurons;
