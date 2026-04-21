import { writeFileSync, mkdirSync } from "fs";
import { fetchPosts, fetchComments, withCabinetAnimation } from "./scraper.js";
import { matchLensesWithPositions, matchPostWithPositions } from "./matcher.js";
import { analyzePhraseSentiment, computePhraseSentiment } from "./sentiment.js";
import type { RedditPost as Post, Post as MatchedPost, LensStat, SentimentMention, WordHit, PhraseSentimentStats } from "../shared/types.js";

const SUBREDDITS = ["sonyalpha", "photography"];
const RUNS: { sort: string; timeframe: string }[] = [
  { sort: "top",           timeframe: "all"   },
  { sort: "top",           timeframe: "year"  },
  { sort: "top",           timeframe: "month" },
  { sort: "top",           timeframe: "week"  },
  { sort: "hot",           timeframe: "all"   },
  { sort: "new",           timeframe: "all"   },
  { sort: "rising",        timeframe: "all"   },
  { sort: "controversial", timeframe: "all"   },
];
const LIMIT = 1000;
const COMMENT_MIN_SCORE = 5;
const POST_MIN_SCORE_DISCUSSION = 10;
const POST_MIN_SCORE_IMAGE = 15;

function postMinScore(post: Post): number {
  return post.is_self ? POST_MIN_SCORE_DISCUSSION : POST_MIN_SCORE_IMAGE;
}

interface PostState {
  post: Post;
  postLensIds: string[];
  postMentions: SentimentMention[];
}
interface CommentData {
  matchedComments: { id: string; body: string; score: number; lensIds: string[] }[];
  commentMentions: SentimentMention[];
  commentLensIds: string[];
}

// Module-scope so the fatal-error handler can emit a partial output from whatever
// was collected before the crash.
const seenPosts = new Map<string, PostState>();
const commentData = new Map<string, CommentData>();

function buildAllMatched(): MatchedPost[] {
  const out: MatchedPost[] = [];
  for (const state of seenPosts.values()) {
    const c = commentData.get(state.post.id);
    const commentLensIds = c?.commentLensIds ?? [];
    const lensIds = [...state.postLensIds, ...commentLensIds];
    if (lensIds.length === 0) continue;
    out.push({
      ...state.post,
      lensIds,
      postLensIds: state.postLensIds,
      commentLensIds,
      matchedComments: c?.matchedComments,
      sentimentMentions: [...state.postMentions, ...(c?.commentMentions ?? [])],
    });
  }
  return out;
}

