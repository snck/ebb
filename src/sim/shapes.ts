import { Vec, angleDiff } from './math';

/**
 * Hit shapes are authored in the attacker's local frame (forward = +x of facing).
 * The SAME definitions are used for hit detection and for drawing the attack trail,
 * so what the player sees is exactly what can hit them (pillar 2).
 */
export type HitShape =
  | { kind: 'arc'; r: number; half: number; inner?: number; fwd?: number }
  | { kind: 'rect'; from: number; to: number; halfW: number }
  | { kind: 'circle'; r: number; fwd?: number };

export interface Placed { x: number; y: number; facing: number }

export function shapeHitsCircle(shape: HitShape, at: Placed, c: Vec, cr: number): boolean {
  const cos = Math.cos(at.facing), sin = Math.sin(at.facing);
  switch (shape.kind) {
    case 'circle': {
      const f = shape.fwd ?? 0;
      const cx = at.x + cos * f, cy = at.y + sin * f;
      return Math.hypot(c.x - cx, c.y - cy) <= shape.r + cr;
    }
    case 'arc': {
      const f = shape.fwd ?? 0;
      const ox = at.x + cos * f, oy = at.y + sin * f;
      const dx = c.x - ox, dy = c.y - oy;
      const d = Math.hypot(dx, dy);
      if (d > shape.r + cr) return false;
      if (shape.inner && d < shape.inner - cr) return false;
      if (d <= cr) return true; // target overlaps the arc origin
      const a = Math.atan2(dy, dx);
      const slack = Math.asin(Math.min(1, cr / d));
      return Math.abs(angleDiff(at.facing, a)) <= shape.half + slack;
    }
    case 'rect': {
      // transform target into local frame
      const dx = c.x - at.x, dy = c.y - at.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const qx = Math.max(shape.from, Math.min(shape.to, lx));
      const qy = Math.max(-shape.halfW, Math.min(shape.halfW, ly));
      return Math.hypot(lx - qx, ly - qy) <= cr;
    }
  }
}

/** World-space polygon outline of a shape (for rendering trails / tells). */
export function shapePolygon(shape: HitShape, at: Placed, segs = 18): Vec[] {
  const cos = Math.cos(at.facing), sin = Math.sin(at.facing);
  const tx = (lx: number, ly: number): Vec => ({ x: at.x + lx * cos - ly * sin, y: at.y + lx * sin + ly * cos });
  const pts: Vec[] = [];
  switch (shape.kind) {
    case 'circle': {
      const f = shape.fwd ?? 0;
      for (let i = 0; i < segs * 2; i++) {
        const a = (i / (segs * 2)) * Math.PI * 2;
        pts.push(tx(f + Math.cos(a) * shape.r, Math.sin(a) * shape.r));
      }
      break;
    }
    case 'arc': {
      const f = shape.fwd ?? 0;
      const inner = shape.inner ?? 0;
      for (let i = 0; i <= segs; i++) {
        const a = -shape.half + (2 * shape.half * i) / segs;
        pts.push(tx(f + Math.cos(a) * shape.r, Math.sin(a) * shape.r));
      }
      if (inner > 0) {
        for (let i = segs; i >= 0; i--) {
          const a = -shape.half + (2 * shape.half * i) / segs;
          pts.push(tx(f + Math.cos(a) * inner, Math.sin(a) * inner));
        }
      } else pts.push(tx(f, 0));
      break;
    }
    case 'rect':
      pts.push(tx(shape.from, -shape.halfW), tx(shape.to, -shape.halfW), tx(shape.to, shape.halfW), tx(shape.from, shape.halfW));
      break;
  }
  return pts;
}

/** Furthest reach of a shape from the attacker centre (used by AI range checks and the fairness report). */
export function shapeReach(shape: HitShape): number {
  switch (shape.kind) {
    case 'circle': return (shape.fwd ?? 0) + shape.r;
    case 'arc': return (shape.fwd ?? 0) + shape.r;
    case 'rect': return shape.to;
  }
}
