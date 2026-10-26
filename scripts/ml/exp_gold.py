"""EXPERIMENT ONLY (not used by the app): do US data surprises predict gold?

Run by .github/workflows/exp-gold.yml; results go to the "exp-gold" branch. Nothing here changes live predictions.

Honest-test rules, fixed before looking at any result:
- Exact release times from TradingView's calendar (no date-only timestamps, so no leakage of earlier moves).
- Surprise size per kind of release uses only EARLIER releases of that kind (expanding window, at least 6).
- One vote per release moment (CPI m/m, y/y and core released together count once: the biggest surprise decides).
- Entry price 31 minutes BEFORE the release; outcomes 90 minutes after, at the day's close (21:00 UTC) and 24 hours after.
- Three rules, fixed in advance (no tuning):
    S1  every surprise:              stronger economy / hotter inflation -> gold down, weaker -> gold up
    S2  big surprises only (|z|>=1):  same direction, no call otherwise
    S3  big inflation/jobs/Fed surprises only
- Benchmarks on the same moments: always up, momentum (gold's direction over the 24 hours before), coin flip.
- 95% ranges (Wilson) over release moments; the last 40% of the timeline is reported separately as the holdout.
"""
import json, math, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cal_model import group_of, key_of, tv_history  # noqa: E402
from market_data import fetch, price_at  # noqa: E402

CORE = {'inflation', 'jobs', 'unemployment', 'rates'}
NOISE = 0.04  # % move treated as no move (as in the calendar model)


def wilson(h, n, z=1.96):
    if n == 0:
        return None, None
    p = h / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    w = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return round(100 * (c - w), 1), round(100 * (c + w), 1)


def main():
    ev = tv_history(720)
    print(f'{len(ev)} US releases with actual and forecast', flush=True)
    px = fetch('730d')
    gold = px['gold']
    print(f'gold hourly bars: {len(gold)} from {gold.index[0]} to {gold.index[-1]}', flush=True)
    ev['surprise'] = ev.actual.astype(float) - ev.forecast.astype(float)
    # past-only scale per kind of release
    zs = []
    hist = {}
    for r in ev.itertuples():
        past = hist.get(r.key, [])
        sc = float(np.std(past)) if len(past) >= 6 else None
        zs.append(r.surprise / sc if sc and sc > 0 else np.nan)
        hist.setdefault(r.key, []).append(r.surprise)
    ev['z'] = zs
    ev = ev[ev.z.notna()].copy()
    ev['grp'] = [group_of(t)[0] for t in ev.title]
    ev['zs'] = [float(np.clip(z * group_of(t)[1], -4, 4)) for z, t in zip(ev.z, ev.title)]  # + = stronger economy / hotter
    ev['imp'] = ev.importance.fillna(0)
    rows = []
    for ts, g in ev.groupby('ts'):
        g = g.sort_values(['imp'], ascending=False)
        top = g.loc[g.zs.abs().idxmax()]
        t = pd.Timestamp(ts, unit='s', tz='UTC')
        p0 = price_at(gold, t - pd.Timedelta(minutes=31))
        pm = price_at(gold, t - pd.Timedelta(hours=24))
        out = {}
        for name, t1 in [('90m', t + pd.Timedelta(minutes=90)), ('close', t.normalize() + pd.Timedelta(hours=21)), ('24h', t + pd.Timedelta(hours=24))]:
            if t1 <= t:  # released after the close: the day's close is before it
                out[name] = None
                continue
            p1 = price_at(gold, t1)
            out[name] = (p1 / p0 - 1) * 100 if p0 and p1 and t1 <= gold.index[-1] else None
        rows.append({'ts': ts, 'title': top.title, 'grp': top.grp, 'z': top.zs, 'imp': top.imp,
                     'mom': (p0 / pm - 1) * 100 if p0 and pm else None, **out})
    m = pd.DataFrame(rows).sort_values('ts').reset_index(drop=True)
    split_ts = m.ts.iloc[int(len(m) * 0.6)]
    print(f'{len(m)} release moments; holdout from {pd.Timestamp(split_ts, unit="s", tz="UTC").date()}', flush=True)
    rules = {
        'S1 every surprise': lambda r: abs(r.z) > 0.05,
        'S2 big surprises (|z|>=1)': lambda r: abs(r.z) >= 1,
        'S3 big inflation/jobs/Fed': lambda r: abs(r.z) >= 1 and r.grp in CORE,
    }
    report = {'moments': len(m), 'holdout_from': str(pd.Timestamp(split_ts, unit='s', tz='UTC').date()), 'results': []}
    for hz in ['90m', 'close', '24h']:
        for part, sel in [('all', m), ('holdout', m[m.ts >= split_ts])]:
            for name, f in rules.items():
                s = sel[[f(r) for r in sel.itertuples()]]
                s = s[s[hz].notna() & (s[hz].abs() >= NOISE)]
                if not len(s):
                    continue
                y = s[hz] > 0
                call_up = s.z < 0  # weaker economy / cooler inflation -> gold up
                hit = int((call_up == y).sum())
                up = int(y.sum())
                mom = s.mom.notna()
                mom_hit = int(((s.mom[mom] > 0) == y[mom]).sum())
                res = {'horizon': hz, 'part': part, 'rule': name, 'n': len(s), 'rule_acc': round(100 * hit / len(s), 1), 'rule_ci': wilson(hit, len(s)),
                       'always_up': round(100 * up / len(s), 1), 'momentum': round(100 * mom_hit / max(1, mom.sum()), 1),
                       'beats_both': bool(hit / len(s) > max(up / len(s), 1 - up / len(s)) and hit / len(s) > mom_hit / max(1, mom.sum())),
                       'ci_above_50': bool((wilson(hit, len(s))[0] or 0) > 50)}
                report['results'].append(res)
                print(f"{hz:5} {part:7} {name:28} n={res['n']:4} rule {res['rule_acc']:5}% {res['rule_ci']} | always-up {res['always_up']}% | momentum {res['momentum']}% | beats both: {res['beats_both']} | range above 50: {res['ci_above_50']}", flush=True)
    os.makedirs('out', exist_ok=True)
    json.dump(report, open('out/exp_gold.json', 'w'), indent=1)
    m.to_csv('out/moments.csv', index=False)


if __name__ == '__main__':
    main()
