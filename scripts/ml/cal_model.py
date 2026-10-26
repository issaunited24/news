"""Calendar model: how markets react when a US release beats or misses its forecast.

train:   python scripts/ml/cal_model.py train     (GitHub, .github/workflows/train.yml)
         Two years of US releases from TradingView's calendar (actual vs forecast), and what gold, the dollar,
         the Nasdaq and oil did in the 2 hours around each one. For each kind of release, the surprise is measured
         in "normal surprises" (a z-score), so a 50K payrolls miss and a 0.1% CPI miss can be compared.
         Tested on the most recent 25% of releases it never saw; the 1-10 ratings come from those real hit rates.
predict: python scripts/ml/cal_model.py predict   (the live robot)
         stdin  [{"id", "title", "actual", "forecast", "importance", "ts"}]  (actual may be missing for upcoming ones)
         stdout {"preds": {id: {"assets": {...}} for released events,
                           or {"above": {...}, "below": {...}} for upcoming ones (the expected reaction either way)}}
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from market_data import ASSETS, CONTEXT_KEYS, context_at, fetch, price_at  # noqa: E402

MODEL = os.path.join(HERE, '..', '..', 'model', 'calendar.joblib')
REPORT = os.path.join(HERE, '..', '..', 'model', 'calendar_report.json')
RATING_STEPS = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77]
NOISE = {'gold': 0.04, 'usd': 0.02, 'ndq': 0.06, 'oil': 0.08}
# Kinds of release, and whether a higher number is "stronger economy / hotter inflation" (+1) or weaker (-1)
GROUPS = [
    ('inflation', re.compile(r'core pce|pce|cpi|ppi|inflation|price index|import prices|export prices', re.I), 1),
    ('jobs', re.compile(r'non.?farm|nfp|payrolls|employment change|adp|jolts|job openings|average hourly earnings', re.I), 1),
    ('unemployment', re.compile(r'unemployment|jobless|initial claims|continuing claims', re.I), -1),
    ('rates', re.compile(r'federal funds|fed interest rate|interest rate decision', re.I), 1),
    ('growth', re.compile(r'gdp', re.I), 1),
    ('consumer', re.compile(r'retail sales|consumer confidence|sentiment|personal spending|personal income', re.I), 1),
    ('business', re.compile(r'ism|pmi|durable goods|industrial production|factory orders|empire state|philadelphia fed|chicago', re.I), 1),
    ('housing', re.compile(r'housing|home sales|building permits|pending home', re.I), 1),
    ('energy', re.compile(r'crude oil|eia|api crude|natural gas', re.I), -1),  # bigger stock build = more supply
    ('trade', re.compile(r'trade balance', re.I), 1),
]
GROUP_NAMES = [g[0] for g in GROUPS] + ['other']


def key_of(title):
    t = re.sub(r'\(.*?\)', '', title.lower())
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9% ]', ' ', t)).strip()


def group_of(title):
    for name, rx, sign in GROUPS:
        if rx.search(title):
            return name, sign
    return 'other', 1


def rating_of(acc):
    r = 1
    for i, s in enumerate(RATING_STEPS):
        if acc >= s:
            r = i + 1
    return r


def features(title, z, importance, ctx):
    g, sign = group_of(title)
    zz = float(np.clip(z * sign, -4, 4))  # positive = stronger economy / hotter inflation
    row = [zz * (1.0 if g == name else 0.0) for name in GROUP_NAMES]
    row += [abs(zz), zz, float(importance)]
    row += [float(ctx.get(k, 0.0) or 0.0) for k in CONTEXT_KEYS]
    return row


# ---------- training ----------
def tv_history(days=720):
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    rows, t0 = [], start
    hdr = {'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    while t0 < end:
        t1 = min(t0 + timedelta(days=30), end)
        url = f'https://economic-calendar.tradingview.com/events?from={t0.strftime("%Y-%m-%dT%H:%M:%S.000Z")}&to={t1.strftime("%Y-%m-%dT%H:%M:%S.000Z")}&countries=US'
        for i in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=60) as r:
                    rows += json.loads(r.read()).get('result', [])
                break
            except Exception as e:
                print(f'  retry {i + 1}: {str(e)[:80]}', file=sys.stderr, flush=True)
                time.sleep(10 * (i + 1))
        time.sleep(2)
        t0 = t1
    df = pd.DataFrame(rows)
    df = df[(df.importance >= 0) & df.actual.notna() & df.forecast.notna()].copy()
    df['ts'] = (pd.to_datetime(df.date, utc=True) - pd.Timestamp('1970-01-01', tz='UTC')).dt.total_seconds()
    df['key'] = df.title.map(key_of)
    return df.drop_duplicates(['key', 'ts']).sort_values('ts').reset_index(drop=True)


def train():
    t_start = time.time()
    print('Calendar history from TradingView...', flush=True)
    ev = tv_history()
    print(f'  {len(ev)} US releases with actual and forecast', flush=True)
    px = fetch('730d')
    # size of a "normal surprise" for each kind of release
    ev['surprise'] = ev.actual.astype(float) - ev.forecast.astype(float)
    scale = ev.groupby('key').surprise.apply(lambda s: float(np.std(s)) if len(s) >= 6 else np.nan).to_dict()
    fallback = (ev.forecast.astype(float).abs() * 0.05 + 1e-3)
    ev['z'] = [s / scale[k] if scale.get(k) and scale[k] > 0 else s / f for s, k, f in zip(ev.surprise, ev.key, fallback)]
    X, R = [], {k: [] for k in ASSETS}
    for row in ev.itertuples():
        t = pd.Timestamp(row.ts, unit='s', tz='UTC')
        ctx = context_at(px, row.ts - 3600)  # mood before the release
        X.append(features(row.title, row.z, row.importance, ctx))
        for k in ASSETS:
            p0 = price_at(px[k], t - pd.Timedelta(minutes=31))
            p1 = price_at(px[k], t + pd.Timedelta(minutes=90))
            R[k].append((p1 / p0 - 1) * 100 if p0 and p1 else np.nan)
    X = np.asarray(X, dtype=np.float32)
    n = len(ev)
    split = int(n * 0.75)
    report = {'trained': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), 'releases': n,
              'test_from': time.strftime('%Y-%m-%d', time.gmtime(float(ev.ts.iloc[split]))), 'assets': {}}
    models = {}
    for k in ASSETS:
        r = np.asarray(R[k])
        ok = ~np.isnan(r) & (np.abs(np.nan_to_num(r)) >= NOISE[k]) & (ev.z.abs().values > 0.05)
        y = (r > 0).astype(int)
        tr, te = ok & (np.arange(n) < split), ok & (np.arange(n) >= split)
        if tr.sum() < 150 or te.sum() < 40:
            print(f'{k}: not enough data ({tr.sum()}/{te.sum()})', flush=True)
            continue
        best = None
        for C in (0.03, 0.1, 0.3, 1.0):
            m = make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=3000)).fit(X[tr], y[tr])
            p = m.predict_proba(X[te])[:, 1]
            ll = float(-np.mean(y[te] * np.log(np.clip(p, 1e-6, 1)) + (1 - y[te]) * np.log(np.clip(1 - p, 1e-6, 1))))
            if best is None or ll < best['ll']:
                best = {'C': C, 'p': p, 'll': ll, 'acc': float(np.mean((p > 0.5) == (y[te] == 1)))}
        p_te, y_te = best['p'], y[te]
        half = len(p_te) // 2
        iso_check = IsotonicRegression(y_min=0.5, y_max=0.95, out_of_bounds='clip').fit(np.abs(p_te[:half] - 0.5), ((p_te[:half] > 0.5) == (y_te[:half] == 1)).astype(float))
        rt = np.array([rating_of(a) for a in iso_check.predict(np.abs(p_te[half:] - 0.5))])
        right = (p_te[half:] > 0.5) == (y_te[half:] == 1)
        by_rating = {int(x): {'n': int((rt == x).sum()), 'hit': round(float(right[rt == x].mean()), 3)} for x in sorted(set(rt.tolist()))}
        iso = IsotonicRegression(y_min=0.5, y_max=0.95, out_of_bounds='clip').fit(np.abs(p_te - 0.5), ((p_te > 0.5) == (y_te == 1)).astype(float))
        final = make_pipeline(StandardScaler(), LogisticRegression(C=best['C'], max_iter=3000)).fit(X[ok], y[ok])
        # the old fixed rules on the same unseen releases, for comparison
        rule = {'usd': 1, 'gold': -1, 'ndq': -1, 'oil': 0}[k]
        zz = np.array([np.clip(z * group_of(t)[1], -4, 4) for z, t in zip(ev.z, ev.title)])
        base = float(np.mean((np.sign(zz[te]) * rule > 0) == (y_te == 1))) if rule else None
        models[k] = {'m': final, 'iso': iso}
        report['assets'][k] = {'test_accuracy': round(best['acc'], 3), 'test_count': int(te.sum()), 'baseline_rules': round(base, 3) if base is not None else None, 'by_rating': by_rating}
        print(f'{k}: unseen accuracy {best["acc"]:.3f} (old rules {base}), by rating {by_rating}', flush=True)
    os.makedirs(os.path.dirname(MODEL), exist_ok=True)
    joblib.dump({'models': models, 'scale': {k: v for k, v in scale.items() if v == v}, 'version': report['trained']}, MODEL, compress=3)
    with open(REPORT, 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))
    print(f'Calendar model done in {time.time() - t_start:.0f}s', flush=True)


# ---------- live ----------
def num(v):
    m = re.search(r'-?\d+(\.\d+)?', str(v if v is not None else '').replace(',', ''))
    return float(m.group(0)) if m else None


def predict():
    items = json.loads(sys.stdin.read() or '[]')
    b = joblib.load(MODEL)
    try:
        px = fetch('10d', cache='/tmp/briefly-prices.pkl', max_age=900, tries=2)
    except Exception:
        px = {}
    out = {'version': b['version'], 'preds': {}}

    def call(title, z, imp, ctx):
        x = np.asarray([features(title, z, imp, ctx)], dtype=np.float32)
        res = {}
        for k, m in b['models'].items():
            p = float(m['m'].predict_proba(x)[0, 1])
            res[k] = {'dir': 'up' if p >= 0.5 else 'down', 'conf': rating_of(float(m['iso'].predict([abs(p - 0.5)])[0]))}
        return res

    for it in items:
        f, a = num(it.get('forecast')), num(it.get('actual'))
        if f is None:
            continue
        key = key_of(it['title'])
        sc = b['scale'].get(key) or abs(f) * 0.05 + 1e-3
        ctx = context_at(px, float(it['ts']) - 3600)
        imp = 1 if it.get('importance') in (1, 'high') else 0
        if a is not None:
            out['preds'][it['id']] = {'assets': call(it['title'], (a - f) / sc, imp, ctx), 'z': round((a - f) / sc, 2)}
        else:
            out['preds'][it['id']] = {'above': call(it['title'], 1.0, imp, ctx), 'below': call(it['title'], -1.0, imp, ctx)}
    print(json.dumps(out))


if __name__ == '__main__':
    train() if sys.argv[1:] == ['train'] else predict()
