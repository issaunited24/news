"""Which headlines mean the same thing (called by scripts/collect.mjs every round).

The same small "meaning" model the forecasts use (all-MiniLM-L6-v2) turns each headline into numbers; headlines whose
meanings are close are likely about the same event even when the wording differs ("Arsenal beat Chelsea 2-1" and
"Gunners edge Blues at the Emirates"). The robot decides what to do with the pairs (merge duplicates, link related
stories), with its own safety checks.

stdin:  {"titles": [{"t": title, "ts": seconds}], "min": 0.55, "hours": 24, "k": 12}
stdout: {"pairs": [[i, j, similarity], ...]}       i < j, each headline's closest k neighbours within `hours`

Meanings are remembered between rounds (only new headlines are read), and saved as it goes, so even a slow first round
leaves the next one fast.
"""
import hashlib, json, os, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CACHE = '/tmp/briefly-ml/titles_emb.npz'


def load_cache():
    try:
        d = np.load(CACHE, allow_pickle=False)
        return dict(zip(d['k'].tolist(), d['v']))
    except Exception:
        return {}


def save_cache(mem, keep):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    ks = [k for k in mem if k in keep]
    tmp = CACHE + '.tmp.npz'
    np.savez(tmp, k=np.asarray(ks), v=np.asarray([mem[k] for k in ks], np.float16).reshape(len(ks), 384))
    os.replace(tmp, CACHE)


def main():
    t0 = time.time()
    req = json.loads(sys.stdin.read() or '{}')
    rows = req.get('titles', [])
    lo, hours, k = float(req.get('min', 0.55)), float(req.get('hours', 24)), int(req.get('k', 12))
    budget = float(req.get('budget', 80))
    n = len(rows)
    if n < 2:
        print(json.dumps({'pairs': []}))
        return
    keys = [hashlib.sha1(r['t'].strip().lower().encode('utf-8')).hexdigest()[:16] for r in rows]
    mem = load_cache()
    todo = sorted({(kk, r['t']) for kk, r in zip(keys, rows) if kk not in mem})
    if todo:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')
        for a in range(0, len(todo), 512):
            if time.time() - t0 > budget:
                break
            chunk = todo[a:a + 512]
            em = model.encode([t for _, t in chunk], batch_size=64, normalize_embeddings=True, show_progress_bar=False)
            for (kk, _), e in zip(chunk, em):
                mem[kk] = e.astype(np.float16)
            save_cache(mem, set(keys))
        print(f'similar: read {len(todo)} new headlines in {time.time() - t0:.0f}s', file=sys.stderr)
    have = np.asarray([kk in mem for kk in keys])
    if (~have).any():  # out of time this round: the rest are read next round, these headlines just aren't paired yet
        print(f'similar: {int((~have).sum())} headlines left for next round', file=sys.stderr)
    idx = np.flatnonzero(have)
    E = np.asarray([mem[keys[i]] for i in idx], np.float32)
    ts = np.asarray([float(rows[i].get('ts') or 0) for i in idx])
    pairs = []
    win = hours * 3600
    for a in range(0, len(idx), 1024):
        S = E[a:a + 1024] @ E.T
        for r in range(S.shape[0]):
            i = a + r
            s = S[r]
            s[: i + 1] = -1  # each pair once (i < j)
            s[np.abs(ts - ts[i]) > win] = -1
            cand = np.flatnonzero(s >= lo)
            if len(cand) > k:
                cand = cand[np.argpartition(-s[cand], k)[:k]]
            for j in cand:
                pairs.append([int(idx[i]), int(idx[j]), round(float(s[j]), 3)])
    save_cache(mem, set(keys))
    print(json.dumps({'pairs': pairs}))
    print(f'similar: {len(pairs)} pairs from {len(idx)} headlines in {time.time() - t0:.0f}s', file=sys.stderr)


if __name__ == '__main__':
    main()
