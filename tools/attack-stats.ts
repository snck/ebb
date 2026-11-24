/** Per-attack outcomes for a bot profile: how often each step is dodged (i-frames), hits, or misses by spacing. */
import { World } from '../src/sim/world';
import { Bot, PROFILES, BotProfile } from './bot';
import { ms2t } from '../src/sim/constants';

const boss = process.argv[2] ?? 'netwarden';
const prof = process.argv[3] ?? 'naive';
const N = Number(process.argv[4] ?? 100);
const stats = new Map<string, { n: number; hit: number; slip: number }>();
let wins = 0;
const hpAtDeath: number[] = [];
for (let s = 1; s <= N; s++) {
  const p: BotProfile = prof === 'naive' ? PROFILES.naive() : prof === 'learning' ? PROFILES.learning(s) : PROFILES.expert();
  const w = World.bossTrial(boss, s * 101 + boss.length);
  const bot = new Bot(p, s);
  let pending: { id: string; slipped: boolean; hit: boolean }[] = [];
  while (w.tick < ms2t(300000)) {
    w.step(bot.decide(w));
    bot.observe(w);
    for (const e of w.events) {
      if (e.t === 'tell' && (e.step.hit || e.step.ring || e.step.projectile)) pending.push({ id: e.step.id, slipped: false, hit: false });
      if (e.t === 'playerHit' && e.step) { const q = [...pending].reverse().find((x) => x.id === e.step!.id); if (q) q.hit = true; }
      if (e.t === 'slip') { const q = pending[pending.length - 1]; if (q) q.slipped = true; }
    }
    if (!w.player.alive || !w.fight) break;
  }
  const b = w.enemies.find((e) => e.boss)!;
  if (w.player.alive && !b.alive()) wins++; else hpAtDeath.push(b.hp / b.def.hp);
  for (const q of pending) {
    const st = stats.get(q.id) ?? { n: 0, hit: 0, slip: 0 };
    st.n++; if (q.hit) st.hit++; else if (q.slipped) st.slip++;
    stats.set(q.id, st);
  }
}
console.log(`${boss} / ${prof}: win ${(wins / N * 100).toFixed(0)}%`);
for (const [id, s] of [...stats.entries()].sort()) console.log(id.padEnd(16), `n=${String(s.n).padStart(5)} hit ${(s.hit / s.n * 100).toFixed(0).padStart(3)}%  iframe-dodged ${(s.slip / s.n * 100).toFixed(0).padStart(3)}%  missed/spaced ${((s.n - s.hit - s.slip) / s.n * 100).toFixed(0).padStart(3)}%`);
