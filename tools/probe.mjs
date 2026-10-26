// One-off check (run by shots.yml): which "big money" data sources the robot can reach, and what they return
import { writeFile } from 'node:fs/promises';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
const urls = {
  gld_csv: 'https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv',
  cftc_disagg_gold: 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$where=cftc_contract_market_code=%27088691%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=2',
  cftc_disagg_oil: 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$where=cftc_contract_market_code=%27067651%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=1',
  cftc_tff_ndq: 'https://publicreporting.cftc.gov/resource/gpe5-46if.json?$where=cftc_contract_market_code=%27209742%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=1',
  cftc_tff_dxy: 'https://publicreporting.cftc.gov/resource/gpe5-46if.json?$where=cftc_contract_market_code=%27098662%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=1',
  myfxbook_outlook: 'https://www.myfxbook.com/community/outlook',
  myfxbook_xau: 'https://www.myfxbook.com/community/outlook/XAUUSD',
  ig_sentiment: 'https://www.ig.com/en/ig-client-sentiment',
  dukascopy_swfx: 'https://freeserv.dukascopy.com/2.0/?path=api/sentiment&key=',
  yahoo_gld: 'https://query1.finance.yahoo.com/v8/finance/chart/GLD?range=1mo&interval=1d',
  cme_gold_vol: 'https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/437/20251024/P?tradeDate=20251024',
};
const out = [];
for (const [k, u] of Object.entries(urls)) {
  try {
    const r = await fetch(u, { headers: UA, redirect: 'follow' });
    const t = await r.text();
    out.push(`== ${k}: HTTP ${r.status}, ${t.length} chars\n${t.slice(0, 900).replace(/\s+/g, ' ')}\n`);
  } catch (e) { out.push(`== ${k}: FAIL ${e.message}`); }
}
await writeFile('out/probe.txt', out.join('\n'));
console.log(out.join('\n').slice(0, 4000));
