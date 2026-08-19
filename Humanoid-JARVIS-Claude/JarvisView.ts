import { DESIGN_W, DESIGN_H } from './BaseAdapt';

export interface JarvisViewWindow {
  top: number;
  bottom: number;
  fade?: number;
}

/**
 * Workspace framing: head → upper/mid chest. No abdomen, no pool, no pedestal.
 * (Spec contract, kept verbatim — the stage that uses the v2 SVG base maps to
 * its own window in viewBox coordinates via STAGE_VIEW.)
 */
export const BUST_VIEW: JarvisViewWindow = { top: 60, bottom: 820, fade: 64 };

export interface ViewTransform {
  s: number;
  tx: number;
  ty: number;
}

export function viewTransform(view: JarvisViewWindow | null, width: number, height: number): ViewTransform {
  if (!view) {
    const s = Math.min(width / DESIGN_W, height / DESIGN_H);
    return { s, tx: (width - DESIGN_W * s) / 2, ty: (height - DESIGN_H * s) / 2 };
  }
  const span = view.bottom - view.top;
  const s = Math.min(width / DESIGN_W, height / span);
  return { s, tx: (width - DESIGN_W * s) / 2, ty: (height - span * s) / 2 - view.top * s };
}

export const toPixel = (v: ViewTransform, x: number, y: number) => ({
  x: x * v.s + v.tx,
  y: y * v.s + v.ty,
});
