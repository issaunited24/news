"""Big money positioning: how hedge funds are betting on each market (CFTC Commitments of Traders, free, weekly).

Gold and oil: "managed money" (hedge funds, CTAs) from the disaggregated report.
Nasdaq and the dollar index: "leveraged funds" (hedge funds) from the traders-in-financial-futures report.
Positions are as of Tuesday and published Friday afternoon, so each report only counts from then (no peeking).

For each market and week:
- long_pct: share of hedge funds' positions that are long
- pctile:   where their net position sits within the past 3 years (1 = most bullish in 3 years, 0 = most bearish)
- chg:      how much the net position changed on the week, relative to open interest
"""
import json, sys, time, urllib.parse, urllib.request

import numpy as np
import pandas as pd

UA = {'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)'}
MARKETS = {
    'gold': ('72hh-3qpy', '088691', 'm_money_positions_long_all', 'm_money_positions_short_all'),
    'oil': ('72hh-3qpy', '067651', 'm_money_positions_long_all', 'm_money_positions_short_all'),
    'ndq': ('gpe5-46if', '209742', 'lev_money_positions_long', 'lev_money_positions_short'),
    'usd': ('gpe5-46if', '098662', 'lev_money_positions_long', 'lev_money_positions_short'),
}
KEYS = [f'{p}_{k}' for k in ['gold', 'usd', 'ndq', 'oil'] for p in ('pos_long', 'pos_pct', 'pos_chg')]


def _get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f'  retry {i + 1}: {str(e)[:80]}', file=sys.stderr, flush=True)
            time.sleep(10 * (i + 1))
    raise RuntimeError('CFTC unavailable')


def history(years=10):
    """Weekly positioning per market: DataFrame indexed by when it became public."""
    out = {}
    since = (pd.Timestamp.utcnow() - pd.Timedelta(days=365 * years)).strftime('%Y-%m-%dT00:00:00')
    for k, (ds, code, lcol, scol) in MARKETS.items():
        q = {'$where': f"cftc_contract_market_code='{code}' AND report_date_as_yyyy_mm_dd >= '{since}'",
             '$order': 'report_date_as_yyyy_mm_dd ASC', '$limit': '5000',
             '$select': f'report_date_as_yyyy_mm_dd,open_interest_all,{lcol},{scol}'}
        rows = _get(f'https://publicreporting.cftc.gov/resource/{ds}.json?' + urllib.parse.urlencode(q))
        df = pd.DataFrame(rows)
        if df.empty:
            continue
        d = pd.to_datetime(df.report_date_as_yyyy_mm_dd, utc=True)
        lo, sh, oi = df[lcol].astype(float), df[scol].astype(float), df.open_interest_all.astype(float)
        net = lo - sh
        f = pd.DataFrame({'date': d, 'long': lo, 'short': sh, 'net': net, 'oi': oi})
        f['long_pct'] = lo / (lo + sh).replace(0, np.nan)
        f['pctile'] = net.rolling(156, min_periods=52).apply(lambda w: (w[:-1] < w[-1]).mean() if len(w) > 1 else np.nan, raw=True)
        f['chg'] = net.diff() / oi.replace(0, np.nan) * 100
        f['public'] = d + pd.Timedelta(days=3, hours=20, minutes=30)  # Friday 3:30 PM New York
        out[k] = f.set_index('public').sort_index()
    return out


def at(hist, ts):
    """Positioning features known at unix time ts (latest published report)."""
    t = pd.Timestamp(ts, unit='s', tz='UTC')
    c = {k: (0.0 if k.startswith('pos_chg') else 0.5) for k in KEYS}  # neutral when unknown
    for k, f in hist.items():
        i = f.index.searchsorted(t, side='right') - 1
        if i < 0:
            continue
        r = f.iloc[i]
        c[f'pos_long_{k}'] = float(r.long_pct) if r.long_pct == r.long_pct else 0.5
        c[f'pos_pct_{k}'] = float(r.pctile) if r.pctile == r.pctile else 0.5
        c[f'pos_chg_{k}'] = float(r.chg) if r.chg == r.chg else 0.0
    return c


def latest(hist):
    """For the app's Big Money bar."""
    out = {}
    for k, f in hist.items():
        r = f.iloc[-1]
        out[k] = {'date': r.date.strftime('%Y-%m-%d'), 'long_pct': round(float(r.long_pct), 3), 'pctile': round(float(r.pctile), 3) if r.pctile == r.pctile else None,
                  'chg': round(float(r.chg), 2) if r.chg == r.chg else None, 'net': int(r.net), 'oi': int(r.oi)}
    return out
