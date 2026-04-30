# Lenslook — Data models (UML)

> **Version:** 1.1.0 &middot; **Generated:** 2026-04-29
> Regenerate via `/regenerate-docs` (see `.claude/commands/regenerate-docs.md`).

Class diagrams for the JSON documents and TypeScript interfaces in `shared/types.ts`. Every block corresponds to one file on disk or one exported type.

## 1. `lenses.json` — static lens catalog

```mermaid
classDiagram
    class Lens {
        +string id
        +string system
        +string brand
        +string name
        +string model
        +string focalLength
        +string maxAperture
        +string mount
        +string[] aliases
        +string[] category
        +bool? discontinued
        +AmazonEntry? amazon
        +BHEntry? bh
        +AdoramaEntry? adorama
        +Map~string,RetailerEntry~? retailers
        +CuratedReviewUrls? reviews
    }

    class AmazonEntry {
        +string searchLink
        +AsinEntry[] asins
    }
    class AsinEntry {
        +string asin
        +bool official
        +string? url
        +number? price
        +string? priceScrapedAt
        +number? avgRating
        +number? ratingCount
        +string? productImage
    }
    class BHEntry {
        +string bhNumber
        +string url
        +string title
        +bool official
        +string? mpn
        +number? price
        +string? priceScrapedAt
        +number? starCount
        +number? ratingCount
        +string[]? images
        +string? productImage
        +BHProperty? properties
    }
    class AdoramaEntry {
        +string sku
        +string url
        +string title
        +bool official
        +string? mpn
        +number? price
        +string? priceScrapedAt
        +number? starCount
        +number? ratingCount
        +string[]? images
        +bool? guessed
    }
    class RetailerEntry {
        +string url
        +string? title
        +number? price
        +string? priceScrapedAt
    }
    class CuratedReviewUrls {
        +string? lensrentals
        +string? dpreview
        +string? phillipreeve
    }

    Lens "1" o-- "0..1" AmazonEntry
    AmazonEntry "1" o-- "*" AsinEntry
    Lens "1" o-- "0..1" BHEntry
    Lens "1" o-- "0..1" AdoramaEntry
    Lens "1" o-- "*" RetailerEntry : retailers
    Lens "1" o-- "0..1" CuratedReviewUrls : reviews
```

Notes:
- `system` is always `"Sony"` today. Reserved for Nikon expansion.
- `category` replaced the older `tags` field (04-22 migration). Values: `prime`, `zoom`, `superzoom`, `ultra-wide`, `wide`, `standard`, `telephoto`, `super-telephoto`, `macro`, `aps-c`.
- `discontinued` is declared but not honored anywhere — see `TODO.md`.

## 2. `bodies.json` — Sony E-mount bodies

```mermaid
classDiagram
    class Body {
        +string id
        +System system
        +string brand
        +string name
        +string model
        +string mount
        +SensorSize sensorSize
        +string? releaseDate
        +number? releasePrice
        +string? predecessor
        +string? successor
        +string[] aliases
        +BodySpecs specs
        +string[]? features
        +AmazonEntry? amazon
        +BHEntry? bh
        +AdoramaEntry? adorama
        +Map~string,RetailerEntry~? retailers
        +CuratedReviewUrls? reviews
    }
    class BodySpecs {
        +sensor? size, megapixels, type
        +iso? nativeMin, nativeMax, extendedMax
        +af? points, lowLightEv, subjects
        +ibis? present, stops
        +burst? mechFps, elecFps, bufferRaw
        +video? resolution, fps, bitDepth, sLog
        +evf? dots, magnification, refreshHz
        +lcd? sizeIn, dots, articulation
        +storage? slots, types, dualRedundant
        +battery? model, cipaShots
        +connectivity? usb, hdmi, wifi, bluetooth
        +body? weightG, weatherSealed
        +shutter? mechMaxS, elecMaxS, flashSyncS
    }
    class System { <<enumeration>> Sony Nikon }
    class SensorSize { <<enumeration>> Full-Frame APS-C }

    Body ..> System
    Body ..> SensorSize
    Body "1" *-- "1" BodySpecs
```

Notes:
- Body IDs always carry a `body-` prefix (e.g. `body-sony-a7iv`); lens IDs do not. Used as a cheap discriminator wherever the two streams mix.
- `BodySpecs` fields are all optional — `specs: {}` is valid. Dashboard hides empty rows.

## 3. `RetailSubject` — structural overlap of Lens and Body

```mermaid
classDiagram
    class RetailSubject {
        +string id
        +string brand
        +string model
        +string name
        +string[] aliases
        +bool? discontinued
        +AmazonEntry? amazon
        +BHEntry? bh
        +AdoramaEntry? adorama
    }
```

