import { ms2t, DT, inFairView } from './constants';
import { AttackDef, EnemyDef, StepDef } from './defs';
import { angleDiff, angleTo, dist, turnToward, Vec } from './math';
import { shapeHitsCircle } from './shapes';
import type { World } from './world';

export type EState = 'sleep' | 'idle' | 'attack' | 'flinch' | 'broken' | 'roar' | 'dead' | 'return' | 'dormant' | 'intro';

const FLINCH_T = ms2t(450);
const FLINCH_COOLDOWN_T = ms2t(1500);
const BROKEN_T = ms2t(2200);
const ROAR_T = ms2t(1100);

let UID = 1;

export class Enemy {
  uid = UID++;
  def: EnemyDef;
  markerId: string;
  x: number; y: number; facing = Math.PI / 2;
  home: Vec;
  hp: number;
  state: EState = 'idle';
  t = 0;
  attack: AttackDef | null = null;
  stepIdx = 0;
  stepT = 0;
  stepHitDone = false;
  airborne = false;
  leapTarget: Vec | null = null;
  leapLocked = false;
  idleT = 0; // ticks left before the next decision
  cooldowns = new Map<string, number>(); // attack id -> tick when usable
  lastAttackId = ''; repeat = 0;
  phase: 1 | 2 = 1;
  pendingPhase = false;
  stagger = 0; lastHurtTick = -9999;
  lastFlinchTick = -9999;
  recentHits: number[] = [];
  aggro = false;
  noSightT = 0;
  strafeDir = 1;
  deadT = 0;
  hurtFlash = 0;
  chargeStopped = false;
  path: Vec[] | null = null; pathT = 0;
  sleeper: boolean;
  /** for rendering: last placement when the step went active */
  activePlace: { x: number; y: number; facing: number } | null = null;

  constructor(def: EnemyDef, x: number, y: number, markerId: string, sleeper = false) {
    this.def = def; this.x = x; this.y = y; this.home = { x, y }; this.hp = def.hp; this.markerId = markerId;
    this.sleeper = sleeper;
    if (sleeper) this.state = 'sleep';
    if (def.boss) this.state = 'dormant';
  }

  get boss() { return !!this.def.boss; }
  get radius() { return this.def.radius; }
  get curStep(): StepDef | null { return this.attack ? this.attack.steps[this.stepIdx] : null; }
  alive() { return this.state !== 'dead'; }
  hittable() { return this.alive() && !this.airborne && this.state !== 'dormant' && this.state !== 'return'; }
  /** Phase within current step */
  stepPhase(): 'windup' | 'active' | 'after' | null {
    const s = this.curStep; if (!s || this.state !== 'attack') return null;
    if (this.stepT < ms2t(s.windup)) return 'windup';
    if (this.stepT < ms2t(s.windup) + ms2t(s.active)) return 'active';
    return 'after';
  }
  /** Is the enemy in a punishable recovery (last step's after-window)? */
  recovering(): boolean {
    if (this.state === 'broken' || this.state === 'flinch') return true;
    return this.state === 'attack' && this.attack !== null && this.stepIdx === this.attack.steps.length - 1 && this.stepPhase() === 'after';
  }

  wake(w: World) {
    if (this.state === 'sleep' || this.state === 'dormant') { this.state = 'idle'; this.t = 0; this.idleT = ms2t(this.boss ? 0 : 400); }
    this.aggro = true;
    void w;
  }

  takeHit(w: World, dmg: number, stag: number, riposte: boolean) {
    if (!this.hittable()) return;
    let guarded = false;
    if (this.def.frontGuard && !this.recovering()) {
      const toPlayer = angleTo(this, w.player);
      if (Math.abs(angleDiff(this.facing, toPlayer)) < (70 * Math.PI) / 180) { dmg *= this.def.frontGuard; guarded = true; }
    }
    if (this.state === 'broken') dmg *= 1.35;
    dmg = Math.round(dmg);
    this.hp -= dmg;
    this.hurtFlash = 6;
    this.lastHurtTick = w.tick;
    if (!this.aggro) this.wake(w);
    let broke = false;
    const killed = this.hp <= 0;
    if (killed) {
      this.hp = 0;
      this.die(w);
    } else if (this.boss) {
      this.recentHits.push(w.tick);
      if (this.state !== 'broken' && this.def.staggerMax) {
        this.stagger += stag;
        if (this.stagger >= this.def.staggerMax && !this.airborne) {
          this.stagger = 0; broke = true;
          this.endAttack(); this.state = 'broken'; this.t = 0;
          w.emit({ t: 'bossBroken', uid: this.uid });
        }
      }
      if (this.phase === 1 && this.def.phase2At && this.hp <= this.def.hp * this.def.phase2At) this.pendingPhase = true;
    } else if (this.def.flinch) {
      const armored = this.state === 'attack' && this.curStep?.armor;
      if (!armored && w.tick - this.lastFlinchTick >= FLINCH_COOLDOWN_T) {
        this.lastFlinchTick = w.tick;
        this.endAttack(); this.state = 'flinch'; this.t = 0;
      }
    }
    w.emit({ t: 'enemyHit', uid: this.uid, dmg, x: this.x, y: this.y, riposte, guarded, killed, boss: this.boss, broke });
  }

