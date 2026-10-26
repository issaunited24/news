"""Turns a news story into numbers the forecast model can learn from. Shared by training and the live robot.

For each story:
- FinBERT (a language model trained on financial news) reads it and scores the tone: positive, negative or neutral.
- A sentence-embedding model (MiniLM) turns its meaning into 384 numbers, so stories about similar things
  land close together and the model can learn what kinds of news move each market.
- The forex rulebook (scripts/markets.mjs) adds its call and confidence for each asset and the type of news.
- Market mood when the story came out: each market's trend and volatility, the VIX fear index, the 10-year
  Treasury yield and which trading session is open (see market_data.py).
"""
import json, os, subprocess, sys

import numpy as np

from market_data import ASSETS, CONTEXT_KEYS

DRIVERS = ['none', 'war', 'peace', 'fed', 'earnings', 'trade', 'politics', 'oil', 'banking', 'sanctions', 'bigtech',
           'ai', 'yields', 'cb', 'china', 'preview', 'wrap']
FINBERT = 'ProsusAI/finbert'
EMBED = 'sentence-transformers/all-MiniLM-L6-v2'
HERE = os.path.dirname(os.path.abspath(__file__))

_models = {}


def _finbert():
    if 'fb' not in _models:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        tok = AutoTokenizer.from_pretrained(FINBERT)
        mdl = AutoModelForSequenceClassification.from_pretrained(FINBERT).eval()
        _models['fb'] = (tok, mdl)
    return _models['fb']


def _embedder():
    if 'emb' not in _models:
        from sentence_transformers import SentenceTransformer
        _models['emb'] = SentenceTransformer(EMBED, device='cpu')
    return _models['emb']


def finbert_scores(texts, batch=64):
    """[positive, negative, neutral] probabilities per text."""
    import torch
    tok, mdl = _finbert()
    labels = [mdl.config.id2label[i].lower() for i in range(mdl.config.num_labels)]
    order = [labels.index('positive'), labels.index('negative'), labels.index('neutral')]
    out = []
    with torch.no_grad():
        for i in range(0, len(texts), batch):
            enc = tok(texts[i:i + batch], padding=True, truncation=True, max_length=96, return_tensors='pt')
            p = torch.softmax(mdl(**enc).logits, dim=-1).numpy()
            out.append(p[:, order])
            if len(texts) > 2000 and (i // batch) % 50 == 0:
                print(f'    FinBERT {i}/{len(texts)}', flush=True, file=sys.stderr)
    return np.vstack(out) if out else np.zeros((0, 3))


def embeddings(texts, batch=128):
    return _embedder().encode(texts, batch_size=batch, show_progress_bar=False, normalize_embeddings=True).astype(np.float32)


def rule_features(items):
    """Runs the forex rulebook (Node) over [{title, text}] and returns its calls."""
    res = subprocess.run(['node', os.path.join(HERE, 'rulefeat.mjs')], input=json.dumps(items), capture_output=True, text=True, timeout=600)
    if res.returncode != 0:
        raise RuntimeError(res.stderr[:500])
    return json.loads(res.stdout)


def text_of(title, text):
    text = (text or '').strip()
    return f'{title}. {text[:400]}' if text else title


def rules_block(rules):
    """The forex rulebook's calls as numbers: direction and confidence per asset, type of news, impact (26)."""
    rows = []
    for r in rules:
        row = []
        for k in ASSETS:
            row += [r['d'][k], r['d'][k] * r['c'][k] / 9.0]
        row += [1.0 if r['driver'] == d else 0.0 for d in DRIVERS]
        row += [{'none': 0, 'low': 1, 'medium': 2, 'high': 3}.get(r['impact'], 0) / 3.0]
        rows.append(row)
    return np.asarray(rows, dtype=np.float32).reshape(len(rules), 26)


# Groups of inputs. 'base' groups are always used; optional ones are kept only if they make the model better on
# months it never saw (see train.py). Embedding groups are compressed (PCA) inside the model.
GROUPS = {
    'headline': {'parts': ['fb_t', 'em_t'], 'emb': 'em_t'},   # tone + meaning of the headline
    'rules': {'parts': ['rules']},                            # the forex rulebook's calls
    'mood': {'parts': ['mood']},                              # market mood (hourly models)
    'dmood': {'parts': ['dmood']},                            # market mood from daily prices (1-day model)
    'fresh': {'parts': ['nov']},                              # is it new?
    'source': {'parts': ['src']},                             # source quality
    'opening': {'parts': ['has_x', 'fb_x', 'em_x'], 'emb': 'em_x'},  # the article opening
    'positioning': {'parts': ['pos']},                        # hedge-fund positioning
}
PART_WIDTH = {'fb_t': 3, 'em_t': 384, 'rules': 26, 'nov': 5, 'src': 4, 'has_x': 1, 'fb_x': 3, 'em_x': 384}


def assemble(parts, groups):
    """Stacks the chosen groups into one matrix. Returns (X, [(start, end) of each embedding block])."""
    cols, emb, at = [], [], 0
    for g in groups:
        spec = GROUPS[g]
        for p in spec['parts']:
            a = np.asarray(parts[p], dtype=np.float32)
            if a.ndim == 1:
                a = a[:, None]
            if p == spec.get('emb'):
                emb.append((at, at + a.shape[1]))
            cols.append(a)
            at += a.shape[1]
    return np.nan_to_num(np.hstack(cols)), emb
