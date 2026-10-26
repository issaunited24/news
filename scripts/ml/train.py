"""Stage 2 of training (GitHub, .github/workflows/train.yml): build, test and choose the forecast models.

Three time frames: 1 hour and 4 hours after the news (from 2 years of hourly prices), and the next day
(from up to 10 years of daily prices). For each, and each market (gold, dollar, Nasdaq, oil):

Honest testing ("walk-forward"): the most recent 40% of the timeline is cut into 4 periods. For each period a model
is trained only on news from before it (with a 1-day gap so the same event can't leak across), then tested on it.
That's how it would have done live, four times over.

Only what helps is kept: the base inputs (headline tone and meaning, the forex rulebook, market mood) are always used.
Each optional input (is it new?, source quality, article opening, hedge-fund positioning) is tried one at a time and
kept only if it makes the tests better. Inputs that don't help get dropped instead of adding noise, and the model
is heavily regularised so no single input can dominate a call.

Cleaner learning: each move is measured against how jumpy that market was at the time, tiny moves (noise) are
ignored, and clear moves count more than marginal ones.

Ratings: the 1-10 confidence comes from how often the model was right at that level of certainty in the tests
(10/10 = right 77%+ of the time), measured on test periods the calibration never saw.

A new model only replaces the live one if it tests at least as well (model/report.json from the last release).
"""
import json, os, sys, time

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.decomposition import PCA
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from calib import RATING_STEPS, check  # noqa: E402
from features import assemble  # noqa: E402
from market_data import ASSETS, CONTEXT_KEYS, DAILY_KEYS  # noqa: E402
from positioning import KEYS as POS_KEYS  # noqa: E402

DATA, OUT = 'data/ml/dataset', 'model'
HORIZONS = {'1h': ('r1', 1), '4h': ('r4', 4), '1d': ('rD', 24)}
BASE = {'hourly': ['headline', 'rules', 'mood'], 'daily': ['headline', 'rules', 'dmood']}
OPTIONAL = ['fresh', 'source', 'opening', 'positioning']
EMB_PCA = 48
MAX_DAILY_ROWS = 200000
START = time.time()


def log(*a):
    print(f'[{(time.time() - START) / 60:5.1f}m]', *a, flush=True)


def make_model(kind, C, emb_blocks):
    pre = ColumnTransformer([(f'e{i}', PCA(n_components=EMB_PCA, random_state=0), list(range(a, b))) for i, (a, b) in enumerate(emb_blocks)],
                            remainder='passthrough')
    if kind == 'logistic':
        return make_pipeline(pre, StandardScaler(), LogisticRegression(C=C, max_iter=3000))
    return make_pipeline(pre, HistGradientBoostingClassifier(max_iter=250, learning_rate=0.04, max_leaf_nodes=15, l2_regularization=2.0,
                                                             min_samples_leaf=120, random_state=0))


def fit_w(m, X, y, w):
    return m.fit(X, y, **{f'{m.steps[-1][0]}__sample_weight': w})


def labels(meta, prefix, k, hours):
    """Direction (1 = up), which rows count (not noise), and how much each counts (clearer moves count more)."""
    r = meta[f'{prefix}_{k}'].values.astype(float)
    vol = meta[f'dv20_{k}'].values * np.sqrt(2) if prefix == 'rD' else meta[f'v24_{k}'].values * np.sqrt(hours)
    good = vol[np.isfinite(vol) & (vol > 0)]
    vol = np.where(np.isfinite(vol) & (vol > 0), vol, np.median(good) if len(good) else 1.0)
    z = r / vol
    ok = np.isfinite(r) & (np.abs(np.nan_to_num(z)) >= 0.1)
    return ok, (r > 0).astype(int), np.clip(np.abs(np.nan_to_num(z)), 0.1, 3.0), z


def folds(ts, n_folds=4, test_frac=0.4, embargo=86400):
    n = len(ts)
    b = np.linspace(int(n * (1 - test_frac)), n, n_folds + 1).astype(int)
    out = []
    for i in range(n_folds):
        te = np.zeros(n, bool)
        te[b[i]:b[i + 1]] = True
        tr = ts < ts[b[i]] - embargo
        out.append((tr, te))
    return out