  private die(w: World) {
    this.endAttack();
    this.state = 'dead'; this.t = 0; this.airborne = false;
    w.emit({ t: 'enemyDie', uid: this.uid, kind: this.def.kind, x: this.x, y: this.y });
    if (this.boss) w.onBossDefeated(this);
  }

  private endAttack() {
    this.attack = null; this.stepIdx = 0; this.stepT = 0; this.airborne = false; this.leapTarget = null; this.activePlace = null;
  }

  step(w: World) {
    this.t++;
    if (this.hurtFlash > 0) this.hurtFlash--;
    if (this.stagger > 0 && w.tick - this.lastHurtTick > ms2t(2500)) this.stagger = Math.max(0, this.stagger - 12 * DT);
    const p = w.player;
    switch (this.state) {
      case 'dead': this.deadT++; return;
      case 'dormant': return;
      case 'sleep':
        if (p.alive && dist(this, p) < 4.5 && w.level.lineOfSight(this, p)) this.wake(w);
        return;
      case 'intro':
        this.facing = turnToward(this.facing, angleTo(this, p), 3 * DT);
        if (this.t >= this.idleT) { this.state = 'idle'; this.t = 0; this.idleT = ms2t(300); }
        return;
      case 'flinch':
        if (this.t >= FLINCH_T) this.toIdle(w, 0.5);
        return;
      case 'broken':
        if (this.t >= BROKEN_T) this.toIdle(w, 0.3);
        return;
      case 'roar':
        if (this.t >= ROAR_T) { this.toIdle(w, 0.2); }
        return;
      case 'return': {
        const d = dist(this, this.home);
        if (d < 0.3) { this.state = 'idle'; this.aggro = false; this.hp = this.def.hp; return; }
        this.moveToward(w, this.home, this.def.speed);
        if (p.alive && dist(this, p) < this.def.sight * 0.6 && w.level.lineOfSight(this, p)) this.state = 'idle';
        return;
      }
      case 'idle': this.thinkIdle(w); return;
      case 'attack': this.stepAttack(w); return;
    }
  }

  private toIdle(w: World, mult = 1) {
    const [a, b] = this.phase === 2 && this.def.idleMsP2 ? this.def.idleMsP2 : this.def.idleMs;
    this.endAttack();
    this.state = 'idle'; this.t = 0;
    this.idleT = Math.round(ms2t(w.rng.range(a, b)) * mult);
    if (this.pendingPhase && this.boss) {
      this.pendingPhase = false; this.phase = 2;
      this.state = 'roar'; this.t = 0;
      w.emit({ t: 'bossPhase', uid: this.uid });
    }
  }

