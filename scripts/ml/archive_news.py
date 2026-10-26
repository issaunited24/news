"""Every 6 hours: saves the robot's market headlines to the "newsarchive" branch, for training.

The robot sees ~170 sources but only keeps 36 hours. This keeps every market-related headline (title, time,
outlet, summary) forever, so the models learn from exactly the kind of news the app shows.
Layout: YYYY-MM-DD.jsonl, one headline per line.
"""
import json, os, sys, time, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'newsarchive'
KEEP = {'forex', 'business', 'world', 'us', 'tech'}


def main():
    with urllib.request.urlopen('https://raw.githubusercontent.com/issaunited24/news/live/state.json', timeout=120) as r:
        items = json.loads(r.read()).get('items', [])
    by_day = {}
    for it in items:
        cats = set(it.get('cats') or [it.get('category')])
        if not cats & KEEP or not it.get('title') or not it.get('time'):
            continue
        day = time.strftime('%Y-%m-%d', time.gmtime(it['time'] / 1000))
        by_day.setdefault(day, {})[it['id']] = {'id': it['id'], 'title': it['title'], 'ts': it['time'] / 1000, 'outlet': it.get('outlet', ''),
                                                 'summary': (it.get('summary') or '')[:400], 'cats': sorted(c for c in cats if c)}
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for day, new in by_day.items():
        p = os.path.join(OUT, f'{day}.jsonl')
        have = {}
        if os.path.exists(p):
            for line in open(p):
                d = json.loads(line)
                have[d['id']] = d
        for k, v in new.items():
            have.setdefault(k, v)
        with open(p, 'w') as f:
            f.writelines(json.dumps(v) + '\n' for v in sorted(have.values(), key=lambda d: d['ts']))
        total += len(have)
    print(f'{sum(len(v) for v in by_day.values())} headlines in the live window; {len(by_day)} days updated')


if __name__ == '__main__':
    main()