async function main() {
  const totalRuns = SUBREDDITS.length * RUNS.length;
  let runIndex = 0;

  const banner = [
    "",
    " ██╗     ███████╗███╗   ██╗███████╗██╗      ██████╗  ██████╗ ██╗  ██╗",
    " ██║     ██╔════╝████╗  ██║██╔════╝██║     ██╔═══██╗██╔═══██╗██║ ██╔╝",
    " ██║     █████╗  ██╔██╗ ██║███████╗██║     ██║   ██║██║   ██║█████╔╝ ",
    " ██║     ██╔══╝  ██║╚██╗██║╚════██║██║     ██║   ██║██║   ██║██╔═██╗ ",
    " ███████╗███████╗██║ ╚████║███████║███████╗╚██████╔╝╚██████╔╝██║  ██╗",
    " ╚══════╝╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝",
    "           Reddit Lens Popularity Scraper",
    "",
  ].join("\n");
  console.log(banner);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Subreddits : ${SUBREDDITS.join(", ")}`);
  console.log(`  Runs       : ${RUNS.map(r => `${r.sort}/${r.timeframe}`).join(", ")}`);
  console.log(`  Limit      : ${LIMIT} posts per run`);
  console.log(`  Total runs : ${totalRuns}`);
  console.log(`${"=".repeat(70)}\n`);

  for (const sub of SUBREDDITS) {
    console.log(`\n── r/${sub} ${"─".repeat(40 - sub.length)}`);

    for (const { sort, timeframe } of RUNS) {
      runIndex++;
      console.log(`\n  [${runIndex}/${totalRuns}] Fetching r/${sub} — ${sort}/${timeframe}...`);

      const posts = await withCabinetAnimation(
        `Fetching r/${sub} — ${sort}/${timeframe}`,
        fetchPosts(sub, sort as "top", LIMIT, timeframe as "all"),
      );
      const unseenPosts = posts.filter((p) => !seenPosts.has(p.id));
      const dupes = posts.length - unseenPosts.length;
      const newPosts = unseenPosts.filter((p) => p.score >= postMinScore(p));
      const belowThreshold = unseenPosts.length - newPosts.length;

      console.log(`  Fetched   : ${posts.length} posts (${dupes} dupes, ${belowThreshold} below score threshold, ${newPosts.length} new)`);

      let matchCount = 0;
      for (const post of newPosts) {
        const { matches, normalized } = matchPostWithPositions(post);
        const postLensIds = [...new Set(matches.map((m) => m.id))];
        const postMentions: SentimentMention[] = matches.map((m) => ({
          lensId: m.id,
          source: "post",
          ...analyzePhraseSentiment(normalized, m.index, "post"),
        }));
        seenPosts.set(post.id, { post, postLensIds, postMentions });
        if (postLensIds.length > 0) matchCount++;
      }

      const matchRate = newPosts.length > 0 ? ((matchCount / newPosts.length) * 100).toFixed(1) : "0.0";
      const titleMatched = [...seenPosts.values()].filter((s) => s.postLensIds.length > 0).length;
      console.log(`  Matched   : ${matchCount} posts (${matchRate}% match rate)`);
      console.log(`  Running total: ${titleMatched} title-matched / ${seenPosts.size} unique seen`);
    }
  }

  const titleMatchedCount = [...seenPosts.values()].filter((s) => s.postLensIds.length > 0).length;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  Post fetch complete`);
  console.log(`  Total unique posts scanned : ${seenPosts.size}`);
  console.log(`  Title/selftext matched     : ${titleMatchedCount}`);
  console.log(`  Overall title match rate   : ${((titleMatchedCount / seenPosts.size) * 100).toFixed(1)}%`);
  console.log(`${"=".repeat(50)}\n`);

  // ── Comment matching phase ──
  // Fetch comments for EVERY post that passed the post score threshold.
  // Individual comments are filtered by score >= COMMENT_MIN_SCORE before matching.
  const commentCandidates = [...seenPosts.values()].map((s) => s.post);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`  Comment Fetching Phase`);
  console.log(`${"=".repeat(50)}`);
  console.log(`  Fetching comments for      : ${commentCandidates.length} posts`);
  console.log(`  Comment score threshold    : ${COMMENT_MIN_SCORE}`);
  console.log(`${"=".repeat(50)}\n`);

  let newFromComments = 0;
  let enrichedExisting = 0;
  for (let i = 0; i < commentCandidates.length; i++) {
    const post = commentCandidates[i];
    const state = seenPosts.get(post.id)!;
    const progress = `[${String(i + 1).padStart(String(commentCandidates.length).length)}/${commentCandidates.length}]`;
    let comments;
    try {
      comments = await fetchComments(post.subreddit, post.id);
    } catch (e) {
      console.warn(`  ⚠ Rate limit retries exhausted fetching comments for post ${post.id} — skipping.`);
      continue;
    }
    const matchedComments: { id: string; body: string; score: number; lensIds: string[] }[] = [];
    const commentMentions: SentimentMention[] = [];
    const lensIdSet = new Set<string>();
    for (const comment of comments) {
      if (comment.score < COMMENT_MIN_SCORE) continue;
      const { matches, normalized } = matchLensesWithPositions(comment.body);
      if (matches.length > 0) {
        const commentLensSet = new Set<string>();
        for (const m of matches) {
          lensIdSet.add(m.id);
          commentLensSet.add(m.id);
          commentMentions.push({
            lensId: m.id,
            source: "comment",
            ...analyzePhraseSentiment(normalized, m.index, "comment"),
          });
        }
        matchedComments.push({ id: comment.id, body: comment.body, score: comment.score, lensIds: [...commentLensSet] });
      }
    }
    // Exclude lenses already matched in the title — they shouldn't be double-counted as comment matches.
    const commentLensIds = [...lensIdSet].filter((id) => !state.postLensIds.includes(id));
    if (matchedComments.length > 0 || lensIdSet.size > 0) {
      commentData.set(post.id, { matchedComments, commentMentions, commentLensIds });
      if (state.postLensIds.length === 0 && commentLensIds.length > 0) {
        newFromComments++;
        console.log(`  ${progress} NEW    r/${post.subreddit} — "${post.title.slice(0, 50)}" → [${commentLensIds.join(", ")}] (${matchedComments.length} comment${matchedComments.length !== 1 ? "s" : ""})`);
      } else if (state.postLensIds.length > 0) {
        enrichedExisting++;
      }
    }
    if ((i + 1) % 25 === 0) {
      console.log(`  ${progress} checked ${i + 1} posts (${newFromComments} new, ${enrichedExisting} enriched)`);
    }
  }

  const allMatched = buildAllMatched();
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  Comment fetching complete`);
  console.log(`  New matches from comments  : ${newFromComments}`);
  console.log(`  Title-matched enriched     : ${enrichedExisting}`);
  console.log(`  Total matched posts        : ${allMatched.length}`);
  console.log(`${"=".repeat(50)}\n`);

  writeOutput(allMatched);
}

function writeOutput(allMatched: MatchedPost[], partial = false) {
  if (partial) {
    console.warn(`\n⚠ Writing partial output — ${allMatched.length} matched posts collected before failure.`);
  }
  console.log("\nAggregating lens stats...");
  const statsMap = new Map<string, { scores: number[]; ratios: number[]; comments: number[]; weights: number[]; commentCount: number }>();
  const sentimentMap = new Map<string, { rawScores: number[]; positiveHits: WordHit[]; negativeHits: WordHit[] }>();

  for (const post of allMatched) {
    const engagementScore = Math.log(1 + post.score) * (post.is_self ? post.upvote_ratio * 0.5 : post.upvote_ratio);
    const discussionScore = Math.log(1 + post.num_comments);
    const weight = engagementScore * 0.5 + discussionScore * 0.5;
    for (const id of post.lensIds) {
      if (!statsMap.has(id)) statsMap.set(id, { scores: [], ratios: [], comments: [], weights: [], commentCount: 0 });
      const s = statsMap.get(id)!;
      s.scores.push(post.score);
      s.ratios.push(post.upvote_ratio);
      s.comments.push(post.num_comments);
      s.weights.push(weight);
      if (post.commentLensIds.includes(id)) s.commentCount++;
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

  const stats: LensStat[] = [...statsMap.entries()]
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

  console.log(`Aggregated stats for ${stats.length} distinct lenses.`);

  mkdirSync("output", { recursive: true });
  const fetchedAt = new Date().toISOString();
  const output = { fetchedAt, subreddits: SUBREDDITS, runs: RUNS, stats, posts: allMatched };
  writeFileSync("output/results.json", JSON.stringify(output, null, 2));
  console.log("Written to output/results.json");

  const lensSentiment: Record<string, { postCount: number; commentCount: number } & PhraseSentimentStats> = {};
  for (const s of stats) {
    if (!s.phraseSentiment) continue;
    lensSentiment[s.lensId] = { postCount: s.postCount, commentCount: s.commentCount, ...s.phraseSentiment };
  }
  writeFileSync("output/lens-sentiment.json", JSON.stringify({ fetchedAt, lenses: lensSentiment }, null, 2));
  console.log(`Written to output/lens-sentiment.json (${Object.keys(lensSentiment).length} lenses with sentiment)`);

  console.log(`\n${"=".repeat(50)}`);
  console.log("  Top 15 lenses by total weight");
  console.log(`${"=".repeat(50)}`);
  for (const s of stats.slice(0, 15)) {
    console.log(`  ${s.lensId.padEnd(42)} ${String(s.postCount).padStart(3)} posts   weight: ${s.scoreSentiment}`);
  }
  console.log(`${"=".repeat(50)}\n`);
}

main().catch((e) => {
  console.error(`\n⚠ Fatal error: ${e.message}`);
  const partial = buildAllMatched();
  if (partial.length > 0) writeOutput(partial, true);
  process.exit(1);
});
