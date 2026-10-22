// One-off checks run on GitHub (by .github/workflows/shots.yml): which economic calendar sources work, from the robot and from a web page
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const from = new Date(Date.now() - 3 * 864e5).toISOString(), to = new Date(Date.now() + 4 * 864e5).toISOString();
const urls = {
  tvCal: `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US`,
  ffJson: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
};
const out = [];
for (const [k, u] of Object.entries(urls)) {
  for (const [label, headers] of [['plain', {}], ['tvOrigin', { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' }]]) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }); const t = await r.text(); out.push(`robot ${k} ${label}: ${r.status} ${t.length} ${t.slice(0, 700).replace(/\s+/g, ' ')}`); }
    catch (e) { out.push(`robot ${k} ${label}: FAIL ${e.message}`); }
  }
}
const b = await chromium.launch(); const pg = await b.newPage();
await pg.goto('https://issaunited24.github.io/news/version.txt');
const browser = await pg.evaluate(async u => { try { const r = await fetch(u); const t = await r.text(); return `${r.status} ${t.slice(0, 300)}`; } catch (e) { return 'FAIL ' + e.message; } }, urls.tvCal);
out.push('browser tvCal: ' + browser);
await b.close();
console.log(out.join('\n')); await writeFile('out/cal.txt', out.join('\n'));
