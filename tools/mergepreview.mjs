// Duplicate-merge preview: runs today's grouping and the new meaning-based grouping on the robot's real headlines
// and lists every merge the new one adds, so each can be checked by hand. Also lists the "same event" links.
// usage: node tools/mergepreview.mjs state.json > merges.txt
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cluster, SAME_MIN } from '../scripts/rules.mjs';
const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const items = st.items.sort((a, b) => b.time - a.time);
let t0 = Date.now();
const run = () => spawnSync('python3', ['scripts/ml/similar.py'], { input: JSON.stringify({ titles: items.map(it => ({ t: it.title, ts: it.time / 1000 })), min: 0.62, hours: 24, k: 12, budget: 600 }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
let res = run();
console.log(`first run (reads every headline): ${Math.round((Date.now() - t0) / 1000)}s`, res.stderr.trim().split('\n').slice(-2).join(' | '));
t0 = Date.now(); res = run();
console.log(`second run (remembered): ${Math.round((Date.now() - t0) / 1000)}s`);
const pairs = JSON.parse(res.stdout).pairs;
const old = cluster(items), neu = cluster(items, pairs);
const oldOf = new Map(); old.forEach((g, k) => g.forEach(it => oldOf.set(it, k)));
const sim = new Map(pairs.map(([i, j, s]) => [`${Math.min(i, j)}:${Math.max(i, j)}`, s]));
const idx = new Map(items.map((it, i) => [it, i]));
console.log(`${items.length} headlines: ${old.length} stories before, ${neu.length} after (${old.length - neu.length} merged away)`);
const merges = neu.filter(g => new Set(g.map(it => oldOf.get(it))).size > 1);
console.log(`\n=== ${merges.length} NEW MERGES (threshold ${SAME_MIN}) ===`);
for (const g of merges.sort((a, b) => b.length - a.length)) {
  const parts = [...new Set(g.map(it => oldOf.get(it)))].map(k => old[k]);
  console.log(`\n-- ${g.length} headlines from ${parts.length} former stories`);
  for (const p of parts.slice(0, 6)) {
    const lead = p[0];
    let best = 0;
    for (const q of parts) if (q !== p) for (const a of p.slice(0, 20)) for (const b of q.slice(0, 20)) { const i = idx.get(a), j = idx.get(b); best = Math.max(best, sim.get(`${Math.min(i, j)}:${Math.max(i, j)}`) || 0); }
    console.log(`   [${best.toFixed(2)}] ${lead.title.slice(0, 110)} (${lead.outlet}, ${p.length})`);
  }
}
// near misses: just below the bar, to judge the threshold
const near = pairs.filter(([i, j, s]) => s >= SAME_MIN - 0.06 && s < SAME_MIN && oldOf.get(items[i]) !== oldOf.get(items[j])).slice(0, 40);
console.log(`\n=== NEAR MISSES (${(SAME_MIN - 0.06).toFixed(2)}-${SAME_MIN}), not merged ===`);
for (const [i, j, s] of near) console.log(`   [${s.toFixed(2)}] ${items[i].title.slice(0, 80)}  <>  ${items[j].title.slice(0, 80)}`);
