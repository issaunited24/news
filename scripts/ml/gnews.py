"""Market headlines from Google News search, one week at a time back to mid-2024 (as far as hourly prices go).

Google News search accepts date limits (after:/before:), so each (topic, week) search returns that week's headlines
with their publish times and outlets. Searches already done are remembered between runs; only the current week is
searched again. A safety switch stops early if Google starts refusing, so a run never wastes hours waiting.
"""
import re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import pandas as pd

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'}
START = datetime(2024, 6, 3, tzinfo=timezone.utc)  # a Monday, about when the hourly price history begins
QUERIES = [
    '"federal reserve" OR fomc OR powell',
    'inflation OR cpi OR "consumer prices" OR pce',
    '"jobs report" OR payrolls OR "jobless claims"',
    '"treasury yields" OR "bond yields"',
    '"gold price" OR "gold prices" OR bullion',
    '"dollar index" OR "us dollar" OR greenback',
    '"oil prices" OR opec OR "crude oil"',
    'nasdaq OR "tech stocks" OR "wall street"',
    'tariffs OR "trade war" OR "trade deal"',
    'missile OR airstrike OR invasion OR "military strikes"',
    'ceasefire OR "peace talks" OR "peace deal"',
    'ecb OR "bank of japan" OR "bank of england"',
    '"china economy" OR "china stimulus"',
    'earnings nvidia OR apple OR microsoft OR alphabet OR amazon OR meta',
    '"ai spending" OR "ai stocks" OR "ai bubble"',
    'sanctions OR embargo',
    'recession OR "government shutdown" OR "debt ceiling"',
    '"stock market" OR "s&p 500" OR "dow jones"',
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def windows(now):
    out = []
    t0 = START
    while t0 < now:
        t1 = t0 + timedelta(days=7)
        out.append((t0, min(t1, now + timedelta(days=1))))
        t0 = t1
    out.reverse()  # newest first
    return [(q, a, b) for a, b in out for q in range(len(QUERIES))]


def wkey(q, t0, t1):
    return f'g{q}|{t0:%Y%m%d}|{t1:%Y%m%d}'


def search(q, t0, t1):
    query = f'{QUERIES[q]} after:{t0:%Y-%m-%d} before:{t1:%Y-%m-%d}'
    url = 'https://news.google.com/rss/search?' + urllib.parse.urlencode({'q': query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            root = ET.fromstring(r.read())
    except Exception as e:
        log(f'  google: {str(e)[:80]}')
        return None
    rows = []
    for it in root.iter('item'):
        title = (it.findtext('title') or '').strip()
        src = it.find('source')
        outlet = (src.text or '').strip() if src is not None else ''
        domain = re.sub(r'^https?://(www\.)?', '', src.get('url', '')).split('/')[0] if src is not None else ''
        if outlet and title.endswith(' - ' + outlet):
            title = title[: -len(outlet) - 3].strip()
        try:
            ts = parsedate_to_datetime(it.findtext('pubDate')).timestamp()
        except Exception:
            continue
        if len(title) >= 25:
            rows.append({'title': title, 'url': '', 'ts': ts, 'domain': domain or outlet, 'src': 'gnews'})
    return rows


def fetch(store, done, budget_min, pause=3.0):
    t_end = time.time() + budget_min * 60
    now = datetime.now(timezone.utc)
    # weeks still in progress (or just ended) are always searched again, finished weeks only once
    todo = [w for w in windows(now) if wkey(*w) not in done or w[2] > now - timedelta(days=2)]
    log(f'Google News: {len(todo)} searches to do')
    rows, n, fails, trips = [], 0, 0, 0
    for q, t0, t1 in todo:
        if time.time() > t_end:
            log('Google News: time budget used, the rest next run')
            break
        got = search(q, t0, t1)
        n += 1
        if got is None:
            fails += 1
            if fails >= 5:  # Google is refusing: pause, and after 3 pauses stop for this run
                trips += 1
                if trips >= 3:
                    log('Google News: still refusing after 3 pauses, stopping for this run')
                    break
                log('Google News: refusing, pausing 3 minutes')
                time.sleep(180)
                fails = 0
            continue
        fails = 0
        done.add(wkey(q, t0, t1))
        rows += got
        time.sleep(pause)
        if n % 100 == 0:
            log(f'  {n} searches, {len(rows)} headlines')
    new = pd.DataFrame(rows, columns=['title', 'url', 'ts', 'domain', 'src'])
    df = pd.concat([store, new], ignore_index=True) if len(store) else new
    if len(df):
        df['key'] = df.title.str.lower().str.replace(r'[^a-z0-9 ]', '', regex=True).str.slice(0, 90)
        df = df.sort_values('ts').drop_duplicates('key').drop(columns='key').reset_index(drop=True)
    log(f'Google News: {len(new)} headlines from {n} searches this run; {len(df)} headlines in the store')
    return df, done
