"""Market headlines from GDELT's free news archive, downloaded a little at a time and kept between runs.

Each (topic, time window) search is remembered once done, so every training run only fetches what's missing:
first the most recent year in 10-day windows (for the hourly models), then older years in 30-day windows back to
2017 (for the 1-day model), newest first, until the time budget for this run is used up.
"""
import json, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

import pandas as pd

UA = {'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)'}
HISTORY_START = datetime(2017, 1, 1, tzinfo=timezone.utc)
RECENT_DAYS = 400

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


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def _grid(t, days):
    """Start of the fixed `days`-long window containing t (windows line up the same way every run)."""
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return epoch + timedelta(days=((t - epoch).days // days) * days)


def windows(now):
    """All (query index, start, end) windows to have, most useful first. Windows sit on a fixed grid, so a finished
    window is never fetched twice; only the current, still-growing window is fetched again each run."""
    end = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=6)
    out = []
    recent_start = _grid(end - timedelta(days=RECENT_DAYS), 10)
    t0 = _grid(end, 10)
    out += [(q, t0, end) for q in range(len(QUERIES))]  # the current window (partial)
    while t0 > recent_start:
        t0 -= timedelta(days=10)
        out += [(q, t0, t0 + timedelta(days=10)) for q in range(len(QUERIES))]
    h = _grid(t0, 30)
    if h < t0:
        out += [(q, h, t0) for q in range(len(QUERIES))]
    while h > HISTORY_START:
        h -= timedelta(days=30)
        out += [(q, h, h + timedelta(days=30)) for q in range(len(QUERIES))]
    return out


def wkey(q, t0, t1):
    return f'{q}|{t0:%Y%m%d%H}|{t1:%Y%m%d%H}'


def search(q, t0, t1):
    params = {'query': f'{QUERIES[q]} sourcelang:english', 'mode': 'artlist', 'maxrecords': '250', 'format': 'json',
              'startdatetime': t0.strftime('%Y%m%d%H%M%S'), 'enddatetime': t1.strftime('%Y%m%d%H%M%S'), 'sort': 'hybridrel'}
    url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + urllib.parse.urlencode(params)
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                txt = r.read().decode('utf-8', 'replace')
            try:
                return json.loads(txt).get('articles', [])
            except Exception:
                return []  # GDELT answers plain text when a search has no results or is malformed
        except Exception as e:
            log(f'  retry {i + 1}: {str(e)[:80]}')
            time.sleep(20 * (2 ** i))
    return None  # failed: not marked done, tried again next run


def fetch(store, done, budget_min):
    """Adds new headlines to `store` (DataFrame) and window keys to `done` (set), within the time budget."""
    t_end = time.time() + budget_min * 60
    now = datetime.now(timezone.utc)
    todo = [w for w in windows(now) if wkey(*w) not in done]
    log(f'GDELT: {len(todo)} searches to do, {len(done)} already done')
    rows, n = [], 0
    for q, t0, t1 in todo:
        if time.time() > t_end:
            log('GDELT: time budget used, the rest next run')
            break
        arts = search(q, t0, t1)
        time.sleep(8)
        n += 1
        if arts is None:
            continue
        done.add(wkey(q, t0, t1))
        for a in arts:
            title = (a.get('title') or '').strip()
            if len(title) < 25:
                continue
            try:
                ts = datetime.strptime(a['seendate'], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp()
            except Exception:
                continue
            rows.append({'title': title, 'url': a.get('url', ''), 'ts': ts, 'domain': a.get('domain', ''), 'src': 'gdelt'})
        if n % 50 == 0:
            log(f'  {n} searches, {len(rows)} new headlines')
    new = pd.DataFrame(rows, columns=['title', 'url', 'ts', 'domain', 'src'])
    df = pd.concat([store, new], ignore_index=True) if len(store) else new
    df['key'] = df.title.str.lower().str.replace(r'[^a-z0-9 ]', '', regex=True).str.slice(0, 90)
    df = df.sort_values('ts').drop_duplicates('key').drop(columns='key').reset_index(drop=True)
    log(f'GDELT: {len(new)} new headlines this run, {len(df)} in total, from {pd.Timestamp(df.ts.min(), unit="s"):%Y-%m-%d}' if len(df) else 'GDELT: none')
    return df, done
