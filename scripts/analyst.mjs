// AI analyst: reads important market stories and reasons about what they mean for gold, the Nasdaq, the US dollar and
// oil over the next day, then combines that with the trained next-day model and the rules into one balanced call.
//
// - The AI is a free open model (Qwen2.5 14B Instruct) running on the robot's own GitHub machines: no key, no cost, no
//   daily limit (.github/workflows/analyst.yml runs five AI workers next to the news robot). It's slow (a few minutes
//   per story), so only stories that matter are analysed (importance, trusted outlets, confirmation), most important first.
// - The AI works through every cause-and-effect channel (safe haven, real yields, the Fed's likely response, the dollar,
//   inflation expectations, oil, risk mood, positioning, "already priced in") and says which forces win and why.
// - Credibility counts: confirmed facts vs reports vs speculation, conflicting reports, how many outlets confirm it.
// - Its "confidence" is a rating, not a probability. A probability ("calls like this were right X% of the time") is
//   only shown once enough of its own calls have been checked against what prices did.
// - It learns from outcomes in the simplest honest way: each analysis sees its own recent record per market,
//   including its latest misses, and the ratings are graded against real results in the scorecard.

const API = process.env.AI_URL || 'http://127.0.0.1:8000/v1/chat/completions'; // the local AI server
export const AI_MODEL = 'Qwen2.5 14B (open model)';
export const ORDER = ['gold', 'ndq', 'usd', 'oil']; // Issa's priority
const NAMES = { gold: 'Gold (XAU/USD)', ndq: 'Nasdaq 100', usd: 'US Dollar Index (DXY)', oil: 'WTI crude oil' };
const H = 3600e3;

