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

---

### 2026-04-17 (continued)

Second session. Focus on expanding data coverage, refining the weight formula, and rebuilding the dashboard.

- **`src/scraper.ts`** — added `is_self` field to `Post` to distinguish image posts from text posts.
- **Weight formula** — text posts (`is_self = true`) penalised with `upvote_ratio * 0.5`; image posts use full `upvote_ratio`. Formula divided by 1000 for smaller output digits.
- **`src/index.ts`** — bumped fetch limit to 1000, added `r/mirrorless`, trimmed sorts to `top/hot/new`. Added a two-phase matching pipeline: phase 1 matches post title + selftext; phase 2 fetches comments for unmatched posts with `score ≥ 50` and runs the matcher on combined comment text.
- **`lenses.json`** — expanded from ~93 to ~145 lenses, adding Samyang/Rokinon, Viltrox, TTArtisan, Laowa, Zeiss (Batis + Loxia), Sony APS-C, Sigma APS-C, and various new aliases.
- **`dashboard.html`** — full rebuild with tabbed layout (Overview / Tables / Word Cloud). Overview has charts for top lenses by weight, top lenses by post count, brand share, avg weight by brand, subreddit share, and sort distribution. Tables tab has highest-weighted post per brand, highest-weighted post per lens, and full sortable stats table. Word Cloud tab renders lazily on first open. Brand doughnut fixed to use `brand` field from `lenses.json` via a parallel `fetch('lenses.json')`.
- **`README.md`** — updated to document both matching phases, score threshold, and weight formula.

---

### 2026-04-18

Focus on data coverage, resilience, naming, and sentiment planning.

- **`src/scraper.ts`** — increased retry backoff to `Retry-After + 90s base + 60s per attempt`. `fetchPosts` now catches rate limit exhaustion and returns partial results rather than throwing. Console log updated to show Retry-After value and backoff breakdown separately.
- **`src/index.ts`** — `allMatched` lifted to module scope so the `.catch` handler can call `writeOutput` with partial data on fatal error. `writeOutput` extracted as a standalone function, accepts a `partial` flag. Comment fetch failures now caught per-post with a warning — loop continues rather than crashing. Added `SENTIMENT_MIN_MENTIONS = 5` constant. Renamed `totalWeight` → `scoreSentiment` throughout. Added `matchSource` field (`"post"` | `"comments"`) and `matchedComments` to each matched post. Comment matching console logs now show per-match lens IDs and comment count. `SORTS` replaced with `RUNS` array of `{ sort, timeframe }` objects — added `top/month` and `top/week` alongside existing `top/all`, `hot/all`, `new/all`, `rising/all`, `controversial/all`.
- **`dashboard.html`** — renamed `totalWeight` → `scoreSentiment` in all charts, tables, and sort logic. Stats table gains a Comment Mentions column and a filter (Both / Post mentions only / Comment mentions only). `makeSortable` updated to accept an optional `onSort` callback to support the filtered table.
- **`Sentiment.md`** — new planning document. Covers goal, keyword lexicon (positive + negative photography terms), context windowing (±30 words), negation handling, quantification formula (`sentimentRatio`, `avgSentiment`, word counts), ambiguous word handling, output schema, dashboard display ideas, and full implementation plan. Decisions recorded: comment sentiment weighted at 0.5, `phraseSentiment` kept separate from `scoreSentiment`, min 5 mentions threshold, static word weights (weight field added to lexicon entries for future tiering), `analyzePhraseSentiment` as the export name, `matchLensesWithPositions` added to matcher, comments fetched for post-matched posts controlled by `FETCH_COMMENTS_FOR_SENTIMENT` flag.

---

### 2026-04-20

Focus on fixing a specific false-positive, tightening the weight formula, and linking the dashboard back to Reddit.

- **`src/matcher.ts`** — `buildFocalRegex` for primes now rejects a bare focal followed by `\s+\d{2,}` (e.g. `24 70`) so Sony 24mm f/2.8 G no longer matches `24-70mm` mentions where the hyphen got stripped or space-separated. `24mm` form still matches always.
- **`src/backfill-comment-lensids.ts`** — rewritten from comment-only to full re-match. Now re-runs the matcher against post title+selftext, cascades through each comment body, recomputes `postLensIds` / `commentLensIds` / `lensIds`, drops posts whose match set went empty, filters stale `sentimentMentions`, rebuilds `stats`, and regenerates `output/lens-sentiment.json` in place. No Reddit calls.
- **Weight formula** — two-stage rebalance to fix top-heavy distribution (top/p50 was ~9× before). (1) Per-post weight moved into log-space: `engagementScore = log(1 + score) × upvote_ratio` (×0.5 for self-posts), `discussionScore = log(1 + num_comments)`, `weight = engagementScore × 0.5 + discussionScore × 0.5`. (2) Per-lens aggregation switched from `sum(weights)` to `mean(weights) × log(1 + count)` so breadth no longer dominates per-mention quality. Post-change distribution: top=20.32, p10=15.10, p50=10.33, top/p50=2.0×.
- **Dashboard Reddit links** — `dashboard/src/utils.ts` adds `postCommentsUrl(post)` and `commentPermalink(post, commentId)`. `LensDetailPage.tsx` and `TablesTab.tsx` now always link post titles to the Reddit comments section rather than the image URL, and comment bodies on the lens detail page link to the individual comment when the source is `"comment"`.
- **Tooltips + docs** — `LensDetailPage` stat pills (`Post Mentions`, `Comment Mentions`, `Total Mentions`, `Score Sentiment`) now carry up-to-date `info` props. `OverviewTab` `Avg Weight` pill likewise. `README.md` grows a full Weighting section documenting per-post formula, per-lens aggregation, and every `stats` property. `weightingPosts.md` rewritten as personal scratchpad with the current formula, rationale for both changes, and a longer list of future-work knobs (time decay, multi-lens dilution, subreddit normalization, trimmed mean, phrase-sentiment feedback). `Sentiment.md` updated for the new `scoreSentiment` derivation. Legacy `dashboard.html` and `src/test.ts` formulas brought into sync.

