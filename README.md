# Briefly

A free personal news app: Top, Just in, World, U.S., Forex (gold, Nasdaq, US dollar, oil), Tech & AI, Science, Entertainment and Sports, ranked so the important stories show first.

- **App:** https://issaunited24.github.io/news/
- **News sources:** `feeds.json` (add or remove outlets and keywords there)
- **News robot:** `.github/workflows/collect.yml` runs `scripts/collect.mjs` every ~3.5 minutes and publishes `news.json`, `older.json`, `charts.json` and `state.json` to the `live` branch (the app reads them from there).
- **Grouping and ranking:** `scripts/rules.mjs` (duplicates are also matched by meaning with `scripts/ml/similar.py`), sections in `scripts/categories.mjs`, the feed order in `index.html` (between `FEEDRANK START` and `FEEDRANK END`).
- **Forex calls (next 24 hours):**
  - AI analyst: `.github/workflows/analyst.yml` runs five workers with a free open model (Qwen2.5 14B) that reason through each market story (`scripts/analyst.mjs`, `scripts/analyst-run.mjs`) and publish to the `ai-0` … `ai-4` branches.
  - Trained model: `scripts/ml/` (trained weekly by `.github/workflows/train.yml`, published as the `model` release; used only for markets where it passes its tests).
  - The robot blends the AI, the trained model (35%) and the rules (10%), scaled by credibility. The AI's weight per market comes from its backtest (55% until there's enough evidence). Every call is checked against prices in the scorecard.
  - AI backtest: `.github/workflows/backtest.yml` runs the same AI on ~4,000 headlines from 2025 onward (after the AI model's knowledge ends) with the market picture of that moment (`scripts/ml/bt_prep.py`, `scripts/backtest-run.mjs`); results on branches `bt-0` … `bt-9`.
  - Trained model time frames: next day, next 3 days and next week (each market used only where it passes its tests).
- **Backup of the last working version before big changes:** branch `backup-2026-10-26`.

Forex calls are a guide, not financial advice. Confidence is a rating, not a probability.
