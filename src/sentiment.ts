export const POSITIVE_WORDS = [
  "sharp", "sharpness", "fast", "tack", "crisp", "stunning", "beautiful",
  "incredible", "amazing", "excellent", "love", "perfect", "smooth", "creamy",
  "silent", "quiet", "lightweight", "compact", "contrasty", "render",
  "bokeh", "reliable", "versatile", "worth", "recommend",
  "affordable", "bargain", "value", "reasonable", "inexpensive",
  "best", "favorite", "favourite", "keeper", "goto",
];

export const NEGATIVE_WORDS = [
  "soft", "blurry", "slow", "loud", "heavy", "bulky", "expensive", "overpriced",
  "disappointing", "bad", "terrible", "awful", "hate", "regret", "return",
  "chromatic", "vignetting", "distortion", "flare", "noisy", "fragile",
  "plasticky", "unreliable", "hunt", "hunting", "worst", "worse",
];

// Multi-word phrases — matched before single words. Keep post-normalization form
// (lowercase, apostrophes stripped, punctuation → space, whitespace collapsed).
// Phrase hits consume their constituent tokens so we don't double-count.
export const POSITIVE_PHRASES = [
  "the best", "my favorite", "my favourite", "blown away", "game changer",
  "must have", "worth every penny", "go to", "love it", "love this",
  "highly recommend", "worth it",
];

export const NEGATIVE_PHRASES = [
  "waste of money", "fell apart", "got rid", "returned it", "buyers remorse",
  "not worth it",
];

// Post-normalization forms — apostrophes are stripped by matcher.normalize.
const NEGATIONS = new Set([
  "not", "no", "never", "isnt", "doesnt", "wasnt", "dont", "didnt",
  "wont", "cant", "couldnt", "shouldnt", "wouldnt", "barely", "hardly",
]);

export interface LexiconEntry {
  word: string;
  polarity: 1 | -1;
  weight: number;
}

export const LEXICON: Record<string, LexiconEntry> = {};
for (const w of POSITIVE_WORDS) LEXICON[w] = { word: w, polarity: 1, weight: 1 };
for (const w of NEGATIVE_WORDS) LEXICON[w] = { word: w, polarity: -1, weight: 1 };

// Phrase lexicon keyed by token-count so we can try longest-first at each scan position.
const PHRASE_LEXICON: Map<number, Record<string, LexiconEntry>> = new Map();
function addPhrase(phrase: string, polarity: 1 | -1) {
  const tokens = phrase.split(" ");
  const n = tokens.length;
  if (!PHRASE_LEXICON.has(n)) PHRASE_LEXICON.set(n, {});
  PHRASE_LEXICON.get(n)![phrase] = { word: phrase, polarity, weight: 1 };
}
for (const p of POSITIVE_PHRASES) addPhrase(p, 1);
for (const p of NEGATIVE_PHRASES) addPhrase(p, -1);
const PHRASE_LENGTHS = [...PHRASE_LEXICON.keys()].sort((a, b) => b - a); // longest first

const CONTEXT_WINDOW_WORDS = 30;
const NEGATION_LOOKBACK = 3;
const COMMENT_DISCOUNT = 0.5;

import type { SentimentWord, PhraseSentimentStats, WordHit, ReviewSource } from "../shared/types.js";
export type { SentimentWord, PhraseSentimentStats, WordHit } from "../shared/types.js";

export const SENTIMENT_MIN_MENTIONS = 5;

export interface PhraseSentimentResult {
  rawScore: number;
  positiveHits: WordHit[]; // effective polarity +1
  negativeHits: WordHit[]; // effective polarity -1
}

const EOS = "__eos__";

// Walk tokens from `start` in `step` direction, stopping at the sentence boundary
// or after `max` tokens. Returns the collected slice in original order.
function collectToBoundary(tokens: string[], start: number, step: 1 | -1, max: number): string[] {
  const collected: string[] = [];
  for (let i = start; i >= 0 && i < tokens.length && collected.length < max; i += step) {
    if (tokens[i] === EOS) break;
    collected.push(tokens[i]);
  }
  return step === 1 ? collected : collected.reverse();
}

