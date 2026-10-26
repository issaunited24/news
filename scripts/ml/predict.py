"""Live forecasts for the robot (called by scripts/collect.mjs every round, only for new Forex stories).

stdin:  {"stories": [{"id", "title", "text", "ts", "outlet"}],      the new stories to call
         "pool":    [{"title", "ts"}]}                              market headlines of the last 24 hours ("is it new?")
stdout: {"version", "preds": {id: {"assets": {asset: {"dir", "conf", "p"}},      the 4-hour calls (shown and scored)
                                  "h1": {...}, "d1": {...},                      1-hour and next-day calls
                                  "impact": "high"|"medium"|"low", "size": float}}}
Everything is built exactly like in training (features.py, novelty.py, sources.py, market_data.py, positioning.py).
"""
import hashlib, json, os, sys, time

import joblib
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import positioning  # noqa: E402
from features import assemble, embeddings, finbert_scores, rule_features, rules_block  # noqa: E402
from market_data import ASSETS, CONTEXT_KEYS, DAILY_KEYS, context_at, daily_context, fetch, fetch_daily  # noqa: E402
from novelty import novelty  # noqa: E402
from sources import source_features  # noqa: E402

MODEL = os.path.join(HERE, '..', '..', 'model', 'forecast.joblib')
CACHE = '/tmp/briefly-ml'


def cached(name, max_age, make):
    """Keeps slow lookups (prices, positioning) for a while between robot rounds."""
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < max_age:
        return pd.read_pickle(p)
    try:
        v = make()
        pd.to_pickle(v, p)
        return v
    except Exception as e:
        print(f'{name}: {e}', file=sys.stderr)
        return pd.read_pickle(p) if os.path.exists(p) else {}


def pool_embeddings(titles):
    """Meaning of the recent market headlines, remembered between rounds so each is only read once."""
    p = os.path.join(CACHE, 'pool_emb.pkl')
    mem = pd.read_pickle(p) if os.path.exists(p) else {}
    keys = [hashlib.sha1(t.encode('utf-8')).hexdigest()[:16] for t in titles]
    new = [(k, t) for k, t in zip(keys, titles) if k not in mem]
    if new:
        for (k, _), e in zip(new, embeddings([t for _, t in new])):
            mem[k] = e.astype(np.float16)
    keep = set(keys)
    mem = {k: v for k, v in mem.items() if k in keep}
    pd.to_pickle(mem, p)
    return np.asarray([mem[k] for k in keys], np.float32).reshape(len(keys), 384)


def rating_of(acc, steps):
    r = 1
    for i, s in enumerate(steps):
        if acc >= s:
            r = i + 1
    return r


def main():
    req = json.loads(sys.stdin.read() or '{}')
    items, pool = req.get('stories', []), req.get('pool', [])
    b = joblib.load(MODEL)
    out = {'version': b['version'], 'preds': {}}
    if not items:
        print(json.dumps(out))
        return
    n = len(items)
    titles = [it['title'] for it in items]
    texts = [(it.get('text') or '').strip() for it in items]
    ts = np.asarray([float(it.get('ts') or time.time()) for it in items])

    px = cached('hourly.pkl', 900, lambda: fetch('10d', tries=2))
    pxd = cached('daily.pkl', 6 * 3600, lambda: fetch_daily('3mo', tries=2))
    pos = cached('positioning.pkl', 12 * 3600, lambda: positioning.history(4))

    fb_t, em_t = finbert_scores(titles), embeddings(titles)
    has_x = np.asarray([[1.0 if len(t) > 60 else 0.0] for t in texts], np.float32)
    fx_in = [t if len(t) > 60 else '' for t in texts]
    fb_x, em_x = np.zeros((n, 3), np.float32), np.zeros((n, 384), np.float32)
    idx = [i for i, t in enumerate(fx_in) if t]
    if idx:
        fb_x[idx], em_x[idx] = finbert_scores([fx_in[i] for i in idx]), embeddings([fx_in[i] for i in idx])
    rules = rules_block(rule_features([{'title': t, 'text': x or t} for t, x in zip(titles, texts)]))
    pool = [p for p in pool if p.get('title')]
    p_emb = pool_embeddings([p['title'] for p in pool]) if pool else np.zeros((0, 384), np.float32)
    p_ts = np.asarray([float(p['ts']) for p in pool]) if pool else np.zeros(0)
    nov = novelty(em_t, ts, p_emb, p_ts)
    src = np.asarray([source_features(it.get('outlet', '')) for it in items], np.float32)
    mood = np.asarray([[context_at(px, t).get(k, 0.0) for k in CONTEXT_KEYS] for t in ts], np.float32)
    dmood = np.asarray([[daily_context(pxd, t).get(k, 0.0) for k in DAILY_KEYS] for t in ts], np.float32)
    posf = np.asarray([[positioning.at(pos, t).get(k, 0.5) for k in positioning.KEYS] for t in ts], np.float32)
    parts = {'fb_t': fb_t, 'em_t': em_t, 'rules': rules, 'nov': nov, 'src': src, 'has_x': has_x, 'fb_x': fb_x, 'em_x': em_x,
             'mood': mood, 'dmood': dmood, 'pos': posf}

    steps = b['rating_steps']
    calls = {}
    for h, spec in b['horizons'].items():
        X, _ = assemble(parts, spec['groups'])
        calls[h] = {}
        for k, m in spec['models'].items():
            p = m['m'].predict_proba(X)[:, 1]
            acc = m['iso'].predict(np.abs(p - 0.5))
            calls[h][k] = (p, acc)
    imp = b['importance']
    X, _ = assemble(parts, imp['groups'])
    size = np.max(np.vstack([np.expm1(m.predict(X)) for m in imp['models'].values()]), axis=0)

    def pack(h, i):
        return {k: {'dir': 'up' if p[i] >= 0.5 else 'down', 'conf': rating_of(float(a[i]), steps), 'p': round(float(p[i]), 3)}
                for k, (p, a) in calls.get(h, {}).items()}

    for i, it in enumerate(items):
        out['preds'][it['id']] = {
            'assets': pack('4h', i), 'h1': pack('1h', i), 'd1': pack('1d', i),
            'impact': 'high' if size[i] >= imp['high'] else 'medium' if size[i] >= imp['medium'] else 'low',
            'size': round(float(size[i]), 2), 'fresh': bool(nov[i, 0] > 0.5),
        }
    print(json.dumps(out))


if __name__ == '__main__':
    main()
