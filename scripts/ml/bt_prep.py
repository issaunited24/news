"""Backtest prep for the AI analyst (run by .github/workflows/backtest.yml).

Picks market headlines from 2025 onward (after the AI model's knowledge ends, so it can't know what happened next) and
rebuilds, for each one, the market picture of that moment: prices and their recent moves, yields, real yields,
inflation expectations, Fed funds futures, VIX, and how gold had been moving with the dollar, yields, Nasdaq and oil.
Also attaches what each market actually did next (next day, 3 days, 1 week) for scoring.

in:  data/ml/dataset/meta.pkl.gz (from the training data stage)
out: bt/tasks.json  [{id, ts, title, text, outlet, recent: [...], snapshot, regime, labels: {gold: {d1, d3, w1}, ...}}]
"""
import hashlib, io, json, os, sys, urllib.request

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from market_data import ASSETS, daily_return, daily_return_n, fetch_daily  # noqa: E402

START = pd.Timestamp('2025-01-01', tz='UTC').timestamp()
PER_DAY = 6
NAMES = {'gold': 'Gold (XAU/USD)', 'ndq': 'Nasdaq 100', 'usd': 'US Dollar Index (DXY)', 'oil': 'WTI crude oil'}
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'}


def get(url, timeout=60, tries=1):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            if i == tries - 1:
                raise
            print(f'  retry {i + 1}: {str(e)[:60]}', flush=True)


def yahoo(sym):
    j = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=5y&interval=1d'))
    r = j['chart']['result'][0]
    s = pd.Series(r['indicators']['quote'][0]['close'], index=pd.to_datetime(r['timestamp'], unit='s', utc=True).normalize())
    return s.dropna().groupby(level=0).last()