The retail scrapers operate on `RetailSubject` so the per-iteration loop doesn't need `Lens | Body` casts. `Lens` and `Body` both satisfy it structurally.

## 4. `output/sonyResults.json` — Reddit aggregate (`ResultsData`)

```mermaid
classDiagram
    class ResultsData {
        +string fetchedAt
        +string[] subreddits
        +Run[] runs
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
        +PhraseSentimentStats? phraseSentiment
    }
    class Post {
        +string id
        +string title
        +string selftext
        +number score
        +number upvote_ratio
        +number num_comments
        +number created_utc
        +string url
        +string subreddit
        +string sort
        +string|null timeframe
        +bool is_self
        +PostImage[]? images
        +string[] lensIds
        +string[] postLensIds
        +string[] commentLensIds
        +MatchedComment[]? matchedComments
        +SentimentMention[]? sentimentMentions
    }
    class MatchedComment {
        +string id
        +string body
        +number score
        +string[]? lensIds
    }
    class SentimentMention {
        +string lensId
        +"post"|"comment" source
        +number rawScore
        +WordHit[] positiveHits
        +WordHit[] negativeHits
    }

    ResultsData "1" *-- "*" LensStat
    ResultsData "1" *-- "*" Post
    Post "1" *-- "*" MatchedComment
    Post "1" *-- "*" SentimentMention
```

Notes:
- `lensIds` is the union of `postLensIds` and `commentLensIds`. Despite the name, both lens and body IDs flow through this field.
- `scoreSentiment = mean(weights) * log(1 + count)` where `weight = calcWeight(post)` from `shared/weight.ts`.
- `LensStat.lensId` is also a body ID when applicable. Same caveat throughout.

## 5. `output/lens-sentiment.json` — phrase-lexicon sentiment

```mermaid
classDiagram
    class LensSentimentFile {
        +string fetchedAt
        +Map~lensId,LensSentimentEntry~ lenses
    }
    class LensSentimentEntry {
        +number postCount
        +number commentCount
        +number reviewCount
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

    LensSentimentFile "1" *-- "*" LensSentimentEntry
    LensSentimentEntry "1" *-- "*" SentimentWord
```

Notes:
- Mention threshold: `postCount + commentCount + reviewCount >= SENTIMENT_MIN_MENTIONS` (5). Below that, the entry is omitted.
- `reviewCount` populated by `sentiment-rerun.ts` from `output/reviews.json`. The in-pipeline write in `src/index.ts` always emits `reviewCount: 0`.

## 6. `output/claude-sentiment.json` — Claude summarized

```mermaid
classDiagram
    class ClaudeSentimentFile {
        +string fetchedAt
        +Map~productId,ClaudeSentimentResult~ lenses
    }
    class ClaudeSentimentResult {
        +number score
        +SentimentLabel label
        +string summary
        +SentimentCitation[] positives
        +SentimentCitation[] negatives
        +number mentionCount
    }
    class SentimentCitation {
        +string aspect
        +string quote
        +ReviewSource source
    }
    class SentimentLabel { <<enumeration>> positive negative neutral mixed }
    class ReviewSource { <<enumeration>> amazon bh adorama reddit_post reddit_comment youtube }

    ClaudeSentimentFile "1" *-- "*" ClaudeSentimentResult
    ClaudeSentimentResult "1" *-- "*" SentimentCitation
    SentimentCitation ..> ReviewSource
```

Notes:
- Quotes are verbatim — `verifyCitations` in `src/claude-sentiment.ts` drops any citation whose `quote` is not a substring of the input text (whitespace-normalized).
- `score ∈ [-1, 1]`. Same shape used for body sentiment when invoked with `--bodies`; the file key is "lenses" out of legacy.

## 7. `output/youtube-sentiment.json` — per-video sentiment

```mermaid
classDiagram
    class YouTubeSentimentFile {
        +string fetchedAt
        +Map~lensId,YouTubeSentimentResult~ lenses
    }
    class YouTubeSentimentResult {
        +VideoSentiment[] videos
    }
    class VideoSentiment {
        +string videoId
        +string url
        +string? title
        +string? channelTitle
        +number? viewCount
        +string? reviewer
        +number score
        +SentimentLabel label
        +string summary
        +string[] positives
        +string[] negatives
        +number mentionCount
    }

    YouTubeSentimentFile "1" *-- "*" YouTubeSentimentResult
    YouTubeSentimentResult "1" *-- "*" VideoSentiment
```

Notes:
- `positives` / `negatives` are verbatim quotes from the transcript, ≤100 chars, max 6 each.
- One `VideoSentiment` per transcript — multiple videos per lens are stored as an array, not merged.
- Timestamps deferred — see `TODO.md`.

