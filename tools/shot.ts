/** quick screenshot helper: npx tsx tools/shot.ts <out.png> [w h] [script] */
import { chromium } from 'playwright';
const [out = 'tools/out/shot.png', w = '667', h = '375', script = ''] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5173/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.goto(url);
await p.waitForTimeout(500);
if (script) await eval(`(async () => { ${script} })()`);
await p.screenshot({ path: out });
await b.close();
