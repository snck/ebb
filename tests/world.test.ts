import { describe, it, expect } from 'vitest';
import { World, newProgress } from '../src/sim/world';
import { Level } from '../src/sim/level';
import { NO_INPUT } from '../src/sim/types';

describe('level integrity', () => {
  it('every cairn, item, note, lever, boss and the ending are reachable once gates are open', () => {
    const L = new Level();
    const start = L.data.markers.find((m) => m.type === 'player')!;
    for (const m of L.data.markers) {
      if (m.type === 'player' || m.type === 'enemy') continue;
      const p = L.path(start, m, 20000);
      expect(p, `${m.type} ${m.id}`).not.toBeNull();
    }
  });
  it('with gates in their initial state, boss 1 must be beaten to reach the Nave (no sequence break)', () => {
    const w = new World({ spawnRegular: false });
    const c2 = w.cairnMarker('c2');
    const c1 = w.cairnMarker('c1');
    // arena gate open (not sealed) but exit closed: from c1 you cannot reach c2
    expect(w.level.path(c1, c2, 20000)).toBeNull();
  });
  it('the shortcut lever connects the Nave back to the Gaol Steps', () => {
    const w = new World({ spawnRegular: false, progress: { ...newProgress(), defeated: ['boss1'] } });
    const lever = w.markers('lever')[0];
    const c1 = w.cairnMarker('c1');
    const before = w.level.path(c1, lever, 20000)!.length;
    w.player.reset(lever.x, lever.y);
    w.step(NO_INPUT);
    expect(w.progress.opened).toContain('s1');
    const after = w.level.path(c1, lever, 20000)!.length;
    expect(after).toBeLessThan(before);
  });
  it('every boss arena is a short walk from its cairn (cheap retries)', () => {
    const L = new Level();
    for (const a of L.data.arenas) {
      const c = L.data.markers.find((m) => m.id === a.cairn)!;
      const gate = L.data.gates.find((g) => g.id === a.gate)!;
      const p = L.path(c, { x: gate.cells[1][0] + 0.5, y: gate.cells[1][1] + 0.5 }, 20000)!;
      expect(p.length).toBeLessThan(10); // under ~10 m = ~2.5 s of running
    }
  });
});

describe('world flow', () => {
  it('entering an arena seals it; dying reopens it and puts you back at the cairn', () => {
    const w = World.bossTrial('netwarden', 1);
    w.step(NO_INPUT);
    expect(w.fight).not.toBeNull();
    const g = w.level.data.gates.find((x) => x.id === 'g1')!;
    expect(w.level.isGateClosed(g.cells[0][0], g.cells[0][1])).toBe(true);
    let n = 0;
    while (w.player.alive && n++ < 60 * 120) w.step(NO_INPUT);
    expect(w.player.alive).toBe(false);
    expect(w.progress.bossDeaths.boss1).toBe(1);
    w.respawn();
    expect(w.level.isGateClosed(g.cells[0][0], g.cells[0][1])).toBe(false);
    expect(w.player.hp).toBe(100);
    expect(w.enemies.find((e) => e.boss)!.hp).toBe(w.enemies.find((e) => e.boss)!.def.hp);
  });
  it('defeating a boss opens both gates and is remembered across respawns', () => {
    const w = World.bossTrial('netwarden', 1);
    w.step(NO_INPUT);
    const b = w.fight!.boss;
    b.hp = 1;
    b.takeHit(w, 5, 0, false);
    expect(w.progress.defeated).toContain('boss1');
    w.respawn();
    expect(w.enemies.some((e) => e.markerId === 'boss1')).toBe(false);
    const x = w.level.data.gates.find((g) => g.id === 'x1')!;
    expect(w.level.isGateClosed(x.cells[0][0], x.cells[0][1])).toBe(false);
  });
  it('resting at a cairn heals, refills and sets the respawn point', () => {
    const w = new World({ spawnRegular: false });
    const c = w.cairnMarker('c1');
    w.player.hp = 20; w.player.draughts = 0;
    w.player.reset(c.x + 3, c.y); w.player.hp = 20; w.player.draughts = 0;
    w.step(NO_INPUT);
    w.player.x = c.x; w.player.y = c.y;
    w.step(NO_INPUT);
    expect(w.progress.cairn).toBe('c1');
    expect(w.player.hp).toBe(100);
    expect(w.player.draughts).toBe(w.player.maxDraughts);
  });
  it('cowries raise the draught count permanently', () => {
    const w = new World({ spawnRegular: false });
    const it = w.markers('item')[0];
    w.player.reset(it.x, it.y);
    w.step(NO_INPUT);
    expect(w.player.maxDraughts).toBe(5);
    w.respawn();
    expect(w.player.maxDraughts).toBe(5);
  });
  it('the ending triggers only after the final boss', () => {
    const w = new World({ spawnRegular: false, progress: { ...newProgress(), defeated: ['boss1', 'boss2'] } });
    const e = w.markers('ending')[0];
    w.player.reset(e.x, e.y); w.step(NO_INPUT);
    expect(w.ended).toBe(false);
    w.progress.defeated.push('boss3');
    w.player.reset(e.x + 3, e.y); w.step(NO_INPUT);
    w.player.reset(e.x, e.y); w.step(NO_INPUT);
    expect(w.ended).toBe(true);
  });
});
