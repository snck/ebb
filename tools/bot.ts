/**
 * Bot players with human-like limits, used to judge fairness and difficulty.
 *
 * Every bot sees the game only through what a human could see:
 *  - an attack's tell (pose + sound) is noticed `reaction` ms after it starts (N(mean, sd) + touch latency)
 *  - rings / projectiles / dive shadows are visible objects whose arrival can be timed with some error
 *  - bots do NOT read hidden state (RNG, idle timers, future attack choice)
 * Knowledge differs: a bot that "knows" a tell knows that attack's timings (windup, recovery, best dodge),
 * which is exactly what a human learns by dying to it.
 */
import { World } from '../src/sim/world';
import { Enemy } from '../src/sim/enemy';
import { StepDef, AttackDef, EnemyDef, allSteps } from '../src/sim/defs';
import { Input } from '../src/sim/types';
import { Rng } from '../src/sim/rng';
import { PLAYER, TICK_MS, ms2t } from '../src/sim/constants';
import { angleTo, dist, Vec } from '../src/sim/math';
import { shapeReach } from '../src/sim/shapes';

export const sig = (kind: string, s: StepDef) => `${kind}:${s.pose}:${s.sfx}`;

/**
 * A follow-up step is "predictable" if the tells before it in its combo identify the combo uniquely,
 * so a player who knows the combo can anticipate its rhythm instead of reacting to each tell.
 */
const predCache = new Map<StepDef, boolean>();
export function predictable(def: EnemyDef, st: StepDef): boolean {
  if (predCache.has(st)) return predCache.get(st)!;
  let res = false;
  for (const a of def.attacks) {
    const i = a.steps.indexOf(st);
    if (i <= 0) continue;
    const prefix = a.steps.slice(0, i).map((x) => sig(def.kind, x)).join('|');
    const here = sig(def.kind, st);
    res = def.attacks.every((b) => {
      if (b.steps.length < i) return true;
      const bp = b.steps.slice(0, i).map((x) => sig(def.kind, x)).join('|');
      if (bp !== prefix) return true;
      return b.steps[i] !== undefined && sig(def.kind, b.steps[i]) === here;
    });
  }
  predCache.set(st, res);
  return res;
}

export interface BotProfile {
  name: string;
  reactMean: number; reactSd: number; // human visual/audio reaction (ms)
  latency: [number, number]; // touch → game latency (ms)
  timingSd: number; // error when timing an anticipated press (ms)
  earlyBias: number; // systematic early press for visible objects (ms)
  errRate: number; // chance a planned dodge is botched (forgotten or badly mistimed)
  knows: (sig: string) => boolean;
  greed: number; // chance of one extra hit beyond what is safe
  smart: boolean; // uses knowledge of recoveries for punishing and healing
  healHp: number;
  staminaReserve: number;
  mode?: 'normal' | 'spamAttack' | 'spamRoll' | 'corner' | 'behind' | 'turtle' | 'idle';
}

export const PROFILES = {
  naive: (): BotProfile => ({ name: 'naive', reactMean: 300, reactSd: 35, latency: [40, 90], timingSd: 75, earlyBias: 60, errRate: 0.06, knows: () => false, greed: 0.5, smart: false, healHp: 40, staminaReserve: 0 }),
  learning: (seed: number, frac = 0.5): BotProfile => {
    const r = new Rng(seed * 7919 + 13);
    const memo = new Map<string, boolean>();
    return { name: 'learning', reactMean: 290, reactSd: 35, latency: [40, 90], timingSd: 55, earlyBias: 30, errRate: 0.04,
      knows: (s) => { if (!memo.has(s)) memo.set(s, r.chance(frac)); return memo.get(s)!; }, greed: 0.25, smart: true, healHp: 50, staminaReserve: 20 };
  },
  /** perfect discipline (spacing, healing, stamina, punishing what it sees) but knows no patterns: can you win by reflexes alone? */
  reactor: (): BotProfile => ({ name: 'reactor', reactMean: 280, reactSd: 30, latency: [40, 90], timingSd: 40, earlyBias: 0, errRate: 0.025, knows: () => false, greed: 0.08, smart: true, healHp: 55, staminaReserve: 26 }),
  expert: (): BotProfile => ({ name: 'expert', reactMean: 280, reactSd: 30, latency: [40, 90], timingSd: 40, earlyBias: 0, errRate: 0.025, knows: () => true, greed: 0.08, smart: true, healHp: 55, staminaReserve: 26 }),
};

