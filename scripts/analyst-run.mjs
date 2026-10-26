// AI worker (run by .github/workflows/analyst.yml, three at a time): keeps reading the newest important market stories
// from the live news, analyses them with the local AI model (scripts/analyst.mjs) and publishes the results to its own
// branch (ai-0, ai-1, ai-2). The news robot (scripts/collect.mjs) reads those branches every round and blends each
// analysis into that story's calls. Each worker takes a fixed share of the stories, so no story is analysed twice.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { analyseOne, getMacro, pickStories, priority } from './analyst.mjs';

const SHARD = +(process.env.SHARD || 0), SHARDS = +(process.env.SHARDS || 1);
const END = Date.now() + (+(process.env.MINUTES || 110)) * 60e3;
const BRANCH = `ai-${SHARD}`, FILE = 'data/analyses.json';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getText(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}
function readLive() {
  git('fetch', '-q', '--depth=1', 'origin', 'live');
  const show = f => { try { return JSON.parse(git('show', `FETCH_HEAD:${f}`)); } catch { return null; } };
  return { news: show('news.json'), state: show('state.json'), charts: show('charts.json') };
}
function publish(obj) {
  mkdirSync('data', { recursive: true });
  writeFileSync(FILE, JSON.stringify(obj));
  const env = { ...process.env, GIT_INDEX_FILE: `${process.env.RUNNER_TEMP || '/tmp'}/ai-index` };
  const run = (...a) => execFileSync('git', a, { encoding: 'utf8', env }).trim();
  try { execFileSync('rm', ['-f', env.GIT_INDEX_FILE]); } catch {}
  run('update-index', '--add', '--cacheinfo', `100644,${run('hash-object', '-w', FILE)},analyses.json`);
  const commit = run('commit-tree', run('write-tree'), '-m', `AI analyses ${new Date().toISOString().slice(11, 16)}`);
  for (let i = 0; i < 3; i++) { try { execFileSync('git', ['push', '-q', '-f', 'origin', `${commit}:refs/heads/${BRANCH}`]); return; } catch {} }
  log('could not publish this time');
}

// pick up where the last run of this worker stopped
let analyses = {};
try { git('fetch', '-q', '--depth=1', 'origin', BRANCH); analyses = JSON.parse(git('show', 'FETCH_HEAD:analyses.json')).analyses || {}; } catch {}
log(`worker ${SHARD}/${SHARDS}: ${Object.keys(analyses).length} earlier analyses`);
let macro = null;
const failed = new Map();
while (Date.now() < END - 4 * 60e3) {
  const now = Date.now();
  let live;
  try { live = readLive(); } catch (e) { log('live news unavailable', e.message); await sleep(60e3); continue; }
  if (!live.news?.stories) { await sleep(60e3); continue; }
  for (const [id, a] of Object.entries(analyses)) if (now - a.at > 48 * 3600e3) delete analyses[id];
  const preds = live.state?.preds || {};
  const stories = live.news.stories.filter(s => s.fx).map(s => ({ ...s, _d1: preds[s.id]?.d1 }));
  const todo = pickStories(stories, analyses, now, SHARD, SHARDS).filter(s => (failed.get(s.id) || 0) < 2);
  if (!todo.length) { await sleep(45e3); continue; }
  const st = todo[0];
  try { macro = await getMacro(macro, now, getText); } catch {}
  const recent = stories.filter(s => s.fx.driver !== 'wrap' && now - Math.min(s.published, s.firstSeen) < 12 * 3600e3)
    .sort((a, b) => priority(b, now) - priority(a, now)).slice(0, 10).map(s => ({ id: s.id, title: s.title, t: Math.min(s.published, s.firstSeen) }));
  const ctx = { charts: live.charts, markets: live.news.markets, macro, calendar: live.news.calendar, bigMoney: live.news.bigMoney, forecasts: live.state?.forecasts || [], recent };
  const t0 = Date.now();
  try {
    const prev = analyses[st.id];
    const a = await analyseOne(st, ctx, now, getText);
    analyses[st.id] = { ...a, redo: !!prev };
    log(`analysed in ${Math.round((Date.now() - t0) / 1000)}s: ${st.title.slice(0, 70)} | gold ${a.res.markets.gold?.bias} ${a.res.markets.gold?.conviction} | ${a.res.status}`);
    publish({ updated: Date.now(), shard: SHARD, analyses });
  } catch (e) {
    failed.set(st.id, (failed.get(st.id) || 0) + 1);
    log(`failed after ${Math.round((Date.now() - t0) / 1000)}s on "${st.title.slice(0, 60)}": ${String(e.message).slice(0, 160)}`);
  }
}
log('done');
