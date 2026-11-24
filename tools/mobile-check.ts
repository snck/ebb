/**
 * Headless mobile check (Chromium with touch emulation via CDP).
 *   npx tsx tools/mobile-check.ts            (expects `npm run dev` or `npm run preview` running; URL env to override)
 * For each phone size: layout + touch target sizes, real multi-touch input through the DOM, input→action latency,
 * button-gap mapping, frame timing under 4x CPU throttling (mid-range phone proxy), and whether the boss is ever
 * drawn underneath a thumb.
 */
import { chromium, Page, CDPSession } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const devices = [
  { name: 'small-iphone-se', w: 667, h: 375, dsf: 2 },
  { name: 'android-mid', w: 800, h: 360, dsf: 2.625 },
  { name: 'large-iphone-promax', w: 932, h: 430, dsf: 3 },
];
mkdirSync('tools/out', { recursive: true });

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number; id: number }[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 12, radiusY: 12, force: 1 })) });
}
const g = (p: Page, expr: string) => p.evaluate(expr);

const report: any = {};
const b = await chromium.launch();
for (const d of devices) {
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dsf, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.clear());
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(p);
  await p.goto(URL);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `tools/out/${d.name}-title.png` });
  await p.tap('#begin');
  await p.waitForTimeout(600);
  const r: any = { errors };
  // ---- layout
  const layout: any = await g(p, `(() => { const c = __game.controls; return { buttons: c.buttons.map(b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), d: Math.round(b.r*2) })), stick: c.stickRadius, pause: c.pauseRect }; })()`);
  r.layout = layout;
  const pxPerMm = 160 / 25.4; // CSS px per mm on typical phones
  r.minButtonMm = Math.min(...layout.buttons.map((x: any) => x.d / pxPerMm)).toFixed(1);
  r.pauseMm = (Math.max(layout.pause.w, 44) / pxPerMm).toFixed(1);
  // buttons must not overlap each other or the screen edge
  r.buttonsInside = layout.buttons.every((x: any) => x.x - x.d / 2 >= 0 && x.x + x.d / 2 <= d.w && x.y - x.d / 2 >= 0 && x.y + x.d / 2 <= d.h);
  // ---- stick: hold and drag right for 1 s, the player must move right
  const x0: number = await g(p, '__game.world.player.x') as number;
  const sx = 120, sy = d.h - 110;
  await touch(cdp, 'touchStart', [{ x: sx, y: sy, id: 1 }]);
  for (let i = 1; i <= 10; i++) { await touch(cdp, 'touchMove', [{ x: sx + i * 6, y: sy, id: 1 }]); await p.waitForTimeout(16); }
  await p.waitForTimeout(900);
  const x1: number = await g(p, '__game.world.player.x') as number;
  r.stickMovesRight = x1 - x0 > 2;
  // ---- multi-touch: keep holding the stick (pointing right) and tap dodge: roll must go right
  const dodge = layout.buttons.find((x: any) => x.id === 'dodge');
  const tick0 = await g(p, '__game.world.tick') as number;
  await touch(cdp, 'touchStart', [{ x: sx + 60, y: sy, id: 1 }, { x: dodge.x, y: dodge.y, id: 2 }]);
  let rolled = -1;
  for (let i = 0; i < 20; i++) {
    const st = await g(p, '__game.world.player.state');
    if (st === 'roll') { rolled = (await g(p, '__game.world.tick') as number) - tick0; break; }
    await p.waitForTimeout(8);
  }
  r.multiTouchRoll = rolled >= 0;
  r.rollDirX = await g(p, '__game.world.player.rollDx');
  await touch(cdp, 'touchEnd', []);
  await p.waitForTimeout(700);
  // ---- input → action latency (ticks) for attack, measured on state change
  const atk = layout.buttons.find((x: any) => x.id === 'attack');
  const lat: number[] = [];
  for (let k = 0; k < 6; k++) {
    await p.waitForTimeout(900);
    const t0: number = await g(p, 'performance.now()') as number;
    await touch(cdp, 'touchStart', [{ x: atk.x + 5, y: atk.y - 5, id: 3 }]);
    await touch(cdp, 'touchEnd', []);
    const t1: number = await p.evaluate(`new Promise(res => { const f = () => (__game.world.player.state === 'attack' ? res(performance.now()) : requestAnimationFrame(f)); f(); })`) as number;
    lat.push(t1 - t0);
  }
  r.attackLatencyMs = lat.map((x) => Math.round(x));
  // ---- the gap between attack and dodge must still map to a button (no dead zone)
  const mid = { x: (atk.x + dodge.x) / 2, y: (atk.y + dodge.y) / 2 };
  await p.waitForTimeout(900);
  await touch(cdp, 'touchStart', [{ x: mid.x, y: mid.y, id: 4 }]); await touch(cdp, 'touchEnd', []);
  await p.waitForTimeout(60);
  r.gapPressMapped = await g(p, `['attack','roll'].includes(__game.world.player.state)`);
  await p.screenshot({ path: `tools/out/${d.name}-play.png` });
  // ---- boss fight under 4x CPU throttle: frame timing + is the boss ever under a thumb?
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await g(p, `(() => { const w = __game.world; w.progress.defeated = []; const a = w.level.data.arenas[0]; w.player.x = 22.5; w.player.y = 16; __game.save.tut = { moved: true, attacked: true, dodged: true, healed: true, slowmoShown: true }; })()`);
  await p.waitForTimeout(1500);
  await g(p, `__game.stats = { frames: 0, longFrames: 0, worstMs: 0 }`);
  const under: number[] = [];
  const onScreen: boolean[] = [];
  // circle around while the boss attacks (keep the player alive so we can observe)
  await touch(cdp, 'touchStart', [{ x: sx, y: sy, id: 5 }]);
  for (let i = 0; i < 120; i++) {
    const a = i / 8;
    await touch(cdp, 'touchMove', [{ x: sx + Math.cos(a) * 40, y: sy + Math.sin(a) * 40, id: 5 }]);
    const v: any = await g(p, `(() => { const G = __game, w = G.world, R = G.renderer; w.player.hp = 100; const b = w.fight && w.fight.boss; if (!b) return null;
      const X = R.sx(b.x), Y = R.sy(b.y); const cs = G.controls.buttons; const st = G.controls.stick;
      const underBtn = cs.some(c => Math.hypot(c.x - X, c.y - Y) < c.r + 10);
      const underStick = st.active && Math.hypot(st.ox - X, st.oy - Y) < G.controls.stickRadius + 30;
      return { under: underBtn || underStick, on: X > 0 && X < R.w && Y > 0 && Y < R.h, attacking: b.state === 'attack' }; })()`);
    if (v) { onScreen.push(v.on); if (!v.on) console.log('  boss off-screen at sample', i); if (v.attacking) under.push(v.under ? 1 : 0); }
    if (i === 60) await p.screenshot({ path: `tools/out/${d.name}-boss.png` });
    await p.waitForTimeout(50);
  }
  await touch(cdp, 'touchEnd', []);
  const stats: any = await g(p, '({ ...__game.stats, fps: __game.fps, dpr: __game.renderer.dpr })');
  r.bossFrames = stats;
  r.bossAlwaysOnScreen = onScreen.every((x) => x);
  r.bossUnderThumbWhileAttackingPct = under.length ? +(100 * under.reduce((a, b2) => a + b2, 0) / under.length).toFixed(1) : null;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // ---- pause on background
  await g(p, `document.dispatchEvent(new Event('visibilitychange'))`);
  await p.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))`);
  await p.waitForTimeout(100);
  r.pausesWhenHidden = (await g(p, '__game.screen')) === 'pause';
  r.savedProgress = await g(p, `!!localStorage.getItem('ebb.save.v1')`);
  await p.screenshot({ path: `tools/out/${d.name}-pause.png` });
  report[d.name] = r;
  console.log(d.name, JSON.stringify(r, null, 1));
  await ctx.close();
}
await b.close();
writeFileSync('tools/out/mobile-check.json', JSON.stringify(report, null, 2));
