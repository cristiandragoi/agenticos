import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, type JarvisStateV2 } from './JarvisStateV2';

interface Props {
  state: JarvisStateV2;
  color?: string;
}

/** Torso interior anchored to the MEASURED shoulder row (REF.shoulders.y):
 *  clavicle lines, sternum, deltoid shading. The outer bust silhouette is
 *  the traced reference path (JarvisHead). */
export const JarvisTorso: React.FC<Props> = ({ state, color }) => {
  const main = color || regionColor(state, 'torso');
  const sy = REF.shoulders.y;
  const hw = REF.head.width;
  return (
    <g id="torso" className="jv2-region" fill="none" stroke={main}>
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
