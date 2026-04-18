# Snowsniffer — Reddit Lens Popularity Scraper

## What We're Building

A TypeScript tool that scrapes posts from `r/sonyalpha` and `r/photography`, detects which Sony-ecosystem lens is mentioned in each post title, and tracks popularity metrics (score, upvote ratio, comment count) per lens.

---

## Journal

### 2026-04-16

Kicked off the project. Defined scope, designed the lens data structure, and built out `lenses.json` with ~93 lenses across Sony, Sigma, and Tamron. Decided to use Reddit's public JSON endpoints (no OAuth needed). Built the core pipeline:

- **`src/scraper.ts`** — `fetchPosts` (bulk, up to 500) and `fetchBatch` (single page with cursor) for paginated post fetching.
- **`src/matcher.ts`** — normalizes text (lowercase, strip punctuation) and does substring matching against each lens's name, model, and aliases. Pre-computes normalized tokens at startup.
- **`src/index.ts`** — main run: fetches posts, matches lenses, aggregates per-lens stats (post count, avg score, avg upvote ratio, total weight), writes `output/results.json`.
- **`src/test.ts`** — pagination-driven test run that stops once each subreddit hits a match target, writes matched posts with formula breakdown to `output/test.json`.

Post weighting uses an 80/20 split: `engagementScore * 0.8 + discussionScore * 0.2`.

---

### 2026-04-17

Expanded the tool to support comment fetching and alias discovery.

- **`brands.json`** — extracted unique brand names (Sony, Sigma, Tamron) to a standalone file; user extended it with TTArtisan, Laowa, Viltrox, Zeiss, Samyang for broader third-party coverage.
- **`src/scraper.ts`** — added `fetchComments(subreddit, postId)` which hits Reddit's comments endpoint and recursively walks the reply tree, returning a flat array of comment objects (id, body, score, parent_id). Added `redditFetch` wrapper with 429 retry logic — reads the `Retry-After` header, logs a wait message, and retries up to 5 times.
- **`src/alias.ts`** — new standalone script (`npx tsx src/alias.ts`) that scans comments on lens-matched posts for unknown lens references. Per-comment flow: skip if already matches a known lens, then try brand name → combined focal+aperture patterns → focal range → single focal → aperture alone (first match wins). Writes candidates to `output/aliases.json` with full context for manual review.