  private thinkIdle(w: World) {
    const p = w.player;
    if (!p.alive) { this.facing = turnToward(this.facing, angleTo(this, p), 2 * DT); return; }
    const d = dist(this, p);
    const los = w.level.lineOfSight(this, p);
    if (!this.aggro) {
      if (d < this.def.sight && los) this.wake(w); else return;
    }
    if (!this.boss) {
      if (!los) this.noSightT++; else this.noSightT = 0;
      if (d > 16 || this.noSightT > ms2t(5000)) { this.state = 'return'; this.aggro = false; return; }
    }
    if (this.boss && this.pendingPhase) { this.toIdle(w); return; }
    // evade (boss) after several hits taken quickly
    if (this.def.evadeAfterHits) {
      this.recentHits = this.recentHits.filter((t) => w.tick - t < ms2t(2500));
      if (this.recentHits.length >= this.def.evadeAfterHits) {
        const ev = this.def.attacks.find((a) => a.evade);
        if (ev && (this.cooldowns.get(ev.id) ?? 0) <= w.tick) { this.recentHits = []; this.startAttack(w, ev); this.stepAttack(w); return; }
      }
    }
    const fair = inFairView(this.x - p.x, this.y - p.y);
    if (this.idleT > 0) this.idleT--;
    if (this.idleT <= 0 && fair && los) {
      const a = this.chooseAttack(w, d);
      if (a) { this.startAttack(w, a); this.stepAttack(w); return; }
    }
    // movement while waiting
    this.facing = turnToward(this.facing, angleTo(this, p), (this.boss ? 4 : 6) * DT);
    const pref = this.def.preferDist;
    let sp = this.def.speed;
    if (d > pref + 0.4 || !fair) {
      this.moveToward(w, p, sp);
    } else if (d < pref - 1.0 && (this.def.kind === 'wick' || this.def.kind === 'hook' || this.def.kind === 'hound')) {
      const a = angleTo(p, this);
      this.moveToward(w, { x: this.x + Math.cos(a), y: this.y + Math.sin(a) }, sp * 0.7);
    } else {
      // circle-strafe slowly
      if (w.rng.chance(0.006)) this.strafeDir *= -1;
      const a = angleTo(p, this) + this.strafeDir * 0.6;
      const tx = p.x + Math.cos(a) * pref, ty = p.y + Math.sin(a) * pref;
      this.moveToward(w, { x: tx, y: ty }, sp * 0.45);
    }
  }

  private chooseAttack(w: World, d: number): AttackDef | null {
    const valid = this.def.attacks.filter((a) =>
      !a.evade && d >= a.minRange && d <= a.maxRange && (a.phase === undefined || a.phase === this.phase) && (this.cooldowns.get(a.id) ?? 0) <= w.tick &&
      !(a.id === this.lastAttackId && this.repeat >= 2));
    if (!valid.length) return null;
    const hug = valid.filter((a) => a.antiHug);
    if (hug.length && w.rng.chance(0.55)) return hug[0];
    let total = 0;
    for (const a of valid) total += a.antiHug ? 0.5 : a.weight;
    let r = w.rng.next() * total;
    for (const a of valid) { r -= a.antiHug ? 0.5 : a.weight; if (r <= 0) return a; }
    return valid[valid.length - 1];
  }

  private startAttack(w: World, a: AttackDef) {
    this.state = 'attack'; this.t = 0;
    this.attack = a; this.stepIdx = 0; this.beginStep(w);
    if (a.id === this.lastAttackId) this.repeat++; else { this.lastAttackId = a.id; this.repeat = 1; }
    this.cooldowns.set(a.id, w.tick + ms2t(a.cooldown));
  }

  private beginStep(w: World) {
    this.stepT = 0; this.stepHitDone = false; this.chargeStopped = false; this.activePlace = null;
    const s = this.curStep!;
    this.leapTarget = null; this.leapLocked = false;
    w.emit({ t: 'tell', uid: this.uid, step: s, boss: this.boss, x: this.x, y: this.y });
  }

