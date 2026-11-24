import { DT, ms2t, PLAYER } from './constants';
import { ENEMY_DEFS, StepDef } from './defs';
import { Enemy } from './enemy';
import { ArenaDef, Level, Marker } from './level';
import { angleDiff, angleTo, dist, Vec } from './math';
import { Player } from './player';
import { Rng } from './rng';
import type { DeathCause, GameEvent, Input } from './types';

export interface Progress {
  cairn: string;
  defeated: string[];
  opened: string[]; // shortcut gates
  items: string[];
  deaths: number;
  bossDeaths: Record<string, number>;
  bossTries: Record<string, number>;
  playMs: number;
  ended: boolean;
}

export const newProgress = (): Progress => ({ cairn: 'c0', defeated: [], opened: [], items: [], deaths: 0, bossDeaths: {}, bossTries: {}, playMs: 0, ended: false });

export interface Ring { x: number; y: number; r: number; speed: number; maxR: number; width: number; damage: number; done: boolean; step: StepDef; source: string }
export interface Projectile { x: number; y: number; vx: number; vy: number; r: number; ttl: number; damage: number; root?: number; passed: boolean; step: StepDef; source: string; kind: string }

export interface WorldOptions { seed?: number; progress?: Progress; spawnRegular?: boolean }

export class World {
  level = new Level();
  rng: Rng;
  tick = 0;
  player = new Player();
  enemies: Enemy[] = [];
  rings: Ring[] = [];
  projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  progress: Progress;
  fight: { arena: ArenaDef; boss: Enemy; startTick: number } | null = null;
  deathCause: DeathCause | null = null;
  ended = false;
  private spawnRegular: boolean;
  private nearCairn: string | null = null;
  private nearNote: string | null = null;
  private seenBoss = new Set<string>();

  constructor(opts: WorldOptions = {}) {
    this.rng = new Rng(opts.seed ?? 1234);
    this.progress = opts.progress ?? newProgress();
    this.spawnRegular = opts.spawnRegular ?? true;
    this.player.maxDraughts = PLAYER.baseDraughts + this.progress.items.filter((i) => i.startsWith('cowrie')).length;
    this.setupGates();
    this.spawnAll();
    const c = this.cairnMarker(this.progress.cairn);
    this.player.reset(c.x, c.y + 1.2);
    if (this.progress.cairn === 'c0' && !this.progress.defeated.length && !this.progress.items.length) {
      const s = this.markers('player')[0];
      this.player.reset(s.x, s.y);
      this.player.facing = 0;
    }
    this.nearCairn = this.progress.cairn; // don't immediately re-rest on load
  }

  markers(type: Marker['type']) { return this.level.data.markers.filter((m) => m.type === type); }
  cairnMarker(id: string) { return this.level.data.markers.find((m) => m.type === 'cairn' && m.id === id)!; }
  emit(e: GameEvent) { this.events.push(e); }

  private setupGates() {
    for (const g of this.level.data.gates) {
      let closed = false;
      if (g.kind === 'exit') closed = !this.progress.defeated.includes(g.boss!);
      if (g.kind === 'shortcut') closed = !this.progress.opened.includes(g.id);
      this.level.setGate(g.cells, closed);
    }
  }

  private spawnAll() {
    this.enemies = [];
    for (const m of this.level.data.markers) {
      if (m.type === 'enemy' && this.spawnRegular) this.enemies.push(new Enemy(ENEMY_DEFS[m.kind!], m.x, m.y, m.id, m.sleeper));
      if (m.type === 'boss' && !this.progress.defeated.includes(m.id)) this.enemies.push(new Enemy(ENEMY_DEFS[m.kind!], m.x, m.y, m.id));
    }
  }

  /** Headless boss trial: player placed just inside the arena, nothing else spawned. */
  static bossTrial(bossKind: string, seed: number, progressOverride?: Partial<Progress>): World {
    const order = ['netwarden', 'cantor', 'abbess'];
    const idx = order.indexOf(bossKind);
    const pr = newProgress();
    pr.defeated = ['boss1', 'boss2', 'boss3'].slice(0, idx);
    Object.assign(pr, progressOverride ?? {});
    const w = new World({ seed, progress: pr, spawnRegular: false });
    const arena = w.level.data.arenas[idx];
    const gate = w.level.data.gates.find((g) => g.id === arena.gate)!;
    const gx = gate.cells.reduce((s, c) => s + c[0] + 0.5, 0) / gate.cells.length;
    const gy = gate.cells.reduce((s, c) => s + c[1] + 0.5, 0) / gate.cells.length;
    const a = Math.atan2(arena.cy - gy, arena.cx - gx);
    w.player.reset(gx + Math.cos(a) * 4, gy + Math.sin(a) * 4);
    w.player.facing = a;
    w.seenBoss.add(arena.boss); // skip long intro
    return w;
  }

