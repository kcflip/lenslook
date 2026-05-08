# Lenslook — Progress

Sentiment + popularity tracker for Sony-ecosystem lenses and bodies. Pulls from Reddit (posts + comments), Amazon, B&H, Adorama, Phillip Reeve, and YouTube reviews. React dashboard reads JSON in `output/`.

## Current state (2026-05-07)

- **Reddit pipeline** — listing scrape on `r/sonyalpha`, search-restricted scrape on `r/photography`, `r/astrophotography`, `r/macro`. Multi-sort/timeframe runs, search-query fan-out. Comments fetched per post above score threshold. Lenses + bodies matched in one pass.
- **Sentiment** — three independent layers: (1) phrase-lexicon `phraseSentiment`, (2) Claude-summarized `claude-sentiment.json` with verbatim-quote citations and `verifyCitations` post-processor, (3) per-video `youtube-sentiment.json` with transcript-aligned timestamps and YouTube deeplinks.
- **Retailer scrapers** — Amazon, B&H, Adorama, Phillip Reeve. All Playwright with stealth + persistent profiles in `profiles/`. Adorama requires injected `_px3` cookies from a real session. Each scraper accepts `--bodies`. Reviews → `output/reviews.json`, prices → `output/price-history.json`. Star ratings surface on citation cards in the dashboard.
- **Bodies** — full Sony E-mount FF + APS-C lineup in `bodies.json`. All scrapers and sentiment pipelines handle them. Body-specific Claude prompt (AF, EVF, IBIS, rolling shutter…).
- **Dashboard** — dark theme React app in `dashboard/src/spectrum/`. Routes: Overview, Bodies list, Lens detail, Body detail, Brand detail. `useDashboardData` parallel-fetches all output files. System switcher present; only Sony is live.

## Open work

- **YouTube quote timestamps** (`TODO.md`) — resolve verbatim quotes to transcript segments, link to `&t=NNs`.
- **`callClaudeJson` helper** (`TODO.md`) — de-duplicate Anthropic call + JSON-extract across `claude-sentiment`, `youtube-sentiment`, `audit-lexicon`.
- **`Lens.discontinued`** (`TODO.md`) — field exists, nothing reads it; wire up or remove.
- **Phillip Reeve auto-discovery** — review URLs are hand-curated; auto-discovery deferred.
- **Multi-system support** — Nikon button disabled; only Sony has data. Output filename shape already supports it.
- **Bidirectional lens↔body co-occurrence** on detail pages — deferred from the original body rollout.

## Open questions

- Should the lexicon stay fixed, or should `audit-lexicon` propose additions automatically?
- Multi-lens dilution (`weight / sqrt(lensIds.length)`) for "which lens should I buy?" comparison posts — see `weightingPosts.md`.
- Time decay on `weight` — discussed in `weightingPosts.md`, not implemented.

---

## Recent journal

### 2026-05-07 — codebase cleanup

- **Deleted**: `output/screenshots/` (1,073 PNGs from scraper debugging), `output/raw_post.json`, `output/test.json`, `backups/`, `.browser-profile/` (unsuffixed, not used).
- **Browser profiles reorganized**: `.browser-profile-{amazon,adorama,bh}` → `profiles/{amazon,adorama,bh}`. All scraper `profileDir` references updated. `.gitignore` updated.
- **Rate limiting centralized**: `EDITORIAL_DELAY_MS` + `editorialDelay()` added to `scraper-shared.ts`. `phillipreeve-scrape.ts` now imports from there instead of defining its own constants.
- **Documentation**: PROGRESS.md rewritten to reflect shipped state. `TODO.md` "Reorganize src/scrapers/" removed (done). CLAUDE.md path references updated (`src/test.ts` → `src/tests/test.ts`).

### 2026-05-07 — Amazon widget reviews + star ratings

- **Amazon scraper simplified**: abandoned `/product-reviews/` navigation (hit sign-in wall consistently); `scrapeReviews()` now widget-only — 8–13 reviews per lens from the embedded widget on the product page. Persistent profile + stealth args kept for future use.
- **Star ratings on citations**: `LensDetailPage` and `BodyDetailPage` now match each Claude citation quote back to its source `ReviewItem` and display a `★` rating badge.
- **lenses.json**: cleared bad Sigma 14mm Amazon ASIN (was resolving to a Tamron 90mm product page); search link kept.

