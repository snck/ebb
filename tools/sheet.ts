/** contact sheet of screenshots: npx tsx tools/sheet.ts out.png img1 img2 ... */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [out, ...imgs] = process.argv.slice(2);
const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(2,667px);gap:4px">${imgs.map((f) => `<div style="position:relative"><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" width=667 height=375><span style="position:absolute;left:4px;top:4px;color:#ff0;font:12px monospace;background:#000">${f.split('/').pop()}</span></div>`).join('')}</body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1338, height: 400 } });
await p.setContent(html); await p.screenshot({ path: out, fullPage: true }); await b.close();
