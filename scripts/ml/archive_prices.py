"""Daily: saves 5-minute prices (gold, dollar index, Nasdaq futures, WTI, VIX, 10-year yield) to the "prices" branch.

Yahoo only keeps 5-minute prices for about 60 days, so this builds a permanent archive. The training uses it to
measure the reaction right after each story far more precisely than hourly prices allow.
Layout: <market>/<YYYY-MM>.csv with lines "unix_time,close".
"""
import json, os, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from market_data import SERIES, UA  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'prices'


def main():
    for k, sym in SERIES.items():
        try:
            url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=5d&interval=5m'
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                res = json.loads(r.read())['chart']['result'][0]
        except Exception as e:
            print(f'{k}: {e}')
            continue
        rows = [(t, c) for t, c in zip(res['timestamp'], res['indicators']['quote'][0]['close']) if c is not None]
        by_month = {}
        for t, c in rows:
            import time as _t
            m = _t.strftime('%Y-%m', _t.gmtime(t))
            by_month.setdefault(m, {})[t] = c
        os.makedirs(os.path.join(OUT, k), exist_ok=True)
        for m, new in by_month.items():
            p = os.path.join(OUT, k, f'{m}.csv')
            have = {}
            if os.path.exists(p):
                for line in open(p):
                    a, b = line.strip().split(',')
                    have[int(a)] = float(b)
            have.update(new)
            with open(p, 'w') as f:
                f.writelines(f'{t},{have[t]:.6g}\n' for t in sorted(have))
        print(f'{k}: {len(rows)} bars')


if __name__ == '__main__':
    main()
