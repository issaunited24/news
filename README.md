# Briefly

A free personal news app: world & Middle East, forex, tech & AI, and business, filtered so only the important stories show.

- **App:** https://issaunited24.github.io/news/
- **News sources:** `feeds.json` (add or remove outlets and keywords there)
- **How it updates:** a free GitHub robot (`.github/workflows/collect.yml`) runs `scripts/collect.mjs` about every 10 minutes and saves the results to `data/news.json`.
- **Ranking and forex ratings:** `scripts/rules.mjs`. Plain rules, no AI, no paid services.

Forex ratings are a quick guide based on simple rules and calendar data. They are not financial advice.
