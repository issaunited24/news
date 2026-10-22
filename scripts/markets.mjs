// Market catalysts: news that is likely to MOVE gold, the US dollar or the Nasdaq,
// as opposed to reports that a price already moved. Plain rules, no AI.

const ASSET = '(gold|silver|bullion|dollar|greenback|euro|pound|sterling|yen|franc|loonie|aussie|kiwi|yuan|rupee|bitcoin|crypto|ether|oil|crude|brent|wti|nasdaq|s&p(?: 500)?|dow|stocks?|shares|equities|futures|treasur(?:y|ies)|yields?|bonds?|usd|eur|gbp|jpy|chf|cad|aud|nzd|xau|xag|dxy|[a-z]{3}/[a-z]{3})';
const MOVE = '(rises?|rose|gains?|gained|jumps?|jumped|climbs?|climbed|rall(?:y|ies|ied)|surges?|surged|soars?|soared|advances?|rebounds?|recovers?|edges?|ticks?|firms?|steadies|steady|holds?|falls?|fell|drops?|dropped|slides?|slid|slips?|slipped|dips?|dipped|declines?|declined|tumbles?|tumbled|sinks?|sank|slumps?|slumped|plunges?|plunged|retreats?|eases?|eased|weakens?|weakened|strengthens?|strengthened|extends?|pares?|trims?|hovers?|stalls?|flat|mixed|higher|lower|hits? (?:a )?(?:fresh |new |record |\S+-\S+ )?(?:high|low)|at (?:record|\S+-\S+) (?:high|low))';
// "Gold rises...", "Stocks fall as...", "EUR/USD slips", "Dollar steady ahead of..."
const RECAP_RE = new RegExp(`^(?:[\\w'’.-]+\\s){0,3}?${ASSET}\\b(?:[\\s,:–-]+\\S+){0,3}?\\s+${MOVE}\\b`, 'i');
const TECH_RE = /\b(price (forecast|prediction|analysis)|technical (analysis|outlook)|forecast:|outlook:|support (level|zone)|resistance|fibonacci|elliott wave|pivot|bullish bias|bearish bias|chart of the (day|week)|week ahead|weekly (forecast|outlook)|daily (forecast|outlook)|market wrap|stocks to watch|stocks making|premarket|pre-market|after-hours movers|morning (brief|bid)|trade idea|signals?:|how to trade|what to expect from|live updates?|live:|price today|rate today|to watch|pick of the week|podcast|bitcoin|btc|crypto|(?:gold|oil|silver|crude) prices?|etfs?|what to know|explainer|explained|opinion|analysis:|[A-Z]{3}\/[A-Z]{3})\b/i;

const NOT_WAR_RE = /\b(price war|war on (drugs|crime|terror|cancer|poverty|christmas)|culture wars?|star wars|war chest|console war|talent war|bidding war|streaming war|war of words|war room|war film|war movie|war veteran|world war (i|ii|one|two|1|2)|civil war (film|movie|series)|warcraft|war games?)\b/i;
const US_CTX_RE = /\b(u\.?s\.?|united states|america|american|washington|white house|congress|senate|house of representatives|trump|vance|biden|republicans?|democrats?|gop|federal|fed|pentagon|treasury)\b/i;
const BIG_TECH_RE = /\b(apple|microsoft|nvidia|amazon|alphabet|google|meta|facebook|tesla|netflix|broadcom|amd|intel|oracle|salesforce|ibm|tsmc|asml|qualcomm|micron|palantir|openai|anthropic|jpmorgan|goldman sachs|bank of america|morgan stanley|walmart|berkshire)\b/gi;
const US_RE = /\b(fed|fomc|federal reserve|powell|warsh|u\.?s\.? (cpi|inflation|jobs|payrolls|economy|gdp|retail sales|consumer prices|pce)|nonfarm|non-farm|jobless claims|treasury yields?|us cpi|us inflation)\b/i;

const has = (re, t) => re.test(t);

