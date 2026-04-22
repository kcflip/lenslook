import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { matchLensesWithPositions, matchPostWithPositions } from "./matcher.js";
import {
  analyzePhraseSentiment,
  analyzeReviewSentiment,
  computePhraseSentiment,
  type SentimentAggregate,
} from "./sentiment.js";
import type { ResultsData, LensSentimentEntry } from "../shared/types.js";
import { loadReviews } from "./reviews.js";

const INPUT = "output/results.json";
const OUTPUT = "output/lens-sentiment.json";

const data: ResultsData = JSON.parse(readFileSync(INPUT, "utf8"));
const reviewsByLens = loadReviews();
console.log(`Loaded ${data.posts.length} posts, ${data.stats.length} lenses from ${INPUT}`);
console.log(`Loaded reviews for ${Object.keys(reviewsByLens).length} lenses from output/reviews.json`);

const sentimentMap = new Map<string, SentimentAggregate>();
const reviewCounts = new Map<string, number>();

const get = (id: string): SentimentAggregate => {
  let agg = sentimentMap.get(id);
  if (!agg) { agg = { rawScores: [], positiveHits: [], negativeHits: [] }; sentimentMap.set(id, agg); }
  return agg;
};

// Reddit posts + comments (windowed around the lens mention)
for (const post of data.posts) {
  const { matches, normalized } = matchPostWithPositions(post);
  for (const m of matches) {
    const r = analyzePhraseSentiment(normalized, m.index, "post");
    const agg = get(m.id);
    agg.rawScores.push(r.rawScore);
    agg.positiveHits.push(...r.positiveHits);
    agg.negativeHits.push(...r.negativeHits);
  }

  for (const comment of post.matchedComments ?? []) {
    const { matches: cMatches, normalized: cNorm } = matchLensesWithPositions(comment.body);
    for (const m of cMatches) {
      const r = analyzePhraseSentiment(cNorm, m.index, "comment");
      const agg = get(m.id);
      agg.rawScores.push(r.rawScore);
      agg.positiveHits.push(...r.positiveHits);
      agg.negativeHits.push(...r.negativeHits);
    }
  }
}

// Amazon + B&H reviews (full-text, no windowing — the whole review is about one lens)
for (const [lensId, items] of Object.entries(reviewsByLens)) {
  for (const item of items) {
    if (item.sourceType !== "amazon" && item.sourceType !== "bh") continue;
    const { normalized } = matchLensesWithPositions(item.text);
    const r = analyzeReviewSentiment(normalized);
    const agg = get(lensId);
    agg.rawScores.push(r.rawScore);
    agg.positiveHits.push(...r.positiveHits);
    agg.negativeHits.push(...r.negativeHits);
    reviewCounts.set(lensId, (reviewCounts.get(lensId) ?? 0) + 1);
  }
}

const lensSentiment: Record<string, LensSentimentEntry> = {};
const statLensIds = new Set(data.stats.map(s => s.lensId));
const allLensIds = new Set<string>([...statLensIds, ...Object.keys(reviewsByLens)]);

for (const lensId of allLensIds) {
  const stat = data.stats.find(s => s.lensId === lensId);
  const postCount = stat?.postCount ?? 0;
  const commentCount = stat?.commentCount ?? 0;
  const reviewCount = reviewCounts.get(lensId) ?? 0;
  const ps = computePhraseSentiment(sentimentMap.get(lensId), postCount, commentCount, reviewCount);
  if (!ps) continue;
  lensSentiment[lensId] = { postCount, commentCount, reviewCount, ...ps };
}

mkdirSync("output", { recursive: true });
writeFileSync(OUTPUT, JSON.stringify({ fetchedAt: new Date().toISOString(), lenses: lensSentiment }, null, 2));
console.log(`Written to ${OUTPUT} (${Object.keys(lensSentiment).length} lenses cleared the mention threshold)`);
