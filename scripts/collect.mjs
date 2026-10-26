// Collects news from every feed in feeds.json, groups and ranks it, and writes data/news.json for the app.
// Runs on GitHub's free robot (GitHub Actions) every few minutes (see scripts/loop.sh).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { entries, all, first, textOf } from './xml.mjs';
import { marketCatalyst, isPriceRecap } from './markets.mjs';
import { classify } from './categories.mjs';
import { cluster, scoreStory, analyzeFx, calendarEvent, policyOf, trustRank, isJunkOutlet, notEnglish, qualityAdjust, justInOk } from './rules.mjs';

const ROOT = new URL('../', import.meta.url);
const WINDOW_H = 36;           // keep stories from the last 36 hours
const WRAP_DESK = /^(reuters|bloomberg|wall street journal|wsj|financial times|cnbc|marketwatch|barron|associated press|ap news|investinglive|forexlive|fxstreet|kitco)/i;
const TECH_ONLY = /\b(forecast|technical|support|resistance|fibonacci|elliott|pivot|chart|signals?|price prediction|price today|live (gold )?price|price in [a-z]{3}\b|per ounce today|rates? today)\b/i;
const MAX_ITEMS = 9000;          // enough for the whole 36-hour window from ~170 sources
const CAL_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FIXTURES = process.env.FIXTURES; // local testing: folder of saved feeds

const now = Date.now();
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(new URL(p, ROOT), 'utf8')); } catch { return fallback; } };

const config = await readJson('feeds.json');
const prevState = await readJson('data/state.json', { items: [], calendar: null });
// Google News searches are asked at most every ~9 minutes so Google doesn't start refusing us;
// direct feeds and Bluesky are read on every run.
const GOOGLE_EVERY = 9 * 60e3;
const lastFetch = prevState.lastFetch || {};
const srcKey = src => (src.google ? `g:${src.google}` : src.bsky ? `b:${src.bsky}` : `u:${src.url}`);
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
  if (/^abc news\b/i.test(n)) n = 'ABC News';
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
      id: hash(link), title, link, outlet, summary, image: src.google ? null : imageOf(x), biz: !!src.business,
      time, category: src.category, top: !!src.top, kind: src.kind || undefined,
    });
  }
  return out;
}