// Each driver: test(text) -> null | { name, why, gold, usd, ndq, base } where asset values are 'up' | 'down' | 'flat'
const DRIVERS = [
  {
    name: 'war',
    test: t => {
      if (has(NOT_WAR_RE, t) && !/\b(missiles?|airstrikes?|troops|invasion)\b/i.test(t)) return null;
      const kinetic = /\b(airstrikes?|air strikes?|strikes? on|missile (strikes?|attacks?|launch(es)?|barrage)|missiles? (hit|fired|launched|struck|strike)|drone (strikes?|attacks?)|bombing|bombs?|shelling|invasion|invades?|invaded|troops (enter|cross|mass|deploy)|military (strike|operation|action|escalation)|declares? war|war (breaks out|erupts|escalates|widens)|escalat\w+|nuclear (threat|test|strike|weapon)|attacks? on (oil|shipping|tankers?|bases?|embassy|ships?)|vows invasion|retaliat\w+)\b/i;
      const actors = /\b(iran\w*|irgc|israel\w*|russia\w*|ukrain\w*|kyiv|moscow|china|chinese|taiwan|saudi|gulf|hormuz|houthis?|red sea|north korea\w*|nato|pentagon|oil|tankers?|u\.?s\.? (forces|troops|strikes?|military|bases?))\b/i;
      if (!kinetic.test(t) || !actors.test(t)) return null;
      const severe = /\b(escalat\w+|invasion|invades?|declares? war|nuclear|hormuz|oil|aramco|tankers?|vows invasion|war (breaks out|erupts|widens))\b/i.test(t) ? 1 : 0;
      const major = /\b(iran\w*|irgc|russia\w*|kyiv|moscow|china|chinese|taiwan|saudi|riyadh|aramco|gulf|hormuz|north korea\w*|nato|pentagon|oil|tankers?|u\.?s\.? (forces|troops|strikes?|military|bases?))\b/i.test(t);
      if (!major && !severe) return { why: 'A regional flare-up: small safe-haven effect unless it spreads.', gold: 'up', usd: 'flat', ndq: 'flat', base: { gold: 3 } };
      return { why: 'Conflict raises risk: safe-haven demand usually lifts gold and the dollar while stocks dip.', gold: 'up', usd: 'up', ndq: 'down', base: { gold: 6 + severe, usd: 4, ndq: 5 }, fxc: { USD: 'up', JPY: 'up+', CHF: 'up+', AUD: 'down', NZD: 'down', ...(severe ? { CAD: 'up' } : {}) } };
    },
  },
  {
    name: 'peace',
    test: t => /\b(ceasefire|cease-fire|truce|peace (deal|talks|agreement|plan|accord|summit)|de-escalat\w+|hostages? (released|freed|deal)|armistice|end (to|of) the war)\b/i.test(t)
      ? { why: 'Easing conflict usually cools safe-haven demand: gold tends to slip and stocks firm.', gold: 'down', usd: 'flat', ndq: 'up', base: { gold: 5, ndq: 4 }, fxc: { JPY: 'down', CHF: 'down', AUD: 'up', NZD: 'up' } } : null,
  },
  {
    name: 'fed',
    test: (t, ctx) => {
      if (!has(US_RE, t)) return null;
      if (ctx.policy === 'hawkish') return { why: 'Hawkish Fed signal or hot US data: higher-rate expectations support the dollar and weigh on gold and tech.', gold: 'down', usd: 'up', ndq: 'down', base: { gold: 6, usd: 7, ndq: 6 }, fxc: { USD: 'up' } };
      if (ctx.policy === 'dovish') return { why: 'Dovish Fed signal or soft US data: rate-cut hopes weigh on the dollar and help gold and tech.', gold: 'up', usd: 'down', ndq: 'up', base: { gold: 6, usd: 7, ndq: 6 }, fxc: { USD: 'down' } };
      if (/\b(fomc|fed (decision|meeting|minutes|chair|governor|speaks|speech)|powell|warsh|cpi|inflation (data|report)|jobs report|nonfarm|payrolls|gdp|pce)\b/i.test(t))
        return { why: 'Major Fed or US data event: expect volatility in the dollar, gold and stocks; direction depends on the outcome.', gold: 'flat', usd: 'flat', ndq: 'flat', base: {}, impact: 'medium', fxc: { USD: 'watch' } };
      return null;
    },
  },
  {
    name: 'earnings',
    test: t => {
      const names = [...new Set((t.match(BIG_TECH_RE) || []).map(n => n.toLowerCase()))];
      if (!names.length || !/\b(earnings|results|quarter(ly)?|q[1-4]|revenue|profit|sales|guidance|outlook|forecast)\b/i.test(t)) return null;
      const up = /\b(beats?|tops?|topped|surpass\w*|exceeds?|raises? (its )?(guidance|forecast|outlook)|record (revenue|profit|sales|quarter)|strong (results|demand|quarter)|profit (jumps|surges|soars|rises))\b/i.test(t);
      const down = /\b(miss(es|ed)?|falls? short|cuts? (its )?(guidance|forecast|outlook)|lowers? (its )?(guidance|forecast|outlook)|warns?|disappoint\w*|weak (results|demand|quarter|guidance)|profit (falls|drops|plunges|slumps|declines)|revenue (falls|drops|declines|misses)|loss widens)\b/i.test(t);
      if (up === down) return null;
      const many = names.length > 1 ? 1 : 0;
      return up
        ? { why: `Strong results from ${names.length > 1 ? 'big companies' : 'a market heavyweight'} usually lift the Nasdaq.`, gold: 'flat', usd: 'flat', ndq: 'up', base: { ndq: 6 + many } }
        : { why: `Weak results from ${names.length > 1 ? 'big companies' : 'a market heavyweight'} usually drag the Nasdaq lower.`, gold: 'flat', usd: 'flat', ndq: 'down', base: { ndq: 6 + many } };
    },
  },
  {
    name: 'trade',
    test: t => {
      if (/\b(trade (deal|agreement|truce)|tariffs? (cut|lifted|removed|paused|suspended|eased)|lifts? tariffs|eases? (export )?(curbs|controls))\b/i.test(t))
        return { why: 'Easing trade tension usually helps stocks and cools demand for gold.', gold: 'down', usd: 'flat', ndq: 'up', base: { gold: 3, ndq: 5 }, fxc: { AUD: 'up', CNY: 'up', JPY: 'down' } };
      if (/\b(new tariffs?|tariffs? (on|of|hike|increase|threat)|imposes? tariffs|trade war|export (ban|controls|curbs|restrictions)|chip (ban|curbs|restrictions)|retaliat\w+)\b/i.test(t))
        return { why: 'Trade conflict hurts growth and supply chains: stocks tend to fall and gold to rise.', gold: 'up', usd: 'flat', ndq: 'down', base: { gold: 4, ndq: 5 }, fxc: { AUD: 'down', CNY: 'down', JPY: 'up' } };
      return null;
    },
  },
  {
    name: 'politics',
    test: t => {
      if (!has(US_CTX_RE, t)) return null;
      if (/\b(government shutdown|shutdown (looms|begins|deadline)|debt ceiling|default on (its )?debt|credit (rating )?downgrade|downgrades? (the )?u\.?s\.?)\b/i.test(t))
        return { why: 'US fiscal stress usually weakens the dollar and stocks and lifts gold.', gold: 'up', usd: 'down', ndq: 'down', base: { gold: 5, usd: 4, ndq: 4 }, fxc: { USD: 'down', JPY: 'up', CHF: 'up' } };
      if (/\b(election results?|wins? (the )?(election|presidency|midterms?)|midterm results|presidential debate|polls? close|concedes)\b/i.test(t))
        return { why: 'US election outcomes can shift policy expectations for the dollar, gold and stocks.', gold: 'flat', usd: 'flat', ndq: 'flat', base: {}, impact: 'medium', fxc: { USD: 'watch' } };
      return null;
    },
  },
  {
    name: 'oil',
    test: t => {
      if (/\b(opec\+? (cuts?|curbs?)|strait of hormuz|attacks? on (oil|energy|tankers?|refiner\w*)|oil (field|facility|pipeline|tanker) (attack|struck|hit|fire)|oil supply (shock|disruption))\b/i.test(t))
        return { why: 'An oil supply shock feeds inflation fears: gold tends to rise and stocks to fall.', gold: 'up', usd: 'flat', ndq: 'down', base: { gold: 4, ndq: 4 }, fxc: { CAD: 'up', NOK: 'up', JPY: 'down' } };
      if (/\b(opec\+? (raises?|boosts?|hikes?|increases?) (output|production)|oil (glut|oversupply))\b/i.test(t))
        return { why: 'More oil supply eases inflation pressure, which tends to help stocks.', gold: 'flat', usd: 'flat', ndq: 'up', base: { ndq: 3 }, fxc: { CAD: 'down' } };
      return null;
    },
  },
  {
    name: 'banking',
    test: t => /\b(bank (run|collapse|failure|crisis|rescue|bailout)|banks? collaps\w+|banking (crisis|turmoil|stress)|credit crunch|liquidity crisis|contagion|financial crisis|systemic risk)\b/i.test(t)
      ? { why: 'Financial stress sends money to safety: gold usually rises and stocks fall.', gold: 'up', usd: 'flat', ndq: 'down', base: { gold: 6, ndq: 6 }, fxc: { JPY: 'up+', CHF: 'up+', AUD: 'down' } } : null,
  },
  {
    name: 'sanctions',
    test: t => /\b(sanctions? (on|against)|new sanctions|sanctions package|sanctioned)\b/i.test(t) && /\b(russia|iran|china|venezuela|north korea|oil)\b/i.test(t)
      ? { why: 'Major sanctions add geopolitical risk, which usually supports gold.', gold: 'up', usd: 'flat', ndq: 'flat', base: { gold: 4 } } : null,
  },
  {
    name: 'bigtech',
    test: t => {
      const names = t.match(BIG_TECH_RE);
      if (!names) return null;
      if (/\b(antitrust|break ?up|monopoly ruling|ordered to pay \$?\d+(\.\d+)? ?(billion|bn)|fined? \$?\d+(\.\d+)? ?(billion|bn)|probe|investigation)\b/i.test(t))
        return { why: 'Regulatory pressure on a tech giant can weigh on the Nasdaq.', gold: 'flat', usd: 'flat', ndq: 'down', base: { ndq: 4 } };
      if (/\b(\$\d+(\.\d+)? ?(billion|bn|trillion) (deal|investment|acquisition|order|contract)|acquires?|to buy|merger)\b/i.test(t))
        return { why: 'A major deal from a tech giant can lift sentiment in the Nasdaq.', gold: 'flat', usd: 'flat', ndq: 'up', base: { ndq: 3 } };
      return null;
    },
  },
];

