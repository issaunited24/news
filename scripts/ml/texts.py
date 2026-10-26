"""The opening of each training article (its description and first paragraphs), kept between runs.

Headlines alone often hide the point ("strong earnings, but..."), so the models also read the opening, like the
live app does with each story's summary. Downloaded in parallel within a time budget, most useful first
(recent stories from market-moving outlets); every URL is tried once, failures are remembered and skipped.
"""
import html, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = {'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36', 'Accept': 'text/html'}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def _clean(s):
    s = re.sub(r'<[^>]+>', ' ', s or '')
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def opening(page):
    m = (re.search(r'<meta[^>]+(?:property|name)=["\'](?:og:description|description|twitter:description)["\'][^>]*content=["\']([^"\']{40,})["\']', page, re.I)
         or re.search(r'<meta[^>]+content=["\']([^"\']{40,})["\'][^>]*(?:property|name)=["\'](?:og:description|description)["\']', page, re.I))
    text = _clean(m.group(1)) if m else ''
    body = re.sub(r'<(script|style|noscript|figure|figcaption|aside|nav|header|footer)[\s\S]*?</\1>', ' ', page, flags=re.I)
    for p in re.findall(r'<p[^>]*>([\s\S]*?)</p>', body, re.I):
        p = _clean(p)
        if len(text) > 500:
            break
        if len(p) > 80 and not re.search(r'cookie|subscribe|sign up|newsletter|advertis|all rights reserved|©', p, re.I) and p[:40].lower() not in text.lower():
            text += (' ' if text else '') + p
    return text[:600]


def _one(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12) as r:
            if 'html' not in (r.headers.get('Content-Type') or 'html'):
                return url, ''
            return url, opening(r.read(400000).decode('utf-8', 'replace'))
    except Exception:
        return url, ''


def fetch(urls, have, budget_min, workers=24):
    """urls: in priority order. have: dict url -> text ('' = tried and failed). Updated in place."""
    todo = [u for u in urls if u and u not in have]
    log(f'Article openings: {len(todo)} to fetch, {sum(1 for v in have.values() if v)} already have')
    t_end, done = time.time() + budget_min * 60, 0
    with ThreadPoolExecutor(workers) as ex:
        for i in range(0, len(todo), 400):
            if time.time() > t_end:
                log('Article openings: time budget used, the rest next run')
                break
            futs = [ex.submit(_one, u) for u in todo[i:i + 400]]
            for f in as_completed(futs):
                u, t = f.result()
                have[u] = t
                done += 1
            log(f'  {done} fetched, {sum(1 for v in have.values() if v)} with text')
    return have
