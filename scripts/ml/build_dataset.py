"""Builds the training set for the forecast model (runs on GitHub, see .github/workflows/train.yml).

1. Market headlines from the past year, from GDELT's free news archive (no key), searched topic by topic.
2. Hourly prices for gold, the US dollar index, Nasdaq 100 futures and WTI crude from Yahoo Finance.
3. For each headline: what each asset did over the 4 hours after it was published (the label),
   and how it moved over the 6 and 24 hours before (the trend going into the news).
4. The app's own checked calls from the live robot are added too, so the model keeps learning from real results.

Output: data/ml/dataset.pkl.gz
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

OUT = 'data/ml/dataset.pkl.gz'
DAYS = int(os.environ.get('ML_DAYS', '365'))
WINDOW_DAYS = int(os.environ.get('ML_WINDOW_DAYS', '10'))
QUICK = os.environ.get('ML_QUICK') == '1'  # small run for testing the pipeline
UA = {'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)'}

YAHOO = {'gold': 'GC=F', 'usd': 'DX-Y.NYB', 'ndq': 'NQ=F', 'oil': 'CL=F'}
HORIZON_H = 4

# Topics that move gold, the dollar, the Nasdaq and oil (GDELT search syntax)
QUERIES = [
    '("federal reserve" OR fomc OR powell OR "fed chair")',
    '(inflation OR "consumer prices" OR cpi OR pce)',
    '("jobs report" OR payrolls OR "jobless claims" OR unemployment rate)',
    '("treasury yields" OR "bond yields" OR "10-year yield")',
    '("gold price" OR "gold prices" OR bullion)',
    '("dollar index" OR "u.s. dollar" OR greenback OR "currency markets")',
    '("oil prices" OR opec OR "crude oil" OR brent)',
    '(nasdaq OR "tech stocks" OR "wall street" OR "stock market")',
    '(tariffs OR "trade war" OR "trade deal")',
    '(missile OR airstrike OR invasion OR "military strikes")',
    '(ceasefire OR "peace talks" OR "peace deal")',
    '(ecb OR "bank of japan" OR "bank of england" OR "european central bank")',
    '(china economy OR "china stimulus" OR "chinese economy")',
    '(earnings nvidia OR apple OR microsoft OR alphabet OR amazon OR meta)',
    '("ai spending" OR "ai stocks" OR "ai bubble" OR capex)',
    '(sanctions OR embargo)',
    '(recession OR "bank collapse" OR "debt ceiling" OR "government shutdown")',
    '(iran OR israel OR ukraine OR russia) (oil OR gold OR markets)',
]
if QUICK:
    QUERIES = QUERIES[:3]


def get(url, tries=5, pause=20):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            print(f'  retry {i + 1}: {str(e)[:80]}', flush=True)
            time.sleep(pause * (2 ** i))  # 20s, 40s, 80s, 160s: GDELT asks callers to slow down
    return None


def gdelt_headlines():
    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=HORIZON_H + 1)
    start = end - timedelta(days=DAYS if not QUICK else 21)
    rows, n = [], 0
    for q in QUERIES:
        t0 = start
        while t0 < end:
            t1 = min(t0 + timedelta(days=WINDOW_DAYS), end)
            params = {
                'query': f'{q} sourcelang:english', 'mode': 'artlist', 'maxrecords': '250', 'format': 'json',
                'startdatetime': t0.strftime('%Y%m%d%H%M%S'), 'enddatetime': t1.strftime('%Y%m%d%H%M%S'), 'sort': 'hybridrel',
            }
            txt = get('https://api.gdeltproject.org/api/v2/doc/doc?' + urllib.parse.urlencode(params))
            time.sleep(8)  # GDELT asks for at most one request every 5 seconds; stay well under it
            n += 1
            if txt:
                try:
                    arts = json.loads(txt).get('articles', [])
                except Exception:
                    arts = []
                for a in arts:
                    title = (a.get('title') or '').strip()
                    if len(title) < 25:
                        continue
                    try:
                        ts = datetime.strptime(a['seendate'], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                    except Exception:
                        continue
                    rows.append({'title': title, 'text': '', 'ts': ts.timestamp(), 'domain': a.get('domain', ''), 'src': 'gdelt'})
            if n % 25 == 0:
                print(f'  {n} searches, {len(rows)} headlines', flush=True)
            t0 = t1
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    # one row per headline (the earliest time it was seen)
    df['key'] = df.title.str.lower().str.replace(r'[^a-z0-9 ]', '', regex=True).str.slice(0, 90)
    df = df.sort_values('ts').drop_duplicates('key').drop(columns='key')
    return df


def prices():
    out = {}
    for k, sym in YAHOO.items():
        txt = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=730d&interval=60m')
        r = json.loads(txt)['chart']['result'][0]
        s = pd.Series(r['indicators']['quote'][0]['close'], index=pd.to_datetime(r['timestamp'], unit='s', utc=True)).dropna()
        s = s[~s.index.duplicated()].sort_index()
        out[k] = s
        print(f'  {k}: {len(s)} hourly bars from {s.index[0].date()}', flush=True)
    return out


def price_at(s, t):
    """Close of the latest bar that started at or before t, if it's no more than 2 hours old."""
    i = s.index.searchsorted(t, side='right') - 1
    if i < 0:
        return None
    if (t - s.index[i]).total_seconds() > 2 * 3600:
        return None
    return float(s.iloc[i])


