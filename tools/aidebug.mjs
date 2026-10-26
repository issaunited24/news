const API = 'https://models.github.ai/inference/chat/completions';
const token = process.env.TOKEN;
async function t(label, body) {
  const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await res.text();
  console.log(label, res.status, [...res.headers].filter(([k]) => /rate|retry|content-type/i.test(k)).map(x => x.join('=')).join(' '), '|', txt.slice(0, 300));
}
await t('small', { model: 'openai/gpt-4.1-mini', messages: [{ role: 'user', content: 'Reply with JSON {"a":1}' }], max_tokens: 20 });
await t('json-format', { model: 'openai/gpt-4.1-mini', messages: [{ role: 'system', content: 'Reply in JSON' }, { role: 'user', content: 'Give {"a":1}' }], max_tokens: 20, temperature: 0.2, response_format: { type: 'json_object' } });
await t('big', { model: 'openai/gpt-4.1-mini', messages: [{ role: 'user', content: 'x '.repeat(5000) + ' Reply OK' }], max_tokens: 1600 });
