// Takes phone-sized screenshots of the live app (run by .github/workflows/shots.yml) so the real photos can be checked
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const pg = await ctx.newPage();
await pg.goto('https://issaunited24.github.io/news/?t=' + Date.now(), { waitUntil: 'networkidle' });
await pg.waitForTimeout(3000);
for (const t of ['top', 'justin', 'world', 'us', 'forex', 'tech']) {
  await pg.click(`#tabs [data-tab=${t}]`); await pg.waitForTimeout(3500);
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(800);
  await pg.screenshot({ path: `out/${t}.png` });
  await pg.evaluate(() => window.scrollTo(0, 1000)); await pg.waitForTimeout(2500);
  await pg.screenshot({ path: `out/${t}-list.png` });
}
await b.close();