  private stepAttack(w: World) {
    const s = this.curStep!;
    const p = w.player;
    const W = ms2t(s.windup), A = ms2t(s.active), F = ms2t(s.after);
    const t = this.stepT;
    // tracking
    if (s.trackUntil !== undefined && t < ms2t(s.trackUntil) && t < W) {
      this.facing = turnToward(this.facing, angleTo(this, p), (s.turnRate ?? 4) * DT);
    }
    // lunge
    if (s.lunge) {
      const a = ms2t(s.lunge.from), b = ms2t(s.lunge.to);
      if (t >= a && t < b) {
        const per = s.lunge.dist / (b - a);
        this.translate(w, Math.cos(this.facing) * per, Math.sin(this.facing) * per);
      }
    }
    // blink: vanish and reappear beyond the player
    if (s.blink && t === ms2t(s.blink.at)) this.doBlink(w, s.blink.dist);
    // leap
    if (s.leap) {
      if (t === ms2t(s.leap.jumpAt)) { this.airborne = true; this.leapTarget = { x: p.x, y: p.y }; }
      if (this.airborne && t < ms2t(s.leap.lockAt)) this.leapTarget = { x: p.x, y: p.y };
      if (this.airborne && t === ms2t(s.leap.lockAt)) this.leapLocked = true;
      if (t === W && this.leapTarget) {
        const tgt = w.clampToArena(this.leapTarget, this.def.radius);
        this.x = tgt.x; this.y = tgt.y; this.airborne = false;
        this.facing = angleTo(this, p);
        w.emit({ t: 'land', uid: this.uid, x: this.x, y: this.y });
      }
    }
    // active
    if (t >= W && t < W + A) {
      if (t === W) {
        this.activePlace = { x: this.x, y: this.y, facing: this.facing };
        w.emit({ t: 'active', uid: this.uid, step: s, x: this.x, y: this.y });
        if (s.ring) w.spawnRing(this, s);
        if (s.projectile) w.spawnProjectile(this, s);
        if (s.charge) w.emit({ t: 'charge', uid: this.uid });
      }
      if (s.charge && !this.chargeStopped) {
        const per = s.charge.speed * DT;
        const ox = this.x, oy = this.y;
        this.translate(w, Math.cos(this.facing) * per, Math.sin(this.facing) * per);
        if (Math.hypot(this.x - ox, this.y - oy) < per * 0.5) this.chargeStopped = true;
      }
      if (s.charge || s.lunge) this.activePlace = { x: this.x, y: this.y, facing: this.facing };
      if (s.hit && !this.stepHitDone && p.alive) {
        if (shapeHitsCircle(s.hit, this, p, p.radius)) {
          const r = p.receiveHit(w, s.damage, this.def.name, s, this.x, this.y, s.knockback);
          if (r !== 'ignored') this.stepHitDone = true;
        }
      }
    }
    this.stepT++;
    if (this.stepT >= W + A + F) {
      if (this.attack && this.stepIdx < this.attack.steps.length - 1) {
        // never begin a tell the player cannot see: a combo is abandoned if the player left the fair view
        if (!inFairView(this.x - p.x, this.y - p.y)) { this.toIdle(w); return; }
        this.stepIdx++;
        this.beginStep(w);
        this.stepAttack(w); // the tell tick is tick 0 of the new step
      } else {
        this.toIdle(w);
      }
    }
  }

  private doBlink(w: World, d: number) {
    const p = w.player;
    const base = angleTo(this, p);
    const from = { x: this.x, y: this.y };
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
      const a = base + off;
      const nx = p.x + Math.cos(a) * d, ny = p.y + Math.sin(a) * d;
      if (!inFairView(nx - p.x, ny - p.y)) continue;
      if (!w.level.circleFree({ x: nx, y: ny }, this.def.radius) || !w.insideArena({ x: nx, y: ny }, this.def.radius + 0.2)) continue;
      this.x = nx; this.y = ny; this.facing = angleTo(this, p);
      w.emit({ t: 'blink', uid: this.uid, fromX: from.x, fromY: from.y, x: nx, y: ny });
      return;
    }
    // no valid spot: stay, but still cue the reappearance
    this.facing = angleTo(this, p);
    w.emit({ t: 'blink', uid: this.uid, fromX: from.x, fromY: from.y, x: this.x, y: this.y });
  }

  translate(w: World, dx: number, dy: number) {
    this.x += dx; this.y += dy;
    w.level.collide(this, this.def.radius, this.def.floats);
  }

  private moveToward(w: World, target: Vec, speed: number) {
    let tx = target.x, ty = target.y;
    // if no straight line, follow a coarse tile path
    if (!w.level.segmentClear(this, target, this.def.radius * 0.9)) {
      if (!this.path || this.pathT-- <= 0) { this.path = w.level.path(this, target, 1500); this.pathT = 30; }
      if (this.path && this.path.length > 1) {
        while (this.path.length > 1 && dist(this, this.path[0]) < 0.6) this.path.shift();
        tx = this.path[0].x; ty = this.path[0].y;
      }
    } else this.path = null;
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d < 1e-3) return;
    const st = Math.min(d, speed * DT);
    this.translate(w, ((tx - this.x) / d) * st, ((ty - this.y) / d) * st);
  }

  /** Called on respawn / boss reset. */
  resetTo(def: EnemyDef) {
    this.hp = def.hp; this.x = this.home.x; this.y = this.home.y; this.endAttack();
    this.state = def.boss ? 'dormant' : this.sleeper ? 'sleep' : 'idle';
    this.phase = 1; this.pendingPhase = false; this.stagger = 0; this.aggro = false; this.cooldowns.clear(); this.recentHits = [];
    this.lastAttackId = ''; this.repeat = 0; this.facing = Math.PI / 2;
  }
}
