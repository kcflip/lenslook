# Lenslook — Data models (UML)

> **Version:** 1.0.0 &middot; **Generated:** 2026-04-20
> Regenerate via `/regenerate-docs` (see `.claude/commands/regenerate-docs.md`).

Class diagrams for the JSON documents produced and consumed by the pipeline. Every block corresponds to one file on disk or one TypeScript interface in `dashboard/src/types.ts`.

## 1. `lenses.json` — static catalog

```mermaid
classDiagram
    class Lens {
        +string id
        +string brand
        +string name
        +string model
        +string focalLength
        +string maxAperture
        +string mount
        +string[] aliases
        +string[] tags
        +string? shoppingLink
        +AsinEntry[]? asins
        +BHEntry? bh
    }

    class AsinEntry {
        +string asin
        +string seller
        +boolean official
        +number? price
        +string? priceScrapedAt
    }

    class BHEntry {
        +string sku
        +string url
        +string title
        +number? price
        +string? priceScrapedAt
    }

    Lens "1" o-- "*" AsinEntry : asins
    Lens "1" o-- "0..1" BHEntry : bh
```

Notes:
- `tags` currently includes `Sony FE Full-Frame Primes`, `Sony FE Full-Frame Zooms`, `Sigma Full-Frame Lenses`, `Tamron Full-Frame Lenses`.
- `asins` is populated by `amazon-scrape.ts`; multiple sellers per lens are allowed but current scraper stops at the first official match.
- `bh` is populated by `bh-scrape.ts`; single entry per lens.

## 2. `output/results.json` — Reddit aggregate (`ResultsData`)

```mermaid
classDiagram
    class ResultsData {
        +string fetchedAt
        +string[] subreddits
        +string[] sorts
        +LensStat[] stats
        +Post[] posts
    }

    class LensStat {
        +string lensId
        +number postCount
        +number commentCount
        +number avgScore
        +number avgUpvoteRatio
        +number avgComments
        +number scoreSentiment
    }

    class Post {
        +string id
        +string title
        +string url
        +number score
        +number upvote_ratio
        +number num_comments
        +string subreddit
        +string sort
        +string timeframe
        +boolean is_self
        +string[] lensIds
        +string[] postLensIds
        +string[] commentLensIds
        +MatchedComment[] matchedComments
    }

    class MatchedComment {
        +string id
        +string body
        +number score
        +string[]? lensIds
    }

    ResultsData "1" *-- "*" LensStat : stats
    ResultsData "1" *-- "*" Post : posts
    Post "1" *-- "*" MatchedComment : matchedComments
```

Notes:
- `lensIds` is the union of `postLensIds` and `commentLensIds`; the dashboard filters top-matched posts by `postLensIds` only (comment-only matches are noisy).
- `scoreSentiment = mean(weight) * log(1 + postCount)`; see `CLAUDE.md` for the weight formula.

## 3. `output/lens-sentiment.json` — phrase-based sentiment

```mermaid
classDiagram
    class LensSentimentFile {
        +Record~string, LensSentimentEntry~ lenses
    }

    class LensSentimentEntry {
        +number postCount
        +number commentCount
        +number avg
        +number? ratio
        +number positiveCount
        +number negativeCount
        +number neutralCount
        +SentimentWord[] topPositiveWords
        +SentimentWord[] topNegativeWords
    }

    class SentimentWord {
        +string word
        +number count
        +number negatedCount
    }

    LensSentimentFile "1" *-- "*" LensSentimentEntry : lenses[lensId]
    LensSentimentEntry "1" *-- "*" SentimentWord : topPositiveWords
    LensSentimentEntry "1" *-- "*" SentimentWord : topNegativeWords
```

Notes:
- Keyed by `lensId`. `avg` is mean lexicon score across matched contexts; `ratio` is positive / (positive + negative) or `null` when both are zero.

## 4. `output/claude-sentiment.json` — LLM-summarized sentiment

```mermaid
classDiagram
    class ClaudeSentimentFile {
        +Record~string, ClaudeSentimentResult~ lenses
    }

    class ClaudeSentimentResult {
        +number score
        +Label label
        +string summary
        +string[] positives
        +string[] negatives
        +number mentionCount
    }

    class Label {
        <<enumeration>>
        positive
        negative
        neutral
        mixed
    }

    ClaudeSentimentFile "1" *-- "*" ClaudeSentimentResult : lenses[lensId]
    ClaudeSentimentResult ..> Label
```

Notes:
- `score` ∈ [-1, 1]. `summary`, `positives`, `negatives` are Claude-generated prose.

## 5. `output/youtube-sentiment.json` — per-video review sentiment

```mermaid
classDiagram
    class YouTubeSentimentFile {
        +Record~string, YouTubeSentimentResult~ lenses
    }

    class YouTubeSentimentResult {
        +VideoSentiment[] videos
    }

    class VideoSentiment {
        +string videoId
        +string url
        +string? reviewer
        +number score
        +Label label
        +string summary
        +string[] positives
        +string[] negatives
        +number mentionCount
    }

    class Label {
        <<enumeration>>
        positive
        negative
        neutral
        mixed
    }

    YouTubeSentimentFile "1" *-- "*" YouTubeSentimentResult : lenses[lensId]
    YouTubeSentimentResult "1" *-- "*" VideoSentiment : videos
    VideoSentiment ..> Label
```

Notes:
- `positives` / `negatives` are **verbatim quotes** from the transcript, under 100 chars each, max six per category.
- One `VideoSentiment` per transcript analyzed — multiple videos per lens are stored as an array rather than merged.

## 6. Dashboard aggregate — `DashboardData`

The single object `useDashboardData` hands to every tab.

```mermaid
classDiagram
    class DashboardData {
        +ResultsData results
        +Lens[] lenses
        +Record~string, LensSentimentEntry~ sentiment
        +Record~string, ClaudeSentimentResult~ claudeSentiment
        +Record~string, YouTubeSentimentResult~ youtubeSentiment
        +Record~string, Lens~ lensById
    }

    DashboardData ..> ResultsData
    DashboardData ..> Lens
    DashboardData ..> LensSentimentEntry
    DashboardData ..> ClaudeSentimentResult
    DashboardData ..> YouTubeSentimentResult
```

Notes:
- `lensById` is a convenience map built client-side in `useDashboardData` from `lenses[]`.
- Sentiment maps all key on `lensId`, so `dashboardData.claudeSentiment[lens.id]` / `dashboardData.youtubeSentiment[lens.id]` are the canonical per-lens lookups.

## 7. Cross-file relationships

How the documents reference each other at runtime. `lenses.json` is the join key; every enrichment file is keyed by `lensId`.

```mermaid
classDiagram
    class lenses_json {
        <<file>>
        Lens[]
    }
    class results_json {
        <<file>>
        ResultsData
    }
    class lens_sentiment_json {
        <<file>>
        Record lensId -> LensSentimentEntry
    }
    class claude_sentiment_json {
        <<file>>
        Record lensId -> ClaudeSentimentResult
    }
    class youtube_sentiment_json {
        <<file>>
        Record lensId -> YouTubeSentimentResult
    }

    results_json ..> lenses_json : LensStat.lensId
    lens_sentiment_json ..> lenses_json : key
    claude_sentiment_json ..> lenses_json : key
    youtube_sentiment_json ..> lenses_json : key
    results_json ..> lens_sentiment_json : drives top-N
    results_json ..> claude_sentiment_json : drives top-N
    results_json ..> youtube_sentiment_json : drives top-10
```