/* ---------- Extra market context: yields, real yields, inflation expectations, Fed expectations, fear gauge ---------- */
const day = ms => new Date(ms).toISOString().slice(0, 10);
async function yahooDaily(sym, getText) {
  const j = JSON.parse(await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=2mo&interval=1d`));
  const r = j.chart.result[0], q = r.indicators.quote[0].close;
  const byDay = {};
  r.timestamp.forEach((t, i) => { if (q[i] != null) byDay[day(t * 1000)] = q[i]; });
  const c = Object.values(byDay);
  return { last: c[c.length - 1], d1: c[c.length - 2], d5: c[Math.max(0, c.length - 6)], d20: c[Math.max(0, c.length - 21)], byDay };
}
async function fredDaily(id, getText) {
  const csv = await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  const rows = csv.trim().split('\n').slice(1).map(l => l.split(',')).filter(r => !isNaN(parseFloat(r[1]))).slice(-60);
  const v = rows.map(r => parseFloat(r[1]));
  return { last: v[v.length - 1], d5: v[Math.max(0, v.length - 6)], d20: v[Math.max(0, v.length - 21)], byDay: Object.fromEntries(rows.map(r => [r[0], parseFloat(r[1])])) };
}
export async function getMacro(prev, now, getText) {
  if (prev && now - prev.at < 30 * 60e3) return prev;
  const out = { at: now, items: { ...(prev?.items || {}) } };
  const jobs = {
    us10y: () => yahooDaily('%5ETNX', getText), us2y: () => yahooDaily('2YY%3DF', getText), vix: () => yahooDaily('%5EVIX', getText),
    fedFut: () => yahooDaily('ZQ%3DF', getText), real10y: () => fredDaily('DFII10', getText), be5y: () => fredDaily('T5YIE', getText),
  };
  await Promise.all(Object.entries(jobs).map(async ([k, f]) => { try { out.items[k] = await f(); } catch {} }));
  return out;
}
const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
const f2 = v => (v == null || isNaN(v) ? 'n/a' : (Math.round(v * 100) / 100).toString());
const sg = v => (v == null || isNaN(v) ? 'n/a' : `${v >= 0 ? '+' : ''}${f2(v)}`);

function snapshot(ctx) {
  const lines = [];
  for (const k of ORDER) {
    const bars = ctx.charts?.assets?.[k]?.ranges?.['1Y']?.bars || [];
    const c = bars.map(b => b[4]).filter(v => v != null);
    const live = ctx.markets?.items?.[k]?.last ?? c[c.length - 1];
    if (!c.length && live == null) continue;
    const ref = n => c[Math.max(0, c.length - 1 - n)];
    lines.push(`${NAMES[k]}: ${f2(live)} | 1d ${sg(pct(live, ref(1)))}% | 5d ${sg(pct(live, ref(5)))}% | 20d ${sg(pct(live, ref(20)))}% | 1y range ${f2(Math.min(...c))}-${f2(Math.max(...c))}`);
  }
  const m = ctx.macro?.items || {};
  const bp = (x, y) => (x != null && y != null ? `${sg((x - y) * 100)}bp` : 'n/a');
  if (m.us10y) lines.push(`US 10y yield: ${f2(m.us10y.last)}% (5d ${bp(m.us10y.last, m.us10y.d5)}, 20d ${bp(m.us10y.last, m.us10y.d20)})`);
  if (m.us2y) lines.push(`US 2y yield: ${f2(m.us2y.last)}% (5d ${bp(m.us2y.last, m.us2y.d5)}, 20d ${bp(m.us2y.last, m.us2y.d20)})`);
  if (m.real10y) lines.push(`US 10y real yield (TIPS): ${f2(m.real10y.last)}% (5d ${bp(m.real10y.last, m.real10y.d5)}, 20d ${bp(m.real10y.last, m.real10y.d20)})`);
  if (m.be5y) lines.push(`5y breakeven inflation: ${f2(m.be5y.last)}% (20d ${bp(m.be5y.last, m.be5y.d20)})`);
  if (m.fedFut) lines.push(`Fed funds futures (front month) imply ~${f2(100 - m.fedFut.last)}% (20d change ${bp(100 - m.fedFut.last, 100 - m.fedFut.d20)})`);
  if (m.vix) lines.push(`VIX: ${f2(m.vix.last)} (5d ${sg(m.vix.last - m.vix.d5)})`);
  const bm = ctx.bigMoney;
  if (bm) lines.push('Hedge-fund positioning (CFTC, weekly): ' + ORDER.filter(k => bm[k]).map(k => `${k} ${f2(bm[k].longPct)}% long (${bm[k].pctile}th percentile of 3y)`).join('; '));
  return lines.join('\n');
}

// how big a release surprise was, compared with that release's usual surprises (z-score from the calendar model)
const surpriseWord = z => { const a = Math.abs(z); return a < 0.5 ? 'in line' : a < 1 ? 'small' : a < 2 ? 'large' : 'very large'; };
// Regime check: how gold has actually been moving with the dollar, yields, the Nasdaq and oil over the last 20 trading
// days (these links change over time; the AI should reason with the current one, not the textbook one)
function corr(a, b) {
  const n = a.length; if (n < 8) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}
const linkWord = c => (c == null ? 'n/a' : c <= -0.4 ? 'strongly opposite' : c <= -0.15 ? 'somewhat opposite' : c < 0.15 ? 'no clear link' : c < 0.4 ? 'somewhat together' : 'strongly together');
export function regimeText(ctx) {
  const daily = k => Object.fromEntries((ctx.charts?.assets?.[k]?.ranges?.['1Y']?.bars || []).map(b => [day(b[0] * 1000), b[4]]));
  const changes = (m, days, pct) => { const out = []; for (let i = 1; i < days.length; i++) { const a = m[days[i - 1]], b = m[days[i]]; out.push(a != null && b != null ? (pct ? (b / a - 1) * 100 : b - a) : null); } return out; };
  const gold = daily('gold');
  const days = Object.keys(gold).sort().slice(-21);
  if (days.length < 10) return '';
  const g = changes(gold, days, true);
  const pair = (other, pct) => { const o = changes(other || {}, days, pct); const idx = g.map((x, i) => (x != null && o[i] != null ? i : -1)).filter(i => i >= 0); return corr(idx.map(i => g[i]), idx.map(i => o[i])); };
  const m = ctx.macro?.items || {};
  const links = [['the dollar index', pair(daily('usd'), true)], ['the US 10y yield', pair(m.us10y?.byDay, false)], ['the 10y real yield', pair(m.real10y?.byDay, false)],
    ['the Nasdaq', pair(daily('ndq'), true)], ['oil', pair(daily('oil'), true)]];
  const vol = Math.sqrt(g.filter(x => x != null).reduce((a, x) => a + x * x, 0) / Math.max(1, g.filter(x => x != null).length));
  return `HOW GOLD HAS BEEN MOVING (last 20 trading days, correlation of daily moves; textbook: opposite to the dollar and real yields)\n` +
    links.map(([n, c]) => `gold vs ${n}: ${c == null ? 'n/a' : (Math.round(c * 100) / 100).toFixed(2)} (${linkWord(c)})`).join('; ') + `. Gold's typical daily move: ${vol.toFixed(2)}%.`;
}

function calendarText(ctx, now) {
  const ev = (ctx.calendar?.events || []).map(e => ({ ...e, t: Date.parse(e.time) })).filter(e => e.impact === 'high' || e.impact === 'medium');
  const past = ev.filter(e => e.t <= now && e.t > now - 36 * H && e.actual != null).slice(-8)
    .map(e => `${e.title}: actual ${e.actual} vs forecast ${e.forecast ?? 'n/a'} (prev ${e.previous ?? 'n/a'})${e.z != null ? `, surprise ${e.z > 0 ? '+' : ''}${e.z} normal surprises (${surpriseWord(e.z)})` : ''}, ${Math.round((now - e.t) / H)}h ago`);
  const next = ev.filter(e => e.t > now && e.t < now + 48 * H).slice(0, 8).map(e => `${e.title} in ${Math.round((e.t - now) / H)}h (forecast ${e.forecast ?? 'n/a'})`);
  return `Recent US releases:\n${past.join('\n') || 'none'}\nComing up (48h):\n${next.join('\n') || 'none'}`;
}

function recordText(ctx, k) {
  const done = (ctx.forecasts || []).filter(f => f.ai && f.asset === k && (f.result === 'hit' || f.result === 'miss')).sort((a, b) => b.at - a.at).slice(0, 25);
  if (done.length < 3) return `${k}: not enough checked calls yet`;
  const hit = done.filter(f => f.result === 'hit').length;
  const misses = done.filter(f => f.result === 'miss').slice(0, 2).map(f => `"${f.title.slice(0, 70)}" called ${f.dir}, moved ${sg(f.chg)}%`);
  return `${k}: ${hit}/${done.length} right${misses.length ? `; recent misses: ${misses.join('; ')}` : ''}`;
}

/* ---------- The reasoning instructions ---------- */
const SYSTEM = `You are a senior macro strategist writing for a gold trader. For one news story you judge the likely effect on four markets over the NEXT 24 HOURS: gold, Nasdaq 100, US Dollar Index, WTI oil. Gold matters most: give it the most care.

Method (do it for every market):
1. Credibility first. Classify the story: "confirmed" (multiple reliable outlets or verified), "official" (statement/data from a government, central bank or company), "reported" (one outlet or anonymous sources), "unverified" (rumour, single unknown source, early breaking report), "speculation" (forecasts, analysis, "could/may"), "opinion", or "conflicting" (outlets disagree). Separate facts from claims: one side's statement about its opponent ("Russia says Ukraine...", "X accuses Y") is a claim, so the status is at most "reported". Treat breaking unconfirmed reports cautiously. A headline being new does not make it important.
2. Causal channels. Reason through each channel that applies, with direction and strength:
 GOLD: real yields (up = bearish), US dollar (up = bearish), Fed path (dovish = bullish, hawkish = bearish), inflation expectations (bullish via hedge demand, BUT bearish if they push the Fed hawkish and lift real yields), safe-haven demand (geopolitical/financial stress = bullish, often fades if no escalation), risk sentiment (sharp equity panics can force gold selling for cash), central-bank and physical demand (China, India, ETFs), oil (via inflation and Fed expectations, either way), positioning (crowded longs = downside risk), already priced in / buy-the-rumour-sell-the-fact.
 NASDAQ: yields and Fed path (higher = bearish for long-duration tech), AI/tech earnings and capex, risk sentiment, regulation, tariffs and China chip curbs, oil and inflation, dollar.
 USD: rate differentials (Fed vs ECB, BoJ, BoE), US data surprises, safe-haven demand in global stress, risk-on weakens USD, tariffs (often short-term USD up), US fiscal/political risk (USD down), positioning.
 OIL: supply (OPEC+, sanctions, outages, war near producers or shipping lanes), demand (China, global growth, recession risk), inventories, dollar (inverse), de-escalation (bearish), risk sentiment.
3. Competing effects. Use the "how gold has been moving" line: if gold has recently moved WITH the dollar or yields instead of against them, the textbook link is not working right now, so weigh it less. Effects often conflict. Example: a war lifts safe-haven demand for gold, but if it sends oil higher, raises inflation expectations, makes a tighter Fed more likely and strengthens the dollar, those can push gold DOWN. Decide which forces dominate given THIS situation, the current market snapshot (recent moves, yields, positioning, what the market already expects) and the likely policy response. Similar events can move markets differently.
4. Priced in? If the market already moved on this or it was widely expected, the remaining effect is smaller.
5. Be honest. If the evidence is balanced or thin, say "unclear" or "neutral" with low conviction (0-3). Never force a call. Never invent facts or numbers: use only what is given, with the exact labels given (do not mix up nominal yields, real yields and the Fed funds rate). Conviction caps: unverified 4, speculation/opinion 3, conflicting 3, headline-only input 6. Analysis pieces, previews and question headlines ("Will the Fed...?") are "speculation" or "opinion", not news. Use the full 0-10 range: most stories deserve 2-5; 8+ only for major confirmed surprises.
6. Consistency. Every factor's "dir" is the direction IT pushes that market ("up" or "down"). Your bias must follow from the factors you list: bullish only if the "up" factors are stronger overall, bearish only if the "down" factors are. "wins" must name the side you chose.

Use the trained model's view and your own recent record as supporting evidence, not as the answer.

Reply with JSON only, no prose outside it. Be concise: every text field max ~15 words, gold 3-5 factors, the others 2-4:
{"status":"confirmed|official|reported|unverified|speculation|opinion|conflicting","credibility":1-5,"importance":1-5,"priced_in":"none|partly|mostly","what":"one sentence: what actually happened","facts":["what happened that is verified (not who reported it)"],"claims":["statements not independently verified, e.g. one side's allegations"],
"markets":{"gold":{"factors":[{"f":"channel name","chain":"cause -> effect -> gold","dir":"up|down","s":"weak|moderate|strong"}],"bias":"bullish|bearish|neutral|unclear","conviction":0-10,"wins":"which side dominates and why","counter":"best argument against your call","flip":"what would change the view"},
"ndq":{same fields, 2-4 factors},"usd":{same},"oil":{same}},
"uncertainty":"main unknowns"}`;

function userPrompt(st, ctx, now, text) {
  const age = (now - Math.min(st.published, st.firstSeen)) / H;
  const outlets = [`${st.outlet} (lead${st.trusted ? ', trusted' : ''})`, ...(st.sources || []).map(s => s.outlet)].slice(0, 9);
  const others = (st.sources || []).filter(s => s.title && s.title !== st.title).slice(0, 6).map(s => `- ${s.outlet}: ${s.title}`);
  const ml = ORDER.filter(k => st._d1?.[k]).map(k => `${k} ${st._d1[k].dir} (tested ${Math.round((st._d1[k].hit || 0.5) * 100)}% right at this level)`).join('; ');
  const rules = ORDER.filter(k => st._rules?.[k]?.conf && st._rules[k].dir !== 'flat').map(k => `${k} ${st._rules[k].dir} ${st._rules[k].conf}/10`).join('; ');
  const recent = (ctx.recent || []).filter(r => r.id !== st.id).slice(0, 10).map(r => `- ${Math.round((now - r.t) / H)}h ago: ${r.title}`);
  return `STORY
Headline: ${st.title}
Published ${age < 1 ? `${Math.round(age * 60)} min` : `${age.toFixed(1)}h`} ago. Outlets covering it (${outlets.length}): ${outlets.join(', ')}.${st.breaking ? ' Marked breaking.' : ''}
Other outlets' headlines:
${others.join('\n') || '(none)'}
Article text ${text.full ? '(from the article)' : '(summary only; full text unavailable)'}:
${text.body || '(headline only)'}

MARKET SNAPSHOT (now)
${snapshot(ctx)}
${regimeText(ctx)}

${calendarText(ctx, now)}

OTHER MARKET HEADLINES (last 12h, for context and "priced in")
${recent.join('\n') || '(none)'}

SUPPORTING EVIDENCE
Trained next-day model (learned from ~10 years of headlines and price moves): ${ml || 'no call'}
Keyword rules: ${rules || 'no call'}
Your recent record on checked next-day calls: ${ORDER.map(k => recordText(ctx, k)).join(' | ')}`;
}

/* ---------- Reading the article ---------- */
const cleanTxt = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
async function articleBody(st, getPage) {
  const links = [st.link, ...(st.sources || []).map(s => s.link)].filter(l => l && !/news\.google\.com/.test(l)).slice(0, 3);
  for (const l of links) {
    try {
      const html = await getPage(l);
      const body = html.replace(/<(script|style|noscript|figure|figcaption|aside|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ');
      const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => cleanTxt(m[1])).filter(t => t.length > 60 && !/cookie|subscribe|sign up|newsletter|advertis|all rights reserved|©/i.test(t));
      const text = paras.join(' ');
      if (text.length > 600) return { body: text.slice(0, 2600), full: true };
    } catch {}
  }
  return { body: (st.summary || '').slice(0, 1200), full: false };
}

/* ---------- Which stories get analysed ---------- */
const GOLD_DRIVERS = ['fed', 'inflation', 'jobs', 'yields', 'usd', 'war', 'peace', 'oil', 'sanctions', 'trade', 'cb', 'gold', 'growth', 'politics', 'preview'];
export function priority(st, now) {
  const fx = st.fx || {};
  const age = (now - Math.min(st.published, st.firstSeen)) / H;
  let p = { high: 3, medium: 2, low: 0.5 }[fx.impact] || 0;
  if (st.breaking) p += 2;
  if (st.top) p += 1;
  p += Math.min((st.sources || []).length, 6) * 0.4;
  if (st.trusted) p += 1;
  if (GOLD_DRIVERS.includes(fx.driver)) p += 1;
  p -= Math.max(0, age - 2) * 0.25; // fresher first, but importance wins
  return p;
}
function eligible(st, now) {
  const fx = st.fx;
  if (!fx || fx.driver === 'wrap') return false;
  if (now - Math.min(st.published, st.firstSeen) > 10 * H) return false;
  // nearly every market story gets analysed (most important first); only small single-source items from unknown
  // outlets are skipped
  const outlets = (st.sources || []).length + 1;
  return fx.impact !== 'low' || st.breaking || st.top || st.trusted || outlets >= 2;
}

/* ---------- The model call ---------- */
async function callModel(system, user) {
  // streamed, so a long analysis (several minutes on the robot's CPU) never hits a waiting-for-reply timeout
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 14 * 60e3);
  try {
    const body = { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 1000, response_format: { type: 'json_object' }, stream: true };
    const res = await fetch(API, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    let txt = '', buf = '';
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim();
        if (d === '[DONE]') continue;
        try { txt += JSON.parse(d).choices?.[0]?.delta?.content || ''; } catch {}
      }
    }
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON');
    return JSON.parse(m[0]);
  } finally { clearTimeout(t); }
}