def logloss(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


class Frame:
    """One set of rows (hourly or daily) with everything needed to build inputs and labels."""

    def __init__(self, meta, feats, sel, kind):
        self.kind = kind
        self.meta = meta[sel].reset_index(drop=True)
        f = {k: v[sel] for k, v in feats.items()}
        self.parts = {'fb_t': f['fb_t'], 'em_t': f['em_t'].astype(np.float32), 'rules': f['rules'], 'nov': f['nov'], 'src': f['src'],
                      'has_x': f['has_x'], 'fb_x': f['fb_x'], 'em_x': f['em_x'].astype(np.float32),
                      'mood': self.meta[CONTEXT_KEYS].fillna(0).values.astype(np.float32),
                      'dmood': self.meta[DAILY_KEYS].fillna(0).values.astype(np.float32),
                      'pos': self.meta[POS_KEYS].fillna(0.5).values.astype(np.float32)}
        n = len(self.meta)
        self.ts = self.meta.ts.values.astype(float)
        self.extra = (0.6 + 0.8 * np.arange(n) / max(n - 1, 1)) * np.where(self.meta.src.values == 'live', 3.0, 1.0)
        self.folds = folds(self.ts)
        self.cache = {}

    def X(self, groups):
        key = tuple(groups)
        if key not in self.cache:
            self.cache = {key: assemble(self.parts, groups)}  # keep one at a time (memory)
        return self.cache[key]

    def walk(self, groups, prefix, hours, kind='logistic', C=0.01, assets=ASSETS):
        """Walk-forward test. Returns per-asset results with out-of-sample probabilities."""
        X, emb = self.X(groups)
        res = {}
        for k in assets:
            ok, y, w, z = labels(self.meta, prefix, k, hours)
            oof = np.full(len(y), np.nan)
            for tr, te in self.folds:
                trm, tem = tr & ok, te & ok
                if trm.sum() < 400 or tem.sum() < 60:
                    continue
                m = fit_w(make_model(kind, C, emb), X[trm], y[trm], w[trm] * self.extra[trm])
                oof[tem] = m.predict_proba(X[tem])[:, 1]
            has = np.isfinite(oof)
            if has.sum() < 100:
                continue
            res[k] = {'oof': oof, 'y': y, 'has': has, 'acc': float(np.mean((oof[has] > 0.5) == (y[has] == 1))), 'll': logloss(oof[has], y[has])}
        return res


def score(res):
    if not res:
        return 9.0, 0.0
    return float(np.mean([r['ll'] for r in res.values()])), float(np.mean([r['acc'] for r in res.values()]))


def choose_groups(fr, prefix, hours):
    """Start from the base inputs; add each optional group only if it improves the walk-forward test."""
    groups = list(BASE[fr.kind])
    best_ll, best_acc = score(fr.walk(groups, prefix, hours))
    steps = [{'groups': list(groups), 'logloss': round(best_ll, 5), 'accuracy': round(best_acc, 4)}]
    log(f'  base {groups}: log-loss {best_ll:.5f}, accuracy {best_acc:.4f}')
    remaining = [g for g in OPTIONAL if not (g == 'opening' and fr.parts['has_x'].mean() < 0.05)]
    while remaining:
        trials = []
        for g in remaining:
            ll, acc = score(fr.walk(groups + [g], prefix, hours))
            log(f'    + {g}: log-loss {ll:.5f}, accuracy {acc:.4f}')
            trials.append((ll, acc, g))
        ll, acc, g = min(trials)
        if ll < best_ll - 0.0003 and acc >= best_acc - 0.002:
            groups.append(g)
            remaining.remove(g)
            best_ll, best_acc = ll, acc
            steps.append({'groups': list(groups), 'logloss': round(ll, 5), 'accuracy': round(acc, 4)})
            log(f'  kept {g}')
        else:
            break
    return groups, steps


def choose_model(fr, groups, prefix, hours):
    """Per asset: the model type and strength of regularisation that test best."""
    cands = [('logistic', 0.003), ('logistic', 0.01), ('logistic', 0.03), ('boosting', None)]
    results = {c: fr.walk(groups, prefix, hours, kind=c[0], C=c[1] or 1.0) for c in cands}
    chosen = {}
    for k in ASSETS:
        opts = [(results[c][k]['ll'], c) for c in cands if k in results[c]]
        if opts:
            ll, c = min(opts)
            chosen[k] = (c, results[c][k])
            log(f'    {k}: {c[0]}{"" if c[1] is None else f" C={c[1]}"}, accuracy {results[c][k]["acc"]:.4f}, log-loss {ll:.5f}')
    return chosen


def calibrate(r):
    """Ratings from the walk-forward tests (see calib.py)."""
    has = np.where(r['has'])[0]
    return check(r['oof'][has], r['y'][has])


def baselines(fr, prefix, hours, k, has):
    ok, y, w, z = labels(fr.meta, prefix, k, hours)
    yy = y[has]
    major = max(yy.mean(), 1 - yy.mean())
    d = fr.parts['rules'][:, ASSETS.index(k) * 2]  # the rulebook's direction for this asset
    m = has & (d != 0)
    rules = float(np.mean((d[m] > 0) == (y[m] == 1))) if m.sum() >= 30 else None
    return round(float(major), 4), (round(rules, 4) if rules is not None else None), int(m.sum())


def main():
    meta = pd.read_pickle(os.path.join(DATA, 'meta.pkl.gz'))
    feats = np.load(os.path.join(DATA, 'feats.npz'))
    order = np.argsort(meta.ts.values, kind='stable')
    meta = meta.iloc[order].reset_index(drop=True)
    feats = {k: feats[k][order] for k in feats.files}
    hourly = meta[[f'r4_{k}' for k in ASSETS]].notna().any(axis=1).values
    daily = meta[[f'rD_{k}' for k in ASSETS]].notna().any(axis=1).values
    if daily.sum() > MAX_DAILY_ROWS:
        idx = np.where(daily)[0][-MAX_DAILY_ROWS:]
        daily = np.zeros(len(meta), bool)
        daily[idx] = True
    log(f'{len(meta)} headlines: {hourly.sum()} for the hourly models, {daily.sum()} for the 1-day model')

    report = {'trained': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), 'headlines': int(len(meta)), 'horizons': {}}
    bundle = {'version': report['trained'], 'rating_steps': RATING_STEPS, 'horizons': {}}
    frames = {'hourly': Frame(meta, feats, hourly, 'hourly'), 'daily': Frame(meta, feats, daily, 'daily')}
    selected = {}
    for fk, fr in frames.items():
        prefix, hours = ('r4', 4) if fk == 'hourly' else ('rD', 24)
        log(f'Choosing inputs for the {fk} models...')
        selected[fk], steps = choose_groups(fr, prefix, hours)
        report[f'{fk}_inputs'] = {'kept': selected[fk], 'steps': steps}

    for h, (prefix, hours) in HORIZONS.items():
        fk = 'daily' if h == '1d' else 'hourly'
        fr, groups = frames[fk], selected[fk]
        log(f'{h}: choosing the model type...')
        chosen = choose_model(fr, groups, prefix, hours)
        X, emb = fr.X(groups)
        hb, hr = {}, {}
        for k, ((kind, C), r) in chosen.items():
            iso, by = calibrate(r)
            ok, y, w, z = labels(fr.meta, prefix, k, hours)
            final = fit_w(make_model(kind, C or 1.0, emb), X[ok], y[ok], w[ok] * fr.extra[ok])
            major, rules, n_rules = baselines(fr, prefix, hours, k, r['has'])
            hb[k] = {'m': final, 'iso': iso}
            hr[k] = {'model': kind if C is None else f'{kind} C={C}', 'test_accuracy': round(r['acc'], 4), 'test_logloss': round(r['ll'], 5),
                     'test_count': int(r['has'].sum()), 'baseline_majority': major, 'baseline_rules': rules, 'rules_count': n_rules, 'by_rating': by}
            log(f'  {h} {k}: tested accuracy {r["acc"]:.4f} (always-the-same-direction {major}, old rules {rules}), by rating {by}')
        bundle['horizons'][h] = {'groups': groups, 'models': hb}
        report['horizons'][h] = hr

    # Importance: how big a move (relative to normal for that market right now) the story is likely to cause
    log('Importance model...')
    fr, groups = frames['hourly'], selected['hourly']
    X, emb = fr.X(groups)
    mags, sizes = {}, []
    for k in ASSETS:
        ok, y, w, z = labels(fr.meta, 'r4', k, 4)
        ok = np.isfinite(z)
        pre = ColumnTransformer([(f'e{i}', PCA(n_components=EMB_PCA, random_state=0), list(range(a, b))) for i, (a, b) in enumerate(emb)], remainder='passthrough')
        reg = make_pipeline(pre, HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=150, random_state=0))
        reg.fit(X[ok], np.log1p(np.abs(z[ok])))
        mags[k] = reg
        sizes.append(np.expm1(reg.predict(X[-20000:])))
    s = np.max(np.vstack(sizes), axis=0)
    bundle['importance'] = {'groups': groups, 'models': mags, 'high': float(np.quantile(s, 0.85)), 'medium': float(np.quantile(s, 0.45))}

    # Only go live if at least as good as the model that's live now
    mean_acc = lambda rep: float(np.mean([v['test_accuracy'] for v in rep['horizons'].get('4h', {}).values()])) if rep.get('horizons') else None  # noqa: E731
    new_acc = mean_acc(report)
    old = None
    if os.path.exists(os.path.join(OUT, 'report.json')):
        try:
            old = json.load(open(os.path.join(OUT, 'report.json')))
        except Exception:
            old = None
    old_acc = mean_acc(old) if old and old.get('horizons') else None
    report['deploy'] = old_acc is None or new_acc >= old_acc - 0.005
    report['compared_with'] = {'previous_4h_accuracy': old_acc, 'new_4h_accuracy': round(new_acc, 4)}
    log(f'4-hour accuracy: new {new_acc:.4f}, live {old_acc}. {"Deploying." if report["deploy"] else "Keeping the live model."}')

    os.makedirs(OUT, exist_ok=True)
    if report['deploy']:
        joblib.dump(bundle, os.path.join(OUT, 'forecast.joblib'), compress=3)
    with open(os.path.join(OUT, 'report.json' if report['deploy'] else 'report_candidate.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))
    log('Done')


if __name__ == '__main__':
    main()
