// Collects news from every feed in feeds.json, groups and ranks it, and writes data/news.json for the app.
// Runs on GitHub's free robot (GitHub Actions) every ~10 minutes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { entries, all, first, textOf } from './xml.mjs';
import { marketCatalyst, isPriceRecap } from './markets.mjs';
import { classify } from './categories.mjs';
import { cluster, scoreStory, analyzeFx, calendarEvent, policyOf, trustRank, isJunkOutlet, notEnglish, qualityAdjust } from './rules.mjs';

const ROOT = new URL('../', import.meta.url);
const WINDOW_H = 36;           // keep stories from the last 36 hours
const MAX_ITEMS = 2500;
const CAL_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FIXTURES = process.env.FIXTURES; // local testing: folder of saved feeds

const now = Date.now();
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(new URL(p, ROOT), 'utf8')); } catch { return fallback; } };

const config = await readJson('feeds.json');
const prevState = await readJson('data/state.json', { items: [], calendar: null });
const keywords = {
  high: config.keywords.high.map(k => k.toLowerCase()),
  low: config.keywords.low.map(k => k.toLowerCase()),
};

function feedUrl(src) {
  if (src.url) return src.url;
  const q = encodeURIComponent(`${src.google} when:1d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchText(url, i) {
  if (FIXTURES) return readFile(`${FIXTURES}/${i}.xml`, 'utf8');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const clean = s => decode(decode(String(s || '')).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Same outlet, different spellings ("The New York Times" / "New York Times", "Bloomberg.com")
function normOutlet(o) {
  let n = String(o || '').trim();
  if (n.includes(' | ')) n = n.split(' | ').pop();
  n = n.replace(/\.com$/i, '').replace(/^www\./i, '');
  if (/^the new york times$/i.test(n)) n = 'New York Times';
  if (/^yahoo!?\s.*finance/i.test(n)) n = 'Yahoo Finance';
  if (/^the daily wire$/i.test(n)) n = 'Daily Wire';
  return n;
}

function imageOf(x) {
  for (const t of ['media:thumbnail', 'media:content']) for (const m of all(x, t)) {
    const u = m.attrs.url; if (u && !/\.(mp4|mp3|m3u8)(\?|$)/i.test(u) && !/^(video|audio)/i.test(m.attrs.medium || m.attrs.type || '')) return decode(u);
  }
  for (const e of all(x, 'enclosure')) if (e.attrs.url && /^image/i.test(e.attrs.type || 'image')) return decode(e.attrs.url);
  const html = decode(textOf(x, 'content:encoded', 'description', 'content'));
  const m = html.match(/<img[^>]+src=["']([^"']+)/i);
  return m ? decode(m[1]) : null;
}

function parseFeed(xmlText, src) {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xmlText)) throw new Error('not a feed');
  const out = [];
  for (const { atom, xml: x } of entries(xmlText)) {
    let title = clean(textOf(x, 'title'));
    let link = '';
    if (atom) { const ls = all(x, 'link'); link = (ls.find(l => !l.attrs.rel || l.attrs.rel === 'alternate') || ls[0])?.attrs.href || ''; }
    else link = textOf(x, 'link') || (first(x, 'link')?.attrs.href ?? '') || textOf(x, 'guid');
    link = decode(link.trim());
    if (!title || !/^https?:/.test(link)) continue;
    if (notEnglish(title)) continue;
    let outlet = src.name;
    if (src.google) {
      const s = clean(textOf(x, 'source'));
      if (s) { outlet = s; if (title.endsWith(` - ${s}`)) title = title.slice(0, -(s.length + 3)); }
      else { const m = title.match(/^(.*) - ([^-]{2,40})$/); if (m) { title = m[1]; outlet = m[2]; } }
    }
    outlet = normOutlet(outlet);
    if (isJunkOutlet(outlet)) continue;
    const date = textOf(x, 'pubDate', 'published', 'updated', 'dc:date');
    const time = Date.parse(date) || now;
    if (now - time > WINDOW_H * 3600e3 || time - now > 3600e3) continue;
    const summary = src.google ? '' : clean(textOf(x, 'description', 'summary', 'content:encoded', 'content')).slice(0, 900);
    out.push({
      id: hash(link), title, link, outlet, summary, biz: !!src.business,
      time, category: src.category, top: !!src.top,
    });
  }
  return out;
}

async function getPage(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36', Accept: 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.text()).slice(0, 400000);
  } finally { clearTimeout(t); }
}

async function pool(list, n, fn) {
  const results = new Array(list.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < list.length) { const i = next++; results[i] = await fn(list[i], i); } }));
  return results;
}

// 1. Fetch every source
const status = [];
const fresh = (await pool(config.sources, 8, async (src, i) => {
  const url = feedUrl(src);
  try {
    const items = parseFeed(await fetchText(url, i), src);
    status.push({ name: src.name, category: src.category, query: src.google || null, ok: true, count: items.length });
    return items;
  } catch (e) {
    status.push({ name: src.name, category: src.category, query: src.google || null, ok: false, count: 0, error: String(e.message || e).slice(0, 120) });
    return [];
  }
})).flat();

// 2. Merge with what we saw before (keeps stories around after they drop off a feed, and remembers when we first saw them)
const byId = new Map();
for (const it of prevState.items) if (now - it.time <= WINDOW_H * 3600e3 && !isJunkOutlet(it.outlet) && !notEnglish(it.title)) byId.set(it.id, { ...it, image: undefined, outlet: normOutlet(it.outlet), biz: it.biz || (it.cats || []).includes('business') || it.category === 'business', cats: (it.cats || [it.category]).map(c => (c === 'business' ? 'forex' : c)) });
for (const it of fresh) {
  const old = byId.get(it.id);
  byId.set(it.id, { ...it, seen: old?.seen ?? now, cats: [...new Set([...(old?.cats || []), it.category])] });
}
const items = [...byId.values()].sort((a, b) => b.time - a.time).slice(0, MAX_ITEMS);
for (const it of items) it.cats ||= [it.category];

// 3. Group into stories and rank them
const rank = trustRank;
const stories = cluster(items).map(group => {
  group.sort((a, b) => a.time - b.time);
  const rich = g => (g.summary || g.image ? 0 : 1);
  const lead = [...group].sort((a, b) => rank(a.outlet) - rank(b.outlet) || rich(a) - rich(b) || a.time - b.time)[0];
  // Best summary and photo from any outlet covering the story (trusted outlets first)
  const byTrust = [...group].sort((a, b) => rank(a.outlet) - rank(b.outlet));
  const sumItem = lead.summary ? lead : byTrust.find(g => g.summary);
  const best = { summary: sumItem?.summary || '', from: sumItem && sumItem !== lead ? sumItem.outlet : null };
  // A second and third take from other outlets, for a fuller summary in the story view
  const more = [];
  for (const g of byTrust) {
    if (more.length >= 2 || !g.summary || g === sumItem || g.outlet === sumItem?.outlet) continue;
    const head = g.summary.slice(0, 60).toLowerCase();
    if (best.summary.toLowerCase().startsWith(head) || more.some(m => m.text.toLowerCase().startsWith(head))) continue;
    if (more.some(m => m.outlet === g.outlet)) continue;
    more.push({ outlet: g.outlet, text: g.summary.slice(0, 450) });
  }
  const s = scoreStory([lead, ...group.filter(g => g !== lead)], keywords, now);
  const q = qualityAdjust(s.score, lead, new Set(group.map(g => g.outlet.toLowerCase())).size);
  s.score = q.score; s.tier = q.tier; s.reasons.push(...q.why);
  const feedCats = new Set(group.flatMap(g => g.cats).map(c => (c === 'business' ? 'forex' : c)));
  const fromFxFeed = feedCats.has('forex');
  const fromBiz = group.some(g => g.biz);
  const outletCount = new Set(group.map(g => g.outlet)).size;
  const text = `${lead.title} ${lead.summary}`;
  const fx = marketCatalyst(lead.title, text, { policy: policyOf(text) }, s.tier, outletCount);
  if (fx && fx.impact === 'high' && s.tier === 'minor') s.tier = 'notable';
  const firstSeen = Math.min(...group.map(g => g.seen ?? now));
  const published = group[0].time;
  const ageMin = (now - Math.min(firstSeen, published)) / 60000;
  const breaking = (s.tier === 'major' && ageMin <= 90) || (s.breakingTag && ageMin <= 120);
  // Tabs: World (outside the US) / U.S. / Tech & AI from the classifier; Forex = market-moving news (+ business news)
  const cls = classify(lead.title, lead.summary, feedCats, s.score, s.tier, outletCount, breaking);
  const cats = cls.cats;
  if (fx) cats.add('forex');
  if (!fx && fromBiz && !isPriceRecap(lead.title)) cats.add('forex');
  // Price recaps and chart pieces from forex sites ("Gold rises...", "EUR/USD forecast") are dropped entirely
  if (!fx && fromFxFeed && !cats.size) return null;
  const seenOutlets = new Set([lead.outlet]);
  const others = group.filter(g => g !== lead && !seenOutlets.has(g.outlet) && seenOutlets.add(g.outlet)).map(g => ({ outlet: g.outlet, link: g.link, title: g.title }));
  return {
    id: hash(group[0].id), title: lead.title, link: lead.link, outlet: lead.outlet, summary: best.summary, summaryFrom: best.from, more: more.length ? more : undefined,
    _cand: byTrust.filter(g => !/news\.google\.com/.test(g.link)).slice(0, 2).map(g => ({ id: g.id, link: g.link, outlet: g.outlet })),
    published, firstSeen, updatedAt: group[group.length - 1].time, categories: [...cats], top: cls.top || undefined, flags: cls.flags.length ? cls.flags : undefined,
    score: s.score, tier: s.tier, breaking, why: s.reasons, sources: others,
    fx: fx ? { impact: fx.impact, why: fx.why, assets: fx.assets, driver: fx.driver } : null,
    _all: 0,
  };
}).filter(Boolean).map(({ _all, ...s }) => s)
  .sort((a, b) => b.updatedAt - a.updatedAt);

// 3b. Fuller summaries: for important stories with a thin summary, read the opening of the article
//     (its description and first paragraphs) from an outlet that links directly. Cached between runs.
const extracts = new Map((prevState.extracts || []).filter(e => now - e.at < WINDOW_H * 3600e3).map(e => [e.id, e]));
function articleText(html) {
  const meta = (html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]*content=["']([^"']{40,})["']/i) || html.match(/<meta[^>]+content=["']([^"']{40,})["'][^>]*(?:property|name)=["'](?:og:description|description)["']/i) || [])[1] || '';
  const body = html.replace(/<(script|style|noscript|figure|figcaption|aside|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ');
  const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => clean(m[1])).filter(t => t.length > 80 && !/cookie|subscribe|sign up|newsletter|advertis|all rights reserved|©/i.test(t));
  let text = clean(meta);
  for (const p of paras) { if (text.length > 520) break; if (!text.toLowerCase().includes(p.slice(0, 40).toLowerCase())) text += (text ? ' ' : '') + p; }
  if (text.length > 700) text = text.slice(0, 700).replace(/\s+\S*$/, '') + '…';
  return text;
}
if (!FIXTURES) {
  const want = stories.filter(st => (st.tier !== 'minor' || st.fx) && (st.summary || '').length < 220 && st._cand?.length).slice(0, 120);
  const todo = want.filter(st => !st._cand.some(c => extracts.has(c.id))).slice(0, 40);
  await pool(todo, 6, async st => {
    for (const c of st._cand) {
      try {
        const html = await getPage(c.link);
        const text = articleText(html);
        if (text.length > 120) { extracts.set(c.id, { id: c.id, at: now, outlet: c.outlet, text }); return; }
      } catch {}
    }
  });
}
for (const st of stories) {
  const e = st._cand?.map(c => extracts.get(c.id)).find(Boolean);
  if (e && e.text.length > (st.summary || '').length) { st.summary = e.text; st.summaryFrom = e.outlet === st.outlet ? null : e.outlet; }
  delete st._cand;
}

// 4. Economic calendar (at most once an hour; that site asks for gentle use)
let calendar = prevState.calendar;
if (!FIXTURES && (!calendar || now - calendar.fetched > 55 * 60e3)) {
  try {
    const res = await fetch(CAL_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = (await res.json()).filter(e => /high|medium/i.test(e.impact) && e.country === 'USD').map(calendarEvent);
    calendar = { fetched: now, ok: true, events };
  } catch (e) {
    calendar = { ...(calendar || { events: [] }), ok: false, error: String(e.message || e).slice(0, 120), fetched: calendar?.fetched ?? 0 };
  }
}

// 5. Gold, US dollar and Nasdaq prices for the mini charts (every ~30 min)
const MARKETS = [
  { key: 'gold', name: 'Gold', yahoo: 'GC=F', stooq: 'xauusd' },
  { key: 'usd', name: 'US Dollar Index', yahoo: 'DX-Y.NYB', stooq: 'dx.f' },
  { key: 'ndq', name: 'Nasdaq Composite', yahoo: '%5EIXIC', stooq: '%5Endq' },
];
async function getText(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}
async function marketSeries(m) {
  try {
    const j = JSON.parse(await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${m.yahoo}?range=5d&interval=60m`));
    const r = j.chart.result[0];
    const pts = r.timestamp.map((ts, i) => [ts * 1000, r.indicators.quote[0].close[i]]).filter(p => p[1] != null);
    if (pts.length > 5) return { source: 'Yahoo Finance', span: '5 days, hourly', points: pts.slice(-40) };
  } catch {}
  const csv = await getText(`https://stooq.com/q/d/l/?s=${m.stooq}&i=d`);
  const rows = csv.trim().split('\n').slice(1).map(l => l.split(',')).filter(r => r.length >= 5 && !isNaN(parseFloat(r[4])));
  const pts = rows.slice(-30).map(r => [Date.parse(r[0]), parseFloat(r[4])]);
  if (pts.length < 5) throw new Error('no data');
  return { source: 'Stooq', span: '30 days, daily', points: pts };
}
let markets = prevState.markets || null;
if (!FIXTURES && (!markets || now - markets.fetched > 25 * 60e3)) {
  const out = { fetched: now, items: {} };
  for (const m of MARKETS) {
    try {
      const s = await marketSeries(m);
      const first = s.points[0][1], last = s.points[s.points.length - 1][1];
      out.items[m.key] = { name: m.name, ...s, last, change: (last - first) / first * 100, asOf: s.points[s.points.length - 1][0] };
    } catch (e) {
      if (markets?.items?.[m.key]) out.items[m.key] = { ...markets.items[m.key], stale: true };
      else out.items[m.key] = { name: m.name, error: String(e.message || e).slice(0, 80) };
    }
  }
  markets = out;
}

