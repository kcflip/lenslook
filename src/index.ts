import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { fetchPosts, fetchSearch, fetchComments, withCabinetAnimation, type SearchSort } from "./scraper.js";
import { matchLensesWithPositions, matchProductsWithPositions, compileBodies, ALL_LENSES, type CompiledProduct } from "./matcher.js";
import { analyzePhraseSentiment, computePhraseSentiment } from "./sentiment.js";
import { calcWeight } from "../shared/weight.js";
import type { Body, RedditPost as Post, Post as MatchedPost, LensStat, SentimentMention, WordHit, LensSentimentEntry } from "../shared/types.js";

// Dense Sony-lens subs — top listings are relevant enough to pull whole.
const LISTING_SUBREDDITS = ["sonyalpha"];
// Broad subs where most posts are off-topic — narrow via /search.json?q=
// to posts that mention one of our tracked brands.
const SEARCH_SUBREDDITS = ["photography", "astrophotography", "macro"];
const SUBREDDITS = [...LISTING_SUBREDDITS, ...SEARCH_SUBREDDITS];
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
// Reddit's search endpoint doesn't support `rising` or `controversial`.
const SEARCH_SORTS: ReadonlySet<string> = new Set(["relevance", "hot", "top", "new", "comments"]);

// Build the search-query set. A bare `sony` query runs on all 6 search sorts
// to get the widest first-party + co-mention coverage. But Reddit caps listing
// results around 1000, so on noisy broad subs the bare query saturates and
// buries third-party lens discussions. To fan past the cap, we also issue
// `sony <brand>` pair queries (restricted to top/all + top/year since those
// are the buckets most likely to saturate, and deeper timeframes are lower
// yield on smaller subs). Overlapping posts are deduped by ID downstream.
// Rokinon is a Samyang rebrand common in US listings, so include it explicitly.
function buildSearchQueries(): { query: string; runs: typeof RUNS }[] {
  const brands = new Set<string>();
  for (const l of ALL_LENSES) brands.add(l.brand.toLowerCase());
  brands.add("rokinon");
  const others = [...brands].filter((b) => b !== "sony").sort();
  const bareRuns = RUNS.filter((r) => SEARCH_SORTS.has(r.sort));
  const narrowRuns = RUNS.filter(
    (r) => r.sort === "top" && (r.timeframe === "all" || r.timeframe === "year"),
  );
  return [
    { query: "sony", runs: bareRuns },
    ...others.map((b) => ({ query: `sony ${b}`, runs: narrowRuns })),
  ];
}
const LIMIT = 1000;
const COMMENT_MIN_SCORE = 4;
const POST_MIN_SCORE_DISCUSSION = 5;
const POST_MIN_SCORE_IMAGE = 7;

function postMinScore(post: Post): number {
  return post.is_self ? POST_MIN_SCORE_DISCUSSION : POST_MIN_SCORE_IMAGE;
}

interface PostState {
  post: Post;
  postLensIds: string[];
  postBodyIds: string[];
  postMentions: SentimentMention[];
}
interface CommentData {
  matchedComments: { id: string; body: string; score: number; lensIds: string[]; bodyIds: string[] }[];
  commentMentions: SentimentMention[];
  commentLensIds: string[];
  commentBodyIds: string[];
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
    const commentBodyIds = c?.commentBodyIds ?? [];
    const lensIds = [...state.postLensIds, ...commentLensIds];
    const bodyIds = [...state.postBodyIds, ...commentBodyIds];
    if (lensIds.length === 0 && bodyIds.length === 0) continue;
    out.push({
      ...state.post,
      lensIds,
      postLensIds: state.postLensIds,
      commentLensIds,
      bodyIds,
      postBodyIds: state.postBodyIds,
      commentBodyIds,
      matchedComments: c?.matchedComments,
      sentimentMentions: [...state.postMentions, ...(c?.commentMentions ?? [])],
    });
  }
  return out;
}