const HIGH_DRIVERS = new Set(['war', 'fed', 'banking']);

// Turn currency effects into the main pairs: XXX/USD for EUR, GBP, AUD, NZD; USD/XXX for JPY, CHF, CAD, CNH
const BASE_FIRST = ['EUR', 'GBP', 'AUD', 'NZD'];
const ORDER = ['EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY', 'NOK'];
function pairsFor(fxc) {
  const usd = fxc.USD;
  const out = [];
  const val = d => (d === 'up+' ? 2 : d === 'up' ? 1 : d === 'down' ? -1 : 0);
  const named = ORDER.filter(c => fxc[c]);
  const list = named.length ? named : (usd ? ['EUR', 'JPY', 'GBP'] : []);
  for (const c of list) {
    const d = fxc[c];
    const pair = c === 'CNY' ? 'USD/CNH' : c === 'NOK' ? 'USD/NOK' : BASE_FIRST.includes(c) ? `${c}/USD` : `USD/${c}`;
    if (d === 'watch' || (!d && usd === 'watch') || (usd === 'watch' && !d)) { out.push({ pair, dir: 'watch' }); continue; }
    let v = val(d) - val(usd === 'watch' ? null : usd); // strength of c against USD
    if (!BASE_FIRST.includes(c)) v = -v;               // USD/XXX moves the other way
    if (v === 0) { if (d === 'watch' || usd === 'watch') out.push({ pair, dir: 'watch' }); continue; }
    out.push({ pair, dir: v > 0 ? 'up' : 'down' });
  }
  return out.slice(0, 4);
}