// 5b. Forecast scorecard: record each gold / USD / Nasdaq call with the price at the time,
//     then check the price 4 hours later. Kept for 7 days.
const HORIZON = 4 * 3600e3, KEEP = 7 * 24 * 3600e3;
const forecasts = new Map((prevState.forecasts || []).filter(f => now - f.at < KEEP).map(f => [f.key, f]));
function priceAt(key, t) {
  const pts = markets?.items?.[key]?.points;
  if (!pts?.length) return null;
  let best = null;
  for (const [ts, v] of pts) { if (ts <= t) best = [ts, v]; else break; }
  return best && t - best[0] <= 3 * 3600e3 ? best[1] : null;
}
for (const st of stories) {
  if (!st.fx?.assets || now - st.firstSeen > 6 * 3600e3) continue;
  for (const k of ['gold', 'usd', 'ndq']) {
    const a = st.fx.assets[k], key = `${st.id}:${k}`;
    if (!a || a.dir === 'flat' || !a.conf || forecasts.has(key)) continue;
    const p0 = priceAt(k, st.firstSeen);
    if (p0 == null) continue;
    forecasts.set(key, { key, id: st.id, title: st.title.slice(0, 100), asset: k, dir: a.dir, conf: a.conf, at: st.firstSeen, p0 });
  }
}
for (const f of forecasts.values()) {
  if (f.result || now < f.at + HORIZON) continue;
  const p1 = priceAt(f.asset, f.at + HORIZON);
  if (p1 == null) { if (now - f.at > HORIZON + 8 * 3600e3) f.result = 'nodata'; continue; }
  f.chg = (p1 - f.p0) / f.p0 * 100;
  f.result = Math.abs(f.chg) < 0.05 ? 'flat' : (f.chg > 0) === (f.dir === 'up') ? 'hit' : 'miss';
}
const judged = [...forecasts.values()].filter(f => f.result === 'hit' || f.result === 'miss');
const tally = list => ({ hit: list.filter(f => f.result === 'hit').length, miss: list.filter(f => f.result === 'miss').length });
const scorecard = {
  horizonH: 4, days: 7,
  assets: { gold: tally(judged.filter(f => f.asset === 'gold')), usd: tally(judged.filter(f => f.asset === 'usd')), ndq: tally(judged.filter(f => f.asset === 'ndq')) },
  all: tally(judged), high: tally(judged.filter(f => f.conf >= 7)),
  pending: [...forecasts.values()].filter(f => !f.result).length,
  recent: judged.sort((a, b) => b.at - a.at).slice(0, 6).map(f => ({ title: f.title, asset: f.asset, dir: f.dir, conf: f.conf, result: f.result, chg: Math.round(f.chg * 100) / 100, at: f.at })),
};

// 6. Save
await mkdir(new URL('data/', ROOT), { recursive: true });
const okCount = status.filter(s => s.ok).length;
const out = {
  updated: now,
  stats: { sources: status.length, working: okCount, items: items.length, stories: stories.length },
  categories: config.categories,
  stories,
  calendar,
  markets,
  scorecard,
  sources: status.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
};
await writeFile(new URL('data/news.json', ROOT), JSON.stringify(out));
await writeFile(new URL('data/state.json', ROOT), JSON.stringify({ items, calendar, markets, extracts: [...extracts.values()], forecasts: [...forecasts.values()] }));
console.log(`Sources working: ${okCount}/${status.length}. Items: ${items.length}. Stories: ${stories.length}.`);
for (const s of status.filter(s => !s.ok)) console.log(`  failed: ${s.name} (${s.category}) ${s.query || ''} -> ${s.error}`);
