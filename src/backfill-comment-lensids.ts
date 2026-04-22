import { readFileSync, writeFileSync } from "fs";
import { matchLensesWithPositions, matchPostWithPositions } from "./matcher.js";
import { computePhraseSentiment } from "./sentiment.js";
import type { Post, LensStat, WordHit, PhraseSentimentStats, LensSentimentEntry } from "../shared/types.js";

const FILE = "output/results.json";

interface ResultsFile {
  posts: Post[];
  stats?: LensStat[];
  [k: string]: unknown;
}

const data: ResultsFile = JSON.parse(readFileSync(FILE, "utf8"));

let postsSeen = 0;
let postsUpdated = 0;
let postsDropped = 0;
let commentsSeen = 0;
let commentsUpdated = 0;
const keptPosts: Post[] = [];

for (const post of data.posts) {
  postsSeen++;

  // 1. Re-match post title + selftext.
  const { matches: postMatches } = matchPostWithPositions(post);
  const newPostLensIds = [...new Set(postMatches.map((m) => m.id))];
  const prevPostKey = post.postLensIds ? [...post.postLensIds].sort().join(",") : "";
  const newPostKey = [...newPostLensIds].sort().join(",");
  const postChanged = prevPostKey !== newPostKey;

  // 2. Re-match each comment.
  const commentLensSet = new Set<string>();
  for (const comment of post.matchedComments ?? []) {
    commentsSeen++;
    const { matches } = matchLensesWithPositions(comment.body);
    const lensIds = [...new Set(matches.map((m) => m.id))];
    const prev = comment.lensIds ? [...comment.lensIds].sort().join(",") : "";
    const next = [...lensIds].sort().join(",");
    if (prev !== next) commentsUpdated++;
    comment.lensIds = lensIds;
    for (const id of lensIds) commentLensSet.add(id);
  }

  // 3. commentLensIds = comment-only matches (disjoint from post matches).
  //    Mirrors index.ts buildAllMatched/matching logic.
  const newCommentLensIds = [...commentLensSet].filter(
    (id) => !newPostLensIds.includes(id),
  );
  const newLensIds = [...newPostLensIds, ...newCommentLensIds];

  if (postChanged) postsUpdated++;

  // 4. Drop post if it no longer matches any lens.
  if (newLensIds.length === 0) {
    postsDropped++;
    continue;
  }

  post.postLensIds = newPostLensIds;
  post.commentLensIds = newCommentLensIds;
  post.lensIds = newLensIds;

  // 5. Drop sentimentMentions tied to lenses that no longer match this post.
  //    (We don't re-run sentiment analysis — just filter stale mentions.)
  if (post.sentimentMentions) {
    const kept = new Set(newLensIds);
    post.sentimentMentions = post.sentimentMentions.filter((m) => kept.has(m.lensId));
  }

  keptPosts.push(post);
}

data.posts = keptPosts;

// 6. Rebuild top-level stats from the corrected posts. Same formula as index.ts writeOutput.
const statsMap = new Map<string, { scores: number[]; ratios: number[]; comments: number[]; weights: number[]; commentCount: number }>();
const sentimentMap = new Map<string, { rawScores: number[]; positiveHits: WordHit[]; negativeHits: WordHit[] }>();

for (const post of data.posts) {
  const engagementScore = Math.log(1 + post.score) * (post.is_self ? post.upvote_ratio * 0.5 : post.upvote_ratio);
  const discussionScore = Math.log(1 + post.num_comments);
  const weight = engagementScore * 0.5 + discussionScore * 0.5;
  const ids = post.lensIds ?? [];
  const commentIds = post.commentLensIds ?? [];
  for (const id of ids) {
    if (!statsMap.has(id)) statsMap.set(id, { scores: [], ratios: [], comments: [], weights: [], commentCount: 0 });
    const s = statsMap.get(id)!;
    s.scores.push(post.score);
    s.ratios.push(post.upvote_ratio);
    s.comments.push(post.num_comments);
    s.weights.push(weight);
    if (commentIds.includes(id)) s.commentCount++;
  }
  for (const m of post.sentimentMentions ?? []) {
    if (!sentimentMap.has(m.lensId)) sentimentMap.set(m.lensId, { rawScores: [], positiveHits: [], negativeHits: [] });
    const s = sentimentMap.get(m.lensId)!;
    s.rawScores.push(m.rawScore);
    s.positiveHits.push(...m.positiveHits);
    s.negativeHits.push(...m.negativeHits);
  }
}

const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

data.stats = [...statsMap.entries()]
  .map(([lensId, s]) => ({
    lensId,
    postCount: s.scores.length - s.commentCount,
    commentCount: s.commentCount,
    avgScore: Math.round(avg(s.scores)),
    avgUpvoteRatio: parseFloat(avg(s.ratios).toFixed(3)),
    avgComments: Math.round(avg(s.comments)),
    scoreSentiment: parseFloat((avg(s.weights) * Math.log(1 + s.weights.length)).toFixed(3)),
    phraseSentiment: computePhraseSentiment(sentimentMap.get(lensId), s.scores.length - s.commentCount, s.commentCount),
  }))
  .sort((a, b) => b.scoreSentiment - a.scoreSentiment);

writeFileSync(FILE, JSON.stringify(data, null, 2));

// 7. Regenerate lens-sentiment.json — dashboard reads it alongside results.json,
//    so it needs to stay in sync with the rebuilt stats.
const SENTIMENT_FILE = "output/lens-sentiment.json";
const lensSentiment: Record<string, LensSentimentEntry> = {};
for (const s of data.stats) {
  if (!s.phraseSentiment) continue;
  lensSentiment[s.lensId] = { postCount: s.postCount, commentCount: s.commentCount, reviewCount: 0, ...s.phraseSentiment };
}
const fetchedAt = (data as { fetchedAt?: string }).fetchedAt ?? new Date().toISOString();
writeFileSync(SENTIMENT_FILE, JSON.stringify({ fetchedAt, lenses: lensSentiment }, null, 2));

console.log(`Posts    : scanned ${postsSeen}, ${postsUpdated} with changed postLensIds, ${postsDropped} dropped (no remaining matches).`);
console.log(`Comments : scanned ${commentsSeen}, ${commentsUpdated} updated.`);
console.log(`Stats    : rebuilt for ${data.stats.length} lenses.`);
console.log(`Wrote ${FILE} and ${SENTIMENT_FILE} (${Object.keys(lensSentiment).length} lenses with sentiment).`);
