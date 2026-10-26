"""Trains the forecast model and tests it honestly (runs on GitHub, see .github/workflows/train.yml).

For each asset (gold, US dollar, Nasdaq, oil):
- Direction model: will the price be higher or lower 4 hours after the news?
  Several candidates are trained on the older 80% of the data and compared on the newest 20%, which they never saw.
  The best one is then retrained on everything.
- Confidence: on that unseen 20%, we measure how often the model was right at each level of certainty.
  The 1-10 rating shown in the app comes from those real hit rates (10/10 means it was right 77%+ of the time).
- Importance: a second model predicts how big the move will be, which decides red / yellow / blue.

Output: model/forecast.joblib (the model) and model/report.json (accuracy, readable).
"""
import json, os, sys, time

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.decomposition import PCA
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import ASSETS, featurize  # noqa: E402
from market_data import CONTEXT_KEYS  # noqa: E402

DATA = 'data/ml/dataset.pkl.gz'
OUT_DIR = 'model'
# Moves smaller than this (in %) count as "no move" and aren't used to learn direction
NOISE = {'gold': 0.05, 'usd': 0.03, 'ndq': 0.08, 'oil': 0.12}
# Rating from the real hit rate at that certainty: 50% -> 1 ... 77%+ -> 10
RATING_STEPS = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77]
N_EMB = 384


def rating_of(acc):
    r = 1
    for i, step in enumerate(RATING_STEPS):
        if acc >= step:
            r = i + 1
    return r


def candidates():
    """Different kinds of model; the one that does best on unseen data wins, per asset."""
    def reduced(clf):
        # keep FinBERT + tabular as they are, compress the 384 embedding numbers to 48
        n = 3 + N_EMB
        ct = ColumnTransformer([('emb', PCA(n_components=48, random_state=0), list(range(3, n)))], remainder='passthrough')
        return make_pipeline(ct, clf)
    return {
        'logistic': lambda: make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=2000)),
        'logistic_strong': lambda: make_pipeline(StandardScaler(), LogisticRegression(C=0.01, max_iter=2000)),
        'boosting': lambda: reduced(HistGradientBoostingClassifier(max_iter=300, learning_rate=0.04, max_leaf_nodes=15, l2_regularization=1.0, min_samples_leaf=60, random_state=0)),
    }


def calibrate(p, y):
    """Maps certainty |p - 0.5| to the real hit rate, on unseen data."""
    margin = np.abs(p - 0.5)
    right = ((p > 0.5) == (y == 1)).astype(float)
    iso = IsotonicRegression(y_min=0.5, y_max=0.95, out_of_bounds='clip', increasing=True).fit(margin, right)
    return iso


def fit_w(m, X, y, w):
    """Fits a pipeline with sample weights on its last step."""
    return m.fit(X, y, **{f'{m.steps[-1][0]}__sample_weight': w})


