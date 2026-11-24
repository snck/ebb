/**
 * Headless difficulty simulation.
 *   npx tsx tools/run-sims.ts [fights-per-cell=200] [boss]
 * Prints win rates for naive / learning / expert bots and degenerate strategies, plus a
 * "progressive learner" that starts naive and learns each attack that hits it (a model of a real first-time player).
 */
import { runFight, PROFILES, BotProfile, sig } from './bot';
import { ENEMY_DEFS, allSteps } from '../src/sim/defs';
import { mkdirSync, writeFileSync } from 'node:fs';

const N = Number(process.argv[2] ?? 200);
const only = process.argv[3];
const bosses = (only ? [only] : ['netwarden', 'cantor', 'abbess']);

function cell(boss: string, mk: (seed: number) => BotProfile, n = N) {
  let wins = 0, hpLeft = 0, ms = 0;
  const causes = new Map<string, number>();
  for (let s = 1; s <= n; s++) {
    const r = runFight(boss, mk(s), s * 101 + boss.length);
    if (r.win) { wins++; ms += r.ms; } else { hpLeft += r.bossHpLeft; if (r.cause) causes.set(r.cause, (causes.get(r.cause) ?? 0) + 1); }
  }
  const top = [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, k]) => `${c}×${k}`).join('; ');
  return { winRate: wins / n, avgBossHpLeftOnLoss: n - wins ? hpLeft / (n - wins) : 0, avgWinSec: wins ? ms / wins / 1000 : 0, topCauses: top };
}

/** A first-time player: knows nothing, learns an attack after being hit by it twice; their execution also tightens with practice. */
function progressive(boss: string, seed: number, maxAttempts = 60) {
  const known = new Set<string>();
  const hits = new Map<string, number>();
  const def = ENEMY_DEFS[boss];
  const steps = allSteps(def);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const practice = Math.min(1, (attempt - 1) / 12);
    const prof: BotProfile = {
      ...PROFILES.expert(), name: 'progressive',
      timingSd: 70 - 30 * practice, errRate: 0.06 - 0.035 * practice, greed: 0.5 - 0.4 * practice, earlyBias: 60 - 60 * practice,
      healHp: 50, staminaReserve: Math.round(26 * practice),
      knows: (s) => known.has(s),
    };
    const r = runFightDetailed(boss, prof, seed * 1000 + attempt);
    if (r.win) return attempt;
    for (const sid of r.hitBy) {
      const st = steps.find((x) => x.id === sid);
      if (!st) continue;
      const k = sig(def.kind, st);
      hits.set(k, (hits.get(k) ?? 0) + 1);
      if ((hits.get(k) ?? 0) >= 2) known.add(k);
    }
  }
  return Infinity;
}

import { World } from '../src/sim/world';
import { Bot } from './bot';
import { ms2t } from '../src/sim/constants';
function runFightDetailed(boss: string, prof: BotProfile, seed: number) {
  const w = World.bossTrial(boss, seed);
  const bot = new Bot(prof, seed);
  const hitBy: string[] = [];
  while (w.tick < ms2t(300000)) {
    w.step(bot.decide(w));
    for (const e of w.events) if (e.t === 'playerHit' && e.step) hitBy.push(e.step.id);
    bot.observe(w);
    if (!w.player.alive || !w.fight) break;
  }
  const b = w.enemies.find((e) => e.boss)!;
  return { win: w.player.alive && !b.alive(), hitBy };
}

const out: any = {};
const t0 = Date.now();
for (const boss of bosses) {
  const row: any = {};
  row.naive = cell(boss, () => PROFILES.naive());
  row.learning = cell(boss, (s) => PROFILES.learning(s));
  row.expert = cell(boss, () => PROFILES.expert());
  const dn = Math.max(30, Math.floor(N / 4));
  for (const mode of ['spamAttack', 'spamRoll', 'corner', 'behind', 'turtle'] as const) {
    row[mode] = cell(boss, () => ({ ...PROFILES.naive(), mode }), dn);
  }
  const P = Math.max(20, Math.floor(N / 5));
  const att: number[] = [];
  for (let s = 1; s <= P; s++) att.push(progressive(boss, s));
  att.sort((a, b) => a - b);
  row.progressive = {
    firstAttemptWin: att.filter((a) => a === 1).length / P,
    medianAttempts: att[Math.floor(P / 2)],
    p90Attempts: att[Math.floor(P * 0.9)],
    neverWon: att.filter((a) => a === Infinity).length / P,
  };
  out[boss] = row;
  console.log(`\n=== ${boss}`);
  for (const [k, v] of Object.entries(row)) console.log(k.padEnd(12), JSON.stringify(v));
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
mkdirSync('tools/out', { recursive: true });
writeFileSync(`tools/out/sims${only ? '-' + only : ''}.json`, JSON.stringify(out, null, 2));
