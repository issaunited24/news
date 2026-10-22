// Takes phone-sized screenshots of the live app (run by .github/workflows/shots.yml) so the real photos and live charts can be checked
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const pg = await ctx.newPage();
await pg.goto('https://issaunited24.github.io/news/?t=' + Date.now(), { waitUntil: 'networkidle' });
await pg.waitForTimeout(4000);
console.log('App version:', await pg.evaluate(() => APP_VERSION));
await pg.evaluate(() => window.scrollTo(0, 560)); await pg.waitForTimeout(6000);
await pg.screenshot({ path: 'out/forex-stage.png' });
await pg.click('.stage-tap'); await pg.waitForTimeout(9000);
await pg.screenshot({ path: 'out/forex-chart.png' });
await b.close();