interface Plan { tick: number; action: 'dodge' | 'attack' | 'heal'; from?: Enemy | Vec; hint?: 'away' | 'side' | 'through'; key: string }
interface Seen { uid: number; step: StepDef; tick: number; perceiveAt: number; handled: boolean }

export class Bot {
  rng: Rng;
  p: BotProfile;
  plans: Plan[] = [];
  seen: Seen[] = [];
  objSeen = new WeakSet<object>();
  objQueue: { obj: any; kind: 'ring' | 'proj'; perceiveAt: number; tick: number }[] = [];
  leapHandled = new Set<string>();
  lastPress = -99;
  stuckT = 0;
  constructor(profile: BotProfile, seed: number) { this.p = profile; this.rng = new Rng(seed * 31 + 7); }

  private reaction(): number {
    const r = Math.max(220, Math.min(450, this.rng.gauss(this.p.reactMean, this.p.reactSd)));
    return r + this.rng.range(this.p.latency[0], this.p.latency[1]);
  }
  private latencyJitter(): number {
    // an anticipated press still suffers touch latency; a practised player compensates for the mean
    const mean = (this.p.latency[0] + this.p.latency[1]) / 2;
    return this.rng.range(this.p.latency[0], this.p.latency[1]) - mean;
  }

  /** Called after every world.step to observe what happened this tick. */
  observe(w: World) {
    for (const e of w.events) {
      if (e.t === 'tell') {
        const en = w.enemies.find((x) => x.uid === e.uid);
        const anticipate = en && this.p.knows(sig(en.def.kind, e.step)) && predictable(en.def, e.step);
        const react = anticipate ? 100 + this.rng.range(0, 60) : this.reaction();
        this.seen.push({ uid: e.uid, step: e.step, tick: w.tick, perceiveAt: w.tick + ms2t(react), handled: false });
      }
    }
    for (const r of w.rings) if (!this.objSeen.has(r)) { this.objSeen.add(r); this.objQueue.push({ obj: r, kind: 'ring', tick: w.tick, perceiveAt: w.tick + ms2t(this.reaction() * 0.6) }); }
    for (const pr of w.projectiles) if (!this.objSeen.has(pr)) { this.objSeen.add(pr); this.objQueue.push({ obj: pr, kind: 'proj', tick: w.tick, perceiveAt: w.tick + ms2t(this.reaction() * 0.6) }); }
    if (this.seen.length > 60) this.seen.splice(0, this.seen.length - 60);
  }

  /** The most recent tell the bot has perceived for this enemy. */
  private lastPerceived(w: World, e: Enemy): Seen | null {
    for (let i = this.seen.length - 1; i >= 0; i--) {
      const s = this.seen[i];
      if (s.uid === e.uid && s.perceiveAt <= w.tick) return s;
    }
    return null;
  }

  private dodgePlannedSoon(w: World, ms: number) {
    return this.plans.some((p) => p.action === 'dodge' && p.tick - w.tick <= ms2t(ms));
  }

  private knownTimeline(e: Enemy, s: Seen) {
    const st = s.step;
    const hit = s.tick + ms2t(st.windup);
    const end = hit + ms2t(st.active) + ms2t(st.after);
    const atk = e.def.attacks.find((a) => a.steps.includes(st)) as AttackDef | undefined;
    const last = atk ? atk.steps[atk.steps.length - 1] === st : true;
    return { hit, end, last };
  }