// Bluesky: big outlets post their headlines there within seconds. Read through the free public API (no key).
const stripTracking = u => { try { const x = new URL(u); [...x.searchParams.keys()].filter(k => /^(utm_|smid|cmpid|taid|ref$|src$|at_|mc_)/i.test(k)).forEach(k => x.searchParams.delete(k)); x.hash = ''; return x.toString(); } catch { return u; } };
async function fetchBluesky(src) {
  const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(src.bsky)}&limit=40&filter=posts_no_replies`;
  const j = JSON.parse(await fetchText(url));
  const out = [];
  for (const { post, reason } of j.feed || []) {
    if (reason) continue; // reposts of other accounts
    const rec = post.record || {}, emb = post.embed?.external || post.embed?.media?.external;
    if (!emb?.uri || !/^https?:/.test(emb.uri)) continue; // only posts that link to an article
    const link = stripTracking(emb.uri);
    let title = clean(emb.title || '') || clean(rec.text || '').split(/(?<=[.!?])\s/)[0];
    title = title.replace(/\s+[|–-]\s+[^|–-]{2,40}$/, '').trim();
    if (!title || title.length < 20 || notEnglish(title)) continue;
    const time = Date.parse(rec.createdAt || post.indexedAt) || now;
    if (now - time > WINDOW_H * 3600e3 || time - now > 3600e3) continue;
    const text = clean(rec.text || '');
    const summary = clean(emb.description || '') || (text && !text.startsWith(title.slice(0, 30)) ? text : '');
    out.push({ id: hash(link), title, link, outlet: normOutlet(src.name), summary: summary.slice(0, 900), image: emb.thumb || null, biz: !!src.business, time, category: src.category, top: false });
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
  const key = srcKey(src), last = lastFetch[key];
  const base = { name: src.name, category: src.category, query: src.google || null, bsky: src.bsky || null };
  if (FIXTURES && src.bsky) return [];
  if (!FIXTURES && src.google && last && now - last.at < GOOGLE_EVERY) {
    status.push({ ...base, ok: last.ok, count: last.count, skipped: true, error: last.error });
    return [];
  }
  try {
    const items = src.bsky ? await fetchBluesky(src) : parseFeed(await fetchText(feedUrl(src), i), src);
    const newest = items.reduce((m, x) => Math.max(m, x.time), 0) || null;
    status.push({ ...base, ok: true, count: items.length, newest });
    lastFetch[key] = { at: now, ok: true, count: items.length };
    return items;
  } catch (e) {
    const error = String(e.message || e).slice(0, 120);
    status.push({ ...base, ok: false, count: 0, error });
    lastFetch[key] = { at: now, ok: false, count: 0, error };
    return [];
  }
})).flat();

// 2. Merge with what we saw before (keeps stories around after they drop off a feed, and remembers when we first saw them)
const byId = new Map();
for (const it of prevState.items) if (now - it.time <= WINDOW_H * 3600e3 && !isJunkOutlet(it.outlet) && !notEnglish(it.title)) byId.set(it.id, { ...it, summary: now - it.time > 3 * 3600e3 ? (it.summary || '').slice(0, 300) : it.summary, outlet: normOutlet(it.outlet), biz: it.biz || (it.cats || []).includes('business') || it.category === 'business', cats: (it.cats || [it.category]).map(c => (c === 'business' ? 'forex' : c)) });
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
  const imgItem = lead.image ? lead : byTrust.find(g => g.image);
  const best = { summary: sumItem?.summary || '', from: sumItem && sumItem !== lead ? sumItem.outlet : null, image: imgItem?.image || null };
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
  let fx = marketCatalyst(lead.title, text, { policy: policyOf(text) }, s.tier, outletCount);
  if (fx && fx.impact === 'high' && s.tier === 'minor') s.tier = 'notable';
  const firstSeen = Math.min(...group.map(g => g.seen ?? now));
  const published = group[0].time;
  const ageMin = (now - Math.min(firstSeen, published)) / 60000;
  const breaking = (s.tier === 'major' && ageMin <= 90) || (s.breakingTag && ageMin <= 120);
  // Tabs: World (outside the US) / U.S. / Tech & AI from the classifier; Forex = market-moving news (+ business news)
  const cls = classify(lead.title, lead.summary, feedCats, s.score, s.tier, outletCount, breaking);
  const cats = cls.cats;
  // "Just in": a fresh story from a trusted outlet shows straight away, before other outlets confirm it.
  // Top still needs a truly massive event, and then only from a major newsroom or wire.
  const trust = trustRank(lead.outlet);
  const justIn = ageMin <= 90 && justInOk(lead.outlet, lead.title, cats);
  const top = cls.top || (justIn && cls.urgent && trust <= 22);
  // Quality filter: war, peace, politics, sanctions and trade stories only count as market movers when a major
  // newsroom reports them or several outlets cover them (small sites' takes on ongoing stories don't move markets)
  const majorDesk = group.some(g => trustRank(g.outlet) <= 22);
  if (fx && ['war', 'peace', 'politics', 'sanctions', 'trade'].includes(fx.driver) && !majorDesk && outletCount < 3) fx = null;
  // Any other market story needs a known outlet or a second outlet confirming it
  if (fx && !group.some(g => trustRank(g.outlet) < 99) && outletCount < 2) fx = null;
  // Market wraps ("Dollar steady ahead of Fed...") from top market desks: kept, tagged, a couple per day (trimmed below)
  if (!fx && fromFxFeed && !cats.has('sports') && !cats.has('ent') && isPriceRecap(lead.title) && group.some(g => WRAP_DESK.test(g.outlet)) && !TECH_ONLY.test(lead.title))
    fx = { impact: 'medium', assets: { gold: { dir: 'flat', conf: null }, usd: { dir: 'flat', conf: null }, ndq: { dir: 'flat', conf: null }, oil: { dir: 'flat', conf: null } }, why: 'Market wrap: what moved prices and why.', driver: 'wrap', drivers: ['wrap'] };
  if (fx) cats.add('forex');
  // (business news reaches Forex only when it's a real market catalyst)
  // Price recaps and chart pieces from forex sites ("Gold rises...", "EUR/USD forecast") are dropped entirely
  if (!fx && fromFxFeed && !cats.size) return null;
  const seenOutlets = new Set([lead.outlet]);
  const others = group.filter(g => g !== lead && !seenOutlets.has(g.outlet) && seenOutlets.add(g.outlet)).map(g => ({ outlet: g.outlet, link: g.link, title: g.title }));
  return {
    id: hash(group[0].id), title: lead.title, link: lead.link, outlet: lead.outlet, summary: best.summary, summaryFrom: best.from, image: best.image || undefined, more: more.length ? more : undefined,
    _cand: byTrust.filter(g => !/news\.google\.com/.test(g.link)).slice(0, 2).map(g => ({ id: g.id, link: g.link, outlet: g.outlet })),
    published, firstSeen, updatedAt: group[group.length - 1].time, categories: [...cats], top: top || undefined, justIn: justIn || undefined, trusted: trust < 99 || undefined, sport: cats.has('sports') ? (group.find(g => g.kind)?.kind || cls.sport || 'other') : undefined, flags: cls.flags.length ? cls.flags : undefined, likes: cls.likes.length ? cls.likes : undefined,
    score: s.score, tier: s.tier, breaking, why: s.reasons, sources: others,
    fx: fx ? { impact: fx.impact, why: fx.why, assets: fx.assets, driver: fx.driver } : null,
    _all: 0,
  };
}).filter(Boolean).map(({ _all, ...s }) => s)
  .sort((a, b) => b.updatedAt - a.updatedAt);

// Market wraps: at most 2 per day (New York date), the most widely covered ones
{
  const byDay = new Map();
  for (const st of stories.filter(x => x.fx?.driver === 'wrap').sort((a, b) => b.sources.length - a.sources.length || b.published - a.published)) {
    const day = new Date(st.published - 5 * 3600e3).toISOString().slice(0, 10), n = byDay.get(day) || 0;
    if (n < 2) { byDay.set(day, n + 1); continue; }
    st.fx = null; st.categories = st.categories.filter(c => c !== 'forex');
  }
}
// 3b. Fuller summaries: for important stories with a thin summary, read the opening of the article
//     (its description and first paragraphs) from an outlet that links directly. Cached between runs.
const extracts = new Map((prevState.extracts || []).filter(e => now - e.at < WINDOW_H * 3600e3).map(e => [e.id, e]));
function ogImage(html) {
  const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  const u = m ? decode(m[1]) : '';
  return /^https:\/\//.test(u) && !/logo|placeholder|default|sprite|favicon/i.test(u) ? u : null;
}
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
  // Important and "Just in" stories first; missing photos count too, since every card shows one
const want = stories.filter(st => (st.tier !== 'minor' || st.fx || st.top || st.justIn) && ((st.summary || '').length < 220 || !st.image) && st._cand?.length).slice(0, 200);
  const todo = want.filter(st => !st._cand.some(c => extracts.has(c.id))).slice(0, 60);
  await pool(todo, 6, async st => {
    for (const c of st._cand) {
      try {
        const html = await getPage(c.link);
        const text = articleText(html), image = ogImage(html);
        if (text.length > 120 || image) { extracts.set(c.id, { id: c.id, at: now, outlet: c.outlet, text: text.length > 120 ? text : '', image }); return; }
      } catch {}
    }
  });
}
for (const st of stories) {
  const e = st._cand?.map(c => extracts.get(c.id)).find(Boolean);
  if (e && e.text && e.text.length > (st.summary || '').length) { st.summary = e.text; st.summaryFrom = e.outlet === st.outlet ? null : e.outlet; }
  if (e?.image && !st.image) st.image = e.image;
  delete st._cand;
}

// 4. Economic calendar (US only, high and medium impact).
//    TradingView's calendar has the actual numbers within minutes of each release, so it's checked every
//    ~10 minutes, and every run while a recent release is still waiting for its actual. ForexFactory is the backup.
let calendar = prevState.calendar;
const fmtVal = (v, e) => (v == null || v === '' ? null : `${Math.round(v * 1000) / 1000}${e.scale || ''}${e.unit === '%' ? '%' : ''}`);
async function tvCalendar() {
  const from = new Date(now - 2 * 864e5).toISOString(), to = new Date(now + 8 * 864e5).toISOString();
  const res = await fetch(`https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US`, { headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.result || []).filter(e => (e.importance ?? -1) >= 0 && e.date).map(e => calendarEvent({
    title: e.title, country: 'USD', date: e.date, impact: e.importance >= 1 ? 'high' : 'medium',
    forecast: fmtVal(e.forecast, e), previous: fmtVal(e.previous, e), actual: fmtVal(e.actual, e),
  })).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}
const waitingActual = (calendar?.events || []).some(e => !e.actual && e.forecast && now - Date.parse(e.time) > 0 && now - Date.parse(e.time) < 90 * 60e3);
if (!FIXTURES && (!calendar || calendar.src !== 'tv' || now - calendar.fetched > 10 * 60e3 || waitingActual)) {
  try { calendar = { fetched: now, ok: true, src: 'tv', events: await tvCalendar() }; }
  catch (e) { if (calendar) calendar = { ...calendar, src: calendar.src === 'tv' ? 'tv-stale' : calendar.src, tvError: String(e.message || e).slice(0, 120) }; }
}
if (!FIXTURES && (!calendar || (calendar.src !== 'tv' && now - calendar.fetched > 55 * 60e3))) {
  try {
    const res = await fetch(CAL_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = (await res.json()).filter(e => /high|medium/i.test(e.impact) && e.country === 'USD').map(calendarEvent);
    calendar = { fetched: now, ok: true, src: 'ff', events };
  } catch (e) {
    calendar = { ...(calendar || { events: [] }), ok: false, error: String(e.message || e).slice(0, 120), fetched: calendar?.fetched ?? 0 };
  }
}

// 4b. Bank holidays (from ForexFactory, at most once an hour). Thin markets on these days matter for gold and the dollar.
if (!FIXTURES && calendar && (!calendar.holidaysAt || now - calendar.holidaysAt > 55 * 60e3)) {
  try {
    const res = await fetch(CAL_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hol = (await res.json()).filter(e => /holiday/i.test(e.impact) || /bank holiday/i.test(e.title));
    calendar.holidays = hol.map(e => ({ title: e.title, currency: e.country, time: e.date }));
    calendar.holidaysAt = now;
  } catch {}
}

// 5. Gold, US dollar and Nasdaq prices for the mini charts (every ~30 min)
const MARKETS = [
  { key: 'gold', name: 'Gold', yahoo: 'GC=F', stooq: 'xauusd' },
  { key: 'usd', name: 'US Dollar Index', yahoo: 'DX-Y.NYB', stooq: 'dx.f' },
  { key: 'ndq', name: 'Nasdaq 100', yahoo: 'NQ%3DF', stooq: '%5Endx' }, // Nasdaq 100 futures (moves with NAS100 on TradingView)
  { key: 'oil', name: 'WTI Crude Oil', yahoo: 'CL%3DF', stooq: 'cl.f' }, // WTI crude futures
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

// 5a. Chart data (OHLC) for the chart panel: 1D, 1W, 1M, 3M, 1Y, 5Y
const RANGES = { '1H': ['1d', '1m', 0], '1D': ['1d', '5m', 0], '1W': ['5d', '30m', 0], '1M': ['1mo', '1h', 50], '3M': ['3mo', '1d', 50], '1Y': ['1y', '1d', 170], '5Y': ['5y', '1wk', 170], 'ALL': ['max', '1mo', 600] };
const prevCharts = await readJson('data/charts.json', { assets: {} });
const charts = { updated: now, assets: {} };
if (!FIXTURES) {
  for (const m of MARKETS) {
    charts.assets[m.key] = { name: m.name, ranges: {} };
    for (const [rk, [range, interval, maxAgeMin]] of Object.entries(RANGES)) {
      const old = prevCharts.assets?.[m.key]?.ranges?.[rk];
      if (old && maxAgeMin && now - old.at < maxAgeMin * 60e3) { charts.assets[m.key].ranges[rk] = old; continue; }
      try {
        const j = JSON.parse(await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${m.yahoo}?range=${range}&interval=${interval}`));
        const r = j.chart.result[0], q = r.indicators.quote[0];
        const rnd = v => (v == null ? null : Math.round(v * 100) / 100);
        const bars = r.timestamp.map((ts, i) => [ts, rnd(q.open[i]), rnd(q.high[i]), rnd(q.low[i]), rnd(q.close[i])]).filter(b => b.slice(1).every(v => v != null));
        if (bars.length > 3) charts.assets[m.key].ranges[rk] = { at: now, interval, bars, prevClose: rnd(r.meta.chartPreviousClose ?? r.meta.previousClose) };
        else if (old) charts.assets[m.key].ranges[rk] = old;
      } catch { if (old) charts.assets[m.key].ranges[rk] = old; }
    }
  }
} else charts.assets = prevCharts.assets || {};