const BIAS = new Set(['bullish', 'bearish', 'neutral', 'unclear']);
const STATUS = new Set(['confirmed', 'official', 'reported', 'unverified', 'speculation', 'opinion', 'conflicting']);
const short = (s, n = 160) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
function tidy(r) {
  const out = {
    status: STATUS.has(r.status) ? r.status : 'reported', credibility: Math.max(1, Math.min(5, +r.credibility || 3)), importance: Math.max(1, Math.min(5, +r.importance || 3)),
    priced_in: ['none', 'partly', 'mostly'].includes(r.priced_in) ? r.priced_in : 'partly', what: short(r.what, 220),
    facts: (r.facts || []).slice(0, 4).map(x => short(x)), claims: (r.claims || []).slice(0, 4).map(x => short(x)), uncertainty: short(r.uncertainty, 200), markets: {},
  };
  const cap = { unverified: 4, speculation: 3, opinion: 3, conflicting: 3 }[out.status] ?? 10;
  for (const k of ORDER) {
    const m = r.markets?.[k]; if (!m) continue;
    const W = { weak: 1, moderate: 2, strong: 3 };
    const fac = (Array.isArray(m.factors) ? m.factors : [...(m.bull || []).map(x => ({ ...x, dir: x.dir || 'up' })), ...(m.bear || []).map(x => ({ ...x, dir: x.dir || 'down' }))])
      .slice(0, 6).map(x => ({ f: short(x.f, 80), chain: short(x.chain, 160), dir: x.dir === 'down' ? 'down' : 'up', s: W[x.s] ? x.s : 'moderate' })).filter(x => x.f);
    let bias = BIAS.has(m.bias) ? m.bias : 'unclear', conviction = Math.max(0, Math.min(cap, Math.round(+m.conviction || 0)));
    // consistency check: the call must follow from its own factors, otherwise it isn't trusted
    const net = fac.reduce((n, x) => n + (x.dir === 'up' ? 1 : -1) * W[x.s], 0), tot = fac.reduce((n, x) => n + W[x.s], 0);
    let check = 'ok';
    if ((bias === 'bullish' && net <= 0) || (bias === 'bearish' && net >= 0)) { bias = 'unclear'; conviction = Math.min(conviction, 2); check = 'contradicts its factors'; }
    else if (bias === 'bullish' || bias === 'bearish') conviction = Math.min(conviction, Math.round(3 + 7 * Math.abs(net) / Math.max(tot, 1))); // a lopsided case can be confident, a close one can't
    if (bias === 'neutral' || bias === 'unclear') conviction = Math.min(conviction, 3);
    out.markets[k] = { bias, conviction, factors: fac, bull: fac.filter(x => x.dir === 'up'), bear: fac.filter(x => x.dir === 'down'), wins: check === 'ok' ? short(m.wins, 220) : `The AI's factors didn't support its own call, so this is treated as unclear.`, counter: short(m.counter, 200), flip: short(m.flip, 200), check };
  }
  return out;
}