def main():
    t0 = time.time()
    df = pd.read_pickle(DATA).sort_values('ts').reset_index(drop=True)
    print(f'{len(df)} headlines', flush=True)
    for k in CONTEXT_KEYS:
        if k not in df.columns:
            df[k] = 0.0
    ctxs = df[CONTEXT_KEYS].fillna(0).to_dict('records')
    X, rules = featurize(df.title.tolist(), df.text.fillna('').tolist(), ctxs)
    print(f'Features {X.shape} in {time.time() - t0:.0f}s', flush=True)

    n = len(df)
    # Newer news counts a bit more (markets change), and the app's own checked stories count 3x
    w_all = (0.6 + 0.8 * np.arange(n) / max(n - 1, 1)) * np.where(df.src.values == 'live', 3.0, 1.0)
    split = int(n * 0.8)
    split_time = float(df.ts.iloc[split])
    report = {'trained': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), 'headlines': n,
              'test_from': time.strftime('%Y-%m-%d', time.gmtime(split_time)), 'horizon_h': 4, 'assets': {}}
    models = {}
    for k in ASSETS:
        r = df[f'r_{k}'].values
        ok = ~np.isnan(r) & (np.abs(np.nan_to_num(r)) >= NOISE[k])
        y = (r > 0).astype(int)
        tr = ok & (np.arange(n) < split)
        te = ok & (np.arange(n) >= split)
        if tr.sum() < 500 or te.sum() < 100:
            print(f'{k}: not enough data ({tr.sum()} / {te.sum()})', flush=True)
            continue
        # baselines on the unseen part: always the most common direction, and the old rules
        base_major = max(np.mean(y[te]), 1 - np.mean(y[te]))
        rd = np.array([ru['d'][k] for ru in rules])
        rule_mask = te & (rd != 0)
        base_rules = float(np.mean((rd[rule_mask] > 0) == (y[rule_mask] == 1))) if rule_mask.sum() else None

        best = None
        for name, make in candidates().items():
            m = fit_w(make(), X[tr], y[tr], w_all[tr])
            p = m.predict_proba(X[te])[:, 1]
            acc = float(np.mean((p > 0.5) == (y[te] == 1)))
            ll = float(-np.mean(y[te] * np.log(np.clip(p, 1e-6, 1)) + (1 - y[te]) * np.log(np.clip(1 - p, 1e-6, 1))))
            print(f'  {k} {name}: accuracy {acc:.3f}, log-loss {ll:.4f}', flush=True)
            if best is None or ll < best['ll']:
                best = {'name': name, 'm': m, 'p': p, 'acc': acc, 'll': ll}

        # Confidence: calibrate on the first half of the unseen period, then check the ratings on the second half
        # (so the hit rates reported for each rating are measured on data nothing was tuned on)
        p_te, y_te = best['p'], y[te]
        half = len(p_te) // 2
        iso_check = calibrate(p_te[:half], y_te[:half])
        exp = iso_check.predict(np.abs(p_te[half:] - 0.5))
        ratings = np.array([rating_of(a) for a in exp])
        right = (p_te[half:] > 0.5) == (y_te[half:] == 1)
        iso = calibrate(p_te, y_te)  # the app uses calibration from the whole unseen period
        by_rating = {int(rt): {'n': int((ratings == rt).sum()), 'hit': round(float(right[ratings == rt].mean()), 3)}
                     for rt in sorted(set(ratings.tolist()))}

        # importance: how big a move to expect (trained on all labelled rows, including small moves)
        okm = ~np.isnan(r)
        reg = make_pipeline(
            ColumnTransformer([('emb', PCA(n_components=48, random_state=0), list(range(3, 3 + N_EMB)))], remainder='passthrough'),
            HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=80, random_state=0))
        fit_w(reg, X[okm], np.log1p(np.abs(r[okm]) * 100), w_all[okm])
        typical = float(np.median(np.abs(r[okm])))

        # final model on everything (the test was only to choose and calibrate)
        final = fit_w(candidates()[best['name']](), X[ok], y[ok], w_all[ok])
        models[k] = {'dir': final, 'iso': iso, 'mag': reg, 'typical': typical}
        report['assets'][k] = {
            'model': best['name'], 'test_accuracy': round(best['acc'], 3), 'test_count': int(te.sum()),
            'baseline_majority': round(float(base_major), 3), 'baseline_rules': round(base_rules, 3) if base_rules is not None else None,
            'rules_count': int(rule_mask.sum()), 'by_rating': by_rating, 'typical_4h_move_pct': round(typical, 3),
        }
        print(f'{k}: chose {best["name"]}, unseen accuracy {best["acc"]:.3f} (rules {base_rules}, majority {base_major:.3f})', flush=True)
        print(f'   by rating: {by_rating}', flush=True)

    # importance thresholds: how a story's expected move compares with the typical move, over the unseen part
    sizes = []
    for k, m in models.items():
        sizes.append(np.expm1(m['mag'].predict(X[split:])) / 100 / m['typical'])
    s = np.max(np.vstack(sizes), axis=0) if sizes else np.array([1.0])
    thresholds = {'high': float(np.quantile(s, 0.85)), 'medium': float(np.quantile(s, 0.45))}
    report['importance_thresholds'] = thresholds

    os.makedirs(OUT_DIR, exist_ok=True)
    joblib.dump({'models': models, 'thresholds': thresholds, 'rating_steps': RATING_STEPS, 'version': report['trained']},
                os.path.join(OUT_DIR, 'forecast.joblib'), compress=3)
    with open(os.path.join(OUT_DIR, 'report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))
    print(f'Done in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
