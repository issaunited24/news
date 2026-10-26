"""How much a news source tends to move markets, from its web domain (training data) or outlet name (live app).

Tier 3: wires, market desks and central banks (Reuters, Bloomberg, WSJ, FT, CNBC, the Fed...)
Tier 2: major general newsrooms and finance sites (NYT, BBC, CNN, Yahoo Finance, Investing.com...)
Tier 1: other known outlets the app already trusts
Tier 0: everything else
"""
import re

TIERS = [
    (3, r'reuters|bloomberg|apnews|associated press|^ap news|wsj|wall street journal|ft\.com|financial times|cnbc|marketwatch|barron|'
        r'fxstreet|investinglive|forexlive|kitco|federalreserve|federal reserve|ecb\.europa|^ecb$|boj\.or\.jp|bank of japan|nikkei'),
    (2, r'nytimes|new york times|washingtonpost|washington post|bbc|theguardian|the guardian|aljazeera|al jazeera|foxnews|fox news|foxbusiness|'
        r'fox business|nbcnews|nbc news|cbsnews|cbs news|abcnews|abc news|cnn|npr\.org|^npr$|axios|politico|economist|yahoo|businessinsider|'
        r'business insider|forbes|fortune|seekingalpha|seeking alpha|investing\.com|fxempire|economictimes|economic times|scmp|south china morning|'
        r'dw\.com|deutsche welle|france24|france 24|afp|euronews|skynews|sky news|cmcmarkets|cmc markets|tradingeconomics|trading economics'),
    (1, r'usatoday|usa today|thehill|the hill|latimes|los angeles times|cbc\.ca|^cbc$|independent|newsweek|nypost|new york post|time\.com|'
        r'theverge|techcrunch|wired|arstechnica|venturebeat|engadget|benzinga|thestreet|morningstar|zerohedge|oilprice|mining\.com'),
]
_RX = [(t, re.compile(p, re.I)) for t, p in TIERS]


def tier_of(name):
    n = (name or '').strip().lower()
    n = re.sub(r'^www\.', '', n)
    for t, rx in _RX:
        if rx.search(n):
            return t
    return 0


def source_features(name):
    """Tier 0-3 as one-hot (4 numbers). (How widely a story spreads is measured by novelty.py instead.)"""
    t = tier_of(name)
    return [1.0 if t == i else 0.0 for i in range(4)]
