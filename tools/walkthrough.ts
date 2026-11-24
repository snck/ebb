/**
 * Plays the whole area start → ending headlessly with a bot that walks like a player (tile paths between
 * objectives) and fights with human limits. Proves there are no dead ends, and estimates time + deaths.
 *   npx tsx tools/walkthrough.ts [profile=expert|learning] [runs=5]
 */
import { World, newProgress } from '../src/sim/world';
import { Bot, PROFILES, BotProfile } from './bot';
import { ms2t, TICK_MS } from '../src/sim/constants';
import { dist, Vec } from '../src/sim/math';

const profName = process.argv[2] ?? 'expert';
const runs = Number(process.argv[3] ?? 5);

function goals(w: World): { id: string; at: Vec; done: () => boolean }[] {
  const M = (t: string, id: string) => w.level.data.markers.find((m) => m.type === t && m.id === id)!;
  const arena = (i: number) => { const a = w.level.data.arenas[i]; return { x: a.cx, y: a.cy }; };
  const pr = w.progress;
  return [
    { id: 'c0', at: M('cairn', 'c0'), done: () => pr.cairn !== 'c0' || pr.playMs > 4000 },
    { id: 'cowrie1', at: M('item', 'cowrie1'), done: () => pr.items.includes('cowrie1') },
    { id: 'c1', at: M('cairn', 'c1'), done: () => ['c1', 'c2', 'c3'].includes(pr.cairn) },
    { id: 'boss1', at: arena(0), done: () => pr.defeated.includes('boss1') },
    { id: 'lever', at: M('lever', 'lever1'), done: () => pr.opened.includes('s1') },
    { id: 'cowrie2', at: M('item', 'cowrie2'), done: () => pr.items.includes('cowrie2') },
    { id: 'c2', at: M('cairn', 'c2'), done: () => ['c2', 'c3'].includes(pr.cairn) },
    { id: 'boss2', at: arena(1), done: () => pr.defeated.includes('boss2') },
    { id: 'c3', at: M('cairn', 'c3'), done: () => pr.cairn === 'c3' },
    { id: 'boss3', at: arena(2), done: () => pr.defeated.includes('boss3') },
    { id: 'ending', at: M('ending', 'end'), done: () => w.ended },
  ];
}

function run(seed: number, prof: () => BotProfile) {
  const w = new World({ seed, progress: newProgress() });
  let bot = new Bot(prof(), seed);
  const deathsAt: Record<string, number> = {};
  const goalTimes: Record<string, number> = {};
  let path: Vec[] | null = null, pathGoal = '', repath = 0;
  const maxT = ms2t(4 * 3600 * 1000);
  let stuck = 0, lastPos = { x: w.player.x, y: w.player.y };
  while (w.tick < maxT && !w.ended) {
    const gs = goals(w);
    const g = gs.find((x) => !x.done());
    if (!g) break;
    if (!path || pathGoal !== g.id || repath-- <= 0) {
      path = w.level.path(w.player, g.at, 30000); pathGoal = g.id; repath = 60;
    }
    if (path) {
      while (path.length > 1 && dist(w.player, path[0]) < 0.55) path.shift();
      bot.waypoint = path[0] ?? g.at;
    } else bot.waypoint = g.at;
    const inp = bot.decide(w);
    w.step(inp);
    bot.observe(w);
    for (const e of w.events) if (e.t === 'playerHit' && e.step) (prof as any).onHit?.(e.step.id);
    if (w.tick % 120 === 0) {
      if (dist(w.player, lastPos) < 0.3 && !w.fight && !w.player.target) stuck++; else stuck = 0;
      lastPos = { x: w.player.x, y: w.player.y };
      if (stuck > 10) return { ok: false, reason: `stuck before ${g.id} at ${w.player.x.toFixed(1)},${w.player.y.toFixed(1)}`, ms: w.tick * TICK_MS, deaths: w.progress.deaths, deathsAt, goalTimes };
    }
    if (!w.player.alive) {
      deathsAt[g.id] = (deathsAt[g.id] ?? 0) + 1;
      (prof as any).onDeath?.();
      for (let i = 0; i < 90; i++) w.step({ mx: 0, my: 0, attack: false, dodge: false, heal: false }); // death screen ~1.5 s
      w.respawn();
      bot = new Bot(prof(), seed + w.tick);
      path = null;
    }
    for (const x of gs) if (x.done() && goalTimes[x.id] === undefined) goalTimes[x.id] = Math.round(w.tick * TICK_MS / 1000);
    if (process.env.TRACE && w.tick % 1200 === 0) { const t = w.player.target; console.log(`t=${(w.tick/60)|0}s goal=${g.id} p=${w.player.x.toFixed(1)},${w.player.y.toFixed(1)} state=${w.player.state} hp=${w.player.hp|0} tgt=${t ? t.def.kind + '@' + t.x.toFixed(1) + ',' + t.y.toFixed(1) + ' ' + t.state : '-'} wp=${bot.waypoint ? bot.waypoint.x.toFixed(1)+','+bot.waypoint.y.toFixed(1) : '-'}`); }
  }
  return { ok: w.ended, reason: w.ended ? 'ended' : 'timeout', ms: w.tick * TICK_MS, deaths: w.progress.deaths, deathsAt, goalTimes };
}

import { ENEMY_DEFS, allSteps } from '../src/sim/defs';
import { sig } from './bot';
/** "first-timer": knows nothing, learns an attack after it has hit them twice (same model as run-sims' progressive learner) */
function firstTimer() {
  const known = new Set<string>(), hits = new Map<string, number>();
  let deaths = 0;
  const prof = (): BotProfile => {
    const practice = Math.min(1, deaths / 15);
    return { ...PROFILES.expert(), name: 'first-timer', timingSd: 70 - 30 * practice, errRate: 0.06 - 0.035 * practice, greed: 0.5 - 0.4 * practice,
      earlyBias: 60 - 60 * practice, healHp: 50, staminaReserve: Math.round(26 * practice), knows: (s) => known.has(s) };
  };
  (prof as any).onHit = (stepId: string) => {
    for (const d of Object.values(ENEMY_DEFS)) { const st = allSteps(d).find((x) => x.id === stepId); if (!st) continue;
      const k = sig(d.kind, st); hits.set(k, (hits.get(k) ?? 0) + 1); if (hits.get(k)! >= 2) known.add(k); }
  };
  (prof as any).onDeath = () => { deaths++; };
  return prof;
}
const mk = profName === 'learning' ? () => firstTimer() : () => () => PROFILES.expert();
for (let i = Number(process.env.FROM ?? 1); i <= runs; i++) {
  const r = run(i * 17, mk());
  console.log(`run ${i}: ${r.ok ? 'COMPLETE' : 'FAILED ' + r.reason}  ${(r.ms / 60000).toFixed(1)} min (sim time)  deaths ${r.deaths}  ${JSON.stringify(r.deathsAt)}  goals(s) ${JSON.stringify(r.goalTimes)}`);
}
