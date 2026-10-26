const token = process.env.TOKEN;
const res = await fetch('https://models.github.ai/inference/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-4.1-mini', messages: [{ role: 'user', content: 'Say hi' }], max_tokens: 10 }) });
console.log(res.status, JSON.stringify([...res.headers]), (await res.text()).slice(0, 200));
const c = await fetch('https://models.github.ai/catalog/models', { headers: { Authorization: `Bearer ${token}` } });
console.log('catalog', c.status, JSON.stringify([...c.headers]).slice(0, 400), (await c.text()).slice(0, 300));
console.log('env proxy:', process.env.HTTPS_PROXY || process.env.https_proxy || 'none');