def fred(sid):
    # only the dates needed (much faster), more time and retries: FRED can be slow to answer
    df = pd.read_csv(io.StringIO(get(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2024-06-01', timeout=150, tries=4)))
    df.columns = ['d', 'v']
    df['v'] = pd.to_numeric(df.v, errors='coerce')
    s = pd.Series(df.v.values, index=pd.to_datetime(df.d, utc=True)).dropna()
    return s[s.index >= pd.Timestamp('2020-01-01', tz='UTC')]


def before(s, t):
    """Values up to the last day strictly before the news day."""
    if s is None or not isinstance(s.index, pd.DatetimeIndex) or not len(s):
        return pd.Series(dtype=float)
    return s[s.index < t.normalize()]


def f2(v):
    return 'n/a' if v is None or not np.isfinite(v) else f'{v:.2f}'


def sg(v):
    return 'n/a' if v is None or not np.isfinite(v) else f'{v:+.2f}'


def corr(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 8 or a[ok].std() == 0 or b[ok].std() == 0:
        return None
    return float(np.corrcoef(a[ok], b[ok])[0, 1])


def link(c):
    if c is None:
        return 'n/a'
    return 'strongly opposite' if c <= -0.4 else 'somewhat opposite' if c <= -0.15 else 'no clear link' if c < 0.15 else 'somewhat together' if c < 0.4 else 'strongly together'


def snapshot(t, px, mac):
    lines = []
    for k in ['gold', 'ndq', 'usd', 'oil']:
        s = before(px[k], t)
        if len(s) < 25:
            continue
        c = s.values
        ref = lambda n: c[-1 - n]  # noqa: E731
        yr = c[-252:]
        lines.append(f'{NAMES[k]}: {f2(c[-1])} (last close) | 1d {sg((c[-1] / ref(1) - 1) * 100)}% | 5d {sg((c[-1] / ref(5) - 1) * 100)}% | 20d {sg((c[-1] / ref(20) - 1) * 100)}% | 1y range {f2(yr.min())}-{f2(yr.max())}')
    def lvl(name, key, bp=True, inv=False):
        s = before(mac.get(key, pd.Series(dtype=float)), t)
        if len(s) < 22:
            return
        v = s.values
        cur, d5, d20 = (100 - v[-1], 100 - v[-6], 100 - v[-21]) if inv else (v[-1], v[-6], v[-21])
        ch = (lambda a, b: f'{sg((a - b) * 100)}bp') if bp else (lambda a, b: sg(a - b))
        lines.append(f'{name}: {f2(cur)}{"%" if bp else ""} (5d {ch(cur, d5)}, 20d {ch(cur, d20)})')
    lvl('US 10y yield', 'us10y')
    lvl('US 2y yield', 'us2y')
    lvl('US 10y real yield (TIPS)', 'real10y')
    lvl('5y breakeven inflation', 'be5y')
    lvl('Fed funds futures (front month) imply', 'fedfut', inv=True)
    lvl('VIX', 'vix', bp=False)
    return '\n'.join(lines)


def regime(t, px, mac):
    g = before(px['gold'], t).pct_change().dropna().iloc[-20:] * 100
    if len(g) < 10:
        return ''
    out = []
    for name, s, pct in [('the dollar index', px['usd'], True), ('the US 10y yield', mac.get('us10y'), False), ('the 10y real yield', mac.get('real10y'), False),
                         ('the Nasdaq', px['ndq'], True), ('oil', px['oil'], True)]:
        if s is None:
            out.append(f'gold vs {name}: n/a')
            continue
        o = before(s, t)
        o = (o.pct_change() * 100 if pct else o.diff()).reindex(g.index)
        c = corr(g.values, o.values)
        out.append(f'gold vs {name}: {"n/a" if c is None else f"{c:.2f}"} ({link(c)})')
    vol = float(np.sqrt(np.mean(g.values ** 2)))
    return ('HOW GOLD HAS BEEN MOVING (last 20 trading days, correlation of daily moves; textbook: opposite to the dollar and real yields)\n'
            + '; '.join(out) + f". Gold's typical daily move: {vol:.2f}%.")


def main():
    meta = pd.read_pickle('data/ml/dataset/meta.pkl.gz').sort_values('ts').reset_index(drop=True)
    print(f'{len(meta)} headlines in the dataset', flush=True)
    raw = fetch_daily('10y')  # as in training (for the outcomes)
    px = {}
    for k, v in raw.items():  # a by-day copy for the market picture
        c = v.copy()
        c.index = pd.to_datetime(c.index, utc=True).normalize()
        px[k] = c.groupby(level=0).last()
    mac = {}
    for key, fn in [('us10y', lambda: yahoo('%5ETNX')), ('us2y', lambda: yahoo('2YY%3DF')), ('vix', lambda: yahoo('%5EVIX')), ('fedfut', lambda: yahoo('ZQ%3DF')),
                    ('real10y', lambda: fred('DFII10')), ('be5y', lambda: fred('T5YIE'))]:
        try:
            mac[key] = fn()
            print(f'  {key}: {len(mac[key])} days', flush=True)
        except Exception as e:
            print(f'  {key} unavailable: {e}', flush=True)
    m = meta[(meta.ts >= START) & meta[[f'rD_{k}' for k in ASSETS]].notna().any(axis=1)].copy()
    m = m[m.title.str.len() >= 35]
    # a spread of days and topics: up to PER_DAY headlines per day, preferring ones with an article opening
    m['day'] = (m.ts // 86400).astype(int)
    m['has_text'] = m.text.fillna('').str.len() > 60
    rng = np.random.default_rng(7)
    m['r'] = rng.random(len(m))
    m = m.sort_values(['day', 'has_text', 'r'], ascending=[True, False, True]).groupby('day').head(PER_DAY)
    m = m.sample(frac=1, random_state=11)  # random order, so partial results are spread over the whole period
    print(f'{len(m)} test headlines from {m.day.nunique()} days', flush=True)
    titles, tss = meta.title.values, meta.ts.values.astype(float)
    tasks = []
    for _, r in m.iterrows():
        t = pd.Timestamp(float(r.ts), unit='s', tz='UTC')
        lo = np.searchsorted(tss, float(r.ts) - 12 * 3600)
        hi = np.searchsorted(tss, float(r.ts))
        recent = [titles[i] for i in range(max(lo, hi - 40), hi) if titles[i] != r.title][-8:]
        labels = {}
        for k in ASSETS:
            s = raw.get(k)
            labels[k] = {'d1': daily_return(s, float(r.ts)), 'd3': daily_return_n(s, float(r.ts), 3), 'w1': daily_return_n(s, float(r.ts), 5)}
            labels[k] = {h: (None if v is None or not np.isfinite(v) else round(float(v), 4)) for h, v in labels[k].items()}
        tasks.append({'id': hashlib.sha1(f'{r.title}|{r.ts}'.encode()).hexdigest()[:12], 'ts': float(r.ts), 'title': r.title,
                      'text': (r.text or '')[:2000] if isinstance(r.text, str) else '', 'outlet': r.domain if isinstance(r.domain, str) else '', 'recent': recent,
                      'snapshot': snapshot(t, px, mac), 'regime': regime(t, px, mac), 'labels': labels})
    os.makedirs('bt', exist_ok=True)
    json.dump(tasks, open('bt/tasks.json', 'w'), allow_nan=False)
    print(f'wrote {len(tasks)} tasks', flush=True)


if __name__ == '__main__':
    main()
