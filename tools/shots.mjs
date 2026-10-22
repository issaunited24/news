// Checks on GitHub (by .github/workflows/shots.yml): do the big cover titles fit on phone screens, with the real fonts?
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch(), out = [];
for (const width of [412, 384, 360]) {
  const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('https://issaunited24.github.io/news/?v=' + Date.now()); await p.waitForTimeout(6000);
  out.push(`width ${width} version ${await p.evaluate(() => typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?')}`);
  for (const t of ['forex', 'top', 'justin', 'world', 'us', 'sci', 'tech', 'ent', 'sports']) {
    await p.evaluate(t => document.querySelector(`.tab[data-tab="${t}"]`)?.click(), t); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => { const e = document.querySelector('#mast .word'); const s = getComputedStyle(e).fontSize; e.style.animation = 'none'; e.style.width = 'max-content'; const w = e.getBoundingClientRect(); e.style.width = ''; return `${e.textContent} ${s} right=${Math.round(w.right)}`; });
    out.push(`  ${t}: ${r} ${await p.evaluate(w => document.querySelector('#mast .word').getBoundingClientRect().right <= w ? '' : 'TOO WIDE', width)}`);
    if (width === 412 && ['world', 'sci', 'ent'].includes(t)) await p.screenshot({ path: `out/${t}.png`, clip: { x: 0, y: 0, width, height: 420 } });
  }
  await p.close();
}
await b.close();
console.log(out.join('\n')); await writeFile('out/fit.txt', out.join('\n'));