  private planTell(w: World, s: Seen, e: Enemy) {
    s.handled = true;
    const st = s.step;
    const known = this.p.knows(sig(e.def.kind, st));
    const pl = w.player;
    const key = `${s.uid}:${s.tick}`;
    if (this.p.mode === 'spamAttack' || this.p.mode === 'idle') return;
    if (st.ring && known) {
      // a player who knows the wave times the roll from the wind-up and holds position
      const d = dist(e, pl);
      const gap = Math.max(0, d - e.def.radius * 0.6 - st.ring.width / 2 - pl.radius);
      const arrive = s.tick + ms2t(st.windup) + ms2t((gap / st.ring.speed) * 1000);
      const center = (PLAYER.rollIFrom + PLAYER.rollITo) / 2 - 60;
      let tick = arrive - ms2t(center) + ms2t(this.rng.gauss(0, this.p.timingSd) + this.latencyJitter());
      if (this.rng.chance(this.p.errRate)) { if (this.rng.chance(0.5)) return; tick += ms2t(this.rng.chance(0.5) ? 200 : -220); }
      this.plans.push({ tick: Math.max(tick, w.tick), action: 'dodge', from: e, hint: 'through', key: 'ringk' });
      return;
    }
    if (!st.hit && !st.blink && !st.leap) return; // unknown rings/projectiles are handled as visible objects; evades are harmless
    if (known) {
      // out of range and not a moving attack? a knowing player just stays out
      const reach = st.hit ? shapeReach(st.hit) : 0;
      const moving = !!(st.lunge && st.lunge.dist > 0) || !!st.charge || !!st.leap || !!st.blink;
      const d = dist(e, pl);
      if (!moving && st.trackUntil !== undefined && d > reach + pl.radius + 1.2) return;
      if (st.leap) return; // handled when the landing marker locks
      // centre the 333 ms of i-frames on the active window
      const hitTick = s.tick + ms2t(st.windup);
      const lead = ms2t(PLAYER.rollIFrom + (PLAYER.rollITo - PLAYER.rollIFrom) / 2 - Math.min(st.active, 200) / 2);
      let tick = hitTick - lead + ms2t(this.rng.gauss(0, this.p.timingSd) + this.latencyJitter());
      if (this.rng.chance(this.p.errRate)) {
        if (this.rng.chance(0.5)) return; // froze
        tick += ms2t(this.rng.chance(0.5) ? 200 : -220);
      }
      tick = Math.max(tick, w.tick);
      this.plans.push({ tick, action: 'dodge', from: e, hint: st.dodge, key });
    } else {
      // reacts to what it sees: roll away as soon as the tell is noticed
      if (this.rng.chance(this.p.errRate)) return;
      this.plans.push({ tick: w.tick, action: 'dodge', from: e, hint: 'away', key });
    }
  }

  private planObjects(w: World) {
    const pl = w.player;
    for (const q of this.objQueue) {
      if (q.perceiveAt > w.tick || q.obj.__handled) continue;
      q.obj.__handled = true;
      if (this.p.mode === 'spamAttack' || this.p.mode === 'idle') continue;
      if (q.kind === 'ring') {
        const r = q.obj as World['rings'][number];
        const src = w.enemies.find((x) => x.def.name === r.source);
        if (src && this.p.knows(sig(src.def.kind, r.step))) continue; // already planned from the tell
        const d = dist(r, pl);
        const gap = d - r.r - r.width / 2 - pl.radius;
        if (gap < 0 || d > r.maxR + 1) continue;
        const arriveMs = (gap / r.speed) * 1000;
        const center = PLAYER.rollIFrom + (PLAYER.rollITo - PLAYER.rollIFrom) / 2 - 60;
        let tick = w.tick + ms2t(arriveMs - center + this.rng.gauss(-this.p.earlyBias, this.p.timingSd) + this.latencyJitter());
        if (this.rng.chance(this.p.errRate)) tick += ms2t(this.rng.chance(0.5) ? 220 : -240);
        this.plans.push({ tick: Math.max(tick, w.tick), action: 'dodge', from: { x: r.x, y: r.y }, hint: 'through', key: 'ring' });
      } else {
        const pr = q.obj as World['projectiles'][number];
        // closest approach
        const rx = pl.x - pr.x, ry = pl.y - pr.y;
        const sp = Math.hypot(pr.vx, pr.vy);
        const along = (rx * pr.vx + ry * pr.vy) / sp;
        if (along < 0) continue;
        const miss = Math.abs(rx * pr.vy - ry * pr.vx) / sp;
        if (miss > pr.r + pl.radius + 0.4) continue;
        const arriveMs = ((along - pr.r - pl.radius) / sp) * 1000;
        const center = 150;
        let tick = w.tick + ms2t(arriveMs - center + this.rng.gauss(-this.p.earlyBias, this.p.timingSd) + this.latencyJitter());
        if (this.rng.chance(this.p.errRate)) tick += ms2t(this.rng.chance(0.5) ? 220 : -240);
        this.plans.push({ tick: Math.max(tick, w.tick), action: 'dodge', from: { x: pr.x - pr.vx, y: pr.y - pr.vy }, hint: 'side', key: 'proj' });
      }
    }
    this.objQueue = this.objQueue.filter((q) => !q.obj.__handled);
  }

