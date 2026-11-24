import { PLAYER, ms2t, DT, TICK_MS } from './constants';
import { angleTo, turnToward, easeOutQuad, Vec } from './math';
import { shapeHitsCircle, HitShape } from './shapes';
import type { World } from './world';
import type { Action, DeathCause, Input } from './types';
import type { StepDef } from './defs';
import type { Enemy } from './enemy';

export type PState = 'free' | 'roll' | 'attack' | 'heal' | 'stun' | 'dead';

const R = PLAYER;
const ROLL_T = ms2t(R.rollMs), ROLL_I0 = ms2t(R.rollIFrom), ROLL_I1 = ms2t(R.rollITo), ROLL_MOVE_T = ms2t(R.rollMoveMs);
const HEAL_T = ms2t(R.healMs), HEAL_APPLY_T = ms2t(R.healApplyMs);
const BUFFER_T = ms2t(R.bufferMs);

export class Player {
  x = 0; y = 0; facing = 0;
  hp = R.maxHp; stamina = R.maxStamina;
  regenWait = 0; // ticks
  state: PState = 'free';
  t = 0; // ticks in state
  combo = 0;
  rollDx = 0; rollDy = 0; rollFrom: Vec = { x: 0, y: 0 };
  hitThisSwing = new Set<number>();
  stunT = 0;
  invulnT = 0; // post-hit invulnerability ticks left
  buffer: { action: Action; ttl: number } | null = null;
  draughts = R.baseDraughts; maxDraughts = R.baseDraughts;
  healApplied = false;
  slipUntil = -1; // tick until which a riposte is primed
  slipThisRoll = false;
  riposteSwing = false;
  /** world tick of last roll start, for death recap */
  lastRollTick = -9999;
  moveMag = 0;
  vx = 0; vy = 0; // for rendering
  knockX = 0; knockY = 0; knockT = 0;
  target: Enemy | null = null;
  // statistics
  stats = { rolls: 0, slips: 0, hitsTaken: 0, hitsLanded: 0, heals: 0 };

  get radius() { return R.radius; }
  get alive() { return this.state !== 'dead'; }

  /** Is the player invulnerable right now (roll i-frames or post-hit grace)? */
  rollIFrames(): boolean { return this.state === 'roll' && this.t >= ROLL_I0 && this.t < ROLL_I1; }
  invulnerable(): boolean { return this.rollIFrames() || this.invulnT > 0 || this.state === 'dead'; }

  reset(x: number, y: number) {
    this.x = x; this.y = y; this.facing = -Math.PI / 2;
    this.hp = R.maxHp; this.stamina = R.maxStamina; this.state = 'free'; this.t = 0; this.combo = 0;
    this.buffer = null; this.draughts = this.maxDraughts; this.invulnT = 0; this.knockT = 0; this.slipUntil = -1;
  }

  private spend(cost: number) {
    this.stamina -= cost;
    if (this.stamina <= 0) { this.stamina = 0; this.regenWait = ms2t(R.exhaustedDelayMs); }
    else this.regenWait = ms2t(R.regenDelayMs);
  }

  private canStart(action: Action): boolean {
    switch (this.state) {
      case 'free': return true;
      case 'attack': {
        const a = R.attacks[this.combo];
        if (this.t < ms2t(a.cancel)) return false;
        if (action === 'attack') return true;
        if (action === 'dodge') return true;
        return this.t >= ms2t(a.end);
      }
      default: return false;
    }
  }

