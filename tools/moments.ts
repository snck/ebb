/** Screenshots of key moments for visual review.  npx tsx tools/moments.ts  (dev server running) */
import { chromium, Page } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:5173/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => localStorage.clear());
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('page error', e.message));
await p.goto(URL); await p.waitForTimeout(300);
await p.tap('#begin'); await p.waitForTimeout(300);
const ev = (s: string) => p.evaluate(s);
const shot = async (n: string) => { await p.screenshot({ path: `tools/out/m-${n}.png` }); console.log('shot', n); };
// 1. start: tutorial stick hint
await shot('01-start');
// 2. walk to the sleeping novice and wait for its first tell (slow-mo)
await ev(`(() => { const w = __game.world; w.player.x = 24; w.player.y = 55.5; })()`);
await p.waitForFunction(`__game.world.enemies.some(e => e.state === 'attack' && e.stepT > 15)`, null, { timeout: 15000 });
await shot('02-first-tell');
// 3. boss poses
async function boss(i: number, kind: string, stepId: string, frac: number, name: string, prep = '') {
  await ev(`(() => { const G = __game, w = G.world; w.player.hp = 100;
    const a = w.level.data.arenas[${i}]; w.progress.defeated = ['boss1','boss2','boss3'].slice(0, ${i});
    w.respawn(); w.player.x = a.cx - 3; w.player.y = a.cy + 1.5; ${prep} })()`);
  await p.waitForFunction(`(() => { const w = __game.world; w.player.hp = 100; const b = w.fight && w.fight.boss; if (!b || !b.curStep) return false;
     return b.curStep.id === '${stepId}' && b.stepT >= Math.round(b.curStep.windup / 16.667 * ${frac}); })()`, null, { timeout: 60000, polling: 'raf' });
  await shot(name);
}
await boss(0, 'netwarden', 'nw.slam', 0.6, '03-netwarden-slam-windup');
await boss(0, 'netwarden', 'nw.sweep', 1.05, '04-netwarden-sweep-active');
await boss(1, 'cantor', 'ca.hymn', 0.6, '05-cantor-hymn');
await boss(1, 'cantor', 'ca.cut3', 0.5, '06-cantor-late-cut');
await boss(2, 'abbess', 'ab.dive', 0.85, '07-abbess-dive-locked');
await boss(2, 'abbess', 'ab.wave', 1.4, '08-abbess-wave');
// 4. death screen
await ev(`(() => { const w = __game.world; w.player.hp = 1; })()`);
await p.waitForFunction(`__game.screen === 'dead'`, null, { timeout: 30000, polling: 'raf' }).catch(() => {});
await ev(`(() => { const w = __game.world; if (__game.screen !== 'dead') { w.player.receiveHit(w, 999, 'Mother Ebb', w.enemies.find(e=>e.boss).def.attacks[0].steps[0], w.player.x+1, w.player.y); } })()`);
await p.waitForTimeout(2600);
await shot('09-death');
// 5. victory
await p.tap('#rise').catch(() => {}); await p.waitForTimeout(500);
await ev(`(() => { const w = __game.world; const a = w.level.data.arenas[2]; w.player.x = a.cx - 3; w.player.y = a.cy; })()`);
await p.waitForFunction(`!!__game.world.fight && __game.world.fight.boss.state !== 'intro'`, null, { timeout: 10000, polling: 'raf' });
await ev(`(() => { const w = __game.world; const b = w.fight.boss; b.hp = 1; w.player.x = b.x - 2.0; w.player.y = b.y; w.player.facing = 0; __game.controls.queue.push('attack'); })()`);
await p.waitForTimeout(2200);
await shot('10-victory');
// 6. ending
await ev(`(() => { const w = __game.world; const e = w.markers('ending')[0]; w.player.x = e.x; w.player.y = e.y; })()`);
await p.waitForTimeout(4500);
await shot('11-ending');
await b.close();
