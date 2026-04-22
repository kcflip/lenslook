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
  price?: number;
  priceScrapedAt?: string;
  starCount?: number;
  ratingCount?: number;
  images?: string[];
}

export interface Lens {
  id: string;
  brand: string;
  name: string;
  model: string;
  focalLength: string;
  maxAperture: string;
  mount: string;
  aliases: string[];
  tags: string[];
  amazon?: AmazonEntry;
  bh?: BHEntry;
}

// ── Reddit (scraper.ts output) ───────────────────────────────────────────────

export interface Comment {
  id: string;
  body: string;
  score: number;
  parent_id: string;
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

export type ReviewSource = "amazon" | "bh" | "reddit_post" | "reddit_comment" | "youtube";

export interface ReviewItem {
  sourceType: ReviewSource;
  lensId: string;
  text: string;
  rating?: number;
  verifiedPurchase?: boolean;
  images: string[];
  date?: string;
  url?: string;
  upvoteScore?: number;
}

export type ReviewsData = Record<string, ReviewItem[]>;

// ── Price history (output/price-history.json) ────────────────────────────────

export interface PricePoint {
  price: number;
  scrapedAt: string;
}

export interface LensPriceHistory {
  amazon?: PricePoint[];
  bh?: PricePoint[];
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
}
