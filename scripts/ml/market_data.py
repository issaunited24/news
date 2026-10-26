"""Hourly prices and "market mood" for the forecast models. Shared by training and the live robot,
so the model always sees the exact same inputs in both places.

Mood at the moment of a story:
- the trend of each market going in (last 6 and 24 hours) and how jumpy it has been (24-hour volatility)
- the VIX fear index (level and 24-hour change)
- the US 10-year Treasury yield (level and 24-hour change)
- which trading session is open (Asia, London, London + New York overlap, New York, late)
"""
import json, os, sys, time, urllib.parse, urllib.request

import numpy as np
import pandas as pd

ASSETS = ['gold', 'usd', 'ndq', 'oil']
SERIES = {'gold': 'GC=F', 'usd': 'DX-Y.NYB', 'ndq': 'NQ=F', 'oil': 'CL=F', 'vix': '^VIX', 'tnx': '^TNX'}
UA = {'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)'}
SESSIONS = ['s_asia', 's_london', 's_overlap', 's_ny', 's_late']
CONTEXT_KEYS = ([f'{p}_{k}' for k in ASSETS for p in ('m6', 'm24', 'v24')]
                + ['vix', 'vix_chg24', 'tnx', 'tnx_chg24'] + SESSIONS)


def _get(url, tries=5, pause=10):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            print(f'  retry {i + 1}: {str(e)[:80]}', flush=True, file=sys.stderr)
            time.sleep(pause * (2 ** i))
    raise RuntimeError(f'could not fetch {url}')


def fetch(range_='730d', cache=None, max_age=900, tries=5):
    """Hourly closes for the 4 markets plus VIX and the 10-year yield, from Yahoo Finance."""
    if cache and os.path.exists(cache) and time.time() - os.path.getmtime(cache) < max_age:
        return pd.read_pickle(cache)
    out = {}
    for k, sym in SERIES.items():
        try:
            r = json.loads(_get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={range_}&interval=60m', tries=tries))['chart']['result'][0]
        except Exception as e:
            print(f'  {k}: no prices ({str(e)[:60]})', flush=True, file=sys.stderr)
            out[k] = pd.Series(dtype=float)
            continue
        s = pd.Series(r['indicators']['quote'][0]['close'], index=pd.to_datetime(r['timestamp'], unit='s', utc=True)).dropna()
        out[k] = s[~s.index.duplicated()].sort_index()
    if cache:
        pd.to_pickle(out, cache)
    return out


def price_at(s, t):
    """Close of the latest hourly bar that started at or before t, if it's no more than 2 hours old."""
    i = s.index.searchsorted(t, side='right') - 1
    if i < 0 or (t - s.index[i]).total_seconds() > 2 * 3600:
        return None
    return float(s.iloc[i])


def forward_return(s, t, hours):
    p0, p1 = price_at(s, t), price_at(s, t + pd.Timedelta(hours=hours))
    return (p1 / p0 - 1) * 100 if p0 and p1 else np.nan


def _session(t):
    h = t.hour + t.minute / 60
    if h < 7:
        return 's_asia'
    if h < 12:
        return 's_london'
    if h < 16:
        return 's_overlap'
    if h < 21:
        return 's_ny'
    return 's_late'


def context_at(px, ts):
    """Market mood at unix time ts, as a dict over CONTEXT_KEYS (missing values are 0)."""
    t = pd.Timestamp(ts, unit='s', tz='UTC')
    c = {k: 0.0 for k in CONTEXT_KEYS}
    for k in ASSETS:
        s = px.get(k)
        if s is None or s.empty:
            continue
        p0, p6, p24 = price_at(s, t), price_at(s, t - pd.Timedelta(hours=6)), price_at(s, t - pd.Timedelta(hours=24))
        if p0 and p6:
            c[f'm6_{k}'] = (p0 / p6 - 1) * 100
        if p0 and p24:
            c[f'm24_{k}'] = (p0 / p24 - 1) * 100
        i = s.index.searchsorted(t, side='right')
        win = s.iloc[max(0, i - 25):i]
        if len(win) >= 6:
            c[f'v24_{k}'] = float(np.std(np.diff(np.log(win.values))) * 100)
    for k in ('vix', 'tnx'):
        s = px.get(k)
        if s is None or s.empty:
            continue
        p0, p24 = price_at(s, t), price_at(s, t - pd.Timedelta(hours=24))
        if p0:
            c[k] = p0
            if p24:
                c[f'{k}_chg24'] = (p0 / p24 - 1) * 100 if k == 'vix' else p0 - p24
    c[_session(t)] = 1.0
    return c
