import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { NO_INPUT, Input } from '../src/sim/types';
import { PLAYER, ms2t, TICK_MS, inFairView } from '../src/sim/constants';
import { shapeHitsCircle, shapePolygon, HitShape } from '../src/sim/shapes';
import { checkFairness, stepWindows } from '../src/sim/fairness';
import { ENEMY_DEFS, NETWARDEN } from '../src/sim/defs';
import { Enemy } from '../src/sim/enemy';

const press = (k: Partial<Input>): Input => ({ ...NO_INPUT, ...k });

/** a world with no enemies, player in the open on the Strand */
function emptyWorld() {
  const w = new World({ spawnRegular: false, seed: 1 });
  w.enemies = [];
  w.player.reset(16, 58);
  return w;
}

function pointInPoly(px: number, py: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('hit shapes', () => {
  const shapes: HitShape[] = [
    { kind: 'arc', r: 3, half: 1.0 },
    { kind: 'rect', from: 0, to: 3.8, halfW: 0.75 },
    { kind: 'circle', r: 2.3 },
    { kind: 'circle', r: 1.2, fwd: 0.4 },
  ];
  it('what is drawn is what hits (point targets agree with the drawn polygon)', () => {
    const at = { x: 5, y: 5, facing: 0.7 };
    for (const s of shapes) {
      const poly = shapePolygon(s, at, 64);
      let disagreements = 0, n = 0;
      for (let x = 0; x < 10; x += 0.13) for (let y = 0; y < 10; y += 0.13) {
        n++;
        const hit = shapeHitsCircle(s, at, { x, y }, 0.001);
        if (hit !== pointInPoly(x, y, poly)) disagreements++;
      }
      // only boundary samples may disagree (polygon is a 64-segment approximation)
      expect(disagreements / n).toBeLessThan(0.01);
    }
  });
  it('arc respects its angle', () => {
    const at = { x: 0, y: 0, facing: 0 };
    const s: HitShape = { kind: 'arc', r: 3, half: Math.PI / 4 };
    expect(shapeHitsCircle(s, at, { x: 2, y: 0 }, 0.4)).toBe(true);
    expect(shapeHitsCircle(s, at, { x: -2, y: 0 }, 0.4)).toBe(false);
    expect(shapeHitsCircle(s, at, { x: 0, y: 2 }, 0.4)).toBe(false);
  });
});

describe('player rules (consistency)', () => {
  it('roll i-frames start at 33 ms and last exactly 333 ms', () => {
    const w = emptyWorld();
    w.step(press({ dodge: true, mx: 1 }));
    const inv: boolean[] = [];
    for (let i = 0; i < 40; i++) { inv.push(w.player.rollIFrames()); w.step(NO_INPUT); }
    const first = inv.indexOf(true), last = inv.lastIndexOf(true);
    expect(first * TICK_MS).toBeCloseTo(PLAYER.rollIFrom - TICK_MS, -1);
    expect((last - first + 1) * TICK_MS).toBeCloseTo(PLAYER.rollITo - PLAYER.rollIFrom, -1);
  });
  it('roll costs stamina; no stamina => rejected press', () => {
    const w = emptyWorld();
    w.player.stamina = 0; w.player.regenWait = 100;
    w.step(press({ dodge: true }));
    expect(w.player.state).toBe('free');
    expect(w.events.some((e) => e.t === 'reject')).toBe(true);
    w.player.stamina = 100;
    w.step(press({ dodge: true }));
    expect(w.player.state).toBe('roll');
    expect(w.player.stamina).toBe(100 - PLAYER.rollCost);
  });
  it('a press during a roll is buffered and fires when the roll ends (within 220 ms)', () => {
    const w = emptyWorld();
    w.step(press({ dodge: true, mx: 1 }));
    for (let i = 0; i < ms2t(PLAYER.rollMs) - ms2t(150); i++) w.step(NO_INPUT);
    w.step(press({ attack: true }));
    let attacked = false;
    for (let i = 0; i < 15; i++) { w.step(NO_INPUT); if (w.player.state === 'attack') attacked = true; }
    expect(attacked).toBe(true);
  });
  it('a press too early is dropped (buffer is 220 ms, not forever)', () => {
    const w = emptyWorld();
    w.step(press({ dodge: true, mx: 1 }));
    w.step(press({ attack: true })); // 500 ms before the roll ends
    let attacked = false;
    for (let i = 0; i < 40; i++) { w.step(NO_INPUT); if (w.player.state === 'attack') attacked = true; }
    expect(attacked).toBe(false);
  });
  it('attacks commit: a dodge cannot cancel before the cancel point', () => {
    const w = emptyWorld();
    w.step(press({ attack: true }));
    let t = 0;
    while (w.player.state === 'attack' && t < 100) { w.step(press({ dodge: true })); t++; } // mashing dodge
    expect(w.player.state).toBe('roll');
    expect((t + 1) * TICK_MS).toBeGreaterThanOrEqual(PLAYER.attacks[0].cancel - TICK_MS);
  });
  it('healing applies at 700 ms; being hit before that loses the draught', () => {
    const w = emptyWorld();
    w.player.hp = 50;
    w.step(press({ heal: true }));
    expect(w.player.draughts).toBe(PLAYER.baseDraughts - 1);
    for (let i = 0; i < ms2t(PLAYER.healApplyMs) + 2; i++) w.step(NO_INPUT);
    expect(w.player.hp).toBe(50 + PLAYER.healAmount);
    const w2 = emptyWorld();
    w2.player.hp = 50;
    w2.step(press({ heal: true }));
    for (let i = 0; i < 10; i++) w2.step(NO_INPUT);
    w2.player.receiveHit(w2, 10, 'test', undefined, 15, 58);
    for (let i = 0; i < 60; i++) w2.step(NO_INPUT);
    expect(w2.player.hp).toBe(40);
  });
  it('a hit during i-frames is a clean dodge: no damage, stamina refund, primed riposte', () => {
    const w = emptyWorld();
    w.step(press({ dodge: true, mx: 1 }));
    w.step(NO_INPUT); w.step(NO_INPUT); w.step(NO_INPUT);
    const st = w.player.stamina;
    const r = w.player.receiveHit(w, 30, 'test', undefined, 0, 0);
    expect(r).toBe('slip');
    expect(w.player.hp).toBe(100);
    expect(w.player.stamina).toBe(st + PLAYER.slipStaminaRefund);
    expect(w.player.slipUntil).toBeGreaterThan(w.tick);
  });
  it('post-hit grace prevents double hits for 300 ms', () => {
    const w = emptyWorld();
    expect(w.player.receiveHit(w, 10, 't', undefined, 0, 0)).toBe('hit');
    expect(w.player.receiveHit(w, 10, 't', undefined, 0, 0)).toBe('ignored');
    for (let i = 0; i < ms2t(PLAYER.hitInvulnMs) + 1; i++) w.step(NO_INPUT);
    expect(w.player.receiveHit(w, 10, 't', undefined, 0, 0)).toBe('hit');
  });
});

describe('enemy behaviour', () => {
  it('every attack hit lands exactly `windup` after its tell', () => {
    for (const kind of ['netwarden', 'cantor', 'abbess']) {
      const w = World.bossTrial(kind, 3);
      const tells = new Map<number, { id: string; tick: number; windup: number }>();
      let checked = 0;
      for (let i = 0; i < ms2t(60000) && w.player.alive; i++) {
        w.step(NO_INPUT);
        w.player.hp = 100; // immortal observer
        for (const e of w.events) {
          if (e.t === 'tell') tells.set(e.uid, { id: e.step.id, tick: w.tick, windup: e.step.windup });
          if (e.t === 'active') {
            const t = tells.get(e.uid)!;
            expect(t.id).toBe(e.step.id);
            expect(w.tick - t.tick).toBe(ms2t(e.step.windup));
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(10);
    }
  });
  it('enemies never start an attack outside the fair view', () => {
    for (const kind of ['netwarden', 'cantor', 'abbess']) {
      const w = World.bossTrial(kind, 9);
      for (let i = 0; i < ms2t(60000); i++) {
        // wander the player around the arena so the boss is often at odd angles
        const a = i / 90;
        w.step({ ...NO_INPUT, mx: Math.cos(a), my: Math.sin(a * 1.3) });
        w.player.hp = 100;
        for (const e of w.events) if (e.t === 'tell' && e.step.pose !== 'evade') {
          const en = w.enemies.find((x) => x.uid === e.uid)!;
          expect(inFairView(en.x - w.player.x, en.y - w.player.y)).toBe(true);
        }
      }
    }
  });
  it('fights are deterministic for a seed and input stream', () => {
    const run = () => {
      const w = World.bossTrial('cantor', 42);
      for (let i = 0; i < 2000; i++) w.step({ ...NO_INPUT, attack: i % 37 === 0, dodge: i % 53 === 0, mx: Math.sin(i / 50) });
      return `${w.player.x.toFixed(4)},${w.player.hp},${w.enemies[0].hp}`;
    };
    expect(run()).toBe(run());
  });
  it('bosses are not staggered by hits but break when the stagger meter fills', () => {
    const w = World.bossTrial('netwarden', 1);
    for (let i = 0; i < 5; i++) w.step(NO_INPUT);
    const b = w.fight!.boss;
    b.state = 'idle';
    for (let i = 0; i < 9; i++) b.takeHit(w, 1, 10, false);
    expect(b.state).not.toBe('broken');
    b.takeHit(w, 1, 10, false);
    expect(b.state).toBe('broken');
  });
  it('regular enemies flinch at most once per 2 s (no stun-lock), and not late in a wind-up', () => {
    const w = emptyWorld();
    const e = new Enemy(ENEMY_DEFS.novice, 18, 58, 'x');
    w.enemies = [e]; e.wake(w);
    e.takeHit(w, 1, 0, false);
    expect(e.state).toBe('flinch');
    for (let i = 0; i < ms2t(500); i++) w.step(NO_INPUT);
    e.state = 'idle';
    e.takeHit(w, 1, 0, false);
    expect(e.state).toBe('idle');
  });
  it('late in a wind-up a regular enemy cannot be interrupted', () => {
    const w = emptyWorld();
    const e = new Enemy(ENEMY_DEFS.novice, 17.5, 58, 'x');
    w.enemies = [e]; e.wake(w);
    let n = 0;
    while (!(e.state === 'attack' && e.stepT > ms2t(e.curStep!.windup) * 0.6) && n++ < 600) { w.step(NO_INPUT); w.player.hp = 100; }
    e.takeHit(w, 1, 0, false);
    expect(e.state).toBe('attack');
  });
});

describe('fairness rules from data', () => {
  it('no violations (cue→hit ≥ 500 ms, combo gaps ≥ 600 ms, same tell ⇒ same timing)', () => {
    expect(checkFairness()).toEqual([]);
  });
  it('every boss has at least one delayed attack (needs learning) and one reactable attack', () => {
    for (const def of [ENEMY_DEFS.netwarden, ENEMY_DEFS.cantor, ENEMY_DEFS.abbess]) {
      const ws = stepWindows(def);
      expect(ws.some((x) => x.cueToHitMs >= 900)).toBe(true);
      expect(ws.some((x) => x.cueToHitMs <= 750)).toBe(true);
    }
    expect(NETWARDEN.attacks.length).toBeGreaterThan(4);
  });
});
