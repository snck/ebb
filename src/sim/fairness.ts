/**
 * Fairness rules, computed straight from the attack data (shared by the report tool and the tests).
 *
 * Human budget on a touchscreen:  reaction 250–350 ms + touch latency ≈ 50–80 ms + 33 ms before i-frames start.
 * => anything that must be answered by pure reaction needs >= 500 ms between its cue and the hit.
 */
import { PLAYER, TICK_MS, ms2t } from './constants';
import { EnemyDef, StepDef, ENEMY_DEFS, allSteps } from './defs';
import { shapeReach } from './shapes';

export const MIN_REACT_MS = 500; // cue -> hit, for anything that can be reacted to
export const MIN_COMBO_GAP_MS = 600; // hit -> next hit inside a combo (hitstun 300 + a real reaction)

export interface StepWindow {
  enemy: string; id: string; name: string; tell: string;
  /** ms from the first visible/audible cue of this step to its earliest possible hit */
  cueToHitMs: number;
  cue: string;
  activeMs: number;
  recoveryMs: number | null; // only for last steps
  gapFromPrevHitMs: number | null;
  reach: number;
  dodgeWindowMs: number; // width of the press-time window that i-frames the first contact
  notes: string;
}

const q = (ms: number) => Math.round(ms2t(ms) * TICK_MS); // what the 60 Hz sim actually does

export function stepWindows(def: EnemyDef): StepWindow[] {
  const out: StepWindow[] = [];
  const iframeWidth = q(PLAYER.rollITo) - q(PLAYER.rollIFrom);
  for (const a of def.attacks) {
    if (a.evade) continue;
    a.steps.forEach((s, i) => {
      if (out.some((o) => o.id === s.id)) return;
      let cue = 'wind-up pose + sound';
      let cueToHit = q(s.windup);
      const notes: string[] = [];
      if (s.blink) { cueToHit = q(s.windup) - q(s.blink.at); cue = 'reappearance (mist burst + chime)'; }
      if (s.leap) { cueToHit = q(s.windup) - q(s.leap.lockAt); cue = 'landing shadow stops & darkens'; notes.push(`shadow tracks you for ${s.leap.lockAt - s.leap.jumpAt} ms first`); }
      if (s.ring) notes.push(`wave expands at ${s.ring.speed} m/s: +${Math.round(1000 / s.ring.speed)} ms per metre of distance`);
      if (s.projectile) notes.push(`projectile ${s.projectile.speed} m/s: +${Math.round(1000 / s.projectile.speed)} ms per metre`);
      if (s.charge) notes.push(`charges at ${s.charge.speed} m/s`);
      if (s.lunge && s.lunge.dist > 0) notes.push(`steps in ${s.lunge.dist} m late in the wind-up`);
      if (s.trackUntil !== undefined) notes.push(`tracks you until ${s.trackUntil} ms`);
      const prev = i > 0 ? a.steps[i - 1] : null;
      const gap = prev ? q(prev.active) + q(prev.after) + q(s.windup) : null;
      out.push({
        enemy: def.name, id: s.id, name: s.name, tell: `${s.pose} / ${s.sfx}`,
        cueToHitMs: cueToHit, cue, activeMs: q(s.active),
        recoveryMs: i === a.steps.length - 1 ? q(s.after) : null,
        gapFromPrevHitMs: gap,
        reach: s.hit ? shapeReach(s.hit) : s.ring ? s.ring.maxR : s.projectile ? 99 : 0,
        dodgeWindowMs: iframeWidth,
        notes: notes.join('; '),
      });
    });
  }
  return out;
}

export interface Violation { id: string; rule: string; detail: string }

export function checkFairness(defs: EnemyDef[] = Object.values(ENEMY_DEFS)): Violation[] {
  const v: Violation[] = [];
  for (const def of defs) {
    for (const w of stepWindows(def)) {
      if (w.cueToHitMs < MIN_REACT_MS) v.push({ id: w.id, rule: 'R1 cue→hit ≥ 500 ms', detail: `${w.cueToHitMs} ms` });
      if (w.gapFromPrevHitMs !== null && w.gapFromPrevHitMs < MIN_COMBO_GAP_MS) v.push({ id: w.id, rule: 'R2 combo gap ≥ 600 ms', detail: `${w.gapFromPrevHitMs} ms` });
    }
    // R3: identical tell => identical timing
    const bySig = new Map<string, StepDef>();
    for (const s of allSteps(def)) {
      const k = `${s.pose}|${s.sfx}`;
      const o = bySig.get(k);
      if (o && (o.windup !== s.windup || o.active !== s.active || o.trackUntil !== s.trackUntil)) v.push({ id: s.id, rule: 'R3 same tell ⇒ same timing', detail: `${s.id} vs ${o.id}` });
      if (!o) bySig.set(k, s);
    }
  }
  return v;
}
