import { World } from '../sim/world';
import { Enemy } from '../sim/enemy';
import { Player } from '../sim/player';
import { PLAYER, ms2t, TICK_MS, CAM_BIAS } from '../sim/constants';
import { shapePolygon, HitShape } from '../sim/shapes';
import { StepDef } from '../sim/defs';
import { Controls } from './input';
import { Vec, lerp, clamp } from '../sim/math';

const TAU = Math.PI * 2;
const VIEW_H = 11; // metres visible vertically at zoom 1 (see constants.inFairView)

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'spark' | 'mote' | 'ring' | 'dust' | 'drop' | 'mist'; grow?: number }

function hash(x: number, y: number) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

export interface HudState {
  hpShown: number; hpLag: number; stamShown: number; bossLag: number;
  noteText: string | null; noteAlpha: number;
  bossCard: { name: string; sub: string; t: number } | null;
  tutorial: { stick: boolean; attack: boolean; dodge: boolean; heal: boolean };
  flashRed: number; flashWhite: number; lowHp: number;
  centerText: { text: string; sub?: string; t: number; color?: string } | null;
  dodgeCue: { uid: number; t: number } | null;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  cam = { x: 0, y: 0, z: 1 };
  shake = 0; shakeX = 0; shakeY = 0;
  particles: Particle[] = [];
  tellFlash = new Map<number, number>(); // uid -> real time ms of tell start
  enemyTellStep = new Map<number, StepDef>();
  prev = new Map<object, Vec>();
  time = 0;
  scale = 34;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(w: number, h: number, dprCap: number) {
    this.w = w; this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
  }

  addShake(a: number) { this.shake = Math.min(1.2, this.shake + a); }

