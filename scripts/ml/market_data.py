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


# ---------- daily prices, for the 1-day model (years of history) ----------
DAILY_KEYS = ([f'{p}_{k}' for k in ASSETS for p in ('d5', 'd20', 'dv20')] + ['vix_d', 'tnx_d', 'tnx_d5'])


def fetch_daily(range_='10y', tries=5):
    out = {}
    for k, sym in SERIES.items():
        try:
            r = json.loads(_get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={range_}&interval=1d', tries=tries))['chart']['result'][0]
        except Exception as e:
            print(f'  {k}: no daily prices ({str(e)[:60]})', flush=True, file=sys.stderr)
            out[k] = pd.Series(dtype=float)
            continue
        s = pd.Series(r['indicators']['quote'][0]['close'], index=pd.to_datetime(r['timestamp'], unit='s', utc=True)).dropna()
        out[k] = s[~s.index.duplicated()].sort_index()
    return out


def _daily_before(s, t):
    """Index of the last daily close strictly before the day of t (New York)."""
    return s.index.searchsorted(t.normalize(), side='left') - 1


def daily_context(pxd, ts):
    t = pd.Timestamp(ts, unit='s', tz='UTC')
    c = {k: 0.0 for k in DAILY_KEYS}
    for k in ASSETS:
        s = pxd.get(k)
        if s is None or len(s) < 25:
            continue
        i = _daily_before(s, t)
        if i < 21:
            continue
        v = s.values
        c[f'd5_{k}'] = (v[i] / v[i - 5] - 1) * 100
        c[f'd20_{k}'] = (v[i] / v[i - 20] - 1) * 100
        c[f'dv20_{k}'] = float(np.std(np.diff(np.log(v[i - 20:i + 1]))) * 100)
    for k in ('vix', 'tnx'):
        s = pxd.get(k)
        if s is None or len(s) < 10:
            continue
        i = _daily_before(s, t)
        if i < 5:
            continue
        c[f'{k}_d'] = float(s.values[i])
        if k == 'tnx':
            c['tnx_d5'] = float(s.values[i] - s.values[i - 5])
    return c


def daily_return(s, ts):
    """From the last close before the news day to the close of the next trading day after it (%)."""
    t = pd.Timestamp(ts, unit='s', tz='UTC')
    if s is None or len(s) < 3:
        return np.nan
    i = _daily_before(s, t)
    j = s.index.searchsorted(t.normalize() + pd.Timedelta(days=1), side='left')
    if i < 0 or j >= len(s) or (s.index[j] - t).days > 5:
        return np.nan
    return (s.values[j] / s.values[i] - 1) * 100


def daily_return_n(s, ts, n):
    """From the last close before the news day to the close n trading days after it (%): n=1 next day, 3, 5 = a week."""
    t = pd.Timestamp(ts, unit='s', tz='UTC')
    if s is None or len(s) < n + 3:
        return np.nan
    i = _daily_before(s, t)
    j = s.index.searchsorted(t.normalize() + pd.Timedelta(days=1), side='left') + (n - 1)
    if i < 0 or j >= len(s) or (s.index[j] - t).days > 5 + 2 * n:
        return np.nan
    return (s.values[j] / s.values[i] - 1) * 100


def date_only(ts, src):
    """Google News gives older articles a date, not a time (stamped midnight US Pacific, exactly on the hour)."""
    return src == 'gnews' and float(ts) % 3600 == 0


def daily_return_after(s, ts, n):
    """For a story whose time of day is unknown: from the close of its news day to the close n trading days later (%),
    so nothing that happened on the news day before it was published leaks into the outcome."""
    t = pd.Timestamp(ts, unit='s', tz='UTC')
    if s is None or len(s) < n + 3:
        return np.nan
    i = s.index.searchsorted(t.normalize() + pd.Timedelta(days=1), side='left') - 1  # the news day's close (or the last before it)
    j = i + n
    if i < 0 or j >= len(s) or (s.index[j] - t).days > 5 + 2 * n:
        return np.nan
    return (s.values[j] / s.values[i] - 1) * 100


# ---------- 5-minute archive (the "prices" branch, see archive_prices.py) ----------
def load_fine(folder='data/ml/prices5m'):
    out = {}
    if not os.path.isdir(folder):
        return out
    for k in SERIES:
        d = os.path.join(folder, k)
        if not os.path.isdir(d):
            continue
        vals = {}
        for f in sorted(os.listdir(d)):
            for line in open(os.path.join(d, f)):
                a, b = line.strip().split(',')
                vals[int(a)] = float(b)
        if vals:
            out[k] = pd.Series(vals).sort_index()
            out[k].index = pd.to_datetime(out[k].index, unit='s', utc=True)
    return out


def _fine_at(s, t, tol=600):
    i = s.index.searchsorted(t, side='right') - 1
    if i < 0 or (t - s.index[i]).total_seconds() > tol:
        return None
    return float(s.iloc[i])


def best_forward_return(fine, coarse, t, hours):
    """Move over the next `hours`, from 5-minute prices when the archive covers it, else from hourly prices."""
    if fine is not None and len(fine):
        p0, p1 = _fine_at(fine, t), _fine_at(fine, t + pd.Timedelta(hours=hours))
        if p0 and p1:
            return (p1 / p0 - 1) * 100
    return forward_return(coarse, t, hours)
