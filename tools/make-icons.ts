/** Renders the app icons with a headless browser (original art: a lantern above a receding tide line). */
import { chromium } from 'playwright';
const html = `<canvas id=c width=512 height=512></canvas><script>
const c=document.getElementById('c').getContext('2d');
const g=c.createLinearGradient(0,0,0,512);g.addColorStop(0,'#0b1218');g.addColorStop(1,'#1d3440');c.fillStyle=g;c.fillRect(0,0,512,512);
for(let i=0;i<5;i++){c.strokeStyle='rgba(170,215,230,'+(0.5-i*0.08)+')';c.lineWidth=10-i;c.beginPath();c.moveTo(60,330+i*34);c.bezierCurveTo(180,300+i*34,330,360+i*34,452,320+i*34);c.stroke();}
const r=c.createRadialGradient(256,210,0,256,210,170);r.addColorStop(0,'rgba(255,200,120,0.85)');r.addColorStop(1,'rgba(255,170,80,0)');c.fillStyle=r;c.fillRect(0,0,512,512);
c.fillStyle='#f6d9a0';c.beginPath();c.ellipse(256,215,46,62,0,0,7);c.fill();
c.strokeStyle='#3a2c1c';c.lineWidth=12;c.beginPath();c.moveTo(256,125);c.lineTo(256,153);c.stroke();c.beginPath();c.arc(256,118,18,Math.PI,0);c.stroke();
</script>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.setContent(html);
for (const s of [512, 192, 180]) {
  await p.setViewportSize({ width: 512, height: 512 });
  const el = await p.$('#c');
  const buf = await el!.screenshot();
  if (s === 512) (await import('node:fs')).writeFileSync('public/icon-512.png', buf);
  else {
    const p2 = await b.newPage({ viewport: { width: s, height: s } });
    await p2.setContent(`<body style="margin:0"><img src="data:image/png;base64,${buf.toString('base64')}" width=${s} height=${s}></body>`);
    (await import('node:fs')).writeFileSync(`public/icon-${s}.png`, await p2.screenshot());
  }
}
await b.close();
console.log('icons written');
