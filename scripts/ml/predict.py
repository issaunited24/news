"""Live forecasts for the robot (called by scripts/collect.mjs every round, only for new Forex stories).

stdin:  [{"id", "title", "text", "m6_gold", "m24_gold", ... for each asset}]
stdout: {"version", "preds": {id: {"assets": {asset: {"dir": "up"|"down", "conf": 1-10, "p": prob_up}},
                                  "impact": "high"|"medium"|"low", "size": expected move vs typical}}}
"""
import json, os, sys

import joblib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from features import ASSETS, featurize  # noqa: E402

MODEL = os.path.join(HERE, '..', '..', 'model', 'forecast.joblib')


def rating_of(acc, steps):
    r = 1
    for i, s in enumerate(steps):
        if acc >= s:
            r = i + 1
    return r


def main():
    items = json.loads(sys.stdin.read() or '[]')
    bundle = joblib.load(MODEL)
    out = {'version': bundle.get('version'), 'preds': {}}
    if not items:
        print(json.dumps(out))
        return
    momentum = [{k: float(it.get(k) or 0) for k in it if k.startswith('m6_') or k.startswith('m24_')} for it in items]
    X, _ = featurize([it['title'] for it in items], [it.get('text') or '' for it in items], momentum)
    steps = bundle['rating_steps']
    per = {}
    sizes = []
    for k, m in bundle['models'].items():
        p = m['dir'].predict_proba(X)[:, 1]
        acc = m['iso'].predict(np.abs(p - 0.5))
        per[k] = (p, acc)
        sizes.append(np.expm1(m['mag'].predict(X)) / 100 / m['typical'])
    size = np.max(np.vstack(sizes), axis=0)
    th = bundle['thresholds']
    for i, it in enumerate(items):
        assets = {}
        for k, (p, acc) in per.items():
            assets[k] = {'dir': 'up' if p[i] >= 0.5 else 'down', 'conf': rating_of(float(acc[i]), steps), 'p': round(float(p[i]), 3)}
        imp = 'high' if size[i] >= th['high'] else 'medium' if size[i] >= th['medium'] else 'low'
        out['preds'][it['id']] = {'assets': assets, 'impact': imp, 'size': round(float(size[i]), 2)}
    print(json.dumps(out))


if __name__ == '__main__':
    main()
