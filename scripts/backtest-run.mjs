// AI backtest worker (run by .github/workflows/backtest.yml, ten at a time): runs the AI analyst on past headlines
// (bt/tasks.json from scripts/ml/bt_prep.py) and publishes its calls plus what markets actually did to its branch
// (bt-0 ... bt-9). The news robot reads those branches and grades the AI from them (scripts/collect.mjs).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { analysePrepared, AI_MODEL } from './analyst.mjs';

const SHARD = +(process.env.SHARD || 0), SHARDS = +(process.env.SHARDS || 1);
const END = Date.now() + (+(process.env.MINUTES || 330)) * 60e3;
const BRANCH = `bt-${SHARD}`;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function publish(obj) {
  mkdirSync('out', { recursive: true });
  writeFileSync('out/results.json', JSON.stringify(obj));
  const env = { ...process.env, GIT_INDEX_FILE: `${process.env.RUNNER_TEMP || '/tmp'}/bt-index` };
  const run = (...a) => execFileSync('git', a, { encoding: 'utf8', env }).trim();
  try { execFileSync('rm', ['-f', env.GIT_INDEX_FILE]); } catch {}
  run('update-index', '--add', '--cacheinfo', `100644,${run('hash-object', '-w', 'out/results.json')},results.json`);
  const commit = run('commit-tree', run('write-tree'), '-m', `AI backtest ${new Date().toISOString().slice(11, 16)}`);
  for (let i = 0; i < 3; i++) { try { execFileSync('git', ['push', '-q', '-f', 'origin', `${commit}:refs/heads/${BRANCH}`]); return; } catch {} }
}
const tasks = JSON.parse(readFileSync('bt/tasks.json', 'utf8')).filter((_, i) => i % SHARDS === SHARD);
let results = {};
try { git('fetch', '-q', '--depth=1', 'origin', BRANCH); results = JSON.parse(git('show', 'FETCH_HEAD:results.json')).results || {}; } catch {}
// only one version is graded: this AI model, these instructions, test set 4 (leak-free outcomes); older results are redone
for (const [id, r] of Object.entries(results)) if (r.model !== AI_MODEL || r.tv !== 4) delete results[id];
log(`backtest worker ${SHARD}/${SHARDS}: ${tasks.length} headlines, ${Object.keys(results).length} done earlier`);
let fails = 0;
for (const t of tasks) {
  if (Date.now() > END - 8 * 60e3) break;
  if (results[t.id]) continue;
  const t0 = Date.now();
  try {
    const res = await analysePrepared(t);
    results[t.id] = { model: AI_MODEL, tv: t.tv, dateOnly: t.date_only, ts: t.ts, title: t.title, labels: t.labels, status: res.status, credibility: res.credibility, importance: res.importance, priced_in: res.priced_in,
      markets: Object.fromEntries(Object.entries(res.markets).map(([k, m]) => [k, { bias: m.bias, conviction: m.conviction, check: m.check }])) };
    log(`${Math.round((Date.now() - t0) / 1000)}s ${t.title.slice(0, 60)} | gold ${res.markets.gold?.bias} ${res.markets.gold?.conviction} | next day ${t.labels.gold?.d1}`);
    publish({ updated: Date.now(), shard: SHARD, results });
    fails = 0;
  } catch (e) {
    log('failed:', String(e.message).slice(0, 120));
    if (++fails >= 5) break;
  }
}
log(`done: ${Object.keys(results).length} results`);
mkdirSync('out', { recursive: true });
writeFileSync('out/remaining.txt', String(tasks.filter(t => !results[t.id]).length));
