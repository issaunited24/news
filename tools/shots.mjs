// Runs checks against the live site (by .github/workflows/shots.yml): screenshots and the price source test
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const pg = await ctx.newPage();
await pg.goto('https://issaunited24.github.io/news/previews/cors-test.html?t=' + Date.now());
await pg.waitForFunction(() => !document.getElementById('o').textContent.startsWith('running'), null, { timeout: 60000 }).catch(() => {});
const txt = await pg.evaluate(() => document.getElementById('o').textContent);
console.log(txt); await writeFile('out/cors.txt', txt);
await b.close();
