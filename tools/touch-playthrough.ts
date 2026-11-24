/**
 * Plays the real client in a headless phone browser through REAL TOUCH EVENTS (CDP), start → ending.
 * The decisions come from the human-limited expert bot (running inside the page), but every action reaches
 * the game only as a touch on the stick or a button, exactly as a thumb would deliver it.
 *   npx tsx tools/touch-playthrough.ts [w=667] [h=375] [minutes=25]   (dev server running)
 */
import { chromium } from 'playwright';
const [W = '667', H = '375', MIN = '25'] = process.argv.slice(2);
const URL = process.env.URL ?? 'http://localhost:5173/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => localStorage.clear());
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(p);
await p.goto(URL); await p.waitForTimeout(400);
await p.tap('#begin'); await p.waitForTimeout(300);
await p.evaluate(`(async () => {
  const { Bot, PROFILES } = await import('/tools/bot.ts');
  const G = window.__game;
  window.__bot = new Bot(PROFILES.expert(), 7);
  const w = G.world, orig = w.step.bind(w);
  window.__log = [];
  w.step = (inp) => { orig(inp); window.__bot.observe(w); for (const e of w.events) if (['rest','item','bossStart','bossDefeated','playerDeath','lever','note','ending','bossPhase'].includes(e.t)) window.__log.push((w.tick/60).toFixed(0) + 's ' + e.t + ' ' + (e.name || e.id || e.kind || e.boss || (e.cause && e.cause.attack + ' / ' + e.cause.doing) || '')); };
  window.__goal = () => {
    const pr = w.progress, M = (t, id) => w.level.data.markers.find(m => m.type === t && m.id === id), A = (i) => ({ x: w.level.data.arenas[i].cx, y: w.level.data.arenas[i].cy });
    const gs = [['c0', M('cairn','c0'), pr.playMs > 4000], ['cowrie1', M('item','cowrie1'), pr.items.includes('cowrie1')], ['c1', M('cairn','c1'), ['c1','c2','c3'].includes(pr.cairn)],
      ['boss1', A(0), pr.defeated.includes('boss1')], ['lever', M('lever','lever1'), pr.opened.includes('s1')], ['cowrie2', M('item','cowrie2'), pr.items.includes('cowrie2')],
      ['c2', M('cairn','c2'), ['c2','c3'].includes(pr.cairn)], ['boss2', A(1), pr.defeated.includes('boss2')], ['c3', M('cairn','c3'), pr.cairn === 'c3'], ['boss3', A(2), pr.defeated.includes('boss3')], ['end', M('ending','end'), w.ended]];
    return gs.find(g => !g[2]);
  };
})()`);
if (process.env.FROM_BOSS3) await p.evaluate(`(() => { const w = __game.world; Object.assign(w.progress, { cairn: 'c3', defeated: ['boss1','boss2'], opened: ['s1'], items: ['cowrie1','cowrie2'] }); w.respawn(); })()`);
const lay: any = await p.evaluate(`__game.controls.buttons.map(b => ({ id: b.id, x: b.x, y: b.y }))`);
const btn = (id: string) => lay.find((x: any) => x.id === id);
const R = 40, SX = 120, SY = +H - 110;
let stick: { x: number; y: number } | null = null;
const send = (type: string, pts: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: type as any, touchPoints: pts.map((q) => ({ ...q, radiusX: 10, radiusY: 10, force: 1 })) });
const t0 = Date.now();
let taps = 0, lastGoal = '';
while (Date.now() - t0 < +MIN * 60000) {
  const st: any = await p.evaluate(`(() => { const G = __game, w = G.world;
    if (G.screen !== 'play') return { screen: G.screen };
    const g = __goal(); if (!g) return { done: true };
    let path = w.level.path(w.player, g[1], 30000);
    if (path) { while (path.length > 1 && Math.hypot(path[0].x - w.player.x, path[0].y - w.player.y) < 0.55) path.shift(); }
    __bot.waypoint = path ? path[0] : g[1];
    const inp = __bot.decide(w);
    return { screen: 'play', goal: g[0], inp, ended: w.ended };
  })()`);
  if (st.done || st.screen === 'ending') { console.log('REACHED THE ENDING'); break; }
  if (st.screen === 'dead') { if (stick) { await send('touchEnd', []); stick = null; } await p.waitForTimeout(1700); await p.tap('#rise').catch(() => {}); await p.waitForTimeout(200); continue; }
  if (st.screen !== 'play') { await p.waitForTimeout(100); continue; }
  if (st.goal !== lastGoal) { console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s real → goal ${st.goal}`); lastGoal = st.goal; }
  const inp = st.inp;
  const m = Math.hypot(inp.mx, inp.my);
  const pts: { x: number; y: number; id: number }[] = [];
  if (m > 0.1) {
    const q = { x: SX + (inp.mx / m) * R * Math.min(1, m) * 1.2, y: SY + (inp.my / m) * R * Math.min(1, m) * 1.2, id: 1 };
    if (!stick) { await send('touchStart', [{ x: SX, y: SY, id: 1 }]); }
    await send('touchMove', [q]); stick = q; pts.push(q);
  } else if (stick) { await send('touchEnd', []); stick = null; }
  const press = inp.dodge ? 'dodge' : inp.attack ? 'attack' : inp.heal ? 'heal' : null;
  if (press) {
    const bt = btn(press);
    await send('touchStart', [...pts, { x: bt.x + (Math.random() - 0.5) * 20, y: bt.y + (Math.random() - 0.5) * 20, id: 2 }]);
    await send('touchEnd', pts);
    taps++;
  }
  await p.waitForTimeout(12);
}
const log: string[] = await p.evaluate('__log') as string[];
const pr: any = await p.evaluate('__game.world.progress');
console.log(log.filter((l) => !l.includes(' note ')).join('\n'));
console.log(`taps ${taps}, deaths ${pr.deaths}, defeated ${pr.defeated}, real ${((Date.now() - t0) / 60000).toFixed(1)} min, fps ${await p.evaluate('__game.fps')}, errors ${JSON.stringify(errors)}`);
await p.screenshot({ path: `tools/out/touch-playthrough-${W}x${H}.png` });
await b.close();
