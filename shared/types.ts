// Shared types for Lenslook — one source of truth for both the Node pipeline
// in ../src and the React dashboard in ../dashboard/src.

// ── Catalog (lenses.json) ────────────────────────────────────────────────────

export interface AsinEntry {
  asin: string;
  official: boolean;
  url?: string;
  price?: number;
  priceScrapedAt?: string;
  avgRating?: number;
  ratingCount?: number;
  productImage?: string;
}

export interface AmazonEntry {
  searchLink: string;
  asins: AsinEntry[];
}

export interface BHEntry {
  bhNumber: string;
  url: string;
  title: string;
  official: boolean;
  mpn?: string;
  price?: number;
  priceScrapedAt?: string;
  starCount?: number;
  ratingCount?: number;
  images?: string[];
  productImage?: string;
  properties?: BHProperty;
}

export interface BHProperty {
  focalLength?: string;
  maxAperture?: string;
  minAperture?: string;
  mount?: string;
  format?: string;
  angleOfView?: string;
  minimumFocusDistance?: string;
  magnification?: string;
  opticalDesign?: string;
  apertureBlades?: string;
  focusType?: string;
  imageStabilization?: string;
  filterSize?: string;
  dimensions?: string;
  weight?: string;
}

export interface AdoramaEntry {
  sku: string;
  url: string;
  title: string;
  official: boolean;
  mpn?: string;
  price?: number;
  priceScrapedAt?: string;
  starCount?: number;
  ratingCount?: number;
  images?: string[];
  guessed?: boolean;  // true when match was title-only (no MPN verification)
}

// Curated URLs for long-form technical/editorial reviews. Hand-entered in
// lenses.json; scrapers read these keys to know where to look. Empty/missing
// means we haven't found a review worth tracking for this source.
export interface CuratedReviewUrls {
  lensrentals?: string;
  dpreview?: string;
  phillipreeve?: string;
}

// Generic entry for manufacturer/retailer stores not covered by the typed
// integrations above. Keyed by a short slug (e.g. "viltrox", "sigma").
export interface RetailerEntry {
  url: string;
  title?: string;
  price?: number;
  priceScrapedAt?: string;
}

// ── Camera bodies (bodies.json) ──────────────────────────────────────────────

export type System = "Sony" | "Nikon";
export type SensorSize = "Full-Frame" | "APS-C";
export type SensorType = "CMOS" | "BSI-CMOS" | "Stacked-CMOS" | "Global Shutter";

export interface BodySpecs {
  sensor?: { size: SensorSize; megapixels: number; type: SensorType };
  iso?: { nativeMin: number; nativeMax: number; extendedMax?: number };
  af?: { points?: number; lowLightEv?: number; subjects?: string[] };
  ibis?: { present: boolean; stops?: number };
  burst?: { mechFps?: number; elecFps?: number; bufferRaw?: number };
  video?: {
    maxResolution?: "8K" | "6K" | "4K" | "1080p";
    maxFrameRateAtMax?: number;
    bitDepth?: 8 | 10;
    sLog?: boolean;
    overheatingNotes?: string;
  };
  evf?: { dots?: number; magnification?: number; refreshHz?: number };
  lcd?: { sizeIn?: number; dots?: number; articulation?: "fixed" | "tilt" | "vari-angle" };
  storage?: { slots?: number; types?: ("CFexpress-A" | "CFexpress-B" | "SD-UHS-II" | "SD-UHS-I")[]; dualRedundant?: boolean };
  battery?: { model?: string; cipaShots?: number };
  connectivity?: { usb?: string; hdmi?: "full" | "mini" | "micro"; wifi?: boolean; bluetooth?: boolean };
  body?: { weightG?: number; weatherSealed?: boolean };
  shutter?: { mechMaxS?: string; elecMaxS?: string; flashSyncS?: string };
}

export interface Body {
  id: string;
  system: System;
  brand: string;
  name: string;
  model: string;
  mount: string;
  sensorSize: SensorSize;
  releaseDate?: string;
  releasePrice?: number;
  predecessor?: string;
  successor?: string;
  aliases: string[];
  specs: BodySpecs;
  features?: string[];
  amazon?: AmazonEntry;
  bh?: BHEntry;
  adorama?: AdoramaEntry;
  retailers?: Record<string, RetailerEntry>;
  reviews?: CuratedReviewUrls;
}

// Minimal interface satisfied structurally by both Lens and Body. Retail
// scrapers accept this so they can operate in lens or body mode without
// Lens | Body casts throughout the loop.
export interface RetailSubject {
  id: string;
  brand: string;
  model: string;
  name: string;
  aliases: string[];
  discontinued?: boolean;
  bh?: BHEntry;
  adorama?: AdoramaEntry;
  amazon?: AmazonEntry;
}

export interface Lens {
  id: string;
  system: string;
  brand: string;
  name: string;
  model: string;
  focalLength: string;
  maxAperture: string;
  mount: string;
  aliases: string[];
  category: string[];
  discontinued?: boolean;
  amazon?: AmazonEntry;
  bh?: BHEntry;
  adorama?: AdoramaEntry;
  retailers?: Record<string, RetailerEntry>;
  reviews?: CuratedReviewUrls;
}

// ── Reddit (scraper.ts output) ───────────────────────────────────────────────

export interface Comment {
  id: string;
  body: string;
  score: number;
  parent_id: string;
  author: string;
}

export interface PostImage {
  url: string;
  width?: number;
  height?: number;
}

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  url: string;
  subreddit: string;
  sort: string;
  timeframe: string | null;
  is_self: boolean;
  images?: PostImage[];
}

export interface MatchedComment {
  id: string;
  body: string;
  score: number;
  lensIds?: string[];
  bodyIds?: string[];
}