  private planLeaps(w: World) {
    const pl = w.player;
    for (const e of w.enemies) {
      const st = e.curStep;
      if (!st?.leap || !e.leapTarget) continue;
      const lockTick = this.lastPerceived(w, e);
      if (!lockTick || lockTick.step !== st) continue;
      const key = `${e.uid}:${lockTick.tick}`;
      if (this.leapHandled.has(key)) continue;
      const known = this.p.knows(sig(e.def.kind, st));
      // The lock is visible (the shadow stops and darkens). Anyone may notice it; only a knowing player knows to wait for it.
      const lockAt = lockTick.tick + ms2t(st.leap.lockAt);
      if (known) {
        const perceive = lockAt + ms2t(this.reaction());
        if (w.tick < perceive) continue;
        this.leapHandled.add(key);
        const m = e.leapTarget;
        if (dist(m, pl) > (st.hit as any).r + pl.radius + 0.3) continue;
        if (this.rng.chance(this.p.errRate)) continue;
        this.plans.push({ tick: w.tick, action: 'dodge', from: m, hint: 'away', key });
      } else {
        // sees a shadow appear under it and rolls away from it at once (before the lock)
        const perceive = lockTick.tick + ms2t(st.leap.jumpAt) + ms2t(this.reaction());
        if (w.tick < perceive) continue;
        this.leapHandled.add(key);
        this.plans.push({ tick: w.tick, action: 'dodge', from: e.leapTarget, hint: 'away', key });
      }
    }
  }

  private rollDir(w: World, from: Vec, hint: 'away' | 'side' | 'through'): Vec {
    const pl = w.player;
    const a = angleTo(from, pl);
    const away = { x: Math.cos(a), y: Math.sin(a) };
    const arena = w.fight?.arena;
    const cx = arena ? arena.cx : pl.x, cy = arena ? arena.cy : pl.y;
    let cands: Vec[];
    if (hint === 'side') {
      const s1 = { x: -away.y, y: away.x }, s2 = { x: away.y, y: -away.x };
      const toC = { x: cx - pl.x, y: cy - pl.y };
      cands = s1.x * toC.x + s1.y * toC.y >= s2.x * toC.x + s2.y * toC.y ? [s1, s2] : [s2, s1];
    } else if (hint === 'through') {
      // roll INTO the threat so it passes over you during the i-frames
      const s1 = { x: -away.y, y: away.x };
      cands = [{ x: -away.x, y: -away.y }, s1, { x: -s1.x, y: -s1.y }];
    } else {
      cands = [away];
    }
    const out: Vec[] = [];
    for (const c of cands) for (const rot of [0, 0.5, -0.5, 1.0, -1.0]) {
      const ang = Math.atan2(c.y, c.x) + rot;
      out.push({ x: Math.cos(ang), y: Math.sin(ang) });
    }
    if (hint === 'through') return out[0]; // bodies may block; that's fine, the i-frames do the work
    for (const d of out) {
      if (w.level.segmentClear(pl, { x: pl.x + d.x * 3.2, y: pl.y + d.y * 3.2 }, pl.radius)) return d;
    }
    return out[0];
  }