async function main() {
  const bodies: Body[] = existsSync("bodies.json")
    ? JSON.parse(readFileSync("bodies.json", "utf8"))
    : [];
  const bodyPool: CompiledProduct[] = compileBodies(bodies);
  if (bodies.length > 0) {
    console.log(`  Body pool      : ${bodies.length} bodies compiled (${bodyPool.reduce((n, b) => n + b.patterns.length, 0)} patterns)`);
  }

  const searchQueries = buildSearchQueries();
  type QueryRun = { query: string | null; sort: string; timeframe: string };
  const plan: { sub: string; mode: "listing" | "search"; runs: QueryRun[] }[] = [
    ...LISTING_SUBREDDITS.map((sub) => ({
      sub,
      mode: "listing" as const,
      runs: RUNS.map((r) => ({ query: null, sort: r.sort, timeframe: r.timeframe })),
    })),
    ...SEARCH_SUBREDDITS.map((sub) => ({
      sub,
      mode: "search" as const,
      runs: searchQueries.flatMap((q) =>
        q.runs.map((r) => ({ query: q.query, sort: r.sort, timeframe: r.timeframe })),
      ),
    })),
  ];
  const totalRuns = plan.reduce((sum, p) => sum + p.runs.length, 0);
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
  console.log(`  Listing subs   : ${LISTING_SUBREDDITS.join(", ")}`);
  console.log(`  Search subs    : ${SEARCH_SUBREDDITS.join(", ")}`);
  console.log(`  Search queries : ${searchQueries.map((q) => `"${q.query}"×${q.runs.length}`).join(", ")}`);
  console.log(`  Limit          : ${LIMIT} posts per run`);
  console.log(`  Total runs     : ${totalRuns}`);
  console.log(`${"=".repeat(70)}\n`);

  for (const { sub, mode, runs } of plan) {
    const subHeader = `r/${sub}  (${mode}, ${runs.length} run${runs.length === 1 ? "" : "s"})`;
    console.log(`\n${"─".repeat(70)}`);
    console.log(`  ${subHeader}`);
    console.log(`${"─".repeat(70)}`);

    const subStartSeen = seenPosts.size;
    const subStartMatched = [...seenPosts.values()].filter((s) => s.postLensIds.length > 0).length;
    let lastQuery: string | null | undefined = undefined;

    for (const { query, sort, timeframe } of runs) {
      runIndex++;
      if (query !== lastQuery && query !== null) {
        console.log(`\n  ▸ query: "${query}"`);
        lastQuery = query;
      }

      const progress = `[${String(runIndex).padStart(String(totalRuns).length)}/${totalRuns}]`;
      const runSpec = `${sort}/${timeframe}`.padEnd(18);
      const label = query
        ? `r/${sub} — "${query}" — ${sort}/${timeframe}`
        : `r/${sub} — ${sort}/${timeframe}`;
      console.log(`    ${progress} ${runSpec} fetching…`);

      const fetchPromise = mode === "listing"
        ? fetchPosts(sub, sort as "top", LIMIT, timeframe as "all")
        : fetchSearch(sub, query!, sort as SearchSort, LIMIT, timeframe as "all");
      const posts = await withCabinetAnimation(label, fetchPromise);
      const unseenPosts = posts.filter((p) => !seenPosts.has(p.id));
      const dupes = posts.length - unseenPosts.length;
      const newPosts = unseenPosts.filter((p) => p.score >= postMinScore(p));
      const belowThreshold = unseenPosts.length - newPosts.length;

      let matchCount = 0;
      for (const post of newPosts) {
        const { matches, normalized } = matchProductsWithPositions(
          post.title + " " + (post.selftext ?? ""),
          bodyPool,
        );
        const lensMatches = matches.filter((m) => !m.id.startsWith("body-"));
        const bodyMatches = matches.filter((m) => m.id.startsWith("body-"));
        const postLensIds = [...new Set(lensMatches.map((m) => m.id))];
        const postBodyIds = [...new Set(bodyMatches.map((m) => m.id))];
        const postMentions: SentimentMention[] = lensMatches.map((m) => ({
          lensId: m.id,
          source: "post",
          ...analyzePhraseSentiment(normalized, m.index, "post"),
        }));
        seenPosts.set(post.id, { post, postLensIds, postBodyIds, postMentions });
        if (postLensIds.length > 0) matchCount++;
      }

      const matchRate = newPosts.length > 0 ? ((matchCount / newPosts.length) * 100).toFixed(1) : "0.0";
      const titleMatched = [...seenPosts.values()].filter((s) => s.postLensIds.length > 0).length;
      console.log(`    ${progress} ${runSpec} fetched ${posts.length} (${dupes} dupe, ${belowThreshold} low-score, ${newPosts.length} new) → matched ${matchCount}/${newPosts.length} (${matchRate}%) · total ${titleMatched} matched / ${seenPosts.size} seen`);
    }

    const subMatched = [...seenPosts.values()].filter((s) => s.postLensIds.length > 0).length - subStartMatched;
    const subSeen = seenPosts.size - subStartSeen;
    console.log(`\n  r/${sub} done — +${subMatched} matched, +${subSeen} unique seen`);
  }

  const titleMatchedCount = [...seenPosts.values()].filter((s) => s.postLensIds.length > 0).length;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ✅ Post fetch complete`);
  console.log(`  Total unique posts scanned : ${seenPosts.size}`);
  console.log(`  Title/selftext matched     : ${titleMatchedCount}`);
  console.log(`  Overall title match rate   : ${((titleMatchedCount / seenPosts.size) * 100).toFixed(1)}%`);
  console.log(`${"=".repeat(50)}\n`);

  // ── Comment matching phase ──
  // Fetch comments for EVERY post that passed the post score threshold.
  // Individual comments are filtered by score >= COMMENT_MIN_SCORE before matching.
  const commentCandidates = [...seenPosts.values()].map((s) => s.post);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`  💬 Comment Fetching Phase`);
  console.log(`${"=".repeat(50)}`);
  console.log(`  Fetching comments for      : ${commentCandidates.length} posts`);
  console.log(`  Comment score threshold    : ${COMMENT_MIN_SCORE}`);
  console.log(`${"=".repeat(50)}\n`);

  let newFromComments = 0;
  let enrichedExisting = 0;
  let totalDupesCollapsed = 0;
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
    const matchedComments: { id: string; body: string; score: number; lensIds: string[]; bodyIds: string[] }[] = [];
    const commentMentions: SentimentMention[] = [];
    const lensIdSet = new Set<string>();
    const bodyIdSet = new Set<string>();

    // Dedupe same-user repeats within this thread. A single commenter often
    // drops the same "I use X" reply across several branches — each branch is
    // the same opinion, so counting them independently overstates mentions.
    // Key on (author, sorted lensIds); keep the highest-scored copy.
    type Enriched = {
      comment: typeof comments[0];
      matches: ReturnType<typeof matchLensesWithPositions>["matches"];
      normalized: string;
      commentLensSet: Set<string>;
      commentBodySet: Set<string>;
    };
    const deduped: Enriched[] = [];
    const bestByAuthorLens = new Map<string, Enriched>();
    let dupesCollapsed = 0;
    for (const comment of comments) {
      if (comment.score < COMMENT_MIN_SCORE) continue;
      const { matches, normalized } = matchProductsWithPositions(comment.body, bodyPool);
      if (matches.length === 0) continue;
      const lensMatchesC = matches.filter((m) => !m.id.startsWith("body-"));
      const bodyMatchesC = matches.filter((m) => m.id.startsWith("body-"));
      const commentLensSet = new Set<string>(lensMatchesC.map((m) => m.id));
      const commentBodySetC = new Set<string>(bodyMatchesC.map((m) => m.id));
      const enriched: Enriched = { comment, matches: lensMatchesC, normalized, commentLensSet, commentBodySet: commentBodySetC };

      // [deleted] isn't a real identity — don't collapse across it.
      if (comment.author && comment.author !== "[deleted]") {
        const key = `${comment.author}|${[...commentLensSet].sort().join(",")}`;
        const prior = bestByAuthorLens.get(key);
        if (prior) {
          dupesCollapsed++;
          if (comment.score > prior.comment.score) bestByAuthorLens.set(key, enriched);
        } else {
          bestByAuthorLens.set(key, enriched);
        }
      } else {
        deduped.push(enriched);
      }
    }
    deduped.push(...bestByAuthorLens.values());
    if (dupesCollapsed > 0) {
      totalDupesCollapsed += dupesCollapsed;
      console.log(`  ${progress} collapsed ${dupesCollapsed} same-user repeat${dupesCollapsed === 1 ? "" : "s"} on post ${post.id}`);
    }

    for (const { comment, matches, normalized, commentLensSet, commentBodySet } of deduped) {
      for (const m of matches) {
        lensIdSet.add(m.id);
        commentMentions.push({
          lensId: m.id,
          source: "comment",
          ...analyzePhraseSentiment(normalized, m.index, "comment"),
        });
      }
      for (const id of commentBodySet) bodyIdSet.add(id);
      matchedComments.push({ id: comment.id, body: comment.body, score: comment.score, lensIds: [...commentLensSet], bodyIds: [...commentBodySet] });
    }
    // Exclude lenses/bodies already matched in the title — they shouldn't be double-counted as comment matches.
    const commentLensIds = [...lensIdSet].filter((id) => !state.postLensIds.includes(id));
    const commentBodyIds = [...bodyIdSet].filter((id) => !state.postBodyIds.includes(id));
    if (matchedComments.length > 0 || lensIdSet.size > 0 || bodyIdSet.size > 0) {
      commentData.set(post.id, { matchedComments, commentMentions, commentLensIds, commentBodyIds });
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
  console.log(`  ✅ Comment fetching complete`);
  console.log(`  New matches from comments  : ${newFromComments}`);
  console.log(`  Title-matched enriched     : ${enrichedExisting}`);
  console.log(`  Same-user repeats collapsed: ${totalDupesCollapsed}`);
  console.log(`  Total matched posts        : ${allMatched.length}`);
  console.log(`${"=".repeat(50)}\n`);

  writeOutput(allMatched);
}

function writeOutput(allMatched: MatchedPost[], partial = false) {
  if (partial) {
    console.warn(`\n⚠ Writing partial output — ${allMatched.length} matched posts collected before failure.`);
  }
  console.log("\n⚙️  Aggregating lens stats...");
  const statsMap = new Map<string, { scores: number[]; ratios: number[]; comments: number[]; weights: number[]; commentCount: number }>();
  const sentimentMap = new Map<string, { rawScores: number[]; positiveHits: WordHit[]; negativeHits: WordHit[] }>();

  for (const post of allMatched) {
    const weight = calcWeight(post);
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

  console.log(`📊 Aggregated stats for ${stats.length} distinct lenses.`);

  mkdirSync("output", { recursive: true });
  const fetchedAt = new Date().toISOString();
  const output = { fetchedAt, subreddits: SUBREDDITS, runs: RUNS, stats, posts: allMatched };
  writeFileSync("output/sonyResults.json", JSON.stringify(output, null, 2));
  console.log("💾 Written to output/sonyResults.json");

  const lensSentiment: Record<string, LensSentimentEntry> = {};
  for (const s of stats) {
    if (!s.phraseSentiment) continue;
    lensSentiment[s.lensId] = { postCount: s.postCount, commentCount: s.commentCount, reviewCount: 0, ...s.phraseSentiment };
  }
  writeFileSync("output/lens-sentiment.json", JSON.stringify({ fetchedAt, lenses: lensSentiment }, null, 2));
  console.log(`💾 Written to output/lens-sentiment.json (${Object.keys(lensSentiment).length} lenses with sentiment)`);

  console.log(`\n${"=".repeat(50)}`);
  console.log("  🏆 Top 15 lenses by total weight");
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
