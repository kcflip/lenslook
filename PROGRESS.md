# Lenslook — Progress

Sentiment + popularity tracker for Sony-ecosystem lenses and bodies. Pulls from Reddit (posts + comments), Amazon, B&H, Adorama, Phillip Reeve, and YouTube reviews. React dashboard reads JSON in `output/`.

## Current state (2026-04-29)

- **Reddit pipeline** — listing scrape on `r/sonyalpha`, search-restricted scrape on `r/photography`, `r/astrophotography`, `r/macro`. Multi-sort/timeframe runs, search-query fan-out (`sony` + `sony <brand>` pair queries). Comments fetched for every post above the score threshold; same-user same-lens repeats collapsed. Lenses + bodies matched in one pass.
- **Sentiment** — three layers, never combined: (1) phrase-lexicon `phraseSentiment` per lens/body, (2) Claude-summarized `claude-sentiment.json` with verbatim-quote citations and a `verifyCitations` pass that drops anything not in the source text, (3) per-video `youtube-sentiment.json`.
- **Retailer scrapers** — Amazon, B&H, Adorama, Phillip Reeve. All Playwright (Adorama needs persistent profile + injected `_px3` cookies for PerimeterX). Each scraper accepts `--bodies` to flip from `lenses.json` to `bodies.json`. Reviews land in `output/reviews.json`, prices append to `output/price-history.json`.
- **Bodies** — full Sony E-mount FF + APS-C lineup back to 2013 in `bodies.json`. All scrapers and the sentiment pipelines understand them. Body-specific Claude prompt (autofocus, EVF, IBIS, rolling shutter…). Dashboard has a Bodies tab + `BodyDetailPage`.
- **Dashboard** — v1 Overview/Bodies/lens-detail and a v2 "Spectrum" view (`dashboard/src/spectrum/`). System switcher exists; only Sony is live (Nikon button disabled).

## Open work

- **YouTube quote timestamps** (`TODO.md`). Resolve verbatim quotes back to transcript segments and link to `&t=NNs`.
- **`callClaudeJson` helper** (`TODO.md`). De-duplicate the Anthropic call + JSON-extract pattern across `claude-sentiment`, `youtube-sentiment`, `audit-lexicon`.
- **`src/scrapers/` reorg** (`TODO.md`). Empty dir kept on purpose — move retailer scrapers into it next.
- **`Lens.discontinued`** (`TODO.md`). Field exists, nothing reads it. Decide.
- **Bidirectional lens↔body co-occurrence linking** on detail pages (`Phase 8` of the body rollout — deferred, not blocking).
- **Phillip Reeve auto-discovery** for review URLs (today the URLs are hand-curated under `lens.reviews.phillipreeve`).
- **Multi-system support** — `system` is a first-class field on `Lens`/`Body` and the dashboard switches on it, but only Sony has data. Output filenames already use a `<system>Results.json` shape, so adding Nikon is mostly catalog work.

## Open questions worth keeping (from the original Sentiment.md)

- Should the lexicon stay fixed forever, or should `audit-lexicon` propose additions automatically? Today it just prints suggestions.
- "Which lens should I buy?" comparison posts disproportionately mention many lenses with neutral context. Multi-lens dilution (`weight / sqrt(lensIds.length)`) is a candidate fix — see `weightingPosts.md`.
- Time decay on `weight` — discussed in `weightingPosts.md`, not implemented. Re-running the pipeline retroactively changes old weights, which makes diffs noisy.

---

## Recent journal

### 2026-04-29 — doc + code consolidation

