import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, CHANNELS_V2, type JarvisStateV2 } from './JarvisStateV2';
import { NeuralField, scatterEllipse, buildConnections, makeRand, type MeshPoint } from './JarvisNeuralMesh';

interface Props {
  state: JarvisStateV2;
  pulse: number;
  breath: number;
}

/** Chest neural network + radial chest core at the MEASURED reference
 *  position (REF.chestCore — NO square) + lower energy stream down to the
 *  base platform. Real reference body points + augmentation. */
export const JarvisChestCore: React.FC<Props> = ({ state, pulse, breath }) => {
  const core = regionColor(state, 'chestCore');
  const mesh = regionColor(state, 'chestNeurons');
  const lower = regionColor(state, 'lowerEnergyCore');
  const rand = makeRand(7777);
  const cxc = REF.chestCore.x;
  const cyc = REF.chestCore.y;
  const baseY = 1194;

  const pts: MeshPoint[] = [
    { x: cxc, y: cyc, r: 4.6, o: 0.95, hub: true },
    { x: cxc - 30, y: cyc - 32, r: 2.8, o: 0.8, hub: true },
    { x: cxc + 30, y: cyc - 32, r: 2.8, o: 0.8, hub: true },
    { x: cxc - 50, y: cyc + 32, r: 2.6, o: 0.75, hub: true },
    { x: cxc + 50, y: cyc + 32, r: 2.6, o: 0.75, hub: true },
    { x: cxc, y: cyc - 52, r: 2.4, o: 0.7, hub: true },
  ];
  // real reference body points (neck/chest band)
  for (const p of REF.bodyNeurons) {
    if (p.y > REF.neck.y) pts.push({ x: p.x, y: p.y, r: 1.2 + (p.lum % 18) / 18, o: 0.3 + (p.lum % 30) / 100 });
  }
  pts.push(...scatterEllipse(cxc, cyc, 60, 40, 28, rand, 0.22));
  pts.push(...scatterEllipse(cxc, cyc, 110, 64, 26, rand, 0.26));
  pts.push(...scatterEllipse(500, REF.shoulders.y + 20, REF.head.width * 0.6, 40, 22, rand, 0.2));
  const connections = buildConnections(pts, rand, 60, 7, 8);
  const bright = new Set([0, 1, 2, 5]);

  return (
    <g id="chestCore" className="jv2-region" fill="none">
      <NeuralField points={pts} connections={connections} color={mesh} pulse={pulse} bright={bright} />

      {/* radial core rings */}
      <circle cx={cxc} cy={cyc} r="56" stroke={core} strokeWidth="1.4" opacity={0.6 + breath * 0.25 + pulse * 0.15} />
      <circle cx={cxc} cy={cyc} r="38" stroke={core} strokeWidth="0.9" opacity={0.45 + breath * 0.2} />
      <circle cx={cxc} cy={cyc} r="24" stroke={core} strokeWidth="0.7" opacity={0.35 + pulse * 0.25} />
      <circle cx={cxc} cy={cyc} r="66" stroke={core} strokeWidth="0.4" strokeDasharray="5 8" opacity={0.35} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => {
        const rad = (a * Math.PI) / 180;
        const x1 = cxc + Math.cos(rad) * 16;
        const y1 = cyc + Math.sin(rad) * 16;
        const x2 = cxc + Math.cos(rad) * (56 + (i % 3) * 10);
        const y2 = cyc + Math.sin(rad) * (56 + (i % 3) * 10);
        return (
          <path key={a} d={`M ${x1} ${y1} Q ${cxc + Math.cos(rad + 0.4) * 36} ${cyc + Math.sin(rad + 0.4) * 36}, ${x2} ${y2}`} stroke={core} strokeWidth="0.6" opacity={0.5} />
        );
      })}
      <circle cx={cxc} cy={cyc} r="13" fill={core} opacity={0.9} filter="url(#jv2-glow)" />
      <circle cx={cxc} cy={cyc} r="5.5" fill={CHANNELS_V2.white} opacity={0.95} />
      <circle cx={cxc - 3} cy={cyc - 2} r="1.4" fill="#ffffff" opacity={0.85} />
      <circle cx={cxc} cy={cyc} r="84" fill={core} opacity={0.04 + pulse * 0.03} filter="url(#jv2-glow-soft)" />

      {/* ── LOWER ENERGY CORE: vertical stream → base platform ── */}
      <g id="lowerEnergyCore" className="jv2-region">
        <path d={`M ${cxc - 30} ${cyc + 50} C ${cxc - 22} ${cyc + 140} ${cxc - 12} ${cyc + 240} ${cxc - 2} ${baseY - 2}`} stroke={lower} strokeWidth="1.0" opacity={0.5} />
        <path d={`M ${cxc + 30} ${cyc + 50} C ${cxc + 22} ${cyc + 140} ${cxc + 12} ${cyc + 240} ${cxc + 2} ${baseY - 2}`} stroke={lower} strokeWidth="1.0" opacity={0.5} />
        <path d={`M ${cxc} ${cyc + 50} L ${cxc} ${baseY - 2}`} stroke={lower} strokeWidth="0.8" strokeDasharray="3 6" opacity={0.5} />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
          <circle key={i} cx={cxc + ((i * 53) % 7 - 3) * 4} cy={cyc + 60 + i * 28} r={1.1 + (i % 3) * 0.5} fill={lower} opacity={0.55 - i * 0.035} />
        ))}
        <ellipse cx="500" cy={baseY} rx="150" ry="22" stroke={lower} strokeWidth="1.1" opacity={0.55} />
        <ellipse cx="500" cy={baseY} rx="104" ry="15" stroke={lower} strokeWidth="0.7" opacity={0.45} />
        <ellipse cx="500" cy={baseY} rx="58" ry="9" stroke={lower} strokeWidth="0.5" opacity={0.6} />
        <ellipse cx="500" cy={baseY} rx="150" ry="22" fill={lower} opacity={0.05} />
        <circle cx="500" cy={baseY} r="10" fill={lower} opacity={0.55} filter="url(#jv2-glow)" />
      </g>
    </g>
  );
};

export default JarvisChestCore;
