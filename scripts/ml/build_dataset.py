"""Stage 1 of training (GitHub, .github/workflows/train.yml): collect and prepare everything the models learn from.

Kept between runs in data/ml/store/ (so each weekly run only adds what's new):
  headlines.pkl.gz  market headlines from GDELT (topic searches, see gdelt.py)
  gdelt_done.json   which GDELT searches are already done
  texts.pkl.gz      the opening of each article (see texts.py)
  textfeat.pkl      FinBERT tone + meaning (embedding) for every headline and opening already processed

Written to data/ml/dataset/ for stage 2:
  meta.pkl.gz       one row per headline: time, source, labels (what each market did after it), market mood,
                    daily mood, hedge-fund positioning
  feats.npz         numbers per headline: tone and meaning of the headline and of the opening, rule calls,
                    "is it new?" scores, source quality
"""
import hashlib, json, os, sys, time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gdelt, gnews, positioning, texts  # noqa: E401,E402
from features import embeddings, finbert_scores, rule_features, rules_block  # noqa: E402
from market_data import (ASSETS, best_forward_return, context_at, daily_context, daily_return, fetch,  # noqa: E402
                         fetch_daily, load_fine)
from novelty import novelty  # noqa: E402
from sources import source_features, tier_of  # noqa: E402

STORE, OUT = 'data/ml/store', 'data/ml/dataset'
QUICK = os.environ.get('ML_QUICK') == '1'
GNEWS_MIN = float(os.environ.get('ML_GNEWS_MIN', '150'))
GDELT_MIN = float(os.environ.get('ML_GDELT_MIN', '20'))
TEXT_MIN = float(os.environ.get('ML_TEXT_MIN', '70'))
COLS = ['title', 'url', 'ts', 'domain', 'src']
ARCHIVE = 'data/ml/newsarchive'


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load_store():
    os.makedirs(STORE, exist_ok=True)
    p = lambda n: os.path.join(STORE, n)  # noqa: E731
    heads = pd.read_pickle(p('headlines.pkl.gz')) if os.path.exists(p('headlines.pkl.gz')) else pd.DataFrame(columns=COLS)
    done = set(json.load(open(p('gdelt_done.json')))) if os.path.exists(p('gdelt_done.json')) else set()
    txt = pd.read_pickle(p('texts.pkl.gz')) if os.path.exists(p('texts.pkl.gz')) else {}
    feat = pd.read_pickle(p('textfeat.pkl')) if os.path.exists(p('textfeat.pkl')) else {}
    return heads, done, txt, feat


def save_store(heads, done, txt, feat):
    p = lambda n: os.path.join(STORE, n)  # noqa: E731
    heads.to_pickle(p('headlines.pkl.gz'))
    json.dump(sorted(done), open(p('gdelt_done.json'), 'w'))
    pd.to_pickle(txt, p('texts.pkl.gz'))
    pd.to_pickle(feat, p('textfeat.pkl'))


def live_results():
    """The app's own checked stories, from the live robot's saved state."""
    import urllib.request
    try:
        with urllib.request.urlopen('https://raw.githubusercontent.com/issaunited24/news/live/state.json', timeout=60) as r:
            st = json.loads(r.read())
    except Exception:
        return pd.DataFrame(columns=COLS)
    rows = {}
    for f in st.get('forecasts', []):
        if f.get('cal') or not f.get('title'):
            continue
        rows.setdefault(f['title'], {'title': f['title'], 'url': '', 'ts': f['at'] / 1000, 'domain': '', 'src': 'live'})
    return pd.DataFrame(list(rows.values()), columns=COLS)


def archive_rows():
    """The robot's own market headlines (the "newsarchive" branch, see archive_news.py), with their summaries."""
    rows = []
    if os.path.isdir(ARCHIVE):
        for f in sorted(os.listdir(ARCHIVE)):
            if f.endswith('.jsonl'):
                for line in open(os.path.join(ARCHIVE, f)):
                    d = json.loads(line)
                    rows.append({'title': d['title'], 'url': '', 'ts': d['ts'], 'domain': d.get('outlet', ''), 'src': 'archive', 'summary': d.get('summary', '')})
    return pd.DataFrame(rows, columns=COLS + ['summary'])


def text_features(strings, cache):
    """FinBERT tone (3) + meaning (384) for each string, computed once and cached by content."""
    keys = [hashlib.sha1(s.encode('utf-8')).hexdigest()[:16] if s else '' for s in strings]
    todo = sorted({(k, s) for k, s in zip(keys, strings) if s and k not in cache})
    if todo:
        log(f'  reading {len(todo)} new texts with FinBERT and the meaning model...')
        ts = [s for _, s in todo]
        fb, em = finbert_scores(ts), embeddings(ts)
        for (k, _), f, e in zip(todo, fb, em):
            cache[k] = (f.astype(np.float16), e.astype(np.float16))
    fb = np.zeros((len(strings), 3), np.float32)
    em = np.zeros((len(strings), 384), np.float32)
    for i, k in enumerate(keys):
        if k and k in cache:
            fb[i], em[i] = cache[k][0], cache[k][1]
    return fb, em