Sweep pass before adding new features.
- **Docs**: rewrote `CLAUDE.md` for current pipeline (was stuck circa 04-16). Shrank `PROGRESS.md` from 168-line dev journal to a structured context doc. Removed obsolete `example.md`, `Sentiment.md`, `04-27-cameraBodyFeature.md` (all shipped or stale).
- **Refactor**: `shared/weight.ts` is now the single source of the per-post weight formula — pulled out of 5 places (`src/index.ts`, `src/test.ts`, `src/backfill-comment-lensids.ts`, `dashboard/src/utils.ts`, formerly `src/sentiment-rerun.ts`). `src/index.ts` and `src/test.ts` reuse `ALL_LENSES` from the matcher instead of re-reading `lenses.json`. `src/test.ts` now matches bodies too (was lens-only since the body feature shipped).
- **Cleanup**: dropped the broken `npm test` script (referenced deleted `src/alias.test.ts`). Fixed `.gitignore` (was using `//` comments which gitignore doesn't support; added `dist-dashboard/` and `backups/`). Moved older `lenses.json.bak*` into `backups/`, deleted three stale `output/results.json.*.bak` snapshots from the 04-20 weight-formula change.
- **Dashboard**: Nikon system-switch button is now disabled with a tooltip until a Nikon catalog exists.
- **Sentiment internals**: documented why `analyzePhraseSentiment` accepts both `"comment"` and `"reddit_comment"`.
- **Docs regenerated**: `docs/ARCHITECTURE.md` and `docs/DATA_MODELS.md` bumped to v1.1.0 reflecting bodies, retailers, technical reviews, price history.

### 2026-04-28 — Spectrum dashboard scaffold

Built the v2 dashboard view in `dashboard/src/spectrum/`. New layout language: brand-pulse cards, KPI tiles, sortable lens table with row drawer, sparklines, claude-pill, heat legend. Toggleable from the existing v1 dashboard via the view switcher. Lens-of-the-day picker in `spectrum/utils/lensOfTheDay.ts`.

### 2026-04-27 — Camera body feature shipped

Followed the phased plan in the (now-deleted) `04-27-cameraBodyFeature.md`. `bodies.json` seeded with full Sony E-mount FF + APS-C lineup from 2013. `--bodies` flag on every retail scraper. Reddit matcher generalized via `Matchable` + `compileBodies`. `BODY_SYSTEM_PROMPT` for Claude (autofocus tracking, EVF, IBIS, rolling shutter, codec, battery, etc.). Dashboard `BodiesTab` + `BodyDetailPage` mirror the lens equivalents. Phase 8 (bi-directional lens↔body links) deferred.

### 2026-04-24 — Adorama / PerimeterX

Adorama's `/l/` SPA is guarded by PerimeterX (HUMAN Security). Real Chrome binary, `puppeteer-extra-plugin-stealth`, persistent profile, injected cookies from a real authenticated session (`adorama-cookies.json`), organic Google/DDG search referer, cached product URLs, randomized delays + human scroll, captcha-streak detection that prompts for cookie refresh and rewinds to the streak start. The trust score is carried in the `_px3` cookie — exporting it from a real session laundering it into Playwright is what makes Adorama navigable.

### 2026-04-22 — Multi-system data model

`system: string` added to `Lens`. `tags: string[]` renamed `category: string[]`; compound system-encoded values (`"Sony FE Full-Frame Primes"` etc.) flattened to pure category tokens (`prime`, `zoom`, `ultra-wide`, `aps-c`, …). All 146 lenses migrated. Dashboard updated. Decision: keep Sony as one system regardless of FE vs E mount; APS-C is a category tag, not a separate system.

### 2026-04-21 — Retailer hardening + claude citations

B&H rating pivot from per-card review scrape to header summary (`avgRating` + `ratingCount` only — review UI was too inconsistent). Amazon scraper split into discover + refresh phases (always navigate `/dp/{asin}` after first ASIN found, re-scrape price + rating + official badge). `titleMatches` switched from substring junk-list to word-boundary regex (the bare `"filter"` reject was killing `"58mm filter thread"` lens-spec titles). Claude `positives`/`negatives` now `SentimentCitation[]` with `{aspect, quote, source}`; `verifyCitations` drops any quote not in the source text. Retailer image normalization unwraps Amazon size suffixes and B&H `/cdn-cgi/image/...` Cloudflare wrappers.

### 2026-04-20 — Weight rebalance + shared types

Per-post weight moved into log-space (`log(1 + score) * upvote_ratio` etc.); per-lens aggregation switched from `sum(weights)` to `mean(weights) * log(1 + count)`. Top/p50 ratio dropped from ~9× to ~2×. `shared/types.ts` introduced as single source of truth (replaces duplicate `Lens` interfaces in 4 files). `LensDetailPage` gained Reddit-comments links, gallery section, and richer YouTube link metadata.

---

Earlier history (kickoff, Reddit pipeline, comment matching, alias discovery, lexicon design) is in git log; trimmed from this doc 2026-04-29.