  private target(w: World): Enemy | null {
    if (w.fight) return w.fight.boss;
    return w.player.target;
  }

  decide(w: World): Input {
    const inp: Input = { mx: 0, my: 0, attack: false, dodge: false, heal: false };
    const pl = w.player;
    if (!pl.alive) return inp;
    // perceive tells
    for (const s of this.seen) {
      if (s.handled || s.perceiveAt > w.tick) continue;
      const e = w.enemies.find((x) => x.uid === s.uid);
      if (!e || !e.alive()) { s.handled = true; continue; }
      this.planTell(w, s, e);
    }
    this.planObjects(w);
    this.planLeaps(w);
    const e = this.target(w);
    const mode = this.p.mode ?? 'normal';

    // execute due dodge plans
    this.plans.sort((a, b) => a.tick - b.tick);
    const due = this.plans.findIndex((p) => p.tick <= w.tick);
    if (due >= 0) {
      const p = this.plans[due];
      this.plans.splice(due, 1);
      // collapse duplicates (two threats a few ms apart are one roll)
      this.plans = this.plans.filter((q) => !(q.action === 'dodge' && q.tick - w.tick < ms2t(120)));
      if (p.action === 'dodge') {
        const from = (p.from as any) ?? e ?? pl;
        const d = this.rollDir(w, from, p.hint ?? 'away');
        inp.mx = d.x; inp.my = d.y; inp.dodge = true;
        return inp;
      }
    }

    if (mode === 'idle') return inp;
    if (!e || !e.alive()) {
      if (pl.hp <= this.p.healHp + 15 && pl.draughts > 0 && pl.state === 'free') { inp.heal = true; return inp; }
      return this.explore(w, inp);
    }

    const d = dist(e, pl);
    const reach = PLAYER.attacks[0].reach + e.def.radius - 0.15;
    const seen = this.lastPerceived(w, e);
    const tl = seen ? this.knownTimeline(e, seen) : null;
    const knowsCur = seen ? this.p.knows(sig(e.def.kind, seen.step)) : false;
    const visiblyAttacking = !!seen && tl !== null && w.tick < tl.end; // from the bot's (delayed) view

    // ---------- degenerate strategies
    if (mode === 'spamAttack') {
      this.moveToward(w, inp, e, reach - 0.4);
      if (d < reach + 0.3) inp.attack = true;
      return inp;
    }
    if (mode === 'spamRoll') {
      if (pl.stamina > 30 && w.tick - this.lastPress > 10) { const a = this.rng.range(0, Math.PI * 2); inp.mx = Math.cos(a); inp.my = Math.sin(a); inp.dodge = true; this.lastPress = w.tick; return inp; }
      if (d < reach && pl.state === 'free') inp.attack = true;
      else this.moveToward(w, inp, e, reach - 0.5);
      return inp;
    }
    if (mode === 'corner') {
      const a = w.fight!.arena;
      const corner = { x: a.x0 + 1.4, y: a.y1 - 1.4 };
      if (dist(pl, corner) > 0.8) { const ang = angleTo(pl, corner); inp.mx = Math.cos(ang); inp.my = Math.sin(ang); }
      if (d < reach && !visiblyAttacking && pl.state !== 'roll') inp.attack = true;
      return inp;
    }
    if (mode === 'behind') {
      const behind = { x: e.x - Math.cos(e.facing) * (e.def.radius + 1.0), y: e.y - Math.sin(e.facing) * (e.def.radius + 1.0) };
      const ang = angleTo(pl, behind); inp.mx = Math.cos(ang); inp.my = Math.sin(ang);
      if (d < reach && pl.state === 'free' && pl.stamina > 20) inp.attack = true;
      return inp;
    }
    if (mode === 'turtle') {
      // stay as far as possible, heal whenever hurt, attack only when the boss is right there
      const a = w.fight!.arena;
      const far = { x: e.x < a.cx ? a.x1 - 2 : a.x0 + 2, y: e.y < a.cy ? a.y1 - 2 : a.y0 + 2 };
      const ang = angleTo(pl, far); inp.mx = Math.cos(ang); inp.my = Math.sin(ang);
      if (pl.hp < 70 && pl.draughts > 0 && pl.state === 'free') inp.heal = true;
      else if (d < reach && pl.state === 'free') inp.attack = true;
      return inp;
    }

    // ---------- heal
    const busyThreat = this.dodgePlannedSoon(w, 1300);
    if (pl.hp <= this.p.healHp && pl.draughts > 0 && pl.state === 'free' && !busyThreat) {
      let safe: boolean;
      if (this.p.smart) {
        const rec = e.state === 'broken' ? true : visiblyAttacking && knowsCur && tl!.last && tl!.end - w.tick > ms2t(450);
        const idleMin = (e.phase === 2 && e.def.idleMsP2 ? e.def.idleMsP2 : e.def.idleMs)[0];
        const recLeft = rec && tl ? (tl.end - w.tick) * TICK_MS + idleMin : 0;
        safe = (rec && recLeft > PLAYER.healApplyMs + 150) || (!visiblyAttacking && d > 7.5);
      } else safe = !visiblyAttacking;
      if (safe) { inp.heal = true; return inp; }
      if (this.p.smart && pl.hp < 35) { this.retreat(w, inp, e); return inp; }
    }

    // ---------- attack
    const canSwing = pl.state === 'free' || (pl.state === 'attack' && pl.t >= ms2t(PLAYER.attacks[pl.combo].cancel) - ms2t(200));
    const stam = pl.stamina;
    if (canSwing && !this.dodgePlannedSoon(w, 450)) {
      let want = 0;
      const riposte = w.tick <= pl.slipUntil;
      if (this.p.smart) {
        const idleMin = (e.phase === 2 && e.def.idleMsP2 ? e.def.idleMsP2 : e.def.idleMs)[0];
        if (e.state === 'broken') want = 3;
        else if (visiblyAttacking && knowsCur && tl) {
          const minWind = Math.min(...allSteps(e.def).filter((s) => s.hit || s.ring).map((s) => s.windup));
          if (tl.last && w.tick >= tl.hit + ms2t(seen!.step.active)) {
            const window = (tl.end - w.tick) * TICK_MS + idleMin + minWind;
            want = Math.max(0, Math.floor((window - 330) / 400));
          } else if (w.tick < tl.hit) {
            // still winding up: one hit only if there's clearly time before the strike
            if ((tl.hit - w.tick) * TICK_MS > 760) want = 1;
          }
        } else if (!visiblyAttacking) {
          want = riposte ? 1 : (e.state === 'idle' && w.tick - (seen?.tick ?? -999) > ms2t(300) ? 1 : 0);
        }
        if (riposte && want < 1) want = 1;
        if (want > 0 && this.rng.chance(this.p.greed * 0.02)) want++;
      } else {
        want = visiblyAttacking && tl && w.tick < tl.hit + ms2t(seen!.step.active) ? 0 : 3; // greedy when nothing visible
      }
      if (pl.state === 'attack') want -= pl.combo + 1;
      want = Math.min(want, 3);
      if (want > 0 && stam >= PLAYER.attacks[0].cost + this.p.staminaReserve) {
        if (d <= reach) { inp.attack = true; this.lastPress = w.tick; }
        else if (d <= reach + 2.4 && pl.state === 'free' && !this.plans.some((q) => q.key === 'ringk')) this.moveToward(w, inp, e, reach - 0.3);
        if (inp.attack) return inp;
        if (inp.mx || inp.my) return inp;
      }
    }

    // ---------- positioning (hold still right before a planned roll so its timing stays valid)
    const waitingForWave = this.plans.some((q) => q.key === 'ringk');
    if (pl.state === 'free' && !this.dodgePlannedSoon(w, 450) && !waitingForWave) {
      const want = this.p.smart ? e.def.radius + (visiblyAttacking ? 2.6 : 1.7) : e.def.radius + 1.2;
      this.keepDistance(w, inp, e, want);
    }
    return inp;
  }

