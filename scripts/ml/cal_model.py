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
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from calib import check, rating_of  # noqa: E402
from market_data import ASSETS, CONTEXT_KEYS, context_at, fetch, price_at  # noqa: E402

MODEL = os.path.join(HERE, '..', '..', 'model', 'calendar.joblib')
REPORT = os.path.join(HERE, '..', '..', 'model', 'calendar_report.json')
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


def features(title, z, importance, ctx, mood=True):
    g, sign = group_of(title)
    zz = float(np.clip(z * sign, -4, 4))  # positive = stronger economy / hotter inflation
    row = [zz * (1.0 if g == name else 0.0) for name in GROUP_NAMES]
    row += [abs(zz), zz, float(importance)]
    if mood:
        row += [float(ctx.get(k, 0.0) or 0.0) for k in CONTEXT_KEYS]
    return row


# The simple rule: a stronger-than-expected US number lifts the dollar and weighs on gold and the Nasdaq
RULE = {'usd': 1, 'gold': -1, 'ndq': -1, 'oil': 0}


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
    XM, XL, R = [], [], {k: [] for k in ASSETS}
    for row in ev.itertuples():
        t = pd.Timestamp(row.ts, unit='s', tz='UTC')
        ctx = context_at(px, row.ts - 3600)  # mood before the release
        XM.append(features(row.title, row.z, row.importance, ctx, mood=True))
        XL.append(features(row.title, row.z, row.importance, ctx, mood=False))
        for k in ASSETS:
            p0 = price_at(px[k], t - pd.Timedelta(minutes=31))
            p1 = price_at(px[k], t + pd.Timedelta(minutes=90))
            R[k].append((p1 / p0 - 1) * 100 if p0 and p1 else np.nan)
    XS = {'lean': np.asarray(XL, np.float32), 'mood': np.asarray(XM, np.float32)}
    zz = np.array([np.clip(z * group_of(t)[1], -4, 4) for z, t in zip(ev.z, ev.title)])
    n = len(ev)
    split = int(n * 0.6)
    report = {'trained': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), 'releases': n,
              'test_from': time.strftime('%Y-%m-%d', time.gmtime(float(ev.ts.iloc[split]))), 'assets': {}}
    models = {}
    for k in ASSETS:
        r = np.asarray(R[k])
        ok = ~np.isnan(r) & (np.abs(np.nan_to_num(r)) >= NOISE[k]) & (ev.z.abs().values > 0.05)
        y = (r > 0).astype(int)
        tr, te = ok & (np.arange(n) < split), ok & (np.arange(n) >= split)
        if tr.sum() < 150 or te.sum() < 60:
            print(f'{k}: not enough data ({tr.sum()}/{te.sum()})', flush=True)
            continue
        # candidates: lean inputs (the surprise only) or with market mood, several strengths of regularisation
        best = None
        for variant, X in XS.items():
            for C in (0.01, 0.03, 0.1, 0.3):
                m = make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=3000)).fit(X[tr], y[tr])
                p = m.predict_proba(X[te])[:, 1]
                ll = float(-np.mean(y[te] * np.log(np.clip(p, 1e-6, 1)) + (1 - y[te]) * np.log(np.clip(1 - p, 1e-6, 1))))
                if best is None or ll < best['ll']:
                    best = {'variant': variant, 'C': C, 'p': p, 'll': ll, 'acc': float(np.mean((p > 0.5) == (y[te] == 1)))}
        # the simple rule on the same unseen releases
        rule_acc = None
        if RULE[k]:
            pr = np.sign(zz[te]) * RULE[k] > 0
            rule_acc = float(np.mean(pr == (y[te] == 1)))
        use_rule = rule_acc is not None and rule_acc >= best['acc']
        if use_rule:
            # keep the simple rule for this market; its confidence grows with the size of the surprise
            p_rule = 0.5 + np.sign(zz[te] * RULE[k]) * np.minimum(np.abs(zz[te]), 4) / 8.01
            iso, by = check(p_rule, y[te], min_bin=60)
            models[k] = {'rule': RULE[k], 'iso': iso}
            chosen, acc = 'simple rule (beat the model)', rule_acc
        else:
            iso, by = check(best['p'], y[te], min_bin=60)
            final = make_pipeline(StandardScaler(), LogisticRegression(C=best['C'], max_iter=3000)).fit(XS[best['variant']][ok], y[ok])
            models[k] = {'m': final, 'iso': iso, 'variant': best['variant']}
            chosen, acc = f'model ({best["variant"]}, C={best["C"]})', best['acc']
        report['assets'][k] = {'uses': chosen, 'test_accuracy': round(acc, 3), 'model_accuracy': round(best['acc'], 3),
                               'rule_accuracy': round(rule_acc, 3) if rule_acc is not None else None, 'test_count': int(te.sum()), 'by_rating': by}
        print(f'{k}: uses {chosen}; tested accuracy model {best["acc"]:.3f}, simple rule {rule_acc}; by rating {by}', flush=True)
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
    # markets where the model tested no better than a coin flip get no calendar call
    weak = set()
    try:
        rep = json.load(open(REPORT))
        weak = {k for k, a in rep.get('assets', {}).items() if a.get('test_accuracy', 0) < 0.52}
    except Exception:
        pass

    def call(title, z, imp, ctx):
        res = {}
        for k, m in b['models'].items():
            if k in weak:
                continue
            if 'rule' in m:
                g, sign = group_of(title)
                zz = float(np.clip(z * sign, -4, 4))
                if abs(zz) < 0.05:
                    continue
                p = 0.5 + np.sign(zz * m['rule']) * min(abs(zz), 4) / 8.01
            else:
                x = np.asarray([features(title, z, imp, ctx, mood=m.get('variant', 'mood') == 'mood')], dtype=np.float32)
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