  softTarget(): Enemy | null {
    if (this.fight && this.fight.boss.alive()) {
      const b = this.fight.boss;
      if (b.state !== 'dormant') return b;
    }
    let best: Enemy | null = null, bd = 7;
    for (const e of this.enemies) {
      if (!e.alive() || !e.aggro || e.state === 'return' || e.state === 'sleep') continue;
      const d = dist(e, this.player);
      if (d < bd && this.level.lineOfSight(this.player, e)) { bd = d; best = e; }
    }
    return best;
  }

  attackTarget(range: number): Enemy | null {
    let best: Enemy | null = null, bs = Infinity;
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.hittable()) continue;
      const d = dist(e, p) - e.def.radius;
      if (d > range) continue;
      const ad = Math.abs(angleDiff(p.facing, angleTo(p, e)));
      const score = d + ad * 1.2 + (e.boss ? -1 : 0);
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }

  insideArena(pt: Vec, margin = 0): boolean {
    const a = this.fight?.arena;
    if (!a) return true;
    return pt.x > a.x0 + margin && pt.x < a.x1 - margin && pt.y > a.y0 + margin && pt.y < a.y1 - margin;
  }

  clampToArena(pt: Vec, r: number): Vec {
    // find the nearest free spot to pt (spiral)
    if (this.level.circleFree(pt, r)) return pt;
    for (let rad = 0.3; rad < 5; rad += 0.3) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const q = { x: pt.x + Math.cos(a) * rad, y: pt.y + Math.sin(a) * rad };
        if (this.level.circleFree(q, r)) return q;
      }
    }
    return pt;
  }

  spawnRing(e: Enemy, s: StepDef) {
    const r = s.ring!;
    this.rings.push({ x: e.x, y: e.y, r: e.def.radius * 0.6, speed: r.speed, maxR: r.maxR, width: r.width, damage: s.damage, done: false, step: s, source: e.def.name });
    this.emit({ t: 'ring', x: e.x, y: e.y });
  }

  spawnProjectile(e: Enemy, s: StepDef) {
    const pr = s.projectile!;
    const a = e.facing;
    this.projectiles.push({
      x: e.x + Math.cos(a) * (e.def.radius + 0.2), y: e.y + Math.sin(a) * (e.def.radius + 0.2),
      vx: Math.cos(a) * pr.speed, vy: Math.sin(a) * pr.speed, r: pr.r, ttl: ms2t(pr.ttl), damage: s.damage, root: pr.root,
      passed: false, step: s, source: e.def.name, kind: e.def.kind,
    });
    this.emit({ t: 'projectile', x: e.x, y: e.y });
  }

  onPlayerDeath(cause: DeathCause) {
    this.deathCause = cause;
    this.progress.deaths++;
    if (this.fight) {
      const b = this.fight.arena.boss;
      this.progress.bossDeaths[b] = (this.progress.bossDeaths[b] ?? 0) + 1;
    }
    this.emit({ t: 'playerDeath', cause });
  }

  onBossDefeated(e: Enemy) {
    const f = this.fight;
    const id = e.markerId;
    if (!this.progress.defeated.includes(id)) this.progress.defeated.push(id);
    if (f) {
      this.openGate(f.arena.gate, true);
      this.openGate(f.arena.exit, true);
    }
    this.fight = null;
    this.rings = []; this.projectiles = [];
    this.emit({ t: 'bossDefeated', boss: id, kind: e.def.kind });
  }

  private openGate(id: string, open: boolean) {
    const g = this.level.data.gates.find((x) => x.id === id)!;
    this.level.setGate(g.cells, !open);
    this.emit({ t: 'gate', id, open });
  }

  /** Back to the last cairn: everything but defeated bosses and opened shortcuts resets. */
  respawn() {
    this.fight = null; this.rings = []; this.projectiles = []; this.deathCause = null;
    this.setupGates();
    this.spawnAll();
    const c = this.cairnMarker(this.progress.cairn);
    this.player.maxDraughts = PLAYER.baseDraughts + this.progress.items.filter((i) => i.startsWith('cowrie')).length;
    this.player.reset(c.x, c.y + 1.2);
    this.nearCairn = c.id;
  }

  step(input: Input) {
    this.events.length = 0;
    this.tick++;
    if (!this.player.alive) { this.player.step(this, input); this.stepEffects(); for (const e of this.enemies) e.step(this); return; }
    this.progress.playMs += 1000 / 60;
    this.player.step(this, input);
    for (const e of this.enemies) e.step(this);
    this.separate();
    this.stepEffects();
    this.triggers();
  }

  private stepEffects() {
    const p = this.player;
    for (const r of this.rings) {
      r.r += r.speed * DT;
      if (!r.done && p.alive) {
        const d = dist(r, p);
        if (Math.abs(d - r.r) <= r.width / 2 + p.radius) {
          const res = p.receiveHit(this, r.damage, r.source, r.step, r.x, r.y, 1.2);
          if (res !== 'ignored') r.done = true;
        }
      }
    }
    this.rings = this.rings.filter((r) => r.r < r.maxR);
    for (const pr of this.projectiles) {
      pr.x += pr.vx * DT; pr.y += pr.vy * DT; pr.ttl--;
      if (this.level.blocksSight(Math.floor(pr.x), Math.floor(pr.y)) || this.level.tile(Math.floor(pr.x), Math.floor(pr.y)) === '+') { pr.ttl = 0; continue; }
      if (!pr.passed && p.alive && dist(pr, p) <= pr.r + p.radius) {
        const res = p.receiveHit(this, pr.damage, pr.source, pr.step, pr.x - pr.vx, pr.y - pr.vy, 0.4, pr.root ? pr.root : PLAYER.hitstunMs);
        if (res === 'slip') pr.passed = true;
        else if (res === 'hit') pr.ttl = 0;
      }
    }
    this.projectiles = this.projectiles.filter((p2) => p2.ttl > 0);
  }

  /** Soft body separation. Heavier bodies push lighter ones. Airborne/dead bodies don't collide. */
  private separate() {
    const bodies: { o: { x: number; y: number }; r: number; m: number; floats?: boolean }[] = [];
    const p = this.player;
    if (p.alive) bodies.push({ o: p, r: p.radius, m: 1 });
    for (const e of this.enemies) if (e.alive() && !e.airborne && e.state !== 'dormant' && e.state !== 'sleep') bodies.push({ o: e, r: e.def.radius, m: e.def.mass, floats: e.def.floats });
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = b.o.x - a.o.x, dy = b.o.y - a.o.y;
      const d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d >= min || d < 1e-6) continue;
      const push = min - d, nx = dx / d, ny = dy / d;
      const wa = b.m / (a.m + b.m), wb = a.m / (a.m + b.m);
      a.o.x -= nx * push * wa; a.o.y -= ny * push * wa;
      b.o.x += nx * push * wb; b.o.y += ny * push * wb;
      this.level.collide(a.o, a.r, a.floats); this.level.collide(b.o, b.r, b.floats);
    }
  }

  private triggers() {
    const p = this.player;
    // cairns: resting heals + refills, sets the respawn point
    let inCairn: string | null = null;
    for (const c of this.markers('cairn')) {
      if (dist(c, p) < 1.3) inCairn = c.id;
    }
    if (inCairn && inCairn !== this.nearCairn && !this.fight) {
      const c = this.cairnMarker(inCairn);
      this.progress.cairn = c.id;
      p.hp = PLAYER.maxHp; p.draughts = p.maxDraughts; p.stamina = PLAYER.maxStamina;
      this.emit({ t: 'rest', cairn: c.id, name: c.name ?? '' });
    }
    if (inCairn) this.nearCairn = inCairn;
    else if (this.nearCairn && dist(this.cairnMarker(this.nearCairn), p) > 2.5) this.nearCairn = null;

    for (const it of this.markers('item')) {
      if (this.progress.items.includes(it.id) || dist(it, p) > 1.0) continue;
      this.progress.items.push(it.id);
      if (it.kind === 'cowrie') { p.maxDraughts++; p.draughts++; }
      this.emit({ t: 'item', id: it.id, kind: it.kind! });
    }
    let note: string | null = null;
    for (const n of this.markers('note')) if (dist(n, p) < 1.4) { note = n.id; if (this.nearNote !== n.id) this.emit({ t: 'note', id: n.id, text: n.text! }); }
    this.nearNote = note;

    for (const l of this.markers('lever')) {
      const g = this.level.data.gates.find((x) => x.kind === 'shortcut')!;
      if (!this.progress.opened.includes(g.id) && dist(l, p) < 1.1) {
        this.progress.opened.push(g.id);
        this.openGate(g.id, true);
        this.emit({ t: 'lever', id: l.id });
      }
    }
    // boss arenas
    if (!this.fight) {
      for (const a of this.level.data.arenas) {
        if (this.progress.defeated.includes(a.boss)) continue;
        if (p.x > a.x0 + 1.2 && p.x < a.x1 - 1.2 && p.y > a.y0 + 1.2 && p.y < a.y1 - 1.2) {
          const boss = this.enemies.find((e) => e.markerId === a.boss);
          if (!boss) continue;
          this.fight = { arena: a, boss, startTick: this.tick };
          this.openGate(a.gate, false);
          const first = !this.seenBoss.has(a.boss);
          this.seenBoss.add(a.boss);
          boss.wake(this);
          boss.state = 'intro'; boss.t = 0; boss.idleT = ms2t(first ? 2200 : 900);
          this.progress.bossTries[a.boss] = (this.progress.bossTries[a.boss] ?? 0) + 1;
          this.emit({ t: 'bossStart', boss: a.boss, kind: boss.def.kind, first });
        }
      }
    }
    // ending
    if (!this.ended && this.progress.defeated.includes('boss3')) {
      const e = this.markers('ending')[0];
      if (dist(e, p) < 1.6) { this.ended = true; this.progress.ended = true; this.emit({ t: 'ending' }); }
    }
  }
}
