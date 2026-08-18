import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, CHANNELS_V2, type JarvisStateV2 } from './JarvisStateV2';

interface Props {
  state: JarvisStateV2;
  side: 'left' | 'right';
}

/** Eye at the MEASURED reference position (REF.eyes.left/right). */
export const JarvisEye: React.FC<Props> = ({ state, side }) => {
  const color = regionColor(state, side === 'left' ? 'leftEye' : 'rightEye');
  const cx = (side === 'left' ? REF.eyes.left : REF.eyes.right).x;
  const cy = REF.eyes.left.y;
  const rx = 24;
  const ry = REF.eyes.ry;
  const lidUp = side === 'left'
    ? `M ${cx - rx - 4} ${cy} C ${cx - rx + 8} ${cy - ry - 6} ${cx + rx - 8} ${cy - ry - 6} ${cx + rx + 4} ${cy - 2}`
    : `M ${cx - rx - 4} ${cy - 2} C ${cx - rx + 8} ${cy - ry - 6} ${cx + rx - 8} ${cy - ry - 6} ${cx + rx + 4} ${cy}`;
  const lidLow = `M ${cx - rx - 4} ${cy + 2} C ${cx - rx + 8} ${cy + ry + 6} ${cx + rx - 8} ${cy + ry + 6} ${cx + rx + 4} ${cy + 2}`;

  return (
    <g id={side === 'left' ? 'leftEye' : 'rightEye'} className="jv2-region jv2-eye" fill="none">
      {/* orbital neural points (around the measured eye) */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a, i) => {
        const rad = (a * Math.PI) / 180;
        return (
          <circle key={i} cx={cx + Math.cos(rad) * (rx + 6)} cy={cy + Math.sin(rad) * (ry + 6)} r={i % 3 === 0 ? 2.2 : 1.2} fill={color} opacity={0.25 + (i % 4) * 0.12} />
        );
      })}
      {/* socket ring */}
      <ellipse cx={cx} cy={cy} rx={rx + 5} ry={ry + 3} stroke={color} strokeWidth="0.7" opacity="0.45" />
      {/* lids */}
      <path d={lidUp} stroke={color} strokeWidth="2.4" opacity="0.95" />
      <path d={lidLow} stroke={color} strokeWidth="1.2" opacity="0.6" />
      {/* glow core + pupil */}
      <ellipse cx={cx} cy={cy + 2} rx={rx * 0.42} ry={ry * 0.42} fill={color} opacity="0.85" filter="url(#jv2-glow)" />
      <circle cx={cx} cy={cy + 2} r="2.6" fill={CHANNELS_V2.white} opacity="0.95" />
      <circle cx={cx - 3} cy={cy} r="1.1" fill="#ffffff" opacity="0.8" />
    </g>
  );
};

export const JarvisEyes: React.FC<{ state: JarvisStateV2 }> = ({ state }) => (
  <>
    <JarvisEye state={state} side="left" />
    <JarvisEye state={state} side="right" />
  </>
);

export default JarvisEyes;
