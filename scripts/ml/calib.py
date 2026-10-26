"""Turning a model's certainty into an honest 1-10 rating (shared by the news and calendar models).

Certainty levels are grouped into bins of at least `min_bin` tested calls, each bin's hit rate is pulled toward 50%
(as if it also had `prior` coin-flip calls), and the result is forced to rise with certainty. So a high rating needs a
lot of evidence, not a lucky handful. Rating: hit rate 50% -> 1 ... 77%+ -> 10.
"""
import numpy as np
from sklearn.isotonic import IsotonicRegression

RATING_STEPS = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77]


def rating_of(acc, steps=RATING_STEPS):
    r = 1
    for i, s in enumerate(steps):
        if acc >= s:
            r = i + 1
    return r


def fit_calibration(margin, right, min_bin=300, prior=150):
    margin, right = np.asarray(margin, float), np.asarray(right, float)
    o = np.argsort(margin)
    m, r = margin[o], right[o]
    nb = max(1, len(m) // min_bin)
    edges = np.linspace(0, len(m), nb + 1).astype(int)
    xs, ys, ws = [], [], []
    for a, b in zip(edges[:-1], edges[1:]):
        if b <= a:
            continue
        xs.append(m[a:b].mean())
        ys.append((r[a:b].sum() + prior * 0.5) / (b - a + prior))
        ws.append(b - a)
    return IsotonicRegression(y_min=0.5, y_max=0.95, out_of_bounds='clip').fit(xs, ys, sample_weight=ws)


def check(p, y, min_bin=300):
    """Calibrate on the first half of tested calls, report hit rate per rating on the second half; final calibration on all."""
    p, y = np.asarray(p, float), np.asarray(y)
    margin, right = np.abs(p - 0.5), ((p > 0.5) == (y == 1)).astype(float)
    half = len(p) // 2
    iso_a = fit_calibration(margin[:half], right[:half], min_bin)
    rt = np.array([rating_of(a) for a in iso_a.predict(margin[half:])])
    by = {int(x): {'n': int((rt == x).sum()), 'hit': round(float(right[half:][rt == x].mean()), 3)} for x in sorted(set(rt.tolist()))}
    return fit_calibration(margin, right, min_bin), by


def caps(by, prior=150):
    """No rating may promise more than it delivered on the most recent test months:
    each rating is capped at the rating its recent hit rate (pulled toward 50%) actually earns."""
    out = {}
    for r, v in by.items():
        earned = rating_of((v['hit'] * v['n'] + prior * 0.5) / (v['n'] + prior))
        out[int(r)] = int(min(int(r), max(1, earned)))
    return out
