# Lenslook

Looking at how people talk about Sony lenses and camera bodies on Reddit, Amazon, B&H, Adorama, Phillip Reeve, and YouTube.

## Getting started

```bash
npm install
npx playwright install chromium
```

You'll need a `lenses.json` and `bodies.json` at the project root, and a `.env` with `ANTHROPIC_API_KEY` if you want to run any Claude script. YouTube sentiment also needs `YOUTUBE_API_KEY`.

## Commands

### Reddit pipeline

| Command | What it does |
|---|---|
| `npm start` | Pulls posts and comments from Reddit, matches them to lenses and bodies, writes `output/sonyResults.json` and `output/lens-sentiment.json`. |
| `npm run sentiment` | Re-derives `output/lens-sentiment.json` from `sonyResults.json` and `reviews.json`. Doesn't hit the network. |
| `npx tsx src/test.ts` | Small smoke run with per-post weight breakdown → `output/test.json`. |

### Sentiment

| Command | What it does |
|---|---|
| `npm run claude-sentiment` | Asks Claude (Sonnet 4.6) to score lens mentions across Reddit + retailer reviews with verbatim citations. Writes `output/claude-sentiment.json`. |
| `npm run claude-sentiment -- --bodies` | Same, for camera bodies. |
| `npm run youtube-sentiment` | Searches YouTube for top reviews per lens, fetches transcripts, runs them through Claude. Writes `output/youtube-sentiment.json`. |
| `npm run sentiment:all` | Claude + YouTube back-to-back. |
| `npm run audit-lexicon` | Asks Claude what sentiment vocabulary the phrase-lexicon is missing, against a sample of real text. Writes `output/lexicon-audit-{lenses,bodies}.json`. |

### Retailer scrapers

Each one fills retailer info on `lenses.json` (or `bodies.json` with `--bodies`), appends a point to `output/price-history.json`, and saves reviews into `output/reviews.json`. Safe to re-run — it picks up where it left off. To re-scrape a specific entry, delete its retailer field first.

| Command | What it does |
|---|---|
| `npm run amazon-scrape` | Scrapes Amazon for every lens. Add `-- --bodies` to run for bodies. |
| `npm run bh-scrape` | Same, for B&H. |
| `npm run adorama-scrape` | Same, for Adorama. Needs a fresh `adorama-cookies.json` exported from a real Chrome session — the scraper will pause and prompt when the trust cookie expires. |
| `npm run phillipreeve-scrape` | Scrapes Phillip Reeve's editorial reviews. URLs are hand-curated under each lens's `reviews.phillipreeve` field. |

`*-scrape:test` variants exist for each retailer — they run a one-lens-per-brand smoke test and write to `output/scrape-test-<retailer>.json` without touching real data.

### Dashboard

| Command | What it does |
|---|---|
| `npm run dashboard` | Vite dev server for the React dashboard in `dashboard/`. Loads everything in `output/` plus `lenses.json` and `bodies.json` directly from disk. |

The dashboard has a system switcher (Sony / Nikon) and a view switcher (v1 / v2 "Spectrum"). Only Sony has data today — the Nikon button is disabled.

## Where things land

- `output/sonyResults.json` — Reddit aggregate (posts + per-lens stats).
- `output/lens-sentiment.json` — phrase-lexicon sentiment per lens/body.
- `output/claude-sentiment.json` — Claude opinion summaries with verbatim citations.
- `output/youtube-sentiment.json` — per-video sentiment from YouTube transcripts.
- `output/reviews.json` — Amazon, B&H, Adorama review items keyed by product ID.
- `output/price-history.json` — append-only price points per `(productId, retailer)`.
- `output/technical-reviews.json` — Phillip Reeve / DPReview / Lensrentals editorial reviews.

See `docs/ARCHITECTURE.md` and `docs/DATA_MODELS.md` for the full pipeline + schema reference, `CLAUDE.md` for working-in-this-repo guidance, `PROGRESS.md` for current state, `TODO.md` for active follow-ups.
