import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { matchLensesWithPositions, matchPostWithPositions } from "./matcher.js";
import {
  analyzePhraseSentiment,
  computePhraseSentiment,
  type PhraseSentimentStats,
  type SentimentAggregate,
} from "./sentiment.js";
import type { ResultsData } from "../shared/types.js";

const INPUT = "output/results.json";
const OUTPUT = "output/lens-sentiment.json";

const data: ResultsData = JSON.parse(readFileSync(INPUT, "utf8"));
console.log(`Loaded ${data.posts.length} posts and ${data.stats.length} lenses from ${INPUT}`);

const sentimentMap = new Map<string, SentimentAggregate>();
const get = (id: string): SentimentAggregate => {
  let agg = sentimentMap.get(id);
  if (!agg) { agg = { rawScores: [], positiveHits: [], negativeHits: [] }; sentimentMap.set(id, agg); }
  return agg;
};

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

const lensSentiment: Record<string, { postCount: number; commentCount: number } & PhraseSentimentStats> = {};
for (const s of data.stats) {
  const ps = computePhraseSentiment(sentimentMap.get(s.lensId), s.postCount, s.commentCount);
  if (!ps) continue;
  lensSentiment[s.lensId] = { postCount: s.postCount, commentCount: s.commentCount, ...ps };
}

mkdirSync("output", { recursive: true });
writeFileSync(OUTPUT, JSON.stringify({ fetchedAt: new Date().toISOString(), lenses: lensSentiment }, null, 2));
console.log(`Written to ${OUTPUT} (${Object.keys(lensSentiment).length} lenses cleared the mention threshold)`);