  private moveToward(w: World, inp: Input, t: Vec, stopAt: number) {
    const pl = w.player;
    const d = dist(pl, t);
    if (d <= stopAt) return;
    const a = angleTo(pl, t);
    inp.mx = Math.cos(a); inp.my = Math.sin(a);
  }

  private retreat(w: World, inp: Input, e: Enemy) {
    const pl = w.player;
    let a = angleTo(e, pl);
    const arena = w.fight?.arena;
    if (arena) {
      // bias toward open space
      const toC = angleTo(pl, { x: arena.cx, y: arena.cy });
      if (!w.level.segmentClear(pl, { x: pl.x + Math.cos(a) * 2.5, y: pl.y + Math.sin(a) * 2.5 }, pl.radius)) a = toC + (this.rng.chance(0.5) ? 1.2 : -1.2);
    }
    inp.mx = Math.cos(a); inp.my = Math.sin(a);
  }

  private keepDistance(w: World, inp: Input, e: Enemy, want: number) {
    const pl = w.player;
    const d = dist(pl, e);
    const a = angleTo(e, pl);
    let rx = 0, ry = 0;
    if (d > want + 0.4) { rx = -Math.cos(a); ry = -Math.sin(a); }
    else if (d < want - 0.4) { rx = Math.cos(a); ry = Math.sin(a); }
    // slow strafe + drift toward the arena centre so we don't get pinned
    const tx = -Math.sin(a) * 0.35, ty = Math.cos(a) * 0.35;
    let cx = 0, cy = 0;
    const arena = w.fight?.arena;
    if (arena && this.p.smart) {
      const dc = Math.hypot(arena.cx - pl.x, arena.cy - pl.y);
      if (dc > 4) { cx = ((arena.cx - pl.x) / dc) * 0.6; cy = ((arena.cy - pl.y) / dc) * 0.6; }
    }
    const mx = rx + tx + cx, my = ry + ty + cy;
    const m = Math.hypot(mx, my);
    if (m > 0.2) { inp.mx = mx / m; inp.my = my / m; }
  }

