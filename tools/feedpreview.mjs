// Feed preview: runs the app's old and new ordering on real news and prints the top of each tab side by side.
// usage: node tools/feedpreview.mjs news.json older.json old-index.html new-index.html [n]
import { readFileSync } from 'node:fs';
const [newsF, olderF, oldHtml, newHtml, nArg] = process.argv.slice(2);
const n = +(nArg || 10);
const news = JSON.parse(readFileSync(newsF, 'utf8')), older = olderF ? JSON.parse(readFileSync(olderF, 'utf8')) : { stories: [] };
const stories = [...news.stories, ...older.stories.filter(s => !news.stories.some(x => x.id === s.id))];
function load(html) {
  const src = readFileSync(html, 'utf8');
  const a = src.indexOf('function visible(s)'), b = src.indexOf('function searchResults(q)');
  const code = src.slice(a, b);
  const f = new Function('data', 'prefs', 'readSet', 'Date', `${code}; return storiesFor;`);
  return f({ stories }, { hidden: [], muted: [], boosted: [] }, new Set(), { now: () => news.updated });
}
const before = load(oldHtml), after = load(newHtml);
const age = s => `${((news.updated - Math.min(s.published, s.firstSeen)) / 3600e3).toFixed(1)}h`;
const line = s => s ? `${(s._missed ? '[EARLIER] ' : s.breaking ? '[LIVE] ' : '')}${s.title.slice(0, 70)} (${s.outlet}, ${age(s)}, +${(s.sources || []).length} outlets)` : '';
for (const tab of ['top', 'world', 'us', 'forex', 'tech', 'sports', 'ent', 'sci']) {
  const b = before(tab, true), a = after(tab, true);
  console.log(`\n=== ${tab.toUpperCase()} (${a.length} stories) ===`);
  console.log('BEFORE:'); b.slice(0, n).forEach((s, i) => console.log(` ${i + 1}. ${line(s)}`));
  console.log('AFTER:'); a.slice(0, n).forEach((s, i) => console.log(` ${i + 1}. ${line(s)}`));
}
