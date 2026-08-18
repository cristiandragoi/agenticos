import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, type JarvisStateV2 } from './JarvisStateV2';

interface Props {
  state: JarvisStateV2;
  color?: string;
}

/**
 * Head silhouette TRACED from the reference (REF.silhouettePath — the actual
 * measured contour of the reference figure: crown → temples → ears → jaw →
 * chin → neck → shoulders). Plus inner ear contours at the measured ear row.
 */
export const JarvisHead: React.FC<Props> = ({ state, color }) => {
  const main = color || regionColor(state, 'headSilhouette');
  const ey = REF.ears.y;
  const ex = REF.ears.extent;

  return (
    <g id="headSilhouette" className="jv2-region" fill="none" stroke={main}>
      {/* outer aura (decorative, not the silhouette) */}
      <ellipse cx="500" cy={(REF.head.crownY + REF.head.chinY) / 2} rx={REF.head.width * 0.62} ry={(REF.head.chinY - REF.head.crownY) * 0.78} stroke={main} strokeWidth="0.6" opacity="0.10" />

      {/* THE TRACED SILHOUETTE (reference geometry) */}
      <path d={REF.silhouettePath} strokeWidth="3.4" opacity="1" />

      {/* inner ear contours at the measured ear row */}
      <g id="leftEar" stroke={main}>
        <path d={`M ${500 - REF.head.width / 2 - ex * 0.4} ${ey - 16} C ${500 - REF.head.width / 2 - ex * 0.8} ${ey - 12} ${500 - REF.head.width / 2 - ex * 0.9} ${ey + 2} ${500 - REF.head.width / 2 - ex * 0.7} ${ey + 14}`} strokeWidth="1.0" opacity="0.6" />
        <path d={`M ${500 - REF.head.width / 2 - ex * 0.55} ${ey - 8} C ${500 - REF.head.width / 2 - ex * 0.8} ${ey - 4} ${500 - REF.head.width / 2 - ex * 0.8} ${ey + 6} ${500 - REF.head.width / 2 - ex * 0.6} ${ey + 10}`} strokeWidth="0.6" opacity="0.4" />
      </g>
      <g id="rightEar" stroke={main}>
        <path d={`M ${500 + REF.head.width / 2 + ex * 0.4} ${ey - 16} C ${500 + REF.head.width / 2 + ex * 0.8} ${ey - 12} ${500 + REF.head.width / 2 + ex * 0.9} ${ey + 2} ${500 + REF.head.width / 2 + ex * 0.7} ${ey + 14}`} strokeWidth="1.0" opacity="0.6" />
        <path d={`M ${500 + REF.head.width / 2 + ex * 0.55} ${ey - 8} C ${500 + REF.head.width / 2 + ex * 0.8} ${ey - 4} ${500 + REF.head.width / 2 + ex * 0.8} ${ey + 6} ${500 + REF.head.width / 2 + ex * 0.6} ${ey + 10}`} strokeWidth="0.6" opacity="0.4" />
      </g>

      {/* jaw contour hint along the traced jaw (measured chin) */}
      <path d={`M ${500 - REF.head.width * 0.34} ${REF.head.chinY - 6} C ${500 - REF.head.width * 0.12} ${REF.head.chinY + 2} ${500 + REF.head.width * 0.12} ${REF.head.chinY + 2} ${500 + REF.head.width * 0.34} ${REF.head.chinY - 6}`} strokeWidth="0.8" opacity="0.35" />
      {/* chin crease */}
      <path d={`M ${492} ${REF.head.chinY - 2} C 497 ${REF.head.chinY + 2} 503 ${REF.head.chinY + 2} 508 ${REF.head.chinY - 2}`} strokeWidth="0.6" opacity="0.4" />
    </g>
  );
};

export default JarvisHead;
