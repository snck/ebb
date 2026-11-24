/** Regular enemies one-on-one in the Cloister Yard: they should be fair and mostly beatable even by naive play. */
import { World } from '../src/sim/world';
import { Enemy } from '../src/sim/enemy';
import { ENEMY_DEFS } from '../src/sim/defs';
import { Bot, PROFILES } from './bot';
import { ms2t } from '../src/sim/constants';
const N = Number(process.argv[2] ?? 100);
for (const kind of ['novice', 'hook', 'hound', 'wick', 'shell']) {
  const row: string[] = [];
  for (const pn of ['naive', 'expert'] as const) {
    let wins = 0, hpLost = 0;
    for (let s = 1; s <= N; s++) {
      const w = new World({ seed: s, spawnRegular: false });
      w.enemies = [new Enemy(ENEMY_DEFS[kind], 22, 37, 'x')];
      w.player.reset(22, 42); w.player.draughts = 0;
      const bot = new Bot(pn === 'naive' ? PROFILES.naive() : PROFILES.expert(), s);
      while (w.tick < ms2t(90000) && w.player.alive && w.enemies[0].alive()) { w.step(bot.decide(w)); bot.observe(w); }
      if (w.player.alive && !w.enemies[0].alive()) wins++;
      hpLost += 100 - w.player.hp;
    }
    row.push(`${pn}: win ${(wins / N * 100).toFixed(0)}%  avg HP lost ${(hpLost / N).toFixed(0)}`);
  }
  console.log(kind.padEnd(8), row.join('   |   '));
}
