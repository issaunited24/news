"""Is this story new, or the 20th article about something markets already know? (shared by training and live)

For each story, compared with the market headlines of the 24 hours before it (by meaning, using the
sentence embeddings, so differently worded headlines about the same event still match):
- first:      1 if nothing similar came out in the previous 24 hours (a fresh event)
- share24:    share of the past 24 hours' market news that was about the same thing (how "old" the story is)
- share1:     the same over the past hour (how fast it's spreading right now)
- max_sim:    how close the closest earlier headline is (1 = the same story again)
- age:        hours since the first similar headline, out of 24
Shares rather than counts, so it works the same on the training archive and the robot's (much denser) feed.
"""
import numpy as np

SIM = 0.62
NAMES = ['first', 'share24', 'share1', 'max_sim', 'age']


def novelty(emb, ts, pool_emb=None, pool_ts=None):
    """emb/ts: the stories to describe. pool_*: earlier headlines to compare with (defaults to the stories themselves).
    Embeddings must be L2-normalised. Returns an array (n, 5)."""
    if pool_emb is None:
        pool_emb, pool_ts = emb, ts
    order = np.argsort(pool_ts, kind='stable')
    P, PT = pool_emb[order], np.asarray(pool_ts, dtype=float)[order]
    out = np.zeros((len(ts), len(NAMES)), dtype=np.float32)
    for i, (e, t) in enumerate(zip(emb, ts)):
        lo, hi = np.searchsorted(PT, t - 24 * 3600, 'left'), np.searchsorted(PT, t, 'left')  # strictly before t
        if hi <= lo:
            out[i] = [1, 0, 0, 0, 0]
            continue
        sims = P[lo:hi] @ e
        sims[np.abs(PT[lo:hi] - t) < 1] = 0  # never compare a story with itself
        near = sims >= SIM
        n24 = hi - lo
        lo1 = np.searchsorted(PT, t - 3600, 'left')
        n1 = max(1, hi - lo1)
        k = int(near.sum())
        k1 = int(near[lo1 - lo:].sum()) if lo1 < hi else 0
        age = (t - PT[lo:hi][near].min()) / 3600 / 24 if k else 0.0
        out[i] = [1.0 if k == 0 else 0.0, k / n24 * 100, k1 / n1 * 100, float(sims.max()), age]
    return out