// ── Sentiment primitives (sentiment.ts internals exposed for results.json) ──

export interface WordHit {
  word: string;
  negated: boolean; // true when a negation flipped the lexicon polarity
}

export interface SentimentMention {
  lensId: string;
  source: "post" | "comment";
  rawScore: number;
  positiveHits: WordHit[];
  negativeHits: WordHit[];
}

// ── Aggregated results (output/results.json) ────────────────────────────────

// What's written into results.json: RedditPost + lens-match + sentiment layer.
export interface Post extends RedditPost {
  lensIds: string[];
  postLensIds: string[];
  commentLensIds: string[];
  bodyIds?: string[];
  postBodyIds?: string[];
  commentBodyIds?: string[];
  matchedComments?: MatchedComment[];
  sentimentMentions?: SentimentMention[];
}

export interface LensStat {
  lensId: string;
  postCount: number;
  commentCount: number;
  avgScore: number;
  avgUpvoteRatio: number;
  avgComments: number;
  scoreSentiment: number;
  phraseSentiment?: PhraseSentimentStats | null;
}

export interface ResultsData {
  fetchedAt: string;
  subreddits: string[];
  sorts: string[];
  stats: LensStat[];
  posts: Post[];
}

// ── Phrase-based sentiment (output/lens-sentiment.json) ─────────────────────

export interface SentimentWord {
  word: string;
  count: number;
  negatedCount: number;
}

export interface PhraseSentimentStats {
  avg: number;
  ratio: number | null;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  topPositiveWords: SentimentWord[];
  topNegativeWords: SentimentWord[];
}

export interface LensSentimentEntry extends PhraseSentimentStats {
  postCount: number;
  commentCount: number;
  reviewCount: number;
}

// ── Claude sentiment (output/claude-sentiment.json) ─────────────────────────

export type SentimentLabel = "positive" | "negative" | "neutral" | "mixed";

// Evidence-backed sentiment point. Each positive/negative Claude emits must
// pair an aspect phrase with a verbatim quote from one of the input items,
// and carry the source it came from. Prevents paraphrase/hallucination.
export interface SentimentCitation {
  aspect: string;
  quote: string;
  source: ReviewSource;
}

export interface ClaudeSentimentResult {
  score: number;
  label: SentimentLabel;
  summary: string;
  positives: SentimentCitation[];
  negatives: SentimentCitation[];
  mentionCount: number;
}

// ── YouTube sentiment (output/youtube-sentiment.json) ───────────────────────

export interface VideoSentiment {
  videoId: string;
  url: string;
  title?: string;
  channelTitle?: string;
  viewCount?: number;
  reviewer?: string;
  score: number;
  label: SentimentLabel;
  summary: string;
  positives: string[];
  negatives: string[];
  mentionCount: number;
}

export interface YouTubeSentimentResult {
  videos: VideoSentiment[];
}

// ── Reviews (output/reviews.json) ───────────────────────────────────────────

export type ReviewSource = "amazon" | "bh" | "adorama" | "reddit_post" | "reddit_comment" | "youtube";

export interface ReviewItem {
  sourceType: ReviewSource;
  productId: string;
  text: string;
  rating?: number;
  verifiedPurchase?: boolean;
  images: string[];
  date?: string;
  url?: string;
  upvoteScore?: number;
}

export type ReviewsData = Record<string, ReviewItem[]>;

// ── Technical reviews (output/technical-reviews.json) ───────────────────────
// Long-form editorial reviews from sites like lensrentals, dpreview, and
// phillipreeve. Distinct from ReviewItem (user submissions) because these are
// expert articles: one per (lens, source), with structured extractions on top
// of full body text we retain locally for the Claude sentiment pipeline.

export type TechnicalSource = "lensrentals" | "dpreview" | "phillipreeve";

export interface TechnicalReview {
  source: TechnicalSource;
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;   // ISO date string when parseable, else raw text

  // Structured extractions we attempt per source. Any may be absent.
  verdict?: string;         // 1–3 sentence conclusion
  score?: number;           // DPReview explicit score; others usually null
  pros?: string[];
  cons?: string[];

  // Source-specific numeric metrics (e.g. Lensrentals variation scores).
  metrics?: Record<string, number | string>;

  // Asset URLs pulled from the article body.
  sampleImages?: string[];
  mtfCharts?: string[];

  // Raw body text. Stored locally for downstream sentiment analysis; not
  // intended to be rendered wholesale on the dashboard.
  fullText?: string;
  textLength?: number;

  // Flags set when the scraper detects a problematic page and refuses to
  // persist extractions. URL + title are still saved so we can audit.
  flagged?: {
    reason: "multi-lens" | "not-found" | "archived" | "other";
    detail?: string;
    mentionedLensIds?: string[];
  };

  scrapedAt: string;        // ISO timestamp
}

export type TechnicalReviewsData = Record<string, Partial<Record<TechnicalSource, TechnicalReview>>>;

// ── Price history (output/price-history.json) ────────────────────────────────

export interface PricePoint {
  price: number;
  scrapedAt: string;
}

export interface LensPriceHistory {
  amazon?: PricePoint[];
  bh?: PricePoint[];
  adorama?: PricePoint[];
  retailers?: Record<string, PricePoint[]>;
}

export type PriceHistoryData = Record<string, LensPriceHistory>;

// ── Dashboard runtime aggregate ─────────────────────────────────────────────

export interface DashboardData {
  results: ResultsData;
  lenses: Lens[];
  sentiment: Record<string, LensSentimentEntry>;
  claudeSentiment: Record<string, ClaudeSentimentResult>;
  youtubeSentiment: Record<string, YouTubeSentimentResult>;
  reviews: ReviewsData;
  lensById: Record<string, Lens>;
  bodies: Body[];
  bodyById: Record<string, Body>;
}
