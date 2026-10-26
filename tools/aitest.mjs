import { readFileSync } from 'node:fs';
import { runAnalyst, getMacro, combine, priority } from '../scripts/analyst.mjs';
const F = process.argv[2]; // folder with live news4.json and charts.json
const news = JSON.parse(readFileSync(F + '/news4.json')), charts = JSON.parse(readFileSync(F + '/charts.json'));
const now = news.updated;
const stories = news.stories.filter(s => s.fx);
const pick = stories.sort((a, b) => priority(b, now) - priority(a, now)).slice(0, 2);
for (const s of pick) { s._d1 = Object.fromEntries(Object.entries(s.fx.assets || {}).map(([k, a]) => [k, { ...a, hit: 0.56 }])); s._rules = {}; }
const getText = async u => { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!r.ok) throw new Error(r.status); return r.text(); };
const macro = await getMacro(null, now, getText);
console.log('macro keys:', Object.keys(macro.items));
const state = {};
await runAnalyst({ stories: pick, ctx: { charts, markets: news.markets, macro, calendar: news.calendar, bigMoney: news.bigMoney, forecasts: [], recent: [] }, state, now, token: process.env.TOKEN, getPage: getText });
for (const a of Object.values(state.analyses || {})) {
  console.log(a.title, '|', a.model, '| full text:', a.full);
  console.log(JSON.stringify(a.res, null, 1).slice(0, 3500));
  console.log('COMBINED:', JSON.stringify(combine(a.res, pick[0]._d1, {})));
}
