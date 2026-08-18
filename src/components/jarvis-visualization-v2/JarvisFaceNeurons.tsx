import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, type JarvisStateV2 } from './JarvisStateV2';
import { NeuralField, scatterEllipse, buildConnections, makeRand, type MeshPoint } from './JarvisNeuralMesh';

interface Props {
  state: JarvisStateV2;
  pulse: number;
}

/** Face neural mesh built from the REFERENCE's own bright points
 *  (REF.headNeurons) — the hologram's actual neural positions on the face —
 *  plus anatomy-band augmentation (brow/eye/nose/mouth/jaw lines at the
 *  measured anchors). Meaningful neighbor connections. */
export const JarvisFaceNeurons: React.FC<Props> = ({ state, pulse }) => {
  const color = regionColor(state, 'faceNeurons');
  const rand = makeRand(4242);
  const eyeY = REF.eyes.left.y;

  const pts: MeshPoint[] = [];
  // real reference points on the face (below the brain band)
  for (const p of REF.headNeurons) {
    if (p.y >= eyeY - 40) pts.push({ x: p.x, y: p.y, r: 1.1 + (p.lum % 20) / 20, o: 0.3 + (p.lum % 30) / 100 });
  }
  // anatomical band augmentation at measured anchors
  pts.push(...scatterEllipse(500, eyeY - 34, REF.head.width * 0.34, 22, 18, rand, 0.16));       // brows
  pts.push(...scatterEllipse(REF.eyes.left.x, eyeY, 30, 15, 14, rand, 0.15));                   // left eye
  pts.push(...scatterEllipse(REF.eyes.right.x, eyeY, 30, 15, 14, rand, 0.15));                  // right eye
  pts.push(...scatterEllipse(500, REF.nose.y, 16, 44, 12, rand, 0.2));                          // nose
  pts.push(...scatterEllipse(500, REF.mouth.y, 44, 18, 14, rand, 0.18));                        // mouth
  pts.push(...scatterEllipse(500, REF.head.chinY - 8, 52, 18, 12, rand, 0.2));                  // jaw/chin
  pts.push(...scatterEllipse(500, eyeY + 60, REF.head.width * 0.42, 36, 18, rand, 0.18));       // cheeks

  const connections = buildConnections(pts, rand, 52, 5, 10);

  return (
    <g id="faceNeurons" className="jv2-region">
      <NeuralField points={pts} connections={connections} color={color} pulse={pulse} />
    </g>
  );
};

export default JarvisFaceNeurons;