---

### 2026-04-20 (continued)

Second session that day. Documentation pass, codebase consolidation, and a batch of feature additions ahead of an overnight scraper run.

- **Docs + regen command** — `docs/ARCHITECTURE.md` (Mermaid system + sequence diagrams, 8 consolidation opportunities), `docs/DATA_MODELS.md` (UML class diagrams for every JSON shape), both versioned at 1.0.0. `.claude/commands/regenerate-docs.md` — slash command that re-surveys the codebase and bumps version on regen.
- **`shared/types.ts`** — new single source of truth for 18 types (Lens, Post, RedditPost, LensStat, VideoSentiment, ClaudeSentimentResult, etc.). Replaces duplicate definitions scattered across `src/` and `dashboard/src/types.ts` (which now just re-exports from shared). `tsconfig.json` and `dashboard/tsconfig.json` updated to include `../shared`; Vite `server.fs.allow` extended to reach the shared folder. Closed a data gap where the dashboard's Lens type was missing `bh?`.
- **Consolidation passes** — `src/scraper.ts` stripped ~19 lines of dead jumping-jack animation code; cabinet animation kept. `dashboard/src/hooks/useDashboardData.ts` refactored with generic `fetchJson<T>` + `fetchLensesMap<T>` helpers instead of five hand-rolled fetch+fallback blocks. `src/matcher.ts` grew `matchPost(post)` and `matchPostWithPositions(post)` helpers taking `PostLike = { title; selftext? }`, replacing the `title + " " + (selftext ?? "")` boilerplate duplicated across 6 call sites (index.ts, sentiment-rerun.ts, backfill-comment-lensids.ts, test.ts, and 3 sites in alias.ts).
- **`src/youtube-sentiment.ts`** — richer link metadata. `searchVideos` now returns `title`, `channelTitle`, `viewCount` (all already in the API response — just weren't persisted). The video map threads them end-to-end and `VideoSentiment` in `shared/types.ts` gained matching optional fields. `LensDetailPage` now renders video title as the link text with channel · viewCount on a subtitle line, falling back to `reviewer ?? videoId` for legacy manual entries.
- **Gallery card on per-lens page** — `shared/types.ts` adds `PostImage` type and `RedditPost.images?: PostImage[]`. `src/scraper.ts` grows `extractImages()` that walks `media_metadata` + `gallery_data` for gallery posts, falls back to `preview.images[0].source` for single-image posts, and to the `url` field for direct image links. HTML-entity-decodes Reddit's signed preview URLs. `LensDetailPage.tsx` adds a Gallery section between retailers and Claude sentiment — up to 30 tiles sorted by post weight, responsive 160px-min grid, lazy-loaded, `referrerPolicy="no-referrer"` for cross-origin safety. Includes a fallback for pre-rescrape data that reads image extensions from `post.url`.
- **Sonnet upgrade + broader coverage** — `src/claude-sentiment.ts` and `src/youtube-sentiment.ts` both switched from `claude-haiku-4-5` to `claude-sonnet-4-6`. Roughly 3× the per-token cost, estimated ~$5–6 per full run (vs ~$2) — worth it for better nuance on hedged statements. YouTube selection changed from `TOP_LENSES_COUNT = 10` (flat) to `TOP_LENSES_PER_BRAND = 15`, covering ~70 lenses across 8 brands (Sony 54→15, Sigma 27→15, Tamron 19→15, everything else takes all). Reddit sentiment scope unchanged — still runs against every lens with mentions.
- **Claude Score column** — `dashboard/src/tabs/TablesTab.tsx` gains a Claude Score column in the three lens-row tables: "Highest-Weighted Post per Brand", "All Lenses — Stats", "Highest-Weighted Post per Lens". Shared `claudeCell()` helper renders `+0.42` / `—` with matching styling to the BrandDetailPage cell that already existed.
- **`TODO.md`** — new file. Timestamp-quotes-in-YouTube-reviews plan parked for later: walk `fetchTranscript` segments to build an offset→index map, substring-match Claude's verbatim quotes back to segments, persist `t` alongside each quote, render `&t=NNs` links in `LensDetailPage`.