## 8. `output/reviews.json` — retailer reviews

```mermaid
classDiagram
    class ReviewsData {
        <<file>>
        Map~productId,ReviewItem[]~
    }
    class ReviewItem {
        +ReviewSource sourceType
        +string productId
        +string text
        +number? rating
        +bool? verifiedPurchase
        +string[] images
        +string? date
        +string? url
        +number? upvoteScore
    }

    ReviewsData "1" *-- "*" ReviewItem
```

Notes:
- Flat `{ productId: ReviewItem[] }` — no `lenses` wrapper, unlike sentiment files.
- `saveReviews(productId, sourceType, ...)` replaces all existing items with that `sourceType` for that product, then appends. Re-running a scraper overwrites its own output without touching other sources.

## 9. `output/price-history.json` — append-only price log

```mermaid
classDiagram
    class PriceHistoryData {
        <<file>>
        Map~productId,LensPriceHistory~
    }
    class LensPriceHistory {
        +PricePoint[]? amazon
        +PricePoint[]? bh
        +PricePoint[]? adorama
        +Map~string,PricePoint[]~? retailers
    }
    class PricePoint {
        +number price
        +string scrapedAt
    }

    PriceHistoryData "1" *-- "*" LensPriceHistory
    LensPriceHistory "1" *-- "*" PricePoint
```

Notes:
- `recordPrice` always appends — never deduplicates by timestamp. Each scrape adds a point.

## 10. `output/technical-reviews.json` — editorial reviews

```mermaid
classDiagram
    class TechnicalReviewsData {
        <<file>>
        Map~lensId,Map~TechnicalSource,TechnicalReview~~
    }
    class TechnicalReview {
        +TechnicalSource source
        +string url
        +string title
        +string? author
        +string? publishedDate
        +string? verdict
        +number? score
        +string[]? pros
        +string[]? cons
        +Map~string,number|string~? metrics
        +string[]? sampleImages
        +string[]? mtfCharts
        +string? fullText
        +number? textLength
        +Flagged? flagged
        +string scrapedAt
    }
    class TechnicalSource { <<enumeration>> lensrentals dpreview phillipreeve }
```

Notes:
- One review per `(lensId, source)`. Re-running overwrites in place.
- `flagged` set when a multi-lens article or not-found page is detected; `fullText` is omitted in that case.

## 11. Dashboard runtime aggregate — `DashboardData`

```mermaid
classDiagram
    class DashboardData {
        +ResultsData results
        +Lens[] lenses
        +Body[] bodies
        +Map~lensId,LensSentimentEntry~ sentiment
        +Map~productId,ClaudeSentimentResult~ claudeSentiment
        +Map~lensId,YouTubeSentimentResult~ youtubeSentiment
        +ReviewsData reviews
        +Map~lensId,Lens~ lensById
        +Map~bodyId,Body~ bodyById
    }

    DashboardData ..> ResultsData
    DashboardData ..> Lens
    DashboardData ..> Body
```

Notes:
- `useDashboardData(system)` parallel-fetches the seven files, filters lenses to the active system, and hides lenses with zero Reddit mentions AND no retail URL.
- Bodies are filtered by `b.system === system` only — currently the bodies catalog is Sony-only.

## 12. Cross-file relationships

```mermaid
classDiagram
    class lenses_json { <<file>> Lens[] }
    class bodies_json { <<file>> Body[] }
    class sonyResults_json { <<file>> ResultsData }
    class lens_sentiment_json { <<file>> Map~lensId,LensSentimentEntry~ }
    class claude_sentiment_json { <<file>> Map~productId,ClaudeSentimentResult~ }
    class youtube_sentiment_json { <<file>> Map~lensId,YouTubeSentimentResult~ }
    class reviews_json { <<file>> Map~productId,ReviewItem[]~ }
    class price_history_json { <<file>> Map~productId,LensPriceHistory~ }
    class technical_reviews_json { <<file>> Map~lensId,...~ }

    sonyResults_json ..> lenses_json : LensStat.lensId
    sonyResults_json ..> bodies_json : LensStat.lensId (body-* prefix)
    lens_sentiment_json ..> sonyResults_json : keyed by lensId
    claude_sentiment_json ..> sonyResults_json : drives top-N
    claude_sentiment_json ..> reviews_json : merged input items
    youtube_sentiment_json ..> sonyResults_json : top-N-per-brand
    reviews_json ..> lenses_json : productId
    reviews_json ..> bodies_json : productId
    price_history_json ..> lenses_json : productId
    technical_reviews_json ..> lenses_json : keyed by lensId
```

`lenses.json` + `bodies.json` are the join keys. Every enrichment is keyed by `productId`, where lens IDs and body IDs share a string namespace distinguished by the `body-` prefix.
