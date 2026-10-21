// A tiny RSS/Atom reader with no dependencies. Good enough for news feeds.

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

export function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = m[3] ?? m[4];
  return out;
}

// All elements named `tag` inside `xml`: [{ attrs, text }]
export function all(xml, tag) {
  const out = [];
  const re = new RegExp(`<${esc(tag)}((?:\\s[^>]*?)?)(?:\\/>|>([\\s\\S]*?)<\\/${esc(tag)}\\s*>)`, 'g');
  for (const m of xml.matchAll(re)) out.push({ attrs: attrs(m[1] || ''), text: m[2] != null ? unCdata(m[2]).trim() : '' });
  return out;
}
export const first = (xml, tag) => all(xml, tag)[0] || null;
export const textOf = (xml, ...tags) => { for (const t of tags) { const e = first(xml, t); if (e && e.text) return e.text; } return ''; };

export function entries(xml) {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of body.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g)) out.push({ atom: m[1] === 'entry', xml: m[2] });
  return out;
}