  burst(x: number, y: number, n: number, color: string, speed = 4, kind: Particle['kind'] = 'spark', life = 0.4, size = 0.08) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random()), color, kind });
    }
  }
  ringFx(x: number, y: number, color: string, life = 0.35, size = 0.5, grow = 6) {
    this.particles.push({ x, y, vx: 0, vy: 0, life, max: life, size, color, kind: 'ring', grow });
  }

  /** world -> screen */
  sx(x: number) { return (x - this.cam.x) * this.scale + this.w / 2 + this.shakeX; }
  sy(y: number) { return (y - this.cam.y) * this.scale + this.h / 2 + this.shakeY; }

  /** Is a screen point covered by a thumb (any button, or the bottom-left stick area)? */
  thumbCovered(X: number, Y: number, c: Controls | null, margin = 14): boolean {
    if (!c) return false;
    for (const b of c.buttons) if (Math.hypot(b.x - X, b.y - Y) < b.r + margin) return true;
    const st = c.stick;
    const sx = st.active ? st.ox : (c as any).settings?.swap ? this.w - 120 : 120;
    const sy = st.active ? st.oy : this.h - 110;
    return Math.hypot(sx - X, sy - Y) < c.stickRadius + 34 + margin;
  }

  updateCamera(w: World, dt: number, alpha: number, controls: Controls | null) {
    const p = this.lerpPos(w.player, alpha);
    let tx = p.x, ty = p.y + CAM_BIAS, z = 1;
    const baseScale = this.h / VIEW_H;
    if (w.fight && w.fight.boss.alive()) {
      const b = w.fight.boss;
      const bp = b.airborne && b.leapTarget ? b.leapTarget : this.lerpPos(b, alpha);
      const dx = bp.x - p.x, dy = bp.y - p.y;
      const halfW = (this.w / 2) / baseScale, halfH = VIEW_H / 2;
      // try a few framings between player and boss; keep the first that shows both and keeps the boss out from under the thumbs
      let best: { x: number; y: number; z: number } | null = null;
      for (const k of [0.15, 0.3, 0.45, 0.6]) {
        const cx = p.x + dx * k, cy = p.y + CAM_BIAS + dy * k;
        const needX = (Math.max(Math.abs(bp.x - cx) + b.def.radius, Math.abs(p.x - cx)) + 1) / (halfW * 0.9);
        const needY = (Math.max(Math.abs(bp.y - cy) + b.def.radius, Math.abs(p.y - cy)) + 1) / (halfH * 0.9);
        const zz = clamp(1 / Math.max(1, needX, needY), 0.7, 1);
        const S = baseScale * zz;
        const BX = (bp.x - cx) * S + this.w / 2, BY = (bp.y - cy) * S + this.h / 2;
        const PX = (p.x - cx) * S + this.w / 2, PY = (p.y - cy) * S + this.h / 2;
        const ok = !this.thumbCovered(BX, BY, controls) && !this.thumbCovered(PX, PY, controls, 0);
        if (!best) best = { x: cx, y: cy, z: zz };
        if (ok) { best = { x: cx, y: cy, z: zz }; break; }
      }
      tx = best!.x; ty = best!.y; z = best!.z;
    }
    const k = 1 - Math.exp(-dt * 10);
    this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k);
    this.cam.z = lerp(this.cam.z, z, 1 - Math.exp(-dt * 4));
    if (Math.hypot(this.cam.x - tx, this.cam.y - ty) > 8) { this.cam.x = tx; this.cam.y = ty; }
    this.scale = baseScale * this.cam.z;
    this.shake = Math.max(0, this.shake - dt * 3.5);
    const s = this.shake * this.shake * 9;
    this.shakeX = (Math.random() * 2 - 1) * s; this.shakeY = (Math.random() * 2 - 1) * s;
  }

  lerpPos(o: { x: number; y: number }, alpha: number): Vec {
    const p = this.prev.get(o);
    if (!p) return { x: o.x, y: o.y };
    return { x: lerp(p.x, o.x, alpha), y: lerp(p.y, o.y, alpha) };
  }
  snapshot(w: World) {
    this.prev.set(w.player, { x: w.player.x, y: w.player.y });
    for (const e of w.enemies) this.prev.set(e, { x: e.x, y: e.y });
  }

  // ======================================================================== frame
  draw(w: World, alpha: number, dt: number, controls: Controls | null, hud: HudState, showHud: boolean) {
    this.time += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#06080b';
    ctx.fillRect(0, 0, this.w, this.h);
    this.updateCamera(w, dt, alpha, controls);
    this.drawTiles(w);
    this.drawProps(w);
    // shadows + dive markers
    for (const e of w.enemies) this.drawMarker(w, e);
    for (const r of w.rings) this.drawRing(r);
    // bodies sorted by y
    const bodies: { y: number; f: () => void }[] = [];
    for (const e of w.enemies) { const p = this.lerpPos(e, alpha); bodies.push({ y: p.y, f: () => this.drawEnemy(w, e, p) }); }
    const pp = this.lerpPos(w.player, alpha);
    bodies.push({ y: pp.y, f: () => this.drawPlayer(w, w.player, pp) });
    bodies.sort((a, b) => a.y - b.y);
    for (const b of bodies) b.f();
    for (const pr of w.projectiles) this.drawProjectile(pr);
    this.drawParticles(dt);
    this.drawLighting(w, pp);
    if (showHud) {
      this.drawOffscreen(w);
      this.drawHud(w, hud, dt);
      if (controls) this.drawControls(w, controls, hud);
    }
    this.drawOverlays(hud, dt);
  }

  // ======================================================================== world
  private chunks = new Map<string, HTMLCanvasElement>();
  private chunkTpx = 0;
  /** Static floor/walls are pre-rendered into 8x8-tile chunks (big win on mid-range phones). */
  private chunk(w: World, cx: number, cy: number, tpx: number): HTMLCanvasElement {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (c) { this.chunks.delete(key); this.chunks.set(key, c); return c; }
    const CH = 8;
    c = document.createElement('canvas');
    c.width = CH * tpx; c.height = CH * tpx;
    const g = c.getContext('2d')!;
    const L = w.level, S = tpx;
    for (let ty = 0; ty < CH; ty++) for (let tx = 0; tx < CH; tx++) {
      const x = cx * CH + tx, y = cy * CH + ty;
      const ch = L.tile(x, y);
      const X = tx * S, Y = ty * S, n = hash(x, y);
      switch (ch) {
        case ' ': g.fillStyle = '#06080b'; g.fillRect(X, Y, S, S); break;
        case '.': g.fillStyle = `hsl(210, 8%, ${15 + n * 4}%)`; g.fillRect(X, Y, S, S);
          if (n > 0.8) { g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X + S * 0.2, Y + S * n); g.lineTo(X + S * 0.8, Y + S * (1 - n)); g.stroke(); }
          break;
        case ':': g.fillStyle = `hsl(40, 14%, ${22 + n * 3}%)`; g.fillRect(X, Y, S, S); break;
        case '=': g.fillStyle = `hsl(25, 22%, ${17 + n * 3}%)`; g.fillRect(X, Y, S, S);
          g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(X, Y + S * 0.48, S, Math.max(1, S * 0.04)); break;
        case ',': g.fillStyle = `hsl(190, 22%, ${15 + n * 3}%)`; g.fillRect(X, Y, S, S); break;
        case '~': g.fillStyle = 'hsl(200, 40%, 9%)'; g.fillRect(X, Y, S, S); break;
        case '+': g.fillStyle = `hsl(210, 8%, ${14 + n * 3}%)`; g.fillRect(X, Y, S, S);
          g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(X + S * 0.55, Y + S * 0.62, S * 0.42, S * 0.3, 0, 0, TAU); g.fill();
          g.fillStyle = `hsl(205, 7%, ${36 + n * 6}%)`; g.beginPath(); g.arc(X + S / 2, Y + S * 0.42, S * 0.38, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.arc(X + S * 0.42, Y + S * 0.34, S * 0.18, 0, TAU); g.fill();
          break;
        case '#': {
          const below = L.tile(x, y + 1);
          const open = below !== '#' && below !== ' ';
          g.fillStyle = `hsl(210, 10%, ${open ? 11 : 9}%)`; g.fillRect(X, Y, S, S);
          g.fillStyle = `hsl(210, 9%, ${24 + n * 6}%)`; g.fillRect(X, Y, S, S * (open ? 0.55 : 1));
          g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5; g.strokeRect(X + 0.75, Y + 0.75, S - 1.5, S * (open ? 0.55 : 1) - 1.5);
          break;
        }
      }
      // wall shadow on the tile below a wall face
      if (ch !== '#' && ch !== ' ' && L.tile(x, y - 1) === '#') { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(X, Y, S, S * 0.25); }
    }
    this.chunks.set(key, c);
    if (this.chunks.size > 48) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  private drawTiles(w: World) {
    const ctx = this.ctx, L = w.level, S = this.scale;
    const x0 = Math.floor(this.cam.x - this.w / 2 / S) - 1, x1 = Math.ceil(this.cam.x + this.w / 2 / S) + 1;
    const y0 = Math.floor(this.cam.y - this.h / 2 / S) - 1, y1 = Math.ceil(this.cam.y + this.h / 2 / S) + 2;
    const tpx = Math.min(64, Math.max(24, Math.round((this.h / VIEW_H) * this.dpr / 16) * 16));
    if (tpx !== this.chunkTpx) { this.chunks.clear(); this.chunkTpx = tpx; }
    const CH = 8;
    for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++) {
      if (cx < 0 || cy < 0 || cx * CH >= L.w || cy * CH >= L.h) continue;
      const c = this.chunk(w, cx, cy, tpx);
      ctx.drawImage(c, Math.floor(this.sx(cx * CH)), Math.floor(this.sy(cy * CH)), Math.ceil(CH * S) + 1, Math.ceil(CH * S) + 1);
    }
    // animated water highlights (cheap: a few strokes on a subset of tiles)
    const t = this.time;
    ctx.fillStyle = 'rgba(170,220,235,0.08)';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = L.tile(x, y);
      if (c !== ',' && c !== '~') continue;
      const n = hash(x, y);
      if (n > 0.35) continue;
      const sv = Math.sin(t * 1.2 + x * 0.9 + y * 1.7 + n * 6);
      if (sv < 0.4) continue;
      ctx.fillRect(this.sx(x) + S * 0.1, this.sy(y) + S * (0.3 + n), S * 0.6 * sv, Math.max(1, S * 0.05));
    }
    // gates
    for (const g of L.data.gates) {
      const closed = L.isGateClosed(g.cells[0][0], g.cells[0][1]);
      for (const [gx, gy] of g.cells) {
        const X = this.sx(gx), Y = this.sy(gy);
        if (closed) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(X, Y, S, S);
          ctx.strokeStyle = g.kind === 'arena' ? '#8a6a4a' : '#5d6670'; ctx.lineWidth = Math.max(2, S * 0.09);
          for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(X + (S * i) / 4, Y); ctx.lineTo(X + (S * i) / 4, Y + S); ctx.stroke(); }
          ctx.beginPath(); ctx.moveTo(X, Y + S * 0.3); ctx.lineTo(X + S, Y + S * 0.3); ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(120,130,140,0.08)'; ctx.fillRect(X, Y, S, Math.max(2, S * 0.1));
        }
      }
    }
  }

  private drawProps(w: World) {
    const ctx = this.ctx, S = this.scale;
    const t = this.time;
    for (const m of w.level.data.markers) {
      const X = this.sx(m.x), Y = this.sy(m.y);
      if (X < -S * 3 || X > this.w + S * 3 || Y < -S * 3 || Y > this.h + S * 3) continue;
      if (m.type === 'cairn') {
        const lit = w.progress.cairn === m.id;
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, S * 2.6);
        g.addColorStop(0, lit ? 'rgba(120,200,255,0.28)' : 'rgba(120,170,200,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(X - S * 3, Y - S * 3, S * 6, S * 6);
        ctx.fillStyle = '#4e5660';
        for (const [dx, dy, r] of [[-0.25, 0.15, 0.32], [0.25, 0.15, 0.3], [0, -0.1, 0.27], [0, -0.38, 0.18]] as const) { ctx.beginPath(); ctx.ellipse(X + dx * S, Y + dy * S, r * S, r * S * 0.8, 0, 0, TAU); ctx.fill(); }
        const fl = 0.5 + 0.5 * Math.sin(t * 6 + m.x);
        ctx.fillStyle = lit ? `rgba(170,225,255,${0.7 + fl * 0.3})` : 'rgba(150,180,200,0.35)';
        ctx.beginPath(); ctx.ellipse(X, Y - S * 0.62, S * 0.09, S * (0.18 + fl * 0.05), 0, 0, TAU); ctx.fill();
      } else if (m.type === 'item' && !w.progress.items.includes(m.id)) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3);
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, S * 1.2);
        g.addColorStop(0, `rgba(255,240,210,${0.35 + pulse * 0.25})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(X - S * 1.3, Y - S * 1.3, S * 2.6, S * 2.6);
        ctx.fillStyle = '#efe2c8'; ctx.beginPath(); ctx.ellipse(X, Y, S * 0.16, S * 0.22, 0.3, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8b7a5c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X - S * 0.05, Y - S * 0.16); ctx.lineTo(X + S * 0.05, Y + S * 0.16); ctx.stroke();
      } else if (m.type === 'note') {
        ctx.fillStyle = '#3a4048'; ctx.fillRect(X - S * 0.3, Y - S * 0.45, S * 0.6, S * 0.7);
        ctx.fillStyle = 'rgba(200,220,230,0.25)';
        for (let i = 0; i < 3; i++) ctx.fillRect(X - S * 0.2, Y - S * 0.3 + i * S * 0.17, S * 0.4, Math.max(1, S * 0.04));
      } else if (m.type === 'lever') {
        const open = w.progress.opened.length > 0;
        ctx.strokeStyle = '#7a6a55'; ctx.lineWidth = Math.max(2, S * 0.08);
        ctx.beginPath(); ctx.arc(X, Y, S * 0.35, 0, TAU); ctx.stroke();
        const a = open ? 1.2 : t * 0.0;
        for (let i = 0; i < 4; i++) { const aa = a + (i * Math.PI) / 2; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(aa) * S * 0.35, Y + Math.sin(aa) * S * 0.35); ctx.stroke(); }
        if (!open) { ctx.fillStyle = `rgba(255,220,170,${0.2 + 0.2 * Math.sin(t * 3)})`; ctx.beginPath(); ctx.arc(X, Y, S * 0.55, 0, TAU); ctx.fill(); }
      } else if (m.type === 'ending') {
        const done = w.progress.defeated.includes('boss3');
        ctx.fillStyle = '#5a6068'; ctx.beginPath(); ctx.ellipse(X, Y, S * 0.9, S * 0.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = done ? `rgba(200,235,255,${0.5 + 0.3 * Math.sin(t * 2)})` : '#1c3540';
        ctx.beginPath(); ctx.ellipse(X, Y, S * 0.65, S * 0.4, 0, 0, TAU); ctx.fill();
      }
    }
  }

  private drawMarker(w: World, e: Enemy) {
    if (!e.leapTarget || !e.airborne) return;
    const ctx = this.ctx, S = this.scale;
    const st = e.curStep!;
    const r = (st.hit as any).r as number;
    const X = this.sx(e.leapTarget.x), Y = this.sy(e.leapTarget.y);
    const locked = e.leapLocked;
    ctx.fillStyle = locked ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(X, Y, r * S, r * S * 0.9, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = locked ? 'rgba(160,230,255,0.9)' : 'rgba(120,180,200,0.35)';
    ctx.lineWidth = locked ? 3 : 1.5;
    ctx.beginPath(); ctx.ellipse(X, Y, r * S, r * S * 0.9, 0, 0, TAU); ctx.stroke();
    if (locked) {
      // contracting ring = countdown to the landing
      const W = ms2t(st.windup), L0 = ms2t(st.leap!.lockAt);
      const k = clamp((e.stepT - L0) / Math.max(1, W - L0), 0, 1);
      const rr = r * (1.9 - 0.9 * k);
      ctx.strokeStyle = `rgba(220,245,255,${0.4 + 0.5 * k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(X, Y, rr * S, rr * S * 0.9, 0, 0, TAU); ctx.stroke();
    } else {
      const k = (Math.sin(this.time * 10) + 1) / 2;
      ctx.strokeStyle = `rgba(120,180,200,${0.15 + 0.2 * k})`;
      ctx.beginPath(); ctx.ellipse(X, Y, r * S * 0.6, r * S * 0.54, 0, 0, TAU); ctx.stroke();
    }
  }

  private drawRing(r: World['rings'][number]) {
    const ctx = this.ctx, S = this.scale;
    const X = this.sx(r.x), Y = this.sy(r.y);
    const fade = clamp(1 - (r.r - r.maxR * 0.75) / (r.maxR * 0.25), 0, 1);
    ctx.lineWidth = r.width * S;
    ctx.strokeStyle = `rgba(90,170,200,${0.5 * fade})`;
    ctx.beginPath(); ctx.arc(X, Y, Math.max(0.1, r.r * S), 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(2, S * 0.08);
    ctx.strokeStyle = `rgba(230,250,255,${0.9 * fade})`;
    ctx.beginPath(); ctx.arc(X, Y, Math.max(0.1, (r.r + r.width / 2) * S), 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(180,230,245,${0.4 * fade})`;
    ctx.beginPath(); ctx.arc(X, Y, Math.max(0.1, (r.r - r.width / 2) * S), 0, TAU); ctx.stroke();
  }

  private drawProjectile(p: World['projectiles'][number]) {
    const ctx = this.ctx, S = this.scale;
    const X = this.sx(p.x), Y = this.sy(p.y);
    if (p.kind === 'wick') {
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, p.r * S * 3);
      g.addColorStop(0, 'rgba(255,230,160,0.9)'); g.addColorStop(0.35, 'rgba(255,150,60,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, p.r * S * 3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.arc(X, Y, p.r * S, 0, TAU); ctx.fill();
      if (Math.random() < 0.5) this.particles.push({ x: p.x, y: p.y, vx: 0, vy: -0.5, life: 0.3, max: 0.3, size: 0.07, color: '#ffb060', kind: 'mote' });
    } else {
      // net: a spinning mesh
      ctx.save(); ctx.translate(X, Y); ctx.rotate(this.time * 6);
      ctx.strokeStyle = 'rgba(210,200,170,0.9)'; ctx.lineWidth = 1.5;
      const R = p.r * S;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * R * 0.4, -R); ctx.lineTo(i * R * 0.4, R); ctx.moveTo(-R, i * R * 0.4); ctx.lineTo(R, i * R * 0.4); ctx.stroke(); }
      ctx.restore();
    }
  }

  // ======================================================================== characters
  private drawShadow(X: number, Y: number, r: number) {
    const ctx = this.ctx, S = this.scale;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(X, Y + r * S * 0.35, r * S * 1.05, r * S * 0.6, 0, 0, TAU); ctx.fill();
  }

  private drawPlayer(w: World, p: Player, pos: Vec) {
    const ctx = this.ctx, S = this.scale;
    let X = this.sx(pos.x), Y = this.sy(pos.y);
    const r = PLAYER.radius;
    if (!p.alive) {
      const k = Math.min(1, p.t / 60);
      ctx.globalAlpha = 1 - k * 0.7;
      this.drawShadow(X, Y, r);
      ctx.fillStyle = '#2b333c'; ctx.beginPath(); ctx.ellipse(X, Y, r * S * 1.2, r * S * 0.6, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; return;
    }
    const f = p.facing;
    // lantern light pool
    const lg = ctx.createRadialGradient(X, Y, 0, X, Y, S * 3.2);
    lg.addColorStop(0, 'rgba(255,190,110,0.16)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg; ctx.fillRect(X - S * 3.3, Y - S * 3.3, S * 6.6, S * 6.6);
    this.drawShadow(X, Y, r);
    const rolling = p.state === 'roll';
    if (rolling) {
      // afterimages + squash along the roll direction
      const inv = p.rollIFrames();
      for (let i = 1; i <= 3; i++) {
        ctx.fillStyle = inv ? `rgba(150,220,255,${0.18 / i})` : `rgba(120,140,160,${0.12 / i})`;
        ctx.beginPath(); ctx.arc(X - p.rollDx * i * S * 0.25, Y - p.rollDy * i * S * 0.25, r * S, 0, TAU); ctx.fill();
      }
    }
    const blink = p.invulnT > 0 && !rolling && Math.floor(this.time * 20) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.55;
    ctx.save(); ctx.translate(X, Y); ctx.rotate(f);
    if (rolling) { const k = Math.sin(Math.min(1, p.t / ms2t(PLAYER.rollMoveMs)) * Math.PI); ctx.scale(1 + 0.15 * k, 1 - 0.25 * k); }
    // sword
    let swordA = 0.9, swordL = 0.95;
    if (p.state === 'attack') {
      const a = PLAYER.attacks[p.combo];
      const st = ms2t(a.startup), ac = ms2t(a.active);
      const dir = p.combo === 1 ? -1 : 1;
      if (p.t <= st) swordA = lerp(0.9 * dir, 1.8 * dir, p.t / st);
      else if (p.t <= st + ac) swordA = lerp(1.8 * dir, -1.4 * dir, (p.t - st) / ac);
      else swordA = -1.4 * dir;
      if (p.combo === 2) { swordL = 1.2; }
    } else if (p.state === 'heal') swordA = 2.4;
    else if (rolling) swordA = 2.6;
    ctx.strokeStyle = '#d8dde2'; ctx.lineWidth = Math.max(2, S * 0.07); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(Math.cos(swordA) * r * S * 0.5, Math.sin(swordA) * r * S * 0.5); ctx.lineTo(Math.cos(swordA) * (r + swordL) * S, Math.sin(swordA) * (r + swordL) * S); ctx.stroke();
    // cloak
    ctx.fillStyle = '#3a4653'; ctx.beginPath(); ctx.arc(0, 0, r * S, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a333d'; ctx.beginPath(); ctx.arc(-r * S * 0.25, 0, r * S * 0.75, 0, TAU); ctx.fill();
    // hood
    ctx.fillStyle = '#4a5866'; ctx.beginPath(); ctx.ellipse(r * S * 0.18, 0, r * S * 0.55, r * S * 0.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#11161b'; ctx.beginPath(); ctx.ellipse(r * S * 0.45, 0, r * S * 0.22, r * S * 0.28, 0, 0, TAU); ctx.fill();
    // lantern (amber: the one warm thing on the island)
    ctx.fillStyle = '#ffc070'; ctx.beginPath(); ctx.arc(-r * S * 0.1, r * S * 0.78, Math.max(2, r * S * 0.2), 0, TAU); ctx.fill();
    if (p.state === 'heal') {
      ctx.fillStyle = 'rgba(140,240,200,0.8)'; ctx.beginPath(); ctx.arc(r * S * 0.6, -r * S * 0.3, r * S * 0.25, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // primed riposte glow
    if (w.tick <= p.slipUntil) {
      ctx.strokeStyle = `rgba(150,230,255,${0.5 + 0.4 * Math.sin(this.time * 18)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X, Y, r * S * 1.6, 0, TAU); ctx.stroke();
    }
    // swing trail = the actual hit arc
    if (p.state === 'attack') {
      const a = PLAYER.attacks[p.combo];
      const st = ms2t(a.startup), ac = ms2t(a.active);
      if (p.t > st && p.t <= st + ac + 4) {
        const k = 1 - Math.max(0, p.t - st - ac) / 5;
        this.fillShape(p.swingShape(), { x: pos.x, y: pos.y, facing: f }, p.riposteSwing ? `rgba(160,235,255,${0.45 * k})` : `rgba(255,235,200,${0.28 * k})`, p.riposteSwing ? `rgba(220,250,255,${0.9 * k})` : `rgba(255,245,225,${0.6 * k})`);
      }
    }
    void X; void Y;
    X = 0; Y = 0;
  }

  private fillShape(shape: HitShape, at: { x: number; y: number; facing: number }, fill: string, stroke?: string) {
    const ctx = this.ctx;
    const pts = shapePolygon(shape, at, 24);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(this.sx(p.x), this.sy(p.y)) : ctx.moveTo(this.sx(p.x), this.sy(p.y))));
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  private weaponAngle(e: Enemy): { a: number; ext: number; raise: number; tremble: number; crouch: number; glow: number } {
    const st = e.curStep;
    const out = { a: 0.7, ext: 1, raise: 0, tremble: 0, crouch: 0, glow: 0 };
    if (!st || e.state !== 'attack') {
      if (e.state === 'flinch') out.a = 1.6;
      if (e.state === 'broken') { out.a = 2.2; out.crouch = 0.5; }
      if (e.state === 'roar') { out.raise = 1; out.tremble = 1; }
      return out;
    }
    const W = ms2t(st.windup), A = ms2t(st.active);
    const t = e.stepT;
    const pw = clamp(t / Math.max(1, W), 0, 1);
    const pa = clamp((t - W) / Math.max(1, A), 0, 1);
    const inAct = t >= W;
    const ease = (x: number) => 1 - (1 - x) * (1 - x);
    out.glow = inAct ? 0 : pw;
    switch (st.pose) {
      case 'sweepR': case 'sweepShell': out.a = inAct ? lerp(2.1, -1.5, pa) : lerp(0.7, 2.1, ease(pw)); break;
      case 'sweepL': out.a = inAct ? lerp(-2.1, 1.5, pa) : lerp(0.7, -2.1, ease(pw)); break;
      case 'swipe': out.a = inAct ? lerp(1.9, -1.2, pa) : lerp(0.7, 1.9, ease(pw)); out.ext = 0.7; break;
      case 'overhead': case 'slamShell': out.a = inAct ? 0 : lerp(0.7, Math.PI, ease(pw)); out.raise = inAct ? 0 : ease(pw); break;
      case 'overheadHold': case 'hymn': out.a = inAct ? 0 : lerp(0.7, Math.PI, ease(Math.min(1, pw * 2.5))); out.raise = inAct ? 0 : 1; out.tremble = inAct ? 0 : 0.6 + pw; break;
      case 'thrust': out.a = 0; out.ext = inAct ? 1.25 : lerp(1, 0.45, ease(pw)); break;
      case 'charge': out.a = 0.25; out.ext = 0.6; out.crouch = inAct ? 0 : ease(pw) * 0.6; break;
      case 'throw': out.a = inAct ? 0 : t * 0.6; break;
      case 'pounce': case 'bite': out.a = 0; out.crouch = inAct ? 0 : ease(pw); break;
      case 'stomp': out.raise = inAct ? 0 : ease(pw) * 0.6; break;
      case 'wave': case 'burst': out.raise = inAct ? 0 : ease(pw); out.a = Math.PI / 2; break;
      case 'cast': out.glow = pw * 1.5; break;
      case 'dive': out.crouch = ease(Math.min(1, pw * 3)); break;
      case 'blink': out.a = inAct ? lerp(1.8, -1.4, pa) : 1.8; break;
      case 'evade': out.a = 1.0; break;
    }
    return out;
  }

  private drawEnemy(w: World, e: Enemy, pos: Vec) {
    const ctx = this.ctx, S = this.scale;
    const r = e.def.radius;
    const X = this.sx(pos.x), Y = this.sy(pos.y);
    if (X < -S * 6 || X > this.w + S * 6 || Y < -S * 6 || Y > this.h + S * 6) return;
    if (e.state === 'dormant' && e.boss) {
      // dormant boss: a dim silhouette, so the arena already feels occupied
      ctx.globalAlpha = 0.5; this.drawBody(e, X, Y, r, { a: 0.7, ext: 1, raise: 0, tremble: 0, crouch: 0.3, glow: 0 }); ctx.globalAlpha = 1; return;
    }
    if (!e.alive()) {
      const k = Math.min(1, e.deadT / (e.boss ? 150 : 50));
      if (k >= 1) return;
      ctx.globalAlpha = 1 - k;
      this.drawBody(e, X, Y + k * S * 0.3, r * (1 - k * 0.3), { a: 1.8, ext: 1, raise: 0, tremble: 0, crouch: k, glow: 0 });
      ctx.globalAlpha = 1;
      if (Math.random() < (e.boss ? 0.9 : 0.4)) this.particles.push({ x: e.x + (Math.random() - 0.5) * r * 2, y: e.y + (Math.random() - 0.5) * r, vx: 0, vy: -1.2, life: 0.8, max: 0.8, size: 0.06 + Math.random() * 0.06, color: '#bfe8f0', kind: 'mote' });
      return;
    }
    if (e.airborne) {
      // under the water: only ripples where she went down
      ctx.strokeStyle = 'rgba(150,210,230,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X, Y, r * S * (0.6 + 0.3 * Math.sin(this.time * 4)), 0, TAU); ctx.stroke();
      return;
    }
    const pose = this.weaponAngle(e);
    this.drawShadow(X, Y, r);
    // active hitbox: drawn from the exact shape that is being tested
    const st = e.curStep;
    const ph = e.stepPhase();
    if (st?.hit && (ph === 'active' || (ph === 'after' && e.stepT < ms2t(st.windup) + ms2t(st.active) + 5)) && e.activePlace) {
      const k = ph === 'active' ? 1 : 0.5;
      this.fillShape(st.hit, { x: e.x, y: e.y, facing: e.facing }, `rgba(255,225,205,${0.32 * k})`, `rgba(255,250,240,${0.85 * k})`);
    }
    // a small, consistent glow that grows through every wind-up (all enemies, all attacks)
    if (ph === 'windup' && pose.glow > 0) {
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, r * S * 2.2);
      g.addColorStop(0, `rgba(255,240,220,${0.10 + 0.12 * pose.glow})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r * S * 2.2, 0, TAU); ctx.fill();
    }
    let jx = 0, jy = 0;
    if (pose.tremble) { jx = Math.sin(this.time * 55) * pose.tremble * S * 0.025; jy = Math.cos(this.time * 47) * pose.tremble * S * 0.025; }
    this.drawBody(e, X + jx, Y + jy, r, pose);
    // tell flash: a bright glint at the start of every attack (fades over 180 ms)
    const tf = this.tellFlash.get(e.uid);
    if (tf !== undefined) {
      const age = (performance.now() - tf) / 180;
      if (age < 1) {
        const big = e.boss ? 1.6 : 1;
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - age)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(X, Y, (r + 0.25 + age * 0.6 * big) * S, 0, TAU); ctx.stroke();
        const wa = e.facing + pose.a, wl = (r + 1.0 * big) * S;
        const gx = X + Math.cos(wa) * wl, gy = Y + Math.sin(wa) * wl;
        ctx.fillStyle = `rgba(255,255,255,${1 - age})`;
        const sz = S * 0.28 * big * (1 - age * 0.5);
        ctx.beginPath(); ctx.moveTo(gx - sz, gy); ctx.lineTo(gx, gy - sz * 0.25); ctx.lineTo(gx + sz, gy); ctx.lineTo(gx, gy + sz * 0.25); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(gx, gy - sz); ctx.lineTo(gx + sz * 0.25, gy); ctx.lineTo(gx, gy + sz); ctx.lineTo(gx - sz * 0.25, gy); ctx.closePath(); ctx.fill();
      }
    }
    // Cantor's held note: a halo that contracts and vanishes exactly on the strike
    if (st && st.pose === 'hymn' && ph === 'windup') {
      const k = e.stepT / ms2t(st.windup);
      ctx.strokeStyle = `rgba(230,240,255,${0.35 + 0.5 * k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X, Y - r * S * 0.2, r * S * (2.6 - 1.8 * k), 0, TAU); ctx.stroke();
    }
    if (st && st.pose === 'burst' && ph === 'windup') {
      const k = e.stepT / ms2t(st.windup);
      ctx.strokeStyle = `rgba(255,250,230,${0.25 + 0.5 * k})`; ctx.lineWidth = 1.5;
      const hr = (st.hit as any).r as number;
      ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(X, Y, hr * S * (1.4 - 0.4 * k), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    // health pip for regular enemies once hurt
    if (!e.boss && e.hp < e.def.hp) {
      const bw = r * S * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(X - bw / 2, Y - r * S - 12, bw, 4);
      ctx.fillStyle = '#c9b8a0'; ctx.fillRect(X - bw / 2, Y - r * S - 12, (bw * e.hp) / e.def.hp, 4);
    }
    if (e.state === 'broken') {
      ctx.fillStyle = `rgba(255,220,150,${0.5 + 0.4 * Math.sin(this.time * 12)})`;
      for (let i = 0; i < 3; i++) { const a = this.time * 3 + (i * TAU) / 3; ctx.beginPath(); ctx.arc(X + Math.cos(a) * r * S * 0.8, Y - r * S * 1.1 + Math.sin(a) * r * S * 0.25, 3, 0, TAU); ctx.fill(); }
    }
  }

  private drawBody(e: Enemy, X: number, Y: number, r: number, pose: ReturnType<Renderer['weaponAngle']>) {
    const ctx = this.ctx, S = this.scale;
    const R = r * S;
    const hurt = e.hurtFlash > 0;
    ctx.save(); ctx.translate(X, Y); ctx.rotate(e.facing);
    const sc = 1 - pose.crouch * 0.18;
    ctx.scale(sc, sc);
    const weapon = (len: number, width: number, color: string, tip?: (x: number, y: number) => void) => {
      const a = pose.a;
      const L = len * pose.ext * (1 - pose.raise * 0.35);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, width * S * (1 + pose.raise * 0.5)); ctx.lineCap = 'round';
      const x1 = Math.cos(a) * R * 0.6, y1 = Math.sin(a) * R * 0.6;
      const x2 = Math.cos(a) * (R + L * S), y2 = Math.sin(a) * (R + L * S);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (pose.raise > 0.3) { ctx.fillStyle = `rgba(255,255,255,${0.15 * pose.raise})`; ctx.beginPath(); ctx.arc(x2, y2, S * 0.35 * pose.raise, 0, TAU); ctx.fill(); }
      tip?.(x2, y2);
    };
    const body = (c: string) => { ctx.fillStyle = hurt ? '#ffffff' : c; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill(); };
    switch (e.def.kind) {
      case 'novice':
        weapon(0.55, 0.06, '#c8d2c8');
        body('#56685f');
        ctx.fillStyle = hurt ? '#fff' : '#3c4a44'; ctx.beginPath(); ctx.arc(-R * 0.25, 0, R * 0.7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c9d3cc'; ctx.beginPath(); ctx.arc(R * 0.35, 0, R * 0.35, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1a2220'; ctx.fillRect(R * 0.48, -R * 0.15, R * 0.12, R * 0.08); ctx.fillRect(R * 0.48, R * 0.07, R * 0.12, R * 0.08);
        break;
      case 'hook':
        weapon(1.9, 0.07, '#9a8a70', (x, y) => { ctx.strokeStyle = '#c9b9a0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, S * 0.18, 0, Math.PI); ctx.stroke(); });
        body('#6e5242');
        ctx.fillStyle = hurt ? '#fff' : '#4d392e'; ctx.beginPath(); ctx.arc(-R * 0.2, 0, R * 0.75, 0, TAU); ctx.fill();
        ctx.fillStyle = '#b9ad98'; ctx.beginPath(); ctx.arc(R * 0.35, 0, R * 0.33, 0, TAU); ctx.fill();
        break;
      case 'hound':
        body('#2e4746');
        ctx.fillStyle = hurt ? '#fff' : '#2e4746'; ctx.beginPath(); ctx.ellipse(R * 0.7, 0, R * 0.55, R * 0.4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9ff0e0'; ctx.beginPath(); ctx.arc(R * 0.95, -R * 0.18, R * 0.09, 0, TAU); ctx.arc(R * 0.95, R * 0.18, R * 0.09, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#1a2a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(-R * 1.6, Math.sin(this.time * 9) * R * 0.3); ctx.stroke();
        break;
      case 'wick': {
        const k = pose.glow;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * (2.5 + k * 1.5));
        g.addColorStop(0, `rgba(255,220,140,${0.5 + k * 0.4})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * (2.5 + k * 1.5), 0, TAU); ctx.fill();
        ctx.fillStyle = hurt ? '#fff' : '#e8dcc4'; ctx.fillRect(-R * 0.3, -R * 0.2, R * 0.6, R * 0.9);
        ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.ellipse(0, -R * 0.4, R * 0.3 * (1 + k), R * 0.6 * (1 + k), 0, 0, TAU); ctx.fill();
        break;
      }
      case 'shell':
        weapon(1.4, 0.16, '#6f6a5c');
        body('#7f8272');
        ctx.fillStyle = hurt ? '#fff' : '#9a9c88';
        ctx.beginPath(); ctx.arc(R * 0.15, 0, R * 0.95, -1.3, 1.3); ctx.closePath(); ctx.fill(); // the shell faces forward
        ctx.strokeStyle = '#5a5c50'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(R * 0.15, 0, R * (0.4 + i * 0.2), -1.2, 1.2); ctx.stroke(); }
        break;
      case 'netwarden':
        weapon(2.4, 0.13, '#857560', (x, y) => { ctx.strokeStyle = '#d0c2a8'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, S * 0.35, -0.5, Math.PI + 0.5); ctx.stroke(); });
        body('#4a4038');
        ctx.fillStyle = hurt ? '#fff' : '#6b5f50'; // net over the back
        ctx.beginPath(); ctx.arc(-R * 0.3, 0, R * 0.8, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(30,25,20,0.6)'; ctx.lineWidth = 1;
        for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(-R * 0.3 + i * R * 0.2, -R * 0.8); ctx.lineTo(-R * 0.3 + i * R * 0.2, R * 0.8); ctx.stroke(); }
        ctx.fillStyle = '#b8ab92'; ctx.beginPath(); ctx.arc(R * 0.45, 0, R * 0.38, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a221c'; ctx.fillRect(R * 0.55, -R * 0.25, R * 0.25, R * 0.5);
        ctx.fillStyle = '#ffdca0'; ctx.fillRect(R * 0.62, -R * 0.15, R * 0.08, R * 0.08); ctx.fillRect(R * 0.62, R * 0.07, R * 0.08, R * 0.08);
        break;
      case 'cantor':
        weapon(1.6, 0.04, '#eef4ff');
        ctx.fillStyle = hurt ? '#fff' : '#cfd6de'; // long robe trailing
        ctx.beginPath(); ctx.ellipse(-R * 0.6, 0, R * 1.2, R * 0.75, 0, 0, TAU); ctx.fill();
        body('#e4e8ee');
        ctx.fillStyle = '#9aa4b2'; ctx.beginPath(); ctx.arc(R * 0.25, 0, R * 0.42, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1a1e26'; ctx.beginPath(); ctx.ellipse(R * 0.55, 0, R * 0.12, R * 0.22, 0, 0, TAU); ctx.fill(); // open mouth: always singing
        break;
      case 'abbess': {
        // arms are the weapon: two coral claws
        const a = pose.a;
        ctx.strokeStyle = '#a5715e'; ctx.lineWidth = Math.max(3, S * 0.22); ctx.lineCap = 'round';
        const L = (R + 2.4 * S * pose.ext) * (1 - pose.raise * 0.3);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(-a * 0.5 - 0.6) * R * 1.5, Math.sin(-a * 0.5 - 0.6) * R * 1.5); ctx.stroke();
        ctx.fillStyle = hurt ? '#fff' : '#1f4048';
        ctx.beginPath(); ctx.ellipse(-R * 0.2, 0, R * 1.25, R * 1.1, 0, 0, TAU); ctx.fill();
        body('#2b5560');
        ctx.fillStyle = '#d9cfc0'; ctx.beginPath(); ctx.arc(R * 0.3, 0, R * 0.36, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c4836c'; // coral crown
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(R * 0.1, i * R * 0.22, R * 0.13, 0, TAU); ctx.fill(); }
        if (pose.raise > 0) { ctx.strokeStyle = `rgba(170,230,250,${0.5 * pose.raise})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, R * (1.4 + pose.raise * 0.5), 0, TAU); ctx.stroke(); }
        break;
      }
    }
    ctx.restore();
  }

  // ======================================================================== fx
  private drawParticles(dt: number) {
    const ctx = this.ctx, S = this.scale;
    const out: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * 4; p.vy *= 1 - dt * 4;
      const k = p.life / p.max;
      const X = this.sx(p.x), Y = this.sy(p.y);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      if (p.kind === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2 + k * 2;
        ctx.beginPath(); ctx.arc(X, Y, (p.size + (1 - k) * (p.grow ?? 6) * p.max) * S, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(X, Y, Math.max(1, p.size * S * (p.kind === 'spark' ? k : 1)), 0, TAU); ctx.fill();
      }
      out.push(p);
    }
    ctx.globalAlpha = 1;
    this.particles = out.length > 400 ? out.slice(out.length - 400) : out;
  }

  private drawLighting(w: World, pp: Vec) {
    const ctx = this.ctx;
    const X = this.sx(pp.x), Y = this.sy(pp.y);
    const R = Math.max(this.w, this.h) * 0.75;
    const g = ctx.createRadialGradient(X, Y, this.scale * 2.5, X, Y, R);
    g.addColorStop(0, 'rgba(4,6,10,0)'); g.addColorStop(0.6, 'rgba(4,6,10,0.35)'); g.addColorStop(1, 'rgba(4,6,10,0.75)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
    void w;
  }

  private drawOffscreen(w: World) {
    const ctx = this.ctx;
    for (const e of w.enemies) {
      if (!e.alive() || !e.aggro || e.state === 'return') continue;
      const X = this.sx(e.x), Y = this.sy(e.y);
      if (X > 0 && X < this.w && Y > 0 && Y < this.h) continue;
      const cx = this.w / 2, cy = this.h / 2;
      const a = Math.atan2(Y - cy, X - cx);
      const m = 26;
      const ex = clamp(cx + Math.cos(a) * this.w, m, this.w - m), ey = clamp(cy + Math.sin(a) * this.h, m + 20, this.h - m);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = e.state === 'attack' ? 'rgba(255,255,255,0.9)' : 'rgba(220,200,180,0.55)';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ======================================================================== HUD
  private drawHud(w: World, hud: HudState, dt: number) {
    const ctx = this.ctx, p = w.player;
    const sf = (window as any).__safe ?? { l: 0, r: 0, t: 0, b: 0 };
    const x = sf.l + 14, y = sf.t + 12;
    const bw = Math.min(250, this.w * 0.28);
    hud.hpShown = p.hp;
    hud.hpLag = hud.hpLag > p.hp ? Math.max(p.hp, hud.hpLag - dt * 40) : p.hp;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 2, y - 2, bw + 4, 13);
    ctx.fillStyle = 'rgba(255,240,220,0.55)'; ctx.fillRect(x, y, (bw * hud.hpLag) / PLAYER.maxHp, 9);
    ctx.fillStyle = p.hp < 30 ? '#e0503e' : '#b8453a'; ctx.fillRect(x, y, (bw * p.hp) / PLAYER.maxHp, 9);
    const sw = bw * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 2, y + 14, sw + 4, 9);
    const exhausted = p.stamina < PLAYER.rollCost;
    ctx.fillStyle = exhausted ? '#c7b15a' : '#8fbf8a'; ctx.fillRect(x, y + 16, (sw * p.stamina) / PLAYER.maxStamina, 5);
    // roll-cost tick
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + (sw * PLAYER.rollCost) / PLAYER.maxStamina, y + 15, 1, 7);
    // boss bar
    if (w.fight && w.fight.boss.alive() && w.fight.boss.state !== 'dormant') {
      const b = w.fight.boss;
      const BW = Math.min(440, this.w * 0.44), bx = (this.w - BW) / 2, by = sf.t + 30;
      hud.bossLag = hud.bossLag > b.hp ? Math.max(b.hp, hud.bossLag - dt * b.def.hp * 0.25) : b.hp;
      ctx.font = '600 13px Georgia, "Times New Roman", serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#d9d2c4'; ctx.fillText(b.def.name.toUpperCase(), this.w / 2, by - 7);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 2, by - 2, BW + 4, 11);
      ctx.fillStyle = 'rgba(255,240,220,0.5)'; ctx.fillRect(bx, by, (BW * hud.bossLag) / b.def.hp, 7);
      ctx.fillStyle = '#9c3d33'; ctx.fillRect(bx, by, (BW * b.hp) / b.def.hp, 7);
      if (b.def.phase2At) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx + BW * b.def.phase2At, by, 2, 7); }
      if (b.def.staggerMax) {
        const k = b.state === 'broken' ? 1 : b.stagger / b.def.staggerMax;
        ctx.fillStyle = b.state === 'broken' ? '#ffd890' : 'rgba(230,190,120,0.75)';
        ctx.fillRect(this.w / 2 - (BW * 0.5 * k), by + 10, BW * k, 2);
      }
    } else hud.bossLag = 0;
  }

  private icon(id: string, x: number, y: number, r: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(2, r * 0.11); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (id === 'attack') {
      ctx.beginPath(); ctx.moveTo(x - r * 0.38, y + r * 0.38); ctx.lineTo(x + r * 0.42, y - r * 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 0.48, y + r * 0.12); ctx.lineTo(x - r * 0.12, y + r * 0.48); ctx.stroke();
    } else if (id === 'dodge') {
      ctx.beginPath(); ctx.arc(x - r * 0.05, y + r * 0.05, r * 0.34, Math.PI * 0.9, Math.PI * 2.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + r * 0.42, y - r * 0.05); ctx.lineTo(x + r * 0.3, y + r * 0.22); ctx.lineTo(x + r * 0.12, y + r * 0.02); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.1, r * 0.26, r * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 0.08, y - r * 0.22); ctx.lineTo(x - r * 0.08, y - r * 0.38); ctx.lineTo(x + r * 0.08, y - r * 0.38); ctx.lineTo(x + r * 0.08, y - r * 0.22); ctx.stroke();
    }
  }

  private drawControls(w: World, c: Controls, hud: HudState) {
    const ctx = this.ctx;
    const now = performance.now();
    const p = w.player;
    for (const b of c.buttons) {
      const pressed = now - (c.pressedAt[b.id] ?? -1e9) < 120 || c.holdsButton(b.id);
      const rej = now - (c.rejectedAt[b.id] ?? -1e9) < 260;
      let usable = true;
      if (b.id === 'heal') usable = p.draughts > 0;
      else usable = p.stamina >= 1;
      const tut = (b.id === 'attack' && hud.tutorial.attack) || (b.id === 'dodge' && hud.tutorial.dodge) || (b.id === 'heal' && hud.tutorial.heal);
      ctx.fillStyle = rej ? 'rgba(200,60,50,0.45)' : pressed ? 'rgba(255,255,255,0.32)' : 'rgba(20,24,30,0.42)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = usable ? 'rgba(230,225,215,0.55)' : 'rgba(140,140,140,0.3)'; ctx.lineWidth = 2;
      ctx.stroke();
      if (tut) {
        const k = (Math.sin(now / 160) + 1) / 2;
        ctx.strokeStyle = `rgba(255,220,160,${0.4 + 0.5 * k})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 6 + k * 6, 0, TAU); ctx.stroke();
      }
      this.icon(b.id, b.x, b.y, b.r, usable ? 'rgba(240,235,225,0.9)' : 'rgba(160,160,160,0.5)');
      if (b.id === 'heal') {
        ctx.font = `700 ${Math.round(b.r * 0.5)}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = p.draughts > 0 ? '#9fe8c8' : '#887'; ctx.fillText(String(p.draughts), b.x + b.r * 0.62, b.y + b.r * 0.62);
        ctx.textBaseline = 'alphabetic';
      }
    }
    // stick
    const s = c.stick;
    if (s.active) {
      ctx.fillStyle = 'rgba(20,24,30,0.3)'; ctx.beginPath(); ctx.arc(s.ox, s.oy, c.stickRadius, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(230,225,215,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      const kx = s.ox + s.vx * c.stickRadius * 0.75, ky = s.oy + s.vy * c.stickRadius * 0.75;
      ctx.fillStyle = 'rgba(235,230,220,0.55)'; ctx.beginPath(); ctx.arc(kx, ky, c.stickRadius * 0.4, 0, TAU); ctx.fill();
    } else if (hud.tutorial.stick) {
      const sf = (window as any).__safe ?? { l: 0, b: 0 };
      const hx = sf.l + 110, hy = this.h - Math.max(sf.b, 6) - 100;
      const k = (now % 1600) / 1600;
      ctx.strokeStyle = 'rgba(230,225,215,0.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, c.stickRadius, 0, TAU); ctx.stroke();
      const a = Math.floor(now / 1600) * 1.3;
      ctx.fillStyle = 'rgba(255,220,160,0.6)';
      ctx.beginPath(); ctx.arc(hx + Math.cos(a) * c.stickRadius * 0.7 * Math.sin(k * Math.PI), hy + Math.sin(a) * c.stickRadius * 0.7 * Math.sin(k * Math.PI), c.stickRadius * 0.35, 0, TAU); ctx.fill();
    }
    // pause button
    const pr = c.pauseRect;
    ctx.fillStyle = 'rgba(20,24,30,0.45)'; ctx.beginPath(); ctx.arc(pr.x + pr.w / 2, pr.y + pr.h / 2, 21, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(230,225,215,0.8)';
    ctx.fillRect(pr.x + pr.w / 2 - 7, pr.y + pr.h / 2 - 8, 4, 16); ctx.fillRect(pr.x + pr.w / 2 + 3, pr.y + pr.h / 2 - 8, 4, 16);
  }

  private drawOverlays(hud: HudState, dt: number) {
    const ctx = this.ctx;
    if (hud.flashRed > 0) {
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.3, this.w / 2, this.h / 2, this.w * 0.7);
      g.addColorStop(0, 'rgba(120,0,0,0)'); g.addColorStop(1, `rgba(140,10,10,${hud.flashRed * 0.55})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
      hud.flashRed = Math.max(0, hud.flashRed - dt * 2.5);
    }
    if (hud.lowHp > 0) {
      const k = (Math.sin(this.time * 5) + 1) / 2 * hud.lowHp;
      ctx.strokeStyle = `rgba(160,20,20,${0.25 * k})`; ctx.lineWidth = 14; ctx.strokeRect(0, 0, this.w, this.h);
    }
    if (hud.flashWhite > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, hud.flashWhite)})`; ctx.fillRect(0, 0, this.w, this.h);
      hud.flashWhite = Math.max(0, hud.flashWhite - dt * 1.8);
    }
    const sf = (window as any).__safe ?? { t: 0 };
    if (hud.noteText && hud.noteAlpha > 0) {
      ctx.globalAlpha = Math.min(1, hud.noteAlpha);
      this.wrapText(hud.noteText, this.w / 2, sf.t + 70, Math.min(520, this.w * 0.62), 17, 'italic 15px Georgia, serif', '#d8d0c0');
      ctx.globalAlpha = 1;
    }
    if (hud.bossCard) {
      const c = hud.bossCard;
      const a = c.t < 0.4 ? c.t / 0.4 : c.t > 2.0 ? Math.max(0, 1 - (c.t - 2.0) / 0.5) : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, this.h * 0.62 - 40, this.w, 74);
      ctx.textAlign = 'center';
      ctx.font = '600 28px Georgia, serif'; ctx.fillStyle = '#efe6d4'; ctx.fillText(c.name.toUpperCase(), this.w / 2, this.h * 0.62);
      ctx.font = 'italic 14px Georgia, serif'; ctx.fillStyle = '#b0a898'; ctx.fillText(c.sub, this.w / 2, this.h * 0.62 + 22);
      ctx.globalAlpha = 1;
      c.t += dt;
      if (c.t > 2.6) hud.bossCard = null;
    }
    if (hud.centerText) {
      const c = hud.centerText;
      const a = c.t < 0.5 ? c.t / 0.5 : c.t > 3.2 ? Math.max(0, 1 - (c.t - 3.2) / 0.8) : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, this.h * 0.36 - 44, this.w, c.sub ? 86 : 64);
      ctx.textAlign = 'center';
      ctx.font = '600 32px Georgia, serif'; ctx.fillStyle = c.color ?? '#f3e6c4'; ctx.fillText(c.text, this.w / 2, this.h * 0.36);
      if (c.sub) { ctx.font = 'italic 15px Georgia, serif'; ctx.fillStyle = '#cfc6b4'; ctx.fillText(c.sub, this.w / 2, this.h * 0.36 + 26); }
      ctx.globalAlpha = 1;
      c.t += dt;
      if (c.t > 4) hud.centerText = null;
    }
  }

  wrapText(text: string, x: number, y: number, maxW: number, lh: number, font: string, color: string) {
    const ctx = this.ctx;
    ctx.font = font; ctx.textAlign = 'center';
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) {
      const t = cur ? cur + ' ' + wd : wd;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = t;
    }
    if (cur) lines.push(cur);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const bh = lines.length * lh + 16;
    ctx.fillRect(x - maxW / 2 - 14, y - lh - 2, maxW + 28, bh);
    ctx.fillStyle = color;
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  }
}

export { TICK_MS };
