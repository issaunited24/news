// Collects news from every feed in feeds.json, groups and ranks it, and writes data/news.json for the app.
// Runs on GitHub's free robot (GitHub Actions) every ~10 minutes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { entries, all, first, textOf } from './xml.mjs';
import { cluster, scoreStory, analyzeFx, calendarEvent, trustRank, isJunkOutlet, notEnglish, qualityAdjust } from './rules.mjs';

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
    if (isJunkOutlet(outlet)) continue;
    const date = textOf(x, 'pubDate', 'published', 'updated', 'dc:date');
    const time = Date.parse(date) || now;
    if (now - time > WINDOW_H * 3600e3 || time - now > 3600e3) continue;
    const summary = src.google ? '' : clean(textOf(x, 'description', 'summary', 'content:encoded', 'content')).slice(0, 280);
    out.push({
      id: hash(link), title, link, outlet, summary, image: src.google ? null : imageOf(x),
      time, category: src.category, top: !!src.top,
    });
  }
  return out;
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
for (const it of prevState.items) if (now - it.time <= WINDOW_H * 3600e3 && !isJunkOutlet(it.outlet) && !notEnglish(it.title)) byId.set(it.id, it);
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
  const s = scoreStory([lead, ...group.filter(g => g !== lead)], keywords, now);
  const q = qualityAdjust(s.score, lead, new Set(group.map(g => g.outlet.toLowerCase())).size);
  s.score = q.score; s.tier = q.tier; s.reasons.push(...q.why);
  const cats = new Set(group.flatMap(g => g.cats));
  cats.delete('forex'); // forex is only kept when the rules find a real currency angle (below)
  const allText = group.map(g => g.title).join(' . ');
  const fx = analyzeFx(`${lead.title} ${lead.summary}`, s.tier, new Set(group.map(g => g.outlet)).size) || null;
  const fromFxFeed = group.some(g => g.cats.includes('forex'));
  if (fx && fx.strong) cats.add('forex');
  if (fx && cats.has('forex') && fx.impact === 'high' && s.tier === 'minor') s.tier = 'notable';
  const firstSeen = Math.min(...group.map(g => g.seen ?? now));
  const published = group[0].time;
  const ageMin = (now - Math.min(firstSeen, published)) / 60000;
  const breaking = (s.tier === 'major' && ageMin <= 90) || (s.breakingTag && ageMin <= 120);
  const seenOutlets = new Set([lead.outlet]);
  const others = group.filter(g => g !== lead && !seenOutlets.has(g.outlet) && seenOutlets.add(g.outlet)).map(g => ({ outlet: g.outlet, link: g.link, title: g.title }));
  return {
    id: hash(group[0].id), title: lead.title, link: lead.link, outlet: lead.outlet, summary: lead.summary, image: lead.image,
    published, firstSeen, updatedAt: group[group.length - 1].time, categories: [...cats],
    score: s.score, tier: s.tier, breaking, why: s.reasons, sources: others,
    fx: cats.has('forex') && fx ? { impact: fx.impact, currencies: fx.currencies, why: fx.why, assets: fx.assets } : null,
    _all: allText.length,
  };
}).map(({ _all, ...s }) => s)
  .sort((a, b) => b.updatedAt - a.updatedAt);

// 4. Economic calendar (at most once an hour; that site asks for gentle use)
let calendar = prevState.calendar;
if (!FIXTURES && (!calendar || now - calendar.fetched > 55 * 60e3)) {
  try {
    const res = await fetch(CAL_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = (await res.json()).filter(e => /high|medium/i.test(e.impact)).map(calendarEvent);
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
  sources: status.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
};
await writeFile(new URL('data/news.json', ROOT), JSON.stringify(out));
await writeFile(new URL('data/state.json', ROOT), JSON.stringify({ items, calendar, markets }));
console.log(`Sources working: ${okCount}/${status.length}. Items: ${items.length}. Stories: ${stories.length}.`);
for (const s of status.filter(s => !s.ok)) console.log(`  failed: ${s.name} (${s.category}) ${s.query || ''} -> ${s.error}`);
