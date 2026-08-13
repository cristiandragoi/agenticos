import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, CHANNELS_V2, type JarvisStateV2 } from './JarvisStateV2';

interface Props {
  state: JarvisStateV2;
  pulse: number;
}

/** Luminous brain/forehead core at the MEASURED reference position
 *  (REF.brainCore): radial rings, branching connections, neural nodes,
 *  central light with glow falloff. NOT a square. */
export const JarvisBrain: React.FC<Props> = ({ state, pulse }) => {
  const color = regionColor(state, 'foreheadCore');
  const mesh = regionColor(state, 'brain');
  const cx = REF.brainCore.x;
  const cy = REF.brainCore.y;
  const branchAngles = [0, 40, 80, 120, 160, 200, 240, 280, 320];

  return (
    <g id="foreheadCore" className="jv2-region" fill="none">
      <circle cx={cx} cy={cy} r={78} fill={color} opacity={0.05 + pulse * 0.04} filter="url(#jv2-glow-soft)" />
      <circle cx={cx} cy={cy} r={48} fill={color} opacity={0.08 + pulse * 0.06} />

      <circle cx={cx} cy={cy} r="52" stroke={color} strokeWidth="1.2" opacity={0.55 + pulse * 0.3} />
      <circle cx={cx} cy={cy} r="36" stroke={color} strokeWidth="0.8" opacity={0.4 + pulse * 0.3} />
      <circle cx={cx} cy={cy} r="23" stroke={color} strokeWidth="0.6" opacity={0.3 + pulse * 0.25} />
      <circle cx={cx} cy={cy} r="60" stroke={color} strokeWidth="0.4" strokeDasharray="4 7" opacity={0.3 + pulse * 0.2} />

      {branchAngles.map((a, i) => {
        const rad = (a * Math.PI) / 180;
        const x1 = cx + Math.cos(rad) * 12;
        const y1 = cy + Math.sin(rad) * 12;
        const x2 = cx + Math.cos(rad) * (52 + (i % 3) * 8);
        const y2 = cy + Math.sin(rad) * (52 + (i % 3) * 8);
        return (
          <g key={a}>
            <path d={`M ${x1} ${y1} Q ${cx + Math.cos(rad + 0.3) * 34} ${cy + Math.sin(rad + 0.3) * 34}, ${x2} ${y2}`} stroke={mesh} strokeWidth="0.7" opacity={0.5} />
            <circle cx={x2} cy={y2} r={i % 3 === 0 ? 2.4 : 1.3} fill={mesh} opacity={0.7} />
          </g>
        );
      })}

      {branchAngles.map((a, i) => {
        const rad = ((a + 18) * Math.PI) / 180;
        const r = 20 + (i % 4) * 6;
        return <circle key={`n${a}`} cx={cx + Math.cos(rad) * r} cy={cy + Math.sin(rad) * r} r={1.0} fill={mesh} opacity={0.6} />;
      })}

      <circle cx={cx} cy={cy} r="9" fill={color} opacity={0.9} filter="url(#jv2-glow)" />
      <circle cx={cx} cy={cy} r="4.2" fill={CHANNELS_V2.white} opacity={0.95} />
      <circle cx={cx - 2.5} cy={cy - 2} r="1.2" fill="#ffffff" opacity={0.85} />

      {/* brain mesh arcs below the core */}
      <path d={`M ${cx - 48} ${cy + 32} C ${cx - 30} ${cy + 62} ${cx + 30} ${cy + 62} ${cx + 48} ${cy + 32}`} stroke={mesh} strokeWidth="0.6" opacity={0.35} />
      <path d={`M ${cx - 60} ${cy + 54} C ${cx - 30} ${cy + 80} ${cx + 30} ${cy + 80} ${cx + 60} ${cy + 54}`} stroke={mesh} strokeWidth="0.5" opacity={0.25} />
    </g>
  );
};

export default JarvisBrain;