/* ---------- Combining the AI, the trained model and the rules ---------- */
// Weights: the AI's reasoning 55%, the trained next-day model 35% (tested on 10 years), the rules 10%.
// Credibility and "already priced in" scale the whole call down; when the AI and the trained model disagree the call
// is weakened. The result is a 1-10 confidence (not a probability) and "no clear move" when it's too weak.
const CRED = { confirmed: 1, official: 1, reported: 0.85, unverified: 0.55, speculation: 0.5, opinion: 0.45, conflicting: 0.45 };
const PRICED = { none: 1, partly: 0.85, mostly: 0.6 };
// w: the AI's weight per market, set from its backtest accuracy (gradeBacktest); 0.55 until there's enough evidence
export function combine(an, d1, rules, w = {}) {
  const out = {};
  for (const k of ORDER) {
    const a = an.markets[k];
    const av = a && (a.bias === 'bullish' || a.bias === 'bearish') ? (a.bias === 'bullish' ? 1 : -1) * a.conviction / 10 : 0;
    const ml = d1?.[k], mv = ml && (ml.dir === 'up' || ml.dir === 'down') ? (ml.dir === 'up' ? 1 : -1) * Math.max(0, Math.min(1, ((ml.hit ?? 0.5) - 0.5) / 0.15)) : 0;
    const ru = rules?.[k], rv = ru && ru.conf && (ru.dir === 'up' || ru.dir === 'down') ? (ru.dir === 'up' ? 1 : -1) * ru.conf / 10 : 0;
    let s = ((w[k] ?? 0.55) * av + 0.35 * mv + 0.10 * rv) * (CRED[an.status] ?? 0.8) * (PRICED[an.priced_in] ?? 0.85);
    if (av && mv && Math.sign(av) !== Math.sign(mv)) s *= 0.6;
    const conf = Math.max(1, Math.min(10, Math.round(Math.abs(s) * 11)));
    out[k] = Math.abs(s) < 0.1 ? { dir: 'flat', conf: null, next: true, ai: true } : { dir: s > 0 ? 'up' : 'down', conf, next: true, ai: true };
  }
  return out;
}