// 5c. Big money: how hedge funds are betting (CFTC Commitments of Traders, free, weekly; checked every 6 hours).
//     Gold and oil: managed money. Nasdaq and the dollar index: leveraged funds. For each: share of their positions
//     that are long, where their net position sits within the past 3 years, and the change on the week.
const COT = {
  gold: ['72hh-3qpy', '088691', 'm_money_positions_long_all', 'm_money_positions_short_all'],
  oil: ['72hh-3qpy', '067651', 'm_money_positions_long_all', 'm_money_positions_short_all'],
  ndq: ['gpe5-46if', '209742', 'lev_money_positions_long', 'lev_money_positions_short'],
  usd: ['gpe5-46if', '098662', 'lev_money_positions_long', 'lev_money_positions_short'],
};
let bigMoney = prevState.bigMoney || null;
if (!FIXTURES && (!bigMoney || now - bigMoney.fetched > 6 * 3600e3)) {
  const next = { fetched: now, markets: {} };
  for (const [k, [ds, code, lc, sc]] of Object.entries(COT)) {
    try {
      const q = new URLSearchParams({ $where: `cftc_contract_market_code='${code}'`, $order: 'report_date_as_yyyy_mm_dd DESC', $limit: '160', $select: `report_date_as_yyyy_mm_dd,open_interest_all,${lc},${sc}` });
      const res = await fetch(`https://publicreporting.cftc.gov/resource/${ds}.json?${q}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()).map(r => ({ date: r.report_date_as_yyyy_mm_dd.slice(0, 10), long: +r[lc], short: +r[sc], oi: +r.open_interest_all })).filter(r => r.long + r.short > 0);
      if (rows.length < 2) continue;
      const [cur, prev] = rows, nets = rows.slice(0, 156).map(r => r.long - r.short), net = cur.long - cur.short;
      next.markets[k] = {
        date: cur.date, longPct: Math.round(cur.long / (cur.long + cur.short) * 1000) / 10, net,
        pctile: Math.round(nets.slice(1).filter(n => n < net).length / Math.max(1, nets.length - 1) * 100),
        chg: Math.round((net - (prev.long - prev.short)) / cur.oi * 1000) / 10, weeks: nets.length,
      };
    } catch (e) { console.log(`Big money ${k}: ${e.message}`); }
  }
  if (Object.keys(next.markets).length) bigMoney = next;
}

// 5b. Forecast scorecard: record each gold / USD / Nasdaq call with the price at the time,
//     then check the price 4 hours later. Kept for 7 days.
const HORIZON = 4 * 3600e3, KEEP = 7 * 24 * 3600e3;
const forecasts = new Map((prevState.forecasts || []).filter(f => now - f.at < KEEP).map(f => [f.key, f]));
function priceAt(key, t) {
  const fine = charts.assets?.[key]?.ranges?.['1W']?.bars?.map(b => [b[0] * 1000, b[4]]);
  const pts = fine?.length ? fine : markets?.items?.[key]?.points;
  if (!pts?.length) return null;
  let best = null;
  for (const [ts, v] of pts) { if (ts <= t) best = [ts, v]; else break; }
  return best && t - best[0] <= 3 * 3600e3 ? best[1] : null;
}
// Calendar model (model/calendar.joblib): for each US release, the reaction it expects if the number comes in above
// or below forecast; once the actual is out, its call for each market. Upcoming ones are refreshed every 30 minutes.
const CAL_MODEL = new URL('model/calendar.joblib', ROOT);
const calVersion = existsSync(new URL('model/calendar_report.json', ROOT)) ? (JSON.parse(await readFile(new URL('model/calendar_report.json', ROOT), 'utf8')).trained || 'v1') : null;
const calId = e => `${e.title}|${e.time}`;
const calPreds = new Map(Object.entries(prevState.calPreds || {}).filter(([, v]) => v.v === calVersion && now - v.at < (v.done ? 8 * 864e5 : 30 * 60e3)));
if (!FIXTURES && calVersion && existsSync(CAL_MODEL) && calendar?.events?.length) {
  const todo = calendar.events.filter(e => e.forecast && !calPreds.has(calId(e)) && Date.parse(e.time) > now - 7 * 864e5 && Date.parse(e.time) < now + 5 * 864e5)
    .map(e => ({ id: calId(e), title: e.title, actual: e.actual, forecast: e.forecast, importance: e.impact === 'high' ? 1 : 0, ts: Date.parse(e.time) / 1000 }));
  if (todo.length) {
    const res = spawnSync('python3', [new URL('scripts/ml/cal_model.py', ROOT).pathname, 'predict'], { input: JSON.stringify(todo), encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    try {
      const out = JSON.parse(res.stdout);
      for (const [id, p] of Object.entries(out.preds || {})) calPreds.set(id, { v: calVersion, at: now, done: !!p.assets, ...p });
    } catch { console.log('Calendar model unavailable this round:', (res.stderr || res.error?.message || '').slice(-300)); }
  }
}
for (const e of calendar?.events || []) {
  const p = calPreds.get(calId(e));
  if (p) e.model = p.assets ? { assets: p.assets } : { above: p.above, below: p.below };
}
// Calendar calls: when a US release beats or misses its forecast, the usual reaction is recorded as a forecast
// for the US dollar, gold and the Nasdaq, then checked against the price an hour later.
const CAL_HORIZON = 90 * 60e3; // the calendar model learned the reaction from just before the release to 90 minutes after
const CAL_RULES = [ // [title pattern, effect when the actual comes in ABOVE forecast (USD, gold, Nasdaq)]
  [/core pce|pce|cpi|ppi|inflation|price index/i, ['up', 'down', 'down']],
  [/non-?farm|nfp|employment change|adp|jolts|job openings/i, ['up', 'down', null]],
  [/unemployment rate|unemployment claims|jobless claims|initial claims|continuing claims/i, ['down', 'up', null]],
  [/federal funds|fed interest rate|interest rate decision/i, ['up', 'down', 'down']],
  [/gdp/i, ['up', 'down', 'up']],
  [/retail sales|ism|pmi|durable goods|consumer confidence|sentiment|housing starts|building permits|industrial production/i, ['up', 'down', 'up']],
];
const flipDir = d => (d === 'up' ? 'down' : d === 'down' ? 'up' : d);
const numOf = v => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
for (const e of calendar?.events || []) {
  const t = Date.parse(e.time), a = numOf(e.actual), f = numOf(e.forecast);
  if (!t || a == null || f == null || a === f || now - t > KEEP) continue;
  if (e.model?.assets) {
    for (const [k, m] of Object.entries(e.model.assets)) {
      const key = `cal:${e.title}:${e.time}:${k}`;
      if (forecasts.has(key)) continue;
      const p0 = priceAt(k, t); if (p0 == null) continue;
      forecasts.set(key, { key, cal: true, model: true, title: `${e.title}: ${e.actual} vs ${e.forecast} forecast`.slice(0, 100), asset: k, dir: m.dir, conf: m.conf, at: t, p0, horizon: CAL_HORIZON });
    }
    continue;
  }
  const rule = CAL_RULES.find(([re]) => re.test(e.title)); if (!rule) continue;
  const eff = a > f ? rule[1] : rule[1].map(flipDir);
  ['usd', 'gold', 'ndq'].forEach((k, i) => {
    const dir = eff[i], key = `cal:${e.title}:${e.time}:${k}`;
    if (!dir || forecasts.has(key)) return;
    const p0 = priceAt(k, t); if (p0 == null) return;
    forecasts.set(key, { key, cal: true, title: `${e.title}: ${e.actual} vs ${e.forecast} forecast`.slice(0, 100), asset: k, dir, conf: 6, at: t, p0, horizon: CAL_HORIZON });
  });
}
// 5a. The trained forecast model (model/forecast.joblib, see scripts/ml/): reads each Forex story and calls
//     gold, the dollar, the Nasdaq and oil with a 1-10 confidence measured on real past results, plus how big a
//     move to expect (importance). New stories only; results are kept for 48 hours. Falls back to the rules if
//     the model can't run.
const MODEL_FILE = new URL('model/forecast.joblib', ROOT), MODEL_REPORT = new URL('model/report.json', ROOT);
// Newer models from the weekly training are fetched as soon as they're published (checked every round)
if (!FIXTURES) {
  const REL = 'https://github.com/issaunited24/news/releases/download/model/';
  const get = async (n, as = 'text') => { const r = await fetch(REL + n, { redirect: 'follow' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return as === 'buf' ? Buffer.from(await r.arrayBuffer()) : r.text(); };
  for (const [rep, files] of [['report.json', ['forecast.joblib']], ['calendar_report.json', ['calendar.joblib']]]) {
    try {
      const remote = await get(rep), local = existsSync(new URL(`model/${rep}`, ROOT)) ? await readFile(new URL(`model/${rep}`, ROOT), 'utf8') : '';
      if (JSON.parse(remote).trained !== (local ? JSON.parse(local).trained : null)) {
        await mkdir(new URL('model/', ROOT), { recursive: true });
        for (const f of files) await writeFile(new URL(`model/${f}`, ROOT), await get(f, 'buf'));
        await writeFile(new URL(`model/${rep}`, ROOT), remote);
        console.log(`New model published: ${rep} ${JSON.parse(remote).trained}`);
      }
    } catch (e) { console.log(`Model check (${rep}): ${e.message}`); }
  }
}
// Only a model whose tests passed the quality bar is used (report.quality_ok, set by scripts/ml/train.py)
const modelReport = existsSync(MODEL_REPORT) ? JSON.parse(await readFile(MODEL_REPORT, 'utf8')) : null;
const modelVersion = modelReport?.quality_ok ? `${modelReport.trained || 'v1'}|scale2` : null; // |scale2: recompute calls made on the old rating scale
const preds = new Map(Object.entries(prevState.preds || {}).filter(([, v]) => now - v.at < 48 * 3600e3 && v.v === modelVersion));
if (!FIXTURES && modelVersion && existsSync(MODEL_FILE)) {
  const todo = stories.filter(st => st.fx && !preds.has(st.id)).sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 40) // newest first; the rest next round
    .map(st => ({ id: st.id, title: st.title, text: st.summary || '', ts: Math.min(st.published, st.firstSeen) / 1000, outlet: st.outlet }));
  if (todo.length) {
    const t0 = Date.now();
    // the market headlines of the last 24 hours, so the model can tell a fresh event from one everyone already knows
    const pool = items.filter(it => now - it.time < 24 * 3600e3 && (it.cats || []).includes('forex')).slice(0, 2000).map(it => ({ title: it.title, ts: it.time / 1000 }));
    const res = spawnSync('python3', [new URL('scripts/ml/predict.py', ROOT).pathname], { input: JSON.stringify({ stories: todo, pool }), encoding: 'utf8', timeout: 130000, maxBuffer: 32 * 1024 * 1024 });
    try {
      const out = JSON.parse(res.stdout);
      for (const [id, p] of Object.entries(out.preds || {})) preds.set(id, { v: modelVersion, at: now, ...p });
      console.log(`Forecast model: ${todo.length} new stories in ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch { console.log('Forecast model unavailable this round:', (res.stderr || res.error?.message || '').slice(-300)); }
  }
}
for (const st of stories) {
  const p = st.fx && preds.get(st.id); if (!p) continue;
  const slim = o => (o ? Object.fromEntries(Object.entries(o).map(([k, a]) => [k, { dir: a.dir, conf: a.conf }])) : undefined);
  st.fx.assets = { ...(st.fx.assets || {}), ...(slim(p.assets) || {}) }; // markets the model didn't pass keep the rules' call
  // Every market gets a call: where neither the 4-hour model nor the rules have one, the next-day model's call is
  // used with its own tested rating, and it's checked a day later (next: true) instead of after 4 hours
  for (const [k, a] of Object.entries(p.d1 || {})) {
    const cur = st.fx.assets[k];
    if (!cur || cur.dir === 'flat' || !cur.conf) st.fx.assets[k] = { dir: a.dir, conf: a.conf || 1, next: true };
  }
  if (p.h1 && Object.keys(p.h1).length) st.fx.h1 = slim(p.h1);
  if (p.d1 && Object.keys(p.d1).length) st.fx.d1 = slim(p.d1);
  // Importance: the bigger of the rules' view (major Fed moves, wars, banking stress...) and the model's (how much
  // prices usually move after news like this), and breaking news is always high
  const RANK = { low: 0, medium: 1, high: 2 };
  st.fx.impact = st.breaking ? 'high' : (RANK[p.impact] ?? 0) >= (RANK[st.fx.impact] ?? 0) ? p.impact : st.fx.impact;
  if (p.fresh === false) st.fx.old = true;
  st.fx.model = true;
}

// Smarter calls, before they're shown or scored (rules only; the trained model already accounts for the trend):
//  - Old news: a theme (war, Fed, oil...) that has been in the news for over a day is mostly priced in, so its calls
//    lose 2 points of confidence, unless the headline signals a real escalation or surprise.
//  - Trend: a call that goes against how the price moved over the 6 hours before the story loses 2 points;
//    if that leaves it weak (4 or less), it becomes "no clear move".
const themes = new Map(Object.entries(prevState.themes || {}));
for (const st of stories) {
  const d = st.fx?.driver; if (!d) continue;
  const t = Math.min(st.published, st.firstSeen), th = themes.get(d);
  if (!th || t - th.last > 48 * 3600e3) themes.set(d, { start: t, last: t });
  else themes.set(d, { start: Math.min(th.start, t), last: Math.max(th.last, t) });
}
const FRESH_RE = /\b(escalat\w*|surprise\w*|unexpected\w*|shock\w*|first time|for the first|emergency|record|declares?|launch(es|ed)? (attack|strikes|invasion)|invad\w*|collapse\w*|default\w*|resigns?|ousted|ceasefire|peace deal|breakthrough)\b/i;
const TREND_MIN = { gold: 0.4, usd: 0.2, ndq: 0.5, oil: 0.8 }; // % move over 6 hours that counts as a clear trend
const toughen = (a, by) => ({ ...a, conf: Math.max(1, (a.conf || 0) - by) });
for (const st of stories) {
  if (!st.fx?.assets || st.fx.model) continue;
  const t = Math.min(st.published, st.firstSeen), th = themes.get(st.fx.driver);
  const stale = th && t - th.start > 24 * 3600e3 && !FRESH_RE.test(st.title);
  const notes = [];
  for (const [k, a] of Object.entries(st.fx.assets)) {
    if (!a.conf || a.dir === 'flat') continue;
    let b = a;
    if (stale) b = toughen(b, 2);
    const p0 = priceAt(k, t - 6 * 3600e3), p1 = priceAt(k, t);
    const mv = p0 && p1 ? (p1 - p0) / p0 * 100 : 0;
    const against = Math.abs(mv) >= (TREND_MIN[k] || 0.5) && (mv > 0) !== (b.dir === 'up');
    if (against) { b = toughen(b, 2); if (b.conf <= 4) b = { dir: 'flat', conf: null }; }
    if (b !== a) { st.fx.assets[k] = b; if (against) notes.push(k); }
  }
  if (stale) st.fx.stale = true;
  if (notes.length) st.fx.against = notes;
}
for (const st of stories) {
  if (!st.fx?.assets || now - st.firstSeen > 6 * 3600e3) continue;
  for (const k of ['gold', 'usd', 'ndq', 'oil']) {
    const a = st.fx.assets[k], key = `${st.id}:${k}`;
    if (!a || a.dir === 'flat' || !a.conf || forecasts.has(key)) continue;
    const p0 = priceAt(k, st.firstSeen);
    if (p0 == null) continue;
    forecasts.set(key, { key, id: st.id, title: st.title.slice(0, 100), asset: k, dir: a.dir, conf: a.conf, driver: st.fx.driver, model: st.fx.model || undefined, at: st.firstSeen, p0, ...(a.next ? { horizon: 24 * 3600e3 } : {}) });
  }
}
for (const f of forecasts.values()) {
  const hz = f.horizon || HORIZON;
  if (f.result || now < f.at + hz) continue;
  const p1 = priceAt(f.asset, f.at + hz);
  if (p1 == null) { if (now - f.at > hz + 8 * 3600e3) f.result = 'nodata'; continue; }
  f.chg = (p1 - f.p0) / f.p0 * 100;
  f.result = Math.abs(f.chg) < 0.05 ? 'flat' : (f.chg > 0) === (f.dir === 'up') ? 'hit' : 'miss';
}
// Scoring:
//  - Weak news calls (under 5/10) still show on the cards but aren't scored.
//  - One vote per idea: news calls on the same asset, in the same direction, from the same theme within a 4-hour
//    window count once (the most confident one), so 20 headlines about one event aren't 20 votes.
//  - Weighted by confidence: an 8/10 call counts twice as much as a 4/10 call.
const vote = new Map();
for (const f of forecasts.values()) {
  if (f.result !== 'hit' && f.result !== 'miss') continue;
  if (!f.cal && (f.conf || 0) < 5) continue;
  const k = f.cal ? f.key : `${f.asset}:${f.dir}:${f.driver || ''}:${Math.floor(f.at / HORIZON)}`;
  const was = vote.get(k);
  if (!was || (f.conf || 0) > (was.conf || 0)) vote.set(k, f);
}
const judged = [...vote.values()];
const tally = list => {
  const hit = list.filter(f => f.result === 'hit'), miss = list.filter(f => f.result === 'miss');
  const w = l => l.reduce((n, f) => n + (f.conf || 5), 0), all = w(hit) + w(miss);
  return { hit: hit.length, miss: miss.length, w: all ? Math.round(w(hit) / all * 100) : null };
};
const scorecard = {
  horizonH: 4, days: 7,
  assets: { gold: tally(judged.filter(f => f.asset === 'gold')), usd: tally(judged.filter(f => f.asset === 'usd')), ndq: tally(judged.filter(f => f.asset === 'ndq')), oil: tally(judged.filter(f => f.asset === 'oil')) },
  all: tally(judged), high: tally(judged.filter(f => f.conf >= 7)), news: tally(judged.filter(f => !f.cal)), cal: tally(judged.filter(f => f.cal)),
  pending: [...forecasts.values()].filter(f => !f.result).length, rules: 2,
  recent: judged.sort((a, b) => b.at - a.at).slice(0, 6).map(f => ({ title: f.title, asset: f.asset, dir: f.dir, conf: f.conf, result: f.result, chg: Math.round(f.chg * 100) / 100, at: f.at, cal: f.cal || undefined })),
};

// 6. Save
await mkdir(new URL('data/', ROOT), { recursive: true });
const okCount = status.filter(s => s.ok).length;
// Older small stories (one outlet, minor, not market-moving) are left out after 12 hours to keep the app's download light
const keep = stories.filter(st => now - st.updatedAt < 12 * 3600e3 || st.fx || st.top || st.tier !== 'minor' || st.sources.length >= 1 || st.likes)
  .map(st => {
    const old = now - st.updatedAt > 8 * 3600e3;
    return { ...st, sources: st.sources.slice(0, 8), summary: old && st.summary ? st.summary.slice(0, 260) : st.summary, more: old ? undefined : st.more };
  });
// The app checks news.json every 2 minutes: the last 3 hours, plus important stories from the last 12
const isRecent = st => now - st.updatedAt < 3 * 3600e3 || (now - st.updatedAt < 12 * 3600e3 && (st.fx || st.top || st.tier !== 'minor' || st.sources.length >= 1 || st.justIn));
const out = {
  updated: now,
  stats: { sources: status.length, working: okCount, items: items.length, stories: stories.length, justIn: stories.filter(s => s.justIn).length },
  categories: config.categories,
  stories: keep.filter(isRecent),
  calendar,
  markets,
  bigMoney: bigMoney?.markets,
  scorecard,
  sources: status.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
};
await writeFile(new URL('data/news.json', ROOT), JSON.stringify(out));
// Everything else (older or small stories), in its own file so the app's regular check stays light
await writeFile(new URL('data/older.json', ROOT), JSON.stringify({ updated: now, stories: keep.filter(st => !isRecent(st)) }));
await writeFile(new URL('data/charts.json', ROOT), JSON.stringify(charts));
await writeFile(new URL('data/state.json', ROOT), JSON.stringify({ items, calendar, markets, extracts: [...extracts.values()], forecasts: [...forecasts.values()], themes: Object.fromEntries(themes), preds: Object.fromEntries(preds), calPreds: Object.fromEntries(calPreds), bigMoney, lastFetch }));
console.log(`Sources working: ${okCount}/${status.length}. Items: ${items.length}. Stories: ${stories.length}.`);
for (const s of status.filter(s => !s.ok)) console.log(`  failed: ${s.name} (${s.category}) ${s.query || ''} -> ${s.error}`);
