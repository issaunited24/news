// Checks on GitHub (by .github/workflows/shots.yml): phone screenshots of every tab's cover, and the cover photo options page
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch(), out = [];
const p = await b.newPage({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 2 });
await p.goto('https://issaunited24.github.io/news/?v=' + Date.now()); await p.waitForTimeout(6000);
out.push(`version ${await p.evaluate(() => typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?')}`);
for (const t of ['forex', 'top', 'justin', 'world', 'us', 'sci', 'tech', 'ent', 'sports']) {
  await p.evaluate(t => document.querySelector(`.tab[data-tab="${t}"]`)?.click(), t); await p.waitForTimeout(3500);
  out.push(t + ' ' + await p.evaluate(() => { const i = document.querySelector('.bd img.on'); return i ? `${i.naturalWidth}x${i.naturalHeight} ${i.style.cssText}` : 'no img'; }));
  await p.screenshot({ path: `out/tab-${t}.png`, clip: { x: 0, y: 0, width: 412, height: 400 } });
}
const q = await b.newPage({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 1 });
await q.goto('https://issaunited24.github.io/news/previews/covers.html?v=' + Date.now()); await q.waitForTimeout(3000);
await q.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 400)); } scrollTo(0, 0); });
await q.waitForTimeout(3000);
await q.screenshot({ path: 'out/covers.png', fullPage: true });
await b.close();
console.log(out.join('\n')); await writeFile('out/fit.txt', out.join('\n'));