  /** Exploration is only used by the walkthrough tool, which sets waypoints. */
  waypoint: Vec | null = null;
  private explore(w: World, inp: Input): Input {
    if (!this.waypoint) return inp;
    const pl = w.player;
    const a = angleTo(pl, this.waypoint);
    inp.mx = Math.cos(a); inp.my = Math.sin(a);
    return inp;
  }
}

export interface FightResult { win: boolean; ms: number; bossHpLeft: number; cause?: string; slips: number; heals: number; hitsTaken: number }

export function runFight(bossKind: string, profile: BotProfile, seed: number, maxMs = 300000, opts: { draughts?: number } = {}): FightResult {
  const w = World.bossTrial(bossKind, seed);
  if (opts.draughts) { w.player.maxDraughts = opts.draughts; w.player.draughts = opts.draughts; }
  const bot = new Bot(profile, seed);
  const maxT = ms2t(maxMs);
  while (w.tick < maxT) {
    const inp = bot.decide(w);
    w.step(inp);
    bot.observe(w);
    if (!w.player.alive) break;
    if (!w.fight) break; // boss defeated
  }
  const boss = w.enemies.find((e) => e.boss)!;
  const win = w.player.alive && !boss.alive();
  return {
    win, ms: w.tick * TICK_MS, bossHpLeft: boss.hp / boss.def.hp, cause: w.deathCause ? `${w.deathCause.attack} (${w.deathCause.doing})` : undefined,
    slips: w.player.stats.slips, heals: w.player.stats.heals, hitsTaken: w.player.stats.hitsTaken,
  };
}