  step(w: World, inp: Input) {
    if (this.state === 'dead') { this.t++; return; }
    // ---- input buffer (latest press wins; dodge beats attack beats heal within one tick)
    const pressed: Action | null = inp.dodge ? 'dodge' : inp.attack ? 'attack' : inp.heal ? 'heal' : null;
    if (pressed) this.buffer = { action: pressed, ttl: BUFFER_T };
    else if (this.buffer && --this.buffer.ttl <= 0) this.buffer = null;

    if (this.invulnT > 0) this.invulnT--;
    // ---- stamina regen
    if (this.regenWait > 0) this.regenWait--;
    else if (this.state !== 'roll' && this.state !== 'attack') {
      const mult = this.state === 'heal' ? 0.5 : 1;
      this.stamina = Math.min(R.maxStamina, this.stamina + R.staminaRegen * DT * mult);
    }

    this.target = w.softTarget();
    const mag = Math.min(1, Math.hypot(inp.mx, inp.my));
    this.moveMag = mag;

    // ---- try buffered action
    if (this.buffer && this.canStart(this.buffer.action)) {
      const a = this.buffer.action;
      if (this.tryStart(w, a, inp)) this.buffer = null;
    }

    this.t++;
    let mvx = 0, mvy = 0;
    switch (this.state) {
      case 'free': {
        if (mag > 0.05) {
          const sp = R.runSpeed * Math.min(1, mag / 0.75);
          mvx = (inp.mx / mag) * sp * DT; mvy = (inp.my / mag) * sp * DT;
        }
        const tgt = this.target;
        if (tgt) this.facing = turnToward(this.facing, angleTo(this, tgt), 14 * DT);
        else if (mag > 0.2) this.facing = turnToward(this.facing, Math.atan2(inp.my, inp.mx), 16 * DT);
        break;
      }
      case 'roll': {
        if (this.t <= ROLL_MOVE_T) {
          const p0 = easeOutQuad((this.t - 1) / ROLL_MOVE_T), p1 = easeOutQuad(this.t / ROLL_MOVE_T);
          const d = (p1 - p0) * R.rollDist;
          mvx = this.rollDx * d; mvy = this.rollDy * d;
        }
        if (this.t >= ROLL_T) this.toFree();
        break;
      }
      case 'attack': {
        const a = R.attacks[this.combo];
        const st = ms2t(a.startup), ac = ms2t(a.active);
        if (this.t <= ms2t(R.attackTrackMs) && this.target) this.facing = turnToward(this.facing, angleTo(this, this.target), 10 * DT);
        if (this.t <= st) {
          const d = a.lunge / st;
          mvx = Math.cos(this.facing) * d; mvy = Math.sin(this.facing) * d;
        }
        if (this.t > st && this.t <= st + ac) this.swingHits(w);
        if (this.t >= ms2t(a.end)) { this.toFree(); this.combo = 0; }
        break;
      }
      case 'heal': {
        if (mag > 0.05) {
          const sp = R.runSpeed * R.healMoveMult;
          mvx = (inp.mx / mag) * sp * DT; mvy = (inp.my / mag) * sp * DT;
        }
        if (!this.healApplied && this.t >= HEAL_APPLY_T) {
          this.healApplied = true;
          const before = this.hp;
          this.hp = Math.min(R.maxHp, this.hp + R.healAmount);
          w.emit({ t: 'healDone', amount: this.hp - before });
        }
        if (this.t >= HEAL_T) this.toFree();
        break;
      }
      case 'stun': {
        if (this.t >= this.stunT) this.toFree();
        break;
      }
    }
    if (this.knockT > 0) { mvx += this.knockX * DT; mvy += this.knockY * DT; this.knockT--; }
    this.x += mvx; this.y += mvy;
    w.level.collide(this, R.radius);
    this.vx = mvx / DT; this.vy = mvy / DT;
  }

  private toFree() { this.state = 'free'; this.t = 0; }

  private tryStart(w: World, a: Action, inp: Input): boolean {
    if (a === 'heal') {
      if (this.draughts <= 0) { w.emit({ t: 'reject', action: 'heal', reason: 'empty' }); return true; }
      this.draughts--; this.state = 'heal'; this.t = 0; this.healApplied = false; this.combo = 0;
      this.stats.heals++;
      w.emit({ t: 'healStart' });
      return true;
    }
    if (this.stamina < 1) { w.emit({ t: 'reject', action: a, reason: 'stamina' }); return true; }
    if (a === 'dodge') {
      const mag = Math.hypot(inp.mx, inp.my);
      let dx: number, dy: number;
      if (mag > 0.25) { dx = inp.mx / mag; dy = inp.my / mag; }
      else { dx = -Math.cos(this.facing); dy = -Math.sin(this.facing); } // neutral = backstep roll
      this.rollDx = dx; this.rollDy = dy; this.rollFrom = { x: this.x, y: this.y };
      this.state = 'roll'; this.t = 0; this.combo = 0; this.slipThisRoll = false;
      this.spend(R.rollCost);
      this.lastRollTick = w.tick;
      this.stats.rolls++;
      w.emit({ t: 'roll' });
      return true;
    }
    // attack
    const chaining = this.state === 'attack';
    const next = chaining ? Math.min(2, this.combo + 1) : 0;
    const def = R.attacks[next];
    this.combo = next; this.state = 'attack'; this.t = 0; this.hitThisSwing.clear();
    this.spend(def.cost);
    // aim: snap toward a target in reach, otherwise stick direction, otherwise keep facing
    const tgt = w.attackTarget(def.reach + 1.4);
    if (tgt) this.facing = angleTo(this, tgt);
    else if (Math.hypot(inp.mx, inp.my) > 0.3) this.facing = Math.atan2(inp.my, inp.mx);
    this.riposteSwing = w.tick <= this.slipUntil;
    if (this.riposteSwing) this.slipUntil = -1;
    w.emit({ t: 'swing', combo: next, riposte: this.riposteSwing });
    return true;
  }

