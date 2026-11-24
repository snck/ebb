/** Prints a markdown table of every attack's tell-to-hit window and checks the fairness rules.  npx tsx tools/fairness-report.ts */
import { ENEMY_DEFS } from '../src/sim/defs';
import { stepWindows, checkFairness, MIN_REACT_MS } from '../src/sim/fairness';

const lines: string[] = [];
lines.push('| Enemy | Attack | Tell (pose / sound) | Cue | Cue→hit (ms) | Gap from prev hit | Active | Recovery (punish) | Notes |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const def of Object.values(ENEMY_DEFS)) {
  for (const w of stepWindows(def)) {
    lines.push(`| ${w.enemy} | ${w.name} | ${w.tell} | ${w.cue} | **${w.cueToHitMs}**${w.cueToHitMs < MIN_REACT_MS ? ' ⚠' : ''} | ${w.gapFromPrevHitMs ?? '–'} | ${w.activeMs} | ${w.recoveryMs ?? '(combo)'} | ${w.notes} |`);
  }
}
console.log(lines.join('\n'));
const v = checkFairness();
console.log(`\nViolations: ${v.length}`);
for (const x of v) console.log(` - ${x.id}: ${x.rule} (${x.detail})`);
const all = Object.values(ENEMY_DEFS).flatMap(stepWindows);
const min = all.reduce((a, b) => (b.cueToHitMs < a.cueToHitMs ? b : a));
console.log(`Shortest cue→hit: ${min.cueToHitMs} ms (${min.enemy}: ${min.name})`);
