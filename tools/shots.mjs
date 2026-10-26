// Audit run on GitHub (by .github/workflows/shots.yml): clicks through the whole live app on a phone-sized screen
// and records any errors, failed requests and slow frames.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch(), out = [], errs = [];
const p = await b.newPage({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
p.on('pageerror', e => errs.push('PAGE ERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`console.${m.type()} ${m.text().slice(0, 200)}`); });
p.on('requestfailed', r => errs.push(`FAILED ${r.failure()?.errorText} ${r.url().slice(0, 140)}`));
p.on('response', r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`); });
const step = async (name, fn) => { const n = errs.length; try { await fn(); } catch (e) { errs.push(`STEP ${name} threw ${e.message.split('\n')[0]}`); } out.push(`${name}${errs.length > n ? '  <- ' + (errs.length - n) + ' issue(s)' : ''}`); };
const click = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) throw new Error('missing ' + s); e.click(); }, s);
const wait = ms => p.waitForTimeout(ms);
await step('open', async () => { await p.goto('https://issaunited24.github.io/news/?v=' + Date.now()); await wait(6000); });
out.push('version ' + await p.evaluate(() => APP_VERSION));
for (const t of ['forex', 'top', 'justin', 'world', 'us', 'sci', 'tech', 'ent', 'sports']) await step('tab ' + t, async () => {
  await click(`.tab[data-tab="${t}"]`); await wait(1500);
  const n = await p.evaluate(() => document.querySelectorAll('#feed [data-id], #top [data-id]').length);
  if (!n) errs.push(`tab ${t}: no stories shown`);
  await p.mouse.wheel(0, 2500); await wait(800); await p.mouse.wheel(0, -2500); await wait(400);
});
await step('brief', async () => {
  await click('.tab[data-tab="forex"]'); await wait(1000);
  await p.evaluate(() => { prefs.briefOpen = nyDay(new Date()); prefs.briefHid = ''; renderTop(); scrollTo(0, document.getElementById('top').getBoundingClientRect().top + scrollY - 70); });
  await wait(1200); await p.screenshot({ path: 'out/brief.png' });
  out.push('  brief: ' + await p.evaluate(() => { const b = document.getElementById('brief'); return b ? `${b.querySelectorAll('.br-mv div').length} moves, ${b.querySelectorAll('.br-st').length} stories, ${b.querySelectorAll('.br-ev').length} releases` : 'missing'; }));
  out.push('  bias: ' + await p.evaluate(() => [...document.querySelectorAll('.bi')].map(b => b.innerText.replace(/\s+/g, ' ')).join(' | ')));
  await p.evaluate(() => document.querySelector('.bias')?.scrollIntoView({ block: 'center' })); await wait(500);
  await p.screenshot({ path: 'out/bias.png' });
  out.push('  big money: ' + await p.evaluate(() => [...document.querySelectorAll('.bmc')].map(b => b.innerText.replace(/\s+/g, ' ')).join(' | ')));
  await p.evaluate(() => { prefs.calOpen = true; renderTop(); document.querySelector('.cal')?.scrollIntoView({ block: 'start' }); }); await wait(800);
  await p.screenshot({ path: 'out/calendar.png' });
  await p.evaluate(() => { prefs.calOpen = false; renderTop(); document.getElementById('brief')?.scrollIntoView({ block: 'center' }); }); await wait(500);
  await click('#brief [data-act="briefHide"]'); await wait(600);
  out.push('  after hide: ' + await p.evaluate(() => document.querySelector('.brief-mini') ? 'small button' : document.getElementById('brief') ? 'still open' : 'gone'));
  await p.evaluate(() => scrollTo(0, 0));
});
await step('forex order', async () => {
  await click('.tab[data-tab="forex"]'); await wait(1200); await p.evaluate(() => scrollTo(0, 0));
  out.push('  forex order: ' + await p.evaluate(() => [...document.querySelectorAll('#top > *, #top .fxmods > *')].map(e => e.id || e.className.split(' ')[0]).filter(Boolean).join(' > ')));
  const top = await p.$('#top'); if (top) await top.screenshot({ path: 'out/forex-top.png' });
});
await step('refresh button', async () => {
  await p.evaluate(() => scrollTo(0, 0)); await wait(300);
  await p.screenshot({ path: 'out/header.png', clip: { x: 0, y: 0, width: 412, height: 120 } });
  await click('#btnRefresh'); await wait(250);
  out.push('  refresh: spinning ' + await p.evaluate(() => document.getElementById('btnRefresh').classList.contains('spin')));
  await wait(3000); out.push('  refresh toast: ' + await p.evaluate(() => document.querySelector('.toast, #toast')?.textContent?.trim() || 'none'));
});
await step('ai story', async () => {
  await click('.tab[data-tab="forex"]'); await wait(1000);
  const has = await p.evaluate(() => { const el = document.querySelector('#feed .aip'); const card = el?.closest('[data-id]'); if (card) { card.click(); return true; } return false; });
  if (!has) { out.push('  ai story: none analysed yet'); return; }
  await wait(4000);
  out.push('  ai panel: ' + await p.evaluate(() => (document.getElementById('aiPanel')?.innerText || 'missing').replace(/\s+/g, ' ').slice(0, 300)));
  await p.evaluate(() => document.getElementById('aiPanel')?.scrollIntoView({ block: 'start' })); await wait(500);
  await p.screenshot({ path: 'out/ai-story.png' });
  await p.keyboard.press('Escape'); await wait(600);
});
await step('sections', async () => {
  for (const t of ['sci', 'tech', 'ent']) out.push(`  ${t} odd: ` + await p.evaluate(t => storiesFor(t, false).filter(s => /\b(fed|fomc|rate hikes?|election|runoff|missiles?|futures)\b/i.test(s.title)).slice(0, 4).map(s => s.title.slice(0, 60)).join(' | ') || 'none', t));
});
await step('open story', async () => { await click('.tab[data-tab="world"]'); await wait(800); await click('#feed [data-id]'); await wait(1200); });
await step('close story', async () => { await p.keyboard.press('Escape'); await wait(600); await p.evaluate(() => document.querySelector('[data-close]')?.click()); await wait(600); });
await step('story menu', async () => { await click('#feed [data-act="menu"]'); await wait(700); await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelector('#scrim')?.click()); await wait(500); });
await step('forex chart', async () => { await click('.tab[data-tab="forex"]'); await wait(1200); await click('[data-pick="oil"]'); await wait(1500); await p.screenshot({ path: 'out/oil-stage.png' }); out.push('  oil live price: ' + await p.evaluate(() => live.oil ? live.oil.p : 'none')); await click('[data-chart]'); await wait(2500); });
for (const r of ['1H', '4H', '1D', '1W', '1M', '1Y', '5Y', 'ALL']) await step('range ' + r, async () => { await p.evaluate(r => [...document.querySelectorAll('#chartPanel button')].find(x => x.textContent.trim().toUpperCase() === r)?.click(), r); await wait(900); });
await p.screenshot({ path: 'out/chart.png' });
await step('close chart', async () => { await p.evaluate(() => document.querySelector('#chartPanel [data-close], #chartPanel .close')?.click()); await p.keyboard.press('Escape'); await wait(800); });
await step('calendar', async () => { await p.evaluate(() => document.querySelector('#calTog')?.click()); await wait(1000); });
await step('search', async () => { await click('#btnSearch'); await wait(500); await p.fill('#q', 'gold'); await wait(1200); await click('#qClose'); await wait(600); });
await step('saved', async () => { await click('#btnSaved'); await wait(800); await click('#btnSaved'); await wait(600); });
await step('settings', async () => { await click('#btnSettings'); await wait(900); await p.evaluate(() => document.querySelector('#scrim')?.click()); await wait(600); });
await step('important/all', async () => { await click('.tab[data-tab="top"]'); await wait(600); await click('#fAll'); await wait(800); await click('#fImp'); await wait(600); });
// smoothness: frame times while scrolling the longest tab
await step('scroll speed', async () => {
  await click('.tab[data-tab="us"]'); await wait(1000);
  const r = await p.evaluate(async () => { const t = []; let last = performance.now(); let run = true;
    const f = now => { t.push(now - last); last = now; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
    for (let i = 0; i < 40; i++) { scrollBy(0, 120); await new Promise(r => setTimeout(r, 25)); } run = false; await new Promise(r => setTimeout(r, 100));
    t.sort((a, b) => a - b); return { frames: t.length, median: t[t.length >> 1].toFixed(1), p95: t[Math.floor(t.length * .95)].toFixed(1), long: t.filter(x => x > 50).length }; });
  out.push('  scroll frames ' + JSON.stringify(r));
});
await step('offline', async () => {
  await p.reload(); await wait(5000);
  out.push('  offline worker active: ' + await p.evaluate(() => !!navigator.serviceWorker?.controller));
  out.push('  installable manifest icons: ' + await p.evaluate(async () => (await (await fetch('manifest.json')).json()).icons.length));
  await p.context().setOffline(true); await p.reload(); await wait(4000);
  out.push('  stories shown with no signal: ' + await p.evaluate(() => document.querySelectorAll('[data-id]').length));
  await p.context().setOffline(false);
});
out.push('memory MB ' + await p.evaluate(() => performance.memory ? (performance.memory.usedJSHeapSize / 1e6).toFixed(1) : '?'));
out.push('nodes ' + await p.evaluate(() => document.getElementsByTagName('*').length));
await p.screenshot({ path: 'out/end.png' });
await b.close();
const res = out.join('\n') + '\n\nISSUES (' + errs.length + ')\n' + [...new Set(errs)].join('\n');
console.log(res); await writeFile('out/audit.txt', res);