function scoreTokens(windowWords: string[]): PhraseSentimentResult {
  let rawScore = 0;
  const positiveHits: WordHit[] = [];
  const negativeHits: WordHit[] = [];

  for (let i = 0; i < windowWords.length; i++) {
    // Try longest phrase first; fall back to single-word lookup.
    let entry: LexiconEntry | undefined;
    let consumed = 1;
    for (const n of PHRASE_LENGTHS) {
      if (i + n > windowWords.length) continue;
      const phrase = windowWords.slice(i, i + n).join(" ");
      const hit = PHRASE_LEXICON.get(n)?.[phrase];
      if (hit) { entry = hit; consumed = n; break; }
    }
    if (!entry) entry = LEXICON[windowWords[i]];
    if (!entry) continue;

    let negated = false;
    for (let j = Math.max(0, i - NEGATION_LOOKBACK); j < i; j++) {
      if (NEGATIONS.has(windowWords[j])) { negated = true; break; }
    }
    const polarity: 1 | -1 = negated ? (entry.polarity === 1 ? -1 : 1) : entry.polarity;

    rawScore += polarity * entry.weight;
    const hit: WordHit = { word: entry.word, negated };
    if (polarity === 1) positiveHits.push(hit);
    else negativeHits.push(hit);

    i += consumed - 1; // skip tokens consumed by a phrase match
  }

  return { rawScore, positiveHits, negativeHits };
}

export function analyzePhraseSentiment(
  normalizedText: string,
  matchIndex: number,
  source: ReviewSource | "post" | "comment",
): PhraseSentimentResult {
  const before = normalizedText.slice(0, matchIndex).trim().split(/\s+/).filter(Boolean);
  const after = normalizedText.slice(matchIndex).trim().split(/\s+/).filter(Boolean);
  const windowWords = [
    ...collectToBoundary(before, before.length - 1, -1, CONTEXT_WINDOW_WORDS),
    ...collectToBoundary(after, 0, 1, CONTEXT_WINDOW_WORDS + 1),
  ];

  const result = scoreTokens(windowWords);
  // Two forms exist for the same thing: src/index.ts emits "comment" when
  // building post-time SentimentMentions; the unified ReviewSource enum used
  // elsewhere is "reddit_comment". Accept both so callers don't have to map.
  if (source === "comment" || source === "reddit_comment") result.rawScore *= COMMENT_DISCOUNT;
  return result;
}

// Analyze a full review-style text (Amazon/B&H) where the whole body is about
// one lens — no windowing around a mention is needed.
export function analyzeReviewSentiment(normalizedText: string): PhraseSentimentResult {
  const tokens = normalizedText.trim().split(/\s+/).filter(Boolean);
  return scoreTokens(tokens);
}

export interface SentimentAggregate {
  rawScores: number[];
  positiveHits: WordHit[];
  negativeHits: WordHit[];
}

function topN(hits: WordHit[], n: number): SentimentWord[] {
  const counts = new Map<string, { count: number; negatedCount: number }>();
  for (const h of hits) {
    const entry = counts.get(h.word) ?? { count: 0, negatedCount: 0 };
    entry.count++;
    if (h.negated) entry.negatedCount++;
    counts.set(h.word, entry);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([word, { count, negatedCount }]) => ({ word, count, negatedCount }));
}

export function computePhraseSentiment(
  s: SentimentAggregate | undefined,
  postCount: number,
  commentCount: number,
  reviewCount: number = 0,
): PhraseSentimentStats | null {
  if (!s || postCount + commentCount + reviewCount < SENTIMENT_MIN_MENTIONS) return null;
  const avg = s.rawScores.reduce((a, b) => a + b, 0) / s.rawScores.length;
  const positiveCount = s.rawScores.filter((x) => x > 0).length;
  const negativeCount = s.rawScores.filter((x) => x < 0).length;
  const neutralCount = s.rawScores.filter((x) => x === 0).length;
  const polarSum = positiveCount + negativeCount;
  return {
    avg: parseFloat(avg.toFixed(3)),
    ratio: polarSum > 0 ? parseFloat((positiveCount / polarSum).toFixed(3)) : null,
    positiveCount,
    negativeCount,
    neutralCount,
    topPositiveWords: topN(s.positiveHits, 50),
    topNegativeWords: topN(s.negativeHits, 50),
  };
}