def main():
    t0 = time.time()
    heads, done, txt, feat = load_store()
    if 'url' not in heads.columns:  # headlines from the first version of this script had no links
        heads['url'] = ''
    log(f'Store: {len(heads)} headlines, {len(done)} searches done, {sum(1 for v in txt.values() if v)} openings, {len(feat)} texts read')

    # 1. headlines: Google News week by week (main source), then GDELT (often refuses GitHub's servers, so short)
    if QUICK:
        gnews.QUERIES[:] = gnews.QUERIES[:3]
        gnews.START = pd.Timestamp.utcnow().to_pydatetime() - pd.Timedelta(days=21).to_pytimedelta()
        gdelt.QUERIES[:] = gdelt.QUERIES[:2]
        gdelt.RECENT_DAYS = 20
        gdelt.HISTORY_START = pd.Timestamp.utcnow().to_pydatetime() - pd.Timedelta(days=30).to_pytimedelta()
    heads, done = gnews.fetch(heads[COLS], done, 6 if QUICK else GNEWS_MIN)
    save_store(heads, done, txt, feat)
    heads, done = gdelt.fetch(heads[COLS], done, 4 if QUICK else GDELT_MIN)
    save_store(heads, done, txt, feat)

    # 2. prices (hourly for 2 years, daily for 10) and hedge-fund positioning
    log('Prices...')
    px, pxd, fine = fetch('730d'), fetch_daily('10y'), load_fine()
    log('  5-minute archive: ' + (', '.join(f'{k} from {v.index[0].date()}' for k, v in fine.items()) or 'not yet'))
    for k in ASSETS:
        log(f'  {k}: {len(px[k])} hourly bars from {px[k].index[0].date() if len(px[k]) else "-"}, '
            f'{len(pxd[k])} daily from {pxd[k].index[0].date() if len(pxd[k]) else "-"}')
    try:
        pos = positioning.history(10)
        log('  positioning: ' + ', '.join(f'{k} {len(v)} weeks' for k, v in pos.items()))
    except Exception as e:
        log(f'  positioning unavailable: {e}')
        pos = {}

    # 3. rows: GDELT headlines + the app's own checked stories
    df = pd.concat([heads[COLS], live_results(), archive_rows()], ignore_index=True)
    df['key'] = df.title.str.lower().str.replace(r'[^a-z0-9 ]', '', regex=True).str.slice(0, 90)
    df = df.sort_values('ts').drop_duplicates('key').drop(columns='key').reset_index(drop=True)
    log('Rows by source: ' + ', '.join(f'{k} {v}' for k, v in df.src.value_counts().items()))
    hourly_from = px['gold'].index[0].timestamp() if len(px['gold']) else 0

    # 4. article openings for the rows the hourly models learn from (best outlets and newest first)
    recent = df[(df.ts >= hourly_from) & (df.url.fillna('') != '')].copy()
    recent['tier'] = recent.domain.map(tier_of)
    urls = recent.sort_values(['tier', 'ts'], ascending=[False, False]).url.tolist()
    texts.fetch(urls, txt, 5 if QUICK else TEXT_MIN)
    save_store(heads, done, txt, feat)
    df['text'] = [txt.get(u, '') if u else (sm or '') for u, sm in zip(df.url, df.get('summary', pd.Series([''] * len(df))).fillna(''))]

    # 5. labels and mood
    log('Labels and market mood...')
    rows = []
    for ts in df.ts.values:
        t = pd.Timestamp(float(ts), unit='s', tz='UTC')
        r = {}
        for k in ASSETS:
            r[f'r1_{k}'] = best_forward_return(fine.get(k), px[k], t, 1)
            r[f'r4_{k}'] = best_forward_return(fine.get(k), px[k], t, 4)
            r[f'rD_{k}'] = daily_return(pxd[k], float(ts))
        r.update(context_at(px, float(ts)))
        r.update(daily_context(pxd, float(ts)))
        r.update(positioning.at(pos, float(ts)))
        rows.append(r)
    meta = pd.concat([df[['title', 'text', 'url', 'ts', 'domain', 'src']].reset_index(drop=True), pd.DataFrame(rows)], axis=1)
    keep = meta[[f'r4_{k}' for k in ASSETS] + [f'rD_{k}' for k in ASSETS]].notna().any(axis=1).values
    meta = meta[keep].reset_index(drop=True)
    log(f'{len(meta)} labelled headlines ({int((meta.ts >= hourly_from).sum())} with hourly labels, {int((meta.src == "live").sum())} from the app)')

    # 6. numbers per headline
    log('Reading the headlines and openings...')
    fb_t, em_t = text_features(meta.title.tolist(), feat)
    fb_x, em_x = text_features(meta.text.fillna('').tolist(), feat)
    has_x = (meta.text.fillna('').str.len() > 60).values.astype(np.float32)[:, None]
    save_store(heads, done, txt, feat)
    log('Rules, "is it new?", sources...')
    rules = rule_features([{'title': t, 'text': x or t} for t, x in zip(meta.title, meta.text.fillna(''))])
    nov = novelty(em_t, meta.ts.values.astype(float))
    src = np.asarray([source_features(d) for d in meta.domain.fillna('')], np.float32)
    os.makedirs(OUT, exist_ok=True)
    meta.to_pickle(os.path.join(OUT, 'meta.pkl.gz'))
    np.savez_compressed(os.path.join(OUT, 'feats.npz'), fb_t=fb_t, em_t=em_t.astype(np.float16), fb_x=fb_x, em_x=em_x.astype(np.float16),
                        has_x=has_x, rules=rules_block(rules), nov=nov, src=src)
    for k in ASSETS:
        a, b = meta[f'r4_{k}'].dropna(), meta[f'rD_{k}'].dropna()
        log(f'  {k}: {len(a)} with 4-hour labels (median move {a.abs().median():.3f}%), {len(b)} with 1-day labels')
    log(f'Stage 1 done in {(time.time() - t0) / 60:.0f} min')


if __name__ == '__main__':
    main()
