# Sentiment Analysis — Planning

## Goal

For each lens in `results.json`, derive a sentiment score based on the language used in posts and comments that mention it. The aim is to surface not just *how often* a lens is mentioned, but *how people feel* about it.

---

## Approach: Keyword Sentiment Scoring

Rather than a full NLP model, we'll use a curated lexicon of photography-specific sentiment words. Each word carries a polarity (+1 positive, -1 negative) and optionally a weight for intensity.

### Positive words

| Word | Notes |
|---|---|
| sharp | most common quality praise |
| sharpness | noun form |
| fast | aperture or AF speed |
| tack | as in "tack sharp" |
| crisp | image quality |
| stunning | general praise |
| beautiful | general praise |
| incredible | general praise |
| amazing | general praise |
| excellent | general praise |
| love | "I love this lens" |
| perfect | general praise |
| smooth | bokeh or AF |
| creamy | bokeh quality |
| silent | AF noise |
| quiet | AF noise |
| lightweight | build praise |
| compact | build praise |
| contrasty | image quality |
| render | "renders beautifully" |
| bokeh | often used positively in context |
| reliable | build/AF dependability |
| versatile | focal range praise |
| worth | "worth every penny" |
| recommend | "highly recommend" |

### Negative words

| Word | Notes |
|---|---|
| soft | unsharp (context dependent — see below) |
| blurry | image quality |
| slow | AF or aperture |
| loud | AF noise |
| heavy | build criticism |
| bulky | build criticism |
| expensive | value criticism |
| overpriced | value criticism |
| disappointing | general negative |
| bad | general negative |
| terrible | general negative |
| awful | general negative |
| hate | "I hate this lens" |
| regret | "I regret buying" |
| return | "had to return it" |
| chromatic | as in chromatic aberration |
| vignetting | optical flaw |
| distortion | optical flaw |
| flare | optical flaw (context dependent) |
| noisy | AF or image noise |
| fragile | build criticism |
| plasticky | build criticism |
| unreliable | build/AF criticism |
| hunt | as in "focus hunting" |
| hunting | AF criticism |

---

## Context Window

Don't score the entire post or comment body — extract a **context window** of N words around each lens match (e.g. ±30 words). This reduces noise from sentences that are about something else entirely.

```
"I've been using the 85GM for portraits, it's incredibly sharp and the bokeh is creamy. My 16-35 on the other hand hunts a lot in low light."
```

In the above, scoring the full comment would incorrectly associate "hunts" with the 85GM. A window of ±30 words around the 85GM match would isolate the praise correctly.

---

## Negation Handling

Simple negation: if a sentiment word is preceded within 3 words by a negation (`not`, `no`, `never`, `isn't`, `doesn't`, `wasn't`, `barely`, `hardly`), flip its polarity.

- `"not sharp"` → negative
- `"never disappointing"` → positive
- `"barely noisy"` → positive

---

## Quantification

For each lens mention (post or comment context window), compute a raw sentiment score:

```
rawScore = Σ (word_polarity × word_weight) for each matched word in window
```

Then per lens, aggregate across all mentions:

```
totalSentiment  = Σ rawScore across all mentions
avgSentiment    = totalSentiment / mentionCount
positiveCount   = number of mentions with rawScore > 0
negativeCount   = number of mentions with rawScore < 0
neutralCount    = number of mentions with rawScore = 0
sentimentRatio  = positiveCount / (positiveCount + negativeCount)   // 0–1
```

The `sentimentRatio` (0 = all negative, 1 = all positive) is the cleanest single number for display.

---

## Context Sensitivity — Ambiguous Words

Some words are ambiguous:

| Word | Positive context | Negative context |
|---|---|---|
| soft | "soft bokeh" (positive) | "soft wide open" (negative) |
| fast | "fast aperture" (positive) | rarely negative |
| flare | "beautiful flare" (positive) | "horrible flare" (negative) |
| bokeh | "smooth bokeh" (positive) | "nervous bokeh" (negative) |

For phase 1, treat these as positive and rely on negation handling to catch obvious inversions. Revisit with bigram patterns in a future iteration.

---

## Output Schema

Add a `sentiment` field to each lens's stats entry:

```json
{
  "lensId": "sony-fe-85mm-f1.4-gm",
  "postCount": 42,
  "commentCount": 7,
  "scoreSentiment": 12.4,
  "phraseSentiment": {
    "avg": 0.82,
    "ratio": 0.91,
    "positiveCount": 31,
    "negativeCount": 3,
    "neutralCount": 15,
    "topPositiveWords": ["sharp", "creamy", "smooth"],
    "topNegativeWords": ["expensive", "heavy"]
  }
}
```

`scoreSentiment` is the engagement-based weight signal (`mean(weights) × log(1 + count)`, where per-post weight combines `log(1 + score) × upvote_ratio` with `log(1 + num_comments)`). `phraseSentiment` is the keyword-based tone signal — they are always kept separate.
```

`topPositiveWords` and `topNegativeWords` are the most frequently matched sentiment words across all mentions of that lens — useful for display.

---

## Dashboard Display Ideas

### 1. Sentiment bar per lens (stats table)
Add a mini horizontal bar to the stats table — green fill for positive ratio, red for negative. Clicking expands to show top words.

### 2. Sentiment scatter plot
X axis: total weight (popularity), Y axis: sentiment ratio (positivity). Quadrants:
- Top right: popular AND loved (85GM, etc.)
- Top left: niche but beloved
- Bottom right: popular but divisive
- Bottom left: unpopular and criticised

### 3. Top words per lens — word badges
On a lens detail view, show coloured word badges: green for positive words found, red for negative. Sized by frequency.

### 4. Brand sentiment comparison
Bar chart of average `sentimentRatio` per brand — does Sony get more praise than Sigma? Tamron?

### 5. Sentiment leaderboard
A separate table sorted by `sentimentRatio` descending — the most-loved lenses regardless of popularity.

---

## Implementation Plan

1. **`src/matcher.ts`** — add `matchLensesWithPositions(text): { id: string, index: number }[]` alongside the existing `matchLenses`. Reuse the same normalisation and token logic.

2. **`src/sentiment.ts`** — exports `analyzePhraseSentiment(text: string, matchIndex: number, source: "post" | "comments"): SentimentResult`. Extracts a ±30 word context window around `matchIndex`, applies the lexicon with negation handling, applies the 0.5 comment discount, returns the score breakdown.

3. **Update `src/index.ts`** — replace `matchLenses(post.title + " " + post.selftext)` with `matchLensesWithPositions` on the same concatenated string. Pass each match's position and source field to `analyzePhraseSentiment`. Accumulate per-lens sentiment alongside stats.

4. **Fetch comments for post-matched posts** — currently comments are only fetched for *unmatched* posts (to find new lens matches). For sentiment, we also want comment bodies from posts that were already matched via title/selftext. During the main run, after a post is matched, fetch its comments and store them alongside the post (same `matchedComments` structure already used for comment-matched posts). This gives `analyzePhraseSentiment` richer context for every matched post, not just those found via comments. These fetched comments do not affect `lensIds` — they are for sentiment only.

   Note: this adds one `fetchComments` call per matched post, which will significantly increase run time. Consider adding a flag `FETCH_COMMENTS_FOR_SENTIMENT` to toggle this behaviour.

5. **Update `writeOutput`** — include the `phraseSentiment` object in each lens's stats entry.

4. **Update `dashboard.html`** — add sentiment ratio bar to the stats table, add the scatter plot chart, add a sentiment leaderboard table.

---

## Decisions

- **Comment sentiment weighted less** — sentiment extracted from comment context windows is multiplied by 0.5, consistent with how text posts are discounted in the weight formula.
- **Two separate sentiment fields** — the existing weight-based signal is `scoreSentiment` (renamed from `totalWeight`). The new keyword-based signal is `phraseSentiment`. They are never combined — `scoreSentiment` reflects engagement, `phraseSentiment` reflects language tone.
- **Minimum mention threshold** — require ≥ 5 total mentions (postCount + commentCount) before computing `phraseSentiment`. Below this threshold the field is `null`. The dashboard shows "not enough data" in place of sentiment indicators.
- **Static word weights** — all lexicon words start at weight 1 regardless of intensity. Future work: introduce intensity tiers (e.g. "incredible/awful" = 2, "good/bad" = 1) once we have real data to validate against. Add a `weight` field to each lexicon entry now so the structure is ready.
- **`analyzePhraseSentiment`** — the export from `src/sentiment.ts` is named `analyzePhraseSentiment` to avoid confusion with the `scoreSentiment` stats field.
- **Position-aware matching** — add `matchLensesWithPositions(text): { id: string, index: number }[]` to `matcher.ts` alongside the existing `matchLenses`. Existing callers are unchanged. `index.ts` uses the position-aware version for sentiment; the regular version everywhere else.
- **Title and selftext** — keep the concatenated string for the matcher call (one pass, simpler). `title` and `selftext` are already stored as separate fields on `Post` so they're never lost. Context windowing operates on the concatenated string using the character index returned by `matchLensesWithPositions`.
- **Comments on post-matched posts** — fetch comments for posts matched via title/selftext so sentiment has access to the full discussion, not just the post body. Stored in `matchedComments` alongside the post. Controlled by a `FETCH_COMMENTS_FOR_SENTIMENT` flag so it can be disabled to keep run times short during development.

---

## YouTube Review Sentiment

### Goal

Supplement Reddit-derived sentiment with structured opinions from dedicated YouTube lens reviews. Review transcripts are higher-signal than Reddit comments — they represent a single reviewer's deliberate, extended take on a lens rather than a casual mention.

### Video Sourcing

**Phase 1 (current):** Manually curated list of `{ lensId, videoId, reviewer? }` entries hardcoded in `src/youtube-sentiment.ts`. You add video IDs by hand.

**Phase 2 (planned):** Use the YouTube Data API v3 to auto-populate the list:
- For each lens, search `"[brand] [model] review"` (e.g. `"Sony 85mm f/1.4 GM review"`)
- Filter results by `viewCount >= VIEW_COUNT_THRESHOLD` (e.g. 50,000 views) to ensure reviews with meaningful reach
- Collect `videoId`s from the top N results per lens
- Requires `YOUTUBE_API_KEY` in `.env`

### Transcript Fetching

Uses the `youtube-transcript` npm package — no API key required. Fetches auto-generated or manual captions from YouTube's public endpoint. Transcripts are capped at `MAX_TRANSCRIPT_CHARS` (currently 20,000) to keep Claude context manageable. Longer transcripts are truncated from the end.

### Claude Digestion

Each transcript is sent to Claude directly — we already know which lens the video is about, so there is no need to run the matcher. Claude receives a system prompt with the following instructions:

- **Focus on:** sharpness, bokeh, autofocus speed and accuracy, distortion, chromatic aberration, vignetting, build quality, size/weight, weather sealing, and value relative to optical performance
- **Ignore:** unboxing narration, price/availability commentary, sponsor reads, channel promotion filler, and comparisons where the primary subject is a different lens
- **Handle auto-generated transcripts gracefully:** no punctuation, run-on sentences — infer sentence boundaries from context
- **Preserve nuance:** do not flatten hedged statements like "not the sharpest wide open but excellent stopped down" into a simple positive or negative

If multiple videos exist for the same lens, each is analyzed separately and results are merged: scores are averaged, positives/negatives are deduplicated and capped, mention counts are summed.

### Output Schema

Written to `output/youtube-sentiment.json`, keyed by `lensId`. Same base shape as `output/claude-sentiment.json` so the dashboard can display both sources.

```json
{
  "fetchedAt": "2026-04-20T00:00:00.000Z",
  "lenses": {
    "sony-fe-85mm-f1.4-gm": {
      "score": 0.82,
      "label": "positive",
      "summary": "Reviewer praised the 85GM's rendering and bokeh as class-leading...",
      "positives": ["exceptional bokeh", "fast silent autofocus", "sharp across the frame"],
      "negatives": ["heavy for its class", "expensive"],
      "mentionCount": 14,
      "videosAnalyzed": 2,
      "videoIds": ["abc123", "xyz789"]
    }
  }
}
```

### Run

```bash
npm run youtube-sentiment
```

### Implementation Notes

- `src/youtube-sentiment.ts` — standalone script, does not depend on `results.json`
- Results are independent of Reddit sentiment — never merged into `scoreSentiment` or `phraseSentiment`
- The dashboard should display YouTube sentiment as a separate source alongside Claude Reddit sentiment, not combine the scores
- Prompt caching is applied to the system prompt (ephemeral) since the same prompt is reused across all videos in a run

---

## Open Questions

- Should `phraseSentiment` use a fixed lexicon forever, or is there a path to expanding it automatically from high-frequency words in matched contexts?
- How do we handle lenses that are frequently mentioned in "which lens should I buy" comparison posts — does that inflate or distort sentiment?