### 2026-04-30 — LensDetailPageV2 + scraper fixes

- **LensDetailPageV2** — hero card, focal/aperture/price stat block, spec pills, horizontal-scroll gallery with source filter chips and scroll arrows, two-column body (Claude Sentiment, YouTube, Retailers, Specs, Community Metrics, Posts, Comments, More from Brand).
- **`TechnicalReviewsData` wired** — fetched in `useDashboardData`, rendered per-source with author, date, verdict, and link.
- **B&H gallery fix** — `bh.images` are review sidebar photos; `bh.productImage` now shown in Product Images panel.
- **Amazon review body fix** — added `reviewRichContentContainer` fallback selector; price/rating scraper switched from sequential `isVisible` per selector to combined-selector `count()`.
- **YouTube sentiment** — search query appends system name for third-party brands. `durationSeconds` threaded from API through `VideoEntry` into `VideoSentiment`. Inclusion changed from top-15-per-brand to all lenses with >15 post mentions.

### 2026-04-30 — sentiment pipeline + date surfacing

- **Claude sentiment**: switched to Haiku, added Adorama reviews, split Reddit cap into per-post (30) and per-comment (60) limits.
- **YouTube timestamps**: 15s markers injected into transcripts; Claude returns `{ quote, timestampSeconds }`; quotes link to `&t=NNs` on the dashboard.
- **Dates**: `created_utc` added to `Comment`/`MatchedComment`; `publishedAt` added to `VideoSentiment`; posts/comments tables and YouTube cards now show dates.

### 2026-04-30 — body pipeline fixes + scraper hardening

- **Brand pollution fix** — body IDs were bleeding into lens brand-pulse section; split into separate `postLensIds`/`postBodyIds` arrays.
- **Unified CLI flags** — all scrapers accept `--lenses`, `--bodies`, or no args (runs both sequentially).
- **`LensSpecs` type** added; Phillip Reeve scraper parses spec tables and writes back to `lenses.json`.
- **Phillip Reeve scraper overhauled** — correct WordPress selectors, sample-image scoping, spec table parser.
- **Body stats in sentiment** — `src/index.ts` emits `bodyStats[]` alongside `stats[]`.

### 2026-04-29 — doc + code consolidation

- `shared/weight.ts` extracted as single source of per-post weight formula.
- Stale docs removed. `.gitignore` fixed. `backups/` created for old `lenses.json.bak*`.
- Nikon system-switch button disabled until a Nikon catalog exists.

### 2026-04-28 — Spectrum dashboard scaffold

Built `dashboard/src/spectrum/` design system: `tokens.ts`, `BrandMark.tsx`, `ClaudePill.tsx`, `Fold.tsx`. Dark theme applied across all pages.

### 2026-04-27 — Camera body feature shipped

`bodies.json` seeded with full Sony E-mount lineup. `--bodies` flag on every retail scraper. Reddit matcher generalized. `BODY_SYSTEM_PROMPT` for Claude. Dashboard `BodiesTab` + `BodyDetailPage`.

### 2026-04-24 — Adorama / PerimeterX

Real Chrome binary, stealth plugin, persistent profile, injected `_px3` cookies, organic referrer, randomized delays + human scroll, captcha-streak detection.

### 2026-04-22 — Multi-system data model

`system: string` on `Lens`. `tags` renamed `category[]`; compound values flattened to pure tokens. All 146 lenses migrated.

### 2026-04-21 — Retailer hardening + Claude citations

B&H rating pivot to header summary. Amazon discover + refresh phases. `titleMatches` word-boundary regex. `SentimentCitation[]` with `verifyCitations`.

### 2026-04-20 — Weight rebalance + shared types

Per-post weight log-space; aggregation `mean(weights) * log(1 + count)`. `shared/types.ts` introduced.

---

Earlier history is in git log.