export function isPriceRecap(title) {
  return RECAP_RE.test(title) || TECH_RE.test(title);
}

// text: headline + summary. ctx: { policy } from the forex rules. Returns null when nothing market-moving is found.
export function marketCatalyst(title, text, ctx, tier, outlets) {
  if (isPriceRecap(title)) return null;
  const hits = [];
  for (const d of DRIVERS) { const r = d.test(title, ctx); if (r) hits.push({ name: d.name, ...r }); }
  if (!hits.length) return null;

  const bump = (tier === 'major' ? 1 : 0) + (outlets >= 3 ? 1 : 0);
  const cap = n => Math.max(1, Math.min(9, Math.round(n)));
  const assets = {};
  for (const key of ['gold', 'usd', 'ndq']) {
    let best = null;
    for (const h of hits) {
      const dir = h[key];
      if (!dir || dir === 'flat') continue;
      const conf = h.base[key] || 3;
      if (!best || conf > best.conf) best = { dir, conf };
      else if (best.dir !== dir) best.conf -= 2; // drivers disagree: less sure
    }
    assets[key] = best && best.conf > 0 ? { dir: best.dir, conf: cap(best.conf + bump) } : { dir: 'flat', conf: null };
  }
  const lead = hits.sort((a, b) => Math.max(...Object.values(b.base), 0) - Math.max(...Object.values(a.base), 0))[0];
  const maxConf = Math.max(0, ...Object.values(assets).map(a => a.conf || 0));
  let impact = lead.impact || (maxConf >= 7 || (HIGH_DRIVERS.has(lead.name) && maxConf >= 6) ? 'high' : maxConf >= 5 ? 'medium' : 'low');
  if (tier === 'major' && impact === 'low') impact = 'medium';
  // Currency effects and the pairs to watch
  const fxc = {};
  for (const h of hits) for (const [c, d] of Object.entries(h.fxc || {})) if (d && !fxc[c]) fxc[c] = d;
  if (assets.usd.dir !== 'flat' && (!fxc.USD || fxc.USD === 'watch')) fxc.USD = assets.usd.dir;
  const pairs = pairsFor(fxc);
  const fxConf = cap(Math.max(assets.usd.conf || 0, ...hits.map(h => h.conf || 0), 4) + 0);
  const currencies = Object.entries(fxc).map(([code, dir]) => ({ code, dir: dir === 'up+' ? 'up' : dir }));
  return { impact, assets, why: lead.why, driver: lead.name, drivers: hits.map(h => h.name) };
}