/* ---------- Picking and analysing ---------- */
// analyses: {id: {...}} already done (by any worker). Returns the stories to analyse next, most important first.
export function pickStories(stories, analyses, now, shard = 0, shards = 1) {
  const hashN = id => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % shards;
  return stories.filter(st => {
    if (hashN(st.id) !== shard || !eligible(st, now)) return false;
    const prev = analyses[st.id];
    if (!prev) return true; // every story gets its own analysis (different angles on one event can move markets differently)
    // analysed again once if it was shaky and has since been confirmed by more outlets or turned into breaking news
    const outlets = (st.sources || []).length + 1;
    return !prev.redo && ['unverified', 'reported', 'conflicting'].includes(prev.res.status) && (outlets >= prev.outlets + 2 || (st.breaking && !prev.breaking));
  }).sort((a, b) => priority(b, now) - priority(a, now));
}
// Backtest (scripts/backtest-run.mjs): the same analysis on a past headline, with the market picture of that moment
export async function analysePrepared(task) {
  const age = new Date(task.ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const user = `STORY
Headline: ${task.title}
Published ${age} UTC by ${task.outlet || 'an outlet'} (how many outlets covered it is not known in this test).
Article text ${task.text ? '(opening of the article)' : '(headline only)'}:
${task.text || '(headline only)'}

MARKET SNAPSHOT (at that moment)
${task.snapshot}
${task.regime || ''}

Recent US releases: not available in this test.

OTHER MARKET HEADLINES (previous 12h, for context and "priced in")
${(task.recent || []).map(t => `- ${t}`).join('\n') || '(none)'}

SUPPORTING EVIDENCE: not available in this test.`;
  const raw = await callModel(SYSTEM, user);
  if (SPECULATIVE.test(task.title) && !['official', 'opinion', 'speculation', 'unverified', 'conflicting'].includes(raw.status)) raw.status = 'speculation';
  if (raw.status === 'confirmed' && /\b(says|said|claims?|claimed|accuses?|accused|alleges?|alleged)\b/i.test(task.title)) raw.status = 'reported';
  return tidy(raw);
}

const SPECULATIVE = /\?\s*(\(|$)|\b(could|might|may|preview|what to expect|what to watch|things to watch|week ahead|outlook|forecast|prediction|opinion|analysis|explainer|why |how )\b/i;
export async function analyseOne(st, ctx, now, getPage) {
  const text = await articleBody(st, getPage);
  const raw = await callModel(SYSTEM, userPrompt(st, ctx, now, text));
  // a question, preview or analysis headline is speculation however the AI labels it
  if (SPECULATIVE.test(st.title) && !['official', 'opinion', 'speculation', 'unverified', 'conflicting'].includes(raw.status)) raw.status = 'speculation';
  // "X says / claims / accuses" headlines are one side's claim unless several outlets confirm the event itself
  if (raw.status === 'confirmed' && /\b(says|said|claims?|claimed|accuses?|accused|alleges?|alleged)\b/i.test(st.title)) raw.status = 'reported';
  const res = tidy(raw);
  return { id: st.id, at: now, model: AI_MODEL, res, ev: st.ev, outlets: (st.sources || []).length + 1, breaking: !!st.breaking, full: text.full, title: st.title };
}

/* ---------- Grading the AI on past headlines (results from the backtest workers) ---------- */
// For each market: how often the AI's bullish/bearish calls matched the next day's move, overall and by how confident
// it was. The AI's weight in the blend follows: more weight where it has proven right, less where it hasn't.
export const convBucket = c => (c >= 7 ? '7-10' : c >= 4 ? '4-6' : '1-3');
export function gradeBacktest(results) {
  const out = { n: results.length, markets: {}, weights: {} };
  for (const k of ORDER) {
    const g = { n: 0, hit: 0, byConv: {} };
    for (const r of results) {
      const m = r.markets?.[k], y = r.labels?.[k]?.d1;
      if (!m || (m.bias !== 'bullish' && m.bias !== 'bearish') || y == null || Math.abs(y) < 0.02) continue;
      const ok = (m.bias === 'bullish') === (y > 0), b = convBucket(m.conviction);
      g.n++; g.hit += ok ? 1 : 0;
      (g.byConv[b] ||= { n: 0, hit: 0 }).n++; if (ok) g.byConv[b].hit++;
    }
    out.markets[k] = g;
    const acc = g.n ? g.hit / g.n : null;
    out.weights[k] = g.n >= 150 ? Math.max(0.15, Math.min(0.8, 0.55 + (acc - 0.53) * 6)) : 0.55;
  }
  return out;
}
