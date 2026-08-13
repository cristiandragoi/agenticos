import React from 'react';
import { REF } from './referenceGeometry';
import { regionColor, type JarvisStateV2 } from './JarvisStateV2';

interface Props {
  state: JarvisStateV2;
  color?: string;
  mouthOpen?: number;
}

/**
 * Face features placed on the MEASURED head (REF.eyes/nose/mouth — anatomically
 * positioned within the traced silhouette; the reference's face interior is
 * uniform hologram density, so micro-features follow anatomy on the measured
 * contour rather than being pixel-separable).
 */
export const JarvisFace: React.FC<Props> = ({ state, color, mouthOpen = 0 }) => {
  const main = color || regionColor(state, 'face');
  const eyeY = REF.eyes.left.y;
  const lx = REF.eyes.left.x;
  const rx = REF.eyes.right.x;
  const ny = REF.nose.y;
  const my = REF.mouth.y;
  const open = Math.min(6, mouthOpen * 6);

  return (
    <g id="face" className="jv2-region" fill="none" stroke={main}>
      {/* ── BROWS (above measured eyes) ── */}
      <path d={`M ${lx - 22} ${eyeY - 14} C ${lx - 10} ${eyeY - 22} ${lx + 8} ${eyeY - 22} ${lx + 22} ${eyeY - 16}`} strokeWidth="2.2" opacity="0.75" />
      <path d={`M ${rx + 22} ${eyeY - 14} C ${rx + 10} ${eyeY - 22} ${rx - 8} ${eyeY - 22} ${rx - 22} ${eyeY - 16}`} strokeWidth="2.2" opacity="0.75" />

      {/* ── EYE SOCKET SHADING (around measured eyes) ── */}
      <ellipse cx={lx} cy={eyeY + 1} rx="26" ry="13" strokeWidth="0.8" opacity="0.22" />
      <ellipse cx={rx} cy={eyeY + 1} rx="26" ry="13" strokeWidth="0.8" opacity="0.22" />

      {/* ── NOSE (bridge from between eyes to measured tip) ── */}
      <path d={`M 500 ${eyeY - 10} C 498 ${eyeY + 30} 497 ${ny - 30} 498 ${ny - 8} C 498 ${ny - 2} 498 ${ny + 2} 497 ${ny + 6}`} strokeWidth="1.5" opacity="0.8" />
      <path d={`M 484 ${eyeY + 8} C 488 ${eyeY + 34} 492 ${ny - 20} 496 ${ny - 4}`} strokeWidth="1.0" opacity="0.6" />
      <path d={`M 516 ${eyeY + 8} C 512 ${eyeY + 34} 508 ${ny - 20} 504 ${ny - 4}`} strokeWidth="1.0" opacity="0.6" />
      <path d={`M 488 ${ny} C 494 ${ny + 10} 506 ${ny + 10} 512 ${ny}`} strokeWidth="1.7" opacity="0.85" />
      <path d={`M 486 ${ny + 4} C 490 ${ny + 8} 494 ${ny + 8} 497 ${ny + 5}`} strokeWidth="0.8" opacity="0.6" />
      <path d={`M 514 ${ny + 4} C 510 ${ny + 8} 506 ${ny + 8} 503 ${ny + 5}`} strokeWidth="0.8" opacity="0.6" />
      <path d={`M 497 ${ny + 6} C 499 ${ny + 10} 501 ${ny + 10} 503 ${ny + 6}`} strokeWidth="0.6" opacity="0.45" />

      {/* ── PHILTRUM ── */}
      <path d={`M 500 ${ny + 14} C 500 ${ny + 22} 500 ${my - 6} 500 ${my - 2}`} strokeWidth="0.6" opacity="0.5" />

      {/* ── LIPS at measured mouth (mouth opens with speaking) ── */}
      <path d={`M ${my - 20} ${my} C ${my - 12} ${my - 6} ${my - 6} ${my - 6} 500 ${my - 2} C 506 ${my - 6} 512 ${my - 6} ${my + 20} ${my} C ${my + 24} ${my + 4} ${my + 22} ${my + 8} ${my + 18} ${my + 9} C 506 ${my + 13 + open} 494 ${my + 13 + open} ${my - 18} ${my + 9} C ${my - 22} ${my + 8} ${my - 24} ${my + 4} ${my - 20} ${my} Z`} strokeWidth="1.6" opacity="0.85" />
      <path d={`M ${my - 16} ${my + 12 + open * 2} C 494 ${my + 20 + open * 2} 506 ${my + 20 + open * 2} ${my + 16} ${my + 12 + open * 2}`} strokeWidth="1.5" opacity="0.8" />
      <path d={`M ${my - 16} ${my + 8 + open * 0.5} C 494 ${my + 12 + open} 506 ${my + 12 + open} ${my + 16} ${my + 8 + open * 0.5}`} strokeWidth="1.8" opacity="0.9" />

      {/* ── NASOLABIAL HINTS ── */}
      <path d={`M ${lx - 14} ${ny + 2} C ${lx - 8} ${my - 18} ${lx - 2} ${my - 6} 500 ${my - 8}`} strokeWidth="0.6" opacity="0.3" />
      <path d={`M ${rx + 14} ${ny + 2} C ${rx + 8} ${my - 18} ${rx + 2} ${my - 6} 500 ${my - 8}`} strokeWidth="0.6" opacity="0.3" />

      {/* ── JAWLINE (measured) ── */}
      <path d={`M ${lx - 28} ${my - 14} C ${lx - 20} ${REF.head.chinY - 16} ${lx - 6} ${REF.head.chinY - 4} 500 ${REF.head.chinY}`} strokeWidth="0.7" opacity="0.4" />
      <path d={`M ${rx + 28} ${my - 14} C ${rx + 20} ${REF.head.chinY - 16} ${rx + 6} ${REF.head.chinY - 4} 500 ${REF.head.chinY}`} strokeWidth="0.7" opacity="0.4" />
    </g>
  );
};

export default JarvisFace;
