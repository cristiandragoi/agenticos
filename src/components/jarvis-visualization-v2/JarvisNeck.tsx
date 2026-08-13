import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, type JarvisStateV2 } from './JarvisStateV2';

interface Props {
  state: JarvisStateV2;
  color?: string;
}

/** Anatomical neck interior anchored to the MEASURED neck row (REF.neck.y):
 *  SCM contours, trachea, trapezius starts. The outer silhouette is the
 *  traced reference path (JarvisHead). */
export const JarvisNeck: React.FC<Props> = ({ state, color }) => {
  const main = color || regionColor(state, 'neck');
  const ny = REF.neck.y;
  const hw = REF.head.width;
  return (
    <g id="neck" className="jv2-region" fill="none" stroke={main}>
      {/* SCM contours */}
      <path d={`M ${500 - hw * 0.16} ${ny - 26} C ${500 - hw * 0.22} ${ny} ${500 - hw * 0.22} ${ny + 30} ${500 - hw * 0.1} ${ny + 52}`} strokeWidth="0.9" opacity="0.5" />
      <path d={`M ${500 + hw * 0.16} ${ny - 26} C ${500 + hw * 0.22} ${ny} ${500 + hw * 0.22} ${ny + 30} ${500 + hw * 0.1} ${ny + 52}`} strokeWidth="0.9" opacity="0.5" />
      {/* trachea / midline */}
      <path d={`M 500 ${ny - 16} C 500 ${ny + 10} 500 ${ny + 36} 500 ${ny + 58}`} strokeWidth="0.6" opacity="0.4" />
      {/* larynx hint */}
      <path d={`M 493 ${ny + 2} Q 500 ${ny + 10} 507 ${ny + 2}`} strokeWidth="0.7" opacity="0.5" />
      {/* trapezius starts */}
      <path d={`M ${500 - hw * 0.22} ${ny + 40} C ${500 - hw * 0.42} ${ny + 62} ${500 - hw * 0.56} ${ny + 78} ${500 - hw * 0.64} ${ny + 86}`} strokeWidth="0.7" opacity="0.4" />
      <path d={`M ${500 + hw * 0.22} ${ny + 40} C ${500 + hw * 0.42} ${ny + 62} ${500 + hw * 0.56} ${ny + 78} ${500 + hw * 0.64} ${ny + 86}`} strokeWidth="0.7" opacity="0.4" />
    </g>
  );
};

export default JarvisNeck;
