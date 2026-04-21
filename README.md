# Lenslook
Investigating the popularity of sony lenses on reddit.

## Setup
```bash
npm install
```

Expects an `.env` file at the project root with `ANTHROPIC_API_KEY=...` for the Claude sentiment script.

## Scripts

### Pipeline

| Command | What it does |
|---|---|
| `npm start` | Main pipeline. Fetches posts from Reddit, runs the matcher against titles/selftexts, then fetches comments for unmatched posts and re-runs the matcher. Writes `output/results.json`. |
| `npm run sentiment` | Re-derives the lexicon-based sentiment stats (`output/lens-sentiment.json`) from existing `results.json` — no Reddit calls. Run after tweaking `sentiment.ts` or the word lists. |
| `npm run claude-sentiment` | Batches matched mentions to the Claude API for qualitative sentiment analysis. Writes `output/claude-sentiment.json`. Requires `ANTHROPIC_API_KEY`. |
| `npm run amazon-scrape` | Playwright-driven ASIN + price scraper. For every lens in `lenses.json` with a `shoppingLink`, collects up to 5 non-sponsored matching results, visits each product page, and persists `asins[]` back into `lenses.json`. |

### Dashboard

| Command | What it does |
|---|---|
| `npm run dashboard` | Starts the Vite dev server for the React dashboard in `dashboard/`. Hot reloads on edit. |
| `npm run dashboard:static` | Serves the repo root over HTTP at port 3000. Used to open the legacy `dashboard.html` that reads `output/results.json` via `fetch()`. |

After running the static server, open `http://localhost:3000/dashboard.html`.

### One-off utilities

These don't have `npm` aliases — run them directly with `tsx` when needed.

| Command | What it does |
|---|---|
| `npx tsx src/backfill-comment-lensids.ts` | Back-fills per-comment `lensIds` on every `matchedComments[]` entry in `output/results.json` by re-running the matcher over existing comment bodies. No Reddit calls. Run this after pulling the per-comment-attribution change to upgrade old output in place. |
| `npx tsx src/test.ts` | Match-driven test pagination — paginates until each subreddit hits its target match count. Writes `output/test.json`. Faster than `npm start` for iterating on the matcher. |
| `npx tsx src/debug-context.ts <lensId> <keyword>` | Prints every occurrence of `<keyword>` within the sentiment window around `<lensId>` mentions in `output/results.json`. Useful for debugging sentiment-window scoping. Defaults: `tamron-20-2.8-macro` / `expensive`. |
| `npm test` | Runs the alias unit tests (`src/alias.test.ts`) via the Node test runner. |

## Dashboard

The dashboard reads from `output/results.json`, `output/lens-sentiment.json`, and `output/claude-sentiment.json`, and must be served over HTTP (not opened as a file) due to `fetch()` calls.

```bash
npm run dashboard        # Vite dev server (React app)
# or
npm run dashboard:static # static serve, legacy dashboard.html
```

## Reddit Posts
Posts are fetched from Reddit's public JSON endpoints across 2 subreddits (`sonyalpha`, `photography`), 5 sort types (`top`, `hot`, `new`, `rising`, `controversial`), up to 1000 posts each — ~10,000 posts before deduplication.

Matching runs in two phases:

1. **Post matching** — runs the lens matcher against each post's title and selftext.
2. **Comment matching** — for unmatched posts with `score ≥ 50`, fetches all comments and runs the matcher against the combined comment text. This catches posts where the lens is only mentioned in the discussion (e.g. image posts with no body text).

## Weighting

Each matched post is assigned a `weight` that combines two log-compressed signals 50/50:

```
engagementScore = log(1 + score) * upvote_ratio         // image posts (is_self = false)
engagementScore = log(1 + score) * upvote_ratio * 0.5   // text posts (is_self = true)
discussionScore = log(1 + num_comments)
weight = engagementScore * 0.5 + discussionScore * 0.5
```

Both terms live in log-space so a post with 10,000 upvotes doesn't swallow ten posts with 800 upvotes. The upvote ratio is halved for self-posts because text discussions draw fewer upvotes than image posts but carry at least as much intent — halving the ratio keeps the two post types comparable.

Per-lens stats aggregate across matched posts with:

```
scoreSentiment = mean(weights) * log(1 + count)
```

`mean` keeps each lens's typical post quality from drowning in volume, and `log(1 + count)` rewards breadth softly — doubling match count adds roughly `log(2) ≈ 0.69` rather than doubling the score. Sorting `results.json` by `scoreSentiment` therefore favors lenses that attract *consistently strong* posts, not just many of them.

### Per-lens stat properties

Each entry in `results.json#stats` carries:

| Property | Meaning |
|---|---|
| `lensId` | FK into `lenses.json`. |
| `postCount` | Posts whose title or selftext matched the lens. |
| `commentCount` | Posts where the lens appeared **only** in comments (disjoint from `postCount` — a post matched in both counts once as a post match). |
| `avgScore` | Rounded mean Reddit score across all matched posts. |
| `avgUpvoteRatio` | Mean `upvote_ratio` across matched posts (0–1). |
| `avgComments` | Rounded mean `num_comments` across matched posts. |
| `scoreSentiment` | `mean(weights) * log(1 + count)`. Primary ranking signal. |
| `phraseSentiment` | Lexicon-based positive/negative word stats, or `null` when no hits. See `src/sentiment.ts`. |

### Per-post formula breakdown

`output/test.json` exposes the intermediate values per post (`formula.engagementScore`, `formula.discussionScore`, `formula.weight`) so you can inspect how each signal contributed before aggregation.

