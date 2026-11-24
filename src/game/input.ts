import type { Action, Input } from '../sim/types';

/**
 * Touch controls designed for glass (see DESIGN.md "Controls"):
 *  - LEFT 45% of the screen: a floating stick. Wherever the thumb lands becomes the centre; if the thumb
 *    drags past the rim the centre follows, so direction changes are always immediate.
 *  - RIGHT side: three large buttons. A touch is assigned to the NEAREST button (scaled by size), so there are
 *    no dead gaps between buttons and a slightly-off press still does the obvious thing.
 *  - Actions fire on touch DOWN (not release) for minimal latency; holding does nothing; sliding onto another
 *    button does nothing (no accidental second action).
 *  - Each press is queued with its timestamp and consumed by the next simulation tick; the simulation keeps
 *    a 220 ms buffer so presses made slightly early are never lost.
 */
export interface ButtonLayout { id: Action; x: number; y: number; r: number }

export interface Settings { scale: number; swap: boolean; haptics: boolean; volume: number; music: number }

export class Controls {
  stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, vx: 0, vy: 0 };
  private queue: Action[] = [];
  buttons: ButtonLayout[] = [];
  pressedAt: Record<string, number> = {};
  rejectedAt: Record<string, number> = {};
  private btnTouches = new Map<number, Action>();
  private keys = new Set<string>();
  enabled = true;
  onPause: () => void = () => {};
  onAnyTouch: () => void = () => {};
  pauseRect = { x: 0, y: 0, w: 52, h: 52 };
  w = 0; h = 0;
  safe = { l: 0, r: 0, t: 0, b: 0 };
  stickRadius = 58;
  lastTouchMs = 0;
  usedTouch = false;

  constructor(private el: HTMLElement, public settings: Settings) {
    el.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.up(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this.up(e), { passive: false });
    el.addEventListener('lostpointercapture', (e) => this.up(e));
    // prevent iOS gestures (double-tap zoom, long-press callout, scroll)
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'contextmenu']) {
      el.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    }
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
  }

  layout(w: number, h: number, safe = this.safe) {
    this.w = w; this.h = h; this.safe = safe;
    const s = this.settings.scale * Math.max(0.85, Math.min(1.2, h / 390));
    const R = (x: number) => x * s;
    const right = (dx: number) => (this.settings.swap ? safe.l + dx : w - safe.r - dx);
    const bottom = h - Math.max(safe.b, 6);
    this.buttons = [
      { id: 'dodge', x: right(R(84)), y: bottom - R(86), r: R(48) },
      { id: 'attack', x: right(R(200)), y: bottom - R(62), r: R(44) },
      { id: 'heal', x: right(R(74)), y: bottom - R(206), r: R(33) },
    ];
    this.stickRadius = R(58);
    this.pauseRect = { x: this.settings.swap ? safe.l + 8 : w - safe.r - 60, y: safe.t + 8, w: 52, h: 52 };
  }

  private inStickZone(x: number) {
    return this.settings.swap ? x > this.w * 0.55 : x < this.w * 0.45;
  }

  private nearestButton(x: number, y: number): Action | null {
    let best: Action | null = null, bd = Infinity;
    for (const b of this.buttons) {
      const d = Math.hypot(x - b.x, y - b.y) / b.r;
      // heal is deliberately harder to hit by accident: it must be closer relative to its size
      const lim = b.id === 'heal' ? 1.45 : 2.1;
      if (d < lim && d < bd) { bd = d; best = b.id; }
    }
    return best;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.onAnyTouch();
    if (e.pointerType === 'touch') this.usedTouch = true;
    this.lastTouchMs = performance.now();
    const x = e.clientX, y = e.clientY;
    const pr = this.pauseRect;
    if (x >= pr.x - 8 && x <= pr.x + pr.w + 8 && y >= pr.y - 8 && y <= pr.y + pr.h + 8) { this.onPause(); return; }
    if (!this.enabled) return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.inStickZone(x)) {
      if (!this.stick.active) {
        this.stick = { active: true, id: e.pointerId, ox: x, oy: y, x, y, vx: 0, vy: 0 };
      }
      return;
    }
    const b = this.nearestButton(x, y);
    if (b) {
      this.btnTouches.set(e.pointerId, b);
      this.queue.push(b);
      this.pressedAt[b] = performance.now();
    }
  }

  private move(e: PointerEvent) {
    if (!this.stick.active || e.pointerId !== this.stick.id) return;
    e.preventDefault();
    const s = this.stick;
    s.x = e.clientX; s.y = e.clientY;
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const d = Math.hypot(dx, dy), R = this.stickRadius;
    if (d > R) { // drag the centre along so reversing direction is instant
      s.ox = s.x - (dx / d) * R; s.oy = s.y - (dy / d) * R;
      dx = s.x - s.ox; dy = s.y - s.oy;
    }
    const dead = 7;
    const m = Math.hypot(dx, dy);
    if (m < dead) { s.vx = 0; s.vy = 0; return; }
    const mag = Math.min(1, (m - dead) / (R * 0.75 - dead));
    s.vx = (dx / m) * mag; s.vy = (dy / m) * mag;
  }

  private up(e: PointerEvent) {
    if (this.stick.active && e.pointerId === this.stick.id) this.stick = { ...this.stick, active: false, vx: 0, vy: 0 };
    this.btnTouches.delete(e.pointerId);
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if (down && !this.keys.has(k)) {
      if (k === 'escape' || k === 'p') this.onPause();
      if (this.enabled) {
        if (k === 'j' || k === ' ') this.queue.push('attack');
        if (k === 'k' || k === 'shift') this.queue.push('dodge');
        if (k === 'l' || k === 'h') this.queue.push('heal');
      }
      this.onAnyTouch();
    }
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  holdsButton(id: Action) { for (const v of this.btnTouches.values()) if (v === id) return true; return false; }

  /** Build the input for one simulation tick. Presses are consumed one per tick (a press is never lost). */
  sample(): Input {
    let mx = this.stick.vx, my = this.stick.vy;
    if (!this.stick.active) {
      const kx = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      const ky = (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0);
      if (kx || ky) { const m = Math.hypot(kx, ky); mx = kx / m; my = ky / m; }
    }
    const a = this.enabled ? this.queue.shift() : undefined;
    if (!this.enabled) this.queue.length = 0;
    return { mx, my, attack: a === 'attack', dodge: a === 'dodge', heal: a === 'heal' };
  }

  clear() { this.queue.length = 0; this.stick.active = false; this.stick.vx = 0; this.stick.vy = 0; this.btnTouches.clear(); }
}
