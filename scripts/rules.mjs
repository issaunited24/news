// Free, rule-based judgment for the news app: grouping, importance and forex impact.
// No AI and no paid services: everything here is plain pattern matching.

const STOP = new Set(`the a an and or but of to in on at for with from by as is are was were be been has have had
it its this that these those after before over under into about amid says said say will would could may might
new more than up down out off not no yes who what when where why how his her their our your they them he she we you
year years day days week weeks report reports live latest update updates news video watch`.split(/\s+/));

export function tokens(title) {
  return [...new Set(
    title.toLowerCase()
      .replace(/[’']s\b/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
      .map(w => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
  )];
}

// Group headlines about the same event. Uses an inverted index so it stays fast.
export function cluster(items) {
  const parent = items.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const toks = items.map(it => tokens(it.title));
  const index = new Map();
  toks.forEach((ts, i) => ts.forEach(t => { if (!index.has(t)) index.set(t, []); index.get(t).push(i); }));
  for (let i = 0; i < items.length; i++) {
    const counts = new Map();
    for (const t of toks[i]) {
      const list = index.get(t);
      if (list.length > 60) continue; // very common word, not useful for matching
      for (const j of list) if (j > i) counts.set(j, (counts.get(j) || 0) + 1);
    }
    for (const [j, inter] of counts) {
      const a = toks[i].length, b = toks[j].length;
      if (!a || !b) continue;
      const overlap = inter / Math.min(a, b);
      const jaccard = inter / (a + b - inter);
      const close = Math.abs(items[i].time - items[j].time) < 36 * 3600e3;
      if (close && ((inter >= 3 && overlap >= 0.6) || jaccard >= 0.5)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  return [...groups.values()];
}

const BREAKING_RE = /^(breaking|live|urgent|just in|developing)\b|\bbreaking\b/i;

export const tierOf = score => (score >= 50 ? 'major' : score >= 28 ? 'notable' : 'minor');

/* ---------- Source quality ---------- */
// Trusted outlets, best first. Used to pick which outlet leads a story and to judge single-source stories.
const TRUSTED = ['reuters', 'ap news', 'associated press', 'bloomberg', 'bbc', 'financial times', 'the economist', 'wsj', 'wall street journal', 'new york times', 'washington post', 'the guardian', 'al jazeera', 'cnbc', 'fox news', 'fox business', 'daily wire', 'nbc news', 'cbs news', 'abc news', 'sky news', 'axios', 'politico', 'barron', 'marketwatch', 'fortune', 'business insider', 'forbes', 'the verge', 'techcrunch', 'wired', 'ars technica', 'the register', 'venturebeat', 'fxstreet', 'investinglive', 'forexlive', 'forex factory', 'dw.com', 'deutsche welle', 'france 24', 'openai', 'anthropic', 'yahoo finance', 'kitco', 'actionforex', 'fxempire', 'economic times', 'seeking alpha', 'central banking', 'investing.com', 'trading economics', 'ig', 'econoday', 'financial times', 'ft.com',
  // added for "Just in": solid outlets whose fresh stories can show before others confirm them
  'afp', 'agence france', 'cnn', 'npr', 'pbs', 'usa today', 'the hill', 'los angeles times', 'cbc', 'the independent', 'engadget', 'mit technology review', '9to5mac', '9to5google', 'the information', 'variety', 'hollywood reporter', 'deadline',
  // sports, science and entertainment desks
  'espn', 'cbs sports', 'the athletic', 'yahoo sports', 'mma fighting', 'mma junkie', 'nasa', 'space.com', 'new scientist', 'sciencedaily', 'live science', 'quanta', 'billboard'];
export const trustRank = outlet => { const o = String(outlet).toLowerCase().trim(); const i = TRUSTED.findIndex(t => (t.length <= 3 ? o === t || o.startsWith(t + ' ') : o.includes(t))); return i < 0 ? 99 : i; };
// "Just in": which outlets may show a story before anyone else confirms it.
// News desks for every tab; specialist tech outlets only for Tech & AI. Entertainment trades wait for confirmation.
const NEWSDESK = ['afp', 'agence france', 'cnn', 'npr', 'pbs', 'usa today', 'the hill', 'los angeles times', 'cbc', 'the independent'];
const TECHDESK = ['the verge', 'techcrunch', 'wired', 'ars technica', 'the register', 'venturebeat', 'engadget', 'mit technology review', 'the information'];
const SPORTSDESK = ['espn', 'the athletic', 'cbs sports', 'yahoo sports'];
const FLUFF_RE = /\b(review|guest post|deals?|\$\d+ off|\d+ ?(%|percent) off|on sale|discount|coupon|watch:|watch live|live updates|podcast|newsletter|quiz|crossword|wordle|connections|horoscope|opinion|op-ed|best .{0,30} (to buy|for \d{4})|how to|gift guide|recap|trailer|exclusive)\b|^watch\b/i;
export function justInOk(outlet, title, cats) {
  if (FLUFF_RE.test(title)) return false;
  const o = String(outlet).toLowerCase().trim(), r = trustRank(outlet);
  if (r <= 22) return true; // wires and major newsrooms (Reuters … Politico)
  const hit = list => list.some(t => (t.length <= 3 ? o === t || o.startsWith(t + ' ') : o.includes(t)));
  if (hit(NEWSDESK)) return true;
  if (cats.has('sports') && hit(SPORTSDESK)) return true;
  return cats.has('tech') && hit(TECHDESK);
}
// Press-release wires, broker marketing and content farms: dropped entirely.
const JUNK_RE = /newswire|presswire|press release|globenewswire|business wire|accesswire|newsfile|openpr|prweb|einpresswire|stock titan|tech-insider|indexbox|devdiscourse|quantum zeitgeist|tokenpost|tmgm|vt markets|litefinance|forextraders|tradingkey|moomoo|metrobank|biggo|idnfinancials|newsroom|nvidia blog|nvidia developer|google cloud|trendingtopics/i;
// Outlets focused on Iraq, Arab countries and the wider Middle East (big stories still arrive via world outlets)
const REGIONAL_RE = /shafaq|kurdistan|rudaw|iraq|baghdad|the new region|964|middle east|media line|arab news|asharq|al arabiya|alarabiya|the national\b|new arab|amwaj|beirut|ammon|majalla|gulf news|khaleej|al-monitor|monitor\.com|zawya|saudi|emirates|qatar|kuwait|bahrain|oman|jordan|lebanon|syria|egypt|ahram|jerusalem post|times of israel|haaretz|ynet|i24|israel|iran international|iranwire|tasnim|press tv|irna|mehr news|tehran|wana news|daily sabah|anadolu|hurriyet|türkiye|turkiye|trt\b|hengaw|pukmedia|basnews|anha\b|the cradle|thecradle|kurdpress|yemen|houthi|global arab network/i;
const MIDEAST_SCRIPT_RE = /[\u0600-\u06FF\u0590-\u05FF]/; // Arabic, Persian, Kurdish, Hebrew letters
export const isRegionalOutlet = outlet => REGIONAL_RE.test(outlet) || MIDEAST_SCRIPT_RE.test(outlet);
export const isJunkOutlet = outlet => JUNK_RE.test(outlet) || isRegionalOutlet(outlet);
// Mostly non-Latin headline = not English
export const notEnglish = title => { const letters = title.replace(/[^\p{L}]/gu, ''); if (!letters.length) return false; const latin = letters.replace(/[^\p{Script=Latin}]/gu, '').length; return latin / letters.length < 0.7; };
const PR_RE = /™|®|\b(unveils|announces|introduces|partners with|teams up with|powered by|now available)\b/i;
export function qualityAdjust(score, lead, outletCount) {
  let adj = 0; const why = [];
  const known = trustRank(lead.outlet) < 99;
  if (!known && outletCount === 1) { adj -= 10; why.push('single unknown source'); }
  if (!known && PR_RE.test(lead.title)) { adj -= 15; why.push('press-release style'); }
  const next = Math.max(0, Math.min(100, score + adj));
  return { score: next, tier: tierOf(next), why };
}

export function scoreStory(items, keywords, now) {
  const outlets = new Set(items.map(i => i.outlet.toLowerCase()));
  const titles = items.map(i => i.title.toLowerCase());
  const lead = titles[0];
  const reasons = [];
  let score = 0;

  const n = outlets.size;
  const coverage = Math.min(45, 15 * Math.log2(n));
  if (n > 1) reasons.push(`${n} outlets`);
  score += coverage;

  if (items.some(i => i.top)) { score += 12; reasons.push("editors' pick"); }
  const breakingTag = items.some(i => BREAKING_RE.test(i.title));
  if (breakingTag) { score += 20; reasons.push('marked breaking'); }

  const hits = keywords.high.filter(k => titles.some(t => t.includes(k)));
  if (hits.length) { score += Math.min(20, 10 + 5 * (hits.length - 1)); reasons.push(hits.slice(0, 2).join(', ')); }
  if (keywords.low.some(k => lead.includes(k))) { score -= 30; reasons.push('feature/opinion'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tier: tierOf(score), breakingTag, reasons };
}

/* ---------- Forex ---------- */

const CURRENCIES = [
  ['USD', /\b(fed|fomc|federal reserve|powell|greenback|dollar index|dxy|nonfarm|non-farm|(?:jobs|payrolls) (?:report|data)|treasury yields?|u\.?s\.? (dollar|inflation|jobs|economy|cpi|gdp|retail sales|yields?))\b/i],
  ['EUR', /\b(ecb|european central bank|lagarde|euro ?zone|euro area|euro)\b/i],
  ['GBP', /\b(bank of england|boe|sterling|the pound|pound sterling|uk (inflation|economy|gdp|jobs|wages))\b/i],
  ['JPY', /\b(bank of japan|boj|ueda|yen|japan'?s? (inflation|economy|gdp))\b/i],
  ['CHF', /\b(snb|swiss national bank|swiss franc|franc)\b/i],
  ['CAD', /\b(bank of canada|loonie|canadian dollar|canada'?s? (inflation|jobs|economy|gdp))\b/i],
  ['AUD', /\b(rba|reserve bank of australia|aussie|australian dollar)\b/i],
  ['NZD', /\b(rbnz|reserve bank of new zealand|kiwi dollar|new zealand dollar)\b/i],
  ['CNY', /\b(pboc|people'?s bank of china|yuan|renminbi)\b/i],
  ['XAU', /\b(gold (price|prices|futures|rises|rose|falls|fell|hits|rallies|slips|jumps|climbs|drops|surges)|price of gold|bullion)\b/i],
];
const OIL_RE = /\b(oil|crude|brent|wti|opec)\b/i;

const NAME_TO_CODE = {
  dollar: 'USD', greenback: 'USD', euro: 'EUR', pound: 'GBP', sterling: 'GBP', yen: 'JPY', franc: 'CHF',
  loonie: 'CAD', aussie: 'AUD', kiwi: 'NZD', yuan: 'CNY', gold: 'XAU',
};
const UP_WORDS = 'rebounds|rebounded|recovers|recovered|edges higher|ticks up|rises|rose|gains|gained|jumps|jumped|climbs|climbed|rallies|rallied|strengthens|strengthened|firms|firmed|surges|surged|soars|soared|advances|extends gains|hits (?:a )?(?:\\S+ )?high';
const DOWN_WORDS = 'dips|dipped|edges lower|ticks down|falls|fell|slides|slid|slips|slipped|drops|dropped|weakens|weakened|tumbles|tumbled|sinks|sank|slumps|slumped|plunges|plunged|retreats|eases|eased|extends losses|hits (?:a )?(?:\\S+ )?low';
const MOVE_RE = new RegExp(`\\b(dollar|greenback|euro|pound|sterling|yen|franc|loonie|aussie|kiwi|yuan|gold)\\b(?:\\s+\\S+){0,2}?\\s+(${UP_WORDS}|${DOWN_WORDS})\\b`, 'gi');
const PAIR_RE = new RegExp(`\\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|XAU)\\s?\\/\\s?(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD)\\b(?:\\s+\\S+){0,2}?\\s+(${UP_WORDS}|${DOWN_WORDS})\\b`, 'gi');
const isUp = w => new RegExp(`^(${UP_WORDS})$`, 'i').test(w);

const NO_MORE_HIKES_RE = /\b(no (more|further) (rate )?(hikes?|increases?)|done (hiking|raising)|end of (rate )?hikes)\b/i;
const NO_MORE_CUTS_RE = /\b(no (more|further) (rate )?cuts?|done (cutting|easing)|end of (rate )?cuts)\b/i;
const HOLD_RE = /\b(holds? (interest )?rates|keeps? rates (unchanged|steady|on hold)|leaves? rates unchanged|on hold|pause[sd]?)\b/i;
const DOVISH_RE = /\b((to|will|could|may|expected to|set to|likely to) (cut|lower rates)|cuts? (interest )?rates?|cutting rates|lowers? (interest )?rates?|rate cuts?|dovish|easing|stimulus|cooler[- ]than[- ]expected|weaker[- ]than[- ]expected|misses (estimates|forecasts?)|slowdown|contraction|recession|unemployment (rises|jumps|climbs)|inflation (cools|eases|slows|falls))\b/i;
const HAWKISH_RE = /\b((to|will|could|may|expected to|set to|likely to) (hike|raise rates)|rate rises?|raises? (interest )?rates?|hikes? (interest )?rates?|rate hikes?|lifts? rates|hawkish|tightening|hotter[- ]than[- ]expected|stronger[- ]than[- ]expected|beats? (estimates|forecasts?)|sticky inflation|hot (uk |us |u\.s\. )?(cpi|inflation)|inflation (rises?|jumps|surges|accelerates|quickens|hits \S+ high))\b/i;
const OIL_UP_RE = /\b(oil|crude|brent|wti)\b(?:\s+\S+){0,2}?\s+(rises|rose|jumps|surges|climbs|rallies|gains|soars)\b|opec\+? (cuts?|curbs?) (output|production)/i;
const OIL_DOWN_RE = /\b(oil|crude|brent|wti)\b(?:\s+\S+){0,2}?\s+(falls|fell|drops|slides|slumps|plunges|tumbles|sinks)\b|opec\+? (raises?|boosts?|hikes?) (output|production)/i;

const HIGH_IMPACT_RE = /\b(rate decision|(raises?|cuts?|hikes?|lowers?|holds?|keeps?) (interest )?rates|rates? (hike|cut)s?|intervention|intervene|nonfarm|non-farm|(?:jobs|payrolls) (?:report|data)|cpi|consumer prices|inflation (data|report|rate)|gdp|emergency meeting)\b/i;
const MED_IMPACT_RE = /\b(fed|fomc|federal reserve|ecb|european central bank|boe|bank of england|boj|bank of japan|snb|swiss national bank|rba|reserve bank of australia|rbnz|pboc|bank of canada|no (more|further) (rate )?(hikes?|cuts?)|powell|lagarde|bailey|ueda|minutes|pmi|retail sales|jobs|unemployment|jobless|yields?|tariffs?|trade war|opec)\b/i;

export function policyOf(text) {
  if (NO_MORE_HIKES_RE.test(text)) return 'dovish';
  if (NO_MORE_CUTS_RE.test(text)) return 'hawkish';
  if (HOLD_RE.test(text)) return 'hold';
  const dove = DOVISH_RE.test(text), hawk = HAWKISH_RE.test(text);
  return dove && hawk ? 'mixed' : dove ? 'dovish' : hawk ? 'hawkish' : null;
}

export function analyzeFx(text, tier, outlets = 1) {
  const found = new Map(); // code -> { dir, why }
  for (const [code, re] of CURRENCIES) if (re.test(text)) found.set(code, { dir: null, why: null });

  // 1. Explicit moves in the headline ("yen weakens", "EUR/USD rises")
  for (const m of text.matchAll(PAIR_RE)) {
    const [, base, quote, w] = m; const up = isUp(w);
    found.set(base.toUpperCase(), { src: 'move', dir: up ? 'up' : 'down', why: `${base.toUpperCase()}/${quote.toUpperCase()} ${up ? 'rising' : 'falling'}` });
    found.set(quote.toUpperCase(), { src: 'move', dir: up ? 'down' : 'up', why: `${base.toUpperCase()}/${quote.toUpperCase()} ${up ? 'rising' : 'falling'}` });
  }
  for (const m of text.matchAll(MOVE_RE)) {
    const code = NAME_TO_CODE[m[1].toLowerCase()]; const up = isUp(m[2]);
    if (code && !found.get(code)?.dir) found.set(code, { src: 'move', dir: up ? 'up' : 'down', why: `${m[1]} ${up ? 'rising' : 'falling'} in the headline` });
  }

  // 2. Central bank / data language, applied to the first currency mentioned without a move
  let policy = null;
  if (NO_MORE_HIKES_RE.test(text)) policy = 'dovish';
  else if (NO_MORE_CUTS_RE.test(text)) policy = 'hawkish';
  else if (HOLD_RE.test(text)) policy = 'hold';
  else {
    const dove = DOVISH_RE.test(text), hawk = HAWKISH_RE.test(text);
    if (dove && hawk) policy = 'mixed'; else if (dove) policy = 'dovish'; else if (hawk) policy = 'hawkish';
  }
  const target = [...found.entries()].find(([c, v]) => !v.dir && c !== 'XAU');
  if (target && policy) {
    const [c] = target;
    if (policy === 'hawkish') found.set(c, { src: 'policy', dir: 'up', why: `Hawkish or strong-data language, which usually supports ${c}` });
    else if (policy === 'dovish') found.set(c, { src: 'policy', dir: 'down', why: `Rate-cut or weak-data language, which usually weighs on ${c}` });
    else if (policy === 'hold') found.set(c, { src: 'policy', dir: 'flat', why: `Rates on hold, so the reaction depends on the guidance` });
    else found.set(c, { src: 'policy', dir: 'mixed', why: `Mixed signals for ${c}` });
  }

  // 3. Oil moves tend to drag the Canadian dollar along
  if (OIL_RE.test(text) && !found.get('CAD')?.dir) {
    if (OIL_UP_RE.test(text)) found.set('CAD', { dir: 'up', why: 'Oil rising, and CAD often follows oil' });
    else if (OIL_DOWN_RE.test(text)) found.set('CAD', { dir: 'down', why: 'Oil falling, and CAD often follows oil' });
  }

  if (!found.size) return null;

  let impact = HIGH_IMPACT_RE.test(text) ? 'high' : MED_IMPACT_RE.test(text) ? 'medium' : 'low';
  if (tier === 'major') impact = 'high';
  else if (tier === 'notable' && impact === 'low') impact = 'medium';

  const currencies = [...found.entries()].map(([code, v]) => ({ code, dir: v.dir || 'unclear' }));
  const why = [...found.values()].map(v => v.why).filter(Boolean)[0] || 'Mentions these currencies; direction unclear from the headline';
  const strong = [...found.values()].some(v => v.dir) || HIGH_IMPACT_RE.test(text) || MED_IMPACT_RE.test(text);
  const assets = forecastAssets(text, found, policy, impact, outlets);
  return { impact, currencies, why, strong, assets };
}

/* ---------- Gold / USD / Nasdaq forecast with a 1-10 confidence ---------- */

const STOCK_MOVE_RE = new RegExp(`\\b(stocks?|shares|wall street|nasdaq|s&p 500|s&p|equities|tech stocks|dow)\\b(?:\\s+\\S+){0,3}?\\s+(${UP_WORDS}|${DOWN_WORDS}|rise|rally|jump|surge|climb|fall|drop|slide|tumble|sink|slump|plunge|sell off|sell-off)\\b`, 'i');
const RISK_OFF_RE = /\b(war|attacks?|missiles?|airstrikes?|strikes? on|invasion|escalat\w*|crisis|conflict|killed|explosions?|sanctions|coup|safe[- ]haven)\b/i;
const US_RE = /\b(fed|fomc|federal reserve|powell|warsh|u\.?s\.? (cpi|inflation|jobs|payrolls|economy|gdp)|nonfarm|treasury yields?)\b/i;
const MAJORS = ['EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CHF', 'CAD'];

function forecastAssets(text, found, policy, impact, outlets) {
  const bump = (impact === 'high' ? 1 : 0) + (outlets >= 3 ? 1 : 0);
  const cap = n => Math.max(1, Math.min(9, Math.round(n)));
  const flat = { dir: 'flat', conf: null };
  const opp = d => (d === 'up' ? 'down' : 'up');
  const isUS = US_RE.test(text);
  const hawk = policy === 'hawkish', dove = policy === 'dovish';

  // USD
  let usd = flat;
  const u = found.get('USD');
  if (u && (u.dir === 'up' || u.dir === 'down')) {
    usd = { dir: u.dir, conf: cap((u.src === 'move' ? 7 : isUS ? 6 : 5) + bump) };
  } else {
    const other = MAJORS.map(c => found.get(c)).find(v => v && v.src === 'move' && (v.dir === 'up' || v.dir === 'down'));
    if (other) usd = { dir: opp(other.dir), conf: cap(4 + bump) };
    else if (isUS && (hawk || dove)) usd = { dir: hawk ? 'up' : 'down', conf: cap(6 + bump) };
  }

  // Gold
  let gold = flat;
  const g = found.get('XAU');
  if (g && (g.dir === 'up' || g.dir === 'down')) gold = { dir: g.dir, conf: cap(7 + bump) };
  else if (RISK_OFF_RE.test(text)) gold = { dir: 'up', conf: cap(5 + bump) };
  else if (usd.dir !== 'flat') gold = { dir: opp(usd.dir), conf: cap(Math.max(3, usd.conf - 2)) };
  else if (hawk || dove) gold = { dir: hawk ? 'down' : 'up', conf: cap((isUS ? 5 : 3) + (isUS ? bump : 0)) };

  // Nasdaq
  let ndq = flat;
  const sm = text.match(STOCK_MOVE_RE);
  if (sm) ndq = { dir: (isUp(sm[2]) || /^(rise|rally|jump|surge|climb)$/i.test(sm[2])) ? 'up' : 'down', conf: cap(7 + bump) };
  else if (hawk || dove) ndq = { dir: hawk ? 'down' : 'up', conf: cap((isUS ? 5 : 3) + (isUS ? bump : 0)) };
  else if (RISK_OFF_RE.test(text)) ndq = { dir: 'down', conf: cap(4 + bump) };
  else if (usd.dir !== 'flat') ndq = { dir: opp(usd.dir), conf: cap(3) };

  return { gold, usd, ndq };
}

/* ---------- Economic calendar ---------- */

const INVERSE_RE = /unemployment|jobless|claims/i;
function num(v) {
  if (v == null || v === '') return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/K$/i.test(v)) n *= 1e3; else if (/M$/i.test(v)) n *= 1e6; else if (/B$/i.test(v)) n *= 1e9;
  return n;
}
export function calendarEvent(e) {
  const actual = e.actual ?? null;
  let dir = null;
  const a = num(actual), f = num(e.forecast);
  if (a != null && f != null && a !== f) {
    let better = a > f;
    if (INVERSE_RE.test(e.title)) better = !better;
    dir = better ? 'up' : 'down';
  }
  return {
    title: e.title, currency: e.country, time: e.date, impact: (e.impact || '').toLowerCase(),
    forecast: e.forecast || null, previous: e.previous || null, actual, dir,
  };
}
