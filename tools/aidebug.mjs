const token = process.env.TOKEN;
async function t(label, url, body, extra = {}) {
  try {
    const res = await fetch(url, { method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'X-GitHub-Api-Version': '2022-11-28', ...extra }, body: JSON.stringify(body) });
    const txt = await res.text();
    console.log(label, res.status, res.headers.get('location') || '', res.headers.get('content-type'), '|', txt.slice(0, 300).replace(/\n/g, ' '));
  } catch (e) { console.log(label, 'ERR', e.message); }
}
const msg = [{ role: 'user', content: 'Reply with JSON {"a":1}' }];
await t('github.ai', 'https://models.github.ai/inference/chat/completions', { model: 'openai/gpt-4.1-mini', messages: msg, max_tokens: 20 });
await t('github.ai-org', `https://models.github.ai/orgs/issaunited24/inference/chat/completions`, { model: 'openai/gpt-4.1-mini', messages: msg, max_tokens: 20 });
await t('azure', 'https://models.inference.ai.azure.com/chat/completions', { model: 'gpt-4o-mini', messages: msg, max_tokens: 20 });