def label(df, px):
    for k, s in px.items():
        fwd, b6, b24 = [], [], []
        for ts in df.ts:
            t = pd.Timestamp(ts, unit='s', tz='UTC')
            p0 = price_at(s, t)
            p1 = price_at(s, t + pd.Timedelta(hours=HORIZON_H))
            pm6 = price_at(s, t - pd.Timedelta(hours=6))
            pm24 = price_at(s, t - pd.Timedelta(hours=24))
            fwd.append((p1 / p0 - 1) * 100 if p0 and p1 else np.nan)
            b6.append((p0 / pm6 - 1) * 100 if p0 and pm6 else 0.0)
            b24.append((p0 / pm24 - 1) * 100 if p0 and pm24 else 0.0)
        df[f'r_{k}'] = fwd
        df[f'm6_{k}'] = b6
        df[f'm24_{k}'] = b24
    return df


def live_results():
    """The app's own stories and their checked results, from the live robot's saved state."""
    try:
        txt = get('https://raw.githubusercontent.com/issaunited24/news/live/state.json', tries=2)
        st = json.loads(txt)
    except Exception:
        return pd.DataFrame()
    rows = {}
    for f in st.get('forecasts', []):
        if f.get('cal') or not f.get('title'):
            continue
        rows.setdefault(f['title'], {'title': f['title'], 'text': '', 'ts': f['at'] / 1000, 'domain': 'live', 'src': 'live'})
    return pd.DataFrame(list(rows.values()))


def main():
    os.makedirs('data/ml', exist_ok=True)
    print('Prices...', flush=True)
    px = prices()
    print('Headlines from GDELT...', flush=True)
    df = gdelt_headlines()
    live = live_results()
    if not live.empty:
        df = pd.concat([df, live], ignore_index=True)
    print(f'{len(df)} headlines ({(df.src == "live").sum() if len(df) else 0} from the app itself)', flush=True)
    df = label(df, px)
    have = df[[f'r_{k}' for k in YAHOO]].notna().any(axis=1)
    df = df[have].reset_index(drop=True)
    df.to_pickle(OUT)
    print(f'Saved {len(df)} labelled headlines to {OUT}', flush=True)
    for k in YAHOO:
        r = df[f'r_{k}'].dropna()
        print(f'  {k}: {len(r)} labelled, median 4h move {r.abs().median():.3f}%, up {np.mean(r > 0):.1%}', flush=True)


if __name__ == '__main__':
    main()
