// Rule-engine features for the model: reads [{title, text}] as JSON on stdin and prints, for each item,
// what the forex rules say: direction (-1, 0, 1) and confidence (0-9) per asset, the driver and the impact.
import { marketCatalyst } from '../markets.mjs';
import { policyOf } from '../rules.mjs';

const ASSETS = ['gold', 'usd', 'ndq', 'oil'];
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  const items = JSON.parse(raw || '[]');
  const out = items.map(({ title, text }) => {
    let fx = null;
    try { fx = marketCatalyst(title || '', text || title || '', { policy: policyOf(text || title || '') }, 'notable', 1); } catch {}
    const d = {}, c = {};
    for (const k of ASSETS) {
      const a = fx?.assets?.[k];
      d[k] = a?.dir === 'up' ? 1 : a?.dir === 'down' ? -1 : 0;
      c[k] = a?.conf || 0;
    }
    return { d, c, driver: fx?.driver || 'none', impact: fx?.impact || 'none' };
  });
  process.stdout.write(JSON.stringify(out));
});