  swingShape(): HitShape {
    const a = R.attacks[this.combo];
    return { kind: 'arc', r: a.reach, half: a.half };
  }

  private swingHits(w: World) {
    const a = R.attacks[this.combo];
    const shape = this.swingShape();
    for (const e of w.enemies) {
      if (!e.hittable() || this.hitThisSwing.has(e.uid)) continue;
      if (!shapeHitsCircle(shape, this, e, e.def.radius)) continue;
      this.hitThisSwing.add(e.uid);
      let dmg = a.damage, stag = a.stagger;
      if (this.riposteSwing) { dmg *= R.slipDamageMult; stag *= R.slipStaggerMult; }
      e.takeHit(w, dmg, stag, this.riposteSwing);
      this.stats.hitsLanded++;
    }
  }

  /**
   * An enemy hitbox / ring / projectile overlaps the player.
   * Returns 'slip' when dodged by i-frames (the attack is then spent on the player — see DESIGN.md "Clean dodge"),
   * 'ignored' when in post-hit grace, 'hit' when damage was applied.
   */
  receiveHit(w: World, dmg: number, source: string, step: StepDef | undefined, fromX: number, fromY: number, knockback = R.knockback, stunMs = R.hitstunMs): 'slip' | 'hit' | 'ignored' {
    if (this.state === 'dead') return 'ignored';
    if (this.rollIFrames()) {
      if (!this.slipThisRoll) {
        this.slipThisRoll = true;
        this.slipUntil = w.tick + ms2t(R.slipWindowMs);
        this.stamina = Math.min(R.maxStamina, this.stamina + R.slipStaminaRefund);
        this.stats.slips++;
        w.emit({ t: 'slip', x: this.x, y: this.y });
      }
      return 'slip';
    }
    if (this.invulnT > 0) return 'ignored';
    const doing = this.describeDoing(w, step);
    this.hp -= dmg;
    this.stats.hitsTaken++;
    const killed = this.hp <= 0;
    if (this.state === 'heal' && !this.healApplied) w.emit({ t: 'healLost' });
    w.emit({ t: 'playerHit', dmg, source, step, x: this.x, y: this.y, killed });
    const ang = Math.atan2(this.y - fromY, this.x - fromX);
    const kbT = ms2t(160);
    this.knockX = Math.cos(ang) * (knockback / (kbT * DT)); this.knockY = Math.sin(ang) * (knockback / (kbT * DT)); this.knockT = kbT;
    this.combo = 0; this.buffer = null;
    if (killed) {
      this.hp = 0; this.state = 'dead'; this.t = 0;
      w.onPlayerDeath({ source, attack: step?.name ?? source, stepId: step?.id, ...doing });
    } else {
      this.state = 'stun'; this.t = 0; this.stunT = ms2t(stunMs);
      this.invulnT = ms2t(Math.max(R.hitInvulnMs, stunMs));
    }
    return 'hit';
  }

  private describeDoing(w: World, _step: StepDef | undefined): Omit<DeathCause, 'source' | 'attack'> {
    const sinceRoll = (w.tick - this.lastRollTick) * TICK_MS;
    if (this.state === 'attack') return { doing: 'attacking' };
    if (this.state === 'heal') return { doing: 'healing' };
    if (this.state === 'stun') return { doing: 'stunned' };
    if (this.state === 'roll') {
      // in a roll but not invulnerable: either the very start (late) or recovery (early)
      if (this.t < ROLL_I0) return { doing: 'rolling-late', rollStartedAfterMs: Math.round(this.t * TICK_MS) };
      return { doing: 'rolling-early', rollEndedBeforeMs: Math.round((this.t - ROLL_I1) * TICK_MS) };
    }
    if (sinceRoll < 1500) return { doing: 'rolling-early', rollEndedBeforeMs: Math.round(sinceRoll - R.rollITo) };
    return { doing: 'idle' };
  }
}
